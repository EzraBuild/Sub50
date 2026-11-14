import { Redis } from '@upstash/redis';
import { LIMITS } from '../../shared/protocol';

export interface HistoryPerson {
  name: string;
}

export interface HistoryTrack {
  videoId: string;
  title: string;
}

/** One visit to a room: who was there, what played, how long you listened. */
export interface ListeningSession {
  id: string;
  roomId: string;
  startedAt: number;
  endedAt: number;
  /** Minutes the room was actually playing while you were in it. */
  minutes: number;
  people: HistoryPerson[];
  tracks: HistoryTrack[];
}

/** A chat message from a room, kept with the session you heard it in. */
export interface SessionChatMessage {
  id: string;
  name: string;
  text: string;
  /** Server time (ms). */
  at: number;
  /** Sent by you. */
  mine: boolean;
}

export interface HistoryStore {
  list(userId: string): Promise<ListeningSession[]>;
  /** Insert or replace by session id (the client re-sends the growing session). */
  upsert(userId: string, session: ListeningSession): Promise<void>;
  /** Removes the session and its chat. */
  remove(userId: string, sessionId: string): Promise<void>;
  /** Adds messages to a session's chat (idempotent by message id, capped). */
  appendChat(userId: string, sessionId: string, messages: SessionChatMessage[]): Promise<void>;
  /** Oldest first. */
  listChat(userId: string, sessionId: string): Promise<SessionChatMessage[]>;
}

export const HISTORY_MAX = 100;
export const SESSION_CHAT_MAX = 200;
const SESSION_ID = /^[A-Za-z0-9_-]{8,64}$/;
const MESSAGE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const MAX_PEOPLE = 50;
const MAX_TRACKS = 50;

const newestFirst = (a: ListeningSession, b: ListeningSession) => b.endedAt - a.endedAt;
const cleanName = (raw: string) => raw.replace(/\s+/g, ' ').trim().slice(0, LIMITS.NAME_MAX);

/** Validates and normalizes an untrusted session posted by the client. */
export function parseSession(body: unknown, now = Date.now()): ListeningSession | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as Record<string, unknown>;
  if (typeof b.id !== 'string' || !SESSION_ID.test(b.id)) return null;
  if (typeof b.roomId !== 'string' || !LIMITS.ROOM_ID.test(b.roomId)) return null;
  let startedAt = Number(b.startedAt);
  let endedAt = Number(b.endedAt);
  const minutes = Number(b.minutes);
  // Sane timestamps: ends after it starts, at most a day long.
  if (![startedAt, endedAt, minutes].every(Number.isFinite)) return null;
  if (endedAt < startedAt || endedAt - startedAt > 24 * 3600_000) return null;
  // The client sends its session as it happens, so a future end means its clock runs fast: shift to ours.
  if (endedAt > now + 60_000) {
    startedAt -= endedAt - now;
    endedAt = now;
  }
  if (minutes < 0 || minutes > (endedAt - startedAt) / 60_000 + 1) return null;

  const people: HistoryPerson[] = [];
  const seen = new Set<string>();
  for (const p of Array.isArray(b.people) ? b.people : []) {
    const name = typeof p === 'object' && p && typeof (p as HistoryPerson).name === 'string' ? cleanName((p as HistoryPerson).name) : '';
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    people.push({ name });
    if (people.length >= MAX_PEOPLE) break;
  }
  const tracks: HistoryTrack[] = [];
  const seenTracks = new Set<string>();
  for (const t of Array.isArray(b.tracks) ? b.tracks : []) {
    const v = t as Partial<HistoryTrack>;
    if (typeof v?.videoId !== 'string' || !VIDEO_ID.test(v.videoId) || seenTracks.has(v.videoId)) continue;
    seenTracks.add(v.videoId);
    tracks.push({ videoId: v.videoId, title: typeof v.title === 'string' ? v.title.trim().slice(0, LIMITS.TITLE_MAX) : '' });
    if (tracks.length >= MAX_TRACKS) break;
  }
  return { id: b.id, roomId: b.roomId, startedAt, endedAt, minutes: Math.round(minutes * 10) / 10, people, tracks };
}

