/* Unit tests for public/js/store.js — run with `npm test` (node:test, no deps).
   Provides minimal localStorage and fetch shims so the browser module runs in Node. */
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/exercises.json'), 'utf8'));

// --- shims -------------------------------------------------------------
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
};
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => structuredClone(data) });

const store = await import('../public/js/store.js');

const iso = (d) => store.todayISO(d);
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };
const firstItemsExercise = data.exercises.find((e) => e.mode === 'items').id;

before(async () => { await store.loadData(data); });
beforeEach(() => { mem.clear(); store.loadData(data); });

// --- library -------------------------------------------------------------
test('loadData indexes exercises, categories and weeks', () => {
  assert.equal(store.state.byId.size, data.exercises.length);
  assert.equal(store.state.categories.size, data.categories.length);
  assert.equal(store.state.weeks.length, data.weeks.length);
  assert.ok(store.getExercise(firstItemsExercise));
  assert.equal(store.getExercise('nope'), null);
});

test('current week is the last listed week that has started (undated weeks count as started)', () => {
  const today = iso(new Date());
  const started = data.weeks.filter((w) => !w.startDate || w.startDate <= today);
  const expected = started.length ? started[started.length - 1].id : data.weeks[0]?.id;
  assert.equal(store.state.currentWeek?.id, expected);
  assert.deepEqual(store.state.weeks.map((w) => w.id), data.weeks.map((w) => w.id), 'array order is kept');
});

test('pickCurrentWeek skips future-dated weeks and keeps array order', async () => {
  const custom = structuredClone(data);
  custom.weeks = [
    { id: 'a', focus: 'A', exerciseIds: [firstItemsExercise] },
    { id: 'b', focus: 'B', startDate: '2000-01-03', exerciseIds: [firstItemsExercise] },
    { id: 'c', focus: 'C', startDate: '2999-01-01', exerciseIds: [firstItemsExercise] },
  ];
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => custom });
  try {
    await store.loadData(custom);
    assert.equal(store.state.currentWeek.id, 'b');
    assert.deepEqual(store.state.weeks.map((w) => w.id), ['a', 'b', 'c']);
    assert.equal(store.currentWeekStart(), '2000-01-03');
  } finally {
    globalThis.fetch = original;
    await store.loadData(data);
  }
});

test('items keep answer and timerSec fields', () => {
  const withAnswer = [...store.state.byId.values()].flatMap((e) => e.items).find((i) => i.answer);
  const withTimer = [...store.state.byId.values()].flatMap((e) => e.items).find((i) => i.timerSec);
  assert.ok(withAnswer, 'at least one prompt has an answer');
  assert.ok(withTimer, 'at least one prompt has a timer');
});

test('items are normalised to objects with a source', () => {
  for (const ex of store.state.byId.values()) {
    for (const it of ex.items) {
      assert.equal(typeof it.text, 'string');
      assert.ok(['therapist', 'self'].includes(it.source));
    }
  }
});

// --- dates ---------------------------------------------------------------
test('todayISO / parseLocalDate round-trip in local time', () => {
  const d = new Date(2026, 0, 5, 23, 30); // late evening local; UTC could be next day
  assert.equal(iso(d), '2026-01-05');
  const back = store.parseLocalDate('2026-01-05');
  assert.equal(back.getFullYear(), 2026);
  assert.equal(back.getMonth(), 0);
  assert.equal(back.getDate(), 5);
});

// --- custom prompts ------------------------------------------------------
test('custom prompts merge after therapist items and de-duplicate', () => {
  const ex = firstItemsExercise;
  const base = store.getItems(ex).length;
  assert.equal(store.addCustomItem(ex, '  Brand new phrase  '), true);
  assert.equal(store.addCustomItem(ex, 'brand new phrase'), false, 'case-insensitive duplicate');
  assert.equal(store.addCustomItem(ex, store.getExercise(ex).items[0].text), false, 'duplicate of therapist item');
  assert.equal(store.addCustomItem(ex, '   '), false, 'blank');
  const items = store.getItems(ex);
  assert.equal(items.length, base + 1);
  const last = items[items.length - 1];
  assert.deepEqual(last, { text: 'Brand new phrase', source: 'self', custom: true });
  store.removeCustomItem(ex, 'Brand new phrase');
  assert.equal(store.getItems(ex).length, base);
  assert.deepEqual(store.getCustomItems(), {});
});

// --- log -----------------------------------------------------------------
test('sessions are added, listed newest-first per exercise, and deleted', () => {
  const ex = firstItemsExercise;
  const a = store.addSession({ exerciseId: ex, durationSec: 60 });
  const b = store.addSession({ exerciseId: ex, durationSec: 30 });
  assert.equal(store.getLog().length, 2);
  assert.ok(a.id && b.id && a.id !== b.id);
  assert.equal(store.sessionsFor(ex)[0].id, b.id);
  assert.equal(store.doneToday(ex), true);
  assert.equal(store.doneToday('sample-timer'), false);
  store.deleteSession(a.id);
  assert.deepEqual(store.getLog().map((s) => s.id), [b.id]);
  store.clearLog();
  assert.deepEqual(store.getLog(), []);
});

