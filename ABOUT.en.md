---
type: meta
domain: []
summary: 英文版 about——專案定位、corpus 組織與文檔工程方法論摘要，對外讀者入口（非權威、摘要自 文檔工程.md）
authority: 文檔工程.md
slug: null
---
# Open4WD Specs — About (English)

> **This page is an English orientation, not an authority.** The specification corpus is written in Traditional Chinese; where this summary and the Chinese source differ, the Chinese source wins. For the full documentation methodology see [文檔工程.md](文檔工程.md) (Documentation Engineering). Keep this page in sync when that file changes.
>
> **Development status:** Open4WD is under active development, and the main game is not yet publicly available. The current phase is [`pre_launch`](專案生命週期.md); this corpus is the current design canon, but incompatible changes may still occur before the first `live` release.

## What this repository is

`open-4wd-specs` is the design-specification corpus for **Open4WD**, an open-source (MIT) browser racing game in the mini-4WD tradition: player-generated parts, chips, and tracks published over IPFS and an OrbitDB event ledger, peer-to-peer play over libp2p/WebRTC, deterministic Rapier physics, and an Angular PWA client. There is no required central server — signaling, pinning, and TURN are all self-hostable.

The repository doubles as a **worked example of documentation engineering** ("docs as code"): the documentation is version-controlled, linted, and CI-verified like source code, with a single source of truth per fact and machine-checked cross-references.

## How the corpus is organized

- **Root canon files** — one per system (economy, reputation, moderation, data/ledger, versioning, …); each states *current* behavior only.
- **Reference tables** — formulas, shared constants, materials, modeling parameters; the single authority for their respective facts.
- **`流程/`** — cross-module business/process flows (mermaid diagrams).
- **`程式架構/`** — implementation-layer specifications.
- **`美術資源/`** — visual design systems, prompts, and approved reference assets.
- **`部署資訊/`** — deployment and companion-repository specifications.
- **`decisions/`** — Architecture Decision Records (MADR, immutable, superseded-by chains).
- **`conformance/`** — language-neutral consensus test vectors.
- **`歷史記錄/`** — daily change-history entries; `歷史記錄.md` is their generated month index.

Generated navigation lives in [總覽.md](總覽.md) (overview + index) and [docs-map.md](docs-map.md) (domain map + dependency graph).

## The methodology in one page

Summarized from [文檔工程.md](文檔工程.md):

1. **Single authority** — every class of fact has exactly one source; others link, never restate. Changing a shared value means grepping the whole corpus and updating every copy.
2. **Current vs. history separation** — canon states only what is true now; `歷史記錄.md` is the change ledger, while the deprecation/rename index and rationale live in `decisions/INDEX.md` and its ADRs.
3. **Diagrams are skeletons, text is authority** — formulas and thresholds never live inside diagram node labels.
4. **ADRs, two-layer** — canon = current, decision record = why, history = ledger; decisions are immutable and superseded by new files.
5. **Machine enforcement** — CI executes the package-defined `pnpm check` aggregate (toolchain tests; markdown, terminology, and typography lint; reference and history integrity; decision-chain and frontmatter checks; generated-index, rule-registry, and Mermaid validation) plus owner-scoped cross-repository checks. Every discipline points at a real check; the package script, rather than a prose count, is authoritative.

## Where to start

- Newcomers: [總覽.md](總覽.md) → the system you care about.
- Contributors: [文檔工程.md](文檔工程.md) — the documentation discipline and the contribution workflow.
- Machine navigation: a graphify knowledge graph (`graph.json`) is generated per repo. A local MkDocs site can be built and verified now; the public site is enabled in the same release batch that makes `open-4wd-specs` public.
