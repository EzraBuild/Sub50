import { LIMITS } from '../shared/protocol';

export interface PlayTrack {
  videoId: string;
  title?: string;
}

/** Songs one link can start: one batch, so they land in a single queue commit. */
export const PLAY_ALL_MAX = LIMITS.BATCH_MAX;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const TITLES_KEY = 'sub50:titles';

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;
const session = (): Storage | null => {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
};

/** `?play=` value: valid video ids, in order, no repeats, at most PLAY_ALL_MAX. */
export function parsePlayList(raw: string | null): string[] {
  const out: string[] = [];
  for (const id of (raw ?? '').split(',')) {
    const v = id.trim();
    if (VIDEO_ID.test(v) && !out.includes(v)) out.push(v);
    if (out.length >= PLAY_ALL_MAX) break;
  }
  return out;
}

/** A fresh room that plays these in order: the first starts, the rest queue. */
export const playAllUrl = (roomId: string, tracks: PlayTrack[]) =>
  `/?room=${roomId}&play=${parsePlayList(tracks.map((t) => t.videoId).join(',')).join(',')}`;

/**
 * Titles ride along in this tab's session storage (a URL with 50 titles is long and
 * ugly). If they're missing, e.g. the link opened in a new tab, the room looks titles up as songs start.
 */
export function stashTitles(tracks: PlayTrack[], s: Storage | null = session()): void {
  try {
    s?.setItem(TITLES_KEY, JSON.stringify(Object.fromEntries(tracks.filter((t) => t.title).map((t) => [t.videoId, t.title]))));
  } catch {
    /* full or blocked: titles fill in as songs play */
  }
}

/** The stashed titles (once: they're cleared). */
export function takeTitles(s: Storage | null = session()): Record<string, string> {
  try {
    const raw = s?.getItem(TITLES_KEY);
    s?.removeItem(TITLES_KEY);
    const data = raw ? (JSON.parse(raw) as unknown) : null;
    if (!data || typeof data !== 'object') return {};
    return Object.fromEntries(Object.entries(data).filter((e): e is [string, string] => typeof e[1] === 'string'));
  } catch {
    return {};
  }
}

/** What to queue for `?play=`, titles filled in where we know them. */
export const playItems = (ids: string[], titles: Record<string, string>): PlayTrack[] =>
  ids.map((videoId) => (titles[videoId] ? { videoId, title: titles[videoId] } : { videoId }));
