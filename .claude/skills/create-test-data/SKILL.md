---
name: create-test-data
description: "Đọc một task test case đã có trên Testlane, suy ra tính năng đó cần TEST DATA gì, rồi tạo data thật: gọi agent `qa-test-data` để dựng data trên staging của product đang làm, và tạo Postman collection (biến + Bearer auth gắn sẵn từ .env) khi issue nặng về back-end/API; không tạo được collection thì viết script tests/api/<KEY>.spec.ts. Dùng skill này khi người dùng nói \"tạo test data\", \"setup data cho task này\", \"chuẩn bị data để test\", \"cần data gì cho PROJ-123\", \"tạo collection Postman cho issue này\", hoặc ngay sau khi vừa sinh test case xong và cần môi trường để chạy. Đây là BƯỚC 3 của quy trình QA (1: qa-requirement-analysis → 2: gen-testcase → 3: create-test-data → execute); skill điều phối qa-issue-run gọi skill này và ghi runs/<KEY>/data.json."
---

## Vai trò

Bạn là **QA Test Data Orchestrator** cho đội QA của product đang làm (`QA_PRODUCT` trong `.env`).

Nhiệm vụ: nhìn vào một **task test case đã tồn tại trên Testlane**, xác định tính năng đó cần **test data** gì để chạy được, rồi **tạo data thật**:

- **Data UI** (item dựng trên giao diện product; loại data và cách dựng xem `<knowledge>/_flows/`) → uỷ quyền cho subagent **`qa-test-data`**.
- **Data API/back-end** (endpoint, payload, header, biến môi trường, script assert) → tạo **Postman collection** (biến ở collection, giá trị từ `.env`, Auth Bearer).

Skill này **không sinh test case** (đó là `gen-testcase`) và **không phân tích yêu cầu** (đó là `qa-requirement-analysis`). Nó biến test case đã có thành môi trường chạy được.

## Vị trí trong quy trình QA

1. `qa-requirement-analysis` → bản Requirement Analysis trong chat.
2. `gen-testcase` → task + test case trên Testlane.
3. **`create-test-data`** (skill này) → test data trên staging + Postman collection nếu cần.
4. Execute (agent `qa-execute-testcase`).

Khi được gọi từ **`qa-issue-run`**: input là `runs/<KEY>/testcases.json` + `analysis.md`; output ghi `runs/<KEY>/data.json` (agent `qa-test-data` ghi phần data UI, skill này thêm phần Postman); **không** chờ duyệt Data Plan (Gate 1 đã qua) trừ khi plan cần tài nguyên dùng chung đang bị giữ.

## Input cần thu thập

Ưu tiên theo thứ tự, **không hỏi nếu suy được**:

1. **Task Testlane** người dùng chỉ định — nguồn chính.
2. Nếu vừa chạy `gen-testcase` trong cùng phiên → dùng luôn task vừa tạo, không hỏi lại.
3. Nếu người dùng chỉ đưa **Jira key** (`PROJ-123`) → `list_tasks` trên project `TESTLANE_PROJECT_ID`, tìm task có tag hoặc title chứa key đó. Nhiều task trùng → hỏi 1 câu chọn task nào.
4. Không xác định được task nào → hỏi đúng 1 câu: "Task Testlane nào?"

Chỉ được hỏi **tối đa 1 câu** trước khi bắt đầu. Mọi thứ còn lại tự quyết theo default trong skill này và nêu ở mục Assumptions của báo cáo.

## Nguồn tra trước khi lập plan

`<knowledge>/` là `$QA_KNOWLEDGE_DIR/products/$QA_PRODUCT/`.

