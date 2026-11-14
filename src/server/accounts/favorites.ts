import { Redis } from '@upstash/redis';
import { LIMITS } from '../../shared/protocol';

export interface Favorite {
  videoId: string;
  title: string;
  /** When it was saved (ms). */
  at: number;
}

export interface FavoritesStore {
  list(userId: string): Promise<Favorite[]>;
  /** Returns false if the user is at the cap and this would be a new entry. */
  add(userId: string, fav: Favorite): Promise<boolean>;
  remove(userId: string, videoId: string): Promise<void>;
}

export const FAVORITES_MAX = 500;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export function parseFavoriteInput(body: unknown): { videoId: string; title: string } | null {
  if (typeof body !== 'object' || body === null) return null;
  const { videoId, title } = body as Record<string, unknown>;
  if (typeof videoId !== 'string' || !VIDEO_ID.test(videoId)) return null;
  if (title !== undefined && typeof title !== 'string') return null;
  return { videoId, title: (title ?? '').trim().slice(0, LIMITS.TITLE_MAX) };
}

export const isVideoId = (v: unknown): v is string => typeof v === 'string' && VIDEO_ID.test(v);

const newestFirst = (a: Favorite, b: Favorite) => b.at - a.at;

/** One hash per user: videoId → JSON. Saving the same track again just refreshes it. */
export class RedisFavorites implements FavoritesStore {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = 'sub50',
  ) {}

  private key = (userId: string) => `${this.prefix}:user:${userId}:favorites`;

  async list(userId: string): Promise<Favorite[]> {
    const all = await this.redis.hgetall<Record<string, string>>(this.key(userId));
    const out: Favorite[] = [];
    for (const raw of Object.values(all ?? {})) {
      try {
        out.push(typeof raw === 'string' ? (JSON.parse(raw) as Favorite) : (raw as Favorite));
      } catch {
        /* skip corrupt entry */
      }
    }
    return out.sort(newestFirst);
  }

  async add(userId: string, fav: Favorite): Promise<boolean> {
    const key = this.key(userId);
    const exists = await this.redis.hexists(key, fav.videoId);
    if (!exists && (await this.redis.hlen(key)) >= FAVORITES_MAX) return false;
    await this.redis.hset(key, { [fav.videoId]: JSON.stringify(fav) });
    return true;
  }

  async remove(userId: string, videoId: string): Promise<void> {
    await this.redis.hdel(this.key(userId), videoId);
  }
}

/** Per-process fallback for local development without Redis. */
export class MemoryFavorites implements FavoritesStore {
  private readonly users = new Map<string, Map<string, Favorite>>();

  async list(userId: string): Promise<Favorite[]> {
    return [...(this.users.get(userId)?.values() ?? [])].sort(newestFirst);
  }

  async add(userId: string, fav: Favorite): Promise<boolean> {
    let m = this.users.get(userId);
    if (!m) this.users.set(userId, (m = new Map()));
    if (!m.has(fav.videoId) && m.size >= FAVORITES_MAX) return false;
    m.set(fav.videoId, { ...fav });
    return true;
  }

  async remove(userId: string, videoId: string): Promise<void> {
    this.users.get(userId)?.delete(videoId);
  }
}

/**
 * The request logic, independent of Next and Clerk so it can be unit tested.
 * `userId` is null when signed out.
 */
export async function handleFavorites(
  method: string,
  userId: string | null,
  store: FavoritesStore,
  input: { body?: unknown; videoId?: string | null },
  now = Date.now(),
): Promise<{ status: number; body: unknown }> {
  if (!userId) return { status: 401, body: { error: 'Sign in to use favorites.' } };
  switch (method) {
    case 'GET':
      return { status: 200, body: { favorites: await store.list(userId) } };
    case 'POST': {
      const parsed = parseFavoriteInput(input.body);
      if (!parsed) return { status: 400, body: { error: 'Expected { videoId, title }.' } };
      const favorite: Favorite = { ...parsed, at: now };
      if (!(await store.add(userId, favorite))) return { status: 409, body: { error: `You can keep up to ${FAVORITES_MAX} favorites.` } };
      return { status: 200, body: { favorite } };
    }
    case 'DELETE': {
      if (!isVideoId(input.videoId)) return { status: 400, body: { error: 'Expected ?videoId=' } };
      await store.remove(userId, input.videoId);
      return { status: 200, body: { ok: true } };
    }
    default:
      return { status: 405, body: { error: 'Method not allowed.' } };
  }
}
