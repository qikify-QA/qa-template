#!/usr/bin/env node
/**
 * Lấy đúng phần knowledge cần cho một issue → runs/<KEY>/context.md (các bước sau đọc lại file này, không tải lại).
 *
 *   node scripts/qa/kb_context.mjs <KEY> <object>[/<feature>] ...          # cho analysis
 *   node scripts/qa/kb_context.mjs <KEY> ... --checklists                   # thêm check (gen-testcase, regression)
 *   node scripts/qa/kb_context.mjs <KEY> ... --no-pull                      # không git pull repo knowledge
 *   node scripts/qa/kb_context.mjs <KEY> ... --refresh                      # lấy snapshot mới, liệt kê item đã đổi
 *   node scripts/qa/kb_context.mjs <KEY> ... --new-product                  # product chưa có trong knowledge, chạy tiếp
 *
 * Knowledge: $QA_KNOWLEDGE_DIR/products/$QA_PRODUCT (đọc từ .env).
 *
 * Snapshot: lần chạy đầu của một KEY pull repo knowledge rồi ghim full SHA vào runs/<KEY>/context.json. Mọi lần sau đọc
 * đúng SHA đó bằng git show, nên analysis, testcase và production dùng cùng một bản dù clone đã được run khác pull.
 * Muốn bản mới thì --refresh: bản cũ giữ ở context-<sha>.md, item đổi được liệt kê để xem lại case liên quan.
 *
 * Đầu file là _product-guide.md; thiếu guide thì ghi một dòng cảnh báo rồi chạy tiếp. Chọn key trước bằng sync_objects.mjs --show (theo phạm vi, không theo tên). Mỗi key:
 *   object/feature → item kb.json của feature + item kb.json cấp object + item nối qua related_kb_ids (1 bước)
 *   object         → item kb.json cấp object + danh sách feature kèm user_goal (chưa tải item)
 *   key local      → ghi "knowledge gap" (ứng viên CCR)
 * Item được dùng làm expected khi: CONFIRMED_EXPECTED, không UNRESOLVED/KNOWN_DEFECT, có confirmation_source hợp lệ.
 * CONFIRMED_EXPECTED thiếu nguồn vào mục "Cần xác nhận". Phần còn lại là quan sát, chỉ để tìm vùng regression.
 * Object STALE hoặc usable_as_oracle=false → không oracle.
 * Không đọc open-questions.md (lớn) — grep theo topic khi cần.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { ROOT, knowledge } from './lib.mjs';

const a = process.argv.slice(2);
const has = flag => a.includes(flag);
const [KEY, ...keys] = a.filter(x => !x.startsWith('--'));
if (!KEY || !keys.length) {
  console.error('Dùng: node scripts/qa/kb_context.mjs <KEY> <object>[/<feature>] ... [--checklists] [--no-pull] [--refresh] [--new-product]');
  process.exit(2);
}
const die = msg => { console.error(msg); process.exit(1); };
const { product: PRODUCT, repo: REPO } = knowledge();
const git = (...args) => execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 }).trim();
try { git('rev-parse', '--git-dir'); } catch {
  die(`Không đọc được repo knowledge ở ${REPO}. Clone qa-knowledge hoặc sửa QA_KNOWLEDGE_DIR. Đây là lỗi môi trường, không phải knowledge gap.`);
}

const dir = path.join(process.env.QA_RUNS_DIR || path.join(ROOT, 'runs'), KEY);
const lockFile = path.join(dir, 'context.json');
const readLocal = f => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null);
const prev = readLocal(lockFile);
const pinned = prev && !has('--refresh');

let pull = 'pinned';
let pullError = '';
if (!pinned) {
  pull = 'skipped';
  if (!has('--no-pull')) {
    try { git('pull', '-q', '--ff-only'); pull = 'ok'; } catch (e) { pull = 'failed'; pullError = e.message.split('\n')[0]; console.error(`git pull lỗi, dùng bản đang có: ${pullError}`); }
  }
}
const sha = pinned ? prev.sha : git('rev-parse', 'HEAD');
let commitDate;
try { commitDate = git('log', '-1', '--format=%cs', sha); } catch {
  die(`Snapshot ${sha} không có trong clone ${REPO}. Chạy git fetch trong repo knowledge, hoặc thêm --refresh để lấy snapshot mới.`);
}

// Mọi đọc knowledge đi qua SHA đã ghim, không đọc working tree.
const show = p => { try { return git('show', `${sha}:${p}`); } catch { return null; } };
const readJson = p => { const t = show(p); return t === null ? null : JSON.parse(t); };
const listDir = p => { try { return git('ls-tree', '--name-only', `${sha}:${p}`).split('\n').filter(Boolean); } catch { return []; } };
const K = (...p) => ['products', PRODUCT, ...p].join('/');

const manifest = readJson('manifest.json');
if (!manifest) die(`Không có manifest.json trong qa-knowledge @ ${sha.slice(0, 7)}. Đây là lỗi repo, không phải knowledge gap.`);
const product = manifest.products?.find(p => p.product_key === PRODUCT);
if (!product && !has('--new-product')) {
  die(`Product "${PRODUCT}" không có trong manifest (đang có: ${(manifest.products || []).map(p => p.product_key).join(', ')}). Sửa QA_PRODUCT, hoặc thêm --new-product nếu product này chưa có knowledge.`);
}
const local = readLocal(path.join(ROOT, 'tests/prod/manifest.json'))?.objects || {};

const profileOf = (o, f) => {
  const d = readJson(K(o, 'features', f, 'profile.json'));
  return d?.feature_profiles ? d.feature_profiles[0] : d;
};
// Mọi item của object, để resolve related_kb_ids (kb_id chỉ duy nhất trong một object)
const objectItems = {};
const itemsOf = o => {
  if (objectItems[o]) return objectItems[o];
  const all = new Map();
  const add = (list, where) => (list || []).forEach(i => all.set(i.kb_id, { ...i, where, object: o }));
  add(readJson(K(o, 'kb.json')), o);
  for (const f of listDir(K(o, 'features'))) add(readJson(K(o, 'features', f, 'kb.json')), `${o}/${f}`);
  return (objectItems[o] = all);
};

const SOURCE_TYPES = new Set(['spec_doc', 'dev_doc', 'po_dev_confirm', 'test_case']);
const validSource = s => !!s && typeof s === 'object' && SOURCE_TYPES.has(s.type) && !!s.ref && !!s.authored_on;
const confirmed = i => i.knowledge_kind === 'CONFIRMED_EXPECTED' && i.status !== 'UNRESOLVED' && i.status !== 'KNOWN_DEFECT';
const oracle = i => confirmed(i) && validSource(i.confirmation_source);
const needsSource = i => confirmed(i) && !validSource(i.confirmation_source);

const addr = i => `${PRODUCT}/${i.object}/${i.kb_id}`;
const envOf = i => String(i.scope?.environment || '');
const stagingOnly = i => /staging/i.test(envOf(i)) && !/prod/i.test(envOf(i));
const scopeText = s => Object.entries(s || {}).filter(([k, v]) => k !== 'environment' && v && v !== 'n/a').map(([k, v]) => `${k}=${v}`).join(', ');
const line = i => {
  const tag = [i.knowledge_kind, i.confidence, i.status && `${i.status} ${i.conflict_group || ''}`.trim()].filter(Boolean).join(' · ');
  const src = i.confirmation_source ? ` — nguồn: ${typeof i.confirmation_source === 'string' ? i.confirmation_source : JSON.stringify(i.confirmation_source)}` : '';
  return `- **${addr(i)}** [${envOf(i) || 'không rõ môi trường'}] (${i.where}; ${tag}; ${scopeText(i.scope)}): ${i.statement}${src}`;
};
// Dependency, risk, unknown_area trong knowledge không cùng một shape.
const text = x => {
  if (typeof x === 'string') return x;
  const main = x.question || x.risk || x.description || x.statement || x.relationship || x.relation || x.summary || x.note;
  if (!main) return JSON.stringify(x);
  const extra = x.why_it_matters || x.detail || '';
  const target = x.target || x.target_feature || x.depends_on || x.on;
  return [main, target && `→ ${typeof target === 'string' ? target : JSON.stringify(target)}`, extra && `(${extra})`, x.oq_id && `[${x.oq_id}]`].filter(Boolean).join(' ');
};
const block = (title, list) => (list?.length ? [`${title}:`, ...list.map(x => `- ${text(x)}`), ''] : []);
const envDiff = d => {
  const values = d.test_env || d.production ? `test: ${d.test_env || '—'} | production: ${d.production || '—'}` : d.summary || d.statement || '—';
  return `- ${d.type}: ${values}${d.how_to_test ? ` — cách test: ${d.how_to_test}` : ''}${d.kb_refs?.length ? ` (${d.kb_refs.join(', ')})` : ''}`;
};
const flat = v => (v === null || v === undefined || v === '' ? '' : typeof v === 'string' ? v : JSON.stringify(v));
const checkLine = c => {
  const parts = [c.precondition && `điều kiện: ${flat(c.precondition)}`, c.expected_result && `expected: ${flat(c.expected_result)}`, (c.oracle || c.status) && `oracle: ${flat(c.oracle) || '—'}, status: ${c.status || '—'}`].filter(Boolean);
  return `- ${c.check_id} [${c.dimension}/${c.layer}${c.priority ? `/${c.priority}` : ''}] ${c.title}${parts.length ? ` — ${parts.join(' — ')}` : ''}`;
};

const out = [`# Knowledge context — ${KEY}`, '', `Nguồn: qa-knowledge @ ${sha} (${commitDate}) · sinh ${new Date().toISOString().slice(0, 10)} · key: ${keys.join(', ')}`, ''];
if (pull === 'failed') out.push(`> Cảnh báo: không cập nhật được qa-knowledge (${pullError}). Đang dùng bản local, có thể cũ: "knowledge gap" bên dưới có thể chỉ do clone chưa mới.`, '');
if (!product) out.push(`> Product ${PRODUCT} chưa có trong knowledge (--new-product). Mọi key là knowledge gap.`, '');
out.push('Chỉ mục "Dùng được làm expected" là oracle. Mục "Cần xác nhận" đã gắn nhãn CONFIRMED_EXPECTED nhưng thiếu nguồn: muốn dùng phải có PO/Dev xác nhận. Mục "Quan sát" chỉ để tìm vùng regression và biết feature có surface nào — dùng làm expected cho một task đang đổi chính hành vi đó là sai.',
  'Với mỗi item dùng làm expected, kiểm scope có khớp task không. Item chỉ xác nhận trên staging thì dùng cho production phải kiểm lại.', '');
const guide = show(K('_product-guide.md'));
if (guide !== null) out.push(guide.trim(), '');
else out.push(`> Cảnh báo: product ${PRODUCT} chưa có _product-guide.md. Dùng Jira + KB + khám phá thực tế, đề xuất bổ sung qua CCR khối C.`, '');
const gaps = [];
const seen = new Map();
for (const k of keys) {
  const [o, f] = k.split('/');
  const om = product?.objects?.find(x => x.object_key === o);
  if (!om) { gaps.push(`${k} (object chưa có trong knowledge)`); continue; }
  const items = itemsOf(o);
  const noOracle = om.status !== 'PUBLISHED' || om.kb_items?.usable_as_oracle === false;
  out.push(`## ${k}`, '', `Object ${o}: ${om.status} v${om.published_context_version}` + (om.kb_items ? ` · usable_as_oracle=${om.kb_items.usable_as_oracle}` : '') + (noOracle ? ' → **không dùng làm oracle**' : ''));
  if (om.issues?.length) out.push(`Issue của object: ${om.issues.join(' · ')}`);
  out.push('');
  let picked;
  if (!f) {
    picked = [...items.values()].filter(i => i.where === o);
    out.push('Feature (chưa tải item — chọn feature rồi chạy lại với object/feature):');
    for (const ft of om.features || []) out.push(`- \`${o}/${ft}\`: ${profileOf(o, ft)?.user_goal || ''}`);
    out.push('');
  } else if (!(om.features || []).includes(f)) {
    gaps.push(`${k}${local[o]?.localFeatures?.[f] ? ' (key local)' : ''}`);
    out.push('Feature chưa có trong knowledge → knowledge gap.', '');
    continue;
  } else {
    const p = profileOf(o, f);
    if (p) {
      out.push(`Mục tiêu: ${p.user_goal}`, `Capability: ${(p.capabilities || []).map(c => c.name).join(' · ')}`, '');
      if (p.entry_points?.length) out.push('Entry point:', ...p.entry_points.map(e => `- ${e.path}${e.precondition ? ` — điều kiện: ${e.precondition}` : ''}`), '');
      if (p.environment_differences?.length) out.push('Khác biệt môi trường:', ...p.environment_differences.map(envDiff), '');
      out.push(...block('Phụ thuộc', p.dependencies), ...block('Rủi ro', p.risks), ...block('Chưa rõ', p.unknown_areas));
    }
    picked = [...items.values()].filter(i => i.where === `${o}/${f}` || i.where === o);
    const ids = new Set(picked.map(i => i.kb_id));
    for (const i of [...picked]) for (const r of i.related_kb_ids || []) if (!ids.has(r) && items.has(r)) ids.add(r), picked.push(items.get(r));
  }
  for (const i of picked) seen.set(addr(i), createHash('sha1').update(JSON.stringify([i.statement, i.knowledge_kind, i.status, i.confirmation_source, i.scope])).digest('hex').slice(0, 12));
  const ok = noOracle ? [] : picked.filter(oracle);
  const needs = picked.filter(needsSource);
  const obs = picked.filter(i => !ok.includes(i) && !needs.includes(i));
  const staging = ok.filter(stagingOnly).length;
  out.push(`### Dùng được làm expected (${ok.length})`, '', ...(staging ? [`> ${staging}/${ok.length} item chỉ xác nhận trên staging.`, ''] : []), ...(ok.length ? ok.map(line) : ['- (không có)']), '');
  out.push(`### Cần xác nhận — CONFIRMED_EXPECTED thiếu nguồn, chưa dùng làm expected (${needs.length})`, '', ...(needs.length ? needs.map(line) : ['- (không có)']), '');
  out.push(`### Quan sát / suy luận — không làm expected (${obs.length})`, '', ...(obs.length ? obs.map(line) : ['- (không có)']), '');
  if (f && has('--checklists')) {
    const cd = readJson(K(o, 'checklists', `${f}.json`));
    const cl = cd?.checklists?.[0]?.checks || cd?.checks || [];
    out.push(`### Checklist (${cl.length})`, '', ...cl.map(checkLine), '');
  }
}
if (gaps.length) out.push('## Knowledge gap — ứng viên CCR', '', ...gaps.map(g => `- ${g}`), '');

// --refresh: so item của snapshot cũ với snapshot mới, trong phạm vi object của các key đang chạy.
let changes = null;
if (has('--refresh') && prev?.sha && prev.sha !== sha) {
  const objects = new Set(keys.map(k => k.split('/')[0]));
  const old = Object.entries(prev.items || {}).filter(([k]) => objects.has(k.split('/')[1]));
  changes = {
    added: [...seen.keys()].filter(k => !prev.items?.[k]),
    changed: old.filter(([k, h]) => seen.has(k) && seen.get(k) !== h).map(([k]) => k),
    removed: old.filter(([k]) => !seen.has(k)).map(([k]) => k),
  };
  const list = (t, l) => (l.length ? [`${t}:`, ...l.map(x => `- ${x}`), ''] : []);
  out.push(`## Thay đổi so với snapshot ${prev.sha.slice(0, 7)}`, '', 'Xem lại các case dùng những item này làm expected.', '',
    ...list('Item mới', changes.added), ...list('Item đã đổi', changes.changed), ...list('Không còn trong phạm vi key hiện tại', changes.removed));
  if (!changes.added.length && !changes.changed.length && !changes.removed.length) out.push('Không có item nào đổi.', '');
}

fs.mkdirSync(dir, { recursive: true });
const contextFile = path.join(dir, 'context.md');
if (has('--refresh') && prev?.sha && prev.sha !== sha && fs.existsSync(contextFile)) fs.copyFileSync(contextFile, path.join(dir, `context-${prev.sha.slice(0, 7)}.md`));
fs.writeFileSync(contextFile, out.join('\n'));
const items = pinned ? { ...prev.items, ...Object.fromEntries(seen) } : Object.fromEntries(seen);
fs.writeFileSync(lockFile, JSON.stringify({
  product: PRODUCT,
  sha,
  keys: pinned ? [...new Set([...(prev.keys || []), ...keys])] : keys,
  pinned_at: pinned ? prev.pinned_at : new Date().toISOString(),
  pull: pinned ? prev.pull : pull,
  ...(prev?.sha && prev.sha !== sha ? { previous_sha: prev.sha } : prev?.previous_sha ? { previous_sha: prev.previous_sha } : {}),
  items,
}, null, 2) + '\n');
const size = Buffer.byteLength(out.join('\n'));
console.log(`runs/${KEY}/context.md — ${keys.length} key, ${Math.round(size / 1024)}KB, snapshot ${sha.slice(0, 7)}${pinned ? ' (đã ghim)' : ''}, gap: ${gaps.length ? gaps.join(', ') : 'không'}`);
if (changes) console.log(`Thay đổi: ${changes.added.length} mới, ${changes.changed.length} đổi, ${changes.removed.length} không còn trong phạm vi`);
