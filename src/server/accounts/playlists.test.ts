import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryPlaylists, PLAYLISTS_MAX, PLAYLIST_TRACKS_MAX, handlePlaylist, handlePlaylistList, isPlaylistId, newPlaylistId, type PublicPlaylist } from './playlists';

const V1 = 'dQw4w9WgXcQ';
const V2 = 'N9U9A4_cgyI';
const V3 = '9bZkp7q19f0';
const ME = { id: 'user_me' };
const FRIEND = { id: 'user_friend' };
let n = 0;
const ids = () => `pl${String(++n).padStart(8, '0')}`;

async function create(store: MemoryPlaylists, body: Record<string, unknown> = {}) {
  const res = await handlePlaylistList('POST', ME, store, { name: 'Late night', ownerName: 'Ezra', ...body }, 1000, ids);
  return (res.body as { playlist: PublicPlaylist }).playlist;
}

test('ids look right and are unguessable-ish', () => {
  const a = newPlaylistId();
  assert.ok(isPlaylistId(a));
  assert.notEqual(a, newPlaylistId());
  assert.equal(isPlaylistId('../etc/pw'), false);
});

test('create, list mine, and the owner id never leaves the server', async () => {
  const store = new MemoryPlaylists();
  assert.equal((await handlePlaylistList('GET', null, store, null)).status, 401);
  const p = await create(store, { tracks: [{ videoId: V1, title: 'Never' }, { videoId: V1, title: 'dup' }, { videoId: 'bad' }] });
  assert.equal(p.visibility, 'private', 'private by default');
  assert.deepEqual(p.tracks.map((t) => t.videoId), [V1], 'de-duplicated, invalid dropped');
  assert.equal('ownerId' in p, false);
  assert.equal(p.owned, true);
  const mine = (await handlePlaylistList('GET', ME, store, null)).body as { playlists: { name: string; count: number; cover: string }[] };
  assert.deepEqual(mine.playlists.map((x) => [x.name, x.count, x.cover]), [['Late night', 1, V1]]);
  assert.equal((await handlePlaylistList('POST', ME, store, { name: '   ' })).status, 400, 'needs a name');
});

test('private is invisible to others; shared by link is readable but not editable', async () => {
  const store = new MemoryPlaylists();
  const p = await create(store);
  assert.equal((await handlePlaylist('GET', FRIEND, store, p.id, {})).status, 404);
  assert.equal((await handlePlaylist('GET', null, store, p.id, {})).status, 404);
  await handlePlaylist('PATCH', ME, store, p.id, { body: { op: 'update', visibility: 'link' } });
  const seen = (await handlePlaylist('GET', null, store, p.id, {})).body as { playlist: PublicPlaylist };
  assert.equal(seen.playlist.owned, false);
  assert.equal(seen.playlist.ownerName, 'Ezra');
  assert.equal((await handlePlaylist('PATCH', FRIEND, store, p.id, { body: { op: 'add', videoId: V2 } })).status, 403);
  assert.equal((await handlePlaylist('DELETE', null, store, p.id, {})).status, 401);
});

test('add (no duplicates), move, remove, rename', async () => {
  const store = new MemoryPlaylists();
  const p = await create(store);
  for (const v of [V1, V2, V3]) await handlePlaylist('PATCH', ME, store, p.id, { body: { op: 'add', videoId: v, title: v } }, 2000);
  const again = await handlePlaylist('PATCH', ME, store, p.id, { body: { op: 'add', videoId: V2 } });
  assert.equal((again.body as { already?: boolean }).already, true);
  await handlePlaylist('PATCH', ME, store, p.id, { body: { op: 'move', from: 2, to: 0 } });
  await handlePlaylist('PATCH', ME, store, p.id, { body: { op: 'remove', videoId: V1 } });
  const res = await handlePlaylist('PATCH', ME, store, p.id, { body: { op: 'update', name: '  Sunday  ', description: 'slow ones' } }, 3000);
  const out = (res.body as { playlist: PublicPlaylist }).playlist;
  assert.deepEqual(out.tracks.map((t) => t.videoId), [V3, V2]);
  assert.deepEqual([out.name, out.description, out.updatedAt], ['Sunday', 'slow ones', 3000]);
  assert.equal((await handlePlaylist('PATCH', ME, store, p.id, { body: { op: 'move', from: 0, to: 9 } })).status, 400);
  assert.equal((await handlePlaylist('PATCH', ME, store, p.id, { body: { op: 'explode' } })).status, 400);
});

test('copy a shared playlist into mine (private), and caps', async () => {
  const store = new MemoryPlaylists();
  const p = await create(store, { tracks: [{ videoId: V1, title: 'x' }], visibility: 'link' });
  assert.equal((await handlePlaylist('POST', null, store, p.id, { copy: true })).status, 401);
  const res = await handlePlaylist('POST', FRIEND, store, p.id, { copy: true, ownerName: 'Bo' }, 5000, ids);
  const copy = (res.body as { playlist: PublicPlaylist }).playlist;
  assert.deepEqual([copy.owned, copy.visibility, copy.ownerName, copy.tracks.length], [true, 'private', 'Bo', 1]);
  assert.notEqual(copy.id, p.id);
  assert.equal(((await handlePlaylist('POST', ME, store, p.id, { copy: true }, 5000, ids)).body as { playlist: PublicPlaylist }).playlist.name, 'Late night (copy)');

  const full = await create(store);
  const pl = await store.get(full.id);
  pl!.tracks = Array.from({ length: PLAYLIST_TRACKS_MAX }, (_, i) => ({ videoId: `v${String(i).padStart(10, '0')}`, title: '', addedAt: 0 }));
  await store.put(pl!);
  assert.equal((await handlePlaylist('PATCH', ME, store, full.id, { body: { op: 'add', videoId: V3 } })).status, 409);
  const many = new MemoryPlaylists();
  for (let i = 0; i < PLAYLISTS_MAX; i++) await create(many);
  assert.equal((await handlePlaylistList('POST', ME, many, { name: 'one more' })).status, 409);
});
