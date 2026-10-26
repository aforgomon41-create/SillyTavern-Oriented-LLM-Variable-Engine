import { jsonrepair } from 'jsonrepair';
import { assertJson, fail } from './json.js';
import { OPERATORS } from './engine.js';
import type { Batch } from './types.js';

const TAGS = ['solve_operate', 'solve_mutual_operate'] as const;
export function parseOperations(text: string): Batch {
  if (text.length > 1_000_000) fail('OPERATIONS_TOO_LARGE', '指令块超过 1 MB');
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { try { parsed = JSON.parse(jsonrepair(text)); } catch { fail('INVALID_JSON', '操作 JSON 无法解析'); } }
  assertJson(parsed);
  function check(batch: unknown, depth: number): void {
    if (depth > 8) fail('GROUP_DEPTH', '原子组最多嵌套 8 层');
    const objects = Array.isArray(batch) ? batch : [batch];
    for (const object of objects) {
      if (!object || typeof object !== 'object' || Array.isArray(object)) fail('INVALID_BATCH', '操作必须为对象或有序对象数组');
      if (Object.keys(object).some(k => !OPERATORS.includes(k as any))) fail('UNKNOWN_OPERATOR', '未知算子');
      if (Object.hasOwn(object, '$group')) {
        const g = (object as any).$group;
        if (!Array.isArray(g) || !g.length) fail('INVALID_GROUP', '$group 必须是非空操作数组');
        check(g, depth + 1);
      }
    }
  }
  check(parsed, 0);
  return parsed as Batch;
}
export function extractBlocks(text: string): { model?: Batch; mutual?: Batch } {
  const raw = extractRawBlocks(text);
  return { ...(raw.model ? { model: parseOperations(raw.model) } : {}), ...(raw.mutual ? { mutual: parseOperations(raw.mutual) } : {}) };
}
export function extractRawBlocks(text: string): { model?: string; mutual?: string } {
  const out: { model?: string; mutual?: string } = {};
  for (const tag of TAGS) {
    const opens = [...text.matchAll(new RegExp(`<${tag}>`, 'gu'))];
    const closes = [...text.matchAll(new RegExp(`</${tag}>`, 'gu'))];
    if (!opens.length && !closes.length) continue;
    if (opens.length !== 1 || closes.length !== 1 || opens[0]!.index! >= closes[0]!.index!) fail('INCOMPLETE_BLOCK', `${tag} 必须完整且唯一`);
    const body = text.slice(opens[0]!.index! + tag.length + 2, closes[0]!.index!);
    if (/<\/?solve_(?:mutual_)?operate>/u.test(body)) fail('NESTED_BLOCK', '操作块不能嵌套');
    out[tag === 'solve_operate' ? 'model' : 'mutual'] = body;
  }
  return out;
}
export function stripBlocks(text: string): string {
  // Complete blocks only: an incomplete streaming block must not be treated as executable.
  return text.replace(/<solve_(mutual_)?operate>[\s\S]*?<\/solve_\1operate>/gu, '').trimEnd();
}
