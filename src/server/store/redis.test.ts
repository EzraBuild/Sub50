/**
 * Integration tests against a real Upstash Redis. Skipped unless credentials
 * are present, e.g.:
 *
 *   npx tsx --env-file=.env.local --test src/server/store/redis.test.ts
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import type { RoomState, ServerMessage } from '../../shared/protocol';
import { createRoom } from '../engine';
import { SyncHub } from '../hub';
import { RedisStore } from './redis';
import type { Broadcast } from './types';

const configured = !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
const skip = configured ? false : 'KV_REST_API_URL / KV_REST_API_TOKEN not set';
const prefix = `sub50test:${Date.now().toString(36)}`;
const stores: RedisStore[] = [];
const make = () => {
  const s = new RedisStore({ prefix, subscriptionCheckMs: 5_000, onError: () => {} });
  stores.push(s);
  return s;
};
const frame = (s: RoomState) => JSON.stringify({ type: 'SYNC_STATE', state: s });
const waitFor = async (cond: () => boolean, ms = 8_000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 50));
  }
};

after(async () => {
  if (!configured) return;
  for (const room of ['cas', 'sub', 'hubs']) await stores[0]?.destroyRoom(room);
  await Promise.all(stores.map((s) => s.close()));
});

test('compare-and-swap only commits on top of the exact version it read', { skip }, async () => {
  const a = make();
  const env = (s: RoomState): Broadcast => ({ roomId: 'cas', origin: 'a', frame: frame(s) });
  const v0 = createRoom('cas', 'h', Date.now(), 'e1');
  const v1 = { ...v0, lastTimestamp: 1, seq: 1 };
  const otherEpoch = { ...v0, epoch: 'e2' };

  assert.equal(await a.tryCommit('cas', null, v0, env(v0)), true, 'create when absent');
  assert.equal(await a.tryCommit('cas', null, v0, env(v0)), false, 'create again: room exists');
  assert.equal(await a.tryCommit('cas', otherEpoch, v1, env(v1)), false, 'same seq, wrong epoch');
  assert.equal(await a.tryCommit('cas', v0, v1, env(v1)), true, 'correct base version');
  assert.equal(await a.tryCommit('cas', v0, { ...v1, lastTimestamp: 9 }, env(v1)), false, 'stale base (seq 0, now 1)');
  assert.equal((await a.get('cas'))!.lastTimestamp, 1, 'the stale write left no trace');
});

test('concurrent updates from two instances never lose a write', { skip }, async () => {
  const a = make();
  const b = make();
  const base = (await a.get('cas'))!;
  const bump = (cur: RoomState | null) => cur && { ...cur, lastTimestamp: cur.lastTimestamp + 1, seq: cur.seq + 1 };
  await Promise.all([a.update('cas', bump, { origin: 'a', frame }), b.update('cas', bump, { origin: 'b', frame })]);
  const final = (await a.get('cas'))!;
  assert.equal(final.seq, base.seq + 2);
  assert.equal(final.lastTimestamp, base.lastTimestamp + 2, 'both increments applied');
});

test('a commit on one store is broadcast to subscribers of another', { skip }, async () => {
  const a = make();
  const b = make();
  const got: Broadcast[] = [];
  let ready = false;
  b.subscribe((m) => m.roomId === 'sub' && got.push(m), () => (ready = true));
  await waitFor(() => ready);

  await a.update('sub', () => createRoom('sub', 'h', Date.now(), 'e1'), { origin: 'a', frame });
  await a.publish({ roomId: 'sub', origin: 'a', frame: '{"type":"ERROR","message":"hi"}' });
  await waitFor(() => got.length >= 2);
  assert.equal(got[0]!.origin, 'a');
  assert.equal((JSON.parse(got[0]!.frame) as { state: RoomState }).state.roomId, 'sub');
  assert.equal(got[1]!.frame, '{"type":"ERROR","message":"hi"}', 'frames arrive byte-for-byte');
});

test('two hubs on two Redis connections share a room', { skip, timeout: 60_000 }, async () => {
  const h1 = new SyncHub({ store: make(), instanceId: 'one' });
  const h2 = new SyncHub({ store: make(), instanceId: 'two' });
  h1.start();
  h2.start();
  const inbox: Record<string, ServerMessage[]> = { a: [], b: [] };
  h1.connect({ id: 'a', send: (f) => inbox.a!.push(JSON.parse(f)) });
  h2.connect({ id: 'b', send: (f) => inbox.b!.push(JSON.parse(f)) });
  const lastState = (id: string) => (inbox[id]!.filter((m) => m.type === 'SYNC_STATE').at(-1) as { state: RoomState } | undefined)?.state;
  await new Promise((r) => setTimeout(r, 1500)); // let both subscriptions open

  await h1.handle('a', { type: 'JOIN_ROOM', roomId: 'hubs', username: 'Ada' });
  await h2.handle('b', { type: 'JOIN_ROOM', roomId: 'hubs', username: 'Bo' });
  await h1.handle('a', { type: 'CHANGE_VIDEO', roomId: 'hubs', url: 'https://youtu.be/aaaaaaaaaaa' });

  await waitFor(() => lastState('b')?.videoId === 'aaaaaaaaaaa');
  await waitFor(() => inbox.a!.some((m) => m.type === 'PEERS' && m.peers.length === 2));
  assert.equal(lastState('b')!.seq, lastState('a')!.seq);
  await h1.disconnect('a');
  await h2.disconnect('b');
  h1.stop();
  h2.stop();
});
