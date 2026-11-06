# scripts/qa — chạy case bằng script

Mục đích: giảm thời gian execute. Agent viết một case file ngắn dùng helper có sẵn, rồi chạy nhiều case trong **một** lệnh. Không phải gọi tool từng bước, và không chờ cố định.

Cần Node 20.12 trở lên. Script tự đọc `.env` ở gốc repo. Biến đã đặt trong shell được ưu tiên hơn `.env`.

| File | Việc |
|---|---|
| `lib.mjs` | Helper chung: đọc env, mở browser, `check`, `shot`, trace, `until`, `testFile`, `api.json`, mạng (`net`) |
| `run.mjs` | Runner: mỗi case một browser context, chạy song song, ghi kết quả + bất thường + trace |
| `prod-run.mjs` | Chọn và chạy spec trong `tests/prod/` theo task, xem `tests/prod/README.md` |
| `poll.mjs` | Chờ tới khi điều kiện đúng (lệnh shell hoặc URL), thay cho `sleep N` |
| `sync_objects.mjs` | Bộ key object/feature (knowledge + local), chọn key theo phạm vi, xem `tests/prod/README.md` |
| `kb_context.mjs` | Lấy knowledge của các key một issue → `runs/<KEY>/context.md` (oracle / cần xác nhận / quan sát / gap). Lần đầu `git pull` rồi ghim full SHA vào `context.json`, các lần sau đọc đúng SHA đó; `--refresh` lấy bản mới và liệt kê item đổi. Test: `npm run test:scripts` |
| `product/<product>.mjs` | Helper riêng của product, QA tự viết khi cần (xem mục dưới) |
| `examples/` | Case mẫu mở trang `data:`, không cần mạng. Chạy lại sau khi sửa `lib.mjs` |

## Chạy

```bash
node scripts/qa/run.mjs --key <KEY> runs/<KEY>/cases/                 # cả thư mục, theo thứ tự tên file
node scripts/qa/run.mjs --key <KEY> --parallel 3 a.mjs b.mjs          # song song
node scripts/qa/run.mjs --key <KEY> --headed case.mjs                 # xem browser
node scripts/qa/run.mjs --key QA-EXAMPLES scripts/qa/examples/        # kiểm thư viện còn chạy
```

- Session: nếu có `playwright/.auth/mcp-isolated.json` thì runner dùng file này, không có thì chạy không session. Tạo file bằng `npx playwright codegen --save-storage=playwright/.auth/mcp-isolated.json <URL>`, login xong đóng cửa sổ. Hết hạn thì tạo lại. File khác: `--state <file>`. Bỏ session: `--state none`.
- Kết quả từng case in ra JSON, cuối cùng in bảng tóm tắt. Đồng thời nối vào `runs/<KEY>/script-results.jsonl`.
- Ảnh và trace lưu ở `evidence/<KEY>/<id>-*.png|zip`. Case không pass luôn có ảnh cuối và trace (`npx playwright show-trace <zip>`).
- Exit 1 khi có case `error`.

## Case file

```js
export const meta = { id: 'TC-12', title: 'Lưu hồ sơ giữ đúng tên' };
export default async ({ page, cfg, net, until, check, note, shot }) => {
  await page.goto(`${cfg.baseUrl}/profile`);
  await page.getByLabel('Tên').fill('Max');
  const save = page.waitForResponse(r => r.url().includes('/profile') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Lưu' }).click();
  check('lưu thành công', (await save).ok());
  await shot('saved');
};
```

Kết quả: `pass` khi mọi `check` đúng, `fail` khi có `check` sai, `error` khi văng lỗi hoặc case không có `check` nào. Runner **không** ghi Testlane. Agent đọc kết quả, tự kết luận theo quy tắc của `qa-execute-testcase`, rồi mới update.

Tự ghi vào `anomalies`: console error, response của product ≥ 400, request của product bị lỗi mạng. Request của product là request cùng host với `QA_BASE_URL` hoặc `QA_API_BASE`. Hai biến đều trống thì tính mọi request. `ERR_ABORTED` (do chuyển trang hoặc đóng context) bị bỏ qua.

## Helper

