---
name: qa-issue-run
description: "Chạy trọn quy trình QA của product đang làm cho một hoặc nhiều issue Jira (vd `qa-issue-run PROJ-123 PROJ-124`): phân tích → sinh test case → dựng test data → preflight → execute → báo cáo, lưu trạng thái ở runs/<KEY>/ để chạy tiếp được khi bị ngắt. Chỉ dừng ở 2 điểm review: Gate 1 (câu hỏi blocking + assumption, gửi một lần; issue Ready tự qua) và Gate 2 (báo cáo cuối + ảnh render cần nhìn). Dùng khi người dùng nói \"chạy issue này\", \"test trọn PROJ-123\", \"qa-issue-run\", \"làm hết từ phân tích tới execute\", hoặc đưa nhiều key cùng lúc."
---

# qa-issue-run — điều phối trọn một/nhiều issue

Mục tiêu: người dùng chỉ phải xem **2 lần** — Gate 1 (câu hỏi) và Gate 2 (kết quả). Mọi thứ khác skill tự quyết theo các nguồn đã có, và chỉ báo lại những gì thật sự không tự giải quyết được.

Người dùng giao lẻ từng bước thì vẫn gọi skill/agent tương ứng, nhưng ghi vào đúng `runs/<KEY>/`.

## Nguồn dùng chung (đọc, không chép lại)

| File | Dùng để |
|---|---|
| `<knowledge>/_product-guide.md` | Bản đồ, môi trường, giới hạn test; gắn `env-blocked` sớm |
| `node scripts/qa/kb_context.mjs` → `runs/<KEY>/context.md` | Knowledge của feature (oracle = `CONFIRMED_EXPECTED` có nguồn hợp lệ, không conflict, không known defect), ghim một snapshot cho cả run |
| `.claude/testlane-status-sync.md` mục 0 | Project Testlane `TESTLANE_PROJECT_ID`; Testlane chỉ cho task/case, không đọc context ở đó |
| `.claude/test-data-catalog.md` | Data đặc thù có sẵn |
| `<knowledge>/_flows/troubleshooting.md` | Cách gỡ block đã gặp |
| `<knowledge>/_flows/` | Cách thao tác, đọc `README.md` rồi đúng file theo chủ đề |
| `scripts/qa_runctl.py` (gọi tắt `R`) | Nhật ký lượt chạy, giữ quyền tài nguyên dùng chung |
| Skill `qa-requirement-analysis`, `gen-testcase`, `create-test-data`; agent `qa-test-data`, `qa-execute-testcase`, `qa-prod-verify` | Từng bước — skill này chỉ điều phối |

`<knowledge>/` là `$QA_KNOWLEDGE_DIR/products/$QA_PRODUCT/`. Product chưa có guide/flow: ghi nhận thiếu, dùng Jira + KB + khám phá thực tế, đề xuất bổ sung qua CCR khối C, không dừng quy trình.

## State: `runs/<KEY>/`

| File | Ai ghi | Nội dung |
|---|---|---|
| `state.json` | skill này | `{"key", "title", "phase", "gate1": "auto-pass|waiting|answered", "server", "runId", "testlane": {"taskId", "taskStatus", "synced"}, "updated"}` |
| `analysis.md` | qa-requirement-analysis | Bản Requirement Analysis đủ các mục |
| `decisions.md` | qa-requirement-analysis, skill này | Bảng `Q`/`A`: câu hỏi, đề xuất, **câu trả lời** (ai, ngày), case bị ảnh hưởng, đã áp chưa |
| `testcases.json` | gen-testcase | Task Testlane + mapping case, nhãn, mã `A`/`Q` |
| `data.json` | qa-test-data, create-test-data | ID data đã dựng, case phục vụ, phần blocked |
| `ledger.md` | qa-test-data | Ledger data của issue |
| `context.md` | `node scripts/qa/kb_context.mjs` (gọi trong qa-requirement-analysis) | Knowledge của các key IA: oracle / cần xác nhận / quan sát / gap |
| `context.json` | `kb_context.mjs` | Full SHA của snapshot, key, kết quả pull |
| `ccr.md` | qa-prod-verify (P7) | CCR của task, đính vào task Testlane |
| `results.md` | qa-execute-testcase | Báo cáo execute (= Gate 2 của issue) |
| `timeline.jsonl` | `scripts/issue_timing.py` | Mốc thời gian từng bước làm / chờ (chỉ ghi nối thêm) |

`phase` lần lượt: `init → analyzed → cases-created → gate1 → data-ready → preflight → executing → done → prod-ready → prod-verified → ccr-attached → (done) | prod-failed | prod-not-run`.

