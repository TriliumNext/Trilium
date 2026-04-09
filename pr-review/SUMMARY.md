# Open PR Review — Summary

**Review date:** 2026-04-09
**Open PRs analyzed:** 47
**Individual analyses:** [pr-review/](./) (one `pr-<number>.md` per PR)

Each row points to the full individual analysis. Author's own WIP PRs (#9189, #8654) are listed but not actioned — they are the maintainer's own drafts.

---

## TL;DR — Action Matrix

| Action | Count | PRs |
|---|---|---|
| **MERGE** (ready now) | **10** | #9356, #9349, #9348, #9335, #9334, #9307, #9344, #9190, #8894, #9341 |
| **MERGE after rebase / tiny nits** | **4** | #9338, #9342, #9104, #8640 |
| **REQUEST CHANGES** | **22** | #9296, #9188, #9151, #9140, #9119, #9089, #9076, #9034, #8980, #8972, #8959, #8920, #8880, #8864, #8787, #8525, #8202, #9339, #9340, #9343, #7828, #7759 |
| **CLOSE** (superseded / stale / duplicate) | **9** | #9355, #9153, #9316, #8693, #7841, #7287, #7222, #6839, (one of #8864/#8959) |
| **MERGE (consolidation required)** | **1** | #9203 (supersedes #9153) |
| **WIP — maintainer's own** | **2** | #9189, #8654 |

