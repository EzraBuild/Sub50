import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ListeningSession } from '../server/accounts/history';
import { formatMinutes, formatMusic, formatWhen, knownLengths, musicLength, summarizeTracks, totals } from './activity';

const V1 = 'dQw4w9WgXcQ';
const V2 = 'N9U9A4_cgyI';
const s = (id: string, roomId: string, endedAt: number, tracks: [string, string][]): ListeningSession => ({
  id,
  roomId,
  startedAt: endedAt - 60_000,
  endedAt,
  minutes: 1,
  people: [],
  tracks: tracks.map(([videoId, title]) => ({ videoId, title })),
});

test('songs across sessions: play counts, latest room, newest first, first real title', () => {
  const songs = summarizeTracks([s('a', 'late-night', 3000, [[V1, '']]), s('b', 'jam', 2000, [[V1, 'Never Gonna'], [V2, 'ABC']]), s('c', 'jam', 1000, [[V2, '']])]);
  assert.deepEqual(
    songs.map((x) => [x.videoId, x.plays, x.lastRoom, x.title]),
    [
      [V1, 2, 'late-night', 'Never Gonna'],
      [V2, 2, 'jam', 'ABC'],
    ],
  );
});

test('within one session, the later song is the more recent', () => {
  assert.deepEqual(summarizeTracks([s('a', 'jam', 1000, [[V1, ''], [V2, '']])]).map((x) => x.videoId), [V2, V1]);
});

test('durations and dates read naturally', () => {
  assert.equal(formatMinutes(0.4), '1 min');
  assert.equal(formatMinutes(47.2), '47 min');
  assert.equal(formatMinutes(125), '2 h 05');
  const now = new Date(2026, 10, 15, 12, 0).getTime();
  assert.match(formatWhen(new Date(2026, 10, 15, 9, 5).getTime(), now), /^today 09:05$/);
  assert.match(formatWhen(new Date(2026, 10, 14, 23, 30).getTime(), now), /^yesterday 23:30$/);
  assert.doesNotMatch(formatWhen(new Date(2026, 10, 5, 17, 20).getTime(), now), /today|yesterday/);
});

test('music per room: lengths added up, older songs borrow a length from a later play', () => {
  const old = s('a', 'jam', 1000, [[V1, 'one'], [V2, 'two']]); // from before lengths were kept
  const recent: ListeningSession = { ...s('b', 'jam', 2000, []), minutes: 4, tracks: [{ videoId: V1, title: 'one', seconds: 240 }] };
  const known = knownLengths([old, recent]);
  assert.deepEqual(musicLength(old.tracks, known), { seconds: 240, unknown: 1 });
  assert.equal(formatMusic(musicLength(old.tracks, known)), '4 min+', 'some unknown');
  assert.equal(formatMusic(musicLength(recent.tracks, known)), '4 min');
  assert.equal(formatMusic({ seconds: 0, unknown: 2 }), null, 'none known');
  assert.deepEqual(totals([old, recent]), { rooms: 2, minutes: 5, songs: 2, music: { seconds: 480, unknown: 1 } }, 'a song in two rooms counts in both');
});
