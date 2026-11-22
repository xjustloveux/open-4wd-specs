import assert from "node:assert/strict";
import test from "node:test";

import { findHistoricalProseViolations } from "./current-prose-policy.mjs";

test("current prose policy rejects migration and completed-work narration", () => {
  const violations = findHistoricalProseViolations([
    { path: "遊戲機制.md", lines: ["### 對齊新 spec 的處置", "已被新 spec 替代"] },
    { path: "其他.md", lines: ["安全基線已完成，不再列為發布待辦。"] },
    { path: "美術資源.md", lines: ["首次 Release 前的過渡盤點；不再是 bytes 權威"] },
    { path: "主題.md", lines: ["這取代過去的作法", "不再是表現力的上限"] },
  ]);

  assert.equal(violations.length, 6);
});

test("current prose policy narrowly allows present-tense fail-closed behavior", () => {
  const violations = findHistoricalProseViolations([
    {
      path: "現行.md",
      lines: [
        "舊鏈由 pinning 封存供查證、不再收件。",
        "未結案案件過期後不再列入仲裁。",
        "離開 admission 名冊後即不再接受訊息。",
        "已發射 projectile 不再參與車輛 teleport。",
        "明示重設，不匯入舊資料。",
      ],
    },
    { path: "程式架構/matchmaking.md", lines: ["matchmaking 不再是選車入口。"] },
  ]);

  assert.deepEqual(violations, []);
});
