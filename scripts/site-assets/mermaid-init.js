// 站上 Mermaid 圖的渲染入口——完全自己負責，不經由 Material 主題的內建路徑。
//
// 為什麼不用 Material 內建：它的 bundle 只在 window.mermaid 未定義時才去抓 unpkg 的
// mermaid，而 MkDocs 把 extra_javascript 排在主題 bundle 之後，判斷當下自架那份還沒
// 載入，於是走了 CDN——離線或 file:// 開檔就渲染不出來。更麻煩的是它會認領
// class="mermaid" 的元素並改寫結構，與自架流程搶同一批節點，兩邊都只拿到中間狀態、
// 產出 aria-roledescription="error" 的空圖。
//
// 因此 fence 改吐 class="mermaid-diagram"（Material 不認得），由這裡獨佔渲染。
// 圖的主題由各圖自身內嵌的 %%{init: ...}%% 指令決定（見 流程.md 的圖表風格規範），
// 這裡不設 theme，只關掉 startOnLoad 以免與下面的顯式呼叫重複。
(function () {
  "use strict";

  var SELECTOR = ".mermaid-diagram:not([data-o4-rendered])";
  var seq = 0;

  function cleanupDialogs() {
    Array.prototype.forEach.call(
      document.querySelectorAll(".o4-mermaid-dialog"),
      function (dialog) {
        dialog.remove();
      },
    );
  }

  function control(action, label) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "o4-mermaid-dialog__control";
    button.setAttribute("data-action", action);
    button.textContent = label;
    return button;
  }

  function openViewer(opener, sourceSvg) {
    var dialog = document.createElement("dialog");
    dialog.className = "o4-mermaid-dialog";
    dialog.setAttribute("aria-label", "Mermaid 圖表放大檢視器");

    var toolbar = document.createElement("div");
    toolbar.className = "o4-mermaid-dialog__toolbar";
    var zoomOut = control("zoom-out", "縮小");
    var reset = control("reset", "重設");
    var zoomIn = control("zoom-in", "放大");
    var close = control("close", "關閉");
    toolbar.append(zoomOut, reset, zoomIn, close);

    var viewport = document.createElement("div");
    viewport.className = "o4-mermaid-dialog__viewport";
    var svg = sourceSvg.cloneNode(true);
    viewport.appendChild(svg);
    dialog.append(toolbar, viewport);
    document.body.appendChild(dialog);

    var viewBox = (svg.getAttribute("viewBox") || "")
      .trim()
      .split(/\s+/)
      .map(Number);
    var baseWidth =
      Number.isFinite(viewBox[2]) && viewBox[2] > 0 ? viewBox[2] : 1200;
    var baseHeight =
      Number.isFinite(viewBox[3]) && viewBox[3] > 0 ? viewBox[3] : 675;
    var scale = 1;
    function applyScale() {
      svg.style.width = baseWidth * scale + "px";
      svg.style.height = baseHeight * scale + "px";
    }
    function closeViewer() {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    }
    function focusableControls() {
      return Array.prototype.slice.call(
        dialog.querySelectorAll("button:not([disabled])"),
      );
    }

    zoomOut.addEventListener("click", function () {
      scale = Math.max(0.5, scale - 0.25);
      applyScale();
    });
    reset.addEventListener("click", function () {
      scale = 1;
      applyScale();
      viewport.scrollTo?.(0, 0);
    });
    zoomIn.addEventListener("click", function () {
      scale = Math.min(3, scale + 0.25);
      applyScale();
    });
    close.addEventListener("click", closeViewer);
    dialog.addEventListener("click", function (event) {
      if (event.target === dialog) closeViewer();
    });
    dialog.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeViewer();
        return;
      }
      if (event.key !== "Tab") return;
      var controls = focusableControls();
      if (!controls.length) return;
      var first = controls[0];
      var last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
    dialog.addEventListener("close", function () {
      opener.focus();
    });

    applyScale();
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    close.focus();
  }

  function decorate(el, result) {
    var svg = el.querySelector("svg");
    if (!svg || !el.parentNode) return;
    el.tabIndex = 0;
    el.setAttribute("role", "region");
    el.setAttribute("aria-label", "可水平捲動的 Mermaid 圖表");
    var frame = document.createElement("div");
    frame.className = "o4-mermaid-frame";
    el.parentNode.insertBefore(frame, el);
    frame.appendChild(el);
    var button = document.createElement("button");
    button.type = "button";
    button.className = "o4-mermaid-viewer-button";
    button.textContent = "放大查看";
    button.addEventListener("click", function () {
      openViewer(button, svg);
    });
    frame.appendChild(button);
    if (typeof result.bindFunctions === "function") result.bindFunctions(el);
  }

  function render() {
    cleanupDialogs();
    if (!window.mermaid || typeof window.mermaid.render !== "function") return;
    var blocks = document.querySelectorAll(SELECTOR);
    if (!blocks.length) return;

    try {
      window.mermaid.initialize({
        startOnLoad: false,
        flowchart: { useMaxWidth: false },
        sequence: { useMaxWidth: false },
      });
    } catch (err) {
      console.error("mermaid initialize failed:", err);
      return;
    }

    Array.prototype.forEach.call(blocks, function (el) {
      // 先取原始碼再動 DOM：渲染失敗時要能把原文放回去，不能讓圖變成空白。
      var source = el.textContent;
      var id = "o4-mermaid-" + seq++;
      el.setAttribute("data-o4-rendered", "true");
      window.mermaid
        .render(id, source)
        .then(function (result) {
          el.innerHTML = result.svg;
          decorate(el, result);
        })
        .catch(function (err) {
          // 單張圖失敗不應吃掉整頁；保留原始碼供人辨讀，並在 console 指名是哪一張。
          console.error("mermaid render failed:", err);
          el.textContent = source;
          el.removeAttribute("data-o4-rendered");
        })
        .then(function () {
          // mermaid 會在 body 尾端建一個 id 為 'd'+id 的暫存容器做尺寸量測，成功時自行
          // 移除、失敗時留在原地——那正是頁尾那塊突兀的「Syntax error in text」。
          // 內容區已經有還原的原始碼，殘骸只會誤導讀者，一律清掉。
          var leftover = document.getElementById("d" + id);
          if (leftover && leftover.parentNode)
            leftover.parentNode.removeChild(leftover);
        });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", render);
  } else {
    render();
  }
  if (window.document$ && typeof window.document$.subscribe === "function") {
    window.document$.subscribe(render);
  }
})();
