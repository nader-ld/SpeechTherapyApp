/* Speech Practice — app shell, router and views. */
import * as store from './store.js';
import { Recorder, Metronome } from './recorder.js';

const APP_VERSION = '0.3.0';
let cloud = null; // ./cloud.js, loaded at boot (email/password sign-in + Firestore sync)
const root = document.getElementById('app');
const nav = document.getElementById('nav');

/* ======================================================================
   helpers
   ====================================================================== */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
const fmtDate = (d, opts = { weekday: 'short', day: 'numeric', month: 'short' }) => d.toLocaleDateString(undefined, opts);
const fmtTime = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const fmtClock = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
const fmtDuration = (sec) => (sec >= 60 ? `${Math.round(sec / 60)} min` : `${sec} s`);
const stat = (n, label) => `<div class="stat"><b>${esc(n)}</b><span>${esc(label)}</span></div>`;

function modeLabel(ex, count) {
  if (ex.mode === 'timed') return `${Math.max(1, Math.round(ex.durationSec / 60))} min timed`;
  if (ex.mode === 'reps') return `${ex.targetReps} reps`;
  return `${count} prompt${count === 1 ? '' : 's'}${ex.itemTimerSec ? ` · ${ex.itemTimerSec}s each` : ''}`;
}

/** Heading for a week/session: label, "Week of …", or "Session N". */
function weekLabel(w) {
  const parts = [];
  if (w.label) parts.push(w.label);
  if (w.startDate) parts.push(`Week of ${fmtDate(store.parseLocalDate(w.startDate))}`);
  return parts.length ? parts.join(' · ') : `Session ${store.state.weeks.indexOf(w) + 1}`;
}

function sizeClass(text) {
  const n = text.length;
  return n <= 16 ? 'xl' : n <= 60 ? 'lg' : n <= 180 ? 'md' : 'sm';
}

function makeOrder(n, shuffle) {
  const a = Array.from({ length: n }, (_, i) => i);
  if (shuffle) {
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
  }
  return a;
}

let toastTimer;
function toast(msg, { action, onAction, ms = 2500 } = {}) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.innerHTML = esc(msg) + (action ? `<button type="button">${esc(action)}</button>` : '');
  if (action) el.querySelector('button').onclick = onAction;
  el.classList.add('show');
  clearTimeout(toastTimer);
  if (!action) toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

/* ======================================================================
   view lifecycle
   ====================================================================== */

let cleanup = null;

/** Replace the page. `mount(root)` may return a cleanup function. */
function setView(html, mount) {
  if (cleanup) {
    try { cleanup(); } catch (e) { console.warn(e); }
    cleanup = null;
  }
  root.innerHTML = html;
  window.scrollTo(0, 0);
  const c = mount ? mount(root) : null;
  cleanup = typeof c === 'function' ? c : null;
}

/* ======================================================================
   shared fragments
   ====================================================================== */

function exerciseCard(ex) {
  const cat = store.getCategory(ex.category);
  const done = store.doneToday(ex.id);
  const count = store.getItems(ex.id).length;
  return `<li><a class="card ex-card ${done ? 'done' : ''}" href="#/exercise/${esc(ex.id)}">
    <span class="cat-dot" style="--c:${esc(cat.color)}"></span>
    <span class="ex-body">
      <span class="ex-name">${esc(ex.name)}</span>
      <span class="muted small">${esc(cat.name)} · ${esc(modeLabel(ex, count))}</span>
    </span>
    <span class="ex-check" aria-label="${done ? 'done today' : ''}">${done ? '✓' : '›'}</span>
  </a></li>`;
}

function sessionRow(s, { showName = true } = {}) {
  const ex = store.getExercise(s.exerciseId);
  const rating = Math.max(0, Math.min(5, Number(s.rating) || 0));
  const bits = [fmtTime(s.date), fmtDuration(s.durationSec || 0)];
  if (s.itemsCompleted != null) bits.push(`${s.itemsCompleted} prompts`);
  if (s.reps != null) bits.push(`${s.reps} reps`);
  return `<li class="session">
    <div class="s-main">
      ${showName ? `<div class="s-name">${esc(ex?.name || s.exerciseId)}</div>` : ''}
      <div class="muted small">${esc(bits.join(' · '))}</div>
      ${s.notes ? `<div class="s-notes">${esc(s.notes)}</div>` : ''}
    </div>
    <div class="s-side">
      <span class="stars" aria-label="${rating} of 5">${rating ? '★'.repeat(rating) + '☆'.repeat(5 - rating) : ''}</span>
      <button class="icon-btn" data-del="${esc(s.id)}" aria-label="Delete session">✕</button>
    </div>
  </li>`;
}

function bindDelete(root, rerender) {
  root.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
    if (!confirm('Delete this session?')) return;
    try { store.deleteSession(b.dataset.del); rerender(); }
    catch (err) { toast(`Couldn't delete it. ${err.message}`, { ms: 6000 }); }
  }));
}

/* ======================================================================
   views
   ====================================================================== */