Total = 48 (one PR appears twice — #9203 consolidates #9153; #8864/#8959 are duplicates where one must close).

---

## 1. MERGE NOW — safe, green CI, low risk

These can go in today with no further changes.

| PR | Title | Author | Why |
|---|---|---|---|
| [#9356](pr-9356.md) | axios 1.15.0 [SECURITY] | renovate | CVE patch, CI green, lockfile correct. |
| [#9349](pr-9349.md) | upath v3 | renovate | Dev-only dep, Node 20+ compatible. |
| [#9348](pr-9348.md) | marked 17.0.6 | renovate | Patch bump, fixes async-hook race. |
| [#9335](pr-9335.md) | fuse.js 7.3.0 | renovate | Minor, improves share-theme diacritic handling. |
| [#9334](pr-9334.md) | eslint-linter-browserify 10.2.0 | renovate | Aligns with already-installed eslint 10.2.0. |
| [#9307](pr-9307.md) | minimatch@3>brace-expansion v5 | renovate | Supply-chain hardening, tiny lockfile delta. |
| [#9344](pr-9344.md) | fix(web-clipper): strip trailing `/` | bartv2 | Trivial, correct; Gemini warning is a false positive. |
| [#9190](pr-9190.md) | feat: backup download button | Lorinc936 | Already **lgtm**'d, path-traversal guard correct. |
| [#8894](pr-8894.md) | web-clipper: prevent cloning | contributor | Small, correct, CI green. |
| [#9341](pr-9341.md) | feat(llm): stop generation button | Kureii | Self-contained, fixes error-swallowing from #9316. Lowest risk in the LLM series. |

---

## 2. MERGE AFTER MINOR WORK

Rebases, trivial filter fixes, or waiting on one dependency.

| PR | Title | What's needed |
|---|---|---|
| [#9338](pr-9338.md) | feat(llm): Ollama provider | Clean — minor `instanceof` refactor can land later. |
| [#9342](pr-9342.md) | feat(llm): Tavily/SearXNG search | Note: API keys stored unencrypted (matches existing pattern); SSRF via SearXNG URL worth documenting. |
| [#9104](pr-9104.md) | fix: relation map autocomplete | Already lgtm'd — just needs rebase to drop merge conflict. |
| [#8640](pr-8640.md) | feat: relation name wildcard `~?` | Add `attr.type === "relation"` filter to avoid scanning all attributes; otherwise clean and well-tested. |

---

## 3. REQUEST CHANGES — real value, real blockers

These belong in Trilium but aren't ready.

### 3a. LLM series (Tomas Adamek / Kureii) — interdependent

| PR | Title | Primary blocker |
|---|---|---|
| [#9339](pr-9339.md) | LLM note mutation tools | Must land with/after #9340 (approval gate). Minor: duplicate `isContentAvailable()` in `move_note`. |
| [#9340](pr-9340.md) | LLM tool approval system | **Security blocker:** new `POST /api/llm-chat/execute-tool` route is missing CSRF middleware. Also missing provenance check — route can execute any mutating tool without an LLM having proposed it. |
| [#9343](pr-9343.md) | LLM knowledge base mode | Unbounded `getContent()` on large notes, `!important` CSS, auto-enables mutation tools → effectively depends on #9340. |

**Landing order:** #9338 → #9341 → #9340 (with CSRF fix) → #9339 → #9342 → #9343. #9316 closes once the split PRs land.

### 3b. Large feature PRs

| PR | Title | Biggest blocker |
|---|---|---|
| [#9296](pr-9296.md) | "fun take1" (actually RCE/security hardening) | Misleading title, CI red (E2E + dev), merge conflicts. **Must be split.** |
| [#9188](pr-9188.md) | Link embed previews | Merge conflicts, hardcoded English (i18n rule), SSRF test gap, Google favicon privacy concern. Share SSRF helper with #9296. |
| [#9076](pr-9076.md) | Codeblock format button | Bundle-size measurement pending, 1 failing ckeditor5 test, docs missing. Architecture refactor already done per review. |
| [#9034](pr-9034.md) | Search perf "take1" | **Alternative to same author's #6839.** Maintainer must pick one track. Red CodeQL + arm64 E2E; 50K-note profiling test should be env-gated. |
| [#8972](pr-8972.md) | Migrate autocomplete | Hover/debouncing/icon/indent regressions; strategic question on `@algolia/autocomplete-core` choice. Coordinates with #9104. |
| [#9151](pr-9151.md) | New about dialog | Literal `"TODO"` placeholders in `en/translation.json`; stale-closure bug in `onLoad` useCallback. |

### 3c. Smaller correctness / quality issues

| PR | Title | What to fix |
|---|---|---|
| [#9140](pr-9140.md) | Chinese IME in relation map | Visible diff adds the new handler but doesn't show the old `keyup` wiring being replaced — verify replacement before merge. |
| [#9119](pr-9119.md) | Copy note URL to clipboard | Real diff is ~14 lines (rest is translation reordering). Rebase, add shared URL helper, unify toast feedback. |
| [#9089](pr-9089.md) | Auto-execute saved search | CI failing; **duplicate of #7841**. Close one. This one has cleaner impl. |
| [#8980](pr-8980.md) | Mathlive fix + toggle | Patch targets 0.109.0 but main is on 0.109.1 — fix is currently dead code. |
| [#8920](pr-8920.md) | Enforce TOTP on sync setup | Silently expands `checkCredentials` to enforce TOTP on **every** authenticated request — breaks existing sync/ETAPI clients. SSRF on `check-server-totp`. Split PR. |
| [#8880](pr-8880.md) | Calendar day view + slot options | Maintainer already requested changes: crash on bad slot values, needs UI exposure in collection properties, docs on "slot" concept. |
| [#8864](pr-8864.md) | Toolbar drag-drop customization | **Duplicate of #8959.** Uses forbidden `crypto.randomUUID()` (CLAUDE.md rule). XSS via user-supplied group label/icon SVG. Merge conflicts. |
| [#8959](pr-8959.md) | Editable toolbar | **Duplicate of #8864.** Hardcoded English, cross-package icon imports. Cleaner than #8864 but less complete. Consolidate before merging. |
| [#8787](pr-8787.md) | `childTitleTemplate` attribute | Maintainer already CHANGES_REQUESTED. Merge conflicts, backwards-compat for existing `titleTemplate` on parent notes, `child:template` inheritance coverage. |
| [#8525](pr-8525.md) | Subtree expand depth limit | Hard-coded `4` needs constant, inconsistent return type, unparameterized UPDATE, no tests, arm64 E2E failing. Stale since January. |
| [#8202](pr-8202.md) | Recently opened windows | Merge conflicts, potential sync loop from removing `openNoteContexts` filter in `froca_updater.ts`, extract LRU helper, magic `"main"` string. |
| [#7828](pr-7828.md) | Share attachment auth | Author silent since maintainer review 2025-12-08. Mixes 3 concerns. Over-engineered `ContentAccessor` crypto without a threat model. |
| [#7759](pr-7759.md) | Share path `{parent}/{note}` | Layered on top of #7828 and carries all its code. Only handles one parent level; relative-path rewriting is fragile; legacy redirect loses query strings. No tests. |

---

## 4. CLOSE — superseded, stale, or unfixable

| PR | Title | Why close |
|---|---|---|
| [#9355](pr-9355.md) | axios 1.15.0 (dependabot) | Duplicate of renovate's #9356 but missing the `pnpm-lock.yaml` update, so CI fails across the board. Also suggests **disabling Dependabot for npm** — repo is standardized on Renovate + pnpm. |
| [#9153](pr-9153.md) | trilium:// protocol handler (argusagent) | **Strict subset of #9203.** #9203 has cleaner architecture (dedicated `protocol-handler.ts` vs inlined in `main.ts`) and adds the Copy-URL UI affordances. Close in favour of #9203. |
| [#9316](pr-9316.md) | LLM chat enhancements (umbrella) | Superseded by the split PRs #9338–#9343 at the maintainer's request. Draft with merge conflicts. |
| [#8693](pr-8693.md) | Leaflet → MapLibre GL | Stalled copilot-swe-agent PR. Visible `TODO: Fix` placeholders, hallucinated `mermaid` import, no maintainer engagement in 2 months, no tests for GPX path. |
| [#7841](pr-7841.md) | Auto-execute saved search | Maintainer's architectural CHANGES_REQUESTED not addressed, UX concern with @rom1dep unresolved, 4+ months stale. **Superseded by #9089** (also needs work, but cleaner impl). |
| [#7287](pr-7287.md) | Search → create-into-inbox | Misleading title (it's a sweeping note-creation refactor + AI chat command + rename of `getNoteIdFromUrl`). Failing CI (author admits). ~7 months, no maintainer engagement. Ask to split into 4 smaller PRs. |
| [#7222](pr-7222.md) | Search ranking (draft) | Author **explicitly announced abandonment** 2025-11-23 in favour of equivalence-classes research direction. Close with thanks. |
| [#6839](pr-6839.md) | FTS5 search | **14,758 lines / 43 files / 8 months old**, migration number collisions likely, mixes unrelated calendar timezone fix. Same author opened #9034 as a smaller active iteration. Close with reference to #9034. |

> Note: between #8864 and #8959, one must close — they're duplicates from the same contributor. Pick whichever the author wants to continue (#8864 is more complete but has the `crypto.randomUUID()` violation and XSS risk; #8959 is cleaner but less complete).

---

## 5. WIP — maintainer's own drafts (no action)

| PR | Title | Notes |
|---|---|---|
| [#9189](pr-9189.md) | Standalone | Strategic browser-client refactor. CI strong except CodeQL. Suggestion from review: split CLAUDE.md and `setup.tsx` out for easier review. |
| [#8654](pr-8654.md) | Trilium preview import | Security feature (preview `.trilium` archives before import). Architecturally sound. Failing Test development + CodeQL; an unrelated IPC change is bundled. |

---

## 6. Cross-PR coordination you'll want to resolve first

Several PRs conflict or overlap. Decide these before acting on the individual tables:

1. **axios (#9356 ↔ #9355)** — Merge #9356, close #9355. Consider disabling Dependabot for npm (repo is pnpm + renovate).
2. **trilium:// protocol (#9203 ↔ #9153)** — Merge #9203, close #9153. Both use the same branch name from different forks.
3. **LLM split PRs (#9338–#9343) vs umbrella (#9316)** — Land the split PRs in order, then close #9316.
4. **Auto-execute saved search (#9089 ↔ #7841)** — Pick one. #9089 has cleaner impl; #7841 has maintainer's architectural review already.
5. **Search performance (#9034 ↔ #6839)** — Pick one track (in-memory flatTextIndex vs. FTS5). Same author, same problem. Close the loser.
6. **Toolbar customization (#8864 ↔ #8959)** — Same feature, possibly same contributor. Consolidate on one branch.
7. **Autocomplete migration (#8972) vs autocomplete fix (#9104)** — Coordinate: whichever lands first forces the other to rebase or drop its fix.
8. **Share access (#7828 + #7759)** — Sister PRs from x1arch who went silent. Ping first; close if no reply in ~1 week.
9. **SSRF protection helper (#9296 ↔ #9188)** — Both introduce outbound-HTTP validation. If both land, extract a shared helper in `@triliumnext/commons` or as a server service.

---

## 7. Recommended weekly cadence

- **Quick wins (today):** merge the 10 Section 1 PRs in one sitting. These are CI-green and low-risk.
- **This week:** resolve the 9 cross-PR decisions in Section 6. Each close/merge call unblocks 1–3 PRs downstream.
- **Next week:** drive the LLM series (#9338 → #9341 → #9340 → #9339 → #9342 → #9343) since it's the largest coherent feature block and the security review for #9340 is the bottleneck.
- **Ongoing:** ping the "Request Changes" authors with specific, small asks. For any PR with no author response in 1+ week after a concrete ask, close with thanks.
