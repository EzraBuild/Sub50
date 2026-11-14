import type { ListeningSession, SessionChatMessage } from '../server/accounts/history';

/** Kept on this device for people who don't sign in (or servers without accounts). */
export interface LocalHistory {
  sessions: ListeningSession[];
  chats: Record<string, SessionChatMessage[]>;
}

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;

const KEY = 'sub50:history';
/** Fewer than the account keeps: localStorage is small (~5 MB) and shared with the rest of the app. */
export const LOCAL_SESSIONS_MAX = 50;
const CHAT_MAX = 200;

const empty = (): LocalHistory => ({ sessions: [], chats: {} });
const store = (): Storage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

export function loadLocal(s: Storage | null = store()): LocalHistory {
  try {
    const raw = s?.getItem(KEY);
    if (!raw) return empty();
    const data = JSON.parse(raw) as Partial<LocalHistory>;
    return { sessions: Array.isArray(data.sessions) ? data.sessions : [], chats: data.chats && typeof data.chats === 'object' ? data.chats : {} };
  } catch {
    return empty();
  }
}

function save(h: LocalHistory, s: Storage | null): boolean {
  try {
    s?.setItem(KEY, JSON.stringify(h));
    return true;
  } catch {
    return false; // full or blocked: drop silently, it's best effort
  }
}

/** Insert or replace a visit by id, adding any new chat; keeps the newest sessions only. */
export function upsertLocal(session: ListeningSession, chat: SessionChatMessage[] = [], s: Storage | null = store()): void {
  const h = loadLocal(s);
  h.sessions = [session, ...h.sessions.filter((x) => x.id !== session.id)].sort((a, b) => b.endedAt - a.endedAt);
  if (chat.length) {
    const have = h.chats[session.id] ?? [];
    const ids = new Set(have.map((m) => m.id));
    h.chats[session.id] = [...have, ...chat.filter((m) => !ids.has(m.id))].sort((a, b) => a.at - b.at).slice(0, CHAT_MAX);
  }
  for (const old of h.sessions.slice(LOCAL_SESSIONS_MAX)) delete h.chats[old.id];
  h.sessions = h.sessions.slice(0, LOCAL_SESSIONS_MAX);
  save(h, s);
}

export function removeLocal(sessionId: string, s: Storage | null = store()): void {
  const h = loadLocal(s);
  h.sessions = h.sessions.filter((x) => x.id !== sessionId);
  delete h.chats[sessionId];
  save(h, s);
}

export function clearLocal(s: Storage | null = store()): void {
  try {
    s?.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