function today() {
  const wk = store.state.currentWeek;
  const st = store.stats();
  const exs = wk
    ? wk.exerciseIds.map(store.getExercise).filter(Boolean)
    : [...store.state.byId.values()];
  const doneCount = exs.filter((e) => store.doneToday(e.id)).length;

  setView(`
    <header class="page-head">
      <p class="eyebrow">${esc(fmtDate(new Date(), { weekday: 'long', day: 'numeric', month: 'long' }))}</p>
      <h1>Today</h1>
    </header>
    <section class="stats">
      ${stat(st.streak, 'day streak')}
      ${stat(st.thisWeek, 'sessions this week')}
      ${stat(st.totalMin, 'minutes total')}
    </section>
    ${wk ? `
      <section class="card week-card">
        <p class="eyebrow">${esc(weekLabel(wk))}</p>
        <h2>${esc(wk.focus)}</h2>
        ${wk.therapistNotes ? `<p class="muted notes">${esc(wk.therapistNotes)}</p>` : ''}
      </section>` : `
      <section class="card"><p class="muted">No weekly plan yet. You can practise any exercise below.</p></section>`}
    <div class="section-head"><h3>Exercises</h3><span class="muted small">${doneCount}/${exs.length} done today</span></div>
    <ul class="list">${exs.map(exerciseCard).join('')}</ul>
    <p class="center" style="margin-top:20px"><a class="link" href="#/weeks">All weeks ›</a></p>
  `);
}

let libFilter = 'all';
function library() {
  const cats = [...store.state.categories.values()];
  const exs = [...store.state.byId.values()];
  const groups = cats
    .map((cat) => ({ cat, exs: exs.filter((e) => e.category === cat.id) }))
    .filter((g) => g.exs.length);
  const orphans = exs.filter((e) => !store.state.categories.has(e.category));
  if (orphans.length) groups.push({ cat: { id: 'other', name: 'Other', color: '#888888' }, exs: orphans });
  if (!groups.some((g) => g.cat.id === libFilter)) libFilter = 'all';

  setView(`
    <header class="page-head">
      <h1>Library</h1>
      <p class="muted">${exs.length} exercises · tap one to see prompts or add your own</p>
    </header>
    <div class="chips" id="chips">
      <button class="chip ${libFilter === 'all' ? 'active' : ''}" data-f="all">All</button>
      ${groups.map((g) => `<button class="chip ${libFilter === g.cat.id ? 'active' : ''}" data-f="${esc(g.cat.id)}">${esc(g.cat.name)}</button>`).join('')}
    </div>
    ${groups.map((g) => `
      <section data-group="${esc(g.cat.id)}" ${libFilter !== 'all' && libFilter !== g.cat.id ? 'hidden' : ''}>
        <div class="group-title">
          <span class="cat-dot" style="--c:${esc(g.cat.color)}"></span>
          <h3>${esc(g.cat.name)}</h3>
          ${g.cat.description ? `<span class="muted small">${esc(g.cat.description)}</span>` : ''}
        </div>
        <ul class="list">${g.exs.map(exerciseCard).join('')}</ul>
      </section>`).join('')}
  `, (root) => {
    root.querySelector('#chips').addEventListener('click', (e) => {
      const b = e.target.closest('[data-f]');
      if (!b) return;
      libFilter = b.dataset.f;
      root.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c.dataset.f === libFilter));
      root.querySelectorAll('[data-group]').forEach((s) => { s.hidden = libFilter !== 'all' && s.dataset.group !== libFilter; });
    });
  });
}

function weeksView() {
  const weeks = [...store.state.weeks].reverse();
  const cur = store.state.currentWeek;
  setView(`
    <a class="back" href="#/today">‹ Today</a>
    <header class="page-head">
      <h1>Weekly plans</h1>
      <p class="muted">What we worked on in each therapy session.</p>
    </header>
    ${weeks.length ? weeks.map((w) => `
      <section class="card ${w === cur ? 'week-card' : ''}">
        <p class="eyebrow">${esc(weekLabel(w))}${w === cur ? ' · current' : ''}</p>
        <h2>${esc(w.focus)}</h2>
        ${w.therapistNotes ? `<p class="muted notes">${esc(w.therapistNotes)}</p>` : ''}
        <ul class="list tight mt">${w.exerciseIds.map((id) => {
          const ex = store.getExercise(id);
          return ex
            ? `<li><a class="link" href="#/exercise/${esc(ex.id)}">${esc(ex.name)}</a></li>`
            : `<li class="muted small">Unknown exercise: ${esc(id)}</li>`;
        }).join('')}</ul>
      </section>`).join('') : '<section class="card empty">No weeks yet.</section>'}
  `);
}