| Helper | Làm gì | Ghi chú |
|---|---|---|
| `check(name, ok, detail)` | Ghi một điều kiện pass/fail | Case phải có ít nhất một `check` |
| `note(...)` | Ghi chú vào kết quả | |
| `shot(name, target)` | Chụp trang hoặc locator vào `evidence/<KEY>/` | Trả đường dẫn ảnh |
| `evidencePath(name)` | Đường dẫn trong `evidence/<KEY>/` cho file tự lưu | |
| `cfg` | `env`, `baseUrl`, `api` của môi trường đang chạy | Mặc định từ `.env`; `prod-run.mjs` lấy từ `tests/prod/env.<môi trường>.json` |
| `env(key)` | Đọc biến môi trường hoặc `.env` | |
| `api.json(url, init)` | Gọi API, trả `{status, body}` | |
| `net.capture(page, /pattern/)` | Mảng request khớp pattern: method, url, status, ms, body | Không truyền pattern thì lấy request của product |
| `net.throttle(page, 'slow3g' \| 'fast3g' \| 'offline' \| {latency, down, up})` | Giả lập mạng qua CDP, trả hàm gỡ | |
| `net.fail(page, /pattern/, {status, body, abort})` | Trả lỗi giả cho đúng request khớp, trả hàm gỡ | |
| `until(fn, {timeout, interval, message})` | Chờ `fn()` truthy | Thay cho `waitForTimeout` |
| `testFile(rel)` | Đường dẫn file trong `test-data/`, báo lỗi nếu nằm ngoài | |

Throttle và route giả lỗi chỉ sống trong context của case, mất khi case kết thúc. Vì vậy không ghi `qa_runctl.py change` cho loại này.

## Helper riêng của product

`lib.mjs` chỉ giữ phần dùng chung cho mọi product. Thao tác gắn với giao diện hoặc API của một product đặt ở `scripts/qa/product/<product>.mjs`, tên file trùng `QA_PRODUCT`. Tách helper khi một thao tác lặp lại ở nhiều case.

Cách viết:

- Import từ `../lib.mjs`, không chép lại `until`, `net`, `env`.
- Mỗi hàm nhận `page` làm tham số đầu. Selector và bước chờ của product nằm trong hàm, case chỉ gọi tên thao tác.
- URL lấy từ `cfg`, không viết cứng host, ID hay tài khoản. Nhờ vậy cùng một helper chạy được ở staging và production.
- Bí mật đọc bằng `env('TÊN_BIẾN')`. Thêm tên biến vào `.env`.
- Chờ đúng điều kiện, không dùng thời gian cố định. Nếu product bắt buộc phải chờ, ghi lý do ngay tại dòng đó.
- Trả dữ liệu để case gọi `check`. Helper không tự kết luận pass/fail.
- Cách dùng selector và luồng lấy từ `<knowledge>/_flows/` nếu có.

```js
// scripts/qa/product/<product>.mjs
import { cfg, env } from '../lib.mjs';

export const app = {
  async login(page) {
    await page.goto(`${cfg.baseUrl}/login`);
    await page.getByLabel('Email').fill(env('QA_USER'));
    await page.getByLabel('Mật khẩu').fill(env('QA_PASSWORD'));
    await Promise.all([page.waitForURL(u => !u.pathname.includes('/login')), page.getByRole('button', { name: 'Đăng nhập' }).click()]);
  },
};
```

```js
// runs/<KEY>/cases/01-login.mjs hoặc tests/prod/<object>/x.mjs
import { app } from '../../../scripts/qa/product/<product>.mjs';

export default async ({ page, check }) => {
  await app.login(page);
  check('vào được trang chính', !page.url().includes('/login'), page.url());
};
```

## poll.mjs

```bash
node scripts/qa/poll.mjs --timeout 300 --interval 5 --match '"status":1' --url "$QA_API_BASE/<đường dẫn>"
node scripts/qa/poll.mjs --timeout 120 -- test -f evidence/<KEY>/design.png
```

Thoát ngay khi điều kiện đạt (exit 0), in số giây đã chờ. Hết giờ thì exit 1. Trạng thái chỉ đọc được qua MCP thì agent gọi MCP; không dùng `sleep` cố định giữa các lần gọi.

## Lưu ý

- Chạy `--parallel` trên tài khoản dùng chung có thể dính rate limit của product. Xem giới hạn trong `<knowledge>/_product-guide.md` nếu có.
- Luồng chưa có helper thì dùng MCP, hoặc bổ sung helper khi một luồng lặp lại ở nhiều issue.
- Sửa `lib.mjs` xong thì chạy lại `examples/` (`--key QA-EXAMPLES`).
