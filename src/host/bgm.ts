import { selectBgm, validateTracks } from '../features.js';
import type { BgmSelection } from '../features.js';
import type { BgmTrack, Definition, LogicalState } from '../types.js';

/**
 * Background music for the bound chat. Selection is pure (features.selectBgm);
 * this class only plays it in the tavern page with a short cross-fade.
 * Player preferences and the player's own library live in this browser only.
 */
const STORAGE_KEY = 'solve.bgm.v1';
interface Preferences { enabled: boolean; volume: number; library: BgmTrack[] }
export interface BgmStatus {
  enabled: boolean; volume: number; playing: boolean; blocked: boolean;
  selection: BgmSelection; library: { author: BgmTrack[]; player: BgmTrack[] };
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
  constructor(private scope: any, private source: Source) { this.prefs = this.load(); }

  private load(): Preferences {
    try {
      const raw = JSON.parse(this.scope.localStorage?.getItem(STORAGE_KEY) ?? 'null');
      if (raw && typeof raw === 'object') return { enabled: raw.enabled !== false, volume: clampVolume(raw.volume), library: safeTracks(raw.library) };
    } catch { /* fall back to defaults */ }
    return { enabled: true, volume: 0.5, library: [] };
  }
  private save(): void { try { this.scope.localStorage?.setItem(STORAGE_KEY, JSON.stringify(this.prefs)); } catch { /* private mode */ } }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private notify(): void { for (const listener of this.listeners) { try { listener(); } catch { /* observer only */ } } }

  status(): BgmStatus {
    const author = this.source()?.definition.bgm?.library ?? [];
    return { enabled: this.prefs.enabled, volume: this.prefs.volume, playing: Boolean(this.current && !this.current.paused), blocked: this.blocked,
      selection: { ...this.selection }, library: { author: author.map(t => ({ ...t })), player: this.prefs.library.map(t => ({ ...t })) } };
  }
  setEnabled(enabled: boolean): void { this.prefs.enabled = Boolean(enabled); this.save(); this.sync(); }
  setVolume(volume: number): void { this.prefs.volume = clampVolume(volume); this.save(); if (this.current) this.current.volume = this.prefs.volume; this.notify(); }
  addTracks(tracks: BgmTrack[]): void {
    const valid = validateTracks(tracks);
    const ids = new Set(valid.map(t => t.id));
    this.prefs.library = [...this.prefs.library.filter(t => !ids.has(t.id)), ...valid];
    this.save(); this.sync();
  }
  removeTrack(id: string): void { this.prefs.library = this.prefs.library.filter(t => t.id !== id); this.save(); this.sync(); }

  /** Re-evaluate the selection; switches only when the chosen URL changes. */
  sync(): void {
    let next: BgmSelection = { source: 'none' };
    try { const bound = this.source(); if (bound?.definition.bgm) next = selectBgm(bound.definition, bound.state, this.prefs.library); }
    catch { next = { source: 'none' }; }
    this.selection = next;
    const url = this.prefs.enabled ? next.url : undefined;
    if (url !== this.url) this.switchTo(url);
    this.notify();
  }
  private switchTo(url: string | undefined): void {
    this.url = url;
    const previous = this.current;
    this.current = undefined;
    if (previous) this.fade(previous, 0, () => { previous.pause(); previous.src = ''; });
    if (!url || typeof this.scope.Audio !== 'function') return;
    const audio: HTMLAudioElement = new this.scope.Audio();
    audio.src = url; audio.loop = true; audio.volume = 0; audio.preload = 'auto';
    this.current = audio;
    this.start(audio);
  }
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
