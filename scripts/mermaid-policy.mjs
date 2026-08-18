const INTERPOLATION_EXAMPLE = /\bT=(?:100|150|200)ms\b/giu;
const NUMBER = String.raw`\d+(?:[._]\d+)?`;
const RANGE = String.raw`${NUMBER}(?:\s*[–-]\s*${NUMBER})?`;
const ASCII_UNIT = String.raw`(?:ms|seconds?|s|hours?|h|frames?|MiB|KiB|GiB|peers?)(?![A-Za-z0-9_])`;
const CJK_UNIT = String.raw`(?:工作日|秒|分鐘|小時|幀|玩家|人|位|筆|次|個|則|字|條|天|維)`;

const POLICY_PATTERNS = [
  new RegExp(String.raw`§\s*\d+(?:\.\d+)*`, "u"),
  new RegExp(String.raw`${RANGE}\s*(?:${ASCII_UNIT}|${CJK_UNIT}|%)`, "iu"),
  new RegExp(
    String.raw`(?:[<>≤≥=]|超過|至少|至多|最多|低於|高於|小於|大於|不少於|不超過|限)\s*(?:[A-Z][A-Z0-9_]*\s+)?(?:[⌊⌈]\s*)?${NUMBER}`,
    "u",
  ),
  new RegExp(String.raw`(?:[+*/×=]\s*${NUMBER}|${NUMBER}\s*(?:[+*/×]|-\s*${NUMBER})|(?<!-)-\s*${NUMBER})`, "u"),
];

export function containsMermaidPolicyNumber(rawLabel) {
  const label = rawLabel
    .replace(INTERPOLATION_EXAMPLE, "")
    // Mermaid node／participant IDs commonly mix letters and digits (A3, P1,
    // N0042). They are graph syntax, not policy numbers; labels such as
    // "Stage 2" remain available to the tail-boundary tests below.
    .replace(/\b(?=[A-Za-z0-9_]*[A-Za-z_])(?=[A-Za-z0-9_]*\d)[A-Za-z0-9_]+\b/gu, "");
  return POLICY_PATTERNS.some((pattern) => pattern.test(label));
}

export function isAllowedMermaidPolicyExample(file, rawLine) {
  if (file !== "程式架構/程式流程/spectator.md") return false;
  return (
    /\balpha\s*=\s*0\.5\b/iu.test(rawLine) ||
    /pos@100\s*×\s*0\.5\s*\+\s*pos@200\s*×\s*0\.5/iu.test(rawLine)
  );
}
