/**
 * 数据结构说明（给模型）：从编译后的结构声明（display.fields / labels）生成一棵缩进树，
 * 写明每个可写字段的键名、类型、取值范围和作者写的说明（hint，没有时用 desc）。
 * 只列当前开启的模块；模型不能写的字段（readonly / internal、轮次）不列。
 * 没有结构声明的定义（直接用 Zod 写的）返回空字符串。
 */
import { dormant } from './schema.js';
import type { CompiledDefinition, LogicalState } from './types.js';

interface Meta { type: string; hint?: string; desc?: string; values?: string[]; min?: number; max?: number; to?: string | string[]; entity?: string; keys?: string; stamp?: boolean; variants?: string[]; required?: boolean; nullable?: boolean }
const SCALAR: Record<string, string> = { string: '文字', int: '整数', number: '数', bool: 'true/false' };
const INLINE_MAX = 8;

export function schemaText(def: CompiledDefinition, state: LogicalState): string {
  const fields = (def.display?.fields ?? {}) as unknown as Record<string, Meta>;
  if (!Object.keys(fields).length) return '';
  const labels = def.display?.labels ?? {};
  const blocked = [...(def.readonly ?? []), ...(def.internal ?? [])];
  const typeLabel: Record<string, string> = {};
  // Entity types whose collection is switched off are not offered as reference targets.
  for (const e of def.entities ?? []) if (!dormant(def, state, e.path.split('.'))) typeLabel[e.type] ??= labels[e.path] ?? e.type;
  const children: Record<string, string[]> = {};
  for (const path of Object.keys(fields)) {
    const cut = path.lastIndexOf('.');
    (children[cut < 0 ? '' : path.slice(0, cut)] ??= []).push(path);
  }
  const hidden = (path: string) => {
    const parts = path.split('.');
    if (path === def.round || blocked.some(b => b === path || path.startsWith(b + '.'))) return true;
    return dormant(def, state, parts);
  };
  const kids = (path: string) => (children[path] ?? []).filter(p => !hidden(p));
  const key = (path: string) => path.slice(path.lastIndexOf('.') + 1);
  const name = (path: string) => labels[path] ? `${key(path)}（${labels[path]}）` : key(path);
  const note = (m: Meta) => { const h = m.hint ?? m.desc; return h ? ` — ${h}` : ''; };
  const targets = (to: Meta['to']) => (Array.isArray(to) ? to : to ? [to] : []).filter(t => typeLabel[t]).map(t => typeLabel[t]).join('/');
  const limits = (path: string, m: Meta, extra: string[] = []) => {
    const out: string[] = [...extra];
    if (m.required) out.push('必填');
    if (m.min !== undefined && m.max !== undefined) out.push(`${m.min}～${m.max}`);
    else if (m.min !== undefined) out.push(`≥${m.min}`);
    else if (m.max !== undefined) out.push(`≤${m.max}`);
    const delta = def.numeric?.[path]?.maxDelta;
    if (delta) out.push(`每次变化不超过 ±${delta}`);
    const list = def.lists?.[path];
    if (list) out.push(`最多 ${list.max} 条`);
    const computed = def.computed?.[path];
    if (computed) out.push(`「${computed.label}」由引擎计算`);
    return out.length ? `（${out.join('，')}）` : '';
  };
  /** Type of a value that fits on one line, or undefined when it needs its own block. */
  const inline = (path: string): string | undefined => {
    const m = fields[path];
    if (!m) return undefined;
    const orNull = m.nullable ? ' 或 null' : '';
    if (SCALAR[m.type]) return SCALAR[m.type] + orNull + limits(path, m);
    if (m.type === 'enum') return m.values!.join('|') + orNull;
    if (m.type === 'ladder') return `${m.values!.join('<')}${orNull}（由低到高）`;
    if (m.type === 'ref') return `${targets(m.to)}ID${orNull}`;
    if (m.type === 'refs') return `[${targets(m.to)}ID, …]${limits(path, m)}`;
    if (m.type === 'array' && m.stamp) return `[文字, …]${limits(path, m, ['直接写字符串，引擎记录轮次'])}`;
    if (m.type === 'array') { const el = inline(path + '.*'); return el ? `[${el}, …]${limits(path, m)}` : undefined; }
    if (m.type === 'oneOf') return m.variants!.map(v => v === 'object' ? `{${kids(path).map(name).join(', ')}}` : SCALAR[v] ?? v).join(' 或 ');
    if (m.type === 'object') {
      const list = kids(path);
      if (!list.length || list.length > INLINE_MAX || list.some(p => (fields[p]!.hint ?? fields[p]!.desc) || !['string', 'int', 'number', 'bool', 'enum'].includes(fields[p]!.type))) return undefined;
      const types = list.map(p => inline(p)!);
      // Same type everywhere (attribute blocks): say it once.
      if (list.length > 1 && types.every(t => t === types[0])) return `{${list.map(name).join(', ')}} 每项: ${types[0]}`;
      return `{${list.map((p, i) => `${name(p)}: ${types[i]}`).join(', ')}}`;
    }
    if (m.type === 'record') { const v = inline(path + '.*'); return v && !kids(path + '.*').length ? `{${slot(m)}: ${v}, …}` : undefined; }
    return undefined;
  };
  /** A record value / array element that is not an object (e.g. a oneOf gauge). */
  const inlineValue = (path: string) => inline(path) ?? (fields[path]?.type === 'oneOf' ? fields[path]!.variants!.map(v => v === 'object' ? `{${kids(path).map(name).join(', ')}}` : SCALAR[v] ?? v).join(' 或 ') : '');
  const slot = (m: Meta) => m.entity ? '<ID>' : m.keys ? `<${typeLabel[m.keys] ?? m.keys}ID>` : '<名称>';
  const lines: string[] = [];
  const walk = (path: string, depth: number) => {
    const m = fields[path]!, pad = '  '.repeat(depth);
    const one = inline(path);
    if (one !== undefined) { lines.push(`${pad}${name(path)}: ${one}${note(m)}`); return; }
    if (m.type === 'record') {
      const el = path + '.*', em = fields[el];
      if (em && em.type !== 'object') { lines.push(`${pad}${name(path)}.${slot(m)}: ${inlineValue(el)}${limits(path, m)}${note(m)}`); return; }
      lines.push(`${pad}${name(path)}.${slot(m)}${limits(path, m)}${note(m)}`);
      for (const p of kids(el)) walk(p, depth + 1);
      return;
    }
    if (m.type === 'array') {
      lines.push(`${pad}${name(path)}: 数组，每项是${limits(path, m)}${note(m)}`);
      for (const p of kids(path + '.*')) walk(p, depth + 1);
      return;
    }
    lines.push(`${pad}${name(path)}${note(m)}`);
    for (const p of kids(path)) walk(p, depth + 1);
  };
  for (const p of kids('')) walk(p, 0);
  if (!lines.length) return '';
  return ['## 数据结构', '可写的字段只有下面这些（键名照抄，括号里是中文名）。<ID> 处换成实体 ID；写「XxID」的字段填对应实体的 ID，这个实体必须已经存在。', ...lines].join('\n');
}