**Chạy tiếp khi bị ngắt:** đọc `state.json`, **đối chiếu Testlane trước** (`.claude/testlane-status-sync.md` mục 3), bắt đầu lại từ phase đang dở; file của phase đã xong thì dùng lại, không làm lại. Phase `executing` bị ngắt → lượt mới gọi `R start` sẽ hiện `pending` của lượt cũ; agent execute xử lý theo quy tắc khôi phục.

## Đồng bộ status Testlane (bắt buộc)

Theo `.claude/testlane-status-sync.md`: status task đổi theo mốc (P0/P2 `in-progress` → cuối lượt `waiting-for-dev` hoặc `ready-to-deploy`; không bao giờ tự đặt `done`), status case ghi ngay khi có kết quả, đối chiếu cuối lượt và khi resume, không ghi đè thay đổi tay của người dùng.

## Ghi mốc thời gian (bắt buộc)

Mỗi bước ghi `start` ngay trước khi bắt đầu và `end` ngay khi xong, bằng `T` = `python3 scripts/issue_timing.py`:

| Mốc | Lệnh start | Lệnh end |
|---|---|---|
| P1 Phân tích | `T start <KEY> analysis` | `T end <KEY> analysis` |
| P2 Sinh test case | `T start <KEY> testcase` | `T end <KEY> testcase` |
| Gate 1 chờ PO/Dev trả lời | `T wait-start <KEY> po-dev-reply --note "Q1,Q3"` (lúc gửi Gate 1) | `T wait-end <KEY> po-dev-reply` (lúc người dùng dán câu trả lời; nếu người dùng nói giờ Dev trả lời thật thì thêm `--at`) |
| P3 Dựng data | `T start <KEY> data` | `T end <KEY> data` |
| P4 Preflight | `T start <KEY> preflight` | `T end <KEY> preflight` |
| Chờ người dùng làm tay (login/2FA, đổi config) | `T wait-start <KEY> user-action --note "<việc>"` | `T wait-end <KEY> user-action` |
| Chờ Dev deploy bản fix | `T wait-start <KEY> deploy` | `T wait-end <KEY> deploy` |
| Chờ job nền staging (import, render, sync) | `T wait-start <KEY> staging-job --note "<job + id>"` (lúc job được tạo) | `T wait-end <KEY> staging-job` (lúc job xong, hoặc `--note "kẹt, báo Dev"` khi bỏ chờ) |
| P5 Execute (agent tự ghi) | `T start <KEY> execute` | `T end <KEY> execute` |
| Chờ người dùng review render | `T wait-start <KEY> render-review` (lúc gửi Gate 2) | `T wait-end <KEY> render-review` (lúc người dùng duyệt xong) |
| Gate 2 báo cáo | `T start <KEY> report` | `T end <KEY> report` (= issue xong) |

- Làm lại một bước (vd execute bổ sung sau khi PO trả lời khác đề xuất) → thêm một cặp start/end mới, `--note` ghi lý do.
- Chờ và làm có thể chồng nhau (Gate 1 không chặn case độc lập) — cứ ghi đúng thực tế.
- Bị ngắt giữa bước: khi resume, nếu bước đó còn mở thì `end` với `--note "bị ngắt"` rồi `start` lại.
- Gate 2 kèm `T show <KEY>`. Xem trung bình nhiều issue: `T report` (chỉ tính issue đã xong; `--all` để tính cả đang chạy).

## Quy trình

### P0 — Khởi tạo
- Mỗi key: tạo `runs/<KEY>/` nếu chưa có, đọc title thật từ Jira (`mcp__atlassian__getJiraIssue`, kèm `comment`). Đã có `state.json` → resume.
- Task Testlane của key đã có sẵn và đang `todo` → đặt `in-progress` (theo file đồng bộ).
- Nhiều key: xử lý P1–P2 **lần lượt từng issue** (rẻ, cần ngữ cảnh), gom Gate 1 chung, rồi P3–P5 song song theo mục "Song song".

### P1 — Phân tích
Gọi skill `qa-requirement-analysis` (tool `Skill`, args: `<KEY> — gọi từ qa-issue-run`). Skill đó áp **thang quyết định** (ticket/comment → knowledge `CONFIRMED_EXPECTED` → probe staging/production read-only → tính năng tương tự), ghi `analysis.md` + `decisions.md`, không hỏi giữa chừng. `phase = analyzed`.

### P2 — Sinh test case
Gọi skill `gen-testcase` (args: `<KEY> — gọi từ qa-issue-run, input runs/<KEY>/analysis.md`). Mỗi case truy về một mục scope (`BR`/`IA`/Risk) của bản phân tích, không case ngoài scope, không trần số lượng; nhãn `expected-unconfirmed` / `env-blocked`; mã `A`/`Q`. Ghi `testcases.json`. `phase = cases-created`.