/** Validates untrusted chat messages posted with a session. */
export function parseChat(raw: unknown): SessionChatMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: SessionChatMessage[] = [];
  const seen = new Set<string>();
  for (const item of raw.slice(0, SESSION_CHAT_MAX)) {
    if (typeof item !== 'object' || item === null) continue;
    const { id, name, text, at, mine } = item as Record<string, unknown>;
    const when = Number(at);
    if (typeof id !== 'string' || !MESSAGE_ID.test(id) || seen.has(id)) continue;
    if (typeof text !== 'string' || !text.trim() || !Number.isFinite(when)) continue;
    seen.add(id);
    out.push({ id, name: (typeof name === 'string' && cleanName(name)) || 'someone', text: text.slice(0, LIMITS.CHAT_MAX), at: when, mine: mine === true });
  }
  return out;
}

const oldestFirst = (a: SessionChatMessage, b: SessionChatMessage) => a.at - b.at;

export interface PersonSummary {
  name: string;
  sessions: number;
  minutes: number;
  lastAt: number;
}

/** Who you've listened with most: grouped by display name (case-insensitive). */
export function summarizePeople(sessions: ListeningSession[]): PersonSummary[] {
  const byName = new Map<string, PersonSummary>();
  for (const s of sessions) {
    for (const p of s.people) {
      const key = p.name.toLowerCase();
      const cur = byName.get(key) ?? { name: p.name, sessions: 0, minutes: 0, lastAt: 0 };
      cur.sessions += 1;
      cur.minutes += s.minutes;
      if (s.endedAt > cur.lastAt) {
        cur.lastAt = s.endedAt;
        cur.name = p.name; // most recent spelling wins
      }
      byName.set(key, cur);
    }
  }
  return [...byName.values()].sort((a, b) => b.minutes - a.minutes || b.lastAt - a.lastAt);
}

export class RedisHistory implements HistoryStore {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = 'sub50',
  ) {}

  private key = (userId: string) => `${this.prefix}:user:${userId}:history`;
  private chatKey = (userId: string, sessionId: string) => `${this.prefix}:user:${userId}:chat:${sessionId}`;

  async list(userId: string): Promise<ListeningSession[]> {
    const all = await this.redis.hgetall<Record<string, string>>(this.key(userId));
    const out: ListeningSession[] = [];
    for (const raw of Object.values(all ?? {})) {
      try {
        out.push(typeof raw === 'string' ? (JSON.parse(raw) as ListeningSession) : (raw as ListeningSession));
      } catch {
        /* skip corrupt entry */
      }
    }
    return out.sort(newestFirst);
  }

  async upsert(userId: string, session: ListeningSession): Promise<void> {
    const key = this.key(userId);
    await this.redis.hset(key, { [session.id]: JSON.stringify(session) });
    // Keep only the newest HISTORY_MAX sessions (pruned in batches, not on every write).
    if ((await this.redis.hlen(key)) > HISTORY_MAX + 20) {
      const stale = (await this.list(userId)).slice(HISTORY_MAX).map((s) => s.id);
      if (stale.length) {
        await this.redis.hdel(key, ...stale);
        await this.redis.del(...stale.map((id) => this.chatKey(userId, id)));
      }
    }
  }

  async remove(userId: string, sessionId: string): Promise<void> {
    await this.redis.hdel(this.key(userId), sessionId);
    await this.redis.del(this.chatKey(userId, sessionId));
  }

  async appendChat(userId: string, sessionId: string, messages: SessionChatMessage[]): Promise<void> {
    if (messages.length === 0) return;
    const key = this.chatKey(userId, sessionId);
    const room = SESSION_CHAT_MAX - (await this.redis.hlen(key));
    if (room <= 0) return;
    await this.redis.hset(key, Object.fromEntries(messages.slice(0, room).map((m) => [m.id, JSON.stringify(m)])));
  }

  async listChat(userId: string, sessionId: string): Promise<SessionChatMessage[]> {
    const all = await this.redis.hgetall<Record<string, string>>(this.chatKey(userId, sessionId));
    const out: SessionChatMessage[] = [];
    for (const raw of Object.values(all ?? {})) {
      try {
        out.push(typeof raw === 'string' ? (JSON.parse(raw) as SessionChatMessage) : (raw as SessionChatMessage));
      } catch {
        /* skip corrupt entry */
      }
    }
    return out.sort(oldestFirst);
  }
}