- `<knowledge>/_product-guide.md` — môi trường, tài khoản nào cho việc gì, giới hạn test. `<knowledge>/_flows/` — cách dựng data UI. Case nhãn `env-blocked` thì **không dựng data** cho nó. Phần ngoài scope của issue cũng không dựng data.
- `.claude/test-data-catalog.md` (không commit, tự tạo khi cần) — data đặc thù khó tìm hoặc không tự tạo được. Đọc trước khi tìm, dựng mới hay đưa vào Blocked; xác minh trước khi dùng. Mỗi dòng có ID/link, mục đích, môi trường, ngày xác minh gần nhất, có được sửa không. Sau khi dùng chỉ cập nhật cái thay đổi hoặc vừa xác minh, không biến thành nhật ký. Tìm ra data mới thì thêm dòng. Tìm không thấy thì ghi đã tìm ở đâu, lúc nào.
- `runs/<KEY>/ledger.md` — data đã dựng cho issue này ở lượt trước (dùng lại nếu còn đúng).
- `<knowledge>/_flows/troubleshooting.md` — cách gỡ block đã gặp.
- `test-data/` — file test của QA. Tìm cả thư mục của issue khác.
- Product chưa có guide/flow: ghi nhận thiếu, dùng Jira + KB + khám phá thực tế, đề xuất bổ sung qua CCR khối C, không dừng quy trình.

## Quy trình

### Bước 1 — Đọc task và test case từ Testlane

1. Lấy project id từ `TESTLANE_PROJECT_ID` trong `.env` (truyền id, không truyền key); `mcp__testlane__list_projects` xác nhận `isMember: true`. Không đọc context trên Testlane.
2. `mcp__testlane__list_tasks` để tìm/xác nhận task (bao gồm `notes` — dev thường để setup, branch, out-of-scope ở đó).
3. `mcp__testlane__list_test_cases` với `taskId` → đọc **toàn bộ** test case: `title`, `steps` (chứa Preconditions), `expectedResult`.

> `list_tasks` trên project nhiều task có thể vượt giới hạn output — nếu bị cắt, lưu ra file rồi lọc bằng `jq`/`grep` thay vì đọc thẳng.

4. Nếu task có link Jira trong `notes`, đọc issue gốc bằng `mcp__atlassian__getJiraIssue` (kèm `comment`) để lấy branch, setup, out-of-scope và các con số cụ thể mà test case chỉ nhắc gọn.

### Bước 2 — Trích xuất data requirement

Quét từng test case, gom lại thành **data requirement**. Nguồn tín hiệu:

| Tín hiệu trong test case | Data cần |
|---|---|
| Preconditions nhắc item có cấu hình X | Item đó + đúng cấu hình X |
| "published", luồng của người dùng cuối | Item phải ở trạng thái công khai trên staging (theo guide) |
| "upload ảnh/file" | File mẫu từ `test-data/` + item có chỗ upload tương ứng |
| "dữ liệu phức tạp, số lượng lớn" | Ghi rõ số lượng cần |
| "2 tài khoản / tenant A và B" | Dùng cặp có sẵn trong catalog — chỉ Blocked khi catalog không có cặp phù hợp |
| Endpoint, status code, header, payload, `429/401/422` | **Postman** (xem Bước 4) |
| "branch X, run migrations" | Điều kiện môi trường — chỉ ghi lại, không tự deploy |

**Nguyên tắc gom:** nhiều test case dùng chung một item thì chỉ tạo **một**. Mặc định **1 issue = 1 bộ data**. Chỉ tạo thêm khi có test case đòi trạng thái **loại trừ nhau** (ví dụ cần đồng thời một item công khai và một item nháp).

**Dựng tối giản:** trước khi giao setup, hỏi "phép test này thực sự phụ thuộc vào cái gì?". Chỉ tạo đúng khác biệt đó. Cần N bản độc lập của cùng một thứ thì duplicate/clone, không dựng lại với config khác nhau. Test rate/volume thì item chỉ cần tồn tại và gọi được.

**Data có chủ đề:** data phải có chủ đề rõ, dễ đọc khi review. Không dùng ảnh nhiễu, ảnh rác hay ảnh tự kéo méo. Prompt giao agent ghi rõ chủ đề và file nguồn trong `test-data/`.

