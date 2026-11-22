import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAY_ALL_MAX, parsePlayList, playAllUrl, playItems, stashTitles, takeTitles } from './playAll';

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};
const A = 'dQw4w9WgXcQ';
const B = 'N9U9A4_cgyI';

test('?play= takes a list of valid ids, in order, without repeats', () => {
  assert.deepEqual(parsePlayList(A), [A]);
  assert.deepEqual(parsePlayList(`${B},${A},${B}, bad ,${'x'.repeat(12)}`), [B, A]);
  assert.deepEqual(parsePlayList(null), []);
  const many = Array.from({ length: 80 }, (_, i) => `video${String(i).padStart(6, '0')}`);
  assert.equal(parsePlayList(many.join(',')).length, PLAY_ALL_MAX);
});

test('a play-all link names the room and the songs', () => {
  assert.equal(playAllUrl('jam-1', [{ videoId: A, title: 'x' }, { videoId: B }]), `/?room=jam-1&play=${A},${B}`);
});

test('titles travel once through session storage', () => {
  const s = memory();
  stashTitles([{ videoId: A, title: 'Never' }, { videoId: B }], s);
  const titles = takeTitles(s);
  assert.deepEqual(titles, { [A]: 'Never' });
  assert.deepEqual(takeTitles(s), {}, 'cleared after use');
  assert.deepEqual(playItems([A, B], titles), [{ videoId: A, title: 'Never' }, { videoId: B }]);
  assert.deepEqual(takeTitles(null), {});
});
