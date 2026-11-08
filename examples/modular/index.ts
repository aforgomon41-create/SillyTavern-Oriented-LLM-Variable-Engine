import { compileAuthorDefinition } from '../../src/index.js';
import { structure, topology } from './structure.js';
import { worldInfo } from './world-info.js';

export { structure, topology, worldInfo };
export function compileWorldInfoExample() {
  return compileAuthorDefinition(structure, { parts: [topology], worldInfo });
}