export class MemoryHistory implements HistoryStore {
  private readonly users = new Map<string, Map<string, ListeningSession>>();
  private readonly chats = new Map<string, Map<string, SessionChatMessage>>();

  async list(userId: string): Promise<ListeningSession[]> {
    return [...(this.users.get(userId)?.values() ?? [])].sort(newestFirst);
  }

  async upsert(userId: string, session: ListeningSession): Promise<void> {
    let m = this.users.get(userId);
    if (!m) this.users.set(userId, (m = new Map()));
    m.set(session.id, structuredClone(session));
    if (m.size > HISTORY_MAX) for (const s of (await this.list(userId)).slice(HISTORY_MAX)) await this.remove(userId, s.id);
  }

  async remove(userId: string, sessionId: string): Promise<void> {
    this.users.get(userId)?.delete(sessionId);
    this.chats.delete(`${userId}:${sessionId}`);
  }

  async appendChat(userId: string, sessionId: string, messages: SessionChatMessage[]): Promise<void> {
    const key = `${userId}:${sessionId}`;
    let m = this.chats.get(key);
    if (!m) this.chats.set(key, (m = new Map()));
    for (const msg of messages) if (m.has(msg.id) || m.size < SESSION_CHAT_MAX) m.set(msg.id, { ...msg });
  }

  async listChat(userId: string, sessionId: string): Promise<SessionChatMessage[]> {
    return [...(this.chats.get(`${userId}:${sessionId}`)?.values() ?? [])].sort(oldestFirst);
  }
}

/** Request logic, independent of Next and Clerk (userId null = signed out). */
export async function handleHistory(
  method: string,
  userId: string | null,
  store: HistoryStore,
  input: { body?: unknown; sessionId?: string | null },
  now = Date.now(),
): Promise<{ status: number; body: unknown }> {
  if (!userId) return { status: 401, body: { error: 'Sign in to keep a listening history.' } };
  switch (method) {
    case 'GET': {
      // ?sessionId= → that session's chat (loaded on demand, not with the list).
      if (input.sessionId != null) {
        if (!SESSION_ID.test(input.sessionId)) return { status: 400, body: { error: 'Invalid sessionId.' } };
        return { status: 200, body: { chat: await store.listChat(userId, input.sessionId) } };
      }
      const sessions = await store.list(userId);
      return { status: 200, body: { sessions, people: summarizePeople(sessions) } };
    }
    case 'POST': {
      const session = parseSession(input.body, now);
      if (!session) return { status: 400, body: { error: 'Invalid session.' } };
      // Under a minute of actual listening isn't worth remembering.
      if (session.minutes < 1) return { status: 202, body: { skipped: true } };
      await store.upsert(userId, session);
      await store.appendChat(userId, session.id, parseChat((input.body as { chat?: unknown }).chat));
      return { status: 200, body: { ok: true } };
    }
    case 'DELETE': {
      if (typeof input.sessionId !== 'string' || !SESSION_ID.test(input.sessionId)) return { status: 400, body: { error: 'Expected ?sessionId=' } };
      await store.remove(userId, input.sessionId);
      return { status: 200, body: { ok: true } };
    }
    default:
      return { status: 405, body: { error: 'Method not allowed.' } };
  }
}