test('stats: streak counts consecutive days ending today or yesterday', () => {
  const put = (d, sec) => {
    const log = store.getLog();
    log.push({ id: store.uid(), date: d.toISOString(), exerciseId: firstItemsExercise, durationSec: sec });
    localStorage.setItem('speech-practice:log:v1', JSON.stringify(log));
  };
  put(daysAgo(0), 120);
  put(daysAgo(1), 60);
  put(daysAgo(2), 60);
  put(daysAgo(4), 600); // gap at day 3 breaks the streak
  const s = store.stats();
  assert.equal(s.streak, 3);
  assert.equal(s.sessions, 4);
  assert.equal(s.totalMin, 14);

  // streak still counts if today has no session yet
  mem.clear();
  put(daysAgo(1), 60);
  put(daysAgo(2), 60);
  assert.equal(store.stats().streak, 2);

  mem.clear();
  put(daysAgo(2), 60);
  assert.equal(store.stats().streak, 0);
});

test('stats.thisWeek counts sessions since the current week started', () => {
  const start = store.currentWeekStart();
  const before = store.parseLocalDate(start); before.setDate(before.getDate() - 1);
  const log = [
    { id: '1', date: new Date().toISOString(), exerciseId: firstItemsExercise, durationSec: 10 },
    { id: '2', date: before.toISOString(), exerciseId: firstItemsExercise, durationSec: 10 },
  ];
  localStorage.setItem('speech-practice:log:v1', JSON.stringify(log));
  assert.equal(store.stats().thisWeek, 1);
});

// --- export / import -----------------------------------------------------
test('export/import merges without duplicating sessions or prompts', () => {
  const ex = firstItemsExercise;
  store.addSession({ exerciseId: ex, durationSec: 10 });
  store.addCustomItem(ex, 'mine one');
  const dump = store.exportAll();
  assert.equal(dump.app, 'speech-practice');
  assert.equal(dump.log.length, 1);

  // importing the same file again changes nothing
  let r = store.importAll(structuredClone(dump));
  assert.deepEqual(r, { sessions: 0, prompts: 0 });
  assert.equal(store.getLog().length, 1);
  assert.equal(store.getCustomItems()[ex].length, 1);

  // a file with new content is merged in
  const other = structuredClone(dump);
  other.log.push({ id: 'zzz', date: new Date().toISOString(), exerciseId: ex, durationSec: 5 });
  other.customItems[ex].push('mine two');
  r = store.importAll(other);
  assert.deepEqual(r, { sessions: 1, prompts: 1 });
  assert.equal(store.getLog().length, 2);
  assert.deepEqual(store.getCustomItems()[ex], ['mine one', 'mine two']);

  assert.throws(() => store.importAll('nope'), /Not a Speech Practice export/);
  assert.throws(() => store.importAll(null), /Not a Speech Practice export/);
});

test('prefs persist', () => {
  assert.equal(store.getPrefs().shuffle, false);
  store.setPref('shuffle', true);
  assert.equal(store.getPrefs().shuffle, true);
});

// --- robustness (Codex review, Sep 2026) ----------------------------------
test('a failed localStorage write throws StorageError and changes nothing', () => {
  const ex = firstItemsExercise;
  const realSet = globalThis.localStorage.setItem;
  const quota = Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
  globalThis.localStorage.setItem = () => { throw quota; };
  try {
    assert.throws(() => store.addSession({ exerciseId: ex, durationSec: 10 }), store.StorageError);
    assert.throws(() => store.addCustomItem(ex, 'will not fit'), /storage space/);
  } finally {
    globalThis.localStorage.setItem = realSet;
  }
  assert.equal(store.getLog().length, 0);
  assert.deepEqual(store.getCustomItems(), {});
});

test('import rejects the whole file when any session is invalid', () => {
  const ex = firstItemsExercise;
  const good = { id: 'ok', exerciseId: ex, date: new Date().toISOString(), durationSec: 5 };
  assert.throws(() => store.importAll({ log: [good, { id: 'bad', exerciseId: ex }] }), /Session 2 .* invalid/);
  assert.throws(() => store.importAll({ log: [{ ...good, durationSec: '12' }] }), /invalid/);
  assert.throws(() => store.importAll({ log: [{ ...good, rating: 7 }] }), /invalid/);
  assert.throws(() => store.importAll({ log: 'nope' }), /"log" must be a list/);
  assert.equal(store.getLog().length, 0, 'nothing was written');

  // duplicate ids inside one file count once
  const r = store.importAll({ log: [good, { ...good, durationSec: 99 }] });
  assert.deepEqual(r, { sessions: 1, prompts: 0 });
  assert.equal(store.getLog()[0].durationSec, 5);
});

