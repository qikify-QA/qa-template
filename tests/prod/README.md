# tests/prod — kiểm tra production sau deploy

Mỗi task, sau khi đạt `ready-to-deploy`, có các happy case được viết thành spec. Spec chạy trên staging trước, và sau khi Dev báo deploy thì chạy lại trên production, kèm regression các phần liên quan. Production pass hết thì task chuyển sang `Done`.

Agent phụ trách: `qa-prod-verify` (`.claude/agents/qa-prod-verify.md`). Runner: `scripts/qa/prod-run.mjs`.

## Chuẩn bị

Các file này do QA tự tạo và không commit:

```bash
cp tests/prod/manifest.example.json tests/prod/manifest.json
cp tests/prod/env.staging.example.json tests/prod/env.staging.json
cp tests/prod/env.production.example.json tests/prod/env.production.json
node scripts/qa/sync_objects.mjs
```

- `manifest.json`: object, feature, `affects`, fixture, task. Xoá `sample-object` và `PROJ-123` sau khi có key thật.
- `env.<môi trường>.json`: `env`, `baseUrl`, `api`, `state`. Runner từ chối chạy khi còn giá trị `TODO`. Spec đọc các giá trị này qua `cfg`.
- `state`: đường dẫn storageState tính từ gốc repo, hoặc `none` khi không cần session. Bỏ trường này thì runner dùng `playwright/.auth/mcp-isolated.json`. Cách tạo session ở `scripts/qa/README.md`.
- Giá trị riêng của product thì thêm trường mới vào `env.<môi trường>.json`, spec đọc bằng `cfg.<tên trường>`.

## Chia theo object — đồng bộ với repo knowledge

Bộ key = `object_key` / `feature_key` của repo knowledge, bản đã publish (`<knowledge>/_registry.json` + `<knowledge>/<object>/features/<feature>/`), **cộng key local** cho phần knowledge chưa có. Cùng một bộ key được dùng ở mọi chỗ:

| Chỗ dùng | Dạng |
|---|---|
| Bản phân tích (`analysis.md`) | Mỗi Impacted Area: `IA2 — billing/invoice-export: …` |
| Tag task Testlane | `["PROJ-123", "billing", "billing/invoice-export"]` |
| Thư mục spec | `tests/prod/<object_key>/` |
| `meta` của spec | `object`, `feature` |
| `manifest.tasks.<KEY>` | `objects`, `features` (= tag task) |

Đồng bộ manifest với knowledge (đọc repo knowledge, **không sửa bên đó**):

```bash
node scripts/qa/sync_objects.mjs           # thêm object/feature mới, đánh dấu cái đã bị bỏ, kiểm spec trỏ đúng key
node scripts/qa/sync_objects.mjs --check   # chỉ kiểm (preflight)
```

Vị trí knowledge lấy từ `.env`: `$QA_KNOWLEDGE_DIR/products/$QA_PRODUCT`, viết tắt `<knowledge>/`. Product chưa có `_registry.json` thì lệnh cảnh báo và chạy tiếp với key local. Knowledge cho analysis: `node scripts/qa/kb_context.mjs <KEY> <object/feature> ...` → `runs/<KEY>/context.md`.

**Chọn key theo phạm vi, không theo tên.** Knowledge có thể thiếu key cho chức năng mới. Key có sẵn chỉ dùng khi phạm vi của nó **bao trọn** thay đổi của ticket. Không xác định được thì **tạo key mới chính xác**, không gán ép vào key gần đúng, vì gán sai sẽ làm regression chọn sai spec.

```bash
node scripts/qa/sync_objects.mjs --list                          # mọi key (knowledge + local)
node scripts/qa/sync_objects.mjs --show billing                  # các feature của object + mục tiêu từng feature
node scripts/qa/sync_objects.mjs --show billing/invoice-export   # mục tiêu, capability, entry point
node scripts/qa/sync_objects.mjs --add-feature billing/invoice-export \
  --name "Xuất hoá đơn ra file" \
  --scope "Thuộc: chọn kỳ, tải file. Không thuộc: cách tính tiền" \
  --evidence <KEY>
node scripts/qa/sync_objects.mjs --add-object <object> --name "..." --scope "..." --evidence <KEY> --affects billing,report
```

