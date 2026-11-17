import { selectBgm, validateTracks } from '../features.js';
import type { BgmSelection } from '../features.js';
import type { BgmTrack, Definition, LogicalState } from '../types.js';

/**
 * Background music for the bound chat. Selection is pure (features.selectBgm);
 * this class plays it in the tavern page with a short cross-fade.
 *
 * Library (this browser):
 *   · 默认曲库 — public-domain recordings hosted on the jsDelivr CDN (reachable without a proxy), listed by an
 *     external manifest; fetched once and cached, read-only. Can be turned off.
 *   · 我的曲目 — tracks the player added (any audio link); their tags (`moods`) are free text, mood names among them
 *     drive the automatic choice.
 *   · 合集 — named lists of track ids (from either), adjustable any time. What plays is chosen from one source:
 *     the default library, everything, or one collection. The card author's library always joins.
 * When a mood-chosen piece ends, the next piece of the same mood plays (place / region music loops).
 */
const STORAGE_KEY = 'solve.bgm.v1';
const DEFAULT_CACHE = 'solve.bgm.default.v1';
/** The default library's manifest (pinned commit: the files never change under a published link). */
export const DEFAULT_LIBRARY_URL = 'https://testingcf.jsdelivr.net/gh/aforgomon41-create/sillytavern-kami-preset@cd1b0dd/solve/music/v1/library.json';
export const DEFAULT_PREFIX = 'solve:';
export interface BgmCollection { id: string; name: string; tracks: string[] }
/** Where the mood-chosen music comes from. */
export type BgmSource = 'default' | 'all' | string;
interface Preferences { enabled: boolean; volume: number; library: BgmTrack[]; collections: BgmCollection[]; active: BgmSource; defaults: boolean }
export interface DefaultTrack extends BgmTrack { composer?: string; work?: string; performer?: string; seconds?: number }
export interface BgmStatus {
  enabled: boolean; volume: number; playing: boolean; blocked: boolean;
  selection: BgmSelection; library: { author: BgmTrack[]; player: BgmTrack[]; defaults: DefaultTrack[] };
  collections: BgmCollection[]; active: BgmSource; useDefaults: boolean;
  /** Default library: loading / ready / failed (with the reason). */
  defaultsState: { state: 'off' | 'loading' | 'ready' | 'failed'; error?: string; credit?: string };
  /** Tracks the current source picks from (mood choice). */
  pool: number;
}
type Source = () => { definition: Definition; state: LogicalState } | undefined;

export class BgmPlayer {
  private prefs: Preferences;
  private current?: HTMLAudioElement;
  private url?: string;
  private selection: BgmSelection = { source: 'none' };
  private blocked = false;
  private fades = new Set<ReturnType<typeof setInterval>>();
  private unlock?: () => void;
  private listeners = new Set<() => void>();
  private defaults: DefaultTrack[] = [];
  private defaultsState: BgmStatus['defaultsState'] = { state: 'off' };
  private loading?: Promise<void>;
  /** Advances when a mood piece ends (next piece of that mood); reset to a random start when the mood changes. */
  private seed = 0;
  private mood?: string;
  constructor(private scope: any, private source: Source, private manifestUrl = typeof scope.__SOLVE_BGM_MANIFEST__ === 'string' ? scope.__SOLVE_BGM_MANIFEST__ : DEFAULT_LIBRARY_URL) {
    this.prefs = this.load();
    if (this.prefs.defaults) this.loadDefaults();
  }

  private load(): Preferences {
    const base: Preferences = { enabled: true, volume: 0.5, library: [], collections: [], active: 'default', defaults: true };
    try {
      const raw = JSON.parse(this.scope.localStorage?.getItem(STORAGE_KEY) ?? 'null');
      if (raw && typeof raw === 'object') {
        const library = safeTracks(raw.library);
        return {
          enabled: raw.enabled !== false, volume: clampVolume(raw.volume), library,
          collections: safeCollections(raw.collections), defaults: raw.defaults !== false,
          // Players from before collections: their own tracks keep playing alongside the default library.
          active: typeof raw.active === 'string' ? raw.active : library.length ? 'all' : 'default',
        };
      }
    } catch { /* fall back to defaults */ }
    return base;
  }
  private save(): void { try { this.scope.localStorage?.setItem(STORAGE_KEY, JSON.stringify(this.prefs)); } catch { /* private mode */ } }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private notify(): void { for (const listener of this.listeners) { try { listener(); } catch { /* observer only */ } } }

