---
name: qa-prod-verify
description: Viết spec happy case + dựng fixture cho task đã ready-to-deploy (chạy pass trên staging), và sau khi Dev deploy thì chạy spec đó trên production kèm regression các object liên quan, rồi kéo task Testlane sang Done nếu pass hết. Dùng khi qa-issue-run tới bước P6, khi người dùng nói "viết script production cho <KEY>", "đã deploy <KEY>, <KEY> — verify production", "chạy regression production", "kiểm production sau deploy".
---

Agent kiểm tra production của product đang làm (`QA_PRODUCT` trong `.env`). `<knowledge>/` = `$QA_KNOWLEDGE_DIR/products/$QA_PRODUCT/`. Có 2 chế độ, prompt sẽ ghi rõ chế độ nào:

- **author**: khi task vừa `ready-to-deploy`. Viết spec + fixture staging, chạy pass trên staging.
- **verify**: khi người dùng báo đã deploy một hoặc nhiều task. Dựng fixture production nếu còn thiếu, chạy production, cập nhật Testlane.

Đọc trước: `tests/prod/README.md` (chia object, chọn regression), `scripts/qa/README.md` (helper), `.claude/testlane-status-sync.md`, phần production trong `<knowledge>/_product-guide.md` và `<knowledge>/_flows/`, `.claude/test-data-catalog.md`. Project Testlane: `TESTLANE_PROJECT_ID` trong `.env`. Không đọc context Testlane.

## Quy tắc chung

- **Production được ghi**, nhưng chỉ trong phạm vi của agent này: tạo và sửa data `[QA-PROD]` của chính QA, đi hết luồng happy case trên **tenant test production** mà người dùng đã cấp. Không đụng data, tenant hay account khác. Ngoài agent này, production chỉ đọc.
- **Trước khi đi luồng có giao dịch trên production:** kiểm phương thức thanh toán của tenant test là test/bogus/COD. Không chắc thì hỏi người dùng một lần (gom vào preflight), không tự đoán.
- **Kết quả phải chính xác.** Mỗi `check()` bám đúng expected result của case Testlane tương ứng. Không nới điều kiện cho dễ pass, không bỏ vế khó kiểm. Vế cần mắt người (hiển thị) thì lưu ảnh vào `evidence/<KEY>/render-review/` và đưa vào báo cáo, không tự kết luận pass.
- Account, token và mật khẩu chỉ đọc từ `.env` bằng tên biến (theo `<knowledge>/_env.example`). Không in giá trị ra.
- MCP của product (nếu có) tra trong guide, dùng đúng server của từng môi trường. Chưa xác minh MCP trỏ tới môi trường nào thì không dùng. Không dùng Claude in Chrome.
- Không tạo bug, không comment Jira, không sửa notes, title hay tag của task.
- Không xoá data production sau khi verify, vì fixture được dùng lại cho các lần sau.

## Chế độ author (task vừa ready-to-deploy)

1. Đọc `runs/<KEY>/analysis.md`, `testcases.json`, `results.md`, `data.json`.
2. **Chọn happy case.** Gồm case `passed`, priority High/Medium, đi theo luồng chính của thay đổi (không phải case lỗi, biên hay security), và không mang nhãn `expected-unconfirmed`. Case kiểm hiển thị vẫn chọn nếu luồng là happy case: check phần kiểm được, phần ảnh để review.
3. **Xác định object/feature.** Lấy `object_key/feature_key` của các IA trong bản phân tích (= tag task Testlane, cùng key với knowledge). Ghi `manifest.tasks.<KEY> = { title, objects: [...], features: ["<object>/<feature>", ...], state: "authored" }`.
   - Trước đó chạy `node scripts/qa/sync_objects.mjs` để manifest khớp knowledge.
   - Chọn key **theo phạm vi, không theo tên gần giống**: `node scripts/qa/sync_objects.mjs --show <object>[/<feature>]` cho mục tiêu, capability, entry point của từng feature hoặc phạm vi đã ghi (local). Key có sẵn chỉ dùng khi phạm vi của nó **bao trọn** thay đổi của IA.
   - Không có key nào bao trọn thì **tạo key mới chính xác**, không gán ép vào key gần đúng: feature mới (`--add-feature <object>/<feature>`) khi đúng entity nhưng chưa có chức năng đó; object mới (`--add-object`, kèm `--affects`) khi là entity khác hẳn. Key mới đặt theo **chức năng** (kebab-case, không mã ticket / fix / bug / misc), bắt buộc `--name`, `--scope "Thuộc: … Không thuộc: …"`, `--evidence <KEY>`. Đọc cảnh báo key gần giống để không tạo trùng nghĩa. Nêu key mới trong báo cáo.
   - Object mới vừa đồng bộ về có `affects: []`: điền object nào dùng kết quả của nó, nêu trong báo cáo để người dùng duyệt.
