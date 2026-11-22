const fs = require("node:fs"),
  path = require("node:path"),
  http = require("node:http");
const root = path.resolve(__dirname, "../../../.."),
  app = path.join(root, "open-4wd"),
  dist =
    process.env.SEASONAL_BROWSER_DIST ||
    path.join(app, "dist/open-4wd/browser");
const { chromium, expect } = require(
  path.join(app, "node_modules/@playwright/test"),
);
const { navigateInApp, createUnlockedPlayer } = require(
  path.join(app, "e2e/player-session.ts"),
);
const ids = JSON.parse(
  fs.readFileSync(path.join(__dirname, "themes.json"), "utf8"),
);
const mime = {
  ".js": "text/javascript",
  ".css": "text/css",
  ".html": "text/html",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".glb": "model/gltf-binary",
};
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  let relative;
  try {
    relative = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (relative.split("/").includes("..")) {
    res.writeHead(403).end();
    return;
  }
  const themeAsset = /^assets\/(themes|race-message-packs)\//.test(relative);
  let file = path.join(themeAsset ? path.join(app, "public") : dist, relative);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    if (path.extname(relative)) {
      res.writeHead(404).end();
      return;
    }
    file = path.join(dist, "index.html");
  }
  res.setHeader(
    "Content-Type",
    mime[path.extname(file)] || "application/octet-stream",
  );
  res.setHeader("Cache-Control", "no-store");
  fs.createReadStream(file).pipe(res);
});
(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const baseURL = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.CHROMIUM_EXECUTABLE }
      : {}),
  });
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  const failures = [],
    errors = [],
    results = [],
    assetChecks = [];
  await context.route("**/*", (route) => {
    const u = new URL(route.request().url());
    return ["127.0.0.1", "localhost"].includes(u.hostname) ||
      ["data:", "blob:"].includes(u.protocol)
      ? route.continue()
      : route.abort();
  });
  page.on("response", (r) => {
    if (
      r.status() >= 400 &&
      /\/assets\/(themes|race-message-packs)\//.test(r.url())
    )
      failures.push({ url: r.url(), status: r.status() });
  });
  page.on("pageerror", (e) => errors.push(e.message));
  const output = path.join(
    process.env.SEASONAL_VALIDATION_DIR ||
      path.join(root, "open-4wd-specs/.playwright-output/seasonal-2026"),
    "screenshots",
  );
  fs.mkdirSync(output, { recursive: true });
  try {
    await page.goto("zh-TW/settings/display?runtime=local");
    for (const [theme, id] of Object.entries(ids)) {
      await navigateInApp(page, "settings/display");
      const card = page.locator(`[data-theme-card][data-theme-id="${id}"]`);
      await expect(card).toBeVisible({ timeout: 60000 });
      await card.locator("input[data-theme-choice]").check();
      await expect(card.locator("[data-theme-current]")).toBeVisible({
        timeout: 60000,
      });
      for (const route of ["", "settings/display", "about", "help"])
        for (const [width, height] of [
          [1440, 900],
          [390, 844],
          [320, 700],
          [844, 390],
        ]) {
          await page.setViewportSize({ width, height });
          await navigateInApp(page, route || "/");
          await page.evaluate(async () => {
            scrollTo(0, 0);
            await document.fonts.ready;
            await new Promise((r) =>
              requestAnimationFrame(() => requestAnimationFrame(r)),
            );
          });
          await page.screenshot({
            path: path.join(
              output,
              `${theme}-${route.replace(/[^a-z0-9-]/gi, "-") || "landing"}-${width}x${height}.png`,
            ),
            fullPage: true,
            animations: "disabled",
          });
          results.push({
            theme,
            route,
            width,
            height,
            ...(await page.evaluate(() => ({
              overflow: document.documentElement.scrollWidth > innerWidth,
              scrollWidth: document.documentElement.scrollWidth,
              images: [...document.images]
                .filter((i) => i.currentSrc.includes("/assets/themes/"))
                .map((i) => ({
                  src: i.currentSrc,
                  loaded: i.complete && i.naturalWidth > 0,
                })),
              marker:
                getComputedStyle(
                  document.querySelector("o4-root"),
                ).getPropertyValue("--theme-christmas-style-ready") ||
                getComputedStyle(
                  document.querySelector("o4-root"),
                ).getPropertyValue("--theme-halloween-style-ready"),
            }))),
          });
        }
    }
    if (process.argv.includes("--player")) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await createUnlockedPlayer(page, {
        displayName: "Seasonal UI",
        runtime: "local",
      });
      for (const [theme, id] of Object.entries(ids)) {
        await navigateInApp(page, "settings/display");
        const card = page.locator(`[data-theme-card][data-theme-id="${id}"]`);
        await card.locator("input[data-theme-choice]").check();
        await expect(card.locator("[data-theme-current]")).toBeVisible({
          timeout: 60000,
        });
        for (const route of [
          "home",
          "garage",
          "garage/edit/local-test",
          "race-config",
          "ugc",
          "inbox?tab=dmca",
          "settings/gameplay",
          "settings/network",
          "settings/privacy",
          "settings/maintenance",
          "settings/account",
          "editor",
        ])
          for (const [width, height] of [
            [1440, 900],
            [320, 700],
            [844, 390],
          ]) {
            await page.setViewportSize({ width, height });
            await navigateInApp(page, route);
            await page.evaluate(async () => {
              scrollTo(0, 0);
              await document.fonts.ready;
              await new Promise((r) =>
                requestAnimationFrame(() => requestAnimationFrame(r)),
              );
            });
            await page.screenshot({
              path: path.join(
                output,
                `${theme}-${route.replace(/[^a-z0-9-]/gi, "-")}-${width}x${height}.png`,
              ),
              fullPage: true,
              animations: "disabled",
            });
            results.push({
              theme,
              route,
              width,
              height,
              ...(await page.evaluate(() => ({
                overflow: document.documentElement.scrollWidth > innerWidth,
                scrollWidth: document.documentElement.scrollWidth,
                images: [...document.images]
                  .filter((i) => i.currentSrc.includes("/assets/themes/"))
                  .map((i) => ({
                    src: i.currentSrc,
                    loaded: i.complete && i.naturalWidth > 0,
                  })),
              }))),
            });
          }
      }
    }
    if (process.argv.includes("--player")) {
      for (const pack of ["halloween", "christmas"]) {
        await page.setViewportSize({ width: 390, height: 844 });
        await navigateInApp(page, "settings/gameplay");
        await page.locator("#settings-race-message-pack-0").selectOption(pack);
        const preview = page.locator('[data-race-message-slot="0"] img');
        await expect(preview).toHaveAttribute(
          "src",
          new RegExp("race-message-packs/" + pack + "/"),
        );
        await preview.evaluate((image) => image.decode());
        await navigateInApp(page, "settings/display");
        const otherTheme = page.locator(`[data-theme-card][data-theme-id="${ids[pack]}"]`);
        await otherTheme.locator("input[data-theme-choice]").check();
        await expect(otherTheme.locator("[data-theme-current]")).toBeVisible();
        await navigateInApp(page, "settings/gameplay");
        await expect(page.locator("#settings-race-message-pack-0")).toHaveValue(
          pack,
        );
        await page
          .locator("[data-race-message-settings]")
          .screenshot({
            path: path.join(output, `${pack}-message-settings.png`),
          });
      }
    }
    for (const pack of ["halloween", "christmas"]) {
      const manifest = JSON.parse(
        fs.readFileSync(
          path.join(
            app,
            "public/assets/race-message-packs",
            pack,
            "manifest.json",
          ),
          "utf8",
        ),
      );
      const urls = manifest.assets.map(
        (asset) =>
          new URL(
            "assets/race-message-packs/" + pack + "/" + asset.path,
            baseURL,
          ).href,
      );
      assetChecks.push(
        ...(await page.evaluate(
          async (urls) =>
            Promise.all(
              urls.map(
                (src) =>
                  new Promise((resolve) => {
                    const image = new Image();
                    image.onload = () =>
                      resolve({
                        src,
                        loaded: true,
                        width: image.naturalWidth,
                        height: image.naturalHeight,
                      });
                    image.onerror = () => resolve({ src, loaded: false });
                    image.src = src;
                  }),
              ),
            ),
          urls,
        )),
      );
    }
    for (const id of Object.values(ids)) {
      const manifest = JSON.parse(
        fs.readFileSync(
          path.join(app, "public/assets/themes", id, "theme.json"),
          "utf8",
        ),
      );
      const urls = [...new Set(Object.values(manifest.assets))]
        .filter((v) => typeof v === "string" && /\.(svg|webp|png)$/.test(v))
        .map((v) => new URL("assets/themes/" + id + "/" + v, baseURL).href);
      assetChecks.push(
        ...(await page.evaluate(
          async (urls) =>
            Promise.all(
              urls.map(
                (src) =>
                  new Promise((resolve) => {
                    const image = new Image();
                    image.onload = () =>
                      resolve({
                        src,
                        loaded: true,
                        width: image.naturalWidth,
                        height: image.naturalHeight,
                      });
                    image.onerror = () => resolve({ src, loaded: false });
                    image.src = src;
                  }),
              ),
            ),
          urls,
        )),
      );
    }
  } catch (e) {
    errors.push(e.stack || String(e));
    await page.screenshot({
      path: path.join(output, "failure.png"),
      fullPage: true,
      animations: "disabled",
    });
  } finally {
    const result = {
      failures,
      errors,
      assetChecks,
      checks: results.length,
      overflows: results.filter((r) => r.overflow),
      brokenImages: [
        ...results.flatMap((r) => r.images.filter((i) => !i.loaded)),
        ...assetChecks.filter((i) => !i.loaded),
      ],
      results,
    };
    fs.writeFileSync(
      path.join(output, "../browser-result.json"),
      JSON.stringify(result, null, 2),
    );
    console.log(
      JSON.stringify({
        ...result,
        assetChecks: assetChecks.length,
        results: undefined,
      }),
    );
    await browser.close();
    server.close();
    if (
      failures.length ||
      errors.length ||
      result.overflows.length ||
      result.brokenImages.length
    )
      process.exitCode = 1;
  }
})().catch((e) => {
  console.error(e);
  server.close();
  process.exitCode = 1;
});
