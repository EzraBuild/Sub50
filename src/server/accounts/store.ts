import { Redis } from '@upstash/redis';
import { MemoryFavorites, RedisFavorites, type FavoritesStore } from './favorites';

const g = globalThis as typeof globalThis & { __sub50Accounts?: { favorites: FavoritesStore; redis: Redis | null } };

/**
 * Account data lives in the same Upstash Redis as rooms (Vercel Marketplace).
 * Local dev without Redis falls back to process memory, which is fine for trying
 * things out but obviously not durable.
 */
export function accountStores(): { favorites: FavoritesStore; redis: Redis | null } {
  if (!g.__sub50Accounts) {
    const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
    const redis = url && token ? new Redis({ url, token, automaticDeserialization: false, enableTelemetry: false }) : null;
    g.__sub50Accounts = { redis, favorites: redis ? new RedisFavorites(redis) : new MemoryFavorites() };
  }
  return g.__sub50Accounts;
}
