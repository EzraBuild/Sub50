import type { ListeningSession, SessionChatMessage } from '../server/accounts/history';
import type { ChatMessage } from '../shared/protocol';

/** Longest gap one tick may count: a sleeping laptop shouldn't log an hour of listening. */
const MAX_TICK_MS = 70_000;
/** Chat kept per visit (matches the server's cap). */
const CHAT_CAP = 200;
/** Chat per send: keeps a closing-tab beacon well under the browser's 64 KB limit. */
export const CHAT_PER_SEND = 60;

export type PendingSession = ListeningSession & { chat: SessionChatMessage[] };

export interface TickInput {
  playing: boolean;
  videoId: string | null;
  title: string | null;
  /** Names of everyone else in the room right now. */
  others: string[];
}

/**
 * Accumulates one visit to a room: time the room was actually playing, who was
 * there while it played, and which tracks. Pure, so it can be unit tested.
 */
export class ListeningTracker {
  private playedMs = 0;
  private lastAt: number;
  private readonly people = new Map<string, string>();
  private readonly tracks = new Map<string, string>();
  /** What the server last accepted, to skip redundant writes. */
  private sentKey = '';
  private readonly chat = new Map<string, SessionChatMessage>();
  private readonly sentChat = new Set<string>();

  constructor(
    readonly id: string,
    readonly roomId: string,
    private readonly selfName: () => string,
    readonly startedAt: number,
  ) {
    this.lastAt = startedAt;
  }

  tick(now: number, input: TickInput): void {
    const dt = Math.max(0, Math.min(now - this.lastAt, MAX_TICK_MS));
    this.lastAt = now;
    if (!input.playing || !input.videoId) return;
    this.playedMs += dt;
    this.tracks.set(input.videoId, input.title || this.tracks.get(input.videoId) || '');
    const self = this.selfName().trim().toLowerCase();
    for (const raw of input.others) {
      const name = raw.trim();
      const key = name.toLowerCase();
      if (name && key !== self) this.people.set(key, name);
    }
  }

  /** Keeps the room's chat from `since` (server time, when you entered) on. */
  addChat(messages: ChatMessage[], selfId: string, since: number): void {
    for (const m of messages) {
      if (m.at < since || this.chat.has(m.id) || this.chat.size >= CHAT_CAP) continue;
      this.chat.set(m.id, { id: m.id, name: m.name, text: m.text, at: m.at, mine: m.peerId === selfId });
    }
  }

  get minutes(): number {
    return Math.round((this.playedMs / 60_000) * 10) / 10;
  }

  snapshot(): ListeningSession {
    return {
      id: this.id,
      roomId: this.roomId,
      startedAt: this.startedAt,
      endedAt: this.lastAt,
      minutes: this.minutes,
      people: [...this.people.values()].map((name) => ({ name })),
      tracks: [...this.tracks].map(([videoId, title]) => ({ videoId, title })),
    };
  }

  /** The session (plus chat not sent yet) to send, or null if under a minute or nothing changed. */
  pending(): PendingSession | null {
    if (this.minutes < 1) return null;
    const s = this.snapshot();
    const chat = [...this.chat.values()].filter((m) => !this.sentChat.has(m.id)).slice(0, CHAT_PER_SEND);
    return sessionKey(s) === this.sentKey && chat.length === 0 ? null : { ...s, chat };
  }

  markSent(s: ListeningSession & { chat?: SessionChatMessage[] }): void {
    this.sentKey = sessionKey(s);
    for (const m of s.chat ?? []) this.sentChat.add(m.id);
  }
}

const sessionKey = (s: ListeningSession) => `${s.minutes}|${s.people.length}|${s.tracks.map((t) => t.videoId + t.title).join(',')}`;
