/** Live check of RedisPlaylists; skipped without credentials (npx tsx --env-file=.env.local --test …). */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { Redis } from '@upstash/redis';
import { RedisPlaylists, type Playlist } from './playlists';

const url = process.env.KV_REST_API_URL;
const token = process.env.KV_REST_API_TOKEN;
const skip = url && token ? false : 'KV_REST_API_URL / KV_REST_API_TOKEN not set';
const prefix = `sub50test:${Date.now().toString(36)}`;
const redis = url && token ? new Redis({ url, token, automaticDeserialization: false, enableTelemetry: false }) : null;

const playlist = (id: string, updatedAt: number): Playlist => ({
  id,
  ownerId: 'u1',
  ownerName: 'Ezra',
  name: `List ${id}`,
  description: '',
  visibility: 'private',
  tracks: [{ videoId: 'dQw4w9WgXcQ', title: 'Never Gonna', addedAt: 1 }],
  createdAt: 1,
  updatedAt,
});

after(async () => {
  if (redis) await redis.del(`${prefix}:playlist:AAAAAAAAAA`, `${prefix}:playlist:BBBBBBBBBB`, `${prefix}:user:u1:playlists`);
});

test('RedisPlaylists stores, lists newest first, counts and removes against real Redis', { skip }, async () => {
  const store = new RedisPlaylists(redis!, prefix);
  await store.put(playlist('AAAAAAAAAA', 1));
  await store.put(playlist('BBBBBBBBBB', 2));
  assert.equal(await store.countMine('u1'), 2);
  assert.deepEqual((await store.listMine('u1')).map((p) => p.id), ['BBBBBBBBBB', 'AAAAAAAAAA']);
  assert.equal((await store.get('AAAAAAAAAA'))?.tracks[0]?.title, 'Never Gonna');
  await store.remove(playlist('AAAAAAAAAA', 1));
  assert.equal(await store.get('AAAAAAAAAA'), null);
  assert.equal(await store.countMine('u1'), 1);
});