  /** Default library: cached copy first (works offline), then the manifest. */
  private loadDefaults(): void {
    if (this.loading) return;
    try {
      const cached = JSON.parse(this.scope.localStorage?.getItem(DEFAULT_CACHE) ?? 'null');
      if (cached?.url === this.manifestUrl && Array.isArray(cached.tracks)) { this.defaults = cached.tracks; this.defaultsState = { state: 'ready', credit: cached.credit }; return; }
    } catch { /* fetch below */ }
    if (typeof this.scope.fetch !== 'function') return;
    this.defaultsState = { state: 'loading' };
    this.loading = (async () => {
      try {
        const response = await this.scope.fetch(this.manifestUrl, { cache: 'force-cache' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const manifest = await response.json();
        const base = this.manifestUrl.replace(/[^/]*$/u, '');
        const tracks: DefaultTrack[] = (Array.isArray(manifest?.tracks) ? manifest.tracks : []).filter((t: any) => t && typeof t.id === 'string' && typeof t.file === 'string' && Array.isArray(t.tags))
          .map((t: any) => ({ id: DEFAULT_PREFIX + t.id, url: /^https?:/u.test(t.file) ? t.file : base + t.file, title: String(t.title ?? t.id), moods: t.tags.map(String),
            ...(t.composer ? { composer: String(t.composer) } : {}), ...(t.work ? { work: String(t.work) } : {}), ...(t.performer ? { performer: String(t.performer) } : {}), ...(Number.isFinite(t.seconds) ? { seconds: t.seconds } : {}) }));
        if (!tracks.length) throw new Error('清单是空的');
        this.defaults = tracks;
        const credit = typeof manifest.credit === 'string' ? manifest.credit : undefined;
        this.defaultsState = { state: 'ready', ...(credit ? { credit } : {}) };
        try { this.scope.localStorage?.setItem(DEFAULT_CACHE, JSON.stringify({ url: this.manifestUrl, tracks, credit })); } catch { /* quota */ }
      } catch (error) {
        this.defaultsState = { state: 'failed', error: error instanceof Error ? error.message : String(error) };
      } finally { this.loading = undefined; this.sync(); }
    })();
  }

  /** Everything playable: default library (when on), the player's tracks. */
  private all(): BgmTrack[] { return [...(this.prefs.defaults ? this.defaults : []), ...this.prefs.library]; }
  /** Tracks the active source picks from for the mood. */
  private pool(): BgmTrack[] {
    const all = this.all(), active = this.prefs.active;
    if (active === 'all') return all;
    if (active === 'default') return this.prefs.defaults ? this.defaults : this.prefs.library;
    const c = this.prefs.collections.find(x => x.id === active);
    if (!c) return all;
    const byId = new Map(all.map(t => [t.id, t]));
    return c.tracks.map(id => byId.get(id)).filter((t): t is BgmTrack => !!t);
  }

  status(): BgmStatus {
    const author = this.source()?.definition.bgm?.library ?? [];
    return { enabled: this.prefs.enabled, volume: this.prefs.volume, playing: Boolean(this.current && !this.current.paused), blocked: this.blocked,
      selection: { ...this.selection }, library: { author: author.map(t => ({ ...t })), player: this.prefs.library.map(t => ({ ...t })), defaults: this.prefs.defaults ? this.defaults.map(t => ({ ...t })) : [] },
      collections: this.prefs.collections.map(c => ({ ...c, tracks: [...c.tracks] })), active: this.prefs.active, useDefaults: this.prefs.defaults,
      defaultsState: this.prefs.defaults ? { ...this.defaultsState } : { state: 'off' }, pool: this.pool().length };
  }
  setEnabled(enabled: boolean): void { this.prefs.enabled = Boolean(enabled); this.save(); this.sync(); }
  setVolume(volume: number): void { this.prefs.volume = clampVolume(volume); this.save(); if (this.current) this.current.volume = this.prefs.volume; this.notify(); }
  setUseDefaults(on: boolean): void {
    this.prefs.defaults = Boolean(on);
    if (!on && this.prefs.active === 'default') this.prefs.active = 'all';
    this.save(); if (on) this.loadDefaults(); this.sync();
  }
  setActive(source: BgmSource): void { this.prefs.active = source; this.save(); this.seed = Math.floor(Math.random() * 1000); this.sync(); }
  /** Plays another piece of the same mood. */
  next(): void { this.seed++; this.sync(); }
  addTracks(tracks: BgmTrack[], into: string[] = []): void {
    const valid = validateTracks(tracks);
    const ids = new Set(valid.map(t => t.id));
    this.prefs.library = [...this.prefs.library.filter(t => !ids.has(t.id)), ...valid];
    if (into.length) this.prefs.collections = this.prefs.collections.map(c => into.includes(c.id) ? { ...c, tracks: [...new Set([...c.tracks, ...ids])] } : c);
    this.save(); this.sync();
  }
  updateTrack(id: string, patch: { title?: string; moods?: string[] }): void {
    this.prefs.library = this.prefs.library.map(t => t.id !== id ? t : { ...t, ...(patch.title !== undefined ? (patch.title ? { title: patch.title } : {}) : {}), ...(patch.moods ? { moods: [...new Set(patch.moods.map(m => m.trim()).filter(Boolean))] } : {}) });
    if (patch.title === '') this.prefs.library = this.prefs.library.map(t => { if (t.id !== id) return t; const { title: _t, ...rest } = t; return rest; });
    this.save(); this.sync();
  }
  removeTrack(id: string): void {
    this.prefs.library = this.prefs.library.filter(t => t.id !== id);
    this.prefs.collections = this.prefs.collections.map(c => ({ ...c, tracks: c.tracks.filter(x => x !== id) }));
    this.save(); this.sync();
  }
  /** New collection (optionally with tracks); returns its id. */
  createCollection(name: string, tracks: string[] = []): string {
    const id = 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    this.prefs.collections = [...this.prefs.collections, { id, name: name.trim() || '未命名合集', tracks: [...new Set(tracks)] }];
    this.save(); this.sync(); return id;
  }
  renameCollection(id: string, name: string): void { this.prefs.collections = this.prefs.collections.map(c => c.id === id ? { ...c, name: name.trim() || c.name } : c); this.save(); this.notify(); }
  deleteCollection(id: string): void {
    this.prefs.collections = this.prefs.collections.filter(c => c.id !== id);
    if (this.prefs.active === id) this.prefs.active = this.prefs.defaults ? 'default' : 'all';
    this.save(); this.sync();
  }
  /** Adds (or with remove, takes out) tracks of a collection. */
  setInCollection(id: string, tracks: string[], remove = false): void {
    this.prefs.collections = this.prefs.collections.map(c => c.id !== id ? c : { ...c, tracks: remove ? c.tracks.filter(x => !tracks.includes(x)) : [...new Set([...c.tracks, ...tracks])] });
    this.save(); this.sync();
  }
  /** Plays one track now (preview), until the scene changes or it ends. */
  preview(id: string): void {
    const track = this.all().find(t => t.id === id); if (!track) return;
    this.previewing = track;
    this.selection = { track, url: track.url, source: 'mood', mood: '试听' };
    this.switchTo(track.url, false); this.notify();
  }
  private previewing?: BgmTrack;

  /** Re-evaluate the selection; switches only when the chosen URL changes. */
  sync(): void {
    let next: BgmSelection = { source: 'none' };
    try {
      const bound = this.source();
      if (bound?.definition.bgm) {
        const probe = selectBgm(bound.definition, bound.state, this.all(), { moodPool: this.pool() });
        // A new mood starts at a random piece; the same mood keeps its seed (stable across re-renders).
        if (probe.source === 'mood' && probe.mood !== this.mood) { this.mood = probe.mood; this.seed = Math.floor(Math.random() * 1000); }
        next = probe.source === 'mood' ? selectBgm(bound.definition, bound.state, this.all(), { moodPool: this.pool(), seed: this.seed }) : probe;
      }
    } catch { next = { source: 'none' }; }
    if (this.previewing && this.current && !this.current.ended && this.url === this.previewing.url) { this.notify(); return; }
    this.previewing = undefined;
    this.selection = next;
    const url = this.prefs.enabled ? next.url : undefined;
    if (url !== this.url) this.switchTo(url, next.source !== 'mood');
    this.notify();
  }
  private switchTo(url: string | undefined, loop = true): void {
    this.url = url;
    const previous = this.current;
    this.current = undefined;
    if (previous) this.fade(previous, 0, () => { previous.pause(); previous.src = ''; });
    if (!url || typeof this.scope.Audio !== 'function') return;
    const audio: HTMLAudioElement = new this.scope.Audio();
    audio.src = url; audio.loop = loop; audio.volume = 0; audio.preload = 'auto';
    // Mood music moves on to the next piece of the mood; a lone piece starts over.
    if (!loop) audio.addEventListener?.('ended', () => { if (this.current !== audio) return; this.previewing = undefined; this.seed++; this.url = undefined; this.sync(); });
    audio.addEventListener?.('error', () => { if (this.current === audio) { this.failed = url; this.notify(); } });
    this.failed = undefined;
    this.current = audio;
    this.start(audio);
  }
  /** URL that failed to load (shown in settings). */
  failed?: string;
  private start(audio: HTMLAudioElement): void {
    const played = audio.play();
    const ok = () => { if (this.current !== audio) return; this.blocked = false; this.fade(audio, this.prefs.volume); this.notify(); };
    if (!played || typeof played.then !== 'function') { ok(); return; }
    played.then(ok, (error: any) => {
      if (this.current !== audio) return;
      // Browsers block sound until the user interacts with the page once.
      if (error?.name === 'NotAllowedError') { this.blocked = true; this.waitForGesture(); }
      this.notify();
    });
  }
  private waitForGesture(): void {
    if (this.unlock || !this.scope.document) return;
    const doc = this.scope.document;
    const retry = () => { this.unlock?.(); if (this.current && this.current.paused) this.start(this.current); };
    doc.addEventListener('pointerdown', retry, true); doc.addEventListener('keydown', retry, true);
    this.unlock = () => { doc.removeEventListener('pointerdown', retry, true); doc.removeEventListener('keydown', retry, true); this.unlock = undefined; };
  }
  private fade(audio: HTMLAudioElement, to: number, done?: () => void): void {
    const from = audio.volume, steps = 15;
    let i = 0;
    const timer = setInterval(() => {
      i++;
      audio.volume = Math.max(0, Math.min(1, from + (to - from) * (i / steps)));
      if (i >= steps) { clearInterval(timer); this.fades.delete(timer); done?.(); }
    }, 100);
    this.fades.add(timer);
  }
  dispose(): void {
    for (const timer of this.fades) clearInterval(timer);
    this.fades.clear(); this.unlock?.();
    if (this.current) { this.current.pause(); this.current.src = ''; }
    this.current = undefined; this.url = undefined; this.listeners.clear();
  }
}
function clampVolume(value: unknown): number { return typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5; }
function safeTracks(value: unknown): BgmTrack[] { try { return validateTracks(value); } catch { return []; } }
function safeCollections(value: unknown): BgmCollection[] {
  if (!Array.isArray(value)) return [];
  return value.filter((c: any) => c && typeof c.id === 'string' && typeof c.name === 'string' && Array.isArray(c.tracks))
    .map((c: any) => ({ id: c.id, name: c.name, tracks: c.tracks.filter((x: unknown) => typeof x === 'string') }));
}
