/**
 * Rooms in Upstash Redis, shared by every Vercel Function instance.
 *
 *   {prefix}:room:{id}   room state JSON (TTL refreshed on every commit)
 *   {prefix}:peers:{id}  hash peerId → presence JSON (TTL refreshed on every put)
 *   {prefix}:ch:{id}     pub/sub channel carrying Broadcast envelopes
 *
 * Commits are a compare-and-swap on (epoch, seq) inside a Lua script that also
 * PUBLISHes the new state, so every instance sees commits atomically and in
 * order. REST (@upstash/redis) rather than TCP: it works from Functions and
 * from networks that block port 6379.
 */
import { Redis } from '@upstash/redis';
import type { ChatMessage, RoomState } from '../../shared/protocol';
import type { Broadcast, CommitResult, Mutator, PresenceRecord, RoomStore } from './types';

const CAS_SCRIPT = `
local cur = redis.call('GET', KEYS[1])
local version = ''
if cur then
  local s = cjson.decode(cur)
  version = s.epoch .. ':' .. s.seq
end
if version ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'EX', tonumber(ARGV[3]))
redis.call('PUBLISH', KEYS[2], ARGV[4])
return 1
`;

// Remove a presence entry only if the given connection still owns it.
const REMOVE_PEER_SCRIPT = `
local cur = redis.call('HGET', KEYS[1], ARGV[1])
if not cur then return 0 end
if ARGV[2] ~= '' and cjson.decode(cur).conn ~= ARGV[2] then return 0 end
return redis.call('HDEL', KEYS[1], ARGV[1])
`;

export interface RedisStoreOptions {
  url?: string;
  token?: string;
  /** Key namespace, so tests (or several apps) can share one database. */
  prefix?: string;
  roomTtlSeconds?: number;
  peersTtlSeconds?: number;
  /** How often to prove the subscription is alive by sending ourselves a ping. */
  subscriptionCheckMs?: number;
  /** Abort (and retry) a command that hasn't answered in this long. */
  requestTimeoutMs?: number;
  onError?: (err: unknown) => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const versionOf = (s: RoomState | null) => (s ? `${s.epoch}:${s.seq}` : '');

function isBroadcast(v: unknown): v is Broadcast {
  const b = v as Broadcast;
  return !!b && typeof b.roomId === 'string' && typeof b.origin === 'string' && typeof b.frame === 'string';
}

export class RedisStore implements RoomStore {
  private readonly redis: Redis;
  private readonly streams: Redis;
  private readonly prefix: string;
  private readonly roomTtl: number;
  private readonly peersTtl: number;
  private readonly checkMs: number;
  private readonly onError: (err: unknown) => void;
  private readonly cas;
  private readonly removePeerScript;
  private readonly closers = new Set<() => void>();

  constructor(opts: RedisStoreOptions = {}) {
    const url = opts.url ?? process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
    const token = opts.token ?? process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) throw new Error('RedisStore needs KV_REST_API_URL and KV_REST_API_TOKEN (Vercel Marketplace: Upstash).');
    // Frames are already JSON strings; keep them byte-for-byte.
    const base = { url, token, automaticDeserialization: false, enableTelemetry: false } as const;
    // Commands get a per-request timeout (then the client's own retry kicks in), so one
    // hung request can't stall a socket's command chain. The pub/sub stream is meant to
    // stay open indefinitely, so it uses a separate client without one.
    this.redis = new Redis({ ...base, signal: () => AbortSignal.timeout(opts.requestTimeoutMs ?? 8_000) });
    this.streams = new Redis(base);
    this.prefix = opts.prefix ?? 'sub50';
    this.roomTtl = opts.roomTtlSeconds ?? 6 * 60 * 60;
    this.peersTtl = opts.peersTtlSeconds ?? 60 * 60;
    this.checkMs = opts.subscriptionCheckMs ?? 30_000;
    this.onError = opts.onError ?? ((err) => console.error('[redis]', err));
    this.cas = this.redis.createScript<number | string>(CAS_SCRIPT);
    this.removePeerScript = this.redis.createScript<number | string>(REMOVE_PEER_SCRIPT);
  }

  private roomKey = (id: string) => `${this.prefix}:room:${id}`;
  private peersKey = (id: string) => `${this.prefix}:peers:${id}`;
  private channel = (id: string) => `${this.prefix}:ch:${id}`;
  private chatKey = (id: string) => `${this.prefix}:chat:${id}`;

  async get(roomId: string): Promise<RoomState | null> {
    const raw = await this.redis.get<string>(this.roomKey(roomId));
    return raw ? (JSON.parse(raw) as RoomState) : null;
  }

  async update(roomId: string, mutate: Mutator, broadcast: { origin: string; frame: (s: RoomState) => string }): Promise<CommitResult> {
    for (let attempt = 0; attempt < 10; attempt++) {
      const before = await this.get(roomId);
      const next = mutate(before);
      if (!next) return { state: before, changed: false };
      const envelope: Broadcast = { roomId, origin: broadcast.origin, frame: broadcast.frame(next) };
      if (await this.tryCommit(roomId, before, next, envelope)) return { state: next, changed: true };
      await sleep(5 + Math.random() * 20 * (attempt + 1)); // another instance won: back off, retry on fresh state
    }
    throw new Error(`Room ${roomId}: update kept conflicting`);
  }

