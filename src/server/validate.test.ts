import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseClientMessage } from './validate';

test('REACT only accepts the fixed palette', () => {
  assert.deepEqual(parseClientMessage(JSON.stringify({ type: 'REACT', roomId: 'jam', emoji: '🔥' })), { type: 'REACT', roomId: 'jam', emoji: '🔥' });
  assert.equal(parseClientMessage(JSON.stringify({ type: 'REACT', roomId: 'jam', emoji: '💩' })), null);
  assert.equal(parseClientMessage(JSON.stringify({ type: 'REACT', roomId: 'jam', emoji: '<img src=x>' })), null);
});

test('QUEUE_ADD_MANY: video ids only, 1..50 items, titles bounded', () => {
  const ok = { type: 'QUEUE_ADD_MANY', roomId: 'jam', items: [{ videoId: 'dQw4w9WgXcQ', title: 'Never' }, { videoId: 'N9U9A4_cgyI' }] };
  assert.deepEqual(parseClientMessage(JSON.stringify(ok)), ok);
  const bad = (items: unknown) => parseClientMessage(JSON.stringify({ type: 'QUEUE_ADD_MANY', roomId: 'jam', items }));
  assert.equal(bad([]), null);
  assert.equal(bad(Array.from({ length: 51 }, () => ({ videoId: 'dQw4w9WgXcQ' }))), null);
  assert.equal(bad([{ videoId: 'https://youtu.be/dQw4w9WgXcQ' }]), null);
  assert.equal(bad([{ videoId: 'dQw4w9WgXcQ', title: 'x'.repeat(201) }]), null);
  assert.equal(bad('nope'), null);
});
