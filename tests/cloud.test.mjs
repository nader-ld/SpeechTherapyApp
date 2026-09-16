import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createCloudClient, promptId } from '../public/js/cloud-client.js';
globalThis.crypto ||= webcrypto;
const email = 'owner@example.com';
const owner = () => ({ uid: 'owner', email, emailVerified: true });
const tick = () => new Promise((r) => setTimeout(r, 0));

function fixture({ snapshots = true, writeError = null } = {}) {
  const calls = [], listeners = [], events = [], errors = [];
  let callback, backend;
  const auth = { currentUser: null };
  const change = (u) => { auth.currentUser = u; return callback(u); };
  const authSDK = {
    getAuth: () => auth,
    onAuthStateChanged: (_a, cb) => { callback = cb; },
    signInWithEmailAndPassword: async (_a, e, p) => { calls.push(['signIn', e, p]); },
    createUserWithEmailAndPassword: async (_a, e, p) => { calls.push(['create', e, p]); },
    sendEmailVerification: async (u) => { calls.push(['verify', u.email]); },
    sendPasswordResetEmail: async (_a, e) => { calls.push(['reset', e]); },
    reload: async () => {},
    getIdToken: async (_u, force) => { calls.push(['token', force]); },
    signOut: async () => change(null),
  };
  const store = {
    clearLibrary: () => {}, loadData: (data, url) => calls.push(['library', data, url]),
    setBackend: (b) => { backend = b; }, clearLocal: () => calls.push(['clear']),
    replaceLog: (v) => calls.push(['log', v]), replaceCustomItems: (v) => calls.push(['prompts', v]),
    replacePrefs: (v) => calls.push(['prefs', v]),
  };
  const fsSDK = {
    initializeFirestore: () => ({}), persistentLocalCache: () => ({}), persistentMultipleTabManager: () => ({}),
    collection: (_db, ...parts) => parts.join('/'), doc: (base, ...parts) => [typeof base === 'string' ? base : '', ...parts].filter(Boolean).join('/'),
    setDoc: async (ref, value) => { calls.push(['write', ref, value]); if (writeError) throw writeError; },
    deleteDoc: async (ref) => { calls.push(['delete', ref]); },
    writeBatch: () => { const rows = []; return { delete: (ref) => rows.push(ref), commit: () => { calls.push(['batch', rows]); return new Promise(() => {}); } }; },
    onSnapshot: (ref, next, fail) => {
      const sub = { ref, next, fail, stopped: false }; listeners.push(sub);
      if (snapshots) queueMicrotask(() => next(ref === 'private/library' ? { exists: () => true, data: () => ({ json: JSON.stringify({ categories: [], exercises: [], weeks: [] }) }) } : { docs: [], exists: () => false }));
      return () => { sub.stopped = true; };
    },
  };
  const client = createCloudClient({ store, appSDK: { initializeApp: () => ({}) }, authSDK, fsSDK, config: {}, allowedEmail: email, readyTimeoutMs: 15 });
  client.init({ onUser: (...args) => events.push(args), onError: (...args) => errors.push(args) });
  return { client, calls, listeners, events, errors, authSDK, change, backend: () => backend };
}

test('email/password auth normalizes the owner email and blocks other addresses before SDK calls', async () => {
  const f = fixture();
  await f.client.signIn(' OWNER@EXAMPLE.COM ', 'test-password');
  await f.client.createAccount(email, 'new-password');
  await f.client.resetPassword(email);
  assert.deepEqual(f.calls, [['signIn', email, 'test-password'], ['create', email, 'new-password'], ['reset', email]]);
  await assert.rejects(f.client.signIn('other@example.com', 'x'), /not allowed/);
  await assert.rejects(f.client.createAccount('other@example.com', 'x'), /not allowed/);
  await assert.rejects(f.client.resetPassword('other@example.com'), /not allowed/);
  assert.equal(f.calls.length, 3);
});