  /**
   * One compare-and-swap attempt: writes `next` and publishes `envelope` only if
   * the stored room is still exactly `before` (same epoch and seq).
   */
  async tryCommit(roomId: string, before: RoomState | null, next: RoomState, envelope: Broadcast): Promise<boolean> {
    const ok = await this.cas.exec(
      [this.roomKey(roomId), this.channel(roomId)],
      [versionOf(before), JSON.stringify(next), String(this.roomTtl), JSON.stringify(envelope)],
    );
    return Number(ok) === 1;
  }

  async publish(msg: Broadcast): Promise<void> {
    await this.redis.publish(this.channel(msg.roomId), JSON.stringify(msg));
  }

  subscribe(onMessage: (msg: Broadcast) => void, onReady?: () => void): () => void {
    const pattern = `${this.prefix}:ch:*`;
    const probeChannel = `${this.prefix}:ch:__probe__:${Math.random().toString(36).slice(2)}`;
    let stopped = false;
    let sub: ReturnType<Redis['psubscribe']> | null = null;
    let lastProbeSeen = Date.now();
    let backoff = 500;

    const open = () => {
      if (stopped) return;
      const s = this.streams.psubscribe<string>([pattern]);
      sub = s;
      s.on('psubscribe', () => {
        backoff = 500;
        lastProbeSeen = Date.now();
        onReady?.();
      });
      s.on('pmessage', ({ channel, message }) => {
        if (channel === probeChannel) {
          lastProbeSeen = Date.now();
          return;
        }
        try {
          const msg: unknown = typeof message === 'string' ? JSON.parse(message) : message;
          if (isBroadcast(msg)) onMessage(msg);
        } catch (err) {
          this.onError(err);
        }
      });
      s.on('error', (err) => {
        this.onError(err);
        reopen();
      });
    };

    const reopen = () => {
      const old = sub;
      sub = null;
      old?.removeAllListeners();
      void old?.unsubscribe().catch(() => {});
      if (stopped) return;
      setTimeout(open, backoff);
      backoff = Math.min(backoff * 2, 10_000);
    };

    // Streams can die without an error event. Ping ourselves; if the ping never
    // comes back, the subscription is dead: reopen it (onReady then resyncs).
    const watchdog = setInterval(() => {
      if (!sub) return;
      if (Date.now() - lastProbeSeen > this.checkMs * 2.5) return reopen();
      void this.redis.publish(probeChannel, '1').catch(this.onError);
    }, this.checkMs);
    watchdog.unref?.();

    open();
    const close = () => {
      stopped = true;
      clearInterval(watchdog);
      reopen();
      this.closers.delete(close);
    };
    this.closers.add(close);
    return close;
  }

  async putPeer(roomId: string, peer: PresenceRecord): Promise<void> {
    const key = this.peersKey(roomId);
    await this.redis.multi().hset(key, { [peer.id]: JSON.stringify(peer) }).expire(key, this.peersTtl).exec();
  }

  async removePeer(roomId: string, peerId: string, conn?: string): Promise<void> {
    await this.removePeerScript.exec([this.peersKey(roomId)], [peerId, conn ?? '']);
  }

  async listPeers(roomId: string): Promise<PresenceRecord[]> {
    const all = await this.redis.hgetall<Record<string, string>>(this.peersKey(roomId));
    if (!all) return [];
    const peers: PresenceRecord[] = [];
    for (const raw of Object.values(all)) {
      try {
        peers.push(JSON.parse(String(raw)) as PresenceRecord);
      } catch {
        /* skip a corrupt entry rather than failing the whole room */
      }
    }
    return peers;
  }

  async appendChat(roomId: string, message: ChatMessage, keep: number): Promise<void> {
    const key = this.chatKey(roomId);
    // Newest first in Redis; capped and expiring with the room.
    await this.redis.multi().lpush(key, JSON.stringify(message)).ltrim(key, 0, keep - 1).expire(key, this.roomTtl).exec();
  }

  async listChat(roomId: string): Promise<ChatMessage[]> {
    const raw = await this.redis.lrange<string>(this.chatKey(roomId), 0, -1);
    const messages: ChatMessage[] = [];
    for (const r of raw) {
      try {
        messages.push(JSON.parse(String(r)) as ChatMessage);
      } catch {
        /* skip a corrupt entry */
      }
    }
    return messages.reverse();
  }

  async close(): Promise<void> {
    for (const close of [...this.closers]) close();
  }

  /** Test helper: remove everything under this store's prefix for one room. */
  async destroyRoom(roomId: string): Promise<void> {
    await this.redis.del(this.roomKey(roomId), this.peersKey(roomId), this.chatKey(roomId));
  }
}
