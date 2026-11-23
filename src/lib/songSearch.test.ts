import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setAccessPass } from './accessPass';
import { searchSongs } from './songSearch';

const realFetch = globalThis.fetch;
const reply = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status });

test('search sends the invite-only pass and returns the results', async () => {
  let seen: { url: string; pass: string | null } | null = null;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    seen = { url, pass: new Headers(init?.headers).get('x-sub50-pass') };
    return new Response(JSON.stringify({ results: [{ videoId: 'abcdefghijk', title: 'Song', channel: 'C', seconds: 200 }] }));
  }) as typeof fetch;
  setAccessPass('p.1');
  const results = await searchSongs('no one knows');
  assert.equal(results[0]?.title, 'Song');
  assert.deepEqual(seen, { url: '/api/search?q=no%20one%20knows', pass: 'p.1' });
  setAccessPass(null);
  globalThis.fetch = realFetch;
});

test('search errors carry the message to show', async () => {
  globalThis.fetch = reply(403, { error: 'Sub50 is private for now.' }) as typeof fetch;
  await assert.rejects(searchSongs('x'), /private for now/);
  globalThis.fetch = reply(500, {}) as typeof fetch;
  await assert.rejects(searchSongs('x'), /Search failed/);
  globalThis.fetch = (async () => Promise.reject(new TypeError('offline'))) as typeof fetch;
  await assert.rejects(searchSongs('x'), /Couldn’t reach search/);
  globalThis.fetch = realFetch;
});