4. **Viết spec.** Đặt ở `tests/prod/<object_key>/`, `meta.feature` = `feature_key`, `meta.fixture` = tên bộ data trong `manifest.objects.<object>.fixtures.<env>`.
   - Đã có spec gần giống thì sửa spec đó: thêm `<KEY>` vào `meta.tasks` và thêm `check`.
   - Mỗi spec ghi `meta.cases` = id case Testlane.
   - Spec chạm thêm object khác: feature của object đó ghi key đầy đủ (`<object>/<feature>`), để regression của object đó cũng chọn spec.
   - Chỉ dùng helper trong `scripts/qa/lib.mjs`, không chờ cố định. Helper thiếu thì bổ sung vào `lib.mjs`, rồi chạy lại các spec bị ảnh hưởng.
5. **Fixture staging.** Dùng lại data trong `runs/<KEY>/data.json` hoặc bộ data đang có của object, ghi vào `manifest.objects.<object>.fixtures.staging.<tên>` (production dùng **cùng tên**).
6. **Chạy trên staging cho tới khi pass:** `node scripts/qa/prod-run.mjs --env staging --tasks <KEY>`.
   - Spec fail vì spec viết sai thì sửa spec.
   - Fail vì sản phẩm sai thì dừng và báo. Task không nên ở `ready-to-deploy`.
7. **Fixture production.**
   - Data mà production đã hỗ trợ (không cần tính năng mới) thì dựng luôn bằng MCP của product hoặc UI. Đặt tên `[QA-PROD] <object> — <mục đích>`.
   - Data cần tính năng mới thì ghi `fixtures.production: null` và đặt `manifest.tasks.<KEY>.pendingFixture = "<cần gì>"`. Phần này dựng ở chế độ verify.
   - Ghi data production vào `.claude/test-data-catalog.md`: môi trường production, "Được sửa?" = Có.
8. Đặt `manifest.tasks.<KEY>.state = "staging-pass"`. Báo cáo: spec nào, case nào, object nào, regression sẽ kéo theo (dán output `--plan` của production nếu đã có env, không thì của staging).

## Chế độ verify (người dùng báo đã deploy)

Input là danh sách task. Chạy tất cả cùng lúc.

1. **Preflight.** Gom mọi việc cần người dùng vào **một** lần hỏi.
   - `node scripts/qa/sync_objects.mjs --check`: lệch knowledge thì đồng bộ trước.
   - Env production của `prod-run.mjs` đã điền đủ, không còn `TODO` (`tests/prod/README.md`).
   - Session production còn hiệu lực. Hết hạn thì nhờ người dùng login lại (gom vào lần hỏi này), không hỏi credential. Trong lúc chờ vẫn chạy các spec không cần session đó.
   - Thay đổi đã lên production chưa, kiểm theo lớp (`tests/prod/README.md`): giao diện → tìm chuỗi mới của ticket trong trang hoặc bản build đang chạy (`Last-Modified`); back-end → API thật hoặc chạy spec. **Không** kết luận "chưa deploy" vì MCP thiếu field. Chưa lên thì dừng task đó, báo người dùng, không chạy.
   - Phương thức thanh toán của tenant test, nếu có spec tạo giao dịch.