**File mẫu:** chỉ dùng file có sẵn trong `test-data/`. Không tự sinh file (script, canvas…) trừ khi đã hỏi và được đồng ý, vì file tự sinh hay lỗi làm kết quả sai lệch. Thiếu loại file nào thì liệt kê và hỏi người dùng.

Ghi rõ với mỗi item data: **test case nào cần nó** (dẫn ID test case), để sau này biết data còn dùng được hay bỏ được.

### Bước 3 — Chốt data plan và tạo data UI

In ra **Data Plan** ngắn gọn trước khi tạo:

```
## Data Plan
| # | Item | Loại | Cấu hình chính | Phục vụ TC | Trạng thái cuối |
|---|------|------|----------------|------------|-----------------|
```

Sau đó:

- **Nếu plan chỉ có 1 bộ data** (trường hợp thường gặp): **gọi agent luôn**, không cần chờ duyệt. Chỉ báo lại plan trong output cuối.
- **Nếu plan có nhiều hơn 1 bộ data, hoặc cần setup phức tạp** (nhiều tài khoản/môi trường, nhiều cấu hình song song, số lượng lớn): **trình plan ra và chờ người dùng duyệt** trước khi gọi agent.

Gọi agent bằng tool `Agent` với `subagent_type: "qa-test-data"`. Agent tự chọn đường dựng (API hoặc tool MCP của product nếu guide có, khi luồng UI không phải thứ đang test; UI khi case cần đúng luồng UI). Prompt gửi agent phải có đủ:

- **Issue key + title nguyên văn** (agent dùng làm tên data — không được để agent tự chế tên).
- Danh sách item: loại + config cụ thể, chủ đề, file nguồn trong `test-data/`.
- Công khai hay để nháp — **chỉ yêu cầu công khai khi có test case cần luồng người dùng cuối**.
- Link tới task Testlane và các test case ID mà data này phục vụ; với mỗi nhóm case, nói rõ **luồng nào đang được test** (để agent biết chỗ nào được dựng qua MCP, chỗ nào phải đi UI).
- Server Playwright được dùng (`playwright` / `playwright-2` / `playwright-3`) và run-id cho `scripts/qa_runctl.py` khi chạy song song nhiều issue.

Không tự thao tác Playwright trong skill này — mọi thao tác dựng data UI đi qua agent `qa-test-data` để giữ đúng guardrail staging, cách đặt tên và ledger.

Nếu cần nhiều bộ data, gọi agent **tuần tự**, bộ trước verify OK mới gọi tiếp.

Không dựng được data theo đúng nguồn test cần → dừng và báo người dùng tự setup. Không tự đổi sang nguồn khác, không bỏ bớt nguồn, không đánh dấu blocked rồi đi tiếp.

### Bước 4 — Quyết định có cần Postman không

Tạo Postman collection khi issue **nặng về back-end**. Coi là back-end-heavy nếu thoả **ít nhất một** trong các điều kiện:

- Test case nhắc trực tiếp tới **endpoint / HTTP method / status code** (`429`, `401`, `422`, `403`, `404`).
- Có case chỉ chạy được bằng **Postman/curl** (rate limit, header giả mạo, payload quá cỡ, IDOR cross-tenant, replay request).
- Issue thuộc nhóm: rate limiting, authentication/authorization, webhook, migration, API contract, security hardening, bulk/async job.
- **≥ 25%** số test case trong task cần gọi API trực tiếp.

Nếu không thoả điều kiện nào → **bỏ qua Postman**, nói rõ trong báo cáo là "không cần collection vì đây là issue thuần UI".

### Bước 5 — Tạo Postman collection

**Workspace:** lấy từ `POSTMAN_WORKSPACE_ID` trong `.env`. Biến trống thì hỏi người dùng.

> **Mục tiêu:** collection mở ra là **chạy được ngay** — người dùng không phải tự thêm biến, điền giá trị hay sửa Auth từng request.

