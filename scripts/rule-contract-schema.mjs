const RULE_ID_RE = /^(?:LEDGER|ECON|MOD|PHYS|TRACK|PART|UGC|VERSION|SEC)-R-\d{3}$/u;
const KINDS = new Set([
  "reject",
  "derive",
  "behavior",
  "invariant",
  "calibration",
]);
const LAYERS = new Set([
  "authoring",
  "finalizer",
  "admission",
  "fold",
  "room",
  "runtime",
  "service",
  "schema-static",
]);
const IMPLEMENTATION_REPOS = new Set([
  "open-4wd",
  "open-4wd-pinning",
  "open-4wd-signaling",
  "open-4wd-turn",
]);
const CONTRACT_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

function fail(message) {
  throw new Error(`rule-contracts: ${message}`);
}

function assertExactKeys(value, expected, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    fail(`${label} 必須是 object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  )
    fail(`${label} 欄位必須恰為 ${wanted.join(", ")}`);
}

function validateCalibration(value, label) {
  assertExactKeys(value, ["vectors", "acceptedRange"], label);
  if (
    !Array.isArray(value.vectors) ||
    value.vectors.length === 0 ||
    value.vectors.some(
      (vector) => typeof vector !== "string" || !CONTRACT_ID_RE.test(vector),
    ) ||
    new Set(value.vectors).size !== value.vectors.length
  )
    fail(`${label}.vectors 必須是非空且不重複的 kebab-case ID`);
  assertExactKeys(value.acceptedRange, ["min", "max"], `${label}.acceptedRange`);
  const { min, max } = value.acceptedRange;
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max)
    fail(`${label}.acceptedRange 必須是有限且 min <= max`);
}

export function expandRuleContracts(document) {
  assertExactKeys(document, ["rules"], "root");
  if (!Array.isArray(document.rules) || document.rules.length === 0)
    fail("rules 必須是非空陣列");

  const byId = new Map();
  const contractOwners = new Map();
  for (const [index, entry] of document.rules.entries()) {
    const label = `rules[${index}]`;
    const expectedKeys = [
      "id",
      "kind",
      "requiredLayers",
      "implementationRepos",
      "testContracts",
      ...(entry?.kind === "calibration" || entry?.calibration !== undefined
        ? ["calibration"]
        : []),
    ];
    assertExactKeys(entry, expectedKeys, label);
    if (typeof entry.id !== "string" || !RULE_ID_RE.test(entry.id))
      fail(`${label}.id 格式無效`);
    if (byId.has(entry.id)) fail(`${entry.id} 重複宣告`);
    if (!KINDS.has(entry.kind)) fail(`${entry.id}.kind 無效：${entry.kind}`);
    if (
      !Array.isArray(entry.requiredLayers) ||
      entry.requiredLayers.length === 0 ||
      entry.requiredLayers.some((layer) => !LAYERS.has(layer)) ||
      new Set(entry.requiredLayers).size !== entry.requiredLayers.length
    )
      fail(`${entry.id}.requiredLayers 無效或重複`);
    if (!Array.isArray(entry.implementationRepos) || entry.implementationRepos.length !== 1)
      fail(`${entry.id}.implementationRepos 必須恰有一個 owner`);
    if (!IMPLEMENTATION_REPOS.has(entry.implementationRepos[0]))
      fail(`${entry.id}.implementationRepos owner 無效`);

    assertExactKeys(
      entry.testContracts,
      entry.requiredLayers,
      `${entry.id}.testContracts`,
    );
    for (const layer of entry.requiredLayers) {
      const contractId = entry.testContracts[layer];
      if (typeof contractId !== "string" || !CONTRACT_ID_RE.test(contractId))
        fail(`${entry.id}.testContracts.${layer} 必須是 kebab-case ID`);
      const previous = contractOwners.get(contractId);
      if (previous !== undefined)
        fail(`test contract ${contractId} 同時屬於 ${previous} 與 ${entry.id}`);
      contractOwners.set(contractId, entry.id);
    }

    if (entry.kind === "calibration")
      validateCalibration(entry.calibration, `${entry.id}.calibration`);
    else if (entry.calibration !== undefined)
      fail(`${entry.id} 非 calibration 規則不得帶 calibration`);

    byId.set(entry.id, structuredClone(entry));
  }
  return byId;
}

export function validateRuleContractJoin(anchorIds, contracts) {
  const missingContracts = [...anchorIds].filter((id) => !contracts.has(id));
  const missingAnchors = [...contracts.keys()].filter((id) => !anchorIds.has(id));
  if (missingContracts.length > 0 || missingAnchors.length > 0)
    fail(
      `canon/contract 集合不一致；缺 contract=[${missingContracts.join(", ")}]，缺 anchor=[${missingAnchors.join(", ")}]`,
    );
}

export const RULE_CONTRACT_ENUMS = Object.freeze({
  kinds: Object.freeze([...KINDS]),
  layers: Object.freeze([...LAYERS]),
  implementationRepos: Object.freeze([...IMPLEMENTATION_REPOS]),
});
