import { accountStores } from '../../../server/accounts/store';
import { MemorySearchCache, RedisSearchCache, SearchLimiter, handleSearch, type SearchCache } from '../../../server/search';

export const dynamic = 'force-dynamic';

const g = globalThis as typeof globalThis & { __sub50Search?: { cache: SearchCache; limiter: SearchLimiter } };
const deps = () => {
  if (!g.__sub50Search) {
    const redis = accountStores().redis; // same Upstash as rooms and accounts, when configured
    g.__sub50Search = { cache: redis ? new RedisSearchCache(redis) : new MemorySearchCache(), limiter: new SearchLimiter() };
  }
  return g.__sub50Search;
};

/** GET /api/search?q=… → { results } from YouTube (needs YOUTUBE_API_KEY). */
export async function GET(req: Request): Promise<Response> {
  const who = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  const result = await handleSearch(new URL(req.url).searchParams.get('q'), { key: process.env.YOUTUBE_API_KEY, who, ...deps() });
  return Response.json(result.body, { status: result.status, headers: { 'cache-control': 'no-store' } });
}
