/**
 * Image generation through the player's own image plugins (docs/image-generation.md).
 *
 * The model writes `imagePrompt` (tags) on entities; this service turns a prompt into a picture through one of the
 * supported plugins, stores the file on the tavern server (user/images/solve-<chat>/) and keeps an index of the
 * pictures per chat in the chat metadata. Pictures are not part of the engine state: they are shown over the
 * entity's `image` / `thumb` by the status bar, so swipes and rerolls never regenerate or lose them.
 */
export type ImagePluginId = 'st' | 'xiaobaix' | 'chatu8' | 'chami' | 'rbq';
export type ImageShape = 'portrait' | 'landscape' | 'square';
export interface ImagePrefs {
  /** Which plugin draws: the first ready one, or a fixed one. */
  plugin: 'auto' | ImagePluginId;
  /** `auto`: draw after each reply for new or changed prompts; `button`: only when the player presses 生成. */
  mode: 'auto' | 'button';
}
export const IMAGE_PREFS = 'solve.images.v1';
export const IMAGE_DEFAULTS: ImagePrefs = { plugin: 'auto', mode: 'button' };
export interface PluginInfo { id: ImagePluginId; label: string; installed: boolean; ready: boolean; note?: string }
export interface ImageVersion { url: string; prompt: string; plugin: ImagePluginId; at: number }
export interface ImageRecord { versions: ImageVersion[]; current: number }
export interface ImageJob { status: 'queued' | 'running' | 'error'; prompt: string; plugin?: ImagePluginId; error?: string; progress?: string }
interface Stored { v: 1; folder: string; entries: Record<string, ImageRecord> }

const META = 'solve_images';
const TIMEOUT = 300_000;
const SIZES: Record<ImageShape, [number, number]> = { portrait: [832, 1216], landscape: [1216, 832], square: [1024, 1024] };
export const PLUGIN_LABELS: Record<ImagePluginId, string> = { st: '酒馆自带图像生成', xiaobaix: '小白X', chatu8: '智绘姬', rbq: 'RBQ 绘图', chami: '酒馆场景插件' };
/** Auto pick order: plugins the player installed on purpose first, the built-in one last. */
const ORDER: ImagePluginId[] = ['xiaobaix', 'rbq', 'chatu8', 'chami', 'st'];