### Gate 1 — một lần duy nhất
- **Tự qua** khi `Readiness = Ready` và không có câu blocking: ghi `decisions.md` "Gate 1: auto-pass (Ready)", `gate1 = auto-pass`, đi tiếp không báo.
- **Còn câu blocking** → gửi **một** tin **cho người dùng trong chat**, gom tất cả issue trong lượt. Skill **không tự gửi cho PO/Dev** (không comment Jira, không nhắn ở đâu khác): người dùng tự quyết gửi câu nào, gửi qua đâu, rồi dán câu trả lời lại.
  ```
  ## Gate 1 — cần trả lời (đúng/sai là đủ)
  ### <KEY> <title> — Readiness: Partially Ready · Testlane task <id>, N case (bảng Scope ref → case ở analysis/testcases)
  | Mã | Câu hỏi | Đề xuất | Case chờ |
  ### Assumption đang dùng (không cần trả lời nếu đồng ý)
  | Mã | Giả định | Case dựa vào |
  ```
  `gate1 = waiting`. Mọi case còn lại đều mang mã `Q` → task `waiting-for-dev`; còn case chạy được thì giữ `in-progress`. **Không đứng chờ:** case **không** mang mã `Q` nào đi tiếp P3–P5 bình thường; chỉ case mang mã `Q` chưa trả lời bị giữ lại.
- **Khi người dùng trả lời** (có thể vào bất kỳ lúc nào): ghi câu trả lời vào `decisions.md`; đáp án khớp đề xuất → bỏ giữ; khác → gọi `gen-testcase` sửa **đúng** các case mang mã đó (update/skipped/thêm lẻ), rồi dựng data + execute bổ sung chỉ cho các case đó. Người dùng phản đối một assumption → xử lý y như câu `Q` sai đề xuất.
- Không có câu trả lời tới lúc Gate 2 → các case đó để `not-run`, liệt kê ở Gate 2.

### P3 — Dựng data
Gọi skill `create-test-data` (args: `<KEY> — gọi từ qa-issue-run`). Không duyệt Data Plan lại (Gate 1 đã qua), trừ khi plan cần sửa tài nguyên dùng chung đang bị lượt khác giữ. Ghi `data.json` + `ledger.md`. `phase = data-ready`.

### P4 — Preflight (gom một lần cho mọi issue)
Gọi agent `qa-execute-testcase` ở **chế độ preflight** cho từng issue (prompt: "CHỈ chạy mục 0 Preflight + mục 2, không chạy case, trả danh sách việc cần người dùng"). Gom kết quả mọi issue → **một** tin cho người dùng nếu có việc cần làm (login/2FA, đổi config môi trường, xác nhận bản đã deploy). Issue nào không cần gì thì vào P5 ngay; issue còn chờ việc thì chỉ case phụ thuộc chờ.

### P5 — Execute
Gọi agent `qa-execute-testcase` cho mỗi issue, prompt ghi đủ:
- Key, task Testlane, đường dẫn `runs/<KEY>/` (decisions, testcases, data).
- **Server Playwright** và **run-id** (`<KEY>-run-NN`) — xem "Song song".
- Case đang bị giữ chờ câu `Q` → không chạy.
- Nhắc: evidence ở `evidence/<KEY>/`; không đính ảnh Testlane, không sửa notes task, không comment Jira; không tự tạo bug; không xoá test data; luôn khôi phục thay đổi tạm thời; chỉ dừng cả lượt khi môi trường sai.
- Report cuối phải có output của `R finish`.
Agent ghi `results.md`, đối chiếu status case với Testlane và đặt status task cuối lượt (file đồng bộ, mục 1–3). Câu hỏi đổi setup phát sinh giữa chừng → agent đưa lên đầu báo cáo; skill **chuyển ngay** cho người dùng (không đợi các issue khác xong). `phase = done`.

### P6 — Spec production (task vừa `ready-to-deploy`)
Task kết thúc execute ở `ready-to-deploy` (sau Gate 2 nếu có review render) → gọi agent `qa-prod-verify` chế độ **author** (prompt: key, `runs/<KEY>/`). Agent chọn happy case, viết spec theo object, dựng fixture, chạy pass trên staging. `phase = prod-ready`. Task `waiting-for-dev` thì chưa làm P6 — làm khi chạy lại và đạt `ready-to-deploy`.

