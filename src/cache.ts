import { clone, fail, hash } from './json.js';
import { archiveProof, restore } from './history.js';
import type { Archive, LogicalState } from './types.js';

interface Snapshot { commitId: string; stateHash: string; state: LogicalState; definitionHash: string; proof: string }
function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
}
export class IndexedDbCache {
  private db?: IDBDatabase;
  constructor(private factory: IDBFactory = indexedDB, private name = 'solve-cache-v05') {}
  async open(): Promise<void> {
    if (this.db) return;
    const r = this.factory.open(this.name, 1);
    r.onupgradeneeded = () => { for (const name of ['snapshots', 'pending']) if (!r.result.objectStoreNames.contains(name)) r.result.createObjectStore(name); };
    this.db = await request(r);
    this.db.onversionchange = () => this.close();
  }
  private async transaction<T>(store: string, mode: IDBTransactionMode, operation: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    await this.open();
    const tx = this.db!.transaction(store, mode);
    const done = new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('缓存事务失败')); });
    try {
      const result = await request(operation(tx.objectStore(store)));
      await done; return result;
    } catch (error) {
      try { tx.abort(); } catch { /* already completed/aborted */ }
      await done.catch(() => undefined);
      throw error;
    }
  }
  async put(archive: Archive, commitId: string, state: LogicalState): Promise<void> {
    const commit = archive.commits[commitId];
    if (!commit || await hash(state) !== commit.stateHash) fail('CACHE_STATE_MISMATCH', '快照与提交不符');
    await restore(archive, commitId); // certify the authority before creating a reusable proof
    const proof = await archiveProof(archive, commitId);
    await this.transaction('snapshots', 'readwrite', s => s.put({ commitId, stateHash: commit.stateHash, state: clone(state), definitionHash: archive.definitionHash, proof } satisfies Snapshot, `${archive.sessionId}:${commitId}`));
  }
  async restore(archive: Archive, commitId: string): Promise<LogicalState> {
    try {
      const cached = await this.transaction<Snapshot | undefined>('snapshots', 'readonly', s => s.get(`${archive.sessionId}:${commitId}`));
      const commit = archive.commits[commitId];
      if (cached && commit && cached.proof === await archiveProof(archive, commitId) && cached.definitionHash === archive.definitionHash && cached.stateHash === commit.stateHash && await hash(cached.state) === commit.stateHash) return clone(cached.state);
    } catch { /* A cache failure must not make a valid chat unrecoverable. */ }
    return restore(archive, commitId);
  }
  async savePending(sessionId: string, drafts: unknown): Promise<void> { await this.transaction('pending', 'readwrite', s => s.put(clone(drafts), sessionId)); }
  async loadPending<T>(sessionId: string): Promise<T | undefined> { return this.transaction('pending', 'readonly', s => s.get(sessionId)); }
  async clear(): Promise<void> { for (const store of ['snapshots', 'pending']) await this.transaction(store, 'readwrite', s => s.clear()); }
  close(): void { this.db?.close(); this.db = undefined; }
}
