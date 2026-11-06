# qa-template

Bộ quy trình QA chạy bằng Claude Code, dùng được cho mọi product. Repo này chỉ chứa quy trình. Kiến thức của product nằm ở `qa-knowledge`.

## Quy trình

```
qa-issue-run <KEY>
  └─ qa-requirement-analysis   phân tích issue, lấy context từ qa-knowledge
       └─ Gate 1               gửi câu hỏi blocking một lần (issue Ready tự qua)
            └─ gen-testcase    sinh test case bám scope, tạo lên Testlane
                 └─ create-test-data   dựng data, tạo Postman hoặc script API
                      └─ qa-execute-testcase   preflight, chạy case, ghi status về Testlane
                           └─ Gate 2   báo cáo cuối và ảnh cần người xem
                                └─ qa-prod-verify   sau deploy: verify production, gửi CCR, Done
```

Người chỉ review ở Gate 1 và Gate 2. Gặp lỗi thì ghi lại và chạy tiếp các case không liên quan.

## Cài đặt

**Cần có:** Claude Code, Node 22 trở lên, Python 3, và tài khoản Jira, Testlane, Postman.

1. Tạo repo từ template này, clone về. Clone `qa-knowledge` cạnh nó:
   ```
   git clone https://github.com/qikify-QA/qa-knowledge.git ../qa-knowledge
   ```
2. Cài thư viện:
   ```
   npm install
   npx playwright install chromium
   ```
3. Tạo `.env`:
   ```
   cp .env.example .env
   ```
   Điền `QA_PRODUCT` đúng tên thư mục trong `qa-knowledge/products/`, `TESTLANE_PROJECT_ID`, `POSTMAN_WORKSPACE_ID` và các biến môi trường. Nếu có `<knowledge>/_env.example` thì chép thêm biến của product từ file đó.
4. Tạo `.mcp.json`:
   ```
   cp .mcp.example.json .mcp.json
   ```
   Thay `<URL MCP Testlane của team>` và `<POSTMAN_API_KEY>`. Thêm server MCP của product nếu có. File này chứa khoá, không commit.
5. Nếu máy đã có skill cùng tên trong `~/.claude/skills/`, đổi tên hoặc gỡ bản đó. Bản ở đó sẽ được dùng thay cho bản trong repo.
6. Mở Claude Code ở thư mục repo và gõ `/mcp` để đăng nhập các server.

`<knowledge>` trong tài liệu là `$QA_KNOWLEDGE_DIR/products/$QA_PRODUCT/`.

## Cách dùng

| Muốn làm | Nói với Claude |
|---|---|
| Chạy trọn một issue | `qa-issue-run PROJ-123` |
| Chỉ phân tích | `phân tích PROJ-123` |
| Sinh test case | `tạo test case cho PROJ-123` |
| Dựng test data | `tạo test data cho task PROJ-123` |
| Chạy test case | `execute task PROJ-123` |
| Verify sau deploy | `đã deploy PROJ-123, verify production` |
| Cập nhật knowledge | `tạo CCR từ PROJ-123` |

## Product chưa có guide hoặc flow

Quy trình vẫn chạy, dùng Jira, KB và khám phá thực tế. `runs/<KEY>/context.md` sẽ có dòng cảnh báo.

Nên bổ sung sớm, vì đây là thứ làm kết quả chính xác hơn. Những gì tìm ra khi chạy được ghi vào CCR khối C để cập nhật guide và flow.

Helper riêng của product đặt ở `scripts/qa/product/<product>.mjs`, xem [scripts/qa/README.md](scripts/qa/README.md).

## Thành phần

| Đường dẫn | Nội dung |
|---|---|
| `.claude/skills/` | `qa-issue-run`, `qa-requirement-analysis`, `gen-testcase`, `create-test-data`, `create-ccr` |
| `.claude/agents/` | `qa-execute-testcase`, `qa-test-data`, `qa-prod-verify` |
| `.claude/testlane-status-sync.md` | Status task Testlane theo từng mốc |
| `scripts/qa_runctl.py` | Giữ quyền tài nguyên dùng chung, nhật ký thay đổi tạm |
| `scripts/issue_timing.py` | Mốc thời gian từng bước |
| `scripts/qa/` | Sinh context, đồng bộ object, runner case, verify production |
| `tests/api/` | Script API theo task, khi không tạo được collection trên Postman |
| `tests/e2e/` | Test Playwright của team |
| `tests/prod/` | Spec và cấu hình verify production |

Không commit: `.env`, `.mcp.json`, `runs/`, `evidence/`, `test-data/`, `.claude/test-data-catalog.md`.

## Nguyên tắc

- Kiến thức product chỉ lấy từ `qa-knowledge`, không tạo rule local.
- Quy tắc mới phát hiện được ghi trong analysis, rồi vào knowledge qua CCR.
- Quy tắc làm việc nằm ngay trong skill và agent. Đổi quy tắc thì sửa đúng file đó.
