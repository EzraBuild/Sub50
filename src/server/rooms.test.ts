import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SYNC, type RoomState, type ServerMessage } from '../shared/protocol';
import { RoomManager } from './rooms';

const URL_A = 'https://youtu.be/aaaaaaaaaaa';
const URL_B = 'https://www.youtube.com/watch?v=bbbbbbbbbbb';

function harness() {
  let clock = 1_000_000;
  const rm = new RoomManager({ now: () => clock, resolveTitle: async (id) => `Title ${id}` });
  const inbox = new Map<string, ServerMessage[]>();
  const client = (id: string) => {
    inbox.set(id, []);
    rm.connect({ id, send: (d) => inbox.get(id)!.push(JSON.parse(d)) });
    return {
      send: (msg: Parameters<RoomManager['handle']>[1]) => rm.handle(id, msg),
      last: <T extends ServerMessage['type']>(type: T) =>
        inbox.get(id)!.filter((m) => m.type === type).at(-1) as Extract<ServerMessage, { type: T }> | undefined,
      state: () => (inbox.get(id)!.filter((m) => m.type === 'SYNC_STATE').at(-1) as { state: RoomState } | undefined)?.state,
    };
  };
  return { rm, client, tick: (ms: number) => (clock += ms), now: () => clock };
}

test('join creates the room, makes the first peer host and replies with state', () => {
  const h = harness();
  const a = h.client('a');
  a.send({ type: 'JOIN_ROOM', roomId: 'jam', username: '  Ada  ' });
  const s = a.state()!;
  assert.equal(s.roomId, 'jam');
  assert.equal(s.hostId, 'a');
  assert.equal(a.last('PEERS')!.peers[0]!.name, 'Ada');
});

test('CHANGE_VIDEO resets the playhead and schedules a synchronized start', () => {
  const h = harness();
  const a = h.client('a');
  const b = h.client('b');
  a.send({ type: 'JOIN_ROOM', roomId: 'jam', username: 'a' });
  b.send({ type: 'JOIN_ROOM', roomId: 'jam', username: 'b' });
  a.send({ type: 'CHANGE_VIDEO', roomId: 'jam', url: URL_A });
  const s = b.state()!;
  assert.equal(s.videoId, 'aaaaaaaaaaa');
  assert.equal(s.isPlaying, true);
  assert.equal(s.lastTimestamp, 0);
  assert.equal(s.updatedAt, h.now() + SYNC.TRACK_START_DELAY_MS);
});

test('PLAY / PAUSE / SEEK update the timeline', () => {
  const h = harness();
  const a = h.client('a');
  a.send({ type: 'JOIN_ROOM', roomId: 'jam', username: 'a' });
  a.send({ type: 'CHANGE_VIDEO', roomId: 'jam', url: URL_A });
  h.tick(10_000);
  a.send({ type: 'PAUSE', roomId: 'jam', timestamp: 42.5 });
  assert.deepEqual(
    { p: a.state()!.isPlaying, t: a.state()!.lastTimestamp, u: a.state()!.updatedAt },
    { p: false, t: 42.5, u: h.now() },
  );
  a.send({ type: 'SEEK', roomId: 'jam', timestamp: 60 });
  assert.equal(a.state()!.updatedAt, h.now(), 'seek while paused takes effect immediately');
  a.send({ type: 'PLAY', roomId: 'jam', timestamp: 60 });
  assert.equal(a.state()!.isPlaying, true);
  assert.equal(a.state()!.updatedAt, h.now() + SYNC.START_DELAY_MS);
});

test('PLAY while already playing does not re-anchor the room', () => {
  const h = harness();
  const a = h.client('a');
  a.send({ type: 'JOIN_ROOM', roomId: 'jam', username: 'a' });
  a.send({ type: 'CHANGE_VIDEO', roomId: 'jam', url: URL_A });
  const before = { ...a.state()! };
  a.send({ type: 'PLAY', roomId: 'jam', timestamp: 99 });
  assert.equal(a.state()!.lastTimestamp, before.lastTimestamp);
  assert.equal(a.state()!.updatedAt, before.updatedAt);
});

test('queue: add starts playback when idle, otherwise appends; play/remove work', () => {
  const h = harness();
  const a = h.client('a');
  a.send({ type: 'JOIN_ROOM', roomId: 'jam', username: 'a' });
  a.send({ type: 'QUEUE_ADD', roomId: 'jam', url: URL_A });
  assert.equal(a.state()!.videoId, 'aaaaaaaaaaa');
  a.send({ type: 'QUEUE_ADD', roomId: 'jam', url: URL_B, title: 'B side' });
  const q = a.last('QUEUE_UPDATED')!.queue;
  assert.equal(q.length, 1);
  assert.equal(q[0]!.title, 'B side');
  a.send({ type: 'QUEUE_PLAY', roomId: 'jam', itemId: q[0]!.id });
  assert.equal(a.state()!.videoId, 'bbbbbbbbbbb');
  assert.equal(a.state()!.queue.length, 0);
});

test('TRACK_ENDED advances exactly once even when every peer reports it', () => {
  const h = harness();
  const a = h.client('a');
  const b = h.client('b');
  a.send({ type: 'JOIN_ROOM', roomId: 'jam', username: 'a' });
  b.send({ type: 'JOIN_ROOM', roomId: 'jam', username: 'b' });
  a.send({ type: 'CHANGE_VIDEO', roomId: 'jam', url: URL_A });
  a.send({ type: 'QUEUE_ADD', roomId: 'jam', url: URL_B });
  a.send({ type: 'QUEUE_ADD', roomId: 'jam', url: URL_A });
  const ended = a.state()!.trackId!;
  a.send({ type: 'TRACK_ENDED', roomId: 'jam', trackId: ended });
  b.send({ type: 'TRACK_ENDED', roomId: 'jam', trackId: ended });
  const s = b.state()!;
  assert.equal(s.videoId, 'bbbbbbbbbbb');
  assert.equal(s.queue.length, 1, 'only one item consumed');
});

test('host is handed to the longest-connected peer when the host leaves', () => {
  const h = harness();
  const a = h.client('a');
  const b = h.client('b');
  const c = h.client('c');
  a.send({ type: 'JOIN_ROOM', roomId: 'jam', username: 'a' });
  h.tick(1);
  b.send({ type: 'JOIN_ROOM', roomId: 'jam', username: 'b' });
  h.tick(1);
  c.send({ type: 'JOIN_ROOM', roomId: 'jam', username: 'c' });
  h.rm.disconnect('a');
  assert.equal(c.state()!.hostId, 'b');
});

test('messages for a room the socket did not join are ignored', () => {
  const h = harness();
  const a = h.client('a');
  const b = h.client('b');
  a.send({ type: 'JOIN_ROOM', roomId: 'jam', username: 'a' });
  b.send({ type: 'JOIN_ROOM', roomId: 'other', username: 'b' });
  b.send({ type: 'CHANGE_VIDEO', roomId: 'jam', url: URL_A });
  assert.equal(h.rm.getState('jam')!.videoId, null);
});