function exerciseView(id) {
  const ex = store.getExercise(id);
  if (!ex) return notFound();
  const cat = store.getCategory(ex.category);
  const items = store.getItems(id);
  const recent = store.sessionsFor(id).slice(0, 5);
  const showItems = ex.mode === 'items' || items.length > 0;

  setView(`
    <a class="back" href="#/today">‹ Back</a>
    <header class="page-head">
      <span class="pill" style="--c:${esc(cat.color)}">${esc(cat.name)}</span>
      <h1>${esc(ex.name)}</h1>
      <p class="muted">${esc(modeLabel(ex, items.length))}${ex.paceBpm ? ` · metronome ${ex.paceBpm} bpm` : ''}</p>
    </header>

    <section class="card">
      <h3>How to do it</h3>
      <p class="prose">${esc(ex.instructions)}</p>
      ${ex.tips.length ? `<ul class="tips">${ex.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
    </section>

    ${showItems ? `
    <section class="card">
      <div class="section-head" style="margin-top:0"><h3>Prompts</h3><span class="muted small">${items.length}</span></div>
      <ol class="items">${items.map((it) => `
        <li>
          <div class="txt">${esc(it.text)}${it.note ? (it.note.length > 200
            ? `<details class="note"><summary>Read</summary>${esc(it.note)}</details>`
            : `<div class="muted small note">${esc(it.note)}</div>`) : ''}${it.answer ? `<details class="ans"><summary>${it.answerSource === 'self' ? 'Suggested answer' : 'Answer'}</summary>${esc(it.answer)}${it.answerSource === 'self' ? ' <span class="muted small">(my suggestion, not from the worksheet)</span>' : ''}</details>` : ''}</div>
          ${(it.timerSec ?? ex.itemTimerSec) ? `<span class="muted small">⏱ ${it.timerSec ?? ex.itemTimerSec}s</span>` : ''}
          ${it.source === 'self' ? '<span class="badge">mine</span>' : ''}
          ${it.custom ? `<button class="icon-btn" data-remove="${esc(it.text)}" aria-label="Remove prompt">✕</button>` : ''}
        </li>`).join('')}</ol>
      <form class="add-form" id="addForm" autocomplete="off">
        <input name="text" placeholder="Add your own prompt…" required maxlength="500">
        <button class="btn" type="submit">Add</button>
      </form>
    </section>` : ''}

    ${recent.length ? `
    <section class="card">
      <h3>Recent sessions</h3>
      <ul class="sessions mt">${recent.map((s) => sessionRow(s, { showName: false })).join('')}</ul>
    </section>` : ''}

    <div class="sticky-cta"><a class="btn primary big" href="#/practice/${esc(ex.id)}">Start practice</a></div>
  `, (root) => {
    const form = root.querySelector('#addForm');
    form?.addEventListener('submit', (e) => {
      e.preventDefault();
      try {
        if (store.addCustomItem(id, form.text.value)) { toast('Prompt added'); exerciseView(id); }
        else toast('That prompt is already in the list');
      } catch (err) {
        toast(`Couldn't save the prompt. ${err.message}`, { ms: 6000 }); // input stays in the box
      }
    });
    root.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', () => {
      try { store.removeCustomItem(id, b.dataset.remove); exerciseView(id); }
      catch (err) { toast(`Couldn't remove it. ${err.message}`, { ms: 6000 }); }
    }));
    bindDelete(root, () => exerciseView(id));
  });
}

/* ---------------------------------------------------------------------
   practice
   --------------------------------------------------------------------- */

const P = {}; // current practice session state

function practiceView(id) {
  const ex = store.getExercise(id);
  if (!ex) return notFound();

  Object.assign(P, {
    ex,
    items: store.getItems(id),
    idx: 0,
    reps: 0,
    completed: new Set(),
    startedAt: Date.now(),
    running: false,
    endAt: 0,
    remaining: ex.durationSec || 0,
    shuffle: ex.mode === 'items' && Boolean(store.getPrefs().shuffle),
    metroOn: false,
    recorder: new Recorder(),
    metro: new Metronome(),
    itemTimer: null,
  });
  P.order = makeOrder(P.items.length, P.shuffle);
  resetItemTimer();

  setView(`
    <div class="practice">
      <div class="p-top">
        <button class="icon-btn" data-act="exit" aria-label="Exit practice">✕</button>
        <div class="p-title">${esc(ex.name)}</div>
        <div class="p-elapsed" id="elapsed">0:00</div>
      </div>
      <div class="progress"><div id="bar"></div></div>
      <div class="p-meta" id="counter"></div>
      <div class="p-stage" id="stage"></div>
      <div class="p-controls" id="controls"></div>
      <div class="p-tools">
        ${ex.mode === 'items' && P.items.length > 1 ? `<button class="btn toggle ${P.shuffle ? 'active' : ''}" data-act="shuffle">⇄ Shuffle</button>` : ''}
        ${ex.paceBpm ? `<button class="btn toggle" data-act="metro">♩ ${ex.paceBpm} bpm</button>` : ''}
        <button class="btn" data-act="instructions">ⓘ How to</button>
        <div class="card instr small" id="instr" hidden><p class="prose" style="margin:0">${esc(ex.instructions)}</p></div>
        <audio id="playback" controls hidden></audio>
      </div>
      <button class="btn primary big" data-act="finish">Finish</button>
    </div>
  `, (root) => {
    const wrap = root.querySelector('.practice');
    const elapsedEl = root.querySelector('#elapsed');
    wrap.addEventListener('click', onPracticeClick);
    const tick = setInterval(() => {
      elapsedEl.textContent = fmtClock(Math.floor((Date.now() - P.startedAt) / 1000));
      if (P.ex.mode === 'timed' && P.running) renderStage();
      if (P.ex.mode === 'items' && P.itemTimer?.running) updateItemTimer();
    }, 250);
    renderStage();
    renderControls();
    return () => {
      clearInterval(tick);
      P.metro.stop();
      P.recorder.release();
    };
  });
}

