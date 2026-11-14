/** Live check of RedisHistory; skipped without credentials (npx tsx --env-file=.env.local --test …). */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { Redis } from '@upstash/redis';
import { HISTORY_MAX, RedisHistory, type ListeningSession } from './history';

const url = process.env.KV_REST_API_URL;
const token = process.env.KV_REST_API_TOKEN;
const skip = url && token ? false : 'KV_REST_API_URL / KV_REST_API_TOKEN not set';
const prefix = `sub50test:${Date.now().toString(36)}`;
const redis = url && token ? new Redis({ url, token, automaticDeserialization: false, enableTelemetry: false }) : null;

after(async () => {
  if (redis) await redis.del(`${prefix}:user:u1:history`, `${prefix}:user:u1:chat:sess-chat-0001`);
});

const session = (i: number, minutes = 5): ListeningSession => ({
  id: `sess-${String(i).padStart(6, '0')}`,
  roomId: 'jam',
  startedAt: i * 1000,
  endedAt: i * 1000 + 500,
  minutes,
  people: [{ name: 'Bo' }],
  tracks: [{ videoId: 'dQw4w9WgXcQ', title: 'Never Gonna' }],
});

test('RedisHistory upserts, lists newest first, prunes and deletes against real Redis', { skip }, async () => {
  const store = new RedisHistory(redis!, prefix);
  await store.upsert('u1', session(1, 2));
  await store.upsert('u1', session(1, 9)); // same visit, re-sent longer
  await store.upsert('u1', session(2));
  let list = await store.list('u1');
  assert.deepEqual(list.map((s) => [s.id, s.minutes]), [['sess-000002', 5], ['sess-000001', 9]]);

  for (let i = 3; i <= HISTORY_MAX + 21; i++) await redis!.hset(`${prefix}:user:u1:history`, { [session(i).id]: JSON.stringify(session(i)) });
  await store.upsert('u1', session(HISTORY_MAX + 22)); // over the slack: prunes to the newest HISTORY_MAX
  list = await store.list('u1');
  assert.equal(list.length, HISTORY_MAX);
  assert.equal(list[0]!.id, session(HISTORY_MAX + 22).id);

  await store.remove('u1', list[0]!.id);
  assert.equal((await store.list('u1')).length, HISTORY_MAX - 1);
});

test('RedisHistory keeps chat per session and deletes it with the session', { skip }, async () => {
  const store = new RedisHistory(redis!, prefix);
  const id = 'sess-chat-0001';
  await store.upsert('u1', { ...session(1), id });
  await store.appendChat('u1', id, [{ id: 'b', name: 'Bo', text: 'two', at: 2, mine: false }, { id: 'a', name: 'Me', text: 'one', at: 1, mine: true }]);
  await store.appendChat('u1', id, [{ id: 'b', name: 'Bo', text: 'two', at: 2, mine: false }]);
  assert.deepEqual((await store.listChat('u1', id)).map((m) => m.text), ['one', 'two']);
  await store.remove('u1', id);
  assert.equal((await store.listChat('u1', id)).length, 0);
});