| Trường hợp | Làm gì |
|---|---|
| Có feature bao trọn thay đổi | Dùng key đó |
| Đúng entity (object) nhưng chưa có chức năng đó | Tạo feature mới dưới object đó |
| Entity khác hẳn các object đang có | Tạo object mới, khai báo `affects` |
| Thay đổi trải trên nhiều feature | Gắn nhiều key, không gộp thành một key chung chung |

Đặt tên key mới:
- Đặt theo **chức năng**, kebab-case, cùng kiểu với knowledge (`invoice-export`, `login-by-email`).
- Không chứa mã ticket, `fix`, `bug`, `misc`, `other`, `general` hay version. Lệnh từ chối các tên này.
- Bắt buộc có `--name`, `--scope` (Thuộc / Không thuộc) và `--evidence`, để lần sau map ticket khác vào đúng hay sai.
- Đọc cảnh báo key và alias gần giống mà lệnh in ra.

Key local được đánh dấu `source: local`. Khi knowledge có đúng key đó, lần sync sau tự chuyển sang `knowledge`. Feature bị bỏ khỏi knowledge thì chuyển thành local, không mất.

Ngoài key, `manifest.json` giữ 2 thứ riêng của repo test:
- **`affects`**: đổi object này thì object nào cần regression. Object mới từ knowledge có `affects` rỗng. QA tự khai báo theo quan hệ phụ thuộc trong `<knowledge>/_product-guide.md`, ví dụ:

| Object | affects |
|---|---|
| `billing` | `report` |
| `report` | — |

- **`fixtures.<staging|production>.<tên>`**: các bộ data có tên. Spec chọn bằng `meta.fixture`; hai môi trường dùng cùng tên.

```js
export const meta = {
  id: 'BILLING-invoice-export', title: 'Xuất hoá đơn đúng kỳ đã chọn',
  object: 'billing', feature: 'invoice-export',         // key của knowledge, = tên thư mục + tag task
  fixture: 'paid-invoice',                              // manifest.objects.billing.fixtures.<env>['paid-invoice']
  tasks: ['PROJ-123'], cases: ['TC-PROJ-1234'], smoke: false,
};
export default async ({ page, cfg, fx, check }) => { await page.goto(`${cfg.baseUrl}${fx.path}`); ... };
```

- Spec không viết cứng đường dẫn, ID hay host, mà lấy tất cả từ `fx` và `cfg`.
- Task sau đụng lại cùng feature thì sửa spec cũ (thêm key vào `meta.tasks`), không chép thành spec mới.

## Biết case nào cần regression

`prod-run.mjs` đọc object/feature của task (từ `manifest.tasks`, tức tag task) và chọn theo thứ tự hẹp dần ra rộng:

1. **Spec của task**: `meta.tasks` có key của task.
2. **Cùng feature**: các spec khác của feature mà task đụng.
3. **Cùng object**: các spec thuộc feature khác của cùng object.
4. **Ảnh hưởng**: object khác, lan theo `affects` tới hết chuỗi, vd `ảnh hưởng billing → report`.
5. **Smoke** (`meta.smoke: true`): luồng chính, luôn chạy.

Dùng `--plan` để xem trước, mỗi spec có kèm lý do. Nếu một lỗi production lọt qua mà regression không bắt được, kiểm xem `affects` có thiếu cạnh nào không.

## Lệnh

```bash
node scripts/qa/prod-run.mjs --env staging --tasks <KEY> --plan                 # xem sẽ chạy gì và vì sao
node scripts/qa/prod-run.mjs --env staging --tasks <KEY>                        # bắt buộc pass trước khi deploy
node scripts/qa/prod-run.mjs --env production --tasks <KEY>,<KEY> --parallel 3
node scripts/qa/prod-run.mjs --env production --smoke | --objects <object> | --all
```

- Spec thiếu fixture của môi trường thì không chạy và bị báo `no-fixture`. Agent dựng data rồi chạy lại.
- Kết quả lưu ở `runs/<PROD|STG>-<ngày>/script-results.jsonl`, ảnh và trace ở `evidence/` cùng tên. Cuối bảng có kết luận theo từng task: `PASS → đủ điều kiện Done` hoặc liệt kê spec chưa đạt.
