import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseClientMessage } from './validate';

test('REACT only accepts the fixed palette', () => {
  assert.deepEqual(parseClientMessage(JSON.stringify({ type: 'REACT', roomId: 'jam', emoji: '🔥' })), { type: 'REACT', roomId: 'jam', emoji: '🔥' });
  assert.equal(parseClientMessage(JSON.stringify({ type: 'REACT', roomId: 'jam', emoji: '💩' })), null);
  assert.equal(parseClientMessage(JSON.stringify({ type: 'REACT', roomId: 'jam', emoji: '<img src=x>' })), null);
});
