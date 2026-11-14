import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ChatMessage } from '../shared/protocol';
import { FRESH_MS, newIncoming, notificationText, withUnread } from './notify';

const NOW = 1_800_000_000_000;
const msg = (id: string, peerId: string, ago = 1000, text = 'hey'): ChatMessage => ({ id, peerId, name: peerId.toUpperCase(), text, at: NOW - ago });

test('only unseen, fresh messages from someone else alert', () => {
  const messages = [msg('1', 'bo'), msg('2', 'me'), msg('3', 'di'), msg('4', 'bo', FRESH_MS + 1)];
  assert.deepEqual(
    newIncoming(messages, new Set(['1']), 'me', NOW).map((m) => m.id),
    ['3'],
    'seen (1), own (2) and stale catch-up (4) are skipped',
  );
});

test('notification text: sender and room, long text trimmed, burst count', () => {
  assert.deepEqual(notificationText(msg('1', 'bo'), 'jam', 1), { title: 'BO · jam', body: 'hey' });
  assert.equal(notificationText(msg('1', 'bo', 0, 'x'.repeat(300)), 'jam', 1).body.length, 140);
  assert.equal(notificationText(msg('1', 'bo'), 'jam', 3).body, 'hey\n+2 more');
});

test('tab title carries the unread count', () => {
  assert.equal(withUnread('▶ Song — Sub50', 0), '▶ Song — Sub50');
  assert.equal(withUnread('▶ Song — Sub50', 3), '(3) ▶ Song — Sub50');
  assert.equal(withUnread('Sub50', 250), '(99+) Sub50');
});