const hash = (text: string) => { let h = 2166136261; for (const c of text) { h ^= c.codePointAt(0)!; h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
const errorText = (e: unknown) => e instanceof Error ? e.message : typeof e === 'string' ? e : JSON.stringify(e);

export class ImageService {
  private jobs = new Map<string, ImageJob>();
  private listeners = new Set<() => void>();
  private queue: Promise<void> = Promise.resolve();
  private controllers = new Map<string, AbortController>();
  constructor(private scope: any) {}

  private ctx(): any { try { return this.scope.SillyTavern?.getContext?.(); } catch { return undefined; } }
  private chatId(): string { return String(this.ctx()?.chatId ?? ''); }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private notify() { for (const l of [...this.listeners]) { try { l(); } catch { /* listener */ } } }

  // ── plugins ──

  plugins(): PluginInfo[] {
    const s = this.scope, ctx = this.ctx();
    const xb = s.xiaobaixDraw;
    let xbStatus: any; try { xbStatus = xb?.getStatus?.(); } catch { xbStatus = undefined; }
    const imagine = !!ctx?.SlashCommandParser?.commands?.imagine;
    const c8 = ctx?.extensionSettings?.['st-chatu8'], chatu8 = !!c8, c8on = chatu8 && String(c8.scriptEnabled) === 'true';
    const rbq = s.RBQ?.api?.generateImage;
    return [
      { id: 'st', label: PLUGIN_LABELS.st, installed: imagine, ready: imagine, ...(imagine ? { note: '用酒馆「图像生成」扩展里配置的后端、画风前缀和负面提示' } : { note: '「图像生成」扩展未启用或仍在加载' }) },
      { id: 'xiaobaix', label: PLUGIN_LABELS.xiaobaix, installed: !!xb, ready: !!xb && xbStatus?.ready !== false && xbStatus?.enabled !== false,
        ...(xb && xbStatus && (!xbStatus.enabled || !xbStatus.ready) ? { note: '小白X 的画图功能未开启或未配置' } : {}) },
      { id: 'chatu8', label: PLUGIN_LABELS.chatu8, installed: chatu8, ready: c8on, ...(chatu8 && !c8on ? { note: '智绘姬没有启用（在它的设置里打开后刷新页面）' } : {}) },
      { id: 'rbq', label: PLUGIN_LABELS.rbq, installed: !!rbq, ready: !!rbq },
      { id: 'chami', label: PLUGIN_LABELS.chami, installed: !!s.TavernScenePlugin, ready: !!s.TavernScenePlugin },
    ];
  }
  /** The plugin that will draw under these preferences, if any. */
  pick(prefs: ImagePrefs): ImagePluginId | undefined {
    const list = this.plugins();
    if (prefs.plugin !== 'auto') return list.find(p => p.id === prefs.plugin)?.installed ? prefs.plugin : undefined;
    return ORDER.find(id => list.find(p => p.id === id)?.ready);
  }

  // ── index (chat metadata) ──

  private stored(create = false): Stored | undefined {
    const meta = this.ctx()?.chatMetadata;
    if (!meta) return undefined;
    const cur = meta[META];
    if (cur && cur.v === 1 && cur.entries) return cur as Stored;
    if (!create) return undefined;
    const fresh: Stored = { v: 1, folder: 'solve-' + hash(this.chatId() || String(Date.now())), entries: {} };
    meta[META] = fresh; return fresh;
  }
  private async save() { try { await this.ctx()?.saveMetadata?.(); } catch { /* reported by the tavern */ } this.notify(); }
  records(): Record<string, ImageRecord> { return this.stored()?.entries ?? {}; }
  record(key: string): ImageRecord | undefined { return this.records()[key]; }
  current(key: string): ImageVersion | undefined { const r = this.record(key); return r?.versions[r.current]; }
  job(key: string): ImageJob | undefined { return this.jobs.get(this.chatId() + '|' + key); }
  async select(key: string, index: number) {
    const r = this.record(key);
    if (!r || !r.versions[index]) return;
    r.current = index; await this.save();
  }
  /** Delete one version (file and entry). */
  async remove(key: string, index: number) {
    const store = this.stored(), r = store?.entries[key];
    if (!r || !r.versions[index]) return;
    const [gone] = r.versions.splice(index, 1);
    if (!r.versions.length) delete store!.entries[key];
    else r.current = Math.min(r.current >= index ? Math.max(0, r.current - 1) : r.current, r.versions.length - 1);
    await this.deleteFile(gone!.url);
    await this.save();
  }
  /** Delete every picture of entities that no longer exist (keys not in `alive`). */
  async prune(alive: Set<string>): Promise<number> {
    const store = this.stored();
    if (!store) return 0;
    let n = 0;
    for (const [key, r] of Object.entries(store.entries)) {
      if (alive.has(key)) continue;
      for (const v of r.versions) { await this.deleteFile(v.url); n++; }
      delete store.entries[key];
    }
    if (n) await this.save();
    return n;
  }
  usage(): { entities: number; pictures: number } {
    const all = Object.values(this.records());
    return { entities: all.length, pictures: all.reduce((n, r) => n + r.versions.length, 0) };
  }

  // ── generation ──

  cancel(key: string) {
    const id = this.chatId() + '|' + key;
    this.controllers.get(id)?.abort();
    if (this.jobs.get(id)?.status !== 'running') { this.jobs.delete(id); this.notify(); }
  }
  dismiss(key: string) { const id = this.chatId() + '|' + key; if (this.jobs.get(id)?.status === 'error') { this.jobs.delete(id); this.notify(); } }
  /** Queue a picture for `key` (an entity path like `characters.lena`). Jobs run one at a time. */
  generate(key: string, prompt: string, shape: ImageShape, prefs: ImagePrefs): void {
    const chat = this.chatId(), id = chat + '|' + key;
    const busy = this.jobs.get(id);
    if (busy && busy.status !== 'error') return;
    const text = prompt.trim();
    if (!text) { this.jobs.set(id, { status: 'error', prompt, error: '还没有提示词' }); this.notify(); return; }
    const job: ImageJob = { status: 'queued', prompt: text };
    this.jobs.set(id, job); this.notify();
    const abort = new AbortController(); this.controllers.set(id, abort);
    this.queue = this.queue.then(async () => {
      if (abort.signal.aborted || this.jobs.get(id) !== job) return;
      const plugin = this.pick(prefs);
      if (!plugin) { this.fail(id, job, prefs.plugin === 'auto' ? '没有可用的生图插件：请安装并配置一个生图插件，或启用酒馆自带的「图像生成」' : `「${PLUGIN_LABELS[prefs.plugin]}」没有安装或未加载`); return; }
      job.status = 'running'; job.plugin = plugin; this.notify();
      try {
        const got = await withTimeout(this.draw(plugin, text, shape, abort.signal, p => { job.progress = p; this.notify(); }), TIMEOUT, abort);
        const url = await this.keep(got, key);
        if (this.chatId() !== chat) { this.jobs.delete(id); return; }  // the chat changed meanwhile: its index is gone
        const store = this.stored(true)!;
        const r = (store.entries[key] ??= { versions: [], current: 0 });
        r.versions.push({ url, prompt: text, plugin, at: Date.now() });
        r.current = r.versions.length - 1;
        this.jobs.delete(id);
        await this.save();
      } catch (e) {
        this.fail(id, job, errorText(e) === '生图超时' || !abort.signal.aborted ? errorText(e) : '已取消');
      } finally { this.controllers.delete(id); }
    });
  }
  private fail(id: string, job: ImageJob, error: string) {
    if (this.jobs.get(id) !== job) return;
    if (error === '已取消') this.jobs.delete(id); else { job.status = 'error'; job.error = error; }
    this.notify();
  }

  /** One picture from one plugin: a server path, a data URL, a Blob or a fetchable URL. */
  private async draw(plugin: ImagePluginId, prompt: string, shape: ImageShape, signal: AbortSignal, progress: (text: string) => void): Promise<string | Blob> {
    const s = this.scope, ctx = this.ctx();
    const [width, height] = SIZES[shape];
    switch (plugin) {
      case 'st': {
        // The built-in extension adds the player's style prefix and negative prompt itself.
        const escaped = prompt.replace(/\\/gu, '\\\\').replace(/\|/gu, '\\|').replace(/\{\{/gu, '{ {').replace(/\{:/gu, '{ :');
        const result = await ctx.executeSlashCommandsWithOptions(`/imagine quiet=true gallery=false ${escaped}`, { handleExecutionErrors: false, handleParserErrors: false });
        if (result?.isError) throw new Error(result.errorMessage || '酒馆图像生成出错');
        const pipe = String(result?.pipe ?? '');
        if (!pipe) throw new Error('酒馆图像生成没有返回图片：请在「图像生成」扩展里选择并配置生图来源');
        return pipe;
      }
      case 'xiaobaix': {
        const out = await s.xiaobaixDraw.generate({ prompt, signal, onProgress: (p: any) => progress(typeof p === 'string' ? p : p?.message ?? p?.stage ?? '') });
        const image = out?.images?.[0];
        if (!image) throw new Error('小白X 没有返回图片');
        return image;
      }
      case 'rbq': {
        const out = await s.RBQ.api.generateImage(prompt, 'plugin', { noChatAttach: true }, (p: any) => progress(typeof p === 'string' ? p : p?.message ?? ''), { signal });
        const image = out?.blob ?? out?.url;
        if (!image) throw new Error('RBQ 没有返回图片');
        return image;
      }
      case 'chatu8': case 'chami': {
        // Both plugins answer the same tavern event (智绘姬 defined it, 酒馆场景插件 follows it).
        const events = ctx?.eventSource;
        if (!events?.emit) throw new Error('酒馆事件接口不可用');
        const id = 'solve_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
        return await new Promise<string>((resolve, reject) => {
          const done = (fn: () => void) => { events.removeListener?.('generate-image-response', on); events.removeListener?.('generate_image_response', on); signal.removeEventListener('abort', stop); fn(); };
          const on = (data: any) => {
            if (data?.id !== id) return;
            done(() => data.success && data.imageData ? resolve(String(data.imageData)) : reject(new Error(data?.error || `${PLUGIN_LABELS[plugin]}生图失败`)));
          };
          const stop = () => done(() => reject(new Error('已取消')));
          events.on('generate-image-response', on); events.on('generate_image_response', on);
          signal.addEventListener('abort', stop);
          void events.emit('generate-image-request', { id, prompt, width, height });
        });
      }
    }
  }
  /** Store a result under user/images/<folder>/ and return its server path. */
  private async keep(got: string | Blob, key: string): Promise<string> {
    // The built-in extension saves into user/images/ itself: move the file into this chat's folder.
    let moved: string | undefined;
    if (typeof got === 'string' && /^\/?user\/images\//u.test(got)) { moved = got.startsWith('/') ? got : '/' + got; got = moved; }
    let blob: Blob;
    if (typeof got === 'string') {
      try { const res = await this.scope.fetch(got); if (!res.ok) throw new Error(String(res.status)); blob = await res.blob(); }
      catch { if (moved) return moved; if (/^https?:/u.test(got)) return got; throw new Error('拿不到生成的图片'); }
    } else blob = got;
    const ctx = this.ctx();
    const format = (/image\/(png|jpe?g|webp|gif)/u.exec(blob.type)?.[1] ?? 'png').replace('jpg', 'jpeg');
    const base64 = await toBase64(blob);
    const folder = this.stored(true)!.folder;
    const filename = key.replace(/[^\w-]+/gu, '_').slice(0, 60) + '_' + Date.now().toString(36);
    const res = await this.scope.fetch('/api/images/upload', { method: 'POST', headers: ctx.getRequestHeaders(), body: JSON.stringify({ image: base64, format, ch_name: folder, filename }) });
    if (!res.ok) throw new Error(`保存图片失败（${res.status}）`);
    const path = String((await res.json())?.path ?? '');
    if (!path) throw new Error('保存图片失败');
    if (moved) await this.deleteFile(moved);
    return path.startsWith('/') ? path : '/' + path;
  }
  private async deleteFile(url: string) {
    if (!/^\/user\/images\//u.test(url)) return;
    try { await this.scope.fetch('/api/images/delete', { method: 'POST', headers: this.ctx().getRequestHeaders(), body: JSON.stringify({ path: url }) }); } catch { /* already gone */ }
  }
}

async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}
function withTimeout<T>(task: Promise<T>, ms: number, abort: AbortController): Promise<T> {
  let timer: any;
  return Promise.race([task, new Promise<T>((_, reject) => { timer = setTimeout(() => { abort.abort(); reject(new Error('生图超时')); }, ms); })]).finally(() => clearTimeout(timer));
}
