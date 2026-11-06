#!/usr/bin/env node
/**
 * Chọn và chạy spec trong tests/prod/ theo task (spec của task + regression theo object + smoke).
 *
 *   node scripts/qa/prod-run.mjs --env production --tasks <KEY>,<KEY> [--plan] [--parallel 3]
 *   node scripts/qa/prod-run.mjs --env staging --tasks <KEY>               # thử spec trên staging trước khi deploy
 *   node scripts/qa/prod-run.mjs --env staging --spec tests/prod/<object>/x.mjs
 *   node scripts/qa/prod-run.mjs --env production --objects <object> | --smoke | --all
 *
 * Cần tests/prod/manifest.json và tests/prod/env.<môi trường>.json, QA tự chép từ file .example.json rồi điền.
 *
 * Object/feature = object_key/feature_key của repo knowledge (đồng bộ bằng sync_objects.mjs), cũng là tag task trên Testlane.
 * Cách chọn (in ra kèm lý do ở --plan):
 *   1. Spec của task: meta.tasks có key đó.
 *   2. Cùng feature: spec có feature nằm trong manifest.tasks[KEY].features.
 *   3. Cùng object: mọi spec của object task đụng (manifest.tasks[KEY].objects + object của feature/spec của task).
 *   4. Ảnh hưởng: lan theo `affects` (bắc cầu) → mọi spec của các object đó.
 *   5. Smoke: spec có meta.smoke = true — luôn chạy khi chạy theo task.
 * Spec thiếu fixture của môi trường → không chạy, báo "thiếu fixture" (agent dựng data rồi chạy lại).
 * Kết quả: runs/<KEY>/script-results.jsonl (KEY mặc định PROD-<ngày> / STG-<ngày>) + bảng kết luận từng task.
 * Không ghi Testlane. Agent qa-prod-verify đọc kết quả rồi cập nhật.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as lib from './lib.mjs';
import { runCases, DEFAULT_STATE } from './run.mjs';

const PROD_DIR = path.join(lib.ROOT, 'tests/prod');
const a = process.argv.slice(2);
const flag = k => a.includes(k);
const val = (k, d) => (a.includes(k) ? a[a.indexOf(k) + 1] : d);
const list = k => (val(k) ? val(k).split(',').map(s => s.trim()).filter(Boolean) : []);
const envName = val('--env', 'staging');
const tasks = list('--tasks'), objectsArg = list('--objects');
const specArg = a.filter((x, i) => a[i - 1] === '--spec');

const envFile = path.join(PROD_DIR, `env.${envName}.json`);
if (!fs.existsSync(envFile)) {
  console.error(`Thiếu ${path.relative(lib.ROOT, envFile)} — chép từ env.${envName}.example.json rồi điền giá trị`);
  process.exit(2);
}
const envCfg = JSON.parse(fs.readFileSync(envFile, 'utf8'));
const todo = JSON.stringify(envCfg).match(/TODO[^"]*/);
if (todo) {
  console.error(`${path.relative(lib.ROOT, envFile)} còn ${todo[0]}`);
  process.exit(2);
}
lib.configure(envCfg);
const manifestFile = path.join(PROD_DIR, 'manifest.json');
if (!fs.existsSync(manifestFile)) {
  console.error(`Thiếu ${path.relative(lib.ROOT, manifestFile)} — chép từ manifest.example.json rồi chạy scripts/qa/sync_objects.mjs`);
  process.exit(2);
}
const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
manifest.objects ||= {};
manifest.tasks ||= {};

// --- nạp spec ---
const specs = [];
for (const dir of fs.readdirSync(PROD_DIR, { withFileTypes: true }).filter(d => d.isDirectory())) {
  for (const f of fs.readdirSync(path.join(PROD_DIR, dir.name)).filter(x => x.endsWith('.mjs')).sort()) {
    const file = path.join(PROD_DIR, dir.name, f);
    const meta = (await import(pathToFileURL(file).href)).meta || {};
    const object = meta.object || dir.name;
    if (object !== dir.name) console.warn(`⚠ ${f}: meta.object=${object} khác thư mục ${dir.name}`);
    if (!manifest.objects[object]) console.warn(`⚠ ${f}: object ${object} không có trong manifest (chạy sync_objects.mjs)`);
    const features = [].concat(meta.feature || []).map(x => `${object}/${x}`);
    specs.push({ file, rel: path.relative(lib.ROOT, file), id: meta.id || f, object, features, fixture: meta.fixture, tasks: meta.tasks || [], cases: meta.cases || [], smoke: !!meta.smoke });
  }
}

