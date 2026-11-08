import { clone, fail } from './json.js';
import { captureRestorePath, materializePath, pathProof } from './history-restore.js';
import { PerformanceTrace, measure, measureSync } from './performance.js';
import type { Archive, LogicalState } from './types.js';

interface Checkpoint { commitId: string; sessionId: string; definitionHash: string; genesisId: string; proof: string; state: LogicalState; bytes: number }
export interface VerificationStats { fullRestores: number; checkpointRestores: number; memoryHits: number; verifiedCommits: number; proofChecks: number; checkpoints: number; estimatedBytes: number }
/** In-process certificates, minted only by full or prefix-verified recovery.
 * IDs/hashes supplied by a caller never certify a state. Every reuse checks the
 * actual Genesis, complete ancestor records, definition and authoring snapshot.
 */
export class VerifiedHistory {
  #entries = new Map<string, Checkpoint>();
  #epoch = 0;
  #counts = { fullRestores: 0, checkpointRestores: 0, memoryHits: 0, verifiedCommits: 0, proofChecks: 0 };
  readonly limits: Readonly<{ maxEntries: number; maxBytes: number }>;
  constructor(limits: { maxEntries?: number; maxBytes?: number } = {}, readonly performance = new PerformanceTrace()) {
    this.limits = Object.freeze({ maxEntries: limits.maxEntries ?? 4, maxBytes: limits.maxBytes ?? 8 * 1024 * 1024 });
    for (const value of Object.values(this.limits)) if (!Number.isSafeInteger(value) || value < 0) fail('CACHE_LIMIT', '内存检查点容量必须是非负整数');
    Object.freeze(this);
  }
  getStats(): VerificationStats { return { ...this.#counts, checkpoints: this.#entries.size, estimatedBytes: this.#bytes() }; }
  static recover(history: VerifiedHistory, archive: Archive, targetId: string): Promise<LogicalState> {
    // A cache may come from another valid bundle/realm. Never execute an
    // unfamiliar object's restore method; retain compatibility by checking the
    // complete path locally instead of trusting an unrecognized certificate.
    if (!history || typeof history !== 'object' || !(#entries in history)) return materializePath(captureRestorePath(archive, targetId));
    return history.#restore(archive, targetId);
  }
  clear(): void { this.#epoch++; this.#entries.clear(); }
  #bytes(): number { return [...this.#entries.values()].reduce((sum, entry) => sum + entry.bytes, 0); }
  #touch(key: string, entry: Checkpoint): void {
    this.#entries.delete(key); this.#entries.set(key, entry);
    // A digest can finish after another restore evicts this entry. Reinsertions
    // on hit paths must obey the same budget as newly certified checkpoints.
    while (this.#entries.size > this.limits.maxEntries || this.#bytes() > this.limits.maxBytes) this.#entries.delete(this.#entries.keys().next().value!);
  }
  restore(archive: Archive, targetId: string): Promise<LogicalState> { return this.#restore(archive, targetId); }
  async #restore(archive: Archive, targetId: string): Promise<LogicalState> {
    const epoch = this.#epoch;
    const path = measureSync(this.performance, 'history.capture', () => captureRestorePath(archive, targetId));
    const key = JSON.stringify([path.sessionId, targetId]);
    const proof = async (length = path.chain.length) => {
      this.#counts.proofChecks++;
      return measure(this.performance, 'history.proof', () => pathProof(path, length));
    };
    let targetProof: string | undefined;
    const exact = this.#entries.get(key);
    if (exact && exact.proof === (targetProof = await proof())) {
      if (epoch === this.#epoch) this.#touch(key, exact);
      this.#counts.memoryHits++;
      return clone(exact.state);
    }
    const positions = new Map(path.chain.map((commit, index) => [commit.id, index]));
    const candidates = [...this.#entries.entries()].filter(([, entry]) => entry.sessionId === path.sessionId
      && entry.definitionHash === path.definitionHash && entry.genesisId === path.genesis.id
      && entry.commitId !== targetId && positions.has(entry.commitId))
      .sort((a, b) => positions.get(b[1].commitId)! - positions.get(a[1].commitId)!);
    let start = 0, anchor: LogicalState | undefined;
    for (const [entryKey, entry] of candidates) {
      const length = positions.get(entry.commitId)! + 1;
      if (entry.proof === await proof(length)) {
        if (epoch === this.#epoch) this.#touch(entryKey, entry);
        start = length; anchor = entry.state; break;
      }
    }
    let parentState: LogicalState | undefined;
    const captureParent = this.limits.maxEntries > 1 && start < path.chain.length - 1
      ? (state: LogicalState) => { parentState = clone(state); } : undefined;
    const state = await measure(this.performance, anchor ? 'history.delta' : 'history.full', () => materializePath(path, start, anchor, captureParent));
    if (anchor) this.#counts.checkpointRestores++; else this.#counts.fullRestores++;
    this.#counts.verifiedCommits += path.chain.length - start;
    if (epoch === this.#epoch && this.limits.maxEntries && this.limits.maxBytes) {
      const bytes = new TextEncoder().encode(JSON.stringify(state)).byteLength;
      if (bytes <= this.limits.maxBytes) {
        targetProof ??= await proof();
        if (parentState && epoch === this.#epoch) {
          const parent = path.chain.at(-2)!, parentProof = await proof(path.chain.length - 1);
          const parentBytes = new TextEncoder().encode(JSON.stringify(parentState)).byteLength;
          if (parentBytes + bytes <= this.limits.maxBytes && epoch === this.#epoch) this.#touch(JSON.stringify([path.sessionId, parent.id]), {
            commitId: parent.id, sessionId: path.sessionId, definitionHash: path.definitionHash, genesisId: path.genesis.id,
            proof: parentProof, state: parentState, bytes: parentBytes,
          });
        }
        if (epoch === this.#epoch) {
          const entry: Checkpoint = { commitId: targetId, sessionId: path.sessionId, definitionHash: path.definitionHash,
            genesisId: path.genesis.id, proof: targetProof, state: clone(state), bytes };
          this.#touch(key, entry);
        }
      }
    }
    return state;
  }
}
Object.freeze(VerifiedHistory);
