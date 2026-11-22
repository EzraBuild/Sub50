import type { HistoryTrack, ListeningSession } from '../server/accounts/history';

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
    s.tracks.forEach((t, i) => {
      const cur = byId.get(t.videoId) ?? { videoId: t.videoId, title: '', plays: 0, lastAt: 0, lastRoom: s.roomId };
      cur.plays += 1;
      // Tracks are in play order, so a later one in the same session is more recent.
      const at = s.endedAt + i / 1000;
      if (at >= cur.lastAt) {
        cur.lastAt = at;
        cur.lastRoom = s.roomId;
      }
      cur.title ||= t.title; // keep the first real title seen
      byId.set(t.videoId, cur);
    });
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

/** Song lengths we know, from any visit: songs from before lengths were kept get one from a later play. */
export function knownLengths(sessions: ListeningSession[]): Map<string, number> {
  const known = new Map<string, number>();
  for (const s of sessions) for (const t of s.tracks) if (t.seconds) known.set(t.videoId, t.seconds);
  return known;
}

export interface MusicLength {
  seconds: number;
  /** Songs whose length we don't know. */
  unknown: number;
}

/** The songs' lengths added up. */
export function musicLength(tracks: HistoryTrack[], known: Map<string, number>): MusicLength {
  let seconds = 0;
  let unknown = 0;
  for (const t of tracks) {
    const len = t.seconds ?? known.get(t.videoId);
    if (len) seconds += len;
    else unknown += 1;
  }
  return { seconds, unknown };
}

/** "47 min", "47 min+" when some lengths are unknown, or null when none are known. */
export const formatMusic = (m: MusicLength): string | null => (m.seconds > 0 ? `${formatMinutes(m.seconds / 60)}${m.unknown ? '+' : ''}` : null);

export interface Totals {
  rooms: number;
  /** Time the room played while you were in it. */
  minutes: number;
  /** Different songs. */
  songs: number;
  /** Every room's songs, lengths added up (a song in two rooms counts twice). */
  music: MusicLength;
}

/** Everything added up. */
export function totals(sessions: ListeningSession[]): Totals {
  const known = knownLengths(sessions);
  const ids = new Set<string>();
  const music: MusicLength = { seconds: 0, unknown: 0 };
  let minutes = 0;
  for (const s of sessions) {
    minutes += s.minutes;
    for (const t of s.tracks) ids.add(t.videoId);
    const m = musicLength(s.tracks, known);
    music.seconds += m.seconds;
    music.unknown += m.unknown;
  }
  return { rooms: sessions.length, minutes, songs: ids.size, music };
}

/** A link that opens a fresh room and plays (or queues) this track. */
export const listenUrl = (roomId: string, videoId: string) => `/?room=${roomId}&play=${encodeURIComponent(videoId)}`;

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
