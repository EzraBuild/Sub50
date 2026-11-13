import type { Peer, RoomState } from '../../shared/protocol';

/** A peer as stored for presence. `lastSeen` lets other instances drop peers whose instance died. */
export interface PresenceRecord extends Peer {
  /** Server time (ms) the owning instance last confirmed this socket is open. */
  lastSeen: number;
}

/** A frame fanned out to every instance that has sockets in the room. */
export interface Broadcast {
  roomId: string;
  /** Instance that produced the frame. It has already delivered it to its own sockets. */
  origin: string;
  /** A serialized ServerMessage, sent to sockets byte-for-byte. */
  frame: string;
}

/** Returns the next state, or null to leave the room untouched. Must be pure: it may run more than once. */
export type Mutator = (current: RoomState | null) => RoomState | null;

export interface CommitResult {
  /** The committed state, or the current one if nothing changed (null: no such room). */
  state: RoomState | null;
  changed: boolean;
}

/**
 * Where rooms live. The in-memory store serves a single process (`npm run dev`,
 * self-hosting); the Redis store lets many Vercel Function instances share rooms.
 */
export interface RoomStore {
  get(roomId: string): Promise<RoomState | null>;

  /**
   * Applies `mutate` atomically (retrying if another instance committed first).
   * When it commits, `frame(newState)` is broadcast to the other instances in
   * the same atomic step, so every instance sees commits in order.
   */
  update(roomId: string, mutate: Mutator, broadcast: { origin: string; frame: (state: RoomState) => string }): Promise<CommitResult>;

  /** Fan out a frame that isn't tied to a state commit (presence, telemetry). */
  publish(msg: Broadcast): Promise<void>;

  /**
   * Receive every broadcast for every room. `onReady` fires each time the
   * subscription is (re)established, so callers can resync what they missed.
   */
  subscribe(onMessage: (msg: Broadcast) => void, onReady?: () => void): () => void;

  putPeer(roomId: string, peer: PresenceRecord): Promise<void>;
  removePeer(roomId: string, peerId: string): Promise<void>;
  /** Every stored peer for the room, possibly including stale ones (callers filter on `lastSeen`). */
  listPeers(roomId: string): Promise<PresenceRecord[]>;

  close?(): Promise<void>;
}
