import { at, canonical, clone, covered, expand, fail, pointer, safeKey, SolveError } from './json.js';
import { EntityGraph } from './entities.js';
import { dormant, isModuleEnabled } from './schema.js';
import type { CompiledDefinition, Definition, GuideConditionContext, GuideRule, Json, LogicalState } from './types.js';

type Expr = { kind: 'literal'; value: Json } | { kind: 'path'; value: string }
  | { kind: 'not'; child: Expr } | { kind: 'binary'; op: string; left: Expr; right: Expr };
type Token = { kind: 'literal' | 'path' | 'op' | 'end'; value: any };
const expressions = new WeakMap<GuideRule, Expr>();
const location = (rule: GuideRule) => rule.source ? `${rule.source} (${rule.id})` : rule.id;
function problem(source: string, message: string): never { return fail('GUIDE_CONDITION', `${source}：${message}`, source); }

/** Read a quoted literal, shared with the world-info header parser. Never evaluates code. */
export function readQuoted(text: string, start: number, source: string): { value: string; end: number } {
  const quote = text[start]; let value = '', i = start + 1;
  while (i < text.length) {
    const char = text[i++]!;
    if (char === quote) return { value, end: i };
    if (char === '\n' || char === '\r') problem(source, '字符串不能含未转义换行');
    if (char !== '\\') { value += char; continue; }
    const escape = text[i++];
    const simple: Record<string, string> = { '"': '"', "'": "'", '\\': '\\', n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '/': '/' };
    if (escape && Object.hasOwn(simple, escape)) { value += simple[escape]; continue; }
    if (escape === 'u' && /^[0-9a-f]{4}$/iu.test(text.slice(i, i + 4))) { value += String.fromCharCode(parseInt(text.slice(i, i + 4), 16)); i += 4; continue; }
    problem(source, '字符串转义无效');
  }
  return problem(source, '字符串引号未闭合');
}
function parse(expression: string, source: string): Expr {
  if (!expression.trim() || expression.length > 4096) problem(source, '条件不能为空且不能超过4096字符');
  const tokens: Token[] = []; let i = 0;
  while (i < expression.length) {
    if (/\s/u.test(expression[i]!)) { i++; continue; }
    if (tokens.length >= 512) problem(source, '条件过长');
    const rest = expression.slice(i), char = expression[i]!;
    if (char === '"' || char === "'") { const result = readQuoted(expression, i, source); tokens.push({ kind: 'literal', value: result.value }); i = result.end; continue; }
    const op = /^(?:===|!==|==|!=|<=|>=|&&|\|\||[!<>()])/u.exec(rest)?.[0];
    if (op) { tokens.push({ kind: 'op', value: op }); i += op.length; continue; }
    const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u.exec(rest)?.[0];
    if (number) { const value = Number(number); if (!Number.isFinite(value)) problem(source, '数值必须有限'); tokens.push({ kind: 'literal', value }); i += number.length; continue; }
    const path = /^@?[\p{L}\p{N}_:-]+(?:\.[\p{L}\p{N}_:-]+)*/u.exec(rest)?.[0];
    if (path) {
      if (['true', 'false', 'null'].includes(path)) tokens.push({ kind: 'literal', value: JSON.parse(path) });
      else { for (const part of path.replace(/^@/u, '').split('.')) safeKey(part); tokens.push({ kind: 'path', value: path }); }
      i += path.length; continue;
    }
    problem(source, `不支持的条件字符：${char}`);
  }
  tokens.push({ kind: 'end', value: '' }); let cursor = 0, depth = 0;
  const take = (value: string) => { if (tokens[cursor]!.value === value && tokens[cursor]!.kind === 'op') { cursor++; return true; } return false; };
  const primary = (): Expr => {
    if (++depth > 32) problem(source, '条件嵌套超过32层');
    let result: Expr;
    if (take('!')) result = { kind: 'not', child: primary() };
    else if (take('(')) { result = or(); if (!take(')')) problem(source, '缺少右括号'); }
    else { const token = tokens[cursor++]!; if (!['literal', 'path'].includes(token.kind)) problem(source, '需要状态路径、常量或括号'); result = { kind: token.kind as 'literal' | 'path', value: token.value }; }
    depth--; return result;
  };
  const compare = (): Expr => { const left = primary(), token = tokens[cursor]!; if (token.kind === 'op' && ['==','!=','===','!==','<','<=','>','>='].includes(token.value)) { cursor++; return { kind: 'binary', op: token.value, left, right: primary() }; } return left; };
  const and = (): Expr => { let left = compare(); while (take('&&')) left = { kind: 'binary', op: '&&', left, right: compare() }; return left; };
  const or = (): Expr => { let left = and(); while (take('||')) left = { kind: 'binary', op: '||', left, right: and() }; return left; };
  const result = or(); if (tokens[cursor]!.kind !== 'end') problem(source, '条件末尾含多余内容，不支持赋值、调用或算术表达式'); return result;
}
function boolean(value: unknown, source: string): boolean | undefined {
  if (value === undefined || typeof value === 'boolean') return value;
  return problem(source, '逻辑条件必须得到布尔值，数值或文本请显式比较');
}
function evaluate(expr: Expr, get: GuideConditionContext['get'], source: string): Json | undefined {
  if (expr.kind === 'literal') return expr.value;
  if (expr.kind === 'path') return get(expr.value);
  if (expr.kind === 'not') { const value = boolean(evaluate(expr.child, get, source), source); return value === undefined ? undefined : !value; }
  const left = evaluate(expr.left, get, source);
  if (expr.op === '&&' || expr.op === '||') {
    const a = boolean(left, source);
    if (expr.op === '&&' && a === false) return false;
    if (expr.op === '||' && a === true) return true;
    const b = boolean(evaluate(expr.right, get, source), source);
    return expr.op === '&&' ? (b === false ? false : a === undefined ? undefined : b) : (b === true ? true : a === undefined ? undefined : b);
  }
  const right = evaluate(expr.right, get, source);
  if (left === undefined || right === undefined) return undefined;
  if (['==','===','!=','!=='].includes(expr.op)) {
    if (left !== null && typeof left === 'object' || right !== null && typeof right === 'object') problem(source, '相等比较仅支持数值、文本、布尔值或null');
    return expr.op === '==' || expr.op === '===' ? left === right : left !== right;
  }
  if (typeof left !== 'number' || typeof right !== 'number') return problem(source, '大小比较两侧必须是数值');
  return expr.op === '<' ? left < right : expr.op === '<=' ? left <= right : expr.op === '>' ? left > right : left >= right;
}

