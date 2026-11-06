#!/usr/bin/env node
/**
 * Chạy nhiều case script trong một lệnh, mỗi case một browser context riêng.
 *
 *   node scripts/qa/run.mjs --key <KEY> [--parallel 3] [--headed] [--state <storageState.json>] <case.mjs | thư mục> ...
 *
 * Case = file .mjs:
 *   export const meta = { id: 'TC-01', title: '...' };            // tuỳ chọn
 *   export default async ({ page, cfg, api, net, until, check, note, shot, testFile, fx }) => { ... };
 *
 * Kết quả mỗi case: pass (mọi check đúng) | fail (có check sai) | error (văng lỗi — agent tự phân loại:
 * lỗi luồng test hay lỗi setup/tool). Runner KHÔNG ghi Testlane; agent đọc kết quả rồi update.
 * Tự ghi bất thường: console error, request của product >= 400 / failed. Lỗi → lưu trace để mở bằng
 * `npx playwright show-trace`. Kết quả nối vào runs/<KEY>/script-results.jsonl, evidence ở evidence/<KEY>/.
 * prod-run.mjs dùng lại runCases() (kèm fixture `fx` theo môi trường).
 * Không truyền --state: dùng playwright/.auth/mcp-isolated.json nếu có, không có thì chạy không session.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as lib from './lib.mjs';

export const DEFAULT_STATE = path.join(lib.ROOT, 'playwright/.auth/mcp-isolated.json');

export function expandFiles(list) {
  return list.flatMap(f => (fs.statSync(f).isDirectory() ? fs.readdirSync(f).filter(x => x.endsWith('.mjs')).sort().map(x => path.join(f, x)) : [f]));
}

/** opt: { key, parallel, headed, state ('none' = không session), fx(file) → fixture, quiet } → mảng kết quả */
export async function runCases(files, opt) {
  const useState = opt.state && opt.state !== 'none';
  if (useState && !fs.existsSync(opt.state)) throw new Error(`Thiếu storageState ${opt.state} — tạo session trước (xem scripts/qa/README.md) hoặc dùng --state none`);
  const evDir = path.join(lib.ROOT, 'evidence', opt.key);
  const resultsFile = path.join(lib.ROOT, 'runs', opt.key, 'script-results.jsonl');
  fs.mkdirSync(evDir, { recursive: true });
  fs.mkdirSync(path.dirname(resultsFile), { recursive: true });
  const browser = await lib.openBrowser({ headed: opt.headed });

  async function runCase(file) {
    const mod = await import(pathToFileURL(path.resolve(file)).href);
    const id = mod.meta?.id || path.basename(file, '.mjs');
    const slug = id.replace(/[^\w.-]+/g, '_');
    const context = await browser.newContext(useState ? { storageState: opt.state } : {});
    await context.tracing.start({ screenshots: true, snapshots: true });
    const page = await context.newPage();
    const anomalies = lib.watchAnomalies(page);
    const rec = lib.recorder(page, evDir, slug);
    const { checks, notes, evidence, check, note, shot, evidencePath } = rec;
    const t = { ...lib, page, context, key: opt.key, fx: opt.fx?.(file, mod.meta) ?? {}, check, note, shot, evidencePath };

    const t0 = Date.now();
    let status = 'pass', error = null;
    try {
      await mod.default(t);
      if (!checks.length) status = 'error', error = 'case không có check() nào';
      else if (checks.some(c => !c.ok)) status = 'fail';
    } catch (e) {
      status = 'error';
      error = String(e.stack || e).split('\n').slice(0, 4).join(' | ');
    }
    if (status !== 'pass') {
      await rec.saveFailure(context);
    } else {
      await context.tracing.stop();
    }
    await context.close();
    const r = { at: new Date().toISOString(), env: lib.cfg.env, id, title: mod.meta?.title || '', file: path.relative(lib.ROOT, path.resolve(file)), status, ms: Date.now() - t0, checks, notes, evidence, anomalies: anomalies.slice(0, 30), error };
    fs.appendFileSync(resultsFile, JSON.stringify(r) + '\n');
    return r;
  }

  const queue = [...files], results = [];
  try {
    await Promise.all(Array.from({ length: Math.min(opt.parallel || 1, files.length) }, async () => {
      while (queue.length) results.push(await runCase(queue.shift()));
    }));
  } finally {
    await browser.close();
  }
  const order = files.map(f => path.relative(lib.ROOT, path.resolve(f)));
  results.sort((a, b) => order.indexOf(a.file) - order.indexOf(b.file));
  if (!opt.quiet) {
    for (const r of results) console.log(JSON.stringify(r));
    console.log('\n| Case | Kết quả | Thời gian | Check sai / lỗi | Bất thường |\n|---|---|---|---|---|');
    for (const r of results) {
      const bad = r.error || r.checks.filter(c => !c.ok).map(c => c.name).join('; ') || '—';
      console.log(`| ${r.id} | ${r.status} | ${(r.ms / 1000).toFixed(1)}s | ${bad.slice(0, 120)} | ${r.anomalies.length || '—'} |`);
    }
    console.log(`\n→ ${path.relative(lib.ROOT, resultsFile)}`);
  }
  return results;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const opt = { parallel: 1, headed: false, state: fs.existsSync(DEFAULT_STATE) ? DEFAULT_STATE : 'none', key: null, files: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--key') opt.key = args[++i];
    else if (a === '--parallel') opt.parallel = Math.max(1, +args[++i]);
    else if (a === '--headed') opt.headed = true;
    else if (a === '--state') opt.state = args[++i];
    else opt.files.push(a);
  }
  if (!opt.key || !opt.files.length) {
    console.error('Dùng: node scripts/qa/run.mjs --key <KEY> [--parallel N] [--headed] [--state file] <case.mjs|dir> ...');
    process.exit(2);
  }
  const results = await runCases(expandFiles(opt.files), opt).catch(e => (console.error(e.message), process.exit(2)));
  process.exit(results.some(r => r.status === 'error') ? 1 : 0);
}
