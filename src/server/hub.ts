/**
 * One SyncHub per process (per Vercel Function instance). It owns this
 * instance's sockets, runs room commands through the shared RoomStore, and
 * forwards broadcasts that other instances commit to its local sockets.
 */
import { randomBytes } from 'node:crypto';
import { LIMITS, type ChatMessage, type ClientMessage, type Peer, type Reaction, type RoomState, type ServerMessage, type SyncStatus } from '../shared/protocol';
import { parseRoomId } from '../shared/room';
import { applyCommand, applyTitle, createRoom, isRoomCommand, withHost, type Outcome } from './engine';
import type { Broadcast, CommitResult, Mutator, PresenceRecord, RoomStore } from './store/types';

export const newId = (bytes = 6): string => randomBytes(bytes).toString('base64url');

/** Anything we can push a frame to: a ws socket in production, a stub in tests. */
export interface Connection {
  readonly id: string;
  send(frame: string): void;
}

export const PRESENCE = {
  /** How often an instance re-confirms the peers it holds sockets for. */
  REFRESH_MS: 60_000,
  /** Peers unconfirmed for this long are gone (their instance was recycled or crashed). */
  STALE_MS: 150_000,
} as const;

/**
 * Telemetry fan-out is throttled. Clients REPORT every 2s, but rebroadcasting
 * each one would burn through a hosted Redis command budget for no visible gain.
 */
/** Chat: at most this many messages per listener within the window. */
export const CHAT_LIMIT = { MAX: 5, WINDOW_MS: 5_000 } as const;
/** "Is typing" pings go out at most this often per listener. */
export const TYPING_THROTTLE_MS = 2_000;

/** Plain text, CRLF folded, at most two blank lines in a row, trimmed and cut to length. */
export function normalizeChat(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, LIMITS.CHAT_MAX);
}

/** Reactions: at most this many per listener within the window; extras are dropped silently. */
export const REACTION_LIMIT = { MAX: 6, WINDOW_MS: 3_000 } as const;

export const TELEMETRY = {
  /** Moving into or out of a steady state (locked/tolerant) goes out at most this often. */
  CLASS_CHANGE_MS: 1_000,
  /** Anything else waits at least this long, and only if it moved meaningfully. */
  MIN_INTERVAL_MS: 10_000,
  DRIFT_STEP_MS: 10,
  RTT_STEP_MS: 20,
} as const;

const STEADY: ReadonlySet<SyncStatus> = new Set(['locked', 'tolerant']);

interface LocalPeer {
  conn: Connection;
  roomId: string | null;
  presence: PresenceRecord;
  published: { at: number; status: SyncStatus; driftMs: number | null; rttMs: number | null };
  /** Recent reaction times, for the per-listener rate limit. */
  reactedAt: number[];
  chattedAt: number[];
  typedAt: number;
}

export interface HubOptions {
  store: RoomStore;
  /** Wall-clock server time (ms). Every instance must agree on it, so no monotonic per-process clocks. */
  now?: () => number;
  resolveTitle?: (videoId: string) => Promise<string | null>;
  instanceId?: string;
  onError?: (err: unknown) => void;
}

const cleanName = (raw: string): string => raw.replace(/\s+/g, ' ').trim().slice(0, LIMITS.NAME_MAX) || 'Guest';
const toPeer = ({ lastSeen: _seen, conn: _conn, ...peer }: PresenceRecord): Peer => peer;
const syncFrame = (state: RoomState): string => JSON.stringify({ type: 'SYNC_STATE', state } satisfies ServerMessage);

export class SyncHub {
  readonly instanceId: string;
  private readonly store: RoomStore;
  private readonly now: () => number;
  private readonly resolveTitle: (videoId: string) => Promise<string | null>;
  private readonly onError: (err: unknown) => void;
  private readonly peers = new Map<string, LocalPeer>();
  private readonly rooms = new Map<string, Set<string>>();
  private unsubscribe: (() => void) | null = null;
  private refresher: ReturnType<typeof setInterval> | null = null;

