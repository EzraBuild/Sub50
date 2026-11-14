import type { ListeningSession, SessionChatMessage } from '../server/accounts/history';
import { summarizeTracks } from './activity';

/** YouTube's anonymous playlist link takes at most this many ids. */
export const YOUTUBE_PLAYLIST_MAX = 50;

const cell = (v: string | number) => {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** One row per song per session (a session with no songs still gets a row). Opens in any spreadsheet. */
export function toCsv(sessions: ListeningSession[]): string {
  const rows: (string | number)[][] = [['started', 'room', 'minutes', 'listened with', 'video id', 'title', 'link']];
  for (const s of sessions) {
    const base = [new Date(s.startedAt).toISOString(), s.roomId, s.minutes, s.people.map((p) => p.name).join('; ')];
    if (s.tracks.length === 0) rows.push([...base, '', '', '']);
    for (const t of s.tracks) rows.push([...base, t.videoId, t.title, `https://youtu.be/${t.videoId}`]);
  }
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

/** Everything, chat included, for keeping or importing elsewhere. */
export function toJson(sessions: ListeningSession[], chats: Record<string, SessionChatMessage[]>, now = Date.now()): string {
  return JSON.stringify({ app: 'Sub50', exportedAt: new Date(now).toISOString(), sessions: sessions.map((s) => ({ ...s, chat: chats[s.id] ?? [] })) }, null, 2);
}

/** Your most recent songs as one YouTube playlist link (no account needed), or null with none. */
export function youtubePlaylistUrl(sessions: ListeningSession[]): string | null {
  const ids = summarizeTracks(sessions)
    .slice(0, YOUTUBE_PLAYLIST_MAX)
    .map((s) => s.videoId);
  return ids.length ? `https://www.youtube.com/watch_videos?video_ids=${ids.join(',')}` : null;
}

/** Saves text as a file through the browser. */
export function download(filename: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
