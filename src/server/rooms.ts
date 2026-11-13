import { randomBytes } from 'node:crypto';
import { LIMITS, type ClientMessage, type Peer, type RoomState, type ServerMessage } from '../shared/protocol';
import { applyCommand, applyTitle, createRoom, isRoomCommand, withHost } from './engine';

/** Anything we can push a frame to. Wraps a ws socket in production, a stub in tests. */
export interface Connection {
  readonly id: string;
  send(data: string): void;
}

interface PeerRecord extends Peer {
  conn: Connection;
  roomId: string | null;
}

interface Room {
  state: RoomState;
  peers: Map<string, PeerRecord>;
  emptySince: number | null;
  peersDirty: boolean;
}

export interface RoomManagerOptions {
  /** Server clock in ms. Must be monotonic; defaults to a performance.now()-based wall clock. */
  now?: () => number;
  /** Looks up a track title. Defaults to "unknown". */
  resolveTitle?: (videoId: string) => Promise<string | null>;
  /** How long an empty room keeps its state (so refreshes don't wipe the queue). */
  emptyRoomTtlMs?: number;
}

export const newId = (bytes = 6): string => randomBytes(bytes).toString('base64url');

const cleanName = (raw: string): string =>
  raw.replace(/\s+/g, ' ').trim().slice(0, LIMITS.NAME_MAX) || 'Guest';