### Sau deploy — verify production (người dùng gọi trong chat)
Người dùng báo "đã deploy PROJ-123, PROJ-124" → gọi `qa-prod-verify` chế độ **verify** với **cả danh sách** một lần (runner gộp spec, bỏ trùng, chạy song song). Pass hết → agent soạn CCR, đính vào task, submit (P7), rồi mới đặt `done`; chưa submit được thì task giữ `ready-to-deploy`. Còn fail → `waiting-for-dev`. Proposal để ở `Todo`, người dùng tự kéo sang `In Progress`. Task chưa có P6 → làm P6 trước (author) rồi verify. `phase = prod-verified` / `ccr-attached` / `prod-failed` / `prod-not-run` (chưa kết luận: thiếu fixture/session — task giữ `ready-to-deploy`).

### Gate 2 — báo cáo cuối
Đầu báo cáo mỗi issue có dòng `Testlane: N case khớp, M ghi bù, K giữ theo người dùng; task <id> → <status>`. Người dùng trả lời review render / quyết định case → cập nhật case đó rồi tính lại status task.
Một tin, gom mọi issue:
```
## Gate 2 — <KEY>, <KEY>
| Issue | passed | failed | blocked | skipped | not-run (chờ Q / chờ review render) |
### Review render (cần nhìn) — TC → evidence/<KEY>/render-review/<file>.png → điều cần nhìn
### Failed — mô tả quan sát + screenshot (chưa tạo bug; hỏi trước khi report_bug)
### expected-unconfirmed — hành vi thực tế đã ghi, chờ PO/Dev
### Câu Q còn mở + case đang chờ
### Môi trường: lỗi staging cần báo Dev · data giữ lại · thay đổi chưa khôi phục được (từ `R finish`)
### Bài học mới `chờ xác nhận` (nếu có, đề xuất qua CCR khối C)
```
Báo cáo đầy đủ từng issue ở `runs/<KEY>/results.md` — Gate 2 chỉ tóm tắt và dẫn link.

## Song song (nhiều issue)

- Tối đa **3 issue execute cùng lúc**, mỗi agent một server: `playwright-2`, `playwright-3` (context riêng), `playwright` (profile cố định, ưu tiên cho issue cần login tay/2FA). Hai agent chung một server là chung browser và tab, sẽ giẫm lên nhau. Ghi rõ server và run-id trong prompt mỗi agent.
- Server riêng chưa đủ: data phía server vẫn chung. Tài nguyên riêng (server, data lượt tự tạo) không cần lock. Tài nguyên dùng chung (setting tài khoản, cấu hình môi trường, data có sẵn, item tái sử dụng) bắt buộc giữ quyền bằng `R acquire`, không cần xếp lịch trước: chỉ một lượt giữ được, lượt kia chạy case khác rồi quay lại. Không cho 2 lượt sửa cùng một item.
- Lệnh `R`: `start` (in `pending` tồn đọng), `acquire` (write: một lượt; read: lượt chỉ đọc nhưng phụ thuộc setting; hai chế độ loại trừ nhau), `change` (ghi trước khi đổi), `restored`, `release` (kèm giá trị đã trả + cách verify), `keep`, `finish` (giữ lại / đã khôi phục / chưa khôi phục được). Khôi phục thất bại thì giữ lock, chỉ chặn các lượt phụ thuộc tài nguyên đó. `takeover` từ chối nếu lượt cũ vẫn `running`, trừ khi có `--confirm-interrupted` kèm `--actual` (giá trị thực tế đã kiểm).
- Gặp block đã có trong `<knowledge>/_flows/troubleshooting.md` và bài học còn đúng → agent tự phục hồi, ghi nguồn + bằng chứng, không hỏi lại người dùng. Thất bại thì đánh dấu cần kiểm tra lại, thử tối đa 2 phương án. Bài học mới đề xuất qua CCR khối C; bài học đụng business rule, mở rộng quyền hoặc đổi tiêu chí Pass để `chờ xác nhận`.
- Dùng throttle/route để giả lỗi mạng: phải chứng minh sản phẩm đi vào nhánh xử lý lỗi, và gỡ ngay sau case.
- Analysis và gen-testcase chạy tuần tự trong skill này; chỉ P3/P5 chạy nền song song (`Agent`, `run_in_background`).
- Phiên login hết hạn (agent báo bị đẩy về login) → nhờ người dùng login lại, restart Claude Code nếu server cần nạp lại; trong lúc đó dồn issue sang server `playwright`.

## Ranh giới

- Không tạo / sửa / comment issue Jira. Không tự `report_bug` trên Testlane.
- Không xoá test data — chỉ khi người dùng yêu cầu.
- Không coi workaround là tiêu chí Pass; quan sát mới không tự thành business rule (ghi vào analysis/decisions dưới dạng assumption, chờ xác nhận).
- Người dùng chỉ bị hỏi ở Gate 1, P4 (nếu có việc cần làm tay), câu đổi setup phát sinh giữa chừng, và Gate 2.