function renderStage() {
  const stage = document.getElementById('stage');
  const bar = document.getElementById('bar');
  const counter = document.getElementById('counter');
  if (!stage) return;
  const { ex } = P;

  if (ex.mode === 'items') {
    if (!P.items.length) {
      stage.innerHTML = '<div class="prompt-card"><p class="prompt-text md muted">No prompts yet. Add some on the exercise page.</p></div>';
      return;
    }
    const it = P.items[P.order[P.idx]];
    const t = P.itemTimer;
    stage.innerHTML = `<div class="prompt-card">
      ${it.source === 'self' ? '<span class="badge">mine</span>' : ''}
      <p class="prompt-text ${sizeClass(it.text)}">${esc(it.text)}</p>
      ${it.note ? `<p class="prompt-note ${it.note.length > 160 ? 'long' : ''}">${esc(it.note)}</p>` : ''}
      ${it.answer ? `<button class="btn small-btn" data-act="answer" id="answerBtn">Show answer</button>
        <p class="prompt-answer" id="answer" hidden>${it.answerSource === 'self' ? '<span class="ans-label">Suggested answer · mine</span>' : ''}${esc(it.answer)}</p>` : ''}
      ${t ? `<div class="item-timer"><span id="itClock">${fmtClock(t.remaining)}</span><button class="btn small-btn" data-act="itimer" id="itBtn">Start ${t.total}s</button></div>` : ''}
    </div>`;
    if (t) updateItemTimer();
    bar.style.width = `${((P.idx + 1) / P.items.length) * 100}%`;
    counter.textContent = `${P.idx + 1} of ${P.items.length}`;
    return;
  }

  if (ex.mode === 'timed') {
    let remaining = P.running ? Math.max(0, Math.ceil((P.endAt - Date.now()) / 1000)) : P.remaining;
    if (P.running && remaining === 0) {
      P.running = false;
      P.remaining = 0;
      P.metro.stop();
      P.metroOn = false;
      document.querySelector('[data-act="metro"]')?.classList.remove('active');
      P.metro.chime();
      toast("Time's up. Nice work.");
      renderControls();
    }
    const status = P.running ? 'Keep going…' : remaining === 0 ? 'Done' : remaining === ex.durationSec ? 'Ready' : 'Paused';
    stage.innerHTML = `<div class="prompt-card">
      <div class="big-number">${fmtClock(remaining)}</div>
      <p class="big-sub">${status}</p>
    </div>`;
    bar.style.width = `${(1 - remaining / ex.durationSec) * 100}%`;
    counter.textContent = '';
    return;
  }

  // reps
  const it = P.items.length ? P.items[P.reps % P.items.length] : null;
  stage.innerHTML = `<div class="prompt-card">
    <div class="big-number">${P.reps}</div>
    <p class="big-sub">of ${ex.targetReps}</p>
    ${it ? `<p class="prompt-text ${sizeClass(it.text) === 'xl' ? 'lg' : 'md'}" style="margin-top:20px">${esc(it.text)}</p>` : ''}
  </div>`;
  bar.style.width = `${Math.min(100, (P.reps / ex.targetReps) * 100)}%`;
  counter.textContent = P.reps >= ex.targetReps ? 'Target reached' : '';
}

/** Per-prompt countdown (items mode): item.timerSec, else the exercise's itemTimerSec. */
function resetItemTimer() {
  const it = P.items[P.order?.[P.idx]];
  const total = it ? (it.timerSec ?? P.ex.itemTimerSec ?? 0) : 0;
  P.itemTimer = total ? { total, remaining: total, running: false, endAt: 0 } : null;
}

function updateItemTimer() {
  const t = P.itemTimer;
  const clock = document.getElementById('itClock');
  const btn = document.getElementById('itBtn');
  if (!t || !clock || !btn) return;
  const remaining = t.running ? Math.max(0, Math.ceil((t.endAt - Date.now()) / 1000)) : t.remaining;
  if (t.running && remaining === 0) {
    t.running = false;
    t.remaining = 0;
    P.metro.chime();
    toast('Time');
  }
  clock.textContent = fmtClock(remaining);
  clock.classList.toggle('done', remaining === 0);
  btn.textContent = t.running ? 'Pause' : remaining === 0 ? `Again ${t.total}s` : remaining === t.total ? `Start ${t.total}s` : 'Resume';
}

