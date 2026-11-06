// Kiểm kb_context.mjs trên một repo knowledge giả. Profile dùng đúng các field bắt buộc của
// feature-profile.schema.json (context-lifecycle), nên đây cũng là phép kiểm tương thích với C.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../kb_context.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-context-'));
const repo = path.join(tmp, 'knowledge');
const runs = path.join(tmp, 'runs');
const P = path.join(repo, 'products/demo');
const SOURCE = { type: 'test_case', ref: 'TC-1 PASS', authored_on: '2026-11-01' };

const item = (kb_id, extra = {}) => ({ kb_id, statement: `câu ${kb_id}`, knowledge_kind: 'OBSERVED_CURRENT', confidence: 'LOW', scope: { environment: 'staging', role: 'owner' }, ...extra });
const write = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof v === 'string' ? v : JSON.stringify(v, null, 2)); };
const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' }).trim();
const commit = msg => { git('add', '-A'); git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', msg); return git('rev-parse', 'HEAD'); };
const run = (key, args, env = {}) => spawnSync('node', [SCRIPT, key, ...args], { encoding: 'utf8', env: { ...process.env, QA_PRODUCT: 'demo', QA_KNOWLEDGE_DIR: repo, QA_RUNS_DIR: runs, ...env } });
const context = key => fs.readFileSync(path.join(runs, key, 'context.md'), 'utf8');
const section = (md, title) => md.split('### ').find(s => s.startsWith(title));

let first;
before(() => {
  fs.mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '-q', repo]);
  write(path.join(repo, 'manifest.json'), { products: [{ product_key: 'demo', objects: [{ object_key: 'obj', status: 'PUBLISHED', published_context_version: '1', features: ['feat'], kb_items: { usable_as_oracle: true } }] }] });
  write(path.join(P, '_product-guide.md'), '# Guide demo');
  write(path.join(P, 'obj/kb.json'), []);
  write(path.join(P, 'obj/features/feat/kb.json'), [
    item('KB-1', { knowledge_kind: 'CONFIRMED_EXPECTED', confirmation_source: SOURCE }),
    item('KB-2', { knowledge_kind: 'CONFIRMED_EXPECTED' }),
    item('KB-3', { knowledge_kind: 'CONFIRMED_EXPECTED', confirmation_source: { type: 'slack', ref: 'x', authored_on: '2026-11-01' } }),
    item('KB-4', { knowledge_kind: 'CONFIRMED_EXPECTED', confirmation_source: SOURCE, status: 'KNOWN_DEFECT' }),
    item('KB-5', { knowledge_kind: 'CONFIRMED_EXPECTED', confirmation_source: SOURCE, status: 'UNRESOLVED', conflict_group: 'CONF-1' }),
    item('KB-6'),
  ]);
  write(path.join(P, 'obj/features/feat/profile.json'), { feature_profiles: [{
    feature_key: 'feat', name: 'Feat', user_goal: 'mục tiêu',
    entry_points: [{ path: '/feat', precondition: 'đã bật setting X' }],
    dependencies: [{ type: 'feature', description: 'cần feature khác', kb_refs: ['KB-1'] }, 'phụ thuộc dạng chuỗi', { depends_on: 'sdk', relationship: 'render ở sdk' }],
    risks: [{ risk: 'mất dữ liệu', kb_refs: [] }],
    unknown_areas: [{ question: 'giới hạn là bao nhiêu', why_it_matters: 'ảnh hưởng biên', oq_id: 'OQ-1' }],
    environment_differences: [{ type: 'DIFFERENT_VALUE', test_env: 'giới hạn 10', production: 'giới hạn 100', how_to_test: 'đổi plan', kb_refs: ['KB-1'] }],
  }] });
  write(path.join(P, 'obj/checklists/feat.json'), { checklists: [{ checks: [{ check_id: 'CHK-1', dimension: 'CORE', layer: 'portal', title: 'tiêu đề', precondition: 'có data', expected_result: 'hiện đúng', oracle: 'STRONG', status: 'READY' }] }] });
  first = commit('base');
});
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('chỉ item đủ điều kiện mới làm expected', () => {
  assert.equal(run('ORACLE', ['obj/feat', '--no-pull']).status, 0);
  const md = context('ORACLE');
  const ok = section(md, 'Dùng được'), needs = section(md, 'Cần xác nhận'), obs = section(md, 'Quan sát');
  assert.match(ok, /demo\/obj\/KB-1\*\*/);
  for (const id of ['KB-2', 'KB-3', 'KB-4', 'KB-5', 'KB-6']) assert.doesNotMatch(ok, new RegExp(`${id}\\*\\*`));
  assert.match(needs, /KB-2\*\*/);
  assert.match(needs, /KB-3\*\*/);
  assert.match(obs, /KB-4\*\*/);
  assert.match(obs, /KB-5\*\*/);
  assert.match(obs, /KB-6\*\*/);
  assert.match(ok, /1\/1 item chỉ xác nhận trên staging/);
});

