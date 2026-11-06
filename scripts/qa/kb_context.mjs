#!/usr/bin/env node
/**
 * Lấy đúng phần knowledge cần cho một issue → runs/<KEY>/context.md (các bước sau đọc lại file này, không tải lại).
 *
 *   node scripts/qa/kb_context.mjs <KEY> <object>[/<feature>] ...          # cho analysis
 *   node scripts/qa/kb_context.mjs <KEY> ... --checklists                   # thêm tiêu đề check (gen-testcase, regression)
 *   node scripts/qa/kb_context.mjs <KEY> ... --no-pull                      # không git pull repo knowledge
 *
 * Knowledge: $QA_KNOWLEDGE_DIR/products/$QA_PRODUCT (đọc từ .env).
 * Đầu file là _product-guide.md; thiếu guide thì ghi một dòng cảnh báo rồi chạy tiếp. Chọn key trước bằng sync_objects.mjs --show (theo phạm vi, không theo tên). Mỗi key:
 *   object/feature → item kb.json của feature + item kb.json cấp object + item nối qua related_kb_ids (1 bước)
 *   object         → item kb.json cấp object + danh sách feature kèm user_goal (chưa tải item)
 *   key local      → ghi "knowledge gap" (ứng viên CCR)
 * Item chỉ giữ statement / knowledge_kind / confidence / scope. Chỉ CONFIRMED_EXPECTED (không UNRESOLVED) được dùng làm
 * expected; phần còn lại là quan sát, chỉ để tìm vùng regression. Object STALE hoặc usable_as_oracle=false → không oracle.
 * Không đọc open-questions.md (lớn) — grep theo topic khi cần.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, knowledge } from './lib.mjs';

const a = process.argv.slice(2);
const [KEY, ...keys] = a.filter(x => !x.startsWith('--'));
if (!KEY || !keys.length) {
  console.error('Dùng: node scripts/qa/kb_context.mjs <KEY> <object>[/<feature>] ... [--checklists] [--no-pull]');
  process.exit(2);
}
const { product: PRODUCT, repo: REPO, dir: KDIR } = knowledge();
const git = (...args) => execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8' }).trim();
if (!a.includes('--no-pull')) {
  try { git('pull', '-q', '--ff-only'); } catch (e) { console.error(`git pull lỗi, dùng bản đang có: ${e.message.split('\n')[0]}`); }
}
let commit = 'không rõ commit';
try { commit = git('log', '-1', '--format=%h %cs'); } catch {}
const readJson = f => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null);
const product = readJson(path.join(REPO, 'manifest.json'))?.products?.find(p => p.product_key === PRODUCT);
const local = readJson(path.join(ROOT, 'tests/prod/manifest.json'))?.objects || {};

const profileOf = (o, f) => {
  const d = readJson(path.join(KDIR, o, 'features', f, 'profile.json'));
  return d?.feature_profiles ? d.feature_profiles[0] : d;
};
// Mọi item của object, để resolve related_kb_ids (kb_id chỉ duy nhất trong một object)
const objectItems = {};
const itemsOf = o => {
  if (objectItems[o]) return objectItems[o];
  const all = new Map();
  const add = (list, where) => (list || []).forEach(i => all.set(i.kb_id, { ...i, where }));
  add(readJson(path.join(KDIR, o, 'kb.json')), o);
  const fdir = path.join(KDIR, o, 'features');
  for (const f of fs.existsSync(fdir) ? fs.readdirSync(fdir) : []) add(readJson(path.join(fdir, f, 'kb.json')), `${o}/${f}`);
  return (objectItems[o] = all);
};
const oracle = i => i.knowledge_kind === 'CONFIRMED_EXPECTED' && i.status !== 'UNRESOLVED';
const scopeText = s => Object.entries(s || {}).filter(([, v]) => v && v !== 'n/a').map(([k, v]) => `${k}=${v}`).join(', ');
const line = i => {
  const tag = [i.knowledge_kind, i.confidence, i.status === 'UNRESOLVED' && `UNRESOLVED ${i.conflict_group || ''}`.trim()].filter(Boolean).join(' · ');
  const src = i.confirmation_source ? ` — nguồn: ${typeof i.confirmation_source === 'string' ? i.confirmation_source : JSON.stringify(i.confirmation_source)}` : '';
  return `- **${i.kb_id}** (${i.where}; ${tag}; ${scopeText(i.scope)}): ${i.statement}${src}`;
};

const out = [`# Knowledge context — ${KEY}`, '', `Nguồn: qa-knowledge @ ${commit} · sinh ${new Date().toISOString().slice(0, 10)} · key: ${keys.join(', ')}`, '',
  'Chỉ mục "Dùng được làm expected" là oracle. Mục "Quan sát" chỉ để tìm vùng regression và biết feature có surface nào — dùng làm expected cho một task đang đổi chính hành vi đó là sai.', ''];
const guideFile = path.join(KDIR, '_product-guide.md');
if (fs.existsSync(guideFile)) out.push(fs.readFileSync(guideFile, 'utf8').trim(), '');
else out.push(`> Cảnh báo: product ${PRODUCT} chưa có _product-guide.md. Dùng Jira + KB + khám phá thực tế, đề xuất bổ sung qua CCR khối C.`, '');
const gaps = [];
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
    if (p) out.push(`Mục tiêu: ${p.user_goal}`, `Capability: ${(p.capabilities || []).map(c => c.name).join(' · ')}`, `Entry point: ${(p.entry_points || []).map(e => e.path).join(' · ')}`, '');
    if (p?.environment_differences?.length) out.push('Khác biệt môi trường:', ...p.environment_differences.map(d => `- ${d.type}: ${d.summary || d.statement || ''}${d.how_to_test ? ` — cách test: ${d.how_to_test}` : ''}`), '');
    picked = [...items.values()].filter(i => i.where === `${o}/${f}` || i.where === o);
    const ids = new Set(picked.map(i => i.kb_id));
    for (const i of [...picked]) for (const r of i.related_kb_ids || []) if (!ids.has(r) && items.has(r)) ids.add(r), picked.push(items.get(r));
  }
  const ok = noOracle ? [] : picked.filter(oracle);
  const obs = picked.filter(i => !ok.includes(i));
  out.push(`### Dùng được làm expected (${ok.length})`, '', ...(ok.length ? ok.map(line) : ['- (không có)']), '');
  out.push(`### Quan sát / suy luận — không làm expected (${obs.length})`, '', ...(obs.length ? obs.map(line) : ['- (không có)']), '');
  if (f && a.includes('--checklists')) {
    const cd = readJson(path.join(KDIR, o, 'checklists', `${f}.json`));
    const cl = cd?.checklists?.[0]?.checks || cd?.checks || [];
    out.push(`### Checklist (${cl.length})`, '', ...cl.map(c => `- ${c.check_id} [${c.dimension}/${c.layer}${c.priority ? `/${c.priority}` : ''}] ${c.title}`), '');
  }
}
if (gaps.length) out.push('## Knowledge gap — ứng viên CCR', '', ...gaps.map(g => `- ${g}`), '');

const dir = path.join(ROOT, 'runs', KEY);
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'context.md'), out.join('\n'));
const size = Buffer.byteLength(out.join('\n'));
console.log(`runs/${KEY}/context.md — ${keys.length} key, ${Math.round(size / 1024)}KB, gap: ${gaps.length ? gaps.join(', ') : 'không'}`);
