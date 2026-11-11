/**
 * 结构制作：检查草稿。三层结果——错误（编译不过 / 开局数据不符，挡住发布）、警告（能用但多半不对）、影响（只影响新聊天还是立即生效）。
 * 编译器目前遇到第一个错误就停（方案 §九.2 会改成一次收集全部），所以错误层最多一条编译错误，加上开局数据错误。
 */
import { compileStructure, type FieldNode, type StructureDescription } from '../../structure.js';
import { compile } from '../../schema.js';
import { SolveCore } from '../../engine.js';
import type { CompiledDefinition } from '../../types.js';
import { addrKey, childrenOf, rootNode, type Addr } from './draft.js';

export interface Issue { level: 'error' | 'warning'; code: string; message: string; addr?: Addr; where?: string }
export interface CheckResult {
  issues: Issue[];
  fingerprint?: string;
  /** The draft compiled (absent while it has a compile error): previews render with it. */
  compiled?: CompiledDefinition;
  /** none: same as the published version; display: applies to every chat at once; structure: new chats only. */
  impact: 'none' | 'display' | 'structure' | 'unknown';
  fieldCount: number;
}

const toAddr = (path?: string): Addr | undefined => (path ? path.split('.').filter(Boolean) : undefined);
const fingerprints = new WeakMap<StructureDescription, Promise<string | undefined>>();
async function fingerprintOf(d: StructureDescription): Promise<string | undefined> {
  if (!fingerprints.has(d)) fingerprints.set(d, (async () => { try { return (await compile(compileStructure(d))).fingerprint; } catch { return undefined; } })());
  return fingerprints.get(d)!;
}

export async function checkStructure(draft: StructureDescription, published: StructureDescription): Promise<CheckResult> {
  const issues: Issue[] = [];
  let fingerprint: string | undefined, compiled: CompiledDefinition | undefined;
  try {
    compiled = await compile(compileStructure(draft));
    fingerprint = compiled.fingerprint;
    try { await new SolveCore(compiled).initialize(draft.initialData ?? {}); }
    catch (error: any) { issues.push({ level: 'error', code: 'INITIAL_DATA', message: '开局数据不符合结构：' + (error?.message ?? String(error)), where: '开局数据' }); }
  } catch (error: any) {
    const message = String(error?.message ?? error);
    const path = error?.path ?? /^([^：]+)：/u.exec(message)?.[1];
    issues.push({ level: 'error', code: error?.code ?? 'COMPILE', message: path ? message.replace(/^[^：]+：/u, '') : message, ...(path && path !== '(根)' ? { addr: toAddr(path) } : {}) });
  }
  // Lints.
  const modules = draft.modules ?? {}, used = new Set<string>();
  const display = JSON.stringify(draft.display ?? {});
  const walk = (node: FieldNode, addr: Addr) => {
    for (const [key, child] of childrenOf(node)) {
      const a = [...addr, key], path = addrKey(a);
      for (const m of ([] as string[]).concat(child.module ?? [])) used.add(m);
      if (key !== '*' && !child.label) issues.push({ level: 'warning', code: 'NO_LABEL', message: '没有显示名，状态栏会直接显示键名', addr: a });
      if (key !== '*' && !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key)) issues.push({ level: 'warning', code: 'KEY_NAME', message: '键名建议只用英文字母、数字和下划线', addr: a });
      if ((child.type === 'enum' || child.type === 'ladder') && !child.values?.length) issues.push({ level: 'warning', code: 'NO_VALUES', message: '没有可选的值', addr: a });
      if ((child.type === 'ref' || child.type === 'refs') && !child.to) issues.push({ level: 'warning', code: 'REF_ANY', message: '没有限定指向哪类实体，任何实体都能填', addr: a });
      if (child.type === 'array' && !child.list && child.of?.type !== 'int' && child.of?.type !== 'number') issues.push({ level: 'warning', code: 'NO_LIST', message: '会变长的列表没有设上限，模型可能一直往里加', addr: a });
      if (child.type === 'record' && !child.entity && !child.keys && !child.list) issues.push({ level: 'warning', code: 'NO_LIST', message: '按名字的字典没有设上限', addr: a });
      if (addr.length === 0 && !display.includes(`"${path}`) && !display.includes(`${path}.`)) issues.push({ level: 'warning', code: 'NOT_IN_LAYOUT', message: '没放进状态栏布局，会显示在「其他」里', addr: a });
      walk(child, a);
    }
  };
  walk(rootNode(draft), []);
  const parents = new Set(Object.values(modules).map(m => m.parent).filter(Boolean) as string[]);
  for (const [name, m] of Object.entries(modules)) {
    if (!used.has(name) && !parents.has(name)) issues.push({ level: 'warning', code: 'MODULE_UNUSED', message: `模块「${m.label ?? name}」没有字段，也没有下级模块`, where: '模块' });
    if (m.parent && !modules[m.parent]) issues.push({ level: 'error', code: 'MODULE_PARENT', message: `模块「${m.label ?? name}」的上级 ${m.parent} 不存在`, where: '模块' });
    if (m.exclusive && !draft.groups?.[m.exclusive]) issues.push({ level: 'warning', code: 'GROUP_LABEL', message: `互斥组 ${m.exclusive} 没有显示名`, where: '模块' });
  }
  // Impact against the published version.
  const before = await fingerprintOf(published);
  const impact: CheckResult['impact'] = !fingerprint || !before ? 'unknown' : fingerprint !== before ? 'structure' : JSON.stringify(draft) === JSON.stringify(published) ? 'none' : 'display';
  let count = 0; const countAll = (n: FieldNode) => { for (const [, c] of childrenOf(n)) { count++; countAll(c); } }; countAll(rootNode(draft));
  return { issues, ...(fingerprint ? { fingerprint } : {}), ...(compiled ? { compiled } : {}), impact, fieldCount: count };
}

/** World-book entries for a description (split when large). */
export function worldEntries(d: StructureDescription, size = 30000): { comment: string; content: string }[] {
  const text = JSON.stringify(d), parts = Math.max(1, Math.ceil(text.length / size));
  return Array.from({ length: parts }, (_, i) => ({
    comment: `[SOLVE:STRUCTURE${parts > 1 ? ` part=${i + 1}/${parts}` : ''}] ${d.label ?? d.id} ${d.version}`,
    content: text.slice(i * size, (i + 1) * size),
  }));
}
/** A script to paste after SOLVE is loaded (card script / dynamic import). */
export function scriptFor(d: StructureDescription): string {
  return `// SOLVE 数据结构：${d.label ?? d.id}（${d.id}@${d.version}），由 SOLVE 结构制作页生成。
// 用法：放在加载 SOLVE 之后（卡内单文件之后，或动态 Import 的 install() 之后）。
// 修改字段、模块或约束后请提高版本号：已有聊天继续用旧版本，新聊天用新版本。
const STRUCTURE = ${JSON.stringify(d, null, 2)};
const host = window.parent.SillyTavern.getContext();
await SOLVE.register(SOLVE.compileStructure(STRUCTURE), { characters: [host.characters[host.characterId].avatar] });
`;
}
