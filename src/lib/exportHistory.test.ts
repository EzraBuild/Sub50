import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ListeningSession } from '../server/accounts/history';
import { YOUTUBE_PLAYLIST_MAX, toCsv, toJson, youtubePlaylistUrl } from './exportHistory';

const V1 = 'dQw4w9WgXcQ';
const V2 = 'N9U9A4_cgyI';
const s = (id: string, endedAt: number, tracks: [string, string][], people: string[] = []): ListeningSession => ({
  id,
  roomId: 'jam',
  startedAt: Date.UTC(2026, 10, 15, 12, 0),
  endedAt,
  minutes: 3,
  people: people.map((name) => ({ name })),
  tracks: tracks.map(([videoId, title]) => ({ videoId, title })),
});

test('CSV: a row per song, quoted where needed, a row for songless sessions', () => {
  const csv = toCsv([s('a', 2, [[V1, 'Never, "Gonna"'], [V2, 'ABC']], ['Bo', 'Di']), s('b', 1, [])]);
  const lines = csv.trimEnd().split('\r\n');
  assert.equal(lines[0], 'started,room,minutes,listened with,video id,title,link');
  assert.equal(lines[1], `2026-11-15T12:00:00.000Z,jam,3,Bo; Di,${V1},"Never, ""Gonna""",https://youtu.be/${V1}`);
  assert.equal(lines.length, 4, 'header + 2 songs + 1 songless session');
  assert.match(lines[3]!, /,jam,3,,,,$/);
});

test('JSON carries the chat with each session', () => {
  const json = JSON.parse(toJson([s('a', 1, [[V1, 'x']])], { a: [{ id: 'm1', name: 'Bo', text: 'hi', at: 1, mine: false }] }, Date.UTC(2026, 10, 15)));
  assert.equal(json.app, 'Sub50');
  assert.equal(json.exportedAt, '2026-11-15T00:00:00.000Z');
  assert.equal(json.sessions[0].chat[0].text, 'hi');
});

test('YouTube playlist link: newest unique songs, capped at 50, null when empty', () => {
  assert.equal(youtubePlaylistUrl([]), null);
  assert.equal(youtubePlaylistUrl([s('a', 1, [[V1, ''], [V2, '']]), s('b', 2, [[V2, '']])]), `https://www.youtube.com/watch_videos?video_ids=${V2},${V1}`, 'V2 played most recently; V1 once');
  const many = s('c', 3, Array.from({ length: 80 }, (_, i) => [`v${String(i).padStart(10, '0')}`, ''] as [string, string]));
  assert.equal(new URL(youtubePlaylistUrl([many])!).searchParams.get('video_ids')!.split(',').length, YOUTUBE_PLAYLIST_MAX);
});
