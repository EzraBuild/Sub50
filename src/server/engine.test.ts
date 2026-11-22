import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SYNC, type RoomState } from '../shared/protocol';
import { applyCommand, applyTitle, createRoom, skipThreshold, withHost, type EngineContext, type Outcome, type RoomCommand } from './engine';

const A = 'https://youtu.be/aaaaaaaaaaa';
const B = 'https://www.youtube.com/watch?v=bbbbbbbbbbb';
const NOW = 1_000_000;

let ids = 0;
const ctx = (now = NOW): EngineContext => ({ now, peerName: 'Ada', newId: () => `id${++ids}` });

function changed(out: Outcome): RoomState {
  assert.equal(out.kind, 'changed', JSON.stringify(out));
  return (out as Extract<Outcome, { kind: 'changed' }>).state;
}
/** Omit that distributes over the union, so each command keeps its own fields. */
type WithoutRoom<T> = T extends unknown ? Omit<T, 'roomId'> : never;
const run = (s: RoomState, cmd: WithoutRoom<RoomCommand>, now = NOW) =>
  applyCommand(s, { roomId: s.roomId, ...cmd } as RoomCommand, ctx(now));
const playing = () => changed(run(createRoom('jam', 'h', NOW, 'e1'), { type: 'CHANGE_VIDEO', url: A }));

test('CHANGE_VIDEO resets the playhead, schedules a synchronized start, asks for a title', () => {
  const out = run(createRoom('jam', 'h', NOW, 'e1'), { type: 'CHANGE_VIDEO', url: A });
  const s = changed(out);
  assert.deepEqual(
    { videoId: s.videoId, isPlaying: s.isPlaying, t: s.lastTimestamp, at: s.updatedAt, seq: s.seq },
    { videoId: 'aaaaaaaaaaa', isPlaying: true, t: 0, at: NOW + SYNC.TRACK_START_DELAY_MS, seq: 1 },
  );
  assert.equal(out.kind === 'changed' && out.resolveTitle, 'aaaaaaaaaaa');
  assert.deepEqual(run(createRoom('jam', 'h', NOW, 'e1'), { type: 'CHANGE_VIDEO', url: 'nope' }), {
    kind: 'error',
    message: 'That does not look like a YouTube link.',
  });
});

test('PLAY / PAUSE / SEEK move the timeline; every commit bumps seq by exactly one', () => {
  let s = playing();
  s = changed(run(s, { type: 'PAUSE', timestamp: 42.5 }, NOW + 10_000));
  assert.deepEqual([s.isPlaying, s.lastTimestamp, s.updatedAt, s.seq], [false, 42.5, NOW + 10_000, 2]);
  s = changed(run(s, { type: 'SEEK', timestamp: 60 }, NOW + 11_000));
  assert.equal(s.updatedAt, NOW + 11_000, 'seek while paused takes effect immediately');
  s = changed(run(s, { type: 'PLAY', timestamp: 60 }, NOW + 12_000));
  assert.deepEqual([s.isPlaying, s.updatedAt, s.seq], [true, NOW + 12_000 + SYNC.START_DELAY_MS, 4]);
  s = changed(run(s, { type: 'SEEK', timestamp: 90 }, NOW + 13_000));
  assert.equal(s.updatedAt, NOW + 13_000 + SYNC.START_DELAY_MS, 'seek while playing is scheduled');
});

test('PLAY while already playing never re-anchors the room; it asks to resend state', () => {
  assert.deepEqual(run(playing(), { type: 'PLAY', timestamp: 99 }), { kind: 'unchanged', resend: true });
});

test('queue: add starts playback when idle, otherwise appends', () => {
  const idle = createRoom('jam', 'h', NOW, 'e1');
  const started = changed(run(idle, { type: 'QUEUE_ADD', url: A }));
  assert.equal(started.videoId, 'aaaaaaaaaaa');
  assert.equal(started.queue.length, 0);

  const out = run(started, { type: 'QUEUE_ADD', url: B, title: 'B side' });
  const s = changed(out);
  assert.equal(out.kind === 'changed' && out.resolveTitle, undefined, 'title supplied: no lookup');
  assert.deepEqual(s.queue.map((q) => [q.videoId, q.title, q.addedBy]), [['bbbbbbbbbbb', 'B side', 'Ada']]);
});

