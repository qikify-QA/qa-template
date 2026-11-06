#!/usr/bin/env node
/**
 * Bộ object/feature của tests/prod/manifest.json = key của repo knowledge (qa-knowledge — bản đã publish) + key riêng (local).
 *
 *   node scripts/qa/sync_objects.mjs                       # đồng bộ với knowledge + kiểm spec/task
 *   node scripts/qa/sync_objects.mjs --check               # chỉ kiểm, exit 1 nếu lệch (preflight)
 *   node scripts/qa/sync_objects.mjs --list                # in toàn bộ key (knowledge + local)
 *   node scripts/qa/sync_objects.mjs --show <object>[/<feature>]   # phạm vi thật (profile knowledge / mô tả local) để quyết có khớp không
 *   node scripts/qa/sync_objects.mjs --add-feature <object>/<feature> --name "..." --scope "..." --evidence <KEY>
 *   node scripts/qa/sync_objects.mjs --add-object <object> --name "..." --scope "..." --evidence <KEY> [--affects a,b]
 *
 * Nguồn knowledge: $QA_KNOWLEDGE_DIR/products/$QA_PRODUCT (đọc từ .env):
 *   _registry.json → object_key, label, aliases · <object>/features/<feature_key>/ → feature. Repo knowledge chỉ ĐỌC.
 * Key local: tạo khi không xác định được key có sẵn nào bao trọn phạm vi thay đổi (so bằng --show, không so tên).
 * Key mới phải đặt đúng phạm vi: kebab-case, không mã ticket / fix / bug / misc...; bắt buộc --name, --scope
 * (thuộc / không thuộc), --evidence. Lệnh cảnh báo key/alias gần giống để tránh trùng nghĩa.
 * Thiếu _registry.json thì cảnh báo rồi chạy tiếp, chỉ dùng key local.
 * Knowledge có đúng key local → tự chuyển sang nguồn knowledge. Key knowledge biến mất → đánh dấu, không xoá.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, knowledge as knowledgeOf } from './lib.mjs';

const { dir: KDIR } = knowledgeOf();
const MANIFEST = path.join(ROOT, 'tests/prod/manifest.json');
const a = process.argv.slice(2);
const val = k => (a.includes(k) ? a[a.indexOf(k) + 1] : undefined);
const check = a.includes('--check');
const today = new Date().toISOString().slice(0, 10);
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
// Từ làm key mơ hồ hoặc gắn với một ticket thay vì một phạm vi chức năng
const BAD_WORDS = /(^|-)(qa|test|fix|bug|hotfix|issue|ticket|misc|other|others|general|common-stuff|new|temp|tmp|v\d+)(-|$)|\d{3,}/;
function badKey(k) {
  if (!KEBAB.test(k)) return 'phải là kebab-case (chữ thường, số, gạch ngang)';
  if (BAD_WORDS.test(k)) return 'không chứa mã ticket / fix / bug / misc / other / general / version — key đặt theo phạm vi chức năng, không theo ticket';
  if (k.length < 3 || k.split('-').length > 6) return 'quá ngắn hoặc quá dài (tối đa 6 từ)';
  return null;
}

const registryFile = path.join(KDIR, '_registry.json');
const registry = fs.existsSync(registryFile) ? JSON.parse(fs.readFileSync(registryFile, 'utf8')) : null;
if (!registry) console.warn(`Cảnh báo: không thấy ${path.relative(ROOT, registryFile)} — kiểm tra QA_PRODUCT, QA_KNOWLEDGE_DIR. Chạy tiếp với key local.`);
if (!fs.existsSync(MANIFEST)) {
  console.error(`Thiếu ${path.relative(ROOT, MANIFEST)} — chép từ tests/prod/manifest.example.json rồi chạy lại`);
  process.exit(2);
}
const dup = n => / \d+(\.\w+)?$/.test(n); // bản sao Finder ("features 2", "kb 2.json")
const knowledge = Object.fromEntries((registry?.objects || []).map(o => {
  const fdir = path.join(KDIR, o.object_key, 'features');
  const features = fs.existsSync(fdir) ? fs.readdirSync(fdir, { withFileTypes: true }).filter(d => d.isDirectory() && !dup(d.name)).map(d => d.name).sort() : [];
  return [o.object_key, { label: o.label, aliases: o.aliases || [], features }];
}));

const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const objs = (manifest.objects ||= {});
for (const m of Object.values(objs)) { m.features ||= []; m.localFeatures ||= {}; }
const changes = [], problems = [];
const save = () => fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');

// ---------- thêm key local ----------
const words = s => s.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2);
/** Key/alias có chung từ (≥3 ký tự) với tên mới — chỉ so phần tên (object hoặc feature), không so tiền tố object. */
function similar(name) {
  const w = words(name), hits = [];
  for (const [o, m] of Object.entries(objs)) {
    const cands = [[o, o, 'object'], ...m.features.map(f => [f, `${o}/${f}`, 'feature']), ...Object.keys(m.localFeatures).map(f => [f, `${o}/${f}`, 'feature local']),
      ...(knowledge[o]?.aliases || []).map(x => [x, `${o} (alias "${x}")`, 'alias'])];
    for (const [text, label, kind] of cands) if (words(text).some(x => w.includes(x))) hits.push(`${label} [${kind}]`);
  }
  return hits;
}
const warnSimilar = name => { const h = similar(name); if (h.length) console.log(`Key/alias gần giống "${name}" — kiểm tra không trùng nghĩa trước khi dùng:\n  ${h.slice(0, 15).join('\n  ')}`); };
const need = () => ['--name', '--scope', '--evidence'].filter(k => !val(k)).map(k => `thiếu ${k}`);
if (val('--add-feature')) {
  const [o, f] = val('--add-feature').split('/');
  if (f) warnSimilar(f);
  const errs = [...need(), ...(f ? [badKey(f)].filter(Boolean).map(e => `feature "${f}": ${e}`) : ['thiếu tên feature'])];
  if (!objs[o]) errs.push(`object ${o} chưa có — xem --list; entity thật sự mới thì --add-object trước`);
  else if (objs[o].features.includes(f) || objs[o].localFeatures[f]) errs.push(`${o}/${f} đã có`);
  if (errs.length) problems.push(...errs);
  else objs[o].localFeatures[f] = { name: val('--name'), scope: val('--scope'), evidence: val('--evidence'), added: today }, changes.push(`+ feature local ${o}/${f}`);
}
if (val('--add-object')) {
  const o = val('--add-object');
  warnSimilar(o);
  const affects = (val('--affects') || '').split(',').map(s => s.trim()).filter(Boolean);
  const errs = [...need(), ...[badKey(o)].filter(Boolean).map(e => `object "${o}": ${e}`), ...affects.filter(x => !objs[x]).map(x => `affects → ${x} chưa có`)];
  if (objs[o]) errs.push(`object ${o} đã có`);
  if (errs.length) problems.push(...errs);
  else {
    objs[o] = { source: 'local', label: val('--name'), scope: val('--scope'), evidence: val('--evidence'), added: today, features: [], localFeatures: {}, affects, fixtures: { staging: {}, production: {} } };
    changes.push(`+ object local ${o}${affects.length ? '' : ' — nhớ khai báo affects'}`);
  }
}

