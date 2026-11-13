import { randomBytes } from 'node:crypto';
import {
  LIMITS,
  SYNC,
  type ClientMessage,
  type Peer,
  type QueueItem,
  type RoomState,
  type ServerMessage,
} from '../shared/protocol';
import { parseYouTubeId } from '../shared/youtube';

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
    const s = room.state;

    switch (msg.type) {
      case 'CHANGE_VIDEO': {
        const videoId = parseYouTubeId(msg.url);
        if (!videoId) return this.error(peer, 'That does not look like a YouTube link.');
        this.startTrack(room, { videoId, title: '', addedBy: peer.name });
        return this.broadcastState(room);
      }

      case 'PLAY': {
        // Already playing: re-sending the state is enough. Letting one (possibly
        // drifted) client re-anchor everyone would cause a room-wide jump.
        if (s.isPlaying || !s.videoId) return this.send(peer, { type: 'SYNC_STATE', state: s });
        s.isPlaying = true;
        s.lastTimestamp = msg.timestamp;
        s.updatedAt = this.now() + SYNC.START_DELAY_MS;
        return this.broadcastState(room);
      }

      case 'PAUSE': {
        if (!s.videoId) return;
        s.isPlaying = false;
        s.lastTimestamp = msg.timestamp;
        s.updatedAt = this.now();
        return this.broadcastState(room);
      }

      case 'SEEK': {
        if (!s.videoId) return;
        s.lastTimestamp = msg.timestamp;
        s.updatedAt = this.now() + (s.isPlaying ? SYNC.START_DELAY_MS : 0);
        return this.broadcastState(room);
      }

      case 'QUEUE_ADD': {
        const videoId = parseYouTubeId(msg.url);
        if (!videoId) return this.error(peer, 'That does not look like a YouTube link.');
        if (s.queue.length >= LIMITS.QUEUE_MAX) return this.error(peer, 'The queue is full.');
        const item: QueueItem = { id: newId(), videoId, title: msg.title?.trim() ?? '', addedBy: peer.name };
        // Nothing playing yet: "+ Queue" should just start the track.
        if (!s.videoId) {
          this.startTrack(room, item);
          return this.broadcastState(room);
        }
        s.queue.push(item);
        this.fillTitle(room, videoId);
        return this.broadcastQueue(room);
      }

      case 'QUEUE_REMOVE': {
        const before = s.queue.length;
        s.queue = s.queue.filter((q) => q.id !== msg.itemId);
        if (s.queue.length === before) return;
        return this.broadcastQueue(room);
      }

      case 'QUEUE_PLAY': {
        const idx = s.queue.findIndex((q) => q.id === msg.itemId);
        if (idx === -1) return;
        const [item] = s.queue.splice(idx, 1);
        this.startTrack(room, item!);
        return this.broadcastState(room);
      }

      case 'TRACK_ENDED': {
        // Every peer reports the end; only the first report for the live track counts.
        if (msg.trackId !== s.trackId || !s.isPlaying) return;
        this.advance(room);
        return this.broadcastState(room);
      }

      case 'REPORT': {
        peer.driftMs = msg.driftMs === null ? null : Math.round(msg.driftMs);
        peer.rttMs = msg.rttMs === null ? null : Math.round(msg.rttMs);
        peer.status = msg.status;
        room.peersDirty = true;
        return;
      }
    }
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
      room = {
        state: {
          roomId,
          videoId: null,
          title: null,
          trackId: null,
          isPlaying: false,
          lastTimestamp: 0,
          updatedAt: this.now(),
          queue: [],
          hostId: peer.id,
          seq: 0,
        },
        peers: new Map(),
        emptySince: null,
        peersDirty: false,
      };
      this.rooms.set(roomId, room);
    }

    peer.name = cleanName(username);
    peer.roomId = roomId;
    peer.joinedAt = this.now();
    room.peers.set(peer.id, peer);
    room.emptySince = null;
    if (!room.peers.has(room.state.hostId)) room.state.hostId = peer.id;

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
      room.state.hostId = next.id;
      this.broadcastState(room);
    }
    this.broadcastPeers(room);
  }

  private startTrack(room: Room, item: Pick<QueueItem, 'videoId' | 'title' | 'addedBy'>): void {
    const s = room.state;
    s.videoId = item.videoId;
    s.title = item.title || null;
    s.trackId = newId();
    s.isPlaying = true;
    s.lastTimestamp = 0;
    s.updatedAt = this.now() + SYNC.TRACK_START_DELAY_MS;
    this.fillTitle(room, item.videoId);
  }

  private advance(room: Room): void {
    const s = room.state;
    const next = s.queue.shift();
    if (next) return this.startTrack(room, next);
    // Queue exhausted: park at the end of the track.
    s.lastTimestamp += Math.max(0, this.now() - s.updatedAt) / 1000;
    s.isPlaying = false;
    s.updatedAt = this.now();
  }

  /** Fills in missing titles asynchronously and re-broadcasts whatever changed. */
  private fillTitle(room: Room, videoId: string): void {
    void this.resolveTitle(videoId).then((title) => {
      if (!title || this.rooms.get(room.state.roomId) !== room) return;
      const s = room.state;
      let stateChanged = false;
      let queueChanged = false;
      if (s.videoId === videoId && !s.title) {
        s.title = title;
        stateChanged = true;
      }
      for (const q of s.queue) {
        if (q.videoId === videoId && !q.title) {
          q.title = title;
          queueChanged = true;
        }
      }
      if (!stateChanged && !queueChanged) return;
      if (stateChanged) this.broadcastState(room);
      else this.broadcastQueue(room);
    });
  }

  private broadcastState(room: Room): void {
    room.state.seq++;
    this.broadcast(room, { type: 'SYNC_STATE', state: room.state });
  }

  private broadcastQueue(room: Room): void {
    this.broadcast(room, { type: 'QUEUE_UPDATED', roomId: room.state.roomId, queue: room.state.queue });
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
