import type { Redis } from '@upstash/redis';

/** One YouTube result, enough to show it and queue it. */
export interface SearchResult {
  videoId: string;
  title: string;
  channel: string;
  /** Length in seconds, when YouTube said. */
  seconds: number | null;
}

export const SEARCH_QUERY_MAX = 100;
export const SEARCH_RESULTS = 8;
const CACHE_TTL_S = 24 * 3600;
const PER_MINUTE = 20;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const API = 'https://www.googleapis.com/youtube/v3';

/** "PT1H2M3S" → 3723; null for live streams ("P0D") or junk. */
export function parseIsoDuration(iso: string | undefined): number | null {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso ?? '');
  if (!m) return null;
  const s = Number(m[1] ?? 0) * 86400 + Number(m[2] ?? 0) * 3600 + Number(m[3] ?? 0) * 60 + Number(m[4] ?? 0);
  return s > 0 ? s : null;
}

/** The API sends titles HTML-escaped ("Rock &amp; Roll", "Don&#39;t"). */
export function decodeEntities(s: string): string {
  const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : all;
    }
    return named[e.toLowerCase()] ?? all;
  });
}

export const normalizeQuery = (q: string) => q.replace(/\s+/g, ' ').trim().toLowerCase();

/** YouTube said no: `quota` when today's free units are used up. */
export class SearchError extends Error {
  constructor(readonly quota: boolean) {
    super(quota ? 'quota' : 'search failed');
  }
}

type Fetch = (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/** Top embeddable videos for a query, with their lengths. Costs 101 API units. */
export async function searchYouTube(q: string, key: string, fetchImpl: Fetch = fetch): Promise<SearchResult[]> {
  const params = new URLSearchParams({ part: 'snippet', type: 'video', videoEmbeddable: 'true', maxResults: String(SEARCH_RESULTS), q, key });
  const r = await fetchImpl(`${API}/search?${params}`);
  if (!r.ok) {
    const body = (await r.json().catch(() => null)) as { error?: { errors?: { reason?: string }[] } } | null;
    throw new SearchError(r.status === 403 && !!body?.error?.errors?.some((e) => e.reason === 'quotaExceeded' || e.reason === 'dailyLimitExceeded'));
  }
  const data = (await r.json()) as { items?: { id?: { videoId?: string }; snippet?: { title?: string; channelTitle?: string } }[] };
  const results: SearchResult[] = [];
  for (const it of data.items ?? []) {
    const videoId = it.id?.videoId;
    if (!videoId || !VIDEO_ID.test(videoId) || results.some((x) => x.videoId === videoId)) continue;
    results.push({ videoId, title: decodeEntities(it.snippet?.title ?? ''), channel: decodeEntities(it.snippet?.channelTitle ?? ''), seconds: null });
  }
  if (results.length === 0) return results;
  // Lengths: one videos.list call (1 unit). Best effort: results are useful without them.
  try {
    const v = await fetchImpl(`${API}/videos?${new URLSearchParams({ part: 'contentDetails', id: results.map((x) => x.videoId).join(','), key })}`);
    if (v.ok) {
      const details = (await v.json()) as { items?: { id?: string; contentDetails?: { duration?: string } }[] };
      const lengths = new Map((details.items ?? []).map((d) => [d.id, parseIsoDuration(d.contentDetails?.duration)]));
      for (const x of results) x.seconds = lengths.get(x.videoId) ?? null;
    }
  } catch {
    /* keep results without lengths */
  }
  return results;
}

export interface SearchCache {
  get(q: string): Promise<SearchResult[] | null>;
  set(q: string, results: SearchResult[]): Promise<void>;
}

export class MemorySearchCache implements SearchCache {
  private readonly map = new Map<string, { at: number; results: SearchResult[] }>();
  constructor(private readonly now = () => Date.now()) {}
  async get(q: string) {
    const hit = this.map.get(q);
    return hit && this.now() - hit.at < CACHE_TTL_S * 1000 ? hit.results : null;
  }
  async set(q: string, results: SearchResult[]) {
    if (this.map.size >= 500) this.map.delete(this.map.keys().next().value!);
    this.map.set(q, { at: this.now(), results });
  }
}

export class RedisSearchCache implements SearchCache {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = 'sub50',
  ) {}
  private key = (q: string) => `${this.prefix}:search:${q}`;
  async get(q: string) {
    const raw = await this.redis.get<string>(this.key(q));
    if (!raw) return null;
    try {
      return (typeof raw === 'string' ? JSON.parse(raw) : raw) as SearchResult[];
    } catch {
      return null;
    }
  }
  async set(q: string, results: SearchResult[]) {
    await this.redis.set(this.key(q), JSON.stringify(results), { ex: CACHE_TTL_S });
  }
}

/** Searches per visitor per minute, per server instance: a soft guard for the shared daily quota. */
export class SearchLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();
  constructor(private readonly now = () => Date.now()) {}
  allow(who: string): boolean {
    const t = this.now();
    const w = this.windows.get(who);
    if (!w || t - w.start >= 60_000) {
      if (this.windows.size > 5000) this.windows.clear();
      this.windows.set(who, { start: t, count: 1 });
      return true;
    }
    return ++w.count <= PER_MINUTE;
  }
}

interface Deps {
  key: string | undefined;
  cache: SearchCache;
  limiter: SearchLimiter;
  who: string;
  search?: typeof searchYouTube;
}

/** Request logic, independent of Next. */
export async function handleSearch(raw: string | null, deps: Deps): Promise<{ status: number; body: unknown }> {
  if (!deps.key) return { status: 503, body: { error: 'Search isn’t set up on this server. Paste a link instead.' } };
  const q = normalizeQuery(raw ?? '');
  if (!q || q.length > SEARCH_QUERY_MAX) return { status: 400, body: { error: `Type 1–${SEARCH_QUERY_MAX} characters.` } };
  const cached = await deps.cache.get(q).catch(() => null);
  if (cached) return { status: 200, body: { results: cached } };
  if (!deps.limiter.allow(deps.who)) return { status: 429, body: { error: 'That’s a lot of searches. Try again in a minute.' } };
  try {
    const results = await (deps.search ?? searchYouTube)(q, deps.key);
    await deps.cache.set(q, results).catch(() => {});
    return { status: 200, body: { results } };
  } catch (e) {
    if (e instanceof SearchError && e.quota) return { status: 503, body: { error: 'Search is resting until tomorrow (YouTube’s daily limit). Paste a link instead.' } };
    return { status: 502, body: { error: 'YouTube search didn’t answer. Try again, or paste a link.' } };
  }
}