// ---------- đồng bộ với knowledge ----------
manifest.knowledge = { dir: path.relative(ROOT, KDIR), registryStatus: registry?.status ?? 'missing', registryGeneratedAt: registry?.generated_at ?? null };
for (const [key, k] of Object.entries(knowledge)) {
  let m = objs[key];
  if (!m) {
    objs[key] = m = { source: 'knowledge', label: k.label, features: [], localFeatures: {}, affects: [], fixtures: { staging: {}, production: {} } };
    changes.push(`+ object ${key} (knowledge) — cần khai báo affects`);
  } else if (m.source !== 'knowledge') {
    changes.push(`~ object ${key}: local → knowledge`);
    m.source = 'knowledge';
    delete m.added;
  }
  if (m.label !== k.label) changes.push(`~ ${key}: label → ${k.label}`), (m.label = k.label);
  for (const f of k.features.filter(f => !m.features.includes(f))) {
    if (m.localFeatures[f]) delete m.localFeatures[f], changes.push(`~ feature ${key}/${f}: local → knowledge`);
    else changes.push(`+ feature ${key}/${f}`);
  }
  for (const f of m.features.filter(f => !k.features.includes(f))) changes.push(`- feature ${key}/${f} không còn trong knowledge (chuyển thành local)`), (m.localFeatures[f] = { name: f, scope: 'trước đây thuộc knowledge — xem lại phạm vi', added: today });
  m.features = k.features;
  if (m.removedFromKnowledge) delete m.removedFromKnowledge;
}
for (const [key, m] of Object.entries(objs)) {
  if (registry && m.source === 'knowledge' && !knowledge[key] && !m.removedFromKnowledge) m.removedFromKnowledge = today, changes.push(`- object ${key} không còn trong knowledge (giữ lại, cần xem)`);
  m.source ||= knowledge[key] ? 'knowledge' : 'local';
  for (const x of m.affects || []) if (!objs[x]) problems.push(`${key}.affects → ${x} không có`);
}

