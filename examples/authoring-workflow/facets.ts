import type { SolveFacet } from '../../src/index.js';
/** A metadata collector plus a derived display field. Neither writes official state. */
export const workflowFacet: SolveFacet = {
  id: 'workflow-labels', version: '1',
  collectInlineMeta: (_schema, context) => typeof context.metadata.label === 'string' ? { guide: `${context.path}：${context.metadata.label}` } : undefined,
  parseWorldInfo: entry => entry.tag === 'WORKFLOW_NOTE' ? { guide: entry.content } : undefined,
  runtimeHooks: {
    afterCompile: context => { if (!context.fingerprint) throw new Error('缺少编译身份'); },
    beforeProjection: context => ({ ...context.data, displayMode: context.view }),
  },
};
