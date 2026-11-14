import { Redis } from '@upstash/redis';
import { LIMITS } from '../../shared/protocol';

/** private: only the owner. link: anyone with the link can see and play it. */
export type Visibility = 'private' | 'link';

export interface PlaylistTrack {
  videoId: string;
  title: string;
  addedAt: number;
}

export interface Playlist {
  id: string;
  ownerId: string;
  ownerName: string;
  name: string;
  description: string;
  visibility: Visibility;
  tracks: PlaylistTrack[];
  createdAt: number;
  updatedAt: number;
}

/** What the API returns: never the owner's account id. */
export type PublicPlaylist = Omit<Playlist, 'ownerId'> & { owned: boolean };

export interface PlaylistSummary {
  id: string;
  name: string;
  visibility: Visibility;
  count: number;
  updatedAt: number;
  /** First track, for a cover thumbnail. */
  cover: string | null;
}

export interface PlaylistStore {
  get(id: string): Promise<Playlist | null>;
  /** Create or replace. */
  put(playlist: Playlist): Promise<void>;
  remove(playlist: Playlist): Promise<void>;
  listMine(ownerId: string): Promise<Playlist[]>;
  countMine(ownerId: string): Promise<number>;
}

export const PLAYLISTS_MAX = 50;
export const PLAYLIST_TRACKS_MAX = 500;
const NAME_MAX = 60;
const DESCRIPTION_MAX = 300;
const PLAYLIST_ID = /^[A-Za-z0-9]{10}$/;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

export const isPlaylistId = (v: unknown): v is string => typeof v === 'string' && PLAYLIST_ID.test(v);

/** Unguessable enough for "anyone with the link": 10 chars of a 57-letter alphabet. */
export function newPlaylistId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

const clean = (raw: unknown, max: number) => (typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, max) : '');

function parseTrack(raw: unknown, now: number): PlaylistTrack | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { videoId, title } = raw as Record<string, unknown>;
  if (typeof videoId !== 'string' || !VIDEO_ID.test(videoId)) return null;
  return { videoId, title: clean(title, LIMITS.TITLE_MAX), addedAt: now };
}

const toPublic = ({ ownerId, ...rest }: Playlist, viewerId: string | null): PublicPlaylist => ({ ...rest, owned: ownerId === viewerId });

export const summarize = (p: Playlist): PlaylistSummary => ({
  id: p.id,
  name: p.name,
  visibility: p.visibility,
  count: p.tracks.length,
  updatedAt: p.updatedAt,
  cover: p.tracks[0]?.videoId ?? null,
});

