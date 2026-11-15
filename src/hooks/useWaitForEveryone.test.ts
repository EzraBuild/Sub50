import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RoomState } from '../shared/protocol';
import { READY_AHEAD_S, nextStallAction } from './useWaitForEveryone';

const room = (over: Partial<RoomState> = {}): RoomState =>
  ({ roomId: 'jam', videoId: 'dQw4w9WgXcQ', title: null, trackId: 't', isPlaying: true, lastTimestamp: 0, updatedAt: 0, queue: [], hostId: 'h', seq: 1, epoch: 'e', ...over }) as RoomState;
const probe = (stalledMs = 0, ahead = 0, loaded = 0) => ({ stalledMs: () => stalledMs, bufferedAhead: () => ahead, loadedFraction: () => loaded });

test('asks the room to wait only after a real stall while it plays, with the option on', () => {
  assert.equal(nextStallAction(room(), 'me', false, probe(1000)), null, 'a short hiccup');
  assert.equal(nextStallAction(room(), 'me', false, probe(1600)), 'stall');
  assert.equal(nextStallAction(room({ waitForAll: false }), 'me', false, probe(5000)), null, 'option off');
  assert.equal(nextStallAction(room({ isPlaying: false }), 'me', false, probe(5000)), null, 'room paused');
  assert.equal(nextStallAction(room({ videoId: null }), 'me', false, probe(5000)), null, 'nothing on');
});

test('ready again: playing smoothly, or enough buffered while the room waits for us', () => {
  const waiting = room({ isPlaying: false, waiting: { since: 0, peers: [{ id: 'me', name: 'Me' }] } });
  assert.equal(nextStallAction(waiting, 'me', true, probe(0, 1)), null, 'still filling the buffer');
  assert.equal(nextStallAction(waiting, 'me', true, probe(0, READY_AHEAD_S)), 'ready');
  assert.equal(nextStallAction(waiting, 'me', false, probe(0, 0, 1)), 'ready', 'fully loaded counts; even after a reload (not "asked")');
  assert.equal(nextStallAction(room(), 'me', true, probe(800)), null, 'room playing again but we are still stuck');
  assert.equal(nextStallAction(room(), 'me', true, probe(0)), 'ready');
  assert.equal(nextStallAction(room({ videoId: null }), 'me', true, probe(0)), 'ready', 'track gone: let go');
});

test('other listeners never send ready for someone else', () => {
  const waiting = room({ isPlaying: false, waiting: { since: 0, peers: [{ id: 'bo', name: 'Bo' }] } });
  assert.equal(nextStallAction(waiting, 'me', false, probe(0, 10, 1)), null);
});
