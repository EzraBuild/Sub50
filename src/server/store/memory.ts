import type { RoomState } from '../../shared/protocol';
import type { Broadcast, CommitResult, Mutator, PresenceRecord, RoomStore } from './types';

interface Entry {
  state: RoomState;
  touchedAt: number;
}

export interface MemoryStoreOptions {
  /** Drop rooms nobody has touched for this long. */
  roomTtlMs?: number;
  now?: () => number;
}

/**
 * Single-process store. Several hubs may share one instance, which is how the
 * tests stand in for several Vercel Function instances sharing Redis.
 */
export class MemoryStore implements RoomStore {
  private readonly rooms = new Map<string, Entry>();
  private readonly peers = new Map<string, Map<string, PresenceRecord>>();
  private readonly listeners = new Set<(msg: Broadcast) => void>();
  private readonly ttl: number;
  private readonly now: () => number;
  private readonly sweeper: ReturnType<typeof setInterval>;

  constructor(opts: MemoryStoreOptions = {}) {
    this.ttl = opts.roomTtlMs ?? 6 * 60 * 60_000;
    this.now = opts.now ?? Date.now;
    this.sweeper = setInterval(() => this.sweep(), 10 * 60_000);
    this.sweeper.unref?.();
  }

  async get(roomId: string): Promise<RoomState | null> {
    return this.live(roomId)?.state ?? null;
  }

  async update(roomId: string, mutate: Mutator, broadcast: { origin: string; frame: (s: RoomState) => string }): Promise<CommitResult> {
    for (;;) {
      const before = this.live(roomId)?.state ?? null;
      const next = mutate(before && structuredClone(before));
      if (!next) return { state: before, changed: false };
      // Yield like a network round trip would, so concurrent updates really interleave.
      await Promise.resolve();
      const now = this.live(roomId)?.state ?? null;
      if (now !== before) continue; // someone else committed first: re-run on fresh state
      this.rooms.set(roomId, { state: next, touchedAt: this.now() });
      this.emit({ roomId, origin: broadcast.origin, frame: broadcast.frame(next) });
      return { state: next, changed: true };
    }
  }

  async publish(msg: Broadcast): Promise<void> {
    this.emit(msg);
  }

  subscribe(onMessage: (msg: Broadcast) => void, onReady?: () => void): () => void {
    this.listeners.add(onMessage);
    if (onReady) queueMicrotask(onReady);
    return () => this.listeners.delete(onMessage);
  }

  async putPeer(roomId: string, peer: PresenceRecord): Promise<void> {
    let room = this.peers.get(roomId);
    if (!room) this.peers.set(roomId, (room = new Map()));
    room.set(peer.id, { ...peer });
    const entry = this.rooms.get(roomId);
    if (entry) entry.touchedAt = this.now();
  }

  async removePeer(roomId: string, peerId: string, conn?: string): Promise<void> {
    const room = this.peers.get(roomId);
    if (conn !== undefined && room?.get(peerId)?.conn !== conn) return;
    room?.delete(peerId);
    if (room?.size === 0) this.peers.delete(roomId);
  }

  async listPeers(roomId: string): Promise<PresenceRecord[]> {
    return [...(this.peers.get(roomId)?.values() ?? [])].map((p) => ({ ...p }));
  }

  async close(): Promise<void> {
    clearInterval(this.sweeper);
    this.listeners.clear();
  }

  // -------------------------------------------------------------------------

  private emit(msg: Broadcast): void {
    for (const fn of this.listeners) fn(msg);
  }

  private live(roomId: string): Entry | undefined {
    const entry = this.rooms.get(roomId);
    if (entry && this.now() - entry.touchedAt > this.ttl && !this.peers.has(roomId)) {
      this.rooms.delete(roomId);
      return undefined;
    }
    return entry;
  }

  private sweep(): void {
    for (const id of this.rooms.keys()) this.live(id);
  }
}