test('queue: play splices the item out and starts it; remove is a no-op for unknown ids', () => {
  let s = changed(run(playing(), { type: 'QUEUE_ADD', url: B }));
  const item = s.queue[0]!;
  assert.deepEqual(run(s, { type: 'QUEUE_REMOVE', itemId: 'nope' }), { kind: 'unchanged', resend: false });
  s = changed(run(s, { type: 'QUEUE_PLAY', itemId: item.id }));
  assert.equal(s.videoId, 'bbbbbbbbbbb');
  assert.equal(s.queue.length, 0);
});

test('TRACK_ENDED advances once per track; with an empty queue it parks at the end', () => {
  let s = changed(run(playing(), { type: 'QUEUE_ADD', url: B }));
  const first = s.trackId!;
  s = changed(run(s, { type: 'TRACK_ENDED', trackId: first }));
  assert.equal(s.videoId, 'bbbbbbbbbbb');
  assert.equal(run(s, { type: 'TRACK_ENDED', trackId: first }).kind, 'unchanged', 'late duplicate is ignored');

  const end = s.updatedAt + 200_000; // 200s into track B
  s = changed(run(s, { type: 'TRACK_ENDED', trackId: s.trackId! }, end));
  assert.deepEqual([s.isPlaying, s.lastTimestamp, s.updatedAt], [false, 200, end]);
});

test('inputs are never mutated', () => {
  const before = changed(run(playing(), { type: 'QUEUE_ADD', url: B }));
  const snapshot = structuredClone(before);
  run(before, { type: 'QUEUE_PLAY', itemId: before.queue[0]!.id });
  run(before, { type: 'PAUSE', timestamp: 5 });
  applyTitle(before, 'bbbbbbbbbbb', 'B');
  assert.deepEqual(before, snapshot);
});

test('applyTitle fills only missing titles', () => {
  const s = changed(run(playing(), { type: 'QUEUE_ADD', url: A }));
  const out = applyTitle(s, 'aaaaaaaaaaa', 'Song A')!;
  assert.equal(out.title, 'Song A');
  assert.equal(out.queue[0]!.title, 'Song A');
  assert.equal(out.seq, s.seq + 1);
  assert.equal(applyTitle(out, 'aaaaaaaaaaa', 'Other'), null, 'already titled');
});

test('withHost only commits a real change', () => {
  const s = createRoom('jam', 'h', NOW, 'e1');
  assert.equal(s.epoch, 'e1');
  assert.equal(withHost(s, 'h'), null);
  assert.deepEqual([withHost(s, 'x')!.hostId, withHost(s, 'x')!.seq], ['x', 1]);
});

test('played log records every track start, newest first, capped, with titles back-filled', () => {
  let s = createRoom('jam', 'h', NOW, 'e1');
  s = changed(run(s, { type: 'CHANGE_VIDEO', url: A }));
  s = changed(run(s, { type: 'QUEUE_ADD', url: B, title: 'B side' }));
  s = changed(run(s, { type: 'TRACK_ENDED', trackId: s.trackId! }, NOW + 60_000));
  assert.deepEqual(s.played!.map((p) => [p.videoId, p.title, p.addedBy]), [
    ['bbbbbbbbbbb', 'B side', 'Ada'],
    ['aaaaaaaaaaa', '', 'Ada'],
  ]);
  assert.equal(s.played![0]!.at, NOW + 60_000);

  const titled = applyTitle(s, 'aaaaaaaaaaa', 'Song A')!;
  assert.equal(titled.played![1]!.title, 'Song A', 'resolved title reaches the played log too');

  for (let i = 0; i < 40; i++) s = changed(run(s, { type: 'CHANGE_VIDEO', url: A }));
  assert.equal(s.played!.length, 30, 'capped');
});

test('rooms created before the played log existed keep working', () => {
  const legacy = { ...createRoom('jam', 'h', NOW, 'e1') } as Partial<RoomState>;
  delete legacy.played;
  const s = changed(run(legacy as RoomState, { type: 'CHANGE_VIDEO', url: A }));
  assert.equal(s.played!.length, 1);
});

