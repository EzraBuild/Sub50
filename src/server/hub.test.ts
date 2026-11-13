import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type { ClientMessage, Peer, RoomState, ServerMessage } from '../shared/protocol';
import { PRESENCE, SyncHub, TELEMETRY } from './hub';
import { MemoryStore } from './store/memory';

const A = 'https://youtu.be/aaaaaaaaaaa';
const B = 'https://www.youtube.com/watch?v=bbbbbbbbbbb';

/** Two hubs on one store stand in for two Vercel Function instances sharing Redis. */
function cluster(instances = 1) {
  let clock = 1_000_000;
  const store = new MemoryStore({ now: () => clock });
  const hubs = Array.from({ length: instances }, (_, i) => {
    const hub = new SyncHub({ store, now: () => clock, instanceId: `i${i}`, resolveTitle: async (id) => `Title ${id}` });
    hub.start();
    return hub;
  });
  const inboxes = new Map<string, ServerMessage[]>();
  const client = (id: string, hub = hubs[0]!) => {
    inboxes.set(id, []);
    hub.connect({ id, send: (f) => inboxes.get(id)!.push(JSON.parse(f)) });
    const all = () => inboxes.get(id)!;
    return {
      id,
      hub,
      send: (msg: ClientMessage) => hub.handle(id, msg),
      join: (roomId = 'jam', name = id) => hub.handle(id, { type: 'JOIN_ROOM', roomId, username: name }),
      count: (type: ServerMessage['type']) => all().filter((m) => m.type === type).length,
      last: <T extends ServerMessage['type']>(type: T) => all().filter((m) => m.type === type).at(-1) as Extract<ServerMessage, { type: T }> | undefined,
      state: () => (all().filter((m) => m.type === 'SYNC_STATE').at(-1) as { state: RoomState } | undefined)?.state,
      peers: () => (all().filter((m) => m.type === 'PEERS').at(-1) as { peers: Peer[] } | undefined)?.peers ?? [],
    };
  };
  cleanups.push(() => {
    hubs.forEach((h) => h.stop());
    void store.close();
  });
  return { store, hubs, client, tick: (ms: number) => (clock += ms), now: () => clock };
}

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((fn) => fn()));
const flush = () => new Promise((r) => setTimeout(r, 0));

test('join creates the room, makes the first peer host, replies with state and peers', async () => {
  const c = cluster();
  const a = c.client('a');
  await a.join('JAM', '  Ada  ');
  assert.equal(a.state()!.roomId, 'jam');
  assert.equal(a.state()!.hostId, 'a');
  assert.ok(a.state()!.epoch);
  assert.deepEqual(a.peers().map((p) => p.name), ['Ada']);
});

test('a command on one instance reaches peers on another instance', async () => {
  const c = cluster(2);
  const a = c.client('a', c.hubs[0]);
  const b = c.client('b', c.hubs[1]);
  await a.join();
  await b.join();
  assert.deepEqual(b.peers().map((p) => p.name), ['a', 'b']);
  assert.deepEqual(a.peers().map((p) => p.name), ['a', 'b'], 'PEERS fanned out across instances');

  await a.send({ type: 'CHANGE_VIDEO', roomId: 'jam', url: A });
  assert.equal(b.state()!.videoId, 'aaaaaaaaaaa');
  assert.equal(b.state()!.seq, a.state()!.seq);
  assert.equal(a.count('SYNC_STATE'), b.count('SYNC_STATE'), 'origin instance does not double-deliver');

  await flush(); // title lookup resolves asynchronously
  assert.equal(b.state()!.title, 'Title aaaaaaaaaaa');
});

test('concurrent TRACK_ENDED from two instances advances the queue exactly once', async () => {
  const c = cluster(2);
  const a = c.client('a', c.hubs[0]);
  const b = c.client('b', c.hubs[1]);
  await a.join();
  await b.join();
  await a.send({ type: 'CHANGE_VIDEO', roomId: 'jam', url: A });
  await a.send({ type: 'QUEUE_ADD', roomId: 'jam', url: B, title: 'B' });
  await a.send({ type: 'QUEUE_ADD', roomId: 'jam', url: A, title: 'A again' });
  const ended = a.state()!.trackId!;

  await Promise.all([
    a.send({ type: 'TRACK_ENDED', roomId: 'jam', trackId: ended }),
    b.send({ type: 'TRACK_ENDED', roomId: 'jam', trackId: ended }),
  ]);
  const s = (await c.store.get('jam'))!;
  assert.equal(s.videoId, 'bbbbbbbbbbb');
  assert.deepEqual(s.queue.map((q) => q.title), ['A again'], 'only one item consumed');
  assert.equal(a.state()!.seq, s.seq);
  assert.equal(b.state()!.seq, s.seq);
});

