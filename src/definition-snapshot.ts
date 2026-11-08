import { z } from 'zod';
import { assertJson, canonical, clone, fail, hash } from './json.js';
import { compile } from './schema.js';
import { compose } from './authoring.js';
import type { Archive, CompiledDefinition, Data, Definition, DefinitionBindings, DefinitionSnapshot } from './types.js';
import type { DefinitionFragment } from './authoring.js';
import { describeGuideRules, sameGuideRule } from './guides.js';
import type { GuideRule } from './types.js';
import { sameFacet } from './facets.js';

const fields = ['initialData', 'entities', 'refs', 'modules', 'numeric', 'readonly', 'internal', 'guide', 'guides', 'templates', 'prefabs', 'runtimeBindings'] as const;
const shape = z.strictObject({ version: z.literal(1), baseHash: z.string().min(1), fingerprint: z.string().min(1),
  declaration: z.record(z.string(), z.unknown()), views: z.array(z.string()), customValidation: z.boolean(),
  books: z.array(z.string().min(1)), digest: z.string().min(1) });

export async function verifyDefinitionSnapshot(value: unknown, expectedFingerprint: string): Promise<DefinitionSnapshot> {
  try { assertJson(value); } catch { fail('DEFINITION_SNAPSHOT_INVALID', '聊天中的作者声明快照不是有效 JSON'); }
  const parsed = shape.safeParse(value);
  if (!parsed.success) fail('DEFINITION_SNAPSHOT_INVALID', '聊天中的作者声明快照结构无效');
  const snapshot = parsed.data as DefinitionSnapshot;
  if (Object.keys(snapshot.declaration).some(key => !fields.includes(key as typeof fields[number])) || !Object.hasOwn(snapshot.declaration, 'initialData'))
    fail('DEFINITION_SNAPSHOT_INVALID', '作者声明快照包含未知字段或缺少开局声明');
  const { digest, ...body } = snapshot;
  if (snapshot.fingerprint !== expectedFingerprint || digest !== await hash(body))
    fail('DEFINITION_SNAPSHOT_INVALID', '聊天中的作者声明快照校验不符，不能写入或重放');
  const initialHash = (snapshot.declaration.runtimeBindings as any)?.authoring?.initialDataHash;
  if (initialHash !== undefined && initialHash !== await hash(snapshot.declaration.initialData))
    fail('DEFINITION_SNAPSHOT_INVALID', '作者声明快照的开局数据与固定绑定不一致');
  return clone(snapshot);
}

export async function assertDefinitionSnapshotUnchanged(before: Archive | undefined, after: Archive | undefined): Promise<void> {
  if (after?.authoring) await verifyDefinitionSnapshot(after.authoring, after.definitionHash);
  if (before && canonical(before.authoring ?? null) !== canonical(after?.authoring ?? null))
    fail('DEFINITION_SNAPSHOT_CHANGED', '聊天的固定作者声明不能通过保存替换或删除，请使用原包恢复');
}

/** Store declarations once in the archive header; executable code stays in the original author package. */
export async function captureDefinitionSnapshot(base: Definition, compiled: CompiledDefinition, books: string[]): Promise<DefinitionSnapshot> {
  const original = await compile(base), names = Object.keys(original.views ?? {}).sort();
  if (compiled.validateState !== original.validateState || Object.keys(compiled.views ?? {}).length !== names.length
    || names.some(name => compiled.views?.[name] !== original.views?.[name]))
    fail('DEFINITION_SNAPSHOT_FUNCTION', '自动世界书接入要求视图与校验函数固定在基础作者包中');
  const declaration: Data = {};
  if ((compiled.facets?.length ?? 0) !== (original.facets?.length ?? 0)
    || compiled.facets?.some(facet => !original.facets?.some(bound => sameFacet(bound, facet))))
    fail('DEFINITION_SNAPSHOT_FUNCTION', '自动世界书接入要求Facet及其运行时函数固定在基础作者包中');
  for (const rule of compiled.guides ?? []) if (typeof rule.when === 'function') {
    const bound = original.guides?.find(value => value.id === rule.id);
    if (!bound || !sameGuideRule(bound, rule)) fail('DEFINITION_SNAPSHOT_FUNCTION', '指南函数必须固定在基础作者包中：' + rule.id);
  }
  for (const key of fields) if (compiled[key] !== undefined) {
    if (key === 'guides') { declaration.guides = describeGuideRules(compiled.guides, true); continue; }
    assertJson(compiled[key]); declaration[key] = clone(compiled[key]);
  }
  const body = { version: 1 as const, baseHash: original.fingerprint, fingerprint: compiled.fingerprint,
    declaration, views: names, customValidation: Boolean(original.validateState), books: [...books] };
  return { ...body, digest: await hash(body) };
}

/** Rebuild from archived declarations without reading live books or invoking author collectors/macros. */
export async function restoreDefinitionSnapshot(base: Definition, value: unknown, expectedFingerprint: string): Promise<CompiledDefinition> {
  const snapshot = await verifyDefinitionSnapshot(value, expectedFingerprint), original = await compile(base);
  if (original.fingerprint !== snapshot.baseHash || JSON.stringify(Object.keys(original.views ?? {}).sort()) !== JSON.stringify(snapshot.views)
    || Boolean(original.validateState) !== snapshot.customValidation)
    fail('DEFINITION_PACKAGE_MISMATCH', '旧聊天需要原版本的基础作者包，不能替换为当前版本');
  const { runtimeBindings, guides: savedGuides, ...declaration } = snapshot.declaration;
  let restoredGuides: GuideRule[] | undefined;
  if (savedGuides !== undefined) {
    if (!Array.isArray(savedGuides)) fail('DEFINITION_SNAPSHOT_INVALID', '固定指南必须是数组');
    restoredGuides = savedGuides.map((value: any) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) fail('DEFINITION_SNAPSHOT_INVALID', '固定指南格式无效');
      if (value.when !== null && typeof value.when === 'object') {
        if (Object.keys(value.when).length !== 1 || value.when.binding !== value.id) fail('DEFINITION_SNAPSHOT_INVALID', '指南函数绑定格式无效');
        const bound = original.guides?.find(rule => rule.id === value.id);
        if (!bound || typeof bound.when !== 'function') fail('DEFINITION_PACKAGE_MISMATCH', '旧聊天缺少原指南函数：' + value.id);
        return { ...value, when: bound.when };
      }
      return value;
    });
  }
  const clean: Definition = { ...original, initialData: {}, entities: [], refs: [], modules: {}, numeric: {},
    readonly: [], internal: [], guide: '', guides: [], templates: {}, prefabs: {},
    runtimeBindings: runtimeBindings as unknown as DefinitionBindings | undefined };
  const compiled = await compile(compose(clean, { source: '聊天内固定作者声明', definition: { ...declaration, ...(restoredGuides ? { guides: restoredGuides } : {}) } as DefinitionFragment }));
  if (compiled.fingerprint !== expectedFingerprint) fail('DEFINITION_SNAPSHOT_INVALID', '固定声明重建出的定义与聊天指纹不一致');
  compiled.authoringSnapshot = snapshot;
  return compiled;
}
