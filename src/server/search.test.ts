import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemorySearchCache, SearchError, SearchLimiter, decodeEntities, handleSearch, parseIsoDuration, searchYouTube, type SearchResult } from './search';

const fakeYouTube = (calls: string[], opts: { quota?: boolean; videosFail?: boolean } = {}) => async (url: string) => {
  calls.push(url);
  if (url.includes('/search?')) {
    if (opts.quota) return { ok: false, status: 403, json: async () => ({ error: { errors: [{ reason: 'quotaExceeded' }] } }) };
    return {
      ok: true,
      status: 200,
      json: async () => ({
        items: [
          { id: { videoId: 'xNUh20a-Uyo' }, snippet: { title: 'Queens of the Stone Age - No One Knows', channelTitle: 'QOTSA' } },
          { id: { videoId: 'dQw4w9WgXcQ' }, snippet: { title: 'Rock &amp; Roll Don&#39;t Stop', channelTitle: 'Rick &quot;R&quot;' } },
          { id: { videoId: 'xNUh20a-Uyo' }, snippet: { title: 'duplicate' } },
          { id: { channelId: 'not-a-video' }, snippet: { title: 'channel' } },
        ],
      }),
    };
  }
  if (opts.videosFail) return { ok: false, status: 500, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => ({ items: [{ id: 'xNUh20a-Uyo', contentDetails: { duration: 'PT4M38S' } }, { id: 'dQw4w9WgXcQ', contentDetails: { duration: 'P0D' } }] }) };
};

test('durations and HTML entities', () => {
  assert.deepEqual(['PT4M38S', 'PT1H2M3S', 'PT45S', 'P1DT1S', 'P0D', 'junk', undefined].map(parseIsoDuration), [278, 3723, 45, 86401, null, null, null]);
  assert.equal(decodeEntities('Rock &amp; Roll &lt;3 Don&#39;t &#x2764; &bogus;'), 'Rock & Roll <3 Don\'t ❤ &bogus;');
});

test('search: videos only, no repeats, titles decoded, lengths from one videos call', async () => {
  const calls: string[] = [];
  const results = await searchYouTube('no one knows', 'KEY', fakeYouTube(calls));
  assert.deepEqual(results, [
    { videoId: 'xNUh20a-Uyo', title: 'Queens of the Stone Age - No One Knows', channel: 'QOTSA', seconds: 278 },
    { videoId: 'dQw4w9WgXcQ', title: "Rock & Roll Don't Stop", channel: 'Rick "R"', seconds: null },
  ]);
  assert.equal(calls.length, 2);
  const search = new URL(calls[0]!);
  assert.deepEqual([search.searchParams.get('type'), search.searchParams.get('videoEmbeddable'), search.searchParams.get('q')], ['video', 'true', 'no one knows']);
  assert.equal(new URL(calls[1]!).searchParams.get('id'), 'xNUh20a-Uyo,dQw4w9WgXcQ');

  const noLengths = await searchYouTube('x', 'KEY', fakeYouTube([], { videosFail: true }));
  assert.deepEqual(noLengths.map((r) => r.seconds), [null, null], 'lengths are best effort');
  await assert.rejects(searchYouTube('x', 'KEY', fakeYouTube([], { quota: true })), (e) => e instanceof SearchError && e.quota);
});

test('handleSearch: not set up, bad queries, cache, limit, quota', async () => {
  const one: SearchResult[] = [{ videoId: 'xNUh20a-Uyo', title: 'No One Knows', channel: 'QOTSA', seconds: 278 }];
  let searches = 0;
  const deps = { key: 'KEY', cache: new MemorySearchCache(), limiter: new SearchLimiter(), who: 'ip1', search: async () => (searches++, one) };

  assert.equal((await handleSearch('x', { ...deps, key: undefined })).status, 503);
  assert.equal((await handleSearch('   ', deps)).status, 400);
  assert.equal((await handleSearch('x'.repeat(101), deps)).status, 400);

  assert.deepEqual(await handleSearch('No One  Knows', deps), { status: 200, body: { results: one } });
  assert.deepEqual(await handleSearch('no one knows', deps), { status: 200, body: { results: one } });
  assert.equal(searches, 1, 'the same query (any case, any spacing) is served from the cache');

  const limiter = new SearchLimiter(() => 0);
  for (let i = 0; i < 20; i++) assert.ok(limiter.allow('ip2'));
  assert.equal((await handleSearch('fresh', { ...deps, limiter, who: 'ip2' })).status, 429);

  const quota = await handleSearch('another', { ...deps, search: async () => Promise.reject(new SearchError(true)) });
  assert.equal(quota.status, 503);
  assert.match((quota.body as { error: string }).error, /daily limit/);
  assert.equal((await handleSearch('broken', { ...deps, search: async () => Promise.reject(new Error('net')) })).status, 502);
});
