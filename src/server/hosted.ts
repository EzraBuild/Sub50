import { SyncHub } from './hub';
import { RedisStore } from './store/redis';
import { resolveTitle } from './titles';

const g = globalThis as typeof globalThis & { __sub50Hub?: SyncHub };

/**
 * The hub for a Vercel Function instance. Fluid Compute runs many sockets on
 * one instance, so they share this hub, while rooms live in Upstash Redis
 * (Vercel Marketplace) because sockets of one room can land on any instance.
 */
export function getHostedHub(): SyncHub {
  if (!g.__sub50Hub) {
    const hub = new SyncHub({ store: new RedisStore(), resolveTitle });
    hub.start();
    g.__sub50Hub = hub;
  }
  return g.__sub50Hub;
}