const vote = (s: RoomState, peerId: string, live: string[], v: boolean | 'no' = true, now = NOW) =>
  applyCommand(s, { type: 'VOTE_SKIP', roomId: s.roomId, trackId: s.trackId!, vote: v }, { ...ctx(now), peerId, livePeerIds: live });

test('vote to skip: skips once more than half the live room agrees, votes reset on the next track', () => {
  let s = changed(run(changed(run(playing(), { type: 'QUEUE_ADD', url: B })), { type: 'QUEUE_ADD', url: A }));
  const room = ['p1', 'p2', 'p3', 'p4'];
  s = changed(vote(s, 'p1', room));
  assert.deepEqual([s.videoId, s.skipVotes], ['aaaaaaaaaaa', ['p1']], '1 of 4: not yet');
  s = changed(vote(s, 'p2', room));
  assert.equal(s.videoId, 'aaaaaaaaaaa', '2 of 4 is only half');
  s = changed(vote(s, 'p3', room));
  assert.equal(s.videoId, 'bbbbbbbbbbb', '3 of 4: skipped to the next queued track');
  assert.deepEqual(s.skipVotes, [], 'votes reset for the new track');
});

test('skip request between two: asking waits for the other, who accepts or keeps it playing', () => {
  const two = ['ada', 'bo'];
  const queued = changed(run(playing(), { type: 'QUEUE_ADD', url: B }));
  const asked = changed(vote(queued, 'ada', two));
  assert.deepEqual([asked.videoId, asked.skipVotes], ['aaaaaaaaaaa', ['ada']], 'one ask is not a skip with two of you');
  assert.equal(changed(vote(asked, 'bo', two)).videoId, 'bbbbbbbbbbb', 'accepted: skipped');

  const kept = changed(vote(asked, 'bo', two, 'no'));
  assert.deepEqual([kept.videoId, kept.skipVotes, kept.skipNo, kept.skipDeclined], ['aaaaaaaaaaa', [], [], { by: 'bo', name: 'Ada', at: NOW }], 'rejected: the request ends, Ada sees who kept it');
  assert.equal(vote(kept, 'bo', two, 'no').kind, 'unchanged', 'nothing left to turn down');
  const again = changed(vote(kept, 'ada', two));
  assert.deepEqual([again.skipVotes, again.skipDeclined], [['ada'], null], 'asking again starts fresh');
  assert.deepEqual(changed(vote(again, 'ada', two, false)).skipVotes, [], 'Ada takes it back');
});

test('skip request in a bigger room: one no is not the end, enough noes are', () => {
  const three = ['ada', 'bo', 'di'];
  let s = changed(vote(changed(run(playing(), { type: 'QUEUE_ADD', url: B })), 'ada', three));
  s = changed(vote(s, 'bo', three, 'no'));
  assert.deepEqual([s.skipVotes, s.skipNo], [['ada'], ['bo']], '2 of 3 can still say yes');
  assert.equal(changed(vote(s, 'di', three)).videoId, 'bbbbbbbbbbb', 'Di agrees: 2 of 3');
  const kept = changed(vote(s, 'di', three, 'no'));
  assert.deepEqual([kept.videoId, kept.skipVotes, kept.skipDeclined?.by], ['aaaaaaaaaaa', [], 'di'], 'two noes: it can no longer pass');
  assert.deepEqual([1, 2, 3, 4, 5].map(skipThreshold), [1, 2, 2, 3, 3]);
});

test('vote to skip: withdraw, duplicates, stale voters, wrong track, solo listener', () => {
  let s = changed(run(playing(), { type: 'QUEUE_ADD', url: B }));
  s = changed(vote(s, 'p1', ['p1', 'p2', 'p3']));
  assert.equal(vote(s, 'p1', ['p1', 'p2', 'p3']).kind, 'unchanged', 'voting twice changes nothing');
  s = changed(vote(s, 'p1', ['p1', 'p2', 'p3'], false));
  assert.deepEqual(s.skipVotes, [], 'withdrawn');

  s = changed(vote(s, 'gone', ['gone', 'p1', 'p2', 'p3', 'p4']));
  s = changed(vote(s, 'p1', ['p1', 'p2', 'p3', 'p4'])); // "gone" left: their vote no longer counts
  assert.deepEqual([s.videoId, s.skipVotes], ['aaaaaaaaaaa', ['p1']]);

  const stale = applyCommand(s, { type: 'VOTE_SKIP', roomId: 'jam', trackId: 'old-track', vote: true }, { ...ctx(), peerId: 'p2', livePeerIds: ['p1', 'p2'] });
  assert.equal(stale.kind, 'unchanged', 'a vote for a previous track is ignored');

  const solo = changed(vote(s, 'p1', ['p1']));
  assert.equal(solo.videoId, 'bbbbbbbbbbb', 'alone in the room: one vote skips');
});

