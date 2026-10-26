import { fail } from '../json.js';

const prefixes = { commit: 'c', message: 'm', swipe: 's', session: 't', genesis: 'g', generation: 'e' } as const;
const reverse = Object.fromEntries(Object.entries(prefixes).map(([key, value]) => [value, key]));
function encodeHex(hex: string): string {
  return btoa(String.fromCharCode(...hex.match(/../gu)!.map(byte => parseInt(byte, 16))))
    .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}
function decodeHex(value: string, bytes: number): string {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) fail('STORAGE_TOKEN', '存储编号编码无效');
  let result: string;
  try { result = atob(value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4)); }
  catch { return fail('STORAGE_TOKEN', '存储编号编码无效'); }
  const hex = Array.from(result, char => char.charCodeAt(0).toString(16).padStart(2, '0')).join('');
  if (result.length !== bytes || encodeHex(hex) !== value) fail('STORAGE_TOKEN', '存储编号长度或尾位无效');
  return hex;
}
/** Only identity/checksum fields use this codec; author data and operations remain ordinary JSON. */
export function storeToken(value: string): string {
  const uuid = /^(commit|message|swipe|session|genesis|generation)_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/u.exec(value);
  if (uuid) return `${prefixes[uuid[1] as keyof typeof prefixes]}:${encodeHex(uuid[2]!.replaceAll('-', ''))}`;
  const checksum = /^(model:)?sha256:([0-9a-f]{64})$/u.exec(value);
  if (checksum) return `${checksum[1] ? 'o' : 'h'}:${encodeHex(checksum[2]!)}`;
  return /^(?:[cmstgeho]:|~)/u.test(value) ? '~' + value : value;
}
export function readToken(value: string): string {
  if (typeof value !== 'string') fail('STORAGE_TOKEN', '存储编号必须是字符串');
  if (value.startsWith('~')) return value.slice(1);
  const match = /^([cmstgeho]):(.*)$/u.exec(value);
  if (!match) return value;
  if (match[1] === 'h' || match[1] === 'o') return (match[1] === 'o' ? 'model:' : '') + 'sha256:' + decodeHex(match[2]!, 32);
  const hex = decodeHex(match[2]!, 16);
  return `${reverse[match[1]!]}_${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