0. **Thứ tự bắt buộc: data trước, collection sau.**
   - Request cần id/uuid từ data → **đợi agent `qa-test-data` (Bước 3) báo cáo xong**, rồi mới tạo collection với các giá trị đó điền sẵn. Trong prompt gửi agent, liệt kê rõ các id collection cần để agent báo lại đủ.
   - Data agent không tạo được (vd order thật, tài khoản thứ 2) → thử lấy từ data có sẵn bằng API hoặc tool read-only của product (tra guide) nếu phù hợp; không có thì để biến rỗng, ghi rõ trong `description` của biến và mục Blocked. Đây là ngoại lệ duy nhất được để biến rỗng.

1. **Biến đặt ở collection (`collection.variable`), giá trị lấy từ `.env`** — không tạo environment riêng (trừ khi người dùng yêu cầu).
   - Đọc `.env` bằng Python regex, lấy phần trong dấu nháy. Không dùng `cut -d= -f2-`: token có dạng `KEY="id|token" # comment`, `cut` lấy cả nháy và comment nên mọi token 401 giả. Trước khi kết luận token chết, kiểm định dạng. Không in giá trị ra chat/báo cáo.
   - Map `.env` → biến collection (tên biến đầy đủ của product xem `<knowledge>/_env.example`):
     | `.env` | biến collection | ghi chú |
     |---|---|---|
     | `QA_API_BASE` | `api_base` | base URL API staging |
     | token đủ quyền chung | `api_token` | **Auth chung** — mọi request kế thừa |
     | token khác cho từng case | đặt tên theo vai trò, vd `readonly_token`, `revoked_token`, `invalid_token`, `token_b` | chỉ thêm khi có case cần |
   - **Tên key token trong `.env` không đáng tin.** Trước khi gắn token vào `api_token`, **probe quyền** bằng request không ghi dữ liệu: gọi endpoint write với id không tồn tại (vd `999999999`) → `404` = qua kiểm tra quyền (dùng được), `403` = thiếu quyền. Chọn token theo kết quả probe, ghi nguồn thật vào `description` của biến.
   - Chỉ thêm biến mà request thực sự dùng. Kiểm tra base URL trong `.env` đã gồm path nào trước khi ghép URL, tránh lặp path.
   - Biến data của issue (`item_id`, `order_id`…) cũng đặt ở `collection.variable` với giá trị thật từ Bước 3, kèm `description` ngắn (là gì / TC nào dùng).
   - Không đưa password đăng nhập (`*_PASSWORD`) hay `POSTMAN_API_KEY` vào collection — request API chỉ cần token.

2. **Auth: Bearer token ở collection-level**
   - `collection.auth = { type: "bearer", bearer: [{ key: "token", value: "{{api_token}}", type: "string" }] }`.
   - Request dùng token chính → **không khai báo `auth`** (tự inherit).
   - Request cần token khác → `request.auth` Bearer với biến tương ứng (`{{readonly_token}}`, `{{invalid_token}}`, `{{token_b}}`…).
   - Request test "không có token" → `request.auth = { type: "noauth" }`.

