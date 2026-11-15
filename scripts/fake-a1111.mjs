// 假的 A1111 生图后端（只为实机验证 /sd 调用链）：txt2img 返回一张按提示词着色的 64×64 PNG，并记下收到的提示词。
import http from 'node:http'; import zlib from 'node:zlib';
const seen = [];
function png(r, g, b) {
  const w = 64, h = 64, raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; } }
  const crc = buf => { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } c = 0xffffffff; for (const v of buf) c = t[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
http.createServer(async (q, r) => {
  let body = ''; for await (const c of q) body += c;
  const json = o => { r.writeHead(200, { 'content-type': 'application/json' }); r.end(JSON.stringify(o)); };
  const p = new URL(q.url, 'http://x').pathname;
  if (p === '/__seen') return json(seen);
  if (p === '/sdapi/v1/txt2img') {
    const b = JSON.parse(body || '{}'); seen.push({ prompt: b.prompt, negative: b.negative_prompt, width: b.width, height: b.height });
    let h = 0; for (const ch of String(b.prompt)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return json({ images: [png(h & 255, (h >> 8) & 255, (h >> 16) & 255).toString('base64')], info: '{}' });
  }
  if (p === '/sdapi/v1/options') return json({ sd_model_checkpoint: 'fake.safetensors' });
  if (p === '/sdapi/v1/sd-models') return json([{ title: 'fake.safetensors', model_name: 'fake' }]);
  if (p === '/sdapi/v1/samplers') return json([{ name: 'Euler a' }]);
  if (p === '/sdapi/v1/schedulers') return json([{ name: 'automatic', label: 'Automatic' }]);
  if (p === '/sdapi/v1/upscalers' || p === '/sdapi/v1/latent-upscale-modes' || p === '/sdapi/v1/sd-vae' || p === '/sdapi/v1/sd-modules') return json([]);
  if (p === '/sdapi/v1/progress') return json({ progress: 0, state: { job_count: 0 } });
  json({});
}).listen(7861, '127.0.0.1', () => console.log('fake a1111 on 7861'));