function renderControls() {
  const c = document.getElementById('controls');
  if (!c) return;
  const { ex } = P;
  const recording = P.recorder.state === 'recording';
  const recBtn = Recorder.supported()
    ? `<button class="rec-btn ${recording ? 'on' : ''}" data-act="rec" aria-label="${recording ? 'Stop recording' : 'Record'}">
         <span class="dot"></span><span>${recording ? 'Stop' : 'Record'}</span>
       </button>`
    : '<span></span>';

  if (ex.mode === 'items') {
    c.innerHTML = `
      <button class="btn nav-btn" data-act="prev" ${P.idx === 0 ? 'disabled' : ''} aria-label="Previous">‹</button>
      ${recBtn}
      <button class="btn nav-btn" data-act="next" ${P.idx >= P.items.length - 1 ? 'disabled' : ''} aria-label="Next">›</button>`;
  } else if (ex.mode === 'timed') {
    c.innerHTML = `
      <button class="btn nav-btn" data-act="reset" aria-label="Reset timer">↺</button>
      ${recBtn}
      ${P.running
        ? '<button class="btn nav-btn" data-act="pause">Pause</button>'
        : `<button class="btn primary nav-btn" data-act="start" ${P.remaining === 0 ? 'disabled' : ''}>${P.remaining === ex.durationSec ? 'Start' : 'Resume'}</button>`}`;
  } else {
    c.innerHTML = `
      <button class="btn nav-btn" data-act="undo" ${P.reps === 0 ? 'disabled' : ''} aria-label="Undo">−1</button>
      ${recBtn}
      <button class="btn primary nav-btn" data-act="plus" aria-label="Count one">+1</button>`;
  }
}

async function onPracticeClick(e) {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const { ex } = P;
  P.metro.prime(); // any tap counts as the user gesture iOS needs before audio can play

  switch (btn.dataset.act) {
    case 'exit':
      if (confirm('Leave without saving this session?')) location.hash = `#/exercise/${ex.id}`;
      break;
    case 'prev':
      if (P.idx > 0) { P.idx--; resetItemTimer(); renderStage(); renderControls(); }
      break;
    case 'next':
      if (P.idx < P.items.length - 1) { P.completed.add(P.order[P.idx]); P.idx++; resetItemTimer(); renderStage(); renderControls(); }
      break;
    case 'answer': {
      const a = document.getElementById('answer');
      a.hidden = !a.hidden;
      btn.textContent = a.hidden ? 'Show answer' : 'Hide answer';
      break;
    }
    case 'itimer': {
      const t = P.itemTimer;
      if (!t) break;
      if (t.running) {
        t.remaining = Math.max(0, Math.ceil((t.endAt - Date.now()) / 1000));
        t.running = false;
      } else {
        if (t.remaining === 0) t.remaining = t.total;
        t.endAt = Date.now() + t.remaining * 1000;
        t.running = true;
      }
      updateItemTimer();
      break;
    }
    case 'shuffle':
      P.shuffle = !P.shuffle;
      store.setPref('shuffle', P.shuffle);
      P.order = makeOrder(P.items.length, P.shuffle);
      P.idx = 0;
      btn.classList.toggle('active', P.shuffle);
      resetItemTimer();
      renderStage(); renderControls();
      break;
    case 'metro':
      P.metroOn = !P.metroOn;
      if (P.metroOn) P.metro.start(ex.paceBpm); else P.metro.stop();
      btn.classList.toggle('active', P.metroOn);
      break;
    case 'instructions': {
      const panel = document.getElementById('instr');
      panel.hidden = !panel.hidden;
      break;
    }
    case 'rec':
      await toggleRecord();
      break;
    case 'start':
      P.running = true;
      P.endAt = Date.now() + P.remaining * 1000;
      renderControls(); renderStage();
      break;
    case 'pause':
      P.remaining = Math.max(0, Math.ceil((P.endAt - Date.now()) / 1000));
      P.running = false;
      renderControls(); renderStage();
      break;
    case 'reset':
      P.running = false;
      P.remaining = ex.durationSec;
      renderControls(); renderStage();
      break;
    case 'plus':
      P.reps++;
      if (P.reps === ex.targetReps) { P.metro.chime(); toast('Target reached 🎉'); }
      renderStage(); renderControls();
      break;
    case 'undo':
      if (P.reps > 0) P.reps--;
      renderStage(); renderControls();
      break;
    case 'finish':
      finishPractice();
      break;
    default:
      break;
  }
}

async function toggleRecord() {
  const audio = document.getElementById('playback');
  if (P.recorder.state === 'recording') {
    const url = await P.recorder.stop();
    if (url && audio) { audio.src = url; audio.hidden = false; }
    renderControls();
    return;
  }
  try {
    if (audio) { audio.hidden = true; audio.removeAttribute('src'); }
    const started = await P.recorder.start();
    if (started) renderControls();
  } catch (err) {
    const denied = err?.name === 'NotAllowedError' || err?.name === 'SecurityError';
    toast(denied ? 'Microphone access was blocked. Allow it in your browser settings.' : `Can't record: ${err.message}`);
  }
}

