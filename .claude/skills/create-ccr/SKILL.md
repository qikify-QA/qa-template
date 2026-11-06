---
name: create-ccr
description: "Tạo một (hoặc nhiều) Context Change Request (CCR) hoàn chỉnh từ một/nhiều ticket Jira đã ship (hoặc mô tả thay đổi tự do), để gửi cho một QA context-builder agent (vd `qa-context-lifecycle-orchestrator`) cập nhật QA context (KB, checklist, guide, flow, trả lời open question) của một product bất kỳ. Dùng khi người dùng nói \"tạo CCR\", \"viết CCR từ ticket này\", \"context change request cho...\", \"canon context bị cũ/thiếu do ticket X/Y/Z đã ship\", \"gửi update context cho object...\", \"trả lời open question\", \"cập nhật flow/guide\", hoặc dán vào 1-nhiều key/link Jira kèm yêu cầu đưa vào QA context. Mục tiêu cốt lõi: CCR sinh ra phải đủ chi tiết để agent nhận CCR KHÔNG CẦN mở lại Jira để đọc/phân tích, và phải nêu rõ ràng cần explore surface nào, thay đổi gì, ảnh hưởng tới object/feature/checklist nào. Skill chỉ ĐỌC Jira (không tạo/sửa/comment issue nào) và chỉ tạo ra file CCR cục bộ — không tự submit lên bất kỳ hệ thống nào."
---

# Create CCR (Context Change Request)

Soạn file CCR để context builder cập nhật knowledge mà không cần mở lại Jira. Skill chỉ soạn file: không submit, không ghi Jira, không tự chọn phía khi mâu thuẫn với canon.

## Chọn khối

Khuôn: `references/ccr-template.md`, luôn dùng cho mọi product. Phần đầu luôn có. Chỉ giữ khối có dùng, xoá hẳn khối còn lại. Nhiều loại thì để các khối nối tiếp nhau, không gộp mục.

| Khối | Dùng khi | Đích |
|---|---|---|
| A. Hành vi | BR, hành vi mới hoặc đổi, config của một feature | KB, checklist |
| B. Môi trường | Feature khác giữa staging và production | `environment_differences` |
| C. Guide, flow | Thao tác, setup mức product, biến env, cách gỡ block | `_product-guide.md`, `_flows/`, `_env.example` |
| D. Trả lời open question | Có đáp án cho một `OQ-ID` | KB, `open-questions.md` |

Định nghĩa guide và flow: contract §5c. CCR chỉ thuộc một product; thông tin không liên quan nhau và đang gấp thì tách file.

## Quy trình

1. **Tìm repo đích:** `knowledge/products/<product>/` hoặc `products/<product>/`, phụ lục `contracts/ccr-product-appendix.md` hoặc `how-to-request/ccr-product-appendix.md`. Không tra được canon thì ghi rõ, không bịa. Báo đã dùng phụ lục nào.
2. **Đọc input:** ticket người dùng chỉ định (đủ comment), bản phân tích (`runs/<KEY>/analysis.md` mục 15 nếu có), hoặc mô tả trực tiếp. Không tự quét Jira tìm thêm ticket. Tìm test case đã PASS đúng hành vi nếu có tool.
3. **Tra canon:** tìm `kb_id`, feature, `OQ-ID` liên quan trong repo đích. Đã có và giống hệt thì bỏ. Mọi nội dung đều đã có và không còn gì để ghi thì không tạo file, báo `not-needed` kèm danh sách `kb_id`. Khác thì ghi `SUPERSEDES` hoặc `CONTRADICTS` kèm `kb_id`. Khối C thì đối chiếu file hiện có, chỉ ghi phần khác, và tránh ghi thông tin đã có ở nơi khác.
4. **Điền khối đang dùng.** Claim ID `CLAIM-01`, `CLAIM-02`… liên tục qua khối A, B, D.
5. **Hỏi người dùng** những gì skill không tự biết: mức gấp, người xác nhận nếu nguồn không ghi, chỗ "không rõ". Args có `workflow` thì không hỏi: dùng giá trị workflow truyền vào, chỗ chưa biết ghi "không rõ", và nêu các lựa chọn này trong báo cáo.
6. **Tự kiểm rồi ghi file** `CCR-<YYYY-MM-DD>-<slug>.md`. Báo đường dẫn, các khối đã dùng, số claim.

## Luật điền

- **Nguồn (khối A, D):** ghi đúng 1 loại. Có cả câu trả lời PO/Dev và test case thì chọn `po_dev_confirm`, ghi test case ở Locator. `po_dev_confirm`: PO, Dev hoặc QA là người thật xác nhận trực tiếp, kèm trích nguyên văn và ngày; lời tóm tắt của agent không tính. `test_case`: id, PASS, ngày chạy, build, kèm **căn cứ expected** (ticket, comment, spec, câu trả lời PO/Dev mà expected dựa vào). Expected do QA hoặc agent tự suy ra thì ghi "KHÔNG CÓ". `dev_doc`, `spec_doc`: tên, version, ngày, mục. Còn lại là `KHÔNG CÓ NGUỒN`: claim không nạp vào KB, trừ claim khối B.
- **Trích nguyên văn** là câu gốc, không diễn giải: sau khi publish chỉ nội dung trong CCR còn lại.
- **Ngày nguồn** là ngày viết hoặc ngày comment, không phải ngày resolve ticket. Không rõ thì ghi "không rõ".
- **Comment kỹ thuật** như "Ready to test", "Resolution: Done" không phải xác nhận.
- **Key mới:** không bịa `object_key`, `feature_key`. Chưa có thì `MỚI: <slug>` kèm phạm vi.
- **Khối D:** câu trả lời mô tả hành vi thì chọn `XÁC NHẬN HÀNH VI`; OQ loại CONFLICT thì chọn một phía; câu hỏi hết ý nghĩa thì `KHÔNG CÒN ÁP DỤNG` kèm lý do.

## Tự kiểm

- Không còn `<<<` và không còn khối không dùng.
- Claim ID không trùng, dòng "Các khối có trong file" đúng thực tế.
- Không có email, token, password, giá trị secret. Khối C không có id account, id instance, tên store.

## Rào chắn

- Chỉ đọc Jira, không dùng tool ghi.
- Không tự submit. Người dùng đính file vào task rồi Submit, hoặc tạo trên board; rồi kéo Proposal sang `In Progress`.
- Không tự chọn phía khi mâu thuẫn với canon: ghi `CONTRADICTS` kèm `kb_id`.
