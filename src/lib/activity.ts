import type { ListeningSession } from '../server/accounts/history';

export interface SongSummary {
  videoId: string;
  title: string;
  /** Sessions it played in. */
  plays: number;
  lastAt: number;
  /** Most recent room it played in. */
  lastRoom: string;
}

/** Every track across your sessions, most recently played first. */
export function summarizeTracks(sessions: ListeningSession[]): SongSummary[] {
  const byId = new Map<string, SongSummary>();
  for (const s of sessions) {
    for (const t of s.tracks) {
      const cur = byId.get(t.videoId) ?? { videoId: t.videoId, title: '', plays: 0, lastAt: 0, lastRoom: s.roomId };
      cur.plays += 1;
      if (s.endedAt >= cur.lastAt) {
        cur.lastAt = s.endedAt;
        cur.lastRoom = s.roomId;
      }
      cur.title ||= t.title; // keep the first real title seen
      byId.set(t.videoId, cur);
    }
  }
  return [...byId.values()].sort((a, b) => b.lastAt - a.lastAt);
}

/** "42 min", "1 h 05". */
export function formatMinutes(minutes: number): string {
  const m = Math.round(minutes);
  if (m < 60) return `${Math.max(1, m)} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}

/** "today 21:04", "yesterday 09:15", "Nov 5 17:20". */
export function formatWhen(at: number, now = Date.now()): string {
  const d = new Date(at);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  if (d.toDateString() === new Date(now).toDateString()) return `today ${time}`;
  if (d.toDateString() === new Date(now - 86_400_000).toDateString()) return `yesterday ${time}`;
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
}

/** A link that opens a fresh room and plays (or queues) this track. */
export const listenUrl = (roomId: string, videoId: string) => `/?room=${roomId}&play=${encodeURIComponent(videoId)}`;
