/** Case mẫu: mở trang data: nên không cần mạng và không cần session. Chạy lại sau khi sửa lib.mjs. */
export const meta = { id: 'EXAMPLE-01', title: 'Bấm nút đổi nội dung trang' };

const HTML = `<!doctype html><meta charset="utf-8"><title>Demo</title>
<button id="go" onclick="setTimeout(() => document.querySelector('#out').textContent = 'Xong', 50)">Bấm</button>
<p id="out">Chưa bấm</p>`;

export default async ({ page, until, check, note, shot }) => {
  await page.goto(`data:text/html;charset=utf-8,${encodeURIComponent(HTML)}`);
  check('trang mở đúng tiêu đề', (await page.title()) === 'Demo');
  await page.locator('#go').click();
  const text = await until(async () => {
    const t = await page.locator('#out').textContent();
    return t === 'Xong' && t;
  }, { timeout: 5_000, interval: 50, message: 'nội dung đổi sau khi bấm' });
  check('nội dung đổi sau khi bấm', text === 'Xong', text);
  note('ảnh sau khi bấm:', await shot('after-click'));
};