test('unverified and wrong-account users never start Firestore sync', async () => {
  const f = fixture();
  await f.change({ ...owner(), emailVerified: false });
  assert.equal(f.listeners.length, 0);
  assert.equal(f.backend(), null);
  assert.equal(f.calls.length, 0, 'no automatic verification email or migration');
  await f.client.sendVerification();
  assert.deepEqual(f.calls, [['verify', email]]);
  await assert.rejects(f.client.checkVerification(), /not verified yet/);
  await f.change({ ...owner(), email: 'other@example.com' });
  assert.equal(f.listeners.length, 0);
  assert.equal(f.events.at(-1)[1].denied, true);
});

test('checking verification refreshes the token before opening sync', async () => {
  const f = fixture();
  const u = { ...owner(), emailVerified: false };
  await f.change(u);
  // reload mutates the same Firebase User instance after the link is opened.
  u.emailVerified = true;
  await f.client.checkVerification();
  assert.deepEqual(f.calls[0], ['token', true]);
  assert.equal(f.listeners.length, 4);
  assert.ok(f.backend());
  assert.equal(f.events.at(-1)[0].emailVerified, true);
  assert.equal(f.calls.filter((c) => c[0] === 'write').length, 0, 'no migration writes');
});

test('signing out during the first snapshot wait cannot restore the old user or backend', async () => {
  const f = fixture({ snapshots: false });
  const pending = f.change(owner());
  await f.client.signOut();
  await pending;
  assert.equal(f.backend(), null);
  assert.deepEqual(f.events, [[null]]);
  assert.ok(f.listeners.every((s) => s.stopped));
  const count = f.calls.length;
  f.listeners[0].next({ docs: [{ data: () => ({ id: 'stale' }) }] });
  assert.equal(f.calls.length, count, 'stale listener cannot repopulate local data');
});

test('permission-denied on a write disables sync and gates access', async () => {
  const f = fixture({ writeError: { code: 'permission-denied' } });
  await f.change(owner());
  f.backend().putSession({ id: 'session' });
  await tick();
  assert.equal(f.backend(), null);
  assert.equal(f.errors.at(-1)[1].denied, true);
  assert.ok(f.listeners.every((s) => s.stopped));
});

test('permission-denied on initial subscription cannot announce a signed-in user', async () => {
  const f = fixture({ snapshots: false });
  const pending = f.change(owner());
  f.listeners[0].fail({ code: 'permission-denied' });
  await pending;
  assert.equal(f.backend(), null);
  assert.equal(f.events.length, 0);
  assert.equal(f.errors[0][1].denied, true);
});

test('large offline deletes enqueue all batches without waiting for server acknowledgement', async () => {
  const f = fixture();
  await f.change(owner());
  f.backend().deleteSessions(Array.from({ length: 801 }, (_, i) => String(i)));
  assert.deepEqual(f.calls.filter((c) => c[0] === 'batch').map((c) => c[1].length), [400, 400, 1]);
});

test('prompt IDs distinguish the known 32-bit hash collision and ambiguous field boundaries', async () => {
  const a = await promptId('forbidden-word', 'review dnwet4 1b9g');
  const b = await promptId('forbidden-word', 'review qxyirt 1mfj');
  assert.notEqual(a, b);
  assert.match(a, /^[a-f0-9]{64}$/);
  assert.equal(a, await promptId('forbidden-word', 'review dnwet4 1b9g'));
  assert.notEqual(await promptId('a-b', 'c'), await promptId('a', 'b-c'));
});

test('the protected library is subscribed only for a verified owner and is loaded from its snapshot', async () => {
  const f = fixture();
  await f.change(null);
  assert.equal(f.listeners.length, 0);
  await f.change(owner());
  assert.ok(f.listeners.some((s) => s.ref === 'private/library'));
  assert.ok(f.calls.some((c) => c[0] === 'library'));
});

test('a delayed private library snapshot after sign-out is ignored', async () => {
  const f = fixture({ snapshots: false });
  const pending = f.change(owner());
  const library = f.listeners.find((s) => s.ref === 'private/library');
  await f.client.signOut();
  library.next({ exists: () => true, data: () => ({ json: '{}' }) });
  await pending;
  assert.equal(f.calls.some((c) => c[0] === 'library'), false);
});
