/**
 * Helper chung cho execute test của mọi product: đọc env, mở browser, check, shot, trace, until, net.*.
 * Dùng qua runner: node scripts/qa/run.mjs --key <KEY> <case.mjs ...>  (xem scripts/qa/README.md)
 * Helper riêng của một product đặt ở scripts/qa/product/<product>.mjs, không đặt ở đây.
 *
 * Nguyên tắc: không chờ cố định. Mọi bước chờ đúng điều kiện (response, selector, until()).
 * File này không import Playwright ở đầu file, để kb_context.mjs và sync_objects.mjs chạy được khi chưa cài.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// Biến đã đặt trong shell được giữ nguyên, .env chỉ bổ sung phần còn thiếu.
try {
  process.loadEnvFile(path.join(ROOT, '.env'));
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}

export const env = key => process.env[key];

/** Môi trường đang chạy. Mặc định lấy từ .env; prod-run.mjs gọi configure() theo tests/prod/env.<môi trường>.json. */
export const cfg = {
  env: 'staging',
  baseUrl: env('QA_BASE_URL') || '',
  api: env('QA_API_BASE') || '',
};
export function configure(c = {}) {
  return Object.assign(cfg, c);
}

/** Vị trí knowledge của product đang làm: repo = $QA_KNOWLEDGE_DIR, dir = <repo>/products/$QA_PRODUCT. */
export function knowledge() {
  const product = env('QA_PRODUCT');
  if (!product) {
    console.error('Thiếu QA_PRODUCT — điền vào .env (đúng tên thư mục trong qa-knowledge/products/)');
    process.exit(2);
  }
  const repo = path.resolve(ROOT, env('QA_KNOWLEDGE_DIR') || '../qa-knowledge');
  return { product, repo, dir: path.join(repo, 'products', product) };
}

const TEST_DATA = path.join(ROOT, 'test-data');

/** Đường dẫn file test. Chỉ chấp nhận file có sẵn trong test-data/. */
export function testFile(rel) {
  const p = path.resolve(TEST_DATA, rel);
  if (!p.startsWith(TEST_DATA + path.sep) || !fs.existsSync(p)) throw new Error(`File test phải có sẵn trong test-data/: ${rel}`);
  return p;
}

/** Chờ fn() trả giá trị truthy; thay cho waitForTimeout / sleep. */
export async function until(fn, { timeout = 30_000, interval = 500, message = 'điều kiện' } = {}) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeout) {
    try {
      last = await fn();
      if (last) return last;
    } catch (e) {
      last = e;
    }
    await new Promise(r => setTimeout(r, interval));
  }
  throw new Error(`Hết ${timeout}ms chờ ${message}${last instanceof Error ? `: ${last.message}` : ''}`);
}

// ---------- Browser + ghi kết quả ----------

/** Mở Chromium. Playwright chỉ được nạp ở đây. */
export async function openBrowser({ headed = false } = {}) {
  const { chromium } = await import('@playwright/test');
  return chromium.launch({ headless: !headed });
}

/** URL thuộc product đang test: cùng host với cfg.baseUrl hoặc cfg.api. Chưa khai báo host nào thì tính mọi URL. */
export function isProductUrl(url) {
  const hosts = [cfg.baseUrl, cfg.api].filter(Boolean).map(u => new URL(u).host);
  if (!hosts.length) return true;
  try {
    return hosts.includes(new URL(url).host);
  } catch {
    return false;
  }
}

/** Tự ghi bất thường của trang: console error, response của product >= 400, request của product lỗi mạng. Trả mảng sống. */
export function watchAnomalies(page) {
  const out = [];
  page.on('console', m => m.type() === 'error' && out.push({ type: 'console', text: m.text().slice(0, 300) }));
  page.on('response', r => isProductUrl(r.url()) && r.status() >= 400 && out.push({ type: 'http', status: r.status(), url: r.url().split('?')[0] }));
  // ERR_ABORTED = request bị huỷ do chuyển trang hoặc đóng context, không tính là bất thường
  page.on('requestfailed', r => isProductUrl(r.url()) && r.failure()?.errorText !== 'net::ERR_ABORTED' && out.push({ type: 'failed', url: r.url().split('?')[0], error: r.failure()?.errorText }));
  return out;
}

