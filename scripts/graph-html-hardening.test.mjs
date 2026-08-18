import assert from "node:assert/strict";
import test from "node:test";

import {
  VENDORED_GRAPH_LIBRARIES,
  hardenGraphHtml,
  requiredGraphLibraries,
} from "./graph-html-hardening.mjs";

const drillPage = (src) =>
  `<!doctype html><meta charset="utf-8"><title>graph</title>` +
  `<script src="${src}"></script><div id="net"></div>`;

test("rewrites the pinned vis-network CDN reference to a site-local copy", () => {
  const html = drillPage(
    "https://unpkg.com/vis-network@9.1.6/standalone/umd/vis-network.min.js",
  );
  const { html: hardened, rewritten } = hardenGraphHtml(html, "../../assets/");

  assert.deepEqual(rewritten, ["vis-network"]);
  assert.match(hardened, /src="\.\.\/\.\.\/assets\/vis-network\.min\.js"/u);
  assert.doesNotMatch(hardened, /unpkg\.com/u);
});

test("rewrites other vis-network versions instead of silently passing them", () => {
  // Graphify 升版換掉版本號時,改寫器必須接手;漏掉一條就等於站上多一個外連。
  const html = drillPage(
    "https://unpkg.com/vis-network@10.0.0/standalone/umd/vis-network.min.js",
  );
  const { html: hardened } = hardenGraphHtml(html, "assets/");
  assert.match(hardened, /src="assets\/vis-network\.min\.js"/u);
});

test("fails closed on an unknown external reference", () => {
  const html = drillPage("https://cdn.example.test/unknown-graph-lib.js");
  assert.throws(
    () => hardenGraphHtml(html, "../../assets/"),
    /still references external assets/u,
  );
});

test("fails closed on protocol-relative and stylesheet references", () => {
  for (const html of [
    drillPage("//cdn.example.test/lib.js"),
    `<link rel="stylesheet" href="https://fonts.example.test/x.css">`,
  ])
    assert.throws(
      () => hardenGraphHtml(html, "assets/"),
      /still references external assets/u,
    );
});

test("leaves in-page and relative references untouched", () => {
  const html =
    `<a href="#node-3">anchor</a><a href="./c1.html">next</a>` +
    `<script src="../../assets/vis-network.min.js"></script>`;
  const { html: hardened, rewritten } = hardenGraphHtml(html, "../../assets/");
  assert.equal(hardened, html);
  assert.deepEqual(rewritten, []);
});

test("reports which vendored libraries a page needs", () => {
  const needing = drillPage(
    "https://unpkg.com/vis-network@9.1.6/standalone/umd/vis-network.min.js",
  );
  assert.deepEqual(requiredGraphLibraries(needing), ["vis-network"]);
  assert.deepEqual(requiredGraphLibraries("<p>no scripts</p>"), []);
});

test("每個自架函式庫都宣告站台資產名與 node_modules 來源路徑", () => {
  for (const library of VENDORED_GRAPH_LIBRARIES) {
    assert.match(library.asset, /^[\w.-]+\.js$/u);
    assert.ok(library.modulePath.length >= 2);
    assert.equal(library.modulePath.at(-1), library.asset);
  }
});
