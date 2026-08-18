const HISTORICAL_TONE = [
  /對齊新 spec/u,
  /已被新 spec/u,
  /已採納為新/u,
  /待[^\n]{0,24}spec 討論/u,
  /取代過去/u,
  /過渡盤點/u,
  /安全基線已完成/u,
  /不再列為[^\n]{0,24}待辦/u,
  /不再是/u,
];

// 現行契約偶爾也會用「不再是」描述狀態轉換。豁免必須同時綁定檔案與
// 具體行為，不能只靠一個可擴張成歷史敘事的通用片語。
const CURRENT_PROSE_ALLOWLIST = [
  { path: "程式架構/matchmaking.md", pattern: /不再是選車入口/u },
];

export function findHistoricalProseViolations(documents) {
  const violations = [];
  for (const { path, lines } of documents) {
    for (let index = 0; index < lines.length; index += 1) {
      const text = lines[index];
      const pattern = HISTORICAL_TONE.find((candidate) => candidate.test(text));
      if (!pattern) continue;
      if (CURRENT_PROSE_ALLOWLIST.some((allowed) => allowed.path === path && allowed.pattern.test(text))) continue;
      violations.push({ path, line: index + 1, text });
    }
  }
  return violations;
}
