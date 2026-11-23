import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accessPass, setAccessPass, withPass } from './accessPass';

test('the socket URL carries the pass only when there is one', () => {
  setAccessPass(null);
  assert.equal(withPass('wss://x/api/ws'), 'wss://x/api/ws');
  setAccessPass('a.b+c/=');
  assert.equal(accessPass(), 'a.b+c/=');
  assert.equal(withPass('wss://x/api/ws'), 'wss://x/api/ws?pass=a.b%2Bc%2F%3D');
  assert.equal(withPass('wss://x/api/ws?v=1'), 'wss://x/api/ws?v=1&pass=a.b%2Bc%2F%3D');
  setAccessPass(null);
});