/** Copy function references, never run predicates or sample their results during compilation. */
export function copyGuideRules(value: unknown, source = 'guides'): GuideRule[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) problem(source, 'guides必须是数组');
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) problem(source, `第${index + 1}条指南必须是对象`);
    if (Object.keys(item).some(key => !['id','module','when','text','source'].includes(key))) problem(source, '指南含未知字段');
    if (typeof item.id !== 'string' || !item.id.trim() || typeof item.text !== 'string') problem(source, '指南必须有非空id和text文本');
    safeKey(item.id);
    if (item.module !== undefined && (typeof item.module !== 'string' || !item.module)) problem(source, item.id + '的module必须是非空字符串');
    if (item.module) safeKey(item.module);
    if (item.when !== undefined && typeof item.when !== 'string' && typeof item.when !== 'function') problem(source, item.id + '的when必须是表达式或同步函数');
    if (item.source !== undefined && typeof item.source !== 'string') problem(source, 'source必须是文本');
    const rule: GuideRule = { id: item.id, text: item.text, ...(item.module !== undefined ? { module: item.module } : {}), ...(item.when !== undefined ? { when: item.when } : {}), ...(item.source !== undefined ? { source: item.source } : {}) };
    if (typeof rule.when === 'string') {
      try { expressions.set(rule, parse(rule.when, location(rule))); }
      catch (error) { if (error instanceof SolveError && error.code === 'GUIDE_CONDITION') throw error; problem(location(rule), error instanceof Error ? error.message : String(error)); }
    }
    return Object.freeze(rule);
  });
}
export function describeGuideRules(rules: GuideRule[] = [], sources = false): Json[] {
  return rules.map(rule => ({ id: rule.id, text: rule.text, ...(rule.module !== undefined ? { module: rule.module } : {}),
    ...(rule.when !== undefined ? { when: typeof rule.when === 'function' ? { binding: rule.id } : rule.when } : {}),
    ...(sources && rule.source !== undefined ? { source: rule.source } : {}) }));
}
export function compileGuideRules(def: Definition): GuideRule[] {
  const rules = copyGuideRules(def.guides), seen = new Set<string>();
  for (const rule of rules) {
    if (seen.has(rule.id)) problem(location(rule), '指南id重复'); seen.add(rule.id);
    if (rule.module && !Object.hasOwn(def.modules ?? {}, rule.module)) problem(location(rule), `未知模块：${rule.module}`);
  }
  return Object.freeze(rules) as GuideRule[];
}
export function sameGuideRule(left: GuideRule, right: GuideRule): boolean {
  return canonical(describeGuideRules([left])) === canonical(describeGuideRules([right]))
    && (typeof left.when !== 'function' || left.when === right.when);
}
export function selectGuides(def: CompiledDefinition, state: LogicalState, tag?: string): string[] {
  let graph: EntityGraph | undefined;
  const get = (path: string): Json | undefined => {
    graph ??= new EntityGraph(def, state);
    let parts: string[];
    try { parts = graph.resolve(path); } catch (error) { if (error instanceof SolveError && error.code === 'ENTITY_NOT_FOUND') return undefined; throw error; }
    if (dormant(def, state, parts)) return undefined;
    // A parent object must not reveal dormant descendants through a predicate.
    for (const [name, module] of Object.entries(def.modules ?? {})) if (!isModuleEnabled(def, state, name)
      && module.paths.some(pattern => expand(state.data, pattern).some(found => covered(pointer(parts), found.parts)))) return undefined;
    const value = at(state.data, parts, false); return value === undefined ? undefined : clone(value);
  };
  const context = Object.freeze({ get });
  const texts: string[] = [];
  for (const rule of def.guides ?? []) {
    if (tag && rule.module !== tag || rule.module && !isModuleEnabled(def, state, rule.module)) continue;
    let enabled = true;
    try {
      if (typeof rule.when === 'string') {
        let expression = expressions.get(rule);
        if (!expression) { expression = parse(rule.when, location(rule)); expressions.set(rule, expression); }
        enabled = boolean(evaluate(expression, get, location(rule)), location(rule)) === true;
      }
      else if (rule.when) {
        const value: unknown = rule.when(context);
        // Observe rejected async callbacks without converting Promise truthiness into a match.
        if (value && typeof (value as any).then === 'function') { void Promise.resolve(value).catch(() => undefined); problem(location(rule), 'when需要同步返回boolean；宏不能等待异步条件'); }
        if (typeof value !== 'boolean') problem(location(rule), 'when函数必须返回boolean');
        enabled = value;
      }
    } catch (error) { if (error instanceof SolveError && error.code === 'GUIDE_CONDITION') throw error; problem(location(rule), error instanceof Error ? error.message : String(error)); }
    if (enabled && rule.text) texts.push(rule.text);
  }
  return texts;
}