test('vote to skip with an empty queue stops at the current position', () => {
  const s = changed(vote(playing(), 'p1', ['p1'], true, NOW + SYNC.TRACK_START_DELAY_MS + 42_000));
  assert.deepEqual([s.isPlaying, s.lastTimestamp, s.skipVotes], [false, 42, []]);
});

test('QUEUE_ADD_MANY: an idle room starts the first track and queues the rest, in one commit', () => {
  const idle = createRoom('jam', 'h', NOW, 'e1');
  const out = run(idle, { type: 'QUEUE_ADD_MANY', items: [{ videoId: 'aaaaaaaaaaa' }, { videoId: 'bbbbbbbbbbb', title: 'B side' }, { videoId: 'ccccccccccc', title: 'C' }] });
  const s = changed(out);
  assert.equal(s.videoId, 'aaaaaaaaaaa');
  assert.equal(s.isPlaying, true);
  assert.deepEqual(s.queue.map((q) => [q.videoId, q.title, q.addedBy]), [['bbbbbbbbbbb', 'B side', 'Ada'], ['ccccccccccc', 'C', 'Ada']]);
  assert.equal(s.seq, idle.seq + 1, 'one commit');
  assert.equal(out.kind === 'changed' && out.resolveTitle, 'aaaaaaaaaaa', 'the untitled track that started gets its title looked up');
});

test('QUEUE_ADD_MANY: a playing room only queues, and stops at the queue limit', () => {
  const p = playing();
  const many = Array.from({ length: 50 }, (_, i) => ({ videoId: `v${String(i).padStart(10, '0')}`, title: `t${i}` }));
  let s = p;
  for (let i = 0; i < 4; i++) s = changed(run(s, { type: 'QUEUE_ADD_MANY', items: many }));
  assert.equal(s.videoId, p.videoId, 'the current track keeps playing');
  assert.equal(s.queue.length, 200);
  assert.deepEqual(run(s, { type: 'QUEUE_ADD_MANY', items: many.slice(0, 1) }), { kind: 'error', message: 'The queue is full.' });
});


// ---- Wait for everyone ----------------------------------------------------

const wctx = (peerId: string, now: number, livePeerIds?: string[]): EngineContext => ({ now, peerName: peerId.toUpperCase(), newId: () => `id${++ids}`, peerId, livePeerIds });
const wrun = (s: RoomState, cmd: WithoutRoom<RoomCommand>, peerId: string, now: number, live?: string[]) =>
  applyCommand(s, { roomId: s.roomId, ...cmd } as RoomCommand, wctx(peerId, now, live));
/** A room that has been playing for 10s. */
const live = () => {
  const s = playing();
  return { s, at: s.updatedAt + 10_000 };
};

test('a stall pauses a playing room where it is; the last one ready restarts it on a scheduled start', () => {
  const { s: start, at } = live();
  let s = changed(wrun(start, { type: 'STALL', stalled: true }, 'ada', at));
  assert.deepEqual([s.isPlaying, s.lastTimestamp, s.waiting], [false, 10, { since: at, peers: [{ id: 'ada', name: 'ADA' }] }]);
  s = changed(wrun(s, { type: 'STALL', stalled: true }, 'bo', at + 500));
  assert.deepEqual(s.waiting!.peers.map((p) => p.id), ['ada', 'bo']);
  s = changed(wrun(s, { type: 'STALL', stalled: false }, 'ada', at + 2000));
  assert.equal(s.isPlaying, false, 'still waiting for Bo');
  s = changed(wrun(s, { type: 'STALL', stalled: false }, 'bo', at + 3000));
  assert.deepEqual([s.isPlaying, s.lastTimestamp, s.updatedAt, s.waiting], [true, 10, at + 3000 + SYNC.START_DELAY_MS, null]);
  assert.deepEqual(wrun(s, { type: 'STALL', stalled: false }, 'bo', at + 4000), { kind: 'unchanged', resend: false }, 'ready twice: nothing');
});

