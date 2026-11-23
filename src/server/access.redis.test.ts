/** Live check of RedisAccess; skipped without credentials (npx tsx --env-file=.env.local --test …). */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { Redis } from '@upstash/redis';
import { RedisAccess } from './access';

const url = process.env.KV_REST_API_URL;
const token = process.env.KV_REST_API_TOKEN;
const skip = url && token ? false : 'KV_REST_API_URL / KV_REST_API_TOKEN not set';
const prefix = `sub50test:${Date.now().toString(36)}`;
const redis = url && token ? new Redis({ url, token, automaticDeserialization: false, enableTelemetry: false }) : null;

after(async () => {
  if (redis) await redis.del(`${prefix}:access:private`, `${prefix}:access:allowed`);
});

test('RedisAccess: switch and list against real Redis', { skip }, async () => {
  const store = new RedisAccess(redis!, prefix);
  assert.deepEqual(await store.get(), { private: false, allowed: [] });
  await store.setPrivate(true);
  await store.allow('bo@example.com');
  await store.allow('ada@example.com');
  assert.deepEqual(await store.get(), { private: true, allowed: ['ada@example.com', 'bo@example.com'] });
  await store.remove('bo@example.com');
  await store.setPrivate(false);
  assert.deepEqual(await store.get(), { private: false, allowed: ['ada@example.com'] });
});
