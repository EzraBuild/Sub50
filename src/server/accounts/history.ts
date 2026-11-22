import { Redis } from '@upstash/redis';
import { LIMITS } from '../../shared/protocol';
import { knownLengths, summarizePeople, toStub } from '../../lib/activity';

export interface HistoryPerson {
  name: string;
}

export interface HistoryTrack {
  videoId: string;
  title: string;
  /** The song's length in seconds, once the player reported it (older visits don't have it). */
  seconds?: number;
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

/** What's kept of a visit once it falls out of the full history: enough for streaks and totals. */
export interface VisitStub {
  startedAt: number;
  endedAt: number;
  minutes: number;
  /** Songs it had. */
  songs: number;
  /** Their lengths added up (s), as far as known. */
  seconds: number;
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
  /** Stubs of visits pruned from the full history, oldest first. */
  listStubs(userId: string): Promise<VisitStub[]>;
  /** Adds stubs, keeping the latest STUBS_MAX. */
  addStubs(userId: string, stubs: VisitStub[]): Promise<void>;
}

export const HISTORY_MAX = 100;
export const SESSION_CHAT_MAX = 200;
/** About a year of a few visits a day; a stub is ~90 bytes. */
export const STUBS_MAX = 2000;
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
    const seconds = Math.round(Number(v.seconds));
    tracks.push({
      videoId: v.videoId,
      title: typeof v.title === 'string' ? v.title.trim().slice(0, LIMITS.TITLE_MAX) : '',
      ...(seconds > 0 && seconds <= 86_400 ? { seconds } : {}),
    });
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

/** Validates untrusted stubs (a device's older visits joining the account). */
export function parseStubs(raw: unknown, now = Date.now()): VisitStub[] {
  if (!Array.isArray(raw)) return [];
  const out: VisitStub[] = [];
  for (const item of raw.slice(0, STUBS_MAX)) {
    if (typeof item !== 'object' || item === null) continue;
    const r = item as Record<string, unknown>;
    const [a, b, m, n, sec] = [r.startedAt, r.endedAt, r.minutes, r.songs, r.seconds].map(Number) as [number, number, number, number, number];
    if (![a, b, m, n, sec].every(Number.isFinite)) continue;
    if (b < a || b - a > 24 * 3600_000 || b > now + 60_000 || m < 0 || m > (b - a) / 60_000 + 1) continue;
    if (n < 0 || n > MAX_TRACKS || sec < 0 || sec > MAX_TRACKS * 86_400) continue;
    out.push({ startedAt: a, endedAt: b, minutes: Math.round(m * 10) / 10, songs: Math.round(n), seconds: Math.round(sec) });
  }
  return out;
}

/** Oldest first, one per visit (two prunes racing can write one twice), the latest STUBS_MAX. */
export function tidyStubs(stubs: VisitStub[]): VisitStub[] {
  const byVisit = new Map(stubs.map((s) => [`${s.startedAt}:${s.endedAt}`, s]));
  return [...byVisit.values()].sort((a, b) => a.startedAt - b.startedAt).slice(-STUBS_MAX);
}

// Pure and browser-safe, so the device-only history on /me can use it too.
export { summarizePeople, type PersonSummary } from '../../lib/activity';

export class RedisHistory implements HistoryStore {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = 'sub50',
  ) {}

  private key = (userId: string) => `${this.prefix}:user:${userId}:history`;
  private chatKey = (userId: string, sessionId: string) => `${this.prefix}:user:${userId}:chat:${sessionId}`;
  private stubsKey = (userId: string) => `${this.prefix}:user:${userId}:stubs`;

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
      const all = await this.list(userId);
      const stale = all.slice(HISTORY_MAX);
      if (stale.length) {
        // Pruned visits leave a stub behind, so streaks and totals still count them.
        const known = knownLengths(all);
        await this.addStubs(userId, stale.map((s) => toStub(s, known)));
        await this.redis.hdel(key, ...stale.map((s) => s.id));
        await this.redis.del(...stale.map((s) => this.chatKey(userId, s.id)));
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

  async listStubs(userId: string): Promise<VisitStub[]> {
    const raw = await this.redis.lrange<string>(this.stubsKey(userId), 0, -1);
    const out: VisitStub[] = [];
    for (const r of raw ?? []) {
      try {
        out.push(typeof r === 'string' ? (JSON.parse(r) as VisitStub) : (r as VisitStub));
      } catch {
        /* skip corrupt entry */
      }
    }
    return tidyStubs(out);
  }

  async addStubs(userId: string, stubs: VisitStub[]): Promise<void> {
    if (stubs.length === 0) return;
    const key = this.stubsKey(userId);
    await this.redis.rpush(key, ...stubs.map((s) => JSON.stringify(s)));
    await this.redis.ltrim(key, -STUBS_MAX, -1);
  }
}

export class MemoryHistory implements HistoryStore {
  private readonly users = new Map<string, Map<string, ListeningSession>>();
  private readonly chats = new Map<string, Map<string, SessionChatMessage>>();
  private readonly stubs = new Map<string, VisitStub[]>();

  async list(userId: string): Promise<ListeningSession[]> {
    return [...(this.users.get(userId)?.values() ?? [])].sort(newestFirst);
  }

  async upsert(userId: string, session: ListeningSession): Promise<void> {
    let m = this.users.get(userId);
    if (!m) this.users.set(userId, (m = new Map()));
    m.set(session.id, structuredClone(session));
    if (m.size > HISTORY_MAX) {
      const all = await this.list(userId);
      const known = knownLengths(all);
      for (const s of all.slice(HISTORY_MAX)) {
        await this.addStubs(userId, [toStub(s, known)]);
        await this.remove(userId, s.id);
      }
    }
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

  async listStubs(userId: string): Promise<VisitStub[]> {
    return tidyStubs(this.stubs.get(userId) ?? []);
  }

  async addStubs(userId: string, stubs: VisitStub[]): Promise<void> {
    this.stubs.set(userId, [...(this.stubs.get(userId) ?? []), ...stubs.map((s) => ({ ...s }))].slice(-STUBS_MAX));
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
      const [sessions, stubs] = await Promise.all([store.list(userId), store.listStubs(userId)]);
      return { status: 200, body: { sessions, people: summarizePeople(sessions), stubs } };
    }
    case 'POST': {
      // { stubs: [...] }: a device's older visits joining the account.
      const b = input.body as { stubs?: unknown; id?: unknown } | null;
      if (b && typeof b === 'object' && Array.isArray(b.stubs) && b.id === undefined) {
        const stubs = parseStubs(b.stubs, now);
        await store.addStubs(userId, stubs);
        return { status: 200, body: { ok: true, added: stubs.length } };
      }
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