  constructor(opts: HubOptions) {
    this.store = opts.store;
    this.now = opts.now ?? Date.now;
    this.resolveTitle = opts.resolveTitle ?? (async () => null);
    this.instanceId = opts.instanceId ?? newId(8);
    this.onError = opts.onError ?? ((err) => console.error('[sync]', err));
  }

  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.store.subscribe(
      (msg) => this.onBroadcast(msg),
      () => void this.resyncLocalRooms().catch(this.onError),
    );
    this.refresher = setInterval(() => void this.refreshPresence().catch(this.onError), PRESENCE.REFRESH_MS);
    this.refresher.unref?.();
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.refresher) clearInterval(this.refresher);
    this.refresher = null;
  }

  stats(): { rooms: number; peers: number } {
    return { rooms: this.rooms.size, peers: this.peers.size };
  }

  // -------------------------------------------------------------------------
  // Socket lifecycle (driven by attachSocket)
  // -------------------------------------------------------------------------

  connect(conn: Connection): void {
    const now = this.now();
    this.peers.set(conn.id, {
      conn,
      roomId: null,
      presence: { id: conn.id, conn: conn.id, name: 'Guest', joinedAt: now, lastSeen: now, driftMs: null, rttMs: null, status: 'idle' },
      published: { at: 0, status: 'idle', driftMs: null, rttMs: null },
      reactedAt: [],
      chattedAt: [],
      typedAt: 0,
    });
  }

  async disconnect(connId: string): Promise<void> {
    const peer = this.peers.get(connId);
    if (!peer) return;
    this.peers.delete(connId);
    await this.leave(peer);
  }

  /** Every message except PING (the transport answers those without touching shared state). */
  async handle(connId: string, msg: ClientMessage): Promise<void> {
    const peer = this.peers.get(connId);
    if (!peer || msg.type === 'PING') return;
    if (msg.type === 'JOIN_ROOM') return this.join(peer, msg.roomId, msg.username, msg.sessionId);

    // Everything else must target the room this socket actually joined.
    const roomId = peer.roomId;
    if (!roomId || roomId !== msg.roomId) return;
    if (msg.type === 'REPORT') return this.report(peer, roomId, msg);
    if (msg.type === 'REACT') return this.react(peer, roomId, msg.emoji);
    if (msg.type === 'CHAT_SEND') return this.chat(peer, roomId, msg.text);
    if (msg.type === 'TYPING') return this.typing(peer, roomId);
    if (!isRoomCommand(msg)) return;

    // Votes are judged against who is actually here right now.
    const livePeerIds = msg.type === 'VOTE_SKIP' ? (await this.livePeers(roomId)).map((p) => p.id) : undefined;
    let outcome = { kind: 'unchanged', resend: false } as Outcome;
    const result = await this.commit(roomId, (current) => {
      if (!current) return null;
      outcome = applyCommand(current, msg, { now: this.now(), peerName: peer.presence.name, peerId: peer.presence.id, livePeerIds, newId });
      return outcome.kind === 'changed' ? outcome.state : null;
    });

    if (outcome.kind === 'error') return this.sendTo(peer, { type: 'ERROR', message: outcome.message });
    if (outcome.kind === 'unchanged' && outcome.resend && result.state) return peer.conn.send(syncFrame(result.state));
    if (outcome.kind === 'changed' && outcome.resolveTitle) this.fillTitle(roomId, outcome.resolveTitle);
  }

  // -------------------------------------------------------------------------
  // Rooms & presence
  // -------------------------------------------------------------------------

  private async join(peer: LocalPeer, rawRoomId: string, username: string, sessionId?: string): Promise<void> {
    const roomId = parseRoomId(rawRoomId);
    if (!roomId) return this.sendTo(peer, { type: 'ERROR', message: 'Invalid room id.' });
    if (peer.roomId && peer.roomId !== roomId) await this.leave(peer);

    // The tab's session id is its identity in the room, so a reconnect (every 5 min
    // on Vercel Hobby) takes over its own presence entry and keeps host and order.
    const id = sessionId ?? peer.conn.id;
    const now = this.now();
    const previous = (await this.store.listPeers(roomId)).find((p) => p.id === id);
    peer.presence = {
      ...peer.presence,
      id,
      conn: peer.conn.id,
      name: cleanName(username),
      lastSeen: now,
      joinedAt: previous?.joinedAt ?? (peer.roomId === roomId ? peer.presence.joinedAt : now),
    };
    peer.roomId = roomId;
    this.addLocal(roomId, peer.conn.id);
    await this.store.putPeer(roomId, peer.presence);

    const live = await this.livePeers(roomId);
    const result = await this.commit(roomId, (current) => {
      if (!current) return createRoom(roomId, id, now, newId());
      return live.some((p) => p.id === current.hostId) ? null : withHost(current, id);
    });
    // A commit was already delivered to every local socket, the joiner included.
    if (!result.changed && result.state) peer.conn.send(syncFrame(result.state));
    await this.broadcastPeers(roomId, live);
    this.sendTo(peer, { type: 'CHAT_HISTORY', roomId, messages: await this.store.listChat(roomId) });
  }

  private async leave(peer: LocalPeer): Promise<void> {
    const roomId = peer.roomId;
    if (!roomId) return;
    peer.roomId = null;
    this.removeLocal(roomId, peer.conn.id);
    const id = peer.presence.id;
    // Only if this connection still owns the entry: a replacement socket may have taken it over.
    await this.store.removePeer(roomId, id, peer.conn.id);

    const live = await this.livePeers(roomId);
    if (live.some((p) => p.id === id)) return; // reconnected elsewhere: same peer, nothing changed
    if (live.length === 0) return;
    const successor = live[0]!.id;
    await this.commit(roomId, (current) => (current && current.hostId === id ? withHost(current, successor) : null));
    await this.broadcastPeers(roomId, live);
  }

  /** Peers confirmed recently, oldest first. Expired entries are cleaned up on the way. */
  private async livePeers(roomId: string): Promise<PresenceRecord[]> {
    const cutoff = this.now() - PRESENCE.STALE_MS;
    const all = await this.store.listPeers(roomId);
    for (const p of all) if (p.lastSeen < cutoff) void this.store.removePeer(roomId, p.id).catch(this.onError);
    return all.filter((p) => p.lastSeen >= cutoff).sort((a, b) => a.joinedAt - b.joinedAt);
  }

  private async broadcastPeers(roomId: string, live?: PresenceRecord[]): Promise<void> {
    const peers = (live ?? (await this.livePeers(roomId))).map(toPeer);
    await this.fanOut(roomId, { type: 'PEERS', roomId, peers });
  }

  private async report(peer: LocalPeer, roomId: string, msg: Extract<ClientMessage, { type: 'REPORT' }>): Promise<void> {
    const p = peer.presence;
    p.driftMs = msg.driftMs === null ? null : Math.round(msg.driftMs);
    p.rttMs = msg.rttMs === null ? null : Math.round(msg.rttMs);
    p.status = msg.status;

    const last = peer.published;
    const since = this.now() - last.at;
    const classChanged = STEADY.has(p.status) !== STEADY.has(last.status) || (!STEADY.has(p.status) && p.status !== last.status);
    const moved =
      p.status !== last.status ||
      (p.driftMs === null) !== (last.driftMs === null) ||
      Math.abs((p.driftMs ?? 0) - (last.driftMs ?? 0)) >= TELEMETRY.DRIFT_STEP_MS ||
      Math.abs((p.rttMs ?? 0) - (last.rttMs ?? 0)) >= TELEMETRY.RTT_STEP_MS;
    const due = (classChanged && since >= TELEMETRY.CLASS_CHANGE_MS) || (moved && since >= TELEMETRY.MIN_INTERVAL_MS);
    if (!due) return;

    peer.published = { at: this.now(), status: p.status, driftMs: p.driftMs, rttMs: p.rttMs };
    p.lastSeen = this.now();
    // Persist too, so someone joining later gets current numbers in their first PEERS
    // instead of the join-time "idle" (same throttle, so no extra traffic in steady state).
    await Promise.all([this.store.putPeer(roomId, p), this.fanOut(roomId, { type: 'PEER_UPDATE', roomId, peer: toPeer(p) })]);
  }

  private async react(peer: LocalPeer, roomId: string, emoji: Reaction): Promise<void> {
    const now = this.now();
    peer.reactedAt = peer.reactedAt.filter((t) => now - t < REACTION_LIMIT.WINDOW_MS);
    if (peer.reactedAt.length >= REACTION_LIMIT.MAX) return;
    peer.reactedAt.push(now);
    await this.fanOut(roomId, { type: 'REACTION', roomId, id: newId(4), peerId: peer.presence.id, name: peer.presence.name, emoji });
  }

  private async chat(peer: LocalPeer, roomId: string, raw: string): Promise<void> {
    const text = normalizeChat(raw);
    if (!text) return;
    const now = this.now();
    peer.chattedAt = peer.chattedAt.filter((t) => now - t < CHAT_LIMIT.WINDOW_MS);
    if (peer.chattedAt.length >= CHAT_LIMIT.MAX) return this.sendTo(peer, { type: 'ERROR', message: 'Slow down a little — too many messages.' });
    peer.chattedAt.push(now);
    const message: ChatMessage = { id: newId(6), peerId: peer.presence.id, name: peer.presence.name, text, at: now };
    await this.store.appendChat(roomId, message, LIMITS.CHAT_HISTORY);
    await this.fanOut(roomId, { type: 'CHAT', roomId, message });
  }

  private async typing(peer: LocalPeer, roomId: string): Promise<void> {
    const now = this.now();
    if (now - peer.typedAt < TYPING_THROTTLE_MS) return;
    peer.typedAt = now;
    await this.fanOut(roomId, { type: 'TYPING', roomId, peerId: peer.presence.id, name: peer.presence.name });
  }

  private async refreshPresence(): Promise<void> {
    const now = this.now();
    for (const peer of this.peers.values()) {
      if (!peer.roomId) continue;
      peer.presence.lastSeen = now;
      await this.store.putPeer(peer.roomId, peer.presence);
    }
  }

  private fillTitle(roomId: string, videoId: string): void {
    void this.resolveTitle(videoId)
      .then((title) => (title ? this.commit(roomId, (current) => (current ? applyTitle(current, videoId, title) : null)) : undefined))
      .catch(this.onError);
  }

  // -------------------------------------------------------------------------
  // Delivery
  // -------------------------------------------------------------------------

  /** Commit through the store; local sockets get the result immediately, other instances via the store. */
  private async commit(roomId: string, mutate: Mutator): Promise<CommitResult> {
    const result = await this.store.update(roomId, mutate, { origin: this.instanceId, frame: syncFrame });
    if (result.changed && result.state) this.deliverLocal(roomId, syncFrame(result.state));
    return result;
  }

  private async fanOut(roomId: string, msg: ServerMessage): Promise<void> {
    const frame = JSON.stringify(msg);
    this.deliverLocal(roomId, frame);
    await this.store.publish({ roomId, origin: this.instanceId, frame });
  }

  private onBroadcast(msg: Broadcast): void {
    if (msg.origin !== this.instanceId) this.deliverLocal(msg.roomId, msg.frame);
  }

  /** After a (re)subscribe we may have missed broadcasts: push current state to local rooms. */
  private async resyncLocalRooms(): Promise<void> {
    for (const roomId of this.rooms.keys()) {
      const state = await this.store.get(roomId);
      if (state) this.deliverLocal(roomId, syncFrame(state));
      const peers = (await this.livePeers(roomId)).map(toPeer);
      this.deliverLocal(roomId, JSON.stringify({ type: 'PEERS', roomId, peers } satisfies ServerMessage));
    }
  }

  private deliverLocal(roomId: string, frame: string): void {
    for (const id of this.rooms.get(roomId) ?? []) this.peers.get(id)?.conn.send(frame);
  }

  private sendTo(peer: LocalPeer, msg: ServerMessage): void {
    peer.conn.send(JSON.stringify(msg));
  }

  private addLocal(roomId: string, connId: string): void {
    let set = this.rooms.get(roomId);
    if (!set) this.rooms.set(roomId, (set = new Set()));
    set.add(connId);
  }

  private removeLocal(roomId: string, connId: string): void {
    const set = this.rooms.get(roomId);
    set?.delete(connId);
    if (set?.size === 0) this.rooms.delete(roomId);
  }
}
