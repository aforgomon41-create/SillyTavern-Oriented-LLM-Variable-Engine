import { assertJson, canonical, clone, fail } from './json.js';
import type { SolveFacet } from './authoring.js';
import type { Batch, Commit, CompiledDefinition, Data, Json, LogicalState } from './types.js';

export interface FacetProjectionContext { facetId: string; view: string; paths?: string[]; data: Data }
export interface FacetCommitContext {
  facetId: string; commit: Commit; state: LogicalState; sessionId: string;
  submit(operations: Batch, options?: { actionId?: string }): Promise<Commit>;
}
export interface FacetCompileContext { fingerprint: string; ir: Json }
export interface FacetRuntimeHooks {
  afterCompile?(context: Readonly<FacetCompileContext>): void | Promise<void>;
  beforeProjection?(context: Readonly<FacetProjectionContext>): Data | void;
  onStateCommitted?(context: Readonly<FacetCommitContext>): void | Promise<void>;
}
export interface FacetDispatch {
  submit?(operations: Batch, parent: Commit, chain: string[], actionId: string): Promise<Commit>;
  onError?(error: unknown): void;
}
export function sameFacet(left: SolveFacet, right: SolveFacet): boolean {
  const record = (facet: SolveFacet) => ({ id: facet.id, version: facet.version, build: facet.build ?? null, dependencies: facet.dependencies ?? null });
  return canonical(record(left)) === canonical(record(right))
    && (['extendZod','collectInlineMeta','registerDetached','parseWorldInfo'] as const).every(key => left[key] === right[key])
    && (['afterCompile','beforeProjection','onStateCommitted'] as const).every(key => left.runtimeHooks?.[key] === right.runtimeHooks?.[key]);
}
export function copyFacets(facets: SolveFacet[] = []): SolveFacet[] {
  if (!Array.isArray(facets)) fail('FACET_VERSION', 'facets必须是数组');
  return facets.map(facet => {
    if (!facet || typeof facet !== 'object') fail('FACET_VERSION', 'Facet需要对象与固定id/version');
    const { runtimeHooks, dependencies, ...body } = facet;
    for (const key of ['extendZod','collectInlineMeta','registerDetached','parseWorldInfo'] as const) if (body[key] !== undefined && typeof body[key] !== 'function') fail('FACET_METHOD', `${facet.id}：${key}必须是函数`);
    if (runtimeHooks && Object.keys(runtimeHooks).some(key => !['afterCompile','beforeProjection','onStateCommitted'].includes(key))) fail('FACET_METHOD', facet.id + '：未知运行时Hook');
    if (runtimeHooks && Object.values(runtimeHooks).some(fn => typeof fn !== 'function')) fail('FACET_METHOD', facet.id + '：Hook必须是函数');
    if (dependencies !== undefined) assertJson(dependencies);
    const freeze = (value: any): any => { if (value && typeof value === 'object') { for (const item of Object.values(value)) freeze(item); Object.freeze(value); } return value; };
    return Object.freeze({ ...body, ...(dependencies !== undefined ? { dependencies: freeze(clone(dependencies)) } : {}), ...(runtimeHooks ? { runtimeHooks: Object.freeze({ ...runtimeHooks }) } : {}) });
  });
}
export function describeFacetHooks(facets: SolveFacet[] = []) {
  return facets.filter(facet => Object.keys(facet.runtimeHooks ?? {}).length).map(facet => ({ id: facet.id, hooks: Object.keys(facet.runtimeHooks!).sort() }));
}
function syncResult(value: unknown, label: string): void {
  if (value && typeof (value as any).then === 'function') { void Promise.resolve(value).catch(() => undefined); fail('FACET_ASYNC_PROJECTION', label + '：同步视图不支持异步Hook'); }
}
export function projectFacets(def: CompiledDefinition, data: Data, view: string, paths?: string[]): Data {
  let result = data;
  for (const facet of def.facets ?? []) if (facet.runtimeHooks?.beforeProjection) {
    try {
      const value = facet.runtimeHooks.beforeProjection(Object.freeze({ facetId: facet.id, view, ...(paths ? { paths: [...paths] } : {}), data: clone(result) }));
      syncResult(value, facet.id); if (value !== undefined) {
        assertJson(value); if (!value || typeof value !== 'object' || Array.isArray(value)) fail('FACET_PROJECTION', 'beforeProjection需要返回对象或undefined');
        result = clone(value);
      }
    } catch (error) { fail('FACET_PROJECTION', facet.id + '：' + (error instanceof Error ? error.message : String(error))); }
  }
  return result;
}
export async function notifyCommitted(def: CompiledDefinition, commit: Commit, state: LogicalState, sessionId: string, dispatch: FacetDispatch): Promise<void> {
  const value = (commit.actions.at(-1)?.authorInputs as any)?.solveFacetChain;
  const chain: string[] = Array.isArray(value) && value.every(id => typeof id === 'string') ? [...value] : [];
  for (const facet of def.facets ?? []) {
    if (!facet.runtimeHooks?.onStateCommitted || chain.includes(facet.id)) continue;
    let sequence = 0;
    const context: FacetCommitContext = { facetId: facet.id, commit: clone(commit), state: clone(state), sessionId,
      submit(operations, options = {}) {
        if (!dispatch.submit) return Promise.reject(new Error('当前运行宿主未提供Hook操作提交入口'));
        return dispatch.submit(clone(operations), clone(commit), [...chain, facet.id], options.actionId ?? `facet:${facet.id}:${commit.id}:${sequence++}`);
      } };
    try { await facet.runtimeHooks.onStateCommitted(Object.freeze(context)); }
    catch (error) { try { dispatch.onError?.(new Error(`Facet ${facet.id} 保存后Hook失败：${error instanceof Error ? error.message : String(error)}`)); } catch { /* observer cannot undo a confirmed commit */ } }
  }
}