test('malformed stored data is ignored instead of crashing views', () => {
  localStorage.setItem('speech-practice:log:v1', '{}');
  localStorage.setItem('speech-practice:custom-items:v1', '[1,2]');
  localStorage.setItem('speech-practice:prefs:v1', '"x"');
  assert.deepEqual(store.getLog(), []);
  assert.deepEqual(store.getCustomItems(), {});
  assert.equal(store.getPrefs().shuffle, false);
  assert.equal(store.stats().sessions, 0);

  localStorage.setItem('speech-practice:log:v1', JSON.stringify([
    { id: 'a', exerciseId: firstItemsExercise, date: new Date().toISOString(), durationSec: 30 },
    { id: 'b', exerciseId: firstItemsExercise }, // no date: would break the Log view
    { id: 'a', exerciseId: firstItemsExercise, date: new Date().toISOString(), durationSec: 1 }, // duplicate id
  ]));
  assert.deepEqual(store.getLog().map((s) => s.id), ['a']);
  assert.equal(store.newestFirst(store.getLog()).length, 1);
});

test('an attached backend receives every write and can replace the mirror', () => {
  const ex = firstItemsExercise;
  const calls = [];
  const rec = (name) => (...args) => calls.push([name, ...args]);
  store.setBackend({
    putSession: rec('putSession'), deleteSession: rec('deleteSession'), deleteSessions: rec('deleteSessions'),
    putPrompt: rec('putPrompt'), removePrompt: rec('removePrompt'), putPrefs: rec('putPrefs'),
  });
  try {
    assert.equal(store.hasBackend(), true);
    const s = store.addSession({ exerciseId: ex, durationSec: 10 });
    store.addCustomItem(ex, 'cloud prompt');
    store.setPref('shuffle', true);
    store.removeCustomItem(ex, 'cloud prompt');
    store.deleteSession(s.id);
    store.clearLog();
    assert.deepEqual(calls.map((c) => c[0]), ['putSession', 'putPrompt', 'putPrefs', 'removePrompt', 'deleteSession', 'deleteSessions']);
    assert.equal(calls[0][1].id, s.id);
    assert.deepEqual(calls[1].slice(1), [ex, 'cloud prompt']);

    // the cloud copy replaces whatever is on the device, dropping junk records
    store.replaceLog([{ id: 'r1', exerciseId: ex, date: new Date().toISOString(), durationSec: 3 }, { id: 'junk' }]);
    store.replaceCustomItems({ [ex]: ['from cloud', 'from cloud', ''] });
    assert.deepEqual(store.getLog().map((x) => x.id), ['r1']);
    assert.deepEqual(store.getCustomItems(), { [ex]: ['from cloud'] });
    store.clearLocal();
    assert.deepEqual(store.getLog(), []);
  } finally {
    store.setBackend(null);
  }
  assert.equal(store.hasBackend(), false);
});

test('answers carry an answerSource; ones written for the app are marked self', () => {
  const items = [...store.state.byId.values()].flatMap((e) => e.items).filter((i) => i.answer);
  assert.ok(items.length > 0);
  for (const it of items) assert.ok(['therapist', 'self'].includes(it.answerSource), it.text);
  const cards = store.getExercise('sample-cards').items;
  assert.equal(cards[0].answerSource, 'therapist');
  assert.equal(cards[1].answerSource, 'self');
});

test('import syncs a persisted log even if the following prompt write runs out of space', () => {
  const calls = [];
  store.setBackend({ putSession: (s) => calls.push(['session', s.id]), putPrompt: (ex, t) => calls.push(['prompt', ex, t]) });
  const dump = { log: [{ id: 'imported', exerciseId: firstItemsExercise, date: new Date().toISOString(), durationSec: 5 }], customItems: { [firstItemsExercise]: ['imported prompt'] } };
  const original = localStorage.setItem;
  localStorage.setItem = (k, v) => {
    if (k.includes('custom-items')) throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
    return original(k, v);
  };
  try {
    assert.throws(() => store.importAll(dump), store.StorageError);
    assert.deepEqual(calls, [['session', 'imported']]);
    localStorage.setItem = original;
    assert.deepEqual(store.importAll(dump), { sessions: 0, prompts: 1 });
    assert.deepEqual(calls, [['session', 'imported'], ['prompt', firstItemsExercise, 'imported prompt']]);
  } finally { localStorage.setItem = original; store.setBackend(null); }
});

test('private library and source URL are cleared on sign-out; source links reject unexpected origins', () => {
  store.loadData(data, 'https://docs.google.com/document/d/synthetic-test/edit');
  assert.ok(store.state.sourceDocumentUrl);
  store.clearLocal();
  assert.equal(store.state.data, null);
  assert.equal(store.state.byId.size, 0);
  assert.equal(store.state.sourceDocumentUrl, null);
  store.loadData(data, 'https://example.com/document/d/test/edit');
  assert.equal(store.state.sourceDocumentUrl, null);
  assert.throws(() => store.loadData(null), /missing or invalid/);
});