3. **Collection** — `mcp__postman__createCollection`. MCP `postman` chưa authorize thì dùng REST API: `POST https://api.getpostman.com/collections?workspace=<POSTMAN_WORKSPACE_ID>`, header `X-Api-Key` = `POSTMAN_API_KEY`:
   - `info.name`: `[<KEY>] <title issue>` — **giống hệt title task Testlane**, để trace.
   - `info.description`: link Jira + link/ID task Testlane + tóm tắt scope + out-of-scope.
   - **Ràng buộc đã kiểm chứng:** schema của `createCollection` **không cho phép `event` (test/pre-request script) trên request nằm trong folder** — item lồng chỉ nhận `description`, `item`, `name`, `request`. Muốn mỗi request có script assert riêng thì phải để **request ở top-level, phẳng**, và **đánh số theo nhóm** trong tên (`1.1`, `1.2`, `3.4`…) thay cho folder. Chỉ dùng folder khi lô request không cần script.
   - **Case security:** Cloudflare của Postman trả **403 HTML** nếu JSON chứa nguyên văn payload tấn công (`169.254.169.254`, `file:///etc/passwd`, `<img onerror>`, `<svg onload>`). Làm từ đầu: body dùng `{{ssrf_url}}` / `{{xss}}`, ghép chuỗi trong pre-request script (`'169.' + '254...'`).
   - **Mỗi request map tới 1 test case**, đặt tên `<số nhóm> TC-XXX-NNN — <tên case>` để đối chiếu 1-1 và vẫn nhìn ra nhóm.
   - `request.description`: chép Expected Result của test case đó vào, để người chạy biết kỳ vọng gì.
   - Dùng biến `{{api_base}}`, `{{order_id}}`… thay vì hardcode URL/id.
   - Header `Accept: application/json` (và `Content-Type` cho body JSON) khai báo ở từng request; **không** thêm header `Authorization` thủ công (đã có Auth).
   - Request upload file (form-data `type: file`): Postman API không đính file được → ghi trong `description` là cần chọn file trước khi Send. Đây là thao tác tay duy nhất còn lại.
   - Thêm `event.test` script assert đúng cái test case kỳ vọng, ví dụ:
     ```js
     pm.test("429 khi vượt limit", () => pm.response.to.have.status(429));
     ```
   - Case cần **lặp N request** (rate limit): tạo **một** request, chạy bằng Collection Runner với `iterations = N+1`, thay vì tạo N request trùng nhau. Pattern đếm đã dùng được:
     ```js
     // pre-request
     if (pm.info.iteration === 0) pm.collectionVariables.set('rl_count', 0);
     // test
     const LIMIT = 20;
     const n = Number(pm.collectionVariables.get('rl_count') || 0) + 1;
     pm.collectionVariables.set('rl_count', n);
     if (n <= LIMIT) pm.test(`#${n} <= ${LIMIT} -> khong 429`, () => pm.expect(pm.response.code).to.not.eql(429));
     else pm.test(`#${n} > ${LIMIT} -> 429`, () => pm.response.to.have.status(429));
     ```
     Assert **"không phải 429"** cho các request dưới ngưỡng, không assert `200` — body trong collection thường là placeholder tối giản nên `422` trước ngưỡng là bình thường (throttle chạy ở middleware, trước validation). Nói rõ điều này trong `description`.
   - Cần **xoay identity mỗi request** (test bypass): dùng `pm.sendRequest` trong pre-request để lấy giá trị mới rồi `pm.variables.set`.

4. Nếu data bổ sung xuất hiện sau khi đã tạo collection (vd người dùng đặt order xong), cập nhật lại `collection.variable` bằng `mcp__postman__patchCollection` / `putCollection` — không bảo người dùng tự điền.

### Bước 5b — Không tạo được collection thì viết script theo task

Dùng khi Postman không tạo được collection qua cả MCP lẫn REST API: không kết nối, lỗi xác thực, hết quota, hoặc gọi tạo vẫn lỗi sau một lần thử lại. Không bỏ qua case API, không nhờ người dùng tự tạo collection, không lưu collection JSON vào repo.

1. Viết **một file cho một task**: `tests/api/<KEY>.spec.ts`. Không gộp nhiều task vào một file.
2. Dùng helper `tests/api/_lib.ts`: `api('<TÊN_BIẾN_TOKEN>', '<TÊN_BIẾN_BASE_URL>')`, `env()`, `runData('<KEY>')`. Base mặc định `QA_API_BASE`. Bỏ tên biến token để gọi không có `Authorization`.
3. Mỗi case một `test()`, tên bắt đầu bằng mã case (`TC-PROJ-1234: ...`), assert đủ các vế của expected result.
4. Repo có thể public: token chỉ gọi qua tên biến `.env`; id lấy từ `runs/<KEY>/data.json`, không ghi cứng token, id tài khoản, tên môi trường.
5. Kiểm tra script nạp được: `npx playwright test --project=api tests/api/<KEY>.spec.ts --list`. Bước này không gọi API; execute mới chạy thật.
6. Thêm khối `api_script` vào `data.json`: `{ "path": "tests/api/<KEY>.spec.ts", "cases": ["TC-PROJ-1234"], "reason": "<vì sao không tạo được collection>" }`. Agent execute chạy theo khối này.

### Bước 6 — Verify và ghi lại

- Data UI: tin vào **báo cáo verify của agent** `qa-test-data` (agent tự verify bằng cách mở lại item). Nếu agent báo fail hoặc dở dang → báo fail thẳng, **không** kết luận là đã tạo xong.
- Postman: đọc lại collection vừa tạo (`mcp__postman__getCollection`) xác nhận đủ folder/request rồi mới báo cáo.
- Script API: lệnh `--list` ở Bước 5b hiện đủ các case rồi mới báo cáo.
- Agent `qa-test-data` tự ghi `runs/<KEY>/ledger.md` + `runs/<KEY>/data.json`. Skill này **không ghi trùng** vào ledger; chỉ thêm khối `postman` (collection id, tên biến) hoặc `api_script` vào `data.json`.

## Guardrails

- **Chỉ staging.** Mọi data tạo ra nằm trên môi trường staging theo guide và `.env`. Không đụng production.
- **Không tự xoá data.** Chỉ xoá khi người dùng yêu cầu rõ, và chỉ item có trong ledger.
- **Token staging lấy từ `.env` được gắn thẳng vào collection** khi workspace không có member khác. Workspace có member khác hoặc chưa rõ → hỏi người dùng trước khi gắn token. Chỉ dùng token **staging**, không bao giờ token production; không đưa password đăng nhập, session cookie hay `POSTMAN_API_KEY` vào Postman; không in giá trị token ra chat.
- **Không sửa data có sẵn** để "tiện" — luôn tạo mới.
- **Không tự chạy load test / hammer endpoint** trong lúc setup. Skill này chỉ *tạo* collection để QA chạy tay; việc bắn N request là bước execute, không phải bước setup.
- **Không bịa data requirement.** Test case không nói rõ cấu hình → lấy theo `analysis.md`; vẫn không rõ thì chọn cấu hình tối giản và ghi Assumption. Chỉ đưa vào **Blocked / cần người khác làm** khi đã tra catalog + guide + `<knowledge>/_flows/troubleshooting.md` mà vẫn không dựng được (proxy/CDN, log server, branch chưa deploy, config server), và báo người dùng.
- **Không tạo/sửa issue Jira.** Skill chỉ đọc Jira.
- Việc deploy branch, chạy migration, đổi config server **không** thuộc skill này — chỉ liệt kê ra như điều kiện tiên quyết.

## Output cuối

Trả về trong chat, gọn:

```
## Test Data cho <TASK> — <title issue>

