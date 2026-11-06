# Đồng bộ status với Testlane

Nguồn duy nhất cho việc cập nhật status **task** và **test case** trên Testlane khi chạy một issue. Dùng bởi `qa-issue-run`, `gen-testcase`, agent `qa-execute-testcase`, `qa-prod-verify` (kể cả khi agent được gọi lẻ, không qua `qa-issue-run`).

Mục tiêu: nhìn Testlane là biết issue đang ở đâu, không cần đọc `runs/<KEY>/`.

## 0. Project và phạm vi đọc

- Project Testlane: **`TESTLANE_PROJECT_ID`** trong `.env`. Tool nhận `projectId` là id này, không phải key: truyền key sẽ bị báo "not a member".
- Testlane chỉ dùng để đọc/ghi **task và test case** (kèm field CCR của task). **Không** đọc context trên Testlane (`get_project_context`, `get_project_context_file`, `search_knowledge`). Context sản phẩm lấy từ knowledge của product qua `scripts/qa/kb_context.mjs`; nội dung issue đọc từ Jira.
- Tìm task của một issue: `list_tasks` (output lớn, được lưu ra file) → lọc bằng python theo `devIssueKey` hoặc `[<KEY>]` ở đầu `description`; không đọc thẳng file.

## 1. Status task theo mốc

| Mốc | Status task | Ai đặt |
|---|---|---|
| Tạo task (P2) hoặc bắt đầu làm một task đang `todo` | `in-progress` | gen-testcase / qa-issue-run P0 |
| Gate 1 đang chờ câu `Q`, nhưng vẫn còn case chạy được | giữ `in-progress` | — |
| Gate 1 đang chờ, và **mọi** case còn lại đều phụ thuộc câu `Q` | `waiting-for-dev` | qa-issue-run |
| Bắt đầu execute, hoặc chạy lại sau khi Dev fix / PO trả lời | `in-progress` | qa-execute-testcase |
| Hết lượt execute, còn case chờ người dùng review render (`not-run` + "Chờ review render") | giữ `in-progress` cho tới khi người dùng trả lời ở Gate 2 | — |
| Hết lượt execute (và review render đã xong): có case `failed` | `waiting-for-dev` | qa-execute-testcase / qa-issue-run |
| Không có `failed`, nhưng còn case `blocked` / `expected-unconfirmed` / `not-run` chờ PO, Dev hoặc deploy | `waiting-for-dev` | như trên |
| Mọi case `passed` hoặc `skipped` có lý do, không còn gì chờ | `ready-to-deploy` | như trên |
| Dev báo đã deploy → `qa-prod-verify` chạy production: spec của task + regression + smoke **pass hết**, không còn render chờ review, **và CCR của task đã submit thành công hoặc đã ghi "không cần CCR" kèm lý do** | `done` | qa-prod-verify |
| Production pass nhưng CCR chưa submit được (chưa có tool submit, submit lỗi) | giữ `ready-to-deploy` | — |
| Production verify có spec fail | `waiting-for-dev` | qa-prod-verify |
| Production verify còn ảnh render chờ review / thiếu fixture | giữ `ready-to-deploy` | — |

Status cuối được tính lại từ status thật của các case trên Testlane (sau bước đối chiếu ở mục 3), không tính từ trí nhớ của lượt chạy.

## 2. Không ghi đè thay đổi tay

- Trước khi đổi status task: đọc status hiện tại (`list_tasks`).
- Status hiện tại là `done`, hoặc khác với status agent đặt lần trước (lưu ở `runs/<KEY>/state.json` → `testlane.taskStatus`) ⇒ người dùng đã đổi tay. **Không đổi**, ghi vào báo cáo: "task đang `<x>` do người dùng đặt, theo kết quả lượt này lẽ ra là `<y>`".
- Case có `passed`/`failed` mà không có `actualResult` là kết quả người dùng test tay ⇒ không reset, không chạy đè.
- Sau mỗi lần đổi status task: ghi `state.json` → `"testlane": {"taskId": "...", "taskStatus": "<vừa đặt>", "synced": "<ISO time>"}`.

## 3. Status test case

- Mỗi case có kết quả là `update_test_case` **ngay**, không dồn cuối lượt. Chạy bằng `scripts/qa/run.mjs` thì sau **mỗi lệnh runner** cập nhật hết các case của lệnh đó rồi mới chạy lệnh tiếp.
- Case bị giữ chờ câu `Q` hoặc chờ review render: để `not-run`, `actualResult` ghi đang chờ gì ("Chờ PO trả lời Q2", "Chờ review render — evidence/<KEY>/render-review/…").
- **Đối chiếu cuối lượt** (bắt buộc, cũng làm khi resume một issue bị ngắt): `list_test_cases` của task, so với kết quả lượt chạy (`results.md`, `runs/<KEY>/script-results.jsonl`):
  - Agent đã có kết quả mà Testlane chưa ghi → ghi bù.
  - Testlane khác kết quả agent vì người dùng đổi tay → giữ bản của người dùng, nêu trong báo cáo.
  - Case không ai chạy và không có lý do → ghi lý do (`blocked` / `skipped` / `not-run` + chờ gì).
  - Ghi vào báo cáo một dòng: `Testlane: N case khớp, M ghi bù, K giữ theo người dùng; task <id> → <status>`.
- Gate 2: người dùng trả lời review render / quyết định case nào → cập nhật đúng case đó, rồi tính lại status task theo mục 1.

## 4. Không làm

- Không sửa notes / title / tags / assignee của task, không đính ảnh, không comment Jira, không tự `report_bug` (scope execute vẫn như cũ — chỉ thêm case, update status case và status task).
- Chỉ `qa-prod-verify` được đặt `done`, và chỉ khi production verify của task pass hết và CCR của task đã submit hoặc đã ghi "không cần CCR" kèm lý do. Đính CCR vào task (`set_task_ccr_file`) là ghi field CCR của task — được phép; không kéo Proposal trên Context Builder Board.
- Kết quả production ghi vào field `Production` của case (`pass` / `fail` / `not-run` + ngày + spec + evidence hoặc lý do); **không** đổi `status` / `actualResult` staging của case. `not-run` không phải `fail`.
