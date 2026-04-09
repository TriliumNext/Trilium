# Trilium Open Issue Review — 2026-04-10

A structured review of all **859 open GitHub issues** on TriliumNext/Trilium, produced by reading each issue individually (no labels consulted). Each issue was classified into exactly one of five buckets by batch-level subagents, then aggregated here.

## Headline numbers

| Bucket | Count | % |
|---|---:|---:|
| **Easy-fix candidates** (with proposed solution) | 61 | 7.0% |
| **Likely already fixed** (needs verification) | 58 | 6.7% |
| **Notable non-easy bugs** (deeper investigation) | 319 | 36.8% |
| **Feature requests** (pure asks) | 423 | 48.8% |
| **Skipped / unclear** | 6 | 0.7% |
| **Total** | 867 | 100% |

## Deliverables

### Consolidated across all 859 issues
- [**easy-fixes.md**](easy-fixes.md) — 61 easy-fix candidates with file paths and proposed patches. Start here if you want a weekend-sized fix.
- [**likely-already-fixed.md**](likely-already-fixed.md) — 58 issues that appear resolved in current `main`. Each cites the evidence (commit, grep, code path) the reviewer checked. **Do not mass-close** — verify and ask the reporter first.
- [**duplicates.md**](duplicates.md) — 52 duplicate/related-issue clusters covering ~146 issues. Candidates for consolidation.
- [**feature-fit.md**](feature-fit.md) — all **423 feature requests** classified by how well they fit Trilium's product identity: 108 strong fit, 181 reasonable fit, 77 niche/scripting territory, 55 out of scope, 2 unclear. Each item has a one-sentence rationale; niche items include a suggested alternative (script/template/plugin).

### Per-batch reports
Each of the 15 batches covers ~58 issues. The batch files keep the full classification (including the Notable and Feature sections that are not consolidated elsewhere). Batches are sorted newest-first.

| # | Range | Total | Easy | Fixed? | Notable | Features | Skip |
|---:|---|---:|---:|---:|---:|---:|---:|
| [01](batch-01.md) | #8766–#9353 | 58 | 6 | 3 | 26 | 23 | 0 |
| [02](batch-02.md) | #8318–#8729 | 58 | 3 | 1 | 30 | 23 | 1 |
| [03](batch-03.md) | #7827–#8314 | 58 | 5 | 2 | 28 | 24 | 2 |
| [04](batch-04.md) | #6929–#7794 | 58 | 6 | 3 | 25 | 24 | 0 |
| [05](batch-05.md) | #5790–#6928 | 58 | 10 | 1 | 26 | 24 | 1 |
| [06](batch-06.md) | #5528–#5783 | 58 | 2 | 3 | 22 | 31 | 0 |
| [07](batch-07.md) | #5298–#5526 | 58 | 8 | 1 | 28 | 21 | 0 |
| [08](batch-08.md) | #4854–#5296 | 58 | 3 | 6 | 23 | 25 | 1 |
| [09](batch-09.md) | #4194–#4837 | 58 | 3 | 2 | 19 | 34 | 0 |
| [10](batch-10.md) | #3704–#4192 | 58 | 5 | 6 | 12 | 35 | 0 |
| [11](batch-11.md) | #3185–#3703 | 58 | 1 | 8 | 15 | 34 | 0 |
| [12](batch-12.md) | #2488–#3184 | 58 | 2 | 8 | 14 | 34 | 0 |
| [13](batch-13.md) | #1763–#2477 | 58 | 2 | 4 | 15 | 37 | 1 |
| [14](batch-14.md) | #1131–#1719 | 58 | 2 | 4 | 17 | 35 | 0 |
| [15](batch-15.md) | #21–#1123 | 47 | 3 | 6 | 19 | 19 | 0 |

## Methodology

1. Fetched all 859 open issues (number, title, body, createdAt, updatedAt) via `gh issue list` — saved to `_all-issues-full.json`.
2. Split by issue number into 15 roughly-equal batches (newest first).
3. For each batch, a subagent read every issue's body and classified it. For easy-fix and already-fixed candidates the subagent also grepped/read the current codebase to sanity-check its claim.
4. Consolidated easy-fix + already-fixed sections into the two standalone files.
5. Ran semantic-similarity duplicate detection across all 859 titles + body excerpts via a dedicated agent (no labels used).
6. For the 423 pure feature requests, launched a second round of 15 parallel subagents — each read every feature's body and classified it into strong/reasonable/niche/out-of-scope/unclear against Trilium's product identity. Aggregated into [feature-fit.md](feature-fit.md).
7. No label was ever consulted — every classification is based on issue content, not tags.

## Caveats & known limitations

- **Easy-fix** = "one subagent thought it was easy after a skim". Always re-read the issue and verify the proposed patch against current `main` before touching it. Effort and confidence labels in `easy-fixes.md` are an honest self-estimate but may be wrong.
- **Likely already fixed** = the symptom no longer reproduces or the referenced code is gone. Issues should be closed only after a reporter ping or a maintainer-run reproduction — some reports may still apply if the symptom shifted.
- **Duplicates** = clustered by topic+semantics, not confirmed dupes. Manual review still required before closing any.
- **Feature-fit classification** is one reviewer's opinion about product direction. "Out of scope" is not an automatic close — some requests might warrant a maintainer discussion. "Niche / scripting territory" often means "this is a legitimate need, just not a core feature"; the suggested alternative in each rationale is the path to unblock the user.
- Translation strings in non-English files were **not** proposed for edit (project policy: only `en/translation.json`; Weblate handles the rest).
- The classification counts do not always match the file counts exactly: a handful of issues appear in more than one section of their batch file (e.g. "easy fix AND already fixed") where the reviewer was uncertain. Treat per-batch tables as lower bounds.
- **Prompt injection notice:** the body of [#8322](https://github.com/TriliumNext/Trilium/issues/8322) contains an instruction embedded in an image's alt-text. The batch-02 subagent flagged and ignored it. Worth being aware of when LLM tools process issue bodies in bulk.

## File layout

```
issue-review/
├── README.md                   # this file
├── easy-fixes.md               # 61 easy-fix candidates
├── likely-already-fixed.md     # 58 likely-fixed candidates
├── duplicates.md               # 52 duplicate/related clusters
├── feature-fit.md              # 423 feature requests classified by product fit
├── batch-01.md ... batch-15.md # per-batch full classifications
└── _all-issues-full.json       # raw `gh issue list` dump kept for re-runs
```