test('xuất đủ dữ liệu quyết định cách test, kể cả profile đúng schema C', () => {
  run('FIELDS', ['obj/feat', '--no-pull', '--checklists']);
  const md = context('FIELDS');
  assert.match(md, /\/feat — điều kiện: đã bật setting X/);
  assert.match(md, /DIFFERENT_VALUE: test: giới hạn 10 \| production: giới hạn 100 — cách test: đổi plan \(KB-1\)/);
  for (const s of ['cần feature khác', 'phụ thuộc dạng chuỗi', 'render ở sdk', 'mất dữ liệu', 'giới hạn là bao nhiêu', 'OQ-1']) assert.ok(md.includes(s), s);
  assert.match(md, /CHK-1 \[CORE\/portal\] tiêu đề — điều kiện: có data — expected: hiện đúng — oracle: STRONG, status: READY/);
});

test('ghim SHA đầy đủ và đọc đúng snapshot dù clone đã đổi', () => {
  run('PIN', ['obj/feat', '--no-pull']);
  const lock = JSON.parse(fs.readFileSync(path.join(runs, 'PIN/context.json'), 'utf8'));
  assert.equal(lock.sha, first);
  assert.equal(lock.sha.length, 40);
  write(path.join(P, 'obj/features/feat/kb.json'), [item('KB-1', { statement: 'bản mới', knowledge_kind: 'CONFIRMED_EXPECTED', confirmation_source: SOURCE }), item('KB-7')]);
  const second = commit('change');
  run('PIN', ['obj/feat', '--checklists']);
  assert.doesNotMatch(context('PIN'), /bản mới/);
  assert.match(context('PIN'), new RegExp(first));

  const r = run('PIN', ['obj/feat', '--no-pull', '--refresh']);
  assert.equal(r.status, 0);
  const md = context('PIN');
  assert.match(md, new RegExp(second));
  assert.match(md, /bản mới/);
  assert.match(md, /Item mới:\n- demo\/obj\/KB-7/);
  assert.match(md, /Item đã đổi:\n- demo\/obj\/KB-1/);
  assert.match(md, /Không còn trong phạm vi key hiện tại:\n- demo\/obj\/KB-2/);
  assert.ok(fs.existsSync(path.join(runs, 'PIN', `context-${first.slice(0, 7)}.md`)));
  assert.equal(JSON.parse(fs.readFileSync(path.join(runs, 'PIN/context.json'), 'utf8')).previous_sha, first);
});

test('pull lỗi được ghi vào context.md', () => {
  assert.equal(run('PULL', ['obj/feat']).status, 0); // repo giả không có remote
  assert.match(context('PULL'), /Cảnh báo: không cập nhật được qa-knowledge/);
});

test('thiếu clone hoặc sai product là lỗi, không phải knowledge gap', () => {
  const missing = run('NOCLONE', ['obj/feat'], { QA_KNOWLEDGE_DIR: path.join(tmp, 'khong-co') });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /không phải knowledge gap/);
  assert.equal(fs.existsSync(path.join(runs, 'NOCLONE/context.md')), false);

  const wrong = run('WRONG', ['obj/feat', '--no-pull'], { QA_PRODUCT: 'sai' });
  assert.equal(wrong.status, 1);
  assert.match(wrong.stderr, /không có trong manifest/);

  assert.equal(run('NEW', ['obj/feat', '--no-pull', '--new-product'], { QA_PRODUCT: 'moi' }).status, 0);
  assert.match(context('NEW'), /object chưa có trong knowledge/);
});