/** Bộ ghi của một case: check, note, shot, evidencePath, và saveFailure (ảnh cuối + trace khi case không pass). */
export function recorder(page, dir, slug) {
  const checks = [], notes = [], evidence = [];
  const rel = p => path.relative(ROOT, p);
  return {
    checks, notes, evidence,
    check(name, ok, detail) {
      checks.push({ name, ok: !!ok, ...(detail === undefined ? {} : { detail }) });
      return !!ok;
    },
    note: (...x) => notes.push(x.map(v => (typeof v === 'string' ? v : JSON.stringify(v))).join(' ')),
    async shot(name, target = page) {
      const p = path.join(dir, `${slug}-${name}.png`);
      await target.screenshot({ path: p, ...(target === page ? { fullPage: false } : {}) });
      evidence.push(rel(p));
      return p;
    },
    evidencePath: name => path.join(dir, `${slug}-${name}`),
    async saveFailure(context) {
      const shot = path.join(dir, `${slug}-last.png`);
      await page.screenshot({ path: shot }).then(() => evidence.push(rel(shot))).catch(() => {});
      const trace = path.join(dir, `${slug}-trace.zip`);
      await context.tracing.stop({ path: trace });
      evidence.push(rel(trace));
    },
  };
}

// ---------- API ----------

export const api = {
  async json(url, init) {
    const res = await fetch(url, { headers: { Accept: 'application/json' }, ...init });
    return { status: res.status, body: await res.json().catch(() => null) };
  },
};

// ---------- Mạng ----------

export const net = {
  /** Ghi mọi request khớp pattern (status, thời gian, body request rút gọn). Không truyền pattern thì lấy request của product. Trả mảng sống. */
  capture(page, pattern) {
    const match = url => (pattern ? pattern.test(url) : isProductUrl(url));
    const out = [];
    page.on('requestfinished', async req => {
      if (!match(req.url())) return;
      const res = await req.response().catch(() => null);
      const t = req.timing();
      out.push({ method: req.method(), url: req.url().split('?')[0], status: res?.status() ?? null, ms: Math.round(t.responseEnd), body: req.postData()?.slice(0, 500) || null });
    });
    page.on('requestfailed', req => {
      if (match(req.url())) out.push({ method: req.method(), url: req.url().split('?')[0], status: null, failure: req.failure()?.errorText });
    });
    return out;
  },

  /** Giả lập mạng chậm qua CDP. preset: slow3g | fast3g | offline | {latency, down, up} (bytes/s). Trả hàm gỡ. */
  async throttle(page, preset = 'slow3g') {
    const P = { slow3g: { latency: 400, down: 50_000, up: 50_000 }, fast3g: { latency: 150, down: 200_000, up: 94_000 }, offline: { offline: true, latency: 0, down: -1, up: -1 } };
    const c = typeof preset === 'string' ? P[preset] : preset;
    const s = await page.context().newCDPSession(page);
    await s.send('Network.enable');
    await s.send('Network.emulateNetworkConditions', { offline: !!c.offline, latency: c.latency, downloadThroughput: c.down, uploadThroughput: c.up });
    return async () => s.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  },

  /** Trả lỗi giả cho request khớp pattern: {status, body} hoặc {abort: 'failed'}. Trả hàm gỡ. */
  async fail(page, pattern, { status = 500, body = '{"message":"QA injected"}', abort } = {}) {
    const handler = route => (abort ? route.abort(abort) : route.fulfill({ status, contentType: 'application/json', body }));
    await page.route(pattern, handler);
    return () => page.unroute(pattern, handler);
  },
};
