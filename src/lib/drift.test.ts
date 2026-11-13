import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseCorrection, expectedTime, median, nudgeDone } from './drift';

const steady = { aligning: false, rateSupported: true };

test('expectedTime extrapolates while playing and parks before a scheduled start', () => {
  const s = { isPlaying: true, lastTimestamp: 10, updatedAt: 1000 };
  assert.equal(expectedTime(s, 3500), 12.5);
  assert.equal(expectedTime(s, 800), 10, 'start is in the future: hold at lastTimestamp');
  assert.equal(expectedTime({ ...s, isPlaying: false }, 99_999), 10);
});

test('steady-state bands match the spec', () => {
  assert.deepEqual(chooseCorrection(0.03, steady), { kind: 'none' }, '< 50ms locked');
  assert.deepEqual(chooseCorrection(-0.12, steady), { kind: 'none' }, '50-150ms tolerated');
  assert.deepEqual(chooseCorrection(-0.4, steady), { kind: 'nudge', rate: 1.05 }, 'behind: speed up');
  assert.deepEqual(chooseCorrection(0.9, steady), { kind: 'nudge', rate: 0.95 }, 'ahead: slow down');
  assert.deepEqual(chooseCorrection(1.6, steady), { kind: 'seek' }, '> 1.5s hard seek');
});

test('aligning after a discontinuity tightens the bands', () => {
  const aligning = { aligning: true, rateSupported: true };
  assert.deepEqual(chooseCorrection(0.08, aligning), { kind: 'nudge', rate: 0.95 });
  assert.deepEqual(chooseCorrection(-0.3, aligning), { kind: 'seek' });
});

test('falls back to seeking when the player ignores fractional rates', () => {
  const noRate = { aligning: false, rateSupported: false };
  assert.deepEqual(chooseCorrection(0.4, noRate), { kind: 'seek' });
  assert.deepEqual(chooseCorrection(0.1, noRate), { kind: 'none' });
});

test('nudge stops on target or on overshoot', () => {
  assert.equal(nudgeDone(-0.3, 1.05), false);
  assert.equal(nudgeDone(-0.01, 1.05), true);
  assert.equal(nudgeDone(0.04, 1.05), true, 'overshot past zero while speeding up');
  assert.equal(nudgeDone(-0.04, 0.95), true, 'overshot past zero while slowing down');
});

test('median', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
});
