import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = readFileSync(
  resolve(ROOT, "scripts", "site-assets", "mermaid-init.js"),
  "utf8",
);
const CSS = readFileSync(
  resolve(ROOT, "scripts", "site-assets", "site.css"),
  "utf8",
);

async function settle() {
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
}

function page(render) {
  const dom = new JSDOM(
    '<main><pre class="mermaid-diagram">flowchart TD\nA-->B</pre></main>',
    {
      runScripts: "outside-only",
      url: "https://docs.example.test/",
    },
  );
  const { window } = dom;
  window.console.error = () => {};
  window.HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute("open", "");
  };
  window.HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute("open");
    this.dispatchEvent(new window.Event("close"));
  };
  const initialized = [];
  window.mermaid = {
    initialize: (configuration) => initialized.push(configuration),
    render,
  };
  window.eval(SCRIPT);
  window.document.dispatchEvent(new window.Event("DOMContentLoaded"));
  return { dom, window, initialized };
}

test("rendered diagrams keep viewer controls outside the horizontal scrollport", async (t) => {
  const fixture = page(async () => ({
    svg: '<svg viewBox="0 0 1200 600"><a href="#target"><text>diagram</text></a></svg>',
  }));
  t.after(() => fixture.dom.window.close());
  await settle();

  assert.deepEqual(JSON.parse(JSON.stringify(fixture.initialized[0])), {
    startOnLoad: false,
    flowchart: { useMaxWidth: false },
    sequence: { useMaxWidth: false },
  });
  const diagram = fixture.window.document.querySelector(".mermaid-diagram");
  const frame = diagram.parentElement;
  const button = frame.querySelector(":scope > .o4-mermaid-viewer-button");
  assert.equal(diagram.getAttribute("tabindex"), "0");
  assert.equal(frame.className, "o4-mermaid-frame");
  assert.ok(button);
  assert.equal(diagram.contains(button), false);
  assert.equal(button.previousElementSibling, diagram);

  diagram
    .querySelector("svg")
    .dispatchEvent(new fixture.window.MouseEvent("click", { bubbles: true }));
  assert.equal(fixture.window.document.querySelector("dialog"), null);
  button.focus();
  button.click();

  const dialog = fixture.window.document.querySelector("dialog");
  assert.ok(dialog.hasAttribute("open"));
  const dialogSvg = dialog.querySelector("svg");
  assert.equal(dialogSvg.style.width, "1200px");
  dialog.querySelector('[data-action="zoom-in"]').click();
  assert.equal(dialogSvg.style.width, "1500px");
  dialog.querySelector('[data-action="reset"]').click();
  assert.equal(dialogSvg.style.width, "1200px");

  dialog.dispatchEvent(
    new fixture.window.KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
    }),
  );
  assert.equal(dialog.hasAttribute("open"), false);
  assert.equal(fixture.window.document.activeElement, button);
});

test("render failure restores source and never offers an invalid viewer", async (t) => {
  const fixture = page(async () => {
    throw new Error("bad graph");
  });
  t.after(() => fixture.dom.window.close());
  await settle();

  const diagram = fixture.window.document.querySelector(".mermaid-diagram");
  assert.match(diagram.textContent, /flowchart TD/);
  assert.equal(diagram.hasAttribute("data-o4-rendered"), false);
  assert.equal(diagram.querySelector(".o4-mermaid-viewer-button"), null);
});

test("site CSS provides bounded scrolling, viewer controls, print fallback and reduced motion", () => {
  assert.match(CSS, /\.mermaid-diagram\s*\{[\s\S]*overflow-x:\s*auto/);
  assert.match(CSS, /\.mermaid-diagram\s*>\s*svg[\s\S]*max-width:\s*none/);
  assert.match(CSS, /\.o4-mermaid-dialog/);
  assert.match(CSS, /@media print[\s\S]*\.mermaid-diagram/);
  assert.match(CSS, /@media \(prefers-reduced-motion: reduce\)/);
});