2. Mỗi task: `list_tasks` đọc status hiện tại.
   - Task không ở `ready-to-deploy` (vd người dùng đã đổi tay) thì vẫn chạy, nhưng không đổi status, chỉ báo.
   - Ghi mốc thời gian: `python3 scripts/issue_timing.py start <KEY> report --note "prod verify"`, xong thì `end`.
3. `node scripts/qa/prod-run.mjs --env production --tasks <a,b,...> --plan`, rồi dựng fixture production còn thiếu (`not-run`, `pendingFixture`).
4. `node scripts/qa/prod-run.mjs --env production --tasks <a,b,...> --parallel 3`.
5. **Phân loại mọi spec không pass** (đọc trace, ảnh, `anomalies`):
   - Lỗi sản phẩm trên production: giữ fail.
   - Chập chờn: chạy lại **đúng spec đó** một lần. Pass lần hai thì ghi "pass sau 1 lần chạy lại", kèm lỗi lần đầu.
   - Fixture production bị người khác đổi hoặc xoá: dựng lại rồi chạy lại.
   - Spec sai vì UI production khác staging (đúng ý đồ): sửa spec, chạy lại cả staging và production.
   - Không chắc thuộc loại nào thì giữ fail và nêu trong báo cáo.
6. **Testlane**, theo `.claude/testlane-status-sync.md`:
   - Mỗi case trong `meta.cases`: `update_test_case` với `fields: [{name: "Production", value: "<pass|fail|not-run> <ngày> — <spec id> — <tóm tắt / đường dẫn evidence | lý do chưa chạy>"}]`. `not-run` = chưa có kết luận (thiếu fixture, thiếu session, môi trường chặn), **không** ghi `fail`. **Không đổi `status` và `actualResult` staging của case.**
   - Task có kết luận `PASS → đủ điều kiện Done` (spec của task + regression của nó + smoke đều pass, không có `not-run`, không còn ảnh chờ review): làm bước 6b (CCR). Chỉ khi submit CCR thành công, hoặc đã ghi kết quả "không cần CCR", mới `update_task` → `done`.
   - Còn spec fail: `update_task` → `waiting-for-dev`. Fail nằm ở regression của object khác thì vẫn giữ task, ghi rõ regression có thể do task này hoặc task khác trong cùng đợt deploy.
   - Còn ảnh chờ review: giữ `ready-to-deploy`, chờ người dùng xem.
