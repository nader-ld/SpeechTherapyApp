#!/usr/bin/env node
/* Validates a supplied private library or the synthetic test fixture against the schema
   (small built-in JSON Schema subset, no dependencies) plus referential checks. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, 'tests', 'fixtures', 'exercises.json');
const SCHEMA = path.join(ROOT, 'public', 'data', 'exercises.schema.json');

const schema = JSON.parse(fs.readFileSync(SCHEMA, 'utf8'));
let data;
try {
  data = JSON.parse(fs.readFileSync(DATA, 'utf8'));
} catch (e) {
  console.error(`error exercise library is not valid JSON: ${e.message}`);
  process.exit(1);
}

const errors = [];
const warnings = [];

validate(data, schema, 'root');
semanticChecks(data);
report();

/* ---------- mini JSON Schema validator ---------- */

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (Number.isInteger(v)) return 'integer';
  return typeof v;
}

function resolveRef(ref) {
  if (!ref.startsWith('#/')) throw new Error(`Unsupported $ref ${ref}`);
  return ref.slice(2).split('/').reduce((o, k) => o?.[k], schema);
}

function describe(s) {
  if (s.$ref) s = resolveRef(s.$ref);
  return s.type || (s.enum ? `one of ${s.enum.join('/')}` : 'value');
}

function validate(value, sch, where) {
  if (sch.$ref) {
    const { $ref, ...rest } = sch;
    sch = { ...resolveRef($ref), ...rest };
  }

  if (sch.anyOf) {
    const ok = sch.anyOf.some((s) => {
      const mark = errors.length;
      validate(value, s, where);
      const good = errors.length === mark;
      errors.length = mark;
      return good;
    });
    if (!ok) errors.push(`${where}: must be ${sch.anyOf.map(describe).join(' or ')}`);
    return;
  }

  if (sch.type) {
    const types = [].concat(sch.type);
    const t = typeOf(value);
    if (!types.some((x) => x === t || (x === 'number' && t === 'integer'))) {
      errors.push(`${where}: expected ${types.join('|')}, got ${t}`);
      return;
    }
  }

  if (sch.enum && !sch.enum.includes(value)) {
    errors.push(`${where}: must be one of ${sch.enum.map((v) => JSON.stringify(v)).join(', ')} (got ${JSON.stringify(value)})`);
  }

  if (typeof value === 'string') {
    if (sch.minLength != null && value.length < sch.minLength) errors.push(`${where}: must not be empty`);
    if (sch.pattern && !new RegExp(sch.pattern).test(value)) errors.push(`${where}: ${JSON.stringify(value)} does not match ${sch.pattern}`);
  }

  if (typeof value === 'number') {
    if (sch.minimum != null && value < sch.minimum) errors.push(`${where}: must be >= ${sch.minimum}`);
    if (sch.maximum != null && value > sch.maximum) errors.push(`${where}: must be <= ${sch.maximum}`);
  }

  if (Array.isArray(value)) {
    if (sch.minItems != null && value.length < sch.minItems) errors.push(`${where}: needs at least ${sch.minItems} item(s)`);
    if (sch.items) value.forEach((v, i) => validate(v, sch.items, `${where}[${i}]`));
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const k of sch.required || []) if (!(k in value)) errors.push(`${where}: missing required "${k}"`);
    for (const [k, v] of Object.entries(value)) {
      if (sch.properties?.[k]) validate(v, sch.properties[k], `${where}.${k}`);
      else if (sch.additionalProperties === false) errors.push(`${where}: unknown property "${k}"`);
    }
  }
}

/* ---------- cross-references & mode rules ---------- */

function semanticChecks(d) {
  if (!d || typeof d !== 'object') return;

  const catIds = new Set();
  for (const c of d.categories || []) {
    if (catIds.has(c.id)) errors.push(`duplicate category id "${c.id}"`);
    catIds.add(c.id);
  }

  const exIds = new Set();
  for (const ex of d.exercises || []) {
    const w = `exercise "${ex.id}"`;
    if (exIds.has(ex.id)) errors.push(`duplicate exercise id "${ex.id}"`);
    exIds.add(ex.id);
    if (ex.category && !catIds.has(ex.category)) errors.push(`${w}: unknown category "${ex.category}"`);
    if (ex.mode === 'items' && !ex.items?.length) errors.push(`${w}: mode "items" needs at least one item`);
    if (ex.mode === 'timed' && !ex.durationSec) errors.push(`${w}: mode "timed" needs durationSec`);
    if (ex.mode === 'reps' && !ex.targetReps) errors.push(`${w}: mode "reps" needs targetReps`);
    if (ex.itemTimerSec && ex.mode !== 'items') warnings.push(`${w}: itemTimerSec only applies to mode "items"`);
    if (ex.mode !== 'items' && (ex.items || []).some((i) => i && typeof i === 'object' && i.timerSec)) warnings.push(`${w}: item timerSec only applies to mode "items"`);
    const texts = (ex.items || []).map((i) => (typeof i === 'string' ? i : i?.text));
    const dups = [...new Set(texts.filter((t, i) => texts.indexOf(t) !== i))];
    if (dups.length) warnings.push(`${w}: duplicate items ${dups.map((t) => JSON.stringify(t)).join(', ')}`);
  }

  const today = new Date();
  const todayISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const weekIds = new Set();
  let covered = false;
  let lastDate = '';
  for (const wk of d.weeks || []) {
    if (weekIds.has(wk.id)) errors.push(`duplicate week id "${wk.id}"`);
    weekIds.add(wk.id);
    if (wk.startDate != null) {
      if (Number.isNaN(Date.parse(wk.startDate))) errors.push(`week "${wk.id}": invalid startDate "${wk.startDate}"`);
      else {
        if (new Date(wk.startDate).getUTCDay() !== 1) warnings.push(`week "${wk.id}": startDate ${wk.startDate} is not a Monday`);
        if (wk.startDate < lastDate) warnings.push(`week "${wk.id}": startDate ${wk.startDate} is earlier than the week listed before it; list weeks oldest first`);
        lastDate = wk.startDate;
      }
    }
    for (const id of wk.exerciseIds || []) if (!exIds.has(id)) errors.push(`week "${wk.id}": unknown exercise "${id}"`);
    if (!wk.startDate || wk.startDate <= todayISO) covered = true;
  }
  if ((d.weeks || []).length && !covered) warnings.push('every week starts in the future; the app will show the first one');

  const used = new Set((d.weeks || []).flatMap((w) => w.exerciseIds || []));
  const unused = [...exIds].filter((id) => !used.has(id));
  if (unused.length) warnings.push(`not in any week (still shown in Library): ${unused.join(', ')}`);

  if (/sample/i.test(d.meta?.notes || '')) warnings.push('meta.notes still says this is sample data');
}

function report() {
  for (const w of warnings) console.log(`warn  ${w}`);
  if (errors.length) {
    for (const e of errors) console.error(`error ${e}`);
    console.error(`\n${errors.length} error(s) in exercise library`);
    process.exit(1);
  }
  console.log(`ok    ${data.exercises.length} exercises, ${data.categories.length} categories, ${data.weeks.length} weeks`);
}
