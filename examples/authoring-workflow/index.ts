import { compileAuthorDefinition } from '../../src/index.js';
import { workflowStructure } from './structure.js';
import { workflowFacet } from './facets.js';
import { workflowWorldInfo } from './world-info.js';
export const workflowBase = { ...workflowStructure, facets: [workflowFacet] };
export { workflowWorldInfo, workflowFacet };
export function compileInlineWorkflowExample() { return compileAuthorDefinition(workflowBase, { worldInfo: workflowWorldInfo }); }
