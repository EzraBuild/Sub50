/** Live check of RedisFavorites; skipped without credentials (npx tsx --env-file=.env.local --test …). */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { Redis } from '@upstash/redis';
import { RedisFavorites } from './favorites';

const url = process.env.KV_REST_API_URL;
const token = process.env.KV_REST_API_TOKEN;
const skip = url && token ? false : 'KV_REST_API_URL / KV_REST_API_TOKEN not set';
const prefix = `sub50test:${Date.now().toString(36)}`;
const redis = url && token ? new Redis({ url, token, automaticDeserialization: false, enableTelemetry: false }) : null;

after(async () => {
  if (redis) await redis.del(`${prefix}:user:u1:favorites`);
});

test('RedisFavorites round-trips against real Redis', { skip }, async () => {
  const store = new RedisFavorites(redis!, prefix);
  assert.equal(await store.add('u1', { videoId: 'dQw4w9WgXcQ', title: 'Never Gonna', at: 1 }), true);
  assert.equal(await store.add('u1', { videoId: 'N9U9A4_cgyI', title: 'Jackson 5', at: 2 }), true);
  assert.deepEqual((await store.list('u1')).map((f) => f.videoId), ['N9U9A4_cgyI', 'dQw4w9WgXcQ']);
  await store.remove('u1', 'N9U9A4_cgyI');
  assert.deepEqual((await store.list('u1')).map((f) => f.title), ['Never Gonna']);
});
