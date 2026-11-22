import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ListeningSession } from '../server/accounts/history';
import { LOCAL_SESSIONS_MAX, loadLocal, upsertLocal } from './localHistory';
import { moveLocalToAccount, type Upload } from './migrateHistory';

function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}
const session = (id: string, endedAt: number): ListeningSession => ({ id, roomId: 'jam', startedAt: endedAt - 60_000, endedAt, minutes: 3, people: [], tracks: [] });

test('uploads every session with its chat, oldest first, and clears what was accepted', async () => {
  const s = memory();
  upsertLocal(session('sess-new-001', 300), [], s);
  upsertLocal(session('sess-old-001', 100), [{ id: 'm1', name: 'Bo', text: 'hi', at: 1, mine: false }], s);
  const sent: string[] = [];
  const upload: Upload = async (x) => (sent.push(`${x.id}:${x.chat.length}`), true);
  assert.deepEqual(await moveLocalToAccount(upload, new Set(), s), { moved: 2, left: 0 });
  assert.deepEqual(sent, ['sess-old-001:1', 'sess-new-001:0']);
  assert.equal(loadLocal(s).sessions.length, 0);
});

test('failures stay on the device for next time; the visit in progress is skipped', async () => {
  const s = memory();
  upsertLocal(session('sess-aaa-001', 100), [], s);
  upsertLocal(session('sess-bbb-001', 200), [], s);
  upsertLocal(session('sess-live-01', 300), [], s);
  const upload: Upload = async (x) => {
    if (x.id === 'sess-bbb-001') throw new Error('offline');
    return true;
  };
  assert.deepEqual(await moveLocalToAccount(upload, new Set(['sess-live-01']), s), { moved: 1, left: 1 });
  assert.deepEqual(loadLocal(s).sessions.map((x) => x.id), ['sess-live-01', 'sess-bbb-001']);
});

test('older-visit stubs move in one request, and stay on the device if it fails', async () => {
  const s = memory();
  for (let i = 0; i < LOCAL_SESSIONS_MAX + 1; i++) upsertLocal(session(`sess-${String(i).padStart(6, '0')}`, 100_000 + i), [], s);
  const ok: Upload = async () => true;
  let sent = 0;
  await moveLocalToAccount(ok, new Set(['sess-000001']), s, async () => false);
  assert.equal(loadLocal(s).stubs.length, 1, 'kept for a retry');
  await moveLocalToAccount(ok, new Set(), s, async (stubs) => ((sent = stubs.length), true));
  assert.equal(sent, 1);
  assert.equal(loadLocal(s).stubs.length, 0);
});
