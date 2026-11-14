import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ListeningSession } from '../server/accounts/history';
import { LOCAL_SESSIONS_MAX, clearLocal, loadLocal, removeLocal, upsertLocal } from './localHistory';

function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), raw: m };
}
const session = (id: string, endedAt: number, minutes = 3): ListeningSession => ({ id, roomId: 'jam', startedAt: endedAt - 60_000, endedAt, minutes, people: [], tracks: [] });
const msg = (id: string, at: number) => ({ id, name: 'Bo', text: id, at, mine: false });

test('a visit is replaced as it grows, chat accumulates without duplicates', () => {
  const s = memory();
  upsertLocal(session('sess-a-0001', 100, 1), [msg('m1', 1)], s);
  upsertLocal(session('sess-a-0001', 200, 4), [msg('m1', 1), msg('m2', 2)], s);
  const h = loadLocal(s);
  assert.deepEqual(h.sessions.map((x) => [x.id, x.minutes]), [['sess-a-0001', 4]]);
  assert.deepEqual(h.chats['sess-a-0001']!.map((m) => m.id), ['m1', 'm2']);
});

test('keeps the newest sessions (and drops their chat), remove and clear', () => {
  const s = memory();
  for (let i = 0; i < LOCAL_SESSIONS_MAX + 3; i++) upsertLocal(session(`sess-${String(i).padStart(6, '0')}`, i), [msg(`m${i}`, i)], s);
  const h = loadLocal(s);
  assert.equal(h.sessions.length, LOCAL_SESSIONS_MAX);
  assert.equal(h.sessions[0]!.id, `sess-${String(LOCAL_SESSIONS_MAX + 2).padStart(6, '0')}`, 'newest first');
  assert.equal(h.chats['sess-000000'], undefined, "pruned sessions' chat goes too");
  removeLocal(h.sessions[0]!.id, s);
  assert.equal(loadLocal(s).sessions.length, LOCAL_SESSIONS_MAX - 1);
  clearLocal(s);
  assert.deepEqual(loadLocal(s), { sessions: [], chats: {} });
});

test('corrupt or missing storage reads as empty, and writes never throw', () => {
  const s = memory();
  s.raw.set('sub50:history', '{nope');
  assert.deepEqual(loadLocal(s), { sessions: [], chats: {} });
  assert.deepEqual(loadLocal(null), { sessions: [], chats: {} });
  const full = { ...memory(), setItem: () => { throw new Error('QuotaExceededError'); } };
  assert.doesNotThrow(() => upsertLocal(session('sess-a-0001', 1), [], full));
});
