import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HISTORY_MAX, MemoryHistory, SESSION_CHAT_MAX, handleHistory, parseChat, parseSession, summarizePeople, type ListeningSession } from './history';

const NOW = 1_800_000_000_000;
const session = (over: Partial<ListeningSession> = {}): ListeningSession => ({
  id: 'sess-0001-abcd',
  roomId: 'jam-room',
  startedAt: NOW - 30 * 60_000,
  endedAt: NOW - 60_000,
  minutes: 25,
  people: [{ name: 'Bo' }, { name: 'Di' }],
  tracks: [{ videoId: 'dQw4w9WgXcQ', title: 'Never Gonna' }],
  ...over,
});

test('signed out: 401', async () => {
  for (const m of ['GET', 'POST', 'DELETE']) assert.equal((await handleHistory(m, null, new MemoryHistory(), {})).status, 401);
});

test('upsert replaces the growing session; list newest first with a people summary', async () => {
  const store = new MemoryHistory();
  await handleHistory('POST', 'u1', store, { body: session({ minutes: 5, endedAt: NOW - 20 * 60_000 }) }, NOW);
  await handleHistory('POST', 'u1', store, { body: session() }, NOW); // same id, longer
  await handleHistory('POST', 'u1', store, { body: session({ id: 'sess-0002-abcd', people: [{ name: 'bo' }], minutes: 10, startedAt: NOW - 11 * 60_000, endedAt: NOW }) }, NOW);
  const { sessions, people } = (await handleHistory('GET', 'u1', store, {})).body as { sessions: ListeningSession[]; people: ReturnType<typeof summarizePeople> };
  assert.deepEqual(sessions.map((s) => [s.id, s.minutes]), [['sess-0002-abcd', 10], ['sess-0001-abcd', 25]]);
  assert.deepEqual(people.map((p) => [p.name, p.sessions, p.minutes]), [['bo', 2, 35], ['Di', 1, 25]], 'grouped by name, case-insensitive; latest spelling wins');
});

test('under a minute is not recorded; bad sessions are rejected', async () => {
  const store = new MemoryHistory();
  assert.equal((await handleHistory('POST', 'u1', store, { body: session({ minutes: 0.4 }) }, NOW)).status, 202);
  assert.equal((await store.list('u1')).length, 0);
  const bad = [
    session({ id: 'x' }),
    session({ roomId: 'NOT VALID!' }),
    session({ startedAt: NOW, endedAt: NOW - 1 }), // ends before it starts
    session({ minutes: 999 }), // more minutes than the session lasted
  ];
  for (const b of bad) assert.equal((await handleHistory('POST', 'u1', store, { body: b }, NOW)).status, 400, JSON.stringify(b).slice(0, 60));
});

test('a client clock running fast is shifted to server time', () => {
  const s = parseSession(session({ startedAt: NOW + 3_600_000 - 600_000, endedAt: NOW + 3_600_000, minutes: 9 }), NOW)!;
  assert.deepEqual([s.startedAt, s.endedAt], [NOW - 600_000, NOW]);
});

test('parseSession de-duplicates and caps people and tracks', () => {
  const s = parseSession(
    session({
      people: [{ name: '  Bo  ' }, { name: 'bo' }, { name: '' }, ...Array.from({ length: 80 }, (_, i) => ({ name: `P${i}` }))],
      tracks: [{ videoId: 'dQw4w9WgXcQ', title: 'a' }, { videoId: 'dQw4w9WgXcQ', title: 'dup' }, { videoId: 'bad', title: 'x' }],
    }),
    NOW,
  )!;
  assert.equal(s.people[0]!.name, 'Bo');
  assert.equal(s.people.length, 50);
  assert.deepEqual(s.tracks.map((t) => t.title), ['a']);
});

test('history keeps the newest sessions only; delete removes one', async () => {
  const store = new MemoryHistory();
  for (let i = 0; i < HISTORY_MAX + 5; i++) await store.upsert('u1', session({ id: `sess-${String(i).padStart(6, '0')}`, endedAt: NOW - (HISTORY_MAX + 5 - i) * 1000 }));
  const list = await store.list('u1');
  assert.equal(list.length, HISTORY_MAX);
  assert.equal(list.at(-1)!.id, 'sess-000005', 'the oldest five were dropped');
  await handleHistory('DELETE', 'u1', store, { sessionId: list[0]!.id });
  assert.equal((await store.list('u1')).length, HISTORY_MAX - 1);
});

const chatMsg = (id: string, at: number, text = 'hi') => ({ id, name: 'Bo', text, at, mine: false });

test('chat posted with a session is kept with it, de-duplicated, oldest first', async () => {
  const store = new MemoryHistory();
  await handleHistory('POST', 'u1', store, { body: { ...session(), chat: [chatMsg('m2', 2), chatMsg('m1', 1)] } }, NOW);
  await handleHistory('POST', 'u1', store, { body: { ...session({ minutes: 26 }), chat: [chatMsg('m2', 2), chatMsg('m3', 3)] } }, NOW); // m2 re-sent
  const res = await handleHistory('GET', 'u1', store, { sessionId: 'sess-0001-abcd' });
  assert.deepEqual((res.body as { chat: { id: string }[] }).chat.map((m) => m.id), ['m1', 'm2', 'm3']);
  assert.equal((await handleHistory('GET', 'u1', store, { sessionId: '../x' })).status, 400);
  assert.equal(((await handleHistory('GET', 'u2', store, { sessionId: 'sess-0001-abcd' })).body as { chat: unknown[] }).chat.length, 0, 'per account');
});

test('chat is capped per session and removed with the session', async () => {
  const store = new MemoryHistory();
  await store.appendChat('u1', 'sess-0001-abcd', Array.from({ length: SESSION_CHAT_MAX + 30 }, (_, i) => chatMsg(`m${i}`, i)));
  assert.equal((await store.listChat('u1', 'sess-0001-abcd')).length, SESSION_CHAT_MAX);
  await store.upsert('u1', session());
  await handleHistory('DELETE', 'u1', store, { sessionId: 'sess-0001-abcd' });
  assert.equal((await store.listChat('u1', 'sess-0001-abcd')).length, 0);
});

test('parseChat drops bad messages and trims long ones', () => {
  const parsed = parseChat([chatMsg('ok', 1), { id: 'bad id!', text: 'x', at: 1 }, { id: 'e', text: '   ', at: 1 }, { id: 'n', text: 'x', at: 'later' }, { ...chatMsg('long', 2), text: 'y'.repeat(900), mine: true }, 'junk']);
  assert.deepEqual(parsed.map((m) => [m.id, m.text.length, m.mine]), [['ok', 2, false], ['long', 500, true]]);
  assert.deepEqual(parseChat('nope'), []);
});
