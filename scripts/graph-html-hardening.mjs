// Graphify 產生的互動圖頁寫死 CDN 引用（unpkg 的 vis-network），站台不接受任何外部資源：
// 讀者 IP 會外流、無 SRI 可驗、離線即失效——與自架 mermaid、停用 Google Fonts 同一立場
// （資安規範.md §5）。本模組把已知函式庫改寫為站內副本，並對任何未知外連 fail closed。

// 已知可自架的函式庫：來源樣式 → 站台資產檔名與 node_modules 內的來源路徑。
export const VENDORED_GRAPH_LIBRARIES = [
  {
    id: "vis-network",
    // 版本刻意寬鬆匹配：Graphify 升版時應由改寫器接手，而不是靜默漏掉一條外連。
    pattern:
      /https:\/\/unpkg\.com\/vis-network@[\w.-]+\/standalone\/umd\/vis-network\.min\.js/gu,
    asset: "vis-network.min.js",
    modulePath: ["vis-network", "standalone", "umd", "vis-network.min.js"],
  },
];

const EXTERNAL_REFERENCE =
  /(?:src|href)\s*=\s*["'](https?:)?\/\/[^"']+["']/giu;

/**
 * 把圖頁內的已知 CDN 引用改寫為站內相對路徑。
 * @param {string} html 原始 HTML
 * @param {string} assetPrefix 由該頁指向站台 assets 目錄的相對前綴，例如 `../../assets/`
 * @returns {{ html: string, rewritten: string[] }}
 * @throws 當改寫後仍存在任何外部引用（未知來源不得靜默放行）
 */
export function hardenGraphHtml(html, assetPrefix) {
  let output = html;
  const rewritten = [];
  for (const library of VENDORED_GRAPH_LIBRARIES) {
    const pattern = new RegExp(library.pattern.source, library.pattern.flags);
    if (!pattern.test(output)) continue;
    output = output.replace(
      new RegExp(library.pattern.source, library.pattern.flags),
      `${assetPrefix}${library.asset}`,
    );
    rewritten.push(library.id);
  }
  const remaining = output.match(EXTERNAL_REFERENCE);
  if (remaining)
    throw new Error(
      `graph html still references external assets: ${[
        ...new Set(remaining),
      ].join(", ")}`,
    );
  return { html: output, rewritten };
}

/**
 * 圖頁需要哪些自架函式庫；供建站端判斷本地副本是否齊備。
 * @param {string} html
 * @returns {string[]} 函式庫 id
 */
export function requiredGraphLibraries(html) {
  return VENDORED_GRAPH_LIBRARIES.filter(({ pattern }) =>
    new RegExp(pattern.source, pattern.flags).test(html),
  ).map(({ id }) => id);
}
