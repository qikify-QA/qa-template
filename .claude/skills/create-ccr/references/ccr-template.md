# Context Change Request: <<< tiêu đề ngắn >>>

<!-- Giữ phần đầu. Chỉ giữ khối có dùng, xoá hẳn khối không dùng. Nhiều loại thì để các khối nối tiếp nhau, không gộp mục. Claim ID đánh số liên tục qua khối A, B, D. -->

- **Product:** `<<< product_key >>>`
- **Object:** `<<< object_key, hoặc nhiều object cách nhau bởi dấu phẩy >>>`
- **Ticket:** `<<< key, hoặc "không có" >>>`
- **Các khối có trong file:** `<<< A, B, C, D >>>`

## Mức độ gấp

`<<< HIGH | MEDIUM | LOW >>>` — `<<< lý do ngắn >>>`

- `HIGH`: đang chặn test, hoặc checklist đang publish có thể chạy sai. `MEDIUM`: ảnh hưởng coverage. `LOW`: dọn canon.

# Khối A — Hành vi

BR, hành vi mới hoặc đổi. Một block cho mỗi claim.

### CLAIM-01

- **Statement:** `<<< một câu hoàn chỉnh, hiện trạng hoặc hành vi đúng >>>`
- **Object / feature:** `<<< object/feature; chưa có thì "MỚI: <slug>" kèm phạm vi Thuộc / Không thuộc >>>`
- **Quan hệ với canon:** `<<< ADD | SUPERSEDES <kb_id> | CONTRADICTS <kb_id> | UNKNOWN >>>`
- **Scope:** `<<< role, surface >>>`
- **Đã ship:** `<<< SHIPPED | NOT_SHIPPED | UNKNOWN >>>`
- **Loại nguồn:** `<<< po_dev_confirm | test_case | dev_doc | spec_doc | KHÔNG CÓ NGUỒN >>>`
- **Người xác nhận, ngày nguồn:** `<<< PO | Dev | QA, YYYY-MM-DD >>>`
- **Locator:** `<<< comment, TC, PR, link nếu có >>>`
- **Căn cứ expected:** `<<< chỉ khi nguồn là test_case: ticket, comment, spec hoặc câu trả lời PO/Dev mà expected của case dựa vào; không có thì "KHÔNG CÓ" >>>`
- **Trích nguyên văn:**
  ```
  <<< câu gốc, không diễn giải >>>
  ```

# Khối B — Môi trường

Feature hoạt động hoặc cách test khác giữa staging và production.

| Claim ID | Feature | `type` | Staging | Production | Cách test trên staging | Người, ngày |
|---|---|---|---|---|---|---|
| `CLAIM-02` | `<<< object/feature >>>` | `<<< NOT_TESTABLE, ALTERNATIVE_SETUP, DIFFERENT_VALUE >>>` | `<<< ĐIỀN >>>` | `<<< ĐIỀN hoặc "không rõ" >>>` | `<<< ĐIỀN hoặc "không test được" >>>` | `<<< ĐIỀN >>>` |

# Khối C — Guide, flow

Chọn file theo câu nó trả lời: "có gì, ở đâu, test được không" vào guide, "làm thế nào" vào flow. Chỉ ghi tên biến env, không ghi giá trị, id account, id instance, tên store.

| File | Hành động | Nội dung | Lý do |
|---|---|---|---|
| `<<< _product-guide.md mục n, _flows/<chủ đề>.md, _env.example >>>` | `<<< thêm, sửa, xoá đoạn >>>` | `<<< nội dung đầy đủ; sửa thì ghi cả đoạn cũ >>>` | `<<< vd: UI đổi, <KEY> >>>` |

# Khối D — Trả lời open question

Một block cho mỗi câu.

### CLAIM-03

- **OQ-ID:** `<<< OQ-<object>-<nnn> >>>`
- **Kết quả:** `<<< XÁC NHẬN HÀNH VI | CHỌN side_a | CHỌN side_b | KHÔNG CÒN ÁP DỤNG >>>`
- **Trả lời:** `<<< statement, hoặc lý do không còn áp dụng >>>`
- **Người trả lời, ngày:** `<<< PO | Dev | QA, YYYY-MM-DD >>>`
- **Trích nguyên văn:**
  ```
  <<< câu gốc >>>
  ```