// ---------- spec + task phải trỏ key có thật ----------
const has = (o, f) => !!objs[o] && (!f || objs[o].features.includes(f) || !!objs[o].localFeatures[f]);
const PROD = path.join(ROOT, 'tests/prod');
for (const d of fs.readdirSync(PROD, { withFileTypes: true }).filter(d => d.isDirectory())) {
  for (const f of fs.readdirSync(path.join(PROD, d.name)).filter(x => x.endsWith('.mjs'))) {
    const meta = (await import(pathToFileURL(path.join(PROD, d.name, f)).href)).meta || {};
    const rel = `tests/prod/${d.name}/${f}`;
    if (!objs[d.name]) problems.push(`${rel}: thư mục ${d.name} không phải object (--add-object nếu là object mới)`);
    if (meta.object && meta.object !== d.name) problems.push(`${rel}: meta.object=${meta.object} khác thư mục`);
    if (!meta.feature) problems.push(`${rel}: thiếu meta.feature`);
    for (const ft of [].concat(meta.feature || [])) if (!has(d.name, ft)) problems.push(`${rel}: feature ${d.name}/${ft} chưa có (--add-feature)`);
  }
}
for (const [t, v] of Object.entries(manifest.tasks || {}))
  for (const tag of [...(v.objects || []), ...(v.features || [])]) if (!has(...tag.split('/'))) problems.push(`manifest.tasks.${t}: ${tag} chưa có`);

if (val('--show')) {
  const [o, f] = val('--show').split('/');
  const m = objs[o];
  if (!m) console.log(`Không có object ${o}`);
  else if (!f) {
    console.log(`${o} [${m.source}] ${m.label}${m.scope ? '\n  phạm vi: ' + m.scope : ''}${knowledge[o] ? '\n  aliases: ' + knowledge[o].aliases.join(', ') : ''}\n  affects: ${(m.affects || []).join(', ') || '—'}`);
    for (const ft of m.features) {
      let p = {};
      try { p = JSON.parse(fs.readFileSync(path.join(KDIR, o, 'features', ft, 'profile.json'), 'utf8')); } catch {}
      console.log(`  ${o}/${ft} — ${p.name || ''}${p.user_goal ? ' · mục tiêu: ' + String(p.user_goal).slice(0, 160) : ''}`);
    }
    for (const [ft, x] of Object.entries(m.localFeatures)) console.log(`  ${o}/${ft} [local] — ${x.name || ''} · phạm vi: ${x.scope || x.desc || ''}`);
  } else if (m.localFeatures[f]) console.log(JSON.stringify({ key: `${o}/${f}`, source: 'local', ...m.localFeatures[f] }, null, 2));
  else {
    try {
      const p = JSON.parse(fs.readFileSync(path.join(KDIR, o, 'features', f, 'profile.json'), 'utf8'));
      const short = x => (Array.isArray(x) ? x.map(i => (typeof i === 'string' ? i : i.name || i.capability || i.description || JSON.stringify(i)).slice(0, 140)) : x);
      console.log(JSON.stringify({ key: `${o}/${f}`, source: 'knowledge', name: p.name, user_goal: p.user_goal, entry_points: short(p.entry_points), capabilities: short(p.capabilities), dependencies: short(p.dependencies) }, null, 2));
    } catch { console.log(`Không có ${o}/${f}`); }
  }
}
if (a.includes('--list')) {
  for (const [o, m] of Object.entries(objs).sort()) {
    console.log(`${o} [${m.source}${m.removedFromKnowledge ? ', đã bỏ khỏi knowledge' : ''}] ${m.label}${m.scope ? ' — ' + m.scope : ''} · affects: ${(m.affects || []).join(', ') || '—'}`);
    for (const f of m.features) console.log(`  ${o}/${f}`);
    for (const [f, x] of Object.entries(m.localFeatures)) console.log(`  ${o}/${f} [local] — ${x.name || ''}${x.scope ? ' · ' + x.scope : ''}`);
  }
}
const n = s => Object.values(objs).filter(m => m.source === s).length;
const nl = Object.values(objs).reduce((c, m) => c + Object.keys(m.localFeatures).length, 0);
console.log(`Knowledge: ${manifest.knowledge.dir} (registry ${manifest.knowledge.registryStatus}, ${manifest.knowledge.registryGeneratedAt}) · object: ${n('knowledge')} knowledge + ${n('local')} local · feature local: ${nl}`);
console.log(changes.length ? changes.join('\n') : 'Không có thay đổi.');
if (problems.length) console.log('\nCần sửa:\n' + problems.map(p => '  ' + p).join('\n'));
if (!check && !problems.length) { save(); if (changes.length) console.log(`→ đã ghi ${path.relative(ROOT, MANIFEST)}`); }
process.exit(problems.length || (check && changes.length) ? 1 : 0);
