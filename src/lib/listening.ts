import type { ListeningSession } from '../server/accounts/history';

/** Longest gap one tick may count: a sleeping laptop shouldn't log an hour of listening. */
const MAX_TICK_MS = 70_000;

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

  /** The session to send, or null if under a minute or nothing changed since the last send. */
  pending(): ListeningSession | null {
    if (this.minutes < 1) return null;
    const s = this.snapshot();
    const key = `${s.minutes}|${s.people.length}|${s.tracks.map((t) => t.videoId + t.title).join(',')}`;
    return key === this.sentKey ? null : s;
  }

  markSent(s: ListeningSession): void {
    this.sentKey = `${s.minutes}|${s.people.length}|${s.tracks.map((t) => t.videoId + t.title).join(',')}`;
  }
}