### 1. Data requirement rút ra từ test case
Bảng: item cần → phục vụ TC nào → vì sao.

### 2. Data đã tạo trên staging
Bảng: Item | Loại | ID | URL | Trạng thái | Phục vụ TC

### 3. Postman
Collection name + ID, số request, danh sách biến collection (chỉ tên, không in giá trị token) và biến nào còn rỗng + lý do.
(Hoặc: đường dẫn script `tests/api/<KEY>.spec.ts`, số case và lý do không tạo được collection.)
(Hoặc: "Không cần — issue thuần UI", kèm lý do.)

### 4. Điều kiện tiên quyết chưa sẵn sàng
Branch chưa deploy, migration chưa chạy, thiếu tài khoản thứ 2, cần log access…

### 5. Blocked / không tự tạo được
Nêu rõ case nào không chạy được cho tới khi có gì.

### 6. Assumptions
Những chỗ tự quyết (cấu hình, số lượng, để nháp hay công khai…).
```

Cuối cùng nhắc người dùng: data đã sẵn sàng cho những test case nào, và test case nào vẫn còn blocked.

## Ghi mốc thời gian

Biết issue key: `python3 scripts/issue_timing.py start <KEY> data` trước khi bắt đầu, `... end <KEY> data` khi xong. Gọi từ `qa-issue-run` thì skill điều phối đã ghi, không ghi trùng.
