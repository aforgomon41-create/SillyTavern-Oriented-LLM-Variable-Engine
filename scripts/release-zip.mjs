import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';

function valid(name) {
  if (!name || name.startsWith('/') || name.includes('\\') || name.split('/').some(part => part === '..' || part === '.' || !part)) throw new Error('Invalid archive path: ' + name);
}
export function createZip(entries) {
  const body = [], central = []; let offset = 0;
  for (const [path, value] of [...entries].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    valid(path);
    const name = Buffer.from(path), data = Buffer.from(value), compressed = deflateRawSync(data, { level: 9 }), crc = crc32(data);
    if (data.length > 0xffffffff || name.length > 65535) throw new Error('ZIP64 is not supported');
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(8, 8); local.writeUInt16LE(33, 12); local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
    body.push(local, name, compressed);
    const record = Buffer.alloc(46); record.writeUInt32LE(0x02014b50); record.writeUInt16LE(20, 4); record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0x800, 8); record.writeUInt16LE(8, 10); record.writeUInt16LE(33, 14); record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(compressed.length, 20); record.writeUInt32LE(data.length, 24); record.writeUInt16LE(name.length, 28); record.writeUInt32LE(offset, 42);
    central.push(record, name); offset += local.length + name.length + compressed.length;
  }
  const count = central.length / 2, directory = Buffer.concat(central), end = Buffer.alloc(22);
  if (count > 65535 || offset + directory.length > 0xffffffff) throw new Error('ZIP64 is not supported');
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(count, 8); end.writeUInt16LE(count, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...body, directory, end]);
}
export function readZip(input) {
  const zip = Buffer.from(input), end = zip.length - 22, result = new Map();
  if (end < 0 || zip.readUInt32LE(end) !== 0x06054b50) throw new Error('Invalid ZIP end');
  const count = zip.readUInt16LE(end + 10); let cursor = zip.readUInt32LE(end + 16);
  for (let index = 0; index < count; index++) {
    if (zip.readUInt32LE(cursor) !== 0x02014b50) throw new Error('Invalid ZIP entry');
    const size = zip.readUInt32LE(cursor + 20), length = zip.readUInt16LE(cursor + 28), extra = zip.readUInt16LE(cursor + 30), comment = zip.readUInt16LE(cursor + 32);
    const name = zip.subarray(cursor + 46, cursor + 46 + length).toString('utf8'); valid(name);
    if (result.has(name)) throw new Error('Duplicate ZIP entry');
    const offset = zip.readUInt32LE(cursor + 42);
    if (zip.readUInt32LE(offset) !== 0x04034b50 || zip.readUInt16LE(cursor + 10) !== 8) throw new Error('Unsupported ZIP entry');
    const start = offset + 30 + zip.readUInt16LE(offset + 26) + zip.readUInt16LE(offset + 28);
    const data = inflateRawSync(zip.subarray(start, start + size), { maxOutputLength: 64 * 1024 * 1024 });
    if (data.length !== zip.readUInt32LE(cursor + 24) || crc32(data) !== zip.readUInt32LE(cursor + 16)) throw new Error('ZIP CRC mismatch');
    result.set(name, data); cursor += 46 + length + extra + comment;
  }
  return result;
}
