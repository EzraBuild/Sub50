import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryAccess, allowedEmail, handleAccessAdmin, inForce, ownerEmails, passAllows, readPass, signPass } from './access';

const OWNER = 'owner@example.com';
const SECRET = 'test-secret';

test('owners come from the env list; private mode needs one to count', () => {
  assert.deepEqual(ownerEmails(' Owner@Example.com , not-an-email,b@x.io '), ['owner@example.com', 'b@x.io']);
  assert.deepEqual(ownerEmails(undefined), []);
  assert.equal(inForce({ private: true, allowed: [] }, []), false, 'no owner: ignored, so nobody is locked out');
  assert.equal(inForce({ private: true, allowed: [] }, [OWNER]), true);
});

test('who may use it: owners and allowed emails, any case', () => {
  const state = { private: true, allowed: ['bo@example.com'] };
  assert.equal(allowedEmail(['x@y.z', 'OWNER@example.com'], state, [OWNER]), OWNER);
  assert.equal(allowedEmail(['Bo@Example.com'], state, [OWNER]), 'bo@example.com');
  assert.equal(allowedEmail(['stranger@example.com'], state, [OWNER]), null);
});

test('passes: signed, tamper-proof, expiring', () => {
  const pass = signPass('bo@example.com', SECRET, 1000, 5000);
  assert.equal(readPass(pass, SECRET, 2000), 'bo@example.com');
  assert.equal(readPass(pass, SECRET, 7000), null, 'expired');
  assert.equal(readPass(pass, 'other-secret', 2000), null, 'wrong secret');
  const [payload, sig] = pass.split('.');
  const forged = Buffer.from(JSON.stringify({ m: OWNER, e: 9e15 })).toString('base64url');
  assert.equal(readPass(`${forged}.${sig}`, SECRET, 2000), null, 'swapped payload');
  assert.equal(readPass(`${payload}.x${sig!.slice(1)}`, SECRET, 2000), null, 'bad signature');
  assert.equal(readPass(null, SECRET), null);
  assert.equal(readPass('junk', SECRET), null);
});

test('the socket and search: open when off, a valid pass for a listed email when on', async () => {
  const store = new MemoryAccess();
  const deps = { store, owners: [OWNER], secret: SECRET };
  assert.equal(await passAllows(null, deps), true, 'off: anyone');
  await store.setPrivate(true);
  assert.equal(await passAllows(null, deps), false, 'on: no pass');
  await store.allow('bo@example.com');
  const bo = signPass('bo@example.com', SECRET);
  assert.equal(await passAllows(bo, deps), true);
  assert.equal(await passAllows(signPass(OWNER, SECRET), deps), true, 'owner');
  await store.remove('bo@example.com');
  assert.equal(await passAllows(bo, deps), false, 'removed: the old pass stops working');
  assert.equal(await passAllows(bo, { ...deps, secret: null }), false, 'no secret: refuse rather than trust');
  assert.equal(await passAllows(null, { ...deps, owners: [] }), true, 'no owner configured: ignored');
});

test('owner API: only owners, switch and list', async () => {
  const store = new MemoryAccess();
  const owners = [OWNER];
  assert.equal((await handleAccessAdmin('GET', null, store, owners)).status, 401);
  assert.equal((await handleAccessAdmin('GET', { emails: ['bo@example.com'] }, store, owners)).status, 403);
  const me = { emails: ['Owner@Example.com'] };
  assert.deepEqual((await handleAccessAdmin('GET', me, store, owners)).body, { private: false, allowed: [], owners });
  let r = await handleAccessAdmin('POST', me, store, owners, { private: true, allow: ' Bo@Example.com ' });
  assert.deepEqual(r.body, { private: true, allowed: ['bo@example.com'], owners });
  assert.equal((await handleAccessAdmin('POST', me, store, owners, { allow: 'nope' })).status, 400);
  r = await handleAccessAdmin('POST', me, store, owners, { remove: 'BO@example.com', private: false });
  assert.deepEqual(r.body, { private: false, allowed: [], owners });
  assert.equal((await handleAccessAdmin('DELETE', me, store, owners)).status, 405);
});