function finishPractice() {
  const { ex } = P;
  if (ex.mode === 'items' && P.items.length) P.completed.add(P.order[P.idx]);
  const durationSec = Math.max(1, Math.round((Date.now() - P.startedAt) / 1000));
  const summary = {
    exerciseId: ex.id,
    weekId: store.state.currentWeek?.id || null,
    durationSec,
  };
  if (ex.mode === 'items') summary.itemsCompleted = P.completed.size;
  if (ex.mode === 'reps') summary.reps = P.reps;
  let rating = 0;

  setView(`
    <header class="page-head">
      <p class="eyebrow">Session complete</p>
      <h1>${esc(ex.name)}</h1>
    </header>
    <div class="summary">
      <span>⏱ ${esc(fmtDuration(durationSec))}</span>
      ${summary.itemsCompleted != null ? `<span>✓ ${summary.itemsCompleted} of ${P.items.length} prompts</span>` : ''}
      ${summary.reps != null ? `<span>${summary.reps} of ${ex.targetReps} reps</span>` : ''}
    </div>
    <section class="card">
      <h3>How did it feel?</h3>
      <div class="rating" id="rating">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-r="${n}">${n}</button>`).join('')}</div>
      <div class="rating-labels"><span>Hard, lots of blocks</span><span>Smooth and easy</span></div>
      <textarea id="notes" placeholder="Notes for you or your therapist (optional)"></textarea>
    </section>
    <div class="stack" style="margin-top:16px">
      <button class="btn primary big" id="save">Save session</button>
      <button class="btn big" id="discard">Discard</button>
    </div>
  `, (root) => {
    root.querySelector('#rating').addEventListener('click', (e) => {
      const b = e.target.closest('[data-r]');
      if (!b) return;
      rating = Number(b.dataset.r);
      root.querySelectorAll('[data-r]').forEach((x) => x.classList.toggle('active', Number(x.dataset.r) === rating));
    });
    root.querySelector('#save').addEventListener('click', () => {
      try {
        store.addSession({ ...summary, rating: rating || null, notes: root.querySelector('#notes').value.trim() });
      } catch (err) {
        toast(`Session not saved. ${err.message}`, { ms: 8000 }); // rating and notes stay on screen
        return;
      }
      toast('Session saved');
      location.hash = '#/today';
    });
    root.querySelector('#discard').addEventListener('click', () => {
      if (confirm('Discard this session?')) location.hash = `#/exercise/${ex.id}`;
    });
  });
}

/* ---------------------------------------------------------------------
   log & settings
   --------------------------------------------------------------------- */

function logView() {
  const log = store.newestFirst(store.getLog());
  const st = store.stats();
  const byDay = new Map();
  for (const s of log) {
    const day = store.todayISO(new Date(s.date));
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(s);
  }

  setView(`
    <header class="page-head"><h1>Log</h1></header>
    <section class="stats">
      ${stat(st.streak, 'day streak')}
      ${stat(st.sessions, 'sessions')}
      ${stat(st.totalMin, 'minutes total')}
    </section>
    ${log.length ? [...byDay.entries()].map(([day, ss]) => `
      <h3 class="day-head">${esc(fmtDate(store.parseLocalDate(day), { weekday: 'long', day: 'numeric', month: 'short' }))}</h3>
      <ul class="sessions card">${ss.map((s) => sessionRow(s)).join('')}</ul>`).join('')
      : '<section class="card empty"><p>No sessions yet.<br>Pick an exercise on <a href="#/today">Today</a> and press Start practice.</p></section>'}
  `, (root) => bindDelete(root, logView));
}

