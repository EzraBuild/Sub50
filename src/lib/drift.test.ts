import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseCorrection, expectedTime, median, nudgeDone, rateIsEffective } from './drift';

const steady = { aligning: false, rateSupported: true };

test('expectedTime extrapolates while playing and parks before a scheduled start', () => {
  const s = { isPlaying: true, lastTimestamp: 10, updatedAt: 1000 };
  assert.equal(expectedTime(s, 3500), 12.5);
  assert.equal(expectedTime(s, 800), 10, 'start is in the future: hold at lastTimestamp');
  assert.equal(expectedTime({ ...s, isPlaying: false }, 99_999), 10);
});

test('steady-state bands', () => {
  assert.deepEqual(chooseCorrection(0.03, steady), { kind: 'none' }, '< 50ms locked');
  assert.deepEqual(chooseCorrection(-0.12, steady), { kind: 'none' }, '50-150ms tolerated');
  assert.deepEqual(chooseCorrection(-0.2, steady), { kind: 'nudge', rate: 1.05 }, 'behind: speed up 5%');
  assert.deepEqual(chooseCorrection(0.25, steady), { kind: 'nudge', rate: 0.95 }, 'ahead: slow down 5%');
  assert.deepEqual(chooseCorrection(-0.5, steady), { kind: 'nudge', rate: 1.1 }, 'far behind: 10%');
  assert.deepEqual(chooseCorrection(0.45, steady), { kind: 'nudge', rate: 0.9 }, 'far ahead: 10%');
  assert.deepEqual(chooseCorrection(-0.7, steady), { kind: 'seek' }, '> 600ms: seek (a phone 500ms+ behind no longer waits ~10s)');
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

test('a nudge counts as working only if drift actually moves', () => {
  // 2s at 1.05 should close ~100ms. Phone behind by 500ms:
  assert.equal(rateIsEffective(-0.5, -0.41, 1.05, 2), true, 'closed 90ms of the expected 100ms');
  assert.equal(rateIsEffective(-0.5, -0.49, 1.05, 2), false, 'player ignored the rate: only 10ms');
  assert.equal(rateIsEffective(-0.5, -0.55, 1.05, 2), false, 'drift got worse (buffering)');
  // Ahead and slowing down at 10%: expect ~200ms over 2s.
  assert.equal(rateIsEffective(0.45, 0.3, 0.9, 2), true);
  assert.equal(rateIsEffective(0.45, 0.42, 0.9, 2), false);
});

test('median', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
});