test('PLAY while already playing is answered to the sender only', async () => {
  const c = cluster();
  const a = c.client('a');
  const b = c.client('b');
  await a.join();
  await b.join();
  await a.send({ type: 'CHANGE_VIDEO', roomId: 'jam', url: A });
  await flush(); // let the async title commit land first
  const before = b.count('SYNC_STATE');
  await a.send({ type: 'PLAY', roomId: 'jam', timestamp: 99 });
  assert.equal(b.count('SYNC_STATE'), before);
  assert.equal(a.state()!.lastTimestamp, 0);
});

test('errors go to the sender only; other rooms are untouchable', async () => {
  const c = cluster();
  const a = c.client('a');
  const b = c.client('b');
  await a.join('jam');
  await b.join('other');
  await a.send({ type: 'CHANGE_VIDEO', roomId: 'jam', url: 'nope' });
  assert.equal(a.last('ERROR')!.message, 'That does not look like a YouTube link.');
  assert.equal(b.count('ERROR'), 0);
  await b.send({ type: 'CHANGE_VIDEO', roomId: 'jam', url: A });
  assert.equal((await c.store.get('jam'))!.videoId, null);
});

test('host passes to the longest-connected peer, across instances', async () => {
  const c = cluster(2);
  const a = c.client('a', c.hubs[0]);
  const b = c.client('b', c.hubs[1]);
  const d = c.client('d', c.hubs[0]);
  await a.join();
  c.tick(1);
  await b.join();
  c.tick(1);
  await d.join();
  await c.hubs[0]!.disconnect('a');
  assert.equal(d.state()!.hostId, 'b');
  assert.deepEqual(b.peers().map((p) => p.name), ['b', 'd']);
});

test('peers whose instance died drop out once their presence goes stale', async () => {
  const c = cluster();
  const a = c.client('a');
  await a.join();
  await c.store.putPeer('jam', { id: 'ghost', name: 'Ghost', joinedAt: 0, lastSeen: c.now() - PRESENCE.STALE_MS - 1, driftMs: null, rttMs: null, status: 'idle' });
  const b = c.client('b');
  await b.join();
  assert.deepEqual(b.peers().map((p) => p.name), ['a', 'b']);
});

test('a joiner takes over a room whose host is gone', async () => {
  const c = cluster();
  const a = c.client('a');
  await a.join();
  c.tick(PRESENCE.STALE_MS + 1); // a's instance never refreshed: a is stale
  const b = c.client('b');
  await b.join();
  assert.equal(b.state()!.hostId, 'b');
});

test('telemetry is throttled: steady jitter is batched, real state changes go out', async () => {
  const c = cluster(2);
  const a = c.client('a', c.hubs[0]);
  const b = c.client('b', c.hubs[1]);
  await a.join();
  await b.join();
  const report = (status: 'locked' | 'tolerant' | 'seeking', driftMs: number) =>
    a.send({ type: 'REPORT', roomId: 'jam', driftMs, rttMs: 20, status });

  await report('locked', 4); // first report: published
  for (let i = 0; i < 10; i++) {
    c.tick(2_000);
    await report(i % 2 ? 'locked' : 'tolerant', 4 + (i % 3)); // 20s of locked/tolerant jitter
  }
  const steady = b.count('PEER_UPDATE');
  assert.ok(steady <= 3, `expected ≤3 updates for 20s of jitter, got ${steady}`);

  c.tick(TELEMETRY.CLASS_CHANGE_MS);
  await report('seeking', 900);
  assert.equal(b.count('PEER_UPDATE'), steady + 1, 'leaving the steady state is published');
  assert.equal(b.last('PEER_UPDATE')!.peer.status, 'seeking');
});
