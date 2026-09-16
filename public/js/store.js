/* Data access: exercise library (JSON) + user data.

   User data (sessions, custom prompts, prefs) is always mirrored in localStorage so
   every view can read it synchronously. When a backend is attached (see cloud.js),
   each write is also forwarded to it and the backend replaces the mirror whenever
   the cloud copy changes. Without a backend the mirror is the only copy. */

const LOG_KEY = 'speech-practice:log:v1';
const CUSTOM_KEY = 'speech-practice:custom-items:v1';
const PREFS_KEY = 'speech-practice:prefs:v1';

export const state = {
  data: null,
  byId: new Map(),
  categories: new Map(),
  weeks: [],
  currentWeek: null,
  sourceDocumentUrl: null,
};

/* ---------- exercise library ---------- */

export function loadData(data, sourceDocumentUrl = null) {
  if (!data || !Array.isArray(data.categories) || !Array.isArray(data.exercises) || !Array.isArray(data.weeks)) {
    throw new Error('The private exercise library is missing or invalid.');
  }
  state.sourceDocumentUrl = /^https:\/\/docs\.google\.com\/document\/d\/[A-Za-z0-9_-]+\/edit(?:[?#].*)?$/.test(sourceDocumentUrl || '') ? sourceDocumentUrl : null;
  state.data = data;
  state.categories = new Map((data.categories || []).map((c) => [c.id, c]));
  state.byId = new Map((data.exercises || []).map((ex) => [ex.id, normalizeExercise(ex)]));
  state.weeks = [...(data.weeks || [])]; // array order is chronological, oldest first
  state.currentWeek = pickCurrentWeek(state.weeks);
  return state;
}

export function clearLibrary() {
  state.data = null;
  state.byId = new Map();
  state.categories = new Map();
  state.weeks = [];
  state.currentWeek = null;
  state.sourceDocumentUrl = null;
}

function normalizeExercise(ex) {
  const items = (ex.items || []).map((raw) => {
    const it = typeof raw === 'string' ? { text: raw, source: 'therapist' } : { source: 'therapist', ...raw };
    // Who wrote the answer: defaults to whoever wrote the prompt.
    if (it.answer && !it.answerSource) it.answerSource = it.source;
    return it;
  });
  return { source: 'therapist', tips: [], ...ex, items };
}

/** Last listed week that has started. Weeks without a startDate always count as started. */
function pickCurrentWeek(weeks) {
  const today = todayISO();
  let current = null;
  for (const w of weeks) if (!w.startDate || w.startDate <= today) current = w;
  return current || weeks[0] || null;
}

export function getExercise(id) {
  return state.byId.get(id) || null;
}

export function getCategory(id) {
  return state.categories.get(id) || { id, name: id, color: '#888888' };
}

/** Therapist items from the JSON plus any prompts added by the user. */
export function getItems(exerciseId) {
  const ex = getExercise(exerciseId);
  if (!ex) return [];
  const custom = getCustomItems()[exerciseId] || [];
  return [...ex.items, ...custom.map((text) => ({ text, source: 'self', custom: true }))];
}

/* ---------- dates ---------- */

/** Local calendar date as YYYY-MM-DD (not UTC). */
export function todayISO(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parse YYYY-MM-DD as a local date (new Date('YYYY-MM-DD') would be UTC). */
export function parseLocalDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/* ---------- localStorage helpers ---------- */

export class StorageError extends Error {
  constructor(cause) {
    const full = cause?.name === 'QuotaExceededError' || /quota/i.test(cause?.message || '');
    super(full
      ? 'This device has no storage space left for the app. Free some space or delete old sessions.'
      : 'This browser is blocking storage for the app (private browsing?).');
    this.name = 'StorageError';
    this.cause = cause;
  }
}

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

/** Throws StorageError when the write did not happen, so callers can keep the user's input. */
function writeJSON(key, value) {
  const raw = JSON.stringify(value);
  try {
    localStorage.setItem(key, raw);
  } catch (err) {
    throw new StorageError(err);
  }
  if (localStorage.getItem(key) !== raw) throw new StorageError(new Error('write did not persist'));
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/* ---------- validation ---------- */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/** Returns a clean copy of a session record, or null if it is unusable. */
export function validSession(s) {
  if (!s || typeof s !== 'object') return null;
  if (typeof s.id !== 'string' || !s.id) return null;
  if (typeof s.exerciseId !== 'string' || !s.exerciseId) return null;
  if (typeof s.date !== 'string' || !ISO_DATE.test(s.date) || Number.isNaN(Date.parse(s.date))) return null;
  const out = { id: s.id, exerciseId: s.exerciseId, date: s.date };
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
  if (s.durationSec != null) { const n = num(s.durationSec); if (n === null) return null; out.durationSec = n; } else out.durationSec = 0;
  if (s.weekId != null) { if (typeof s.weekId !== 'string') return null; out.weekId = s.weekId; }
  if (s.itemsCompleted != null) { const n = num(s.itemsCompleted); if (n === null) return null; out.itemsCompleted = n; }
  if (s.reps != null) { const n = num(s.reps); if (n === null) return null; out.reps = n; }
  if (s.rating != null) {
    if (!Number.isInteger(s.rating) || s.rating < 1 || s.rating > 5) return null;
    out.rating = s.rating;
  } else out.rating = null;
  if (s.notes != null) { if (typeof s.notes !== 'string') return null; if (s.notes) out.notes = s.notes; }
  return out;
}

function cleanLog(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const s of value) {
    const v = validSession(s);
    if (v && !seen.has(v.id)) { seen.add(v.id); out.push(v); }
  }
  return out;
}

function cleanCustomItems(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out = {};
  for (const [exId, list] of Object.entries(value)) {
    if (!Array.isArray(list)) continue;
    const texts = [...new Set(list.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim()))];
    if (texts.length) out[exId] = texts;
  }
  return out;
}

function cleanPrefs(value) {
  const p = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return { shuffle: false, ...p };
}

/* ---------- backend hook (cloud.js) ---------- */

let backend = null;

/** Attach (or detach with null) a backend that receives every user-data write. */
export function setBackend(b) {
  backend = b;
}

export function hasBackend() {
  return Boolean(backend);
}

/* Mirror replacement: the backend calls these when the cloud copy changes. */
export function replaceLog(sessions) { writeJSON(LOG_KEY, cleanLog(sessions)); }
export function replaceCustomItems(items) { writeJSON(CUSTOM_KEY, cleanCustomItems(items)); }
export function replacePrefs(prefs) { writeJSON(PREFS_KEY, cleanPrefs(prefs)); }

/** Forget everything on this device (used on sign-out). */
export function clearLocal() {
  clearLibrary();
  for (const k of [LOG_KEY, CUSTOM_KEY, PREFS_KEY]) localStorage.removeItem(k);
}

/* ---------- custom prompts ---------- */

export function getCustomItems() {
  return cleanCustomItems(readJSON(CUSTOM_KEY, {}));
}

/** Returns true when added, false when blank or already present. Throws StorageError. */
export function addCustomItem(exerciseId, text) {
  text = String(text || '').trim();
  if (!text) return false;
  const all = getCustomItems();
  const list = all[exerciseId] || [];
  const existing = getItems(exerciseId).map((i) => i.text.toLowerCase());
  if (existing.includes(text.toLowerCase())) return false;
  list.push(text);
  all[exerciseId] = list;
  writeJSON(CUSTOM_KEY, all);
  backend?.putPrompt(exerciseId, text);
  return true;
}

export function removeCustomItem(exerciseId, text) {
  const all = getCustomItems();
  all[exerciseId] = (all[exerciseId] || []).filter((t) => t !== text);
  if (!all[exerciseId].length) delete all[exerciseId];
  writeJSON(CUSTOM_KEY, all);
  backend?.removePrompt(exerciseId, text);
}

/* ---------- practice log ---------- */

export function getLog() {
  return cleanLog(readJSON(LOG_KEY, []));
}

/** Throws StorageError if the session could not be stored. */
export function addSession(fields) {
  const log = getLog();
  const session = validSession({ id: uid(), date: new Date().toISOString(), ...fields });
  if (!session) throw new Error('Invalid session');
  log.push(session);
  writeJSON(LOG_KEY, log);
  backend?.putSession(session);
  return session;
}

export function deleteSession(id) {
  writeJSON(LOG_KEY, getLog().filter((s) => s.id !== id));
  backend?.deleteSession(id);
}

export function clearLog() {
  const ids = getLog().map((s) => s.id);
  localStorage.removeItem(LOG_KEY);
  backend?.deleteSessions(ids);
}

/** Sessions newest first (later-saved wins ties on identical timestamps). */
export function sessionsFor(exerciseId) {
  return newestFirst(getLog().filter((s) => s.exerciseId === exerciseId));
}

export function newestFirst(sessions) {
  return sessions.slice().reverse().sort((a, b) => b.date.localeCompare(a.date));
}

export function doneToday(exerciseId) {
  const t = todayISO();
  return getLog().some((s) => s.exerciseId === exerciseId && todayISO(new Date(s.date)) === t);
}

export function stats() {
  const log = getLog();
  const days = new Set(log.map((s) => todayISO(new Date(s.date))));

  // Streak: consecutive days ending today (or yesterday, if today isn't done yet).
  let streak = 0;
  const cursor = new Date();
  if (!days.has(todayISO(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (days.has(todayISO(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }

  const weekStart = currentWeekStart();
  const thisWeek = log.filter((s) => todayISO(new Date(s.date)) >= weekStart).length;
  const totalMin = Math.round(log.reduce((sum, s) => sum + (s.durationSec || 0), 0) / 60);

  return { streak, sessions: log.length, thisWeek, totalMin, days };
}

/** ISO date that "this week" stats count from: the current week's startDate, else this Monday. */
export function currentWeekStart() {
  return state.currentWeek?.startDate || mondayOf(new Date());
}

function mondayOf(d) {
  const x = new Date(d);
  const dow = (x.getDay() + 6) % 7; // Mon=0 … Sun=6
  x.setDate(x.getDate() - dow);
  return todayISO(x);
}

/* ---------- prefs ---------- */

export function getPrefs() {
  return cleanPrefs(readJSON(PREFS_KEY, {}));
}

export function setPref(key, value) {
  const p = getPrefs();
  p[key] = value;
  writeJSON(PREFS_KEY, p);
  backend?.putPrefs(p);
}

/* ---------- export / import ---------- */

export function exportAll() {
  return {
    app: 'speech-practice',
    exportedAt: new Date().toISOString(),
    log: getLog(),
    customItems: getCustomItems(),
  };
}

/** Merge an exported file into local data (never deletes anything).
    The whole file is validated first; nothing is written if any record is bad. */
export function importAll(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('Not a Speech Practice export file');
  if (obj.log != null && !Array.isArray(obj.log)) throw new Error('"log" must be a list of sessions');
  if (obj.customItems != null && (typeof obj.customItems !== 'object' || Array.isArray(obj.customItems))) {
    throw new Error('"customItems" must be an object keyed by exercise id');
  }

  // Validate sessions up front; duplicates inside the file count once.
  const incoming = [];
  const seenIds = new Set();
  (obj.log || []).forEach((s, i) => {
    const v = validSession(s);
    if (!v) throw new Error(`Session ${i + 1} in the file is invalid (needs id, exerciseId, date and numeric fields)`);
    if (!seenIds.has(v.id)) { seenIds.add(v.id); incoming.push(v); }
  });
  const incomingItems = cleanCustomItems(obj.customItems || {});

  const existing = getLog();
  const ids = new Set(existing.map((s) => s.id));
  const fresh = incoming.filter((s) => !ids.has(s.id));

  const cur = getCustomItems();
  const freshPrompts = [];
  for (const [exId, list] of Object.entries(incomingItems)) {
    const set = new Set(cur[exId] || []);
    for (const t of list) if (!set.has(t)) { set.add(t); freshPrompts.push([exId, t]); }
    cur[exId] = [...set];
  }

  if (fresh.length) {
    writeJSON(LOG_KEY, existing.concat(fresh));
    for (const s of fresh) backend?.putSession(s);
  }
  // Forward each persisted section before attempting the next storage write. If
  // prompt storage fails, retrying must not skip sessions that never reached sync.
  if (freshPrompts.length) {
    writeJSON(CUSTOM_KEY, cur);
    for (const [exId, t] of freshPrompts) backend?.putPrompt(exId, t);
  }
  return { sessions: fresh.length, prompts: freshPrompts.length };
}
