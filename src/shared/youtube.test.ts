import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseYouTubeId } from './youtube';

const ID = 'dQw4w9WgXcQ';

test('parses every supported URL shape', () => {
  const cases = [
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}&t=42s`,
    `https://www.youtube.com/watch?feature=share&v=${ID}`,
    `http://m.youtube.com/watch?v=${ID}`,
    `https://music.youtube.com/watch?v=${ID}&list=RDAMVM${ID}`,
    `https://youtu.be/${ID}`,
    `https://youtu.be/${ID}?si=abc123&t=10`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://youtube.com/shorts/${ID}?feature=share`,
    `https://www.youtube.com/embed/${ID}?autoplay=1`,
    `https://www.youtube-nocookie.com/embed/${ID}`,
    `https://www.youtube.com/live/${ID}`,
    `youtube.com/watch?v=${ID}`,
    `youtu.be/${ID}`,
    `  https://youtu.be/${ID}  `,
    ID,
  ];
  for (const url of cases) assert.equal(parseYouTubeId(url), ID, url);
});

test('rejects non-YouTube or malformed input', () => {
  const cases = [
    '',
    'hello world',
    'https://vimeo.com/123456789',
    `https://notyoutube.com/watch?v=${ID}`,
    `https://example.com/?v=${ID}`,
    'https://www.youtube.com/watch?v=short',
    `https://www.youtube.com/watch?v=${ID}extra`,
    'https://www.youtube.com/channel/UC1234567890',
  ];
  for (const url of cases) assert.equal(parseYouTubeId(url), null, url);
});