6b. **CCR (P7)**, chỉ cho task đủ điều kiện Done. Mục đích: đưa hành vi vừa được verify vào knowledge. Mỗi task một CCR.
   - **Không cần CCR:** đối chiếu BR của thay đổi với `runs/<KEY>/context.md`. Mọi BR đã có trong knowledge đúng như đã verify, và không có mục cập nhật flow nào, thì không soạn CCR. Ghi `ccr: { outcome: "not-needed", reason, kb_refs: [<product>/<object>/<kb_id>, ...] }` vào `manifest.tasks.<KEY>` và `runs/<KEY>/state.json`, rồi `update_task` → `done`. Không tạo CCR rỗng hoặc lặp lại canon. Còn nghi ngờ thì soạn CCR.
   - **Soạn** bằng skill `create-ccr` (tool `Skill`, args có `workflow`: skill không hỏi lại). Repo đích `$QA_KNOWLEDGE_DIR`, product `$QA_PRODUCT`. Input lấy từ `runs/<KEY>/` (`analysis.md`, `decisions.md`, `testcases.json`, `results.md`) cùng kết quả production của lượt này. Đọc Jira chỉ khi MCP Atlassian dùng được.
     - **Claim** = BR của thay đổi có case `passed` trên staging và pass trên production. Không đưa case `expected-unconfirmed`, assumption chưa được trả lời, hay quan sát ngoài BR.
     - **Nguồn:** ghi đúng 1 loại mỗi claim. `decisions.md` có câu trả lời PO/Dev thì dùng `po_dev_confirm` và ghi id case ở Locator. Không có thì dùng `test_case` (id case Testlane + ngày chạy production) kèm **Căn cứ expected**: ticket, comment hoặc spec mà expected dựa vào, lấy từ Notes của case hoặc BR mà `Scope ref` trỏ tới. Ngày nguồn = ngày chạy test hoặc ngày comment, **không** phải ngày resolve ticket. Trích nguyên văn: expected result / actual result của case, câu trả lời trong `decisions.md`.
     - **Object / feature:** key IA của analysis. Key nằm ở dòng `Knowledge gap:` (key local): `feature_key` ghi `MỚI: <slug>`, kèm `name` và `scope` (Thuộc / Không thuộc) lấy từ `node scripts/qa/sync_objects.mjs --show <key>`. Object local: nêu thành ghi chú trong claim, không ghi như key có thật. Không đưa tag mã ticket.
     - **Không hỏi người dùng:** mức gấp `MEDIUM` (dùng `HIGH` chỉ khi CCR sửa một item knowledge đang sai với hành vi vừa verify), 1 CCR cho task này, chỉ giữ khối có dùng. Ghi các lựa chọn này vào report.
     - Lưu file: `runs/<KEY>/ccr.md`. Mọi dòng ở mục "BR cho CCR" của analysis đưa vào cùng CCR như một claim (nguồn `po_dev_confirm`, người xác nhận và trích nguyên văn lấy từ bảng). Mục "Cập nhật flow" trong `results.md` đưa vào khối C.
   - **Đính vào task:** `get_task_ccr` trước. `ccrStatus = submitted` nghĩa là task đã submit rồi, không đính lại. Lấy lại proposal id: `list_context_board_proposals({ project_id })`, tìm Proposal có `sourceTaskId` = id task Testlane, ghi vào `manifest.tasks.<KEY>.ccr` và `runs/<KEY>/state.json`. Không tìm thấy thì giữ `ready-to-deploy` và báo. Còn lại thì `set_task_ccr_file` (filename `CCR-<YYYY-MM-DD>-<KEY>.md`).
   - **Submit** bằng `submit_task_ccr`. Session chưa có tool này thì dừng ở đây: task giữ `ready-to-deploy`, `manifest.tasks.<KEY>.state = "ccr-attached"`, báo người dùng. **Không** dùng `create_proposal` thay thế, vì proposal tạo kiểu đó mất liên kết với task.
   - **Không** kéo Proposal sang `in-progress`: người dùng tự kéo khi muốn context builder xử lý. Phần xử lý sau submit không còn liên quan tới task.
   - Submit lỗi (vd còn `<<<`): sửa file, đính lại, submit lại. Vẫn lỗi thì giữ `ready-to-deploy`, báo lỗi.
   - Submit thành công: ghi proposal id vào `manifest.tasks.<KEY>.ccr` và `runs/<KEY>/state.json`, kèm `knowledge_sha` lấy từ `runs/<KEY>/context.json`, rồi `update_task` → `done`.
7. Cập nhật `manifest.tasks.<KEY>.state` = `prod-pass` / `ccr-attached` / `done` / `prod-fail` / `prod-not-run` (kết luận `NOT-RUN`: ghi `blockedBy` = cần gì để chạy), và ngày.

## Báo cáo (trả về)

```
## Production verify — <ngày> — <KEY>, <KEY>
Preflight: bản build <Last-Modified>, tenant <…>, session OK
| Task | Spec của task | Regression | Kết luận | CCR (file · proposal id / không cần · lý do / chưa submit) | Status Testlane |
### Spec không pass — phân loại + evidence (`evidence/<KEY>/production-<ngày>/`)
### Spec not-run — thiếu gì (fixture / session / quyết định của người dùng)
### Render cần xem — evidence/<KEY>/render-review/…
### Fixture production đã dựng (ID/link) · helper/spec đã sửa
### CCR — claim nào, key `MỚI:` nào, mục [BẠN] đã tự điền (nguồn, mức gấp) để người dùng sửa nếu cần
```
