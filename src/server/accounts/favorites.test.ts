import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FAVORITES_MAX, MemoryFavorites, handleFavorites, parseFavoriteInput } from './favorites';

const V1 = 'dQw4w9WgXcQ';
const V2 = 'N9U9A4_cgyI';

test('signed out: every method is 401', async () => {
  const store = new MemoryFavorites();
  for (const m of ['GET', 'POST', 'DELETE']) assert.equal((await handleFavorites(m, null, store, {})).status, 401, m);
});

test('add, list newest first, re-save refreshes, remove', async () => {
  const store = new MemoryFavorites();
  await handleFavorites('POST', 'u1', store, { body: { videoId: V1, title: ' Never Gonna ' } }, 1000);
  await handleFavorites('POST', 'u1', store, { body: { videoId: V2, title: 'Jackson 5' } }, 2000);
  let list = (await handleFavorites('GET', 'u1', store, {})).body as { favorites: { videoId: string; title: string }[] };
  assert.deepEqual(list.favorites.map((f) => [f.videoId, f.title]), [[V2, 'Jackson 5'], [V1, 'Never Gonna']], 'newest first, trimmed');

  await handleFavorites('POST', 'u1', store, { body: { videoId: V1, title: 'Never Gonna' } }, 3000);
  list = (await handleFavorites('GET', 'u1', store, {})).body as typeof list;
  assert.equal(list.favorites[0]!.videoId, V1, 're-saving moves it to the top');
  assert.equal(list.favorites.length, 2, 'no duplicates');

  await handleFavorites('DELETE', 'u1', store, { videoId: V2 });
  list = (await handleFavorites('GET', 'u1', store, {})).body as typeof list;
  assert.deepEqual(list.favorites.map((f) => f.videoId), [V1]);
});

test('favorites are per account', async () => {
  const store = new MemoryFavorites();
  await handleFavorites('POST', 'u1', store, { body: { videoId: V1 } });
  const other = (await handleFavorites('GET', 'u2', store, {})).body as { favorites: unknown[] };
  assert.equal(other.favorites.length, 0);
});

test('bad input is rejected; the cap is enforced', async () => {
  const store = new MemoryFavorites();
  assert.equal((await handleFavorites('POST', 'u1', store, { body: { videoId: 'nope' } })).status, 400);
  assert.equal((await handleFavorites('POST', 'u1', store, { body: 'x' })).status, 400);
  assert.equal((await handleFavorites('DELETE', 'u1', store, { videoId: '../etc' })).status, 400);
  assert.equal((await handleFavorites('PUT', 'u1', store, {})).status, 405);
  assert.equal(parseFavoriteInput({ videoId: V1, title: 'x'.repeat(500) })!.title.length, 200);

  for (let i = 0; i < FAVORITES_MAX; i++) await store.add('u3', { videoId: `v${String(i).padStart(10, '0')}`, title: '', at: i });
  assert.equal((await handleFavorites('POST', 'u3', store, { body: { videoId: V1 } })).status, 409, 'over the cap');
  assert.equal((await handleFavorites('POST', 'u3', store, { body: { videoId: 'v0000000001' } })).status, 200, 're-saving an existing one is fine');
});