export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly peers = new Map<string, PeerRecord>();
  private readonly now: () => number;
  private readonly resolveTitle: (videoId: string) => Promise<string | null>;
  private readonly emptyRoomTtlMs: number;

  constructor(opts: RoomManagerOptions = {}) {
    this.now = opts.now ?? (() => performance.timeOrigin + performance.now());
    this.resolveTitle = opts.resolveTitle ?? (async () => null);
    this.emptyRoomTtlMs = opts.emptyRoomTtlMs ?? 10 * 60_000;
  }

  // -------------------------------------------------------------------------
  // Connection lifecycle
  // -------------------------------------------------------------------------

  connect(conn: Connection): void {
    this.peers.set(conn.id, {
      conn,
      id: conn.id,
      name: 'Guest',
      joinedAt: this.now(),
      roomId: null,
      driftMs: null,
      rttMs: null,
      status: 'idle',
    });
  }

  disconnect(connId: string): void {
    const peer = this.peers.get(connId);
    if (!peer) return;
    this.leaveRoom(peer);
    this.peers.delete(connId);
  }

  handle(connId: string, msg: ClientMessage): void {
    const peer = this.peers.get(connId);
    if (!peer) return;

    if (msg.type === 'PING') {
      this.send(peer, { type: 'PONG', clientTime: msg.clientTime, serverTime: this.now() });
      return;
    }
    if (msg.type === 'JOIN_ROOM') {
      this.join(peer, msg.roomId, msg.username);
      return;
    }

    // Everything else must target the room this socket actually joined.
    const room = peer.roomId === msg.roomId ? this.rooms.get(msg.roomId) : undefined;
    if (!room) return;

    if (msg.type === 'REPORT') {
      peer.driftMs = msg.driftMs === null ? null : Math.round(msg.driftMs);
      peer.rttMs = msg.rttMs === null ? null : Math.round(msg.rttMs);
      peer.status = msg.status;
      room.peersDirty = true;
      return;
    }
    if (!isRoomCommand(msg)) return;

    const out = applyCommand(room.state, msg, { now: this.now(), peerName: peer.name, newId });
    if (out.kind === 'error') return this.error(peer, out.message);
    if (out.kind === 'unchanged') {
      if (out.resend) this.send(peer, { type: 'SYNC_STATE', state: room.state });
      return;
    }
    this.commit(room, out.state, out.queueOnly);
    if (out.resolveTitle) this.fillTitle(room, out.resolveTitle);
  }

  // -------------------------------------------------------------------------
  // Periodic housekeeping (driven by the host process)
  // -------------------------------------------------------------------------

  /** Pushes batched telemetry to rooms whose peer list changed since the last flush. */
  flushPeers(): void {
    for (const room of this.rooms.values()) {
      if (room.peersDirty) this.broadcastPeers(room);
    }
  }

  /** Drops rooms that have been empty for longer than the TTL. */
  sweep(): void {
    const now = this.now();
    for (const [id, room] of this.rooms) {
      if (room.emptySince !== null && now - room.emptySince > this.emptyRoomTtlMs) this.rooms.delete(id);
    }
  }

  stats(): { rooms: number; peers: number } {
    return { rooms: this.rooms.size, peers: this.peers.size };
  }

  getState(roomId: string): RoomState | undefined {
    return this.rooms.get(roomId)?.state;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private join(peer: PeerRecord, rawRoomId: string, username: string): void {
    const roomId = rawRoomId.toLowerCase();
    if (!LIMITS.ROOM_ID.test(roomId)) return this.error(peer, 'Invalid room id.');
    if (peer.roomId && peer.roomId !== roomId) this.leaveRoom(peer);

    let room = this.rooms.get(roomId);
    if (!room) {
      room = { state: createRoom(roomId, peer.id, this.now()), peers: new Map(), emptySince: null, peersDirty: false };
      this.rooms.set(roomId, room);
    }

    peer.name = cleanName(username);
    peer.roomId = roomId;
    peer.joinedAt = this.now();
    room.peers.set(peer.id, peer);
    room.emptySince = null;
    if (!room.peers.has(room.state.hostId)) room.state = withHost(room.state, peer.id) ?? room.state;

    this.send(peer, { type: 'SYNC_STATE', state: room.state });
    this.broadcastPeers(room);
  }

  private leaveRoom(peer: PeerRecord): void {
    const room = peer.roomId ? this.rooms.get(peer.roomId) : undefined;
    peer.roomId = null;
    if (!room) return;
    room.peers.delete(peer.id);
    if (room.peers.size === 0) {
      room.emptySince = this.now();
      return;
    }
    if (room.state.hostId === peer.id) {
      const next = [...room.peers.values()].sort((a, b) => a.joinedAt - b.joinedAt)[0]!;
      const handedOff = withHost(room.state, next.id);
      if (handedOff) this.commit(room, handedOff, false);
    }
    this.broadcastPeers(room);
  }

  /** Fills in missing titles asynchronously and re-broadcasts whatever changed. */
  private fillTitle(room: Room, videoId: string): void {
    void this.resolveTitle(videoId).then((title) => {
      if (!title || this.rooms.get(room.state.roomId) !== room) return;
      const out = applyTitle(room.state, videoId, title);
      if (out) this.commit(room, out.state, out.queueOnly);
    });
  }

  /** Adopts a new state from the engine and broadcasts it. */
  private commit(room: Room, state: RoomState, queueOnly: boolean): void {
    room.state = state;
    if (queueOnly) this.broadcast(room, { type: 'QUEUE_UPDATED', roomId: state.roomId, queue: state.queue });
    else this.broadcast(room, { type: 'SYNC_STATE', state });
  }

  private broadcastPeers(room: Room): void {
    room.peersDirty = false;
    const peers: Peer[] = [...room.peers.values()]
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map(({ id, name, joinedAt, driftMs, rttMs, status }) => ({ id, name, joinedAt, driftMs, rttMs, status }));
    this.broadcast(room, { type: 'PEERS', roomId: room.state.roomId, peers });
  }

  private broadcast(room: Room, msg: ServerMessage): void {
    const frame = JSON.stringify(msg);
    for (const peer of room.peers.values()) peer.conn.send(frame);
  }

  private send(peer: PeerRecord, msg: ServerMessage): void {
    peer.conn.send(JSON.stringify(msg));
  }

  private error(peer: PeerRecord, message: string): void {
    this.send(peer, { type: 'ERROR', message });
  }
}