function settingsView() {
  const st = store.stats();
  const custom = store.getCustomItems();
  const nCustom = Object.values(custom).reduce((n, list) => n + list.length, 0);

  const user = cloud?.currentUser();

  setView(`
    <header class="page-head"><h1>Settings</h1></header>

    <section class="card">
      <h3>Account</h3>
      ${user ? `
      <div class="account">
        ${user.photoURL ? `<img class="avatar" src="${esc(user.photoURL)}" alt="" referrerpolicy="no-referrer">` : ''}
        <div class="account-body">
          <b>${esc(user.displayName || 'Signed in')}</b>
          <span class="muted small">${esc(user.email || '')}</span>
          <span class="muted small">${navigator.onLine ? 'Your log syncs across the devices you sign in on.' : 'Offline. Changes are kept on this device and upload when you reconnect.'}</span>
        </div>
      </div>
      <button class="btn mt" id="signout">Sign out</button>` : `
      <p class="muted small" style="margin-top:6px">Not signed in. Data stays on this device only.</p>`}
    </section>

    ${store.state.sourceDocumentUrl ? `<section class="card">
      <h3>Therapy document</h3>
      <p class="muted small mt">Open the shared document for the latest updates. Your Google account controls access.</p>
      <a class="btn mt" href="${esc(store.state.sourceDocumentUrl)}" target="_blank" rel="noopener noreferrer">Open shared document</a>
    </section>` : ''}

    <section class="card">
      <h3>Your data</h3>
      <p class="muted small" style="margin:6px 0 12px">Export a copy now and then as a backup, or to share your log with your therapist. Import merges a file into your log without deleting anything.</p>
      <div class="settings-row">
        <button class="btn" id="export">⬇ Export log &amp; my prompts (JSON)</button>
        <label class="btn" for="importFile">⬆ Import from a file</label>
        <input type="file" id="importFile" accept="application/json,.json" hidden>
        <button class="btn danger" id="clear">Delete all sessions</button>
      </div>
      <div class="mt">
        <div class="kv"><span class="muted">Sessions</span><b>${st.sessions}</b></div>
        <div class="kv"><span class="muted">My prompts</span><b>${nCustom}</b></div>
      </div>
    </section>

    <section class="card">
      <h3>Exercises</h3>
      <p class="muted small" style="margin:6px 0 12px">Your exercise library syncs after sign-in. Reload to check for published updates.</p>
      <button class="btn" id="reload">↻ Reload exercises</button>
      <div class="mt">
        <div class="kv"><span class="muted">Exercises</span><b>${store.state.byId.size}</b></div>
        <div class="kv"><span class="muted">Weeks planned</span><b>${store.state.weeks.length}</b></div>
        ${store.state.data?.meta?.notes ? `<div class="kv"><span class="muted small" style="max-width:100%">${esc(store.state.data.meta.notes)}</span></div>` : ''}
      </div>
    </section>

    <section class="card">
      <h3>Install on your phone</h3>
      <p class="muted small" style="margin-top:6px">
        <b>iPhone:</b> open this page in Safari → Share → <i>Add to Home Screen</i>.<br>
        <b>Android:</b> open in Chrome → ⋮ menu → <i>Install app</i>.
      </p>
    </section>

    <p class="center muted small" style="margin-top:20px">Speech Practice v${APP_VERSION}</p>
  `, (root) => {
    root.querySelector('#export').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(store.exportAll(), null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `speech-practice-${store.todayISO()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
    root.querySelector('#importFile').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const r = store.importAll(JSON.parse(await file.text()));
        toast(`Imported ${r.sessions} sessions and ${r.prompts} prompts`);
        settingsView();
      } catch (err) {
        toast(`Import failed: ${err.message}`);
      }
    });
    root.querySelector('#clear').addEventListener('click', () => {
      if (confirm('Delete ALL practice sessions? This cannot be undone.')) {
        store.clearLog();
        toast('Sessions deleted');
        settingsView();
      }
    });
    root.querySelector('#signout')?.addEventListener('click', async () => {
      if (!confirm('Sign out? Your log stays in your account; this device forgets it until you sign in again.')) return;
      try { await cloud.signOut(); } catch (err) { toast(err.message); }
    });
    root.querySelector('#reload').addEventListener('click', async () => {
      try { await cloud.reloadLibrary(); toast('Exercises reloaded'); settingsView(); }
      catch (err) { toast(err.message); }
    });
  });
}

function authView(html, mount) {
  document.body.classList.remove('practicing');
  document.body.classList.add('signed-out');
  nav.querySelectorAll('a').forEach((a) => a.classList.remove('active'));
  setView(`<section class="signin">
    <img class="signin-logo" src="./icons/icon-192.png" alt="" width="72" height="72">
    <h1>Speech Practice</h1>${html}
  </section>`, mount);
}

function signInView({ error = '', denied = false, creating = false, email = '' } = {}) {
  authView(`
    <p class="muted">Your weekly therapy exercises, with a practice log that follows you from phone to laptop.</p>
    ${denied ? `
      <p class="error-text">${esc(error || 'This account is not allowed to use this app.')}</p>
      <button class="btn big" id="signout">Sign out</button>` : `
      <form class="auth-form" id="signinForm">
        <label for="signinEmail">Email</label>
        <input id="signinEmail" name="email" type="email" autocomplete="username" value="${esc(email)}" required>
        <label for="signinPassword">Password</label>
        <input id="signinPassword" name="password" type="password" autocomplete="${creating ? 'new-password' : 'current-password'}" ${creating ? 'minlength="6"' : ''} required>
        <button class="btn primary big" type="submit">${creating ? 'Create account' : 'Sign in'}</button>
        <p id="authStatus" class="small error-text" role="status">${esc(error)}</p>
      </form>
      <button class="btn" id="toggleAccount">${creating ? 'I already have an account' : 'Create an account'}</button>
      ${creating ? '' : '<button class="btn" id="resetPassword">Reset password</button>'}`}
  `, (root) => {
    const form = root.querySelector('#signinForm');
    const status = root.querySelector('#authStatus');
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = form.elements.email.value;
      const password = form.elements.password.value;
      const buttons = root.querySelectorAll('button');
      buttons.forEach((b) => { b.disabled = true; });
      status.textContent = creating ? 'Creating account…' : 'Signing in…';
      try { await (creating ? cloud.createAccount(email, password) : cloud.signIn(email, password)); }
      catch (err) { status.textContent = err.message; }
      finally { buttons.forEach((b) => { b.disabled = false; }); }
    });
    root.querySelector('#toggleAccount')?.addEventListener('click', () => {
      signInView({ creating: !creating, email: form.elements.email.value });
    });
    root.querySelector('#resetPassword')?.addEventListener('click', async (e) => {
      e.target.disabled = true;
      try {
        await cloud.resetPassword(form.elements.email.value);
        status.textContent = 'If this account exists, a password reset link has been sent. Check your inbox and spam folder.';
      } catch (err) { status.textContent = err.message; }
      finally { e.target.disabled = false; }
    });
    root.querySelector('#signout')?.addEventListener('click', () => cloud.signOut().catch((err) => toast(err.message)));
  });
}

function verificationView(user) {
  authView(`
    <h2>Verify your email</h2>
    <p class="muted">Send a verification link to ${esc(user.email)}, open it in your email, then return here.</p>
    <div class="auth-form">
      <button class="btn primary big" id="sendVerification">Send verification email</button>
      <button class="btn big" id="checkVerification">I've verified my email</button>
      <p id="authStatus" class="small" role="status"></p>
      <button class="btn" id="signout">Sign out</button>
    </div>
  `, (root) => {
    const status = root.querySelector('#authStatus');
    const bind = (id, action, message) => root.querySelector(id).addEventListener('click', async () => {
      const buttons = root.querySelectorAll('button');
      buttons.forEach((b) => { b.disabled = true; });
      status.textContent = '';
      try { await action(); status.textContent = message; }
      catch (err) { status.textContent = err.message; }
      finally { buttons.forEach((b) => { b.disabled = false; }); }
    });
    bind('#sendVerification', () => cloud.sendVerification(), 'Verification email sent. Check your inbox and spam folder.');
    bind('#checkVerification', () => cloud.checkVerification(), '');
    bind('#signout', () => cloud.signOut(), '');
  });
}

function notFound() {
  setView(`<section class="card empty"><h2>Not found</h2><p class="mt"><a class="link" href="#/today">Go to Today</a></p></section>`);
}

/* ======================================================================
   router & boot
   ====================================================================== */

const views = {
  today,
  library,
  weeks: weeksView,
  exercise: exerciseView,
  practice: practiceView,
  log: logView,
  settings: settingsView,
};

function parseHash() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  return { name: parts[0] || 'today', params: parts.slice(1) };
}

function route() {
  if (!store.state.data) {
    authView('<h2>Loading your exercises</h2><p class="muted">Your saved library loads after sign-in. If it does not appear, connect to the internet and reload.</p><button class="btn" id="retryLibrary">Retry</button><button class="btn" id="signout">Sign out</button>', (root) => {
      root.querySelector('#retryLibrary').onclick = () => cloud.reloadLibrary().catch((err) => toast(err.message));
      root.querySelector('#signout').onclick = () => cloud.signOut().catch((err) => toast(err.message));
    });
    return;
  }
  const { name, params } = parseHash();
  document.body.classList.remove('signed-out');
  document.body.classList.toggle('practicing', name === 'practice');
  nav.querySelectorAll('a').forEach((a) => a.classList.toggle('active', a.dataset.tab === name));
  (views[name] || notFound)(...params);
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) {
          toast('Update ready', { action: 'Reload', onAction: () => location.reload() });
        }
      });
    });
  }).catch((err) => console.warn('Service worker registration failed', err));
}

let signedIn = false;

/** Re-render the current view after synced data changes, unless the user is mid-practice. */
function refreshView() {
  if (!signedIn || !store.state.data) return;
  const { name } = parseHash();
  if (name === 'practice') return;
  if (document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
  route();
}

async function boot() {
  registerServiceWorker();

  try {
    cloud = await import('./cloud.js');
  } catch (err) {
    root.innerHTML = `<section class="card error">
      <h2>Couldn't load sign-in</h2>
      <p class="mt">${esc(err.message)}</p>
      <p class="muted small mt">The first start needs an internet connection to fetch the Firebase library.</p>
    </section>`;
    return;
  }

  window.addEventListener('hashchange', () => { if (signedIn) route(); });
  let denied = false;
  cloud.init({
    onUser(user, { denied: accountDenied = false } = {}) {
      denied = accountDenied;
      signedIn = Boolean(user?.emailVerified) && !denied;
      if (signedIn) route();
      else if (user && !denied) verificationView(user);
      else signInView({ denied });
    },
    onChange: refreshView,
    onError(message, { denied: isDenied = false } = {}) {
      if (isDenied) {
        denied = true;
        signedIn = false;
        signInView({ denied: true, error: message });
        return;
      }
      toast(message, { ms: 6000 });
    },
  });
}

boot();
