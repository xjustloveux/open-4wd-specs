import assert from "node:assert/strict";
import test from "node:test";

import {
  containsMermaidPolicyNumber,
  isAllowedMermaidPolicyExample,
} from "./mermaid-policy.mjs";

test("Mermaid policy guard catches units, quantifiers, operators, and section references", () => {
  for (const label of [
    "送端 5 則/秒",
    "content 限 500 字",
    "Count{< 5?}",
    "超過 50",
    "8 玩家 = 28 條 WebRTC 連線 (n × n-1 / 2)",
    "offer 遺失：t=60/120",
    "核對來源/目標/4 MiB",
    "累計簽章 ≥ ⌊N/2⌋+1",
    "quorum floor(2N/3)+1",
    "等待 13–14 工作日",
    "場地指紋 6 維",
    "7 天未開資料可能清除",
    "門檻見 testing.md §8",
  ]) {
    assert.equal(containsMermaidPolicyNumber(label), true, label);
  }
});

test("only the spectator interpolation illustration is allowlisted", () => {
  const spectator = "程式架構/程式流程/spectator.md";
  assert.equal(isAllowedMermaidPolicyExample(spectator, "Alpha[alpha = 0.5]"), true);
  assert.equal(
    isAllowedMermaidPolicyExample(
      spectator,
      "Lerp --> Visual[視覺位置 = pos@100 × 0.5 + pos@200 × 0.5]",
    ),
    true,
  );
  assert.equal(isAllowedMermaidPolicyExample("其他.md", "Alpha[alpha = 0.5]"), false);
});

test("Mermaid policy guard keeps identifiers and the one interpolation example", () => {
  for (const label of [
    "sha256 hash",
    "Stage 2 skip",
    "T=100ms / T=150ms / T=200ms",
    "Loadout --> Verify",
    "Upload --> L1[Layer 1]",
    "P1->>P2: DataChannel 直連",
    "A3 --> A4[載入 world descriptor]",
  ]) {
    assert.equal(containsMermaidPolicyNumber(label), false, label);
  }
});
