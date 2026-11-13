import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClockSync } from './clock';

// Server clock runs 5000ms ahead of ours; one-way latency is `up` out, `down` back.
const TRUE_OFFSET = 5000;
function sample(clock: ClockSync, sentAt: number, up: number, down: number) {
  const serverTime = sentAt + up + TRUE_OFFSET;
  clock.addSample(sentAt, serverTime, sentAt + up + down);
}

test('symmetric round trips recover the exact offset and rtt', () => {
  const c = new ClockSync();
  for (let i = 0; i < 5; i++) sample(c, 1000 + i * 100, 10, 10);
  assert.equal(c.offset, TRUE_OFFSET);
  assert.equal(c.rtt, 20);
});

test('slow, asymmetric samples (busy main thread, Wi-Fi wakeups) do not skew the offset', () => {
  const c = new ClockSync();
  for (let i = 0; i < 4; i++) sample(c, 1000 + i * 100, 4, 4); // fast, symmetric
  sample(c, 2000, 4, 180); // reply sat in a queue for 180ms
  sample(c, 2100, 150, 4); // request delayed on the way out
  assert.ok(Math.abs(c.offset - TRUE_OFFSET) < 0.001, `offset ${c.offset}`);
});

test('reset keeps the last offset so the timeline does not jump while re-sampling', () => {
  const c = new ClockSync();
  sample(c, 1000, 5, 5);
  c.reset();
  assert.equal(c.offset, TRUE_OFFSET);
  assert.equal(c.rtt, null);
  assert.equal(c.sampleCount, 0);
});