// --- chọn spec ---
const pick = new Map(); // rel → { spec, reasons: [] }
const add = (s, why) => (pick.get(s.rel) || pick.set(s.rel, { spec: s, reasons: [] }).get(s.rel)).reasons.push(why);
function closure(start) {
  const via = new Map(start.map(o => [o, null]));
  const q = [...start];
  while (q.length) {
    const o = q.shift();
    for (const n of manifest.objects[o]?.affects || []) if (!via.has(n)) via.set(n, o), q.push(n);
  }
  return via; // object → object cha (null = bị đụng trực tiếp)
}
const chain = (via, o) => { const c = [o]; while (via.get(c[0])) c.unshift(via.get(c[0])); return c.join(' → '); };
const taskScope = {};
for (const k of tasks) {
  const own = specs.filter(s => s.tasks.includes(k));
  own.forEach(s => add(s, `spec của ${k}`));
  const feats = [...new Set([...(manifest.tasks[k]?.features || []), ...own.flatMap(s => s.features)])];
  const touched = [...new Set([...(manifest.tasks[k]?.objects || []), ...feats.map(f => f.split('/')[0]), ...own.map(s => s.object)])];
  if (!touched.length) console.warn(`⚠ ${k}: chưa có spec và chưa khai báo objects/features trong manifest.tasks`);
  const via = closure(touched);
  for (const s of specs) {
    if (s.tasks.includes(k)) continue;
    if (s.features.some(f => feats.includes(f))) add(s, `regression ${k}: cùng feature ${s.features.find(f => feats.includes(f))}`);
    else if (touched.includes(s.object)) add(s, `regression ${k}: cùng object ${s.object}`);
    else if (via.has(s.object)) add(s, `regression ${k}: ảnh hưởng ${chain(via, s.object)}`);
  }
  taskScope[k] = { objects: touched, features: feats, affected: [...via.keys()] };
}
if (tasks.length || flag('--smoke')) specs.filter(s => s.smoke).forEach(s => add(s, 'smoke'));
if (objectsArg.length) { const via = closure(objectsArg); specs.filter(s => via.has(s.object)).forEach(s => add(s, `object ${chain(via, s.object)}`)); }
if (flag('--all')) specs.forEach(s => add(s, 'all'));
for (const r of specArg) { const s = specs.find(x => x.rel === r || x.file === path.resolve(r)); s ? add(s, 'chỉ định') : console.warn(`⚠ không thấy spec ${r}`); }

const fixtureOf = s => (s.fixture ? manifest.objects[s.object]?.fixtures?.[envName]?.[s.fixture] : {}) ?? null; // spec không cần data → {}
const chosen = [...pick.values()];
const runnable = chosen.filter(p => fixtureOf(p.spec));
const noFixture = chosen.filter(p => !fixtureOf(p.spec));

console.log(`## Kế hoạch — ${envName} — ${chosen.length} spec (${runnable.length} chạy được, ${noFixture.length} thiếu fixture)\n`);
console.log('| Spec | Feature | Lý do | Fixture |\n|---|---|---|---|');
for (const p of chosen) console.log(`| ${p.spec.rel} | ${p.spec.features.join(', ') || p.spec.object} | ${p.reasons.join('; ')} | ${fixtureOf(p.spec) ? (p.spec.fixture || '—') : `**thiếu ${p.spec.fixture}**`} |`);
if (!chosen.length) { console.log('(không có spec nào khớp)'); process.exit(0); }
if (flag('--plan')) process.exit(0);

const key = val('--key', `${envName === 'production' ? 'PROD' : 'STG'}-${new Date().toISOString().slice(0, 10)}`);
const state = envCfg.state === 'none' ? 'none' : envCfg.state ? path.join(lib.ROOT, envCfg.state) : DEFAULT_STATE;
const results = runnable.length ? await runCases(runnable.map(p => p.spec.file), {
  key, parallel: +val('--parallel', 1), headed: flag('--headed'), state: val('--state', state), quiet: true,
  fx: file => fixtureOf(specs.find(s => s.file === path.resolve(file))),
}) : [];
const byRel = Object.fromEntries(results.map(r => [r.file, r]));

console.log(`\n## Kết quả — ${envName} — ${key}\n\n| Spec | Case Testlane | Kết quả | Check sai / lỗi | Bất thường | Evidence |\n|---|---|---|---|---|---|`);
for (const p of chosen) {
  const r = byRel[p.spec.rel];
  const bad = r ? (r.error || r.checks.filter(c => !c.ok).map(c => c.name).join('; ') || '—') : 'thiếu fixture — chưa chạy';
  console.log(`| ${p.spec.rel} | ${p.spec.cases.join(', ') || '—'} | ${r?.status || 'no-fixture'} | ${bad.slice(0, 140)} | ${r?.anomalies.length || '—'} | ${r?.evidence.join(' ') || '—'} |`);
}
if (tasks.length) {
  console.log('\n## Kết luận theo task\n\n| Task | Spec của task | Regression liên quan | Kết luận |\n|---|---|---|---|');
  for (const k of tasks) {
    const mine = chosen.filter(p => p.reasons.some(r => r === `spec của ${k}` || r.startsWith(`regression ${k}:`) || r === 'smoke'));
    const st = p => byRel[p.spec.rel]?.status || 'no-fixture';
    const own = mine.filter(p => p.spec.tasks.includes(k)), reg = mine.filter(p => !p.spec.tasks.includes(k));
    const fmt = ps => `${ps.filter(p => st(p) === 'pass').length}/${ps.length} pass`;
    const ok = own.length > 0 && mine.every(p => st(p) === 'pass');
    const verdict = ok ? `PASS → đủ điều kiện Done (${envName})` : !own.length ? 'CHƯA CÓ SPEC của task' : `CHƯA ĐẠT: ${mine.filter(p => st(p) !== 'pass').map(p => `${p.spec.id}=${st(p)}`).join(', ')}`;
    console.log(`| ${k} | ${fmt(own)} | ${fmt(reg)} | ${verdict} |`);
  }
}
console.log(`\n→ runs/${key}/script-results.jsonl`);
process.exit(results.some(r => r.status !== 'pass') || noFixture.length ? 1 : 0);