test('stalls are ignored when the option is off, the room is paused, or the start is still ahead', () => {
  const { s: start, at } = live();
  const off = changed(wrun(start, { type: 'SET_WAIT_FOR_ALL', on: false }, 'ada', at));
  assert.equal(wrun(off, { type: 'STALL', stalled: true }, 'bo', at).kind, 'unchanged');
  const paused = changed(run(start, { type: 'PAUSE', timestamp: 5 }, at));
  assert.equal(wrun(paused, { type: 'STALL', stalled: true }, 'bo', at + 100).kind, 'unchanged');
  assert.equal(wrun(start, { type: 'STALL', stalled: true }, 'bo', start.updatedAt - 100).kind, 'unchanged', 'before the scheduled start');
});

test('after the timeout the room goes on, and the slow listener cannot stop this track again', () => {
  const { s: start, at } = live();
  let s = changed(wrun(start, { type: 'STALL', stalled: true }, 'ada', at));
  assert.equal(wrun(s, { type: 'WAIT_CHECK' }, 'bo', at + 5000, ['ada', 'bo']).kind, 'unchanged', 'still within the timeout');
  s = changed(wrun(s, { type: 'WAIT_CHECK' }, 'bo', at + SYNC.WAIT_TIMEOUT_MS, ['ada', 'bo']));
  assert.deepEqual([s.isPlaying, s.waiting], [true, null]);
  const later = s.updatedAt + 5000;
  assert.equal(wrun(s, { type: 'STALL', stalled: true }, 'ada', later).kind, 'unchanged', 'ignored for the rest of the track');
  const next = changed(run(s, { type: 'CHANGE_VIDEO', url: B }, later));
  assert.equal(wrun(next, { type: 'STALL', stalled: true }, 'ada', next.updatedAt + 1000).kind, 'changed', 'a new track starts fresh');
});

test('a waiter who left stops holding the room', () => {
  const { s: start, at } = live();
  let s = changed(wrun(start, { type: 'STALL', stalled: true }, 'ada', at));
  s = changed(wrun(s, { type: 'STALL', stalled: true }, 'bo', at));
  s = changed(wrun(s, { type: 'WAIT_CHECK' }, 'di', at + 1000, ['bo', 'di']));
  assert.deepEqual(s.waiting!.peers.map((p) => p.id), ['bo'], 'Ada left');
  s = changed(wrun(s, { type: 'WAIT_CHECK' }, 'di', at + 2000, ['di']));
  assert.deepEqual([s.isPlaying, s.waiting], [true, null], 'everyone it waited for is gone: go on');
});

test('one listener can hold the room only a few times per track', () => {
  let { s, at } = live();
  for (let i = 0; i < SYNC.STALLS_PER_TRACK; i++) {
    s = changed(wrun(s, { type: 'STALL', stalled: true }, 'ada', at));
    s = changed(wrun(s, { type: 'STALL', stalled: false }, 'ada', at + 100));
    at = s.updatedAt + 1000;
  }
  assert.equal(wrun(s, { type: 'STALL', stalled: true }, 'ada', at).kind, 'unchanged');
});

test('people override the wait: play, pause, seek, or turning the option off', () => {
  const { s: start, at } = live();
  const waiting = changed(wrun(start, { type: 'STALL', stalled: true }, 'ada', at));
  assert.equal(changed(run(waiting, { type: 'PLAY', timestamp: 10 }, at + 100)).waiting, null);
  assert.equal(changed(run(waiting, { type: 'PAUSE', timestamp: 10 }, at + 100)).waiting, null);
  assert.equal(changed(run(waiting, { type: 'SEEK', timestamp: 30 }, at + 100)).waiting, null);
  const off = changed(wrun(waiting, { type: 'SET_WAIT_FOR_ALL', on: false }, 'bo', at + 100));
  assert.deepEqual([off.waitForAll, off.isPlaying, off.waiting], [false, true, null]);
  assert.equal(wrun(off, { type: 'SET_WAIT_FOR_ALL', on: false }, 'bo', at + 200).kind, 'unchanged');
});
