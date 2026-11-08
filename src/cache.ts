import { clone, fail, hash } from './json.js';
import { archiveProof } from './history.js';
import type { Archive, LogicalState } from './types.js';
import { VerifiedHistory } from './verified-history.js';

interface Snapshot { commitId: string; stateHash: string; state: LogicalState; definitionHash: string; proof: string }
interface SnapshotMetadata { key: string; sessionId: string; bytes: number; usedAt: number }
export interface CacheLimits { maxSnapshots?: number; maxBytes?: number; maxSnapshotsPerSession?: number }
export interface CacheStats { snapshots: number; estimatedBytes: number; pendingSessions: number; limits: Required<CacheLimits> }
const defaults: Required<CacheLimits> = { maxSnapshots: 64, maxBytes: 32 * 1024 * 1024, maxSnapshotsPerSession: 4 };
const snapshotStores = ['snapshots', 'snapshotMetadata'];
function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
}
const isQuotaError = (error: unknown): boolean => typeof error === 'object' && error !== null && 'name' in error && error.name === 'QuotaExceededError';
/** Rebuildable snapshots have bounded capacity. Pending drafts are never evicted. */
export class IndexedDbCache {
  private history = new VerifiedHistory();
  private db?: IDBDatabase;
  private opening?: Promise<void>;
  readonly limits: Readonly<Required<CacheLimits>>;
  lastRestoreSource: 'snapshot' | 'archive' = 'archive';
  constructor(private factory: IDBFactory = indexedDB, private name = 'solve-cache-v05', limits: CacheLimits = {}) {
    const values = { ...defaults, ...limits };
    for (const value of Object.values(values)) if (!Number.isSafeInteger(value) || value < 0) fail('CACHE_LIMIT', '缓存容量必须是非负整数');
    this.limits = Object.freeze(values);
  }
  async open(): Promise<void> {
    if (this.db) return;
    if (this.opening) return this.opening;
    this.opening = (async () => {
      const r = this.factory.open(this.name, 2);
      r.onupgradeneeded = () => {
        for (const store of [...snapshotStores, 'pending']) if (!r.result.objectStoreNames.contains(store)) r.result.createObjectStore(store);
        // Legacy snapshots have no size/recency metadata. Only rebuild these; preserve drafts.
        r.transaction!.objectStore('snapshots').clear();
      };
      this.db = await new Promise<IDBDatabase>((resolve, reject) => {
        let blocked = false;
        r.onerror = () => reject(r.error);
        r.onblocked = () => { blocked = true; reject(new Error('旧标签页占用缓存，请刷新旧标签页后重试；聊天归档仍可恢复')); };
        r.onsuccess = () => { if (blocked) r.result.close(); else resolve(r.result); };
      });
      this.db.onversionchange = () => this.close();
    })();
    try { await this.opening; } finally { this.opening = undefined; }
  }
  private async transaction<T>(stores: string | string[], mode: IDBTransactionMode, operation: (tx: IDBTransaction) => Promise<T>): Promise<T> {
    await this.open();
    const tx = this.db!.transaction(stores, mode);
    const done = new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('缓存事务失败')); });
    try {
      const result = await operation(tx);
      await done; return result;
    } catch (error) {
      try { tx.abort(); } catch { /* already completed/aborted */ }
      await done.catch(() => undefined);
      throw error;
    }
  }
  private async single<T>(store: string, mode: IDBTransactionMode, operation: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    return this.transaction(store, mode, tx => request(operation(tx.objectStore(store))));
  }
  private enforce(tx: IDBTransaction, rows: SnapshotMetadata[]): void {
    rows.sort((a, b) => b.usedAt - a.usedAt || a.key.localeCompare(b.key));
    let count = 0, bytes = 0;
    const sessions = new Map<string, number>();
    for (const row of rows) {
      const sessionCount = sessions.get(row.sessionId) ?? 0;
      if (count >= this.limits.maxSnapshots || sessionCount >= this.limits.maxSnapshotsPerSession || bytes + row.bytes > this.limits.maxBytes) {
        tx.objectStore('snapshots').delete(row.key); tx.objectStore('snapshotMetadata').delete(row.key);
      } else { count++; bytes += row.bytes; sessions.set(row.sessionId, sessionCount + 1); }
    }
  }
  async pruneSnapshots(): Promise<void> {
    await this.transaction(snapshotStores, 'readwrite', async tx => {
      this.enforce(tx, await request<SnapshotMetadata[]>(tx.objectStore('snapshotMetadata').getAll()));
    });
  }
  private async reclaimAndRetry(task: () => Promise<void>): Promise<void> {
    try { await task(); }
    catch (error) {
      if (!isQuotaError(error)) throw error;
      // Reclaim only expendable snapshots, including when a draft needs room.
      await this.clearSnapshots(); await task();
    }
  }
  async put(archive: Archive, commitId: string, state: LogicalState, history = this.history): Promise<void> {
    // Freeze caller input before the first await so certification cannot race a mutation.
    const authority = clone(archive), candidate = clone(state), commit = authority.commits[commitId];
    if (!commit || await hash(candidate) !== commit.stateHash) fail('CACHE_STATE_MISMATCH', '快照与提交不符');
    if (!this.limits.maxSnapshots || !this.limits.maxBytes || !this.limits.maxSnapshotsPerSession) return;
    await VerifiedHistory.recover(history, authority, commitId);
    const snapshot: Snapshot = { commitId, stateHash: commit.stateHash, state: candidate, definitionHash: authority.definitionHash, proof: await archiveProof(authority, commitId) };
    const key = `${authority.sessionId}:${commitId}`, bytes = new TextEncoder().encode(JSON.stringify(snapshot) + key).byteLength;
    if (bytes > this.limits.maxBytes) return;
    await this.reclaimAndRetry(() => this.transaction(snapshotStores, 'readwrite', async tx => {
      const metadata = tx.objectStore('snapshotMetadata'), rows = await request<SnapshotMetadata[]>(metadata.getAll());
      const row = { key, sessionId: authority.sessionId, bytes, usedAt: Math.max(Date.now(), ...rows.map(item => item.usedAt + 1)) };
      tx.objectStore('snapshots').put(snapshot, key); metadata.put(row, key);
      this.enforce(tx, [...rows.filter(item => item.key !== key), row]);
    }));
  }
  async restore(archive: Archive, commitId: string, history = this.history): Promise<LogicalState> {
    const authority = clone(archive);
    try {
      const key = `${authority.sessionId}:${commitId}`;
      const cached = await this.single<Snapshot | undefined>('snapshots', 'readonly', s => s.get(key)), commit = authority.commits[commitId];
      if (cached && commit && cached.commitId === commitId && cached.proof === await archiveProof(authority, commitId) && cached.definitionHash === authority.definitionHash && cached.stateHash === commit.stateHash && await hash(cached.state) === commit.stateHash) {
        try {
          await this.transaction(snapshotStores, 'readwrite', async tx => {
            const store = tx.objectStore('snapshotMetadata'), rows = await request<SnapshotMetadata[]>(store.getAll()), row = rows.find(item => item.key === key);
            if (row) { row.usedAt = Math.max(Date.now(), ...rows.map(item => item.usedAt + 1)); store.put(row, key); this.enforce(tx, rows); }
          });
        } catch { /* Bookkeeping cannot invalidate a verified restore. */ }
        this.lastRestoreSource = 'snapshot'; return clone(cached.state);
      }
    } catch { /* A cache failure must not make a valid chat unrecoverable. */ }
    this.lastRestoreSource = 'archive'; return VerifiedHistory.recover(history, authority, commitId);
  }
  async savePending(sessionId: string, drafts: unknown): Promise<void> {
    const value = clone(drafts);
    if (Array.isArray(value) && !value.length) { await this.single('pending', 'readwrite', s => s.delete(sessionId)); return; }
    await this.reclaimAndRetry(async () => { await this.single('pending', 'readwrite', s => s.put(value, sessionId)); });
  }
  async loadPending<T>(sessionId: string): Promise<T | undefined> { return this.single('pending', 'readonly', s => s.get(sessionId)); }
  async getStats(): Promise<CacheStats> {
    return this.transaction(['snapshotMetadata', 'pending'], 'readonly', async tx => {
      const [rows, pendingSessions] = await Promise.all([request<SnapshotMetadata[]>(tx.objectStore('snapshotMetadata').getAll()), request(tx.objectStore('pending').count())]);
      return { snapshots: rows.length, estimatedBytes: rows.reduce((sum, row) => sum + row.bytes, 0), pendingSessions, limits: { ...this.limits } };
    });
  }
  async clearSnapshots(): Promise<void> {
    await this.transaction(snapshotStores, 'readwrite', async tx => { await Promise.all(snapshotStores.map(store => request(tx.objectStore(store).clear()))); });
  }
  /** Explicitly clears snapshots AND drafts. Capacity cleanup must use clearSnapshots. */
  async clear(): Promise<void> {
    await this.transaction([...snapshotStores, 'pending'], 'readwrite', async tx => { await Promise.all([...snapshotStores, 'pending'].map(store => request(tx.objectStore(store).clear()))); });
  }
  close(): void { this.db?.close(); this.db = undefined; this.history.clear(); }
}
