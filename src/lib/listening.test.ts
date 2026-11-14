import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSession } from '../server/accounts/history';
import { CHAT_PER_SEND, ListeningTracker } from './listening';

const V1 = 'dQw4w9WgXcQ';
const V2 = 'N9U9A4_cgyI';

test('counts only time the room was playing; collects co-listeners and tracks', () => {
  const t = new ListeningTracker('sess-0001-abcd', 'jam', () => 'Me', 0);
  t.tick(30_000, { playing: false, videoId: V1, title: null, others: ['Bo'] }); // paused: nothing counts
  t.tick(60_000, { playing: true, videoId: V1, title: null, others: ['Bo', ' me '] });
  t.tick(90_000, { playing: true, videoId: V1, title: 'Never Gonna', others: ['Bo', 'Di'] });
  t.tick(120_000, { playing: true, videoId: V2, title: 'ABC', others: [] });
  const s = t.snapshot();
  assert.equal(s.minutes, 1.5);
  assert.deepEqual(s.people, [{ name: 'Bo' }, { name: 'Di' }], 'yourself (any case) is never a co-listener');
  assert.deepEqual(s.tracks, [{ videoId: V1, title: 'Never Gonna' }, { videoId: V2, title: 'ABC' }], 'titles fill in once known');
  assert.equal(s.endedAt, 120_000);
});

test('a long gap (sleep) counts at most one tick window', () => {
  const t = new ListeningTracker('sess-0001-abcd', 'jam', () => 'Me', 0);
  t.tick(3_600_000, { playing: true, videoId: V1, title: 'x', others: [] });
  assert.equal(t.minutes, 1.2);
});

test('pending: nothing under a minute, then only when something changed', () => {
  const t = new ListeningTracker('sess-0001-abcd', 'jam', () => 'Me', 0);
  t.tick(50_000, { playing: true, videoId: V1, title: 'x', others: [] });
  assert.equal(t.pending(), null, 'under a minute');
  t.tick(70_000, { playing: true, videoId: V1, title: 'x', others: [] });
  const first = t.pending()!;
  assert.equal(first.minutes, 1.2);
  t.markSent(first);
  assert.equal(t.pending(), null, 'unchanged since the last send');
  t.tick(80_000, { playing: false, videoId: V1, title: 'x', others: ['Bo'] });
  assert.equal(t.pending(), null, 'pausing changes nothing');
  t.tick(110_000, { playing: true, videoId: V1, title: 'x', others: ['Bo'] });
  assert.equal(t.pending()!.people.length, 1);
});

test('what the tracker sends passes server validation unchanged', () => {
  const start = 1_800_000_000_000;
  const t = new ListeningTracker('AbCdEfGhIjKlMnOp-m3x9k2', 'friday-jam', () => 'Me', start);
  for (let i = 1; i <= 30; i++) t.tick(start + i * 5_000, { playing: true, videoId: i < 20 ? V1 : V2, title: 'x', others: ['Bo', 'Di'] });
  const sent = t.pending()!;
  const { chat: _chat, ...session } = sent;
  assert.deepEqual(parseSession(sent, start + 150_000), session);
});

test('chat from after you entered rides along, each message sent once, in chunks', () => {
  const t = new ListeningTracker('sess-0001-abcd', 'jam', () => 'Me', 0);
  const msg = (id: string, at: number, peerId = 'bo') => ({ id, peerId, name: peerId, text: `t${id}`, at });
  t.addChat([msg('old', 900), msg('a', 1000), msg('b', 1001, 'me')], 'me', 1000); // 'old' was before you came in
  t.tick(70_000, { playing: true, videoId: V1, title: 'x', others: [] });
  const first = t.pending()!;
  assert.deepEqual(first.chat.map((m) => [m.id, m.mine]), [['a', false], ['b', true]]);
  t.markSent(first);
  assert.equal(t.pending(), null, 'nothing new');
  t.addChat(Array.from({ length: 100 }, (_, i) => msg(`n${i}`, 2000 + i)), 'me', 1000);
  const next = t.pending()!;
  assert.equal(next.chat.length, CHAT_PER_SEND, 'chunked');
  t.markSent(next);
  assert.equal(t.pending()!.chat.length, 100 - CHAT_PER_SEND, 'the rest next time');
});