/** One JSON key per playlist (shareable by id) plus a set of ids per owner. */
export class RedisPlaylists implements PlaylistStore {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = 'sub50',
  ) {}

  private key = (id: string) => `${this.prefix}:playlist:${id}`;
  private mineKey = (ownerId: string) => `${this.prefix}:user:${ownerId}:playlists`;

  async get(id: string): Promise<Playlist | null> {
    const raw = await this.redis.get<string>(this.key(id));
    if (!raw) return null;
    try {
      return typeof raw === 'string' ? (JSON.parse(raw) as Playlist) : (raw as Playlist);
    } catch {
      return null;
    }
  }

  async put(p: Playlist): Promise<void> {
    await this.redis.multi().set(this.key(p.id), JSON.stringify(p)).sadd(this.mineKey(p.ownerId), p.id).exec();
  }

  async remove(p: Playlist): Promise<void> {
    await this.redis.multi().del(this.key(p.id)).srem(this.mineKey(p.ownerId), p.id).exec();
  }

  async listMine(ownerId: string): Promise<Playlist[]> {
    const ids = await this.redis.smembers(this.mineKey(ownerId));
    if (ids.length === 0) return [];
    const raws = await this.redis.mget<(string | null)[]>(...ids.map(this.key));
    const out: Playlist[] = [];
    for (const raw of raws) {
      if (!raw) continue;
      try {
        out.push(typeof raw === 'string' ? (JSON.parse(raw) as Playlist) : (raw as Playlist));
      } catch {
        /* skip corrupt entry */
      }
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  countMine(ownerId: string): Promise<number> {
    return this.redis.scard(this.mineKey(ownerId));
  }
}

export class MemoryPlaylists implements PlaylistStore {
  private readonly all = new Map<string, Playlist>();

  async get(id: string) {
    const p = this.all.get(id);
    return p ? structuredClone(p) : null;
  }
  async put(p: Playlist) {
    this.all.set(p.id, structuredClone(p));
  }
  async remove(p: Playlist) {
    this.all.delete(p.id);
  }
  async listMine(ownerId: string) {
    return [...this.all.values()].filter((p) => p.ownerId === ownerId).sort((a, b) => b.updatedAt - a.updatedAt);
  }
  async countMine(ownerId: string) {
    return (await this.listMine(ownerId)).length;
  }
}

export interface Viewer {
  id: string;
}

type Result = { status: number; body: unknown };
const err = (status: number, error: string): Result => ({ status, body: { error } });

/** GET (mine) / POST (create) on /api/playlists. */
export async function handlePlaylistList(method: string, viewer: Viewer | null, store: PlaylistStore, body: unknown, now = Date.now(), newId = newPlaylistId): Promise<Result> {
  if (!viewer) return err(401, 'Sign in to make playlists.');
  if (method === 'GET') return { status: 200, body: { playlists: (await store.listMine(viewer.id)).map(summarize) } };
  if (method !== 'POST') return err(405, 'Method not allowed.');
  const b = (typeof body === 'object' && body) || {};
  const { name, description, visibility, ownerName, tracks } = b as Record<string, unknown>;
  const title = clean(name, NAME_MAX);
  if (!title) return err(400, 'Give the playlist a name.');
  if ((await store.countMine(viewer.id)) >= PLAYLISTS_MAX) return err(409, `You can keep up to ${PLAYLISTS_MAX} playlists.`);
  const seen = new Set<string>();
  const initial = (Array.isArray(tracks) ? tracks : [])
    .map((t) => parseTrack(t, now))
    .filter((t): t is PlaylistTrack => !!t && !seen.has(t.videoId) && !!seen.add(t.videoId))
    .slice(0, PLAYLIST_TRACKS_MAX);
  const playlist: Playlist = {
    id: newId(),
    ownerId: viewer.id,
    ownerName: clean(ownerName, LIMITS.NAME_MAX) || 'someone',
    name: title,
    description: clean(description, DESCRIPTION_MAX),
    visibility: visibility === 'link' ? 'link' : 'private',
    tracks: initial,
    createdAt: now,
    updatedAt: now,
  };
  await store.put(playlist);
  return { status: 201, body: { playlist: toPublic(playlist, viewer.id) } };
}

/** GET / PATCH / DELETE on /api/playlists/[id], and POST …/copy. */
export async function handlePlaylist(
  method: string,
  viewer: Viewer | null,
  store: PlaylistStore,
  id: string,
  input: { body?: unknown; copy?: boolean; ownerName?: string },
  now = Date.now(),
  newId = newPlaylistId,
): Promise<Result> {
  if (!isPlaylistId(id)) return err(404, 'Playlist not found.');
  const p = await store.get(id);
  const owned = !!p && !!viewer && p.ownerId === viewer.id;
  // A private playlist doesn't exist for anyone but its owner.
  if (!p || (!owned && p.visibility !== 'link')) return err(404, 'Playlist not found.');

  if (input.copy) {
    if (method !== 'POST') return err(405, 'Method not allowed.');
    if (!viewer) return err(401, 'Sign in to save playlists.');
    if ((await store.countMine(viewer.id)) >= PLAYLISTS_MAX) return err(409, `You can keep up to ${PLAYLISTS_MAX} playlists.`);
    const copy: Playlist = {
      ...structuredClone(p),
      id: newId(),
      ownerId: viewer.id,
      ownerName: clean(input.ownerName, LIMITS.NAME_MAX) || 'someone',
      name: owned ? `${p.name} (copy)`.slice(0, NAME_MAX) : p.name,
      visibility: 'private',
      createdAt: now,
      updatedAt: now,
    };
    await store.put(copy);
    return { status: 201, body: { playlist: toPublic(copy, viewer.id) } };
  }

  if (method === 'GET') return { status: 200, body: { playlist: toPublic(p, viewer?.id ?? null) } };
  if (!owned) return viewer ? err(403, 'Only the owner can change this playlist.') : err(401, 'Sign in first.');

  if (method === 'DELETE') {
    await store.remove(p);
    return { status: 200, body: { ok: true } };
  }
  if (method !== 'PATCH') return err(405, 'Method not allowed.');

  const op = (typeof input.body === 'object' && input.body) || {};
  const o = op as Record<string, unknown>;
  switch (o.op) {
    case 'update': {
      if (o.name !== undefined) {
        const name = clean(o.name, NAME_MAX);
        if (!name) return err(400, 'Give the playlist a name.');
        p.name = name;
      }
      if (o.description !== undefined) p.description = clean(o.description, DESCRIPTION_MAX);
      if (o.visibility !== undefined) {
        if (o.visibility !== 'private' && o.visibility !== 'link') return err(400, 'visibility is private or link.');
        p.visibility = o.visibility;
      }
      break;
    }
    case 'add': {
      const track = parseTrack(o, now);
      if (!track) return err(400, 'Expected { op: "add", videoId, title }.');
      if (p.tracks.some((t) => t.videoId === track.videoId)) return { status: 200, body: { playlist: toPublic(p, viewer!.id), already: true } };
      if (p.tracks.length >= PLAYLIST_TRACKS_MAX) return err(409, `A playlist holds up to ${PLAYLIST_TRACKS_MAX} songs.`);
      p.tracks.push(track);
      break;
    }
    case 'remove': {
      if (typeof o.videoId !== 'string') return err(400, 'Expected { op: "remove", videoId }.');
      p.tracks = p.tracks.filter((t) => t.videoId !== o.videoId);
      break;
    }
    case 'move': {
      const from = Number(o.from);
      const to = Number(o.to);
      if (![from, to].every((i) => Number.isInteger(i) && i >= 0 && i < p.tracks.length)) return err(400, 'Expected { op: "move", from, to } within the list.');
      const [moved] = p.tracks.splice(from, 1);
      p.tracks.splice(to, 0, moved!);
      break;
    }
    default:
      return err(400, 'Unknown op (update, add, remove, move).');
  }
  p.updatedAt = now;
  await store.put(p);
  return { status: 200, body: { playlist: toPublic(p, viewer!.id) } };
}
