// 產生審查用縮圖頁；標籤只存在審查頁，不寫入正式圖像。
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const workspace = path.resolve(__dirname, "../../../..");
const { chromium } = require(
  path.join(workspace, "open-4wd/node_modules/@playwright/test"),
);
const output =
  process.env.SEASONAL_VALIDATION_DIR ||
  path.join(workspace, "open-4wd-specs/.playwright-output/seasonal-2026");
(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.CHROMIUM_EXECUTABLE }
      : {}),
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1200, height: 820 },
    });
    for (const season of ["halloween", "christmas"]) {
      const source = path.join(
        workspace,
        "open-4wd-specs/release-input/ui/race-messages",
        season,
      );
      const files = fs
        .readdirSync(source)
        .filter((name) => name.endsWith(".png"))
        .sort();
      for (let start = 0; start < files.length; start += 24) {
        const cards = files
          .slice(start, start + 24)
          .map(
            (file) =>
              `<article><div><img src="${pathToFileURL(path.join(source, file))}" width="136" height="136"><img src="${pathToFileURL(path.join(source, file))}" width="64" height="64"></div><p>${file.slice(0, -4)}</p></article>`,
          )
          .join("");
        const html = `<html><meta charset="utf-8"><style>body{margin:16px;background:#e7e5df;font:14px system-ui}main{display:grid;grid-template-columns:repeat(6,1fr);gap:8px}article{background:#fff;padding:5px;text-align:center;border-radius:8px}article div{height:160px;position:relative}img{object-fit:contain}img+img{position:absolute;right:0;bottom:0;background:#292332;border-radius:5px}p{margin:4px}h1{font-size:18px;margin:0 0 10px}</style><h1>${season} — ${start + 1}–${Math.min(start + 24, files.length)} / ${files.length} — 136px / 64px</h1><main>${cards}</main></html>`;
        const file = path.join(output, `${season}-messages-${start}.html`);
        fs.writeFileSync(file, html);
        await page.goto(pathToFileURL(file).href);
        await page.evaluate(async () => {
          await Promise.all(
            [...document.images].map((image) => image.decode()),
          );
        });
        await page.screenshot({
          path: file.replace(".html", ".png"),
          fullPage: true,
        });
      }
      console.log(`${season}: ${files.length} source images in review sheets`);
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
