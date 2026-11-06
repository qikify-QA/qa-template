#!/usr/bin/env node
/**
 * Chờ tới khi điều kiện đúng rồi thoát ngay — thay cho `sleep N` cố định.
 *
 *   node scripts/qa/poll.mjs [--timeout 300] [--interval 5] [--match <regex>] -- <lệnh shell>
 *   node scripts/qa/poll.mjs [--timeout 300] [--interval 5] --match <regex> --url <URL>
 *
 * Lệnh: đúng khi exit 0 (và stdout khớp --match nếu có). URL: GET, đúng khi body khớp --match.
 * Exit 0 = đạt (in số giây đã chờ + output cuối), exit 1 = hết giờ.
 * Trạng thái chỉ đọc được qua MCP thì để agent gọi MCP; poll.mjs dành cho thứ gọi được từ shell (curl, API công khai, file).
 */
import { execSync } from 'node:child_process';

const a = process.argv.slice(2);
const sep = a.indexOf('--');
const flags = sep === -1 ? a : a.slice(0, sep);
const cmd = sep === -1 ? null : a.slice(sep + 1).join(' ');
const get = (k, d) => (flags.includes(k) ? flags[flags.indexOf(k) + 1] : d);
const timeout = +get('--timeout', 300) * 1000, interval = +get('--interval', 5) * 1000;
const match = get('--match') ? new RegExp(get('--match')) : null;
const url = get('--url');
if (!cmd && !url) {
  console.error('Cần -- <lệnh> hoặc --url <URL>');
  process.exit(2);
}

const t0 = Date.now();
let last = '';
while (Date.now() - t0 < timeout) {
  let ok = false;
  try {
    if (url) {
      last = await fetch(url, { headers: { Accept: 'application/json' } }).then(r => r.text());
      ok = !match || match.test(last);
    } else {
      last = execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      ok = !match || match.test(last);
    }
  } catch (e) {
    last = String(e.stdout || e.message);
  }
  if (ok) {
    console.log(`OK sau ${((Date.now() - t0) / 1000).toFixed(1)}s\n${last.slice(-1500)}`);
    process.exit(0);
  }
  await new Promise(r => setTimeout(r, interval));
}
console.log(`HẾT GIỜ ${timeout / 1000}s\n${last.slice(-1500)}`);
process.exit(1);
