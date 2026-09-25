---
name: benchmarking-search
description: Use when measuring or optimising Trilium's backend search — "why is autocomplete slow on a big database?", "where does a search spend its time?", "did this change actually make search faster?", or any before/after on `packages/trilium-core/src/services/search`. Boots core against a read-only snapshot of a real database, times a query, and attributes a CPU profile by caller or by callee. Includes the measurement discipline that separates a real win from machine noise — several plausible "wins" in this area have turned out to be drift. Don't write a new timing harness or profile parser; both live here.
---

# Benchmarking Trilium's backend search

Search performance only reproduces on a real database. A synthetic fixture has uniform titles, no clones, no inherited attributes and a shallow tree, and none of the costs that dominate in practice show up. Always measure against a snapshot of a real document.

| | reads | answers |
|---|---|---|
| `bench-search.mts` | a database snapshot | *how long does this query take, and how does that change* |
| `bench-profile.mts` | a `.cpuprofile` it writes | *which function, called by whom, and what does it contain* |

## 1. Snapshot a real database, read-only

Never benchmark against a live document — and never let the harness write to one.

```bash
# macOS: ~/Library/Application Support/trilium-data ; Linux: ~/.local/share/trilium-data
cd ~/Library/Application\ Support/trilium-data
sqlite3 "file:document.db?mode=ro" ".backup '/path/to/bench/document.db'"
```

`.backup` uses SQLite's backup API, so it is safe while the app is running and handles the WAL. The source is opened `mode=ro` and never written. A 1.9 GB document copies in about seven seconds.

The snapshot must be named `document.db` and sit in a directory of its own — that directory becomes `TRILIUM_DATA_DIR`.

## 2. Run the benchmark

`bench-search.mts` has to live under `apps/server/` to run: `@triliumnext/core` is a workspace package that pnpm links only into `apps/server/node_modules`, and ESM resolves bare specifiers from the importing file's own location.

```bash
cp .claude/skills/benchmarking-search/bench-search.mts apps/server/

TRILIUM_RESOURCE_DIR=$PWD/apps/server/src \
TRILIUM_DATA_DIR=/path/to/bench \
TRILIUM_GENERAL_READONLY=true \
TRILIUM_GENERAL_NOBACKUP=true \
BENCH_ITERATIONS=40 \
  node --import tsx apps/server/bench-search.mts a t 'the quick brown fox'

rm apps/server/bench-search.mts   # when finished
```

| variable | why |
|---|---|
| `TRILIUM_RESOURCE_DIR` | assets live under `src/assets` in dev; without it `resource_dir.ts` calls `process.exit(1)` at import time |
| `TRILIUM_GENERAL_READONLY` | the harness **refuses to start** without it, so a snapshot is never written to |
| `TRILIUM_GENERAL_NOBACKUP` | stops the backup service touching the snapshot directory |
| `BENCH_ITERATIONS` | default 5. Use 40 for anything you intend to act on |
| `BENCH_PROFILE` | write a `.cpuprofile` covering only the search calls |
| `BENCH_AUTOCOMPLETE` | `=1` sets `autocomplete: true`, taking `NoteFlatTextExp`'s single-token path |
| `BENCH_ONE_PASS` | `=1` disables two-pass ranking, i.e. the pre-`ab6dc34c15` behaviour |

It boots core exactly as `apps/server/src/main.ts` does, minus the HTTP server, so the code under test is the real thing.

## 3. Profile and attribute

```bash
BENCH_PROFILE=/tmp/a.cpuprofile ... node --import tsx apps/server/bench-search.mts a

# top functions by self time
node --import tsx .claude/skills/benchmarking-search/bench-profile.mts /tmp/a.cpuprofile 15

# who calls removeDiacritic, walking past thin wrappers
node --import tsx .claude/skills/benchmarking-search/bench-profile.mts /tmp/a.cpuprofile 8 \
  removeDiacritic "normalize,normalizeSearchText,tokenizeIntoWords"

# what NoteFlatTextExp.execute spends its time on, by callee
node --import tsx .claude/skills/benchmarking-search/bench-profile.mts /tmp/a.cpuprofile 10 \
  "children:execute@note_flat_text"
```

The skip list matters. `removeDiacritic` is called ~100% from `normalize`, which is called ~100% from `normalizeSearchText` — attributing one level up tells you nothing. Skipping those names lands the blame on code that *chose* to normalize.

The `@file` suffix on `children:` narrows to one implementation; `execute` is a method on every expression type.

## 4. Measurement discipline

**This is the most important section.** Search work in this repo has repeatedly produced plausible numbers that were wrong.

**Calibrate before trusting anything.** Run the *same code* three times. Observed on a developer machine running Trilium alongside: **±10% at 12 iterations, ±4-5% at 40**. Anything smaller than the floor is unresolvable, and reporting it as a win is a mistake.

**Never compare measurements taken minutes apart.** The machine drifts. One change here was recorded at 189 ms, and the identical code measured 210 ms later in the same session. Always measure both arms **back to back**, ideally in one command.

**Prefer phase timers to wall clock.** They are in-process, unsampled, and immune to profiler overhead. They are not in the codebase — add them temporarily around the stages of `performSearch`:

```ts
const t0 = performance.now();
const noteSet = expression.execute(allNoteSet, executionContext, searchContext);
const executeMs = performance.now() - t0;
// ... same around result construction, the computeScore loop, and the sort
getLog().info(`phases: execute=${executeMs.toFixed(1)} build=${buildMs.toFixed(1)} ...`);
```

Then take the **minimum of each phase independently** across iterations — the least-contended estimate of each — rather than the phases of the best single iteration.

Phase timers catch what wall clock hides. A per-search cache keyed on `` `${noteId}-${parentNoteId}` `` showed a *consistent 4-8% wall-clock improvement across every query*, and the phase it targeted had gone **58.4 ms → 62.1 ms, i.e. slower**. The tell: `executeMs` had also "improved", and the change could not possibly touch `executeMs`. **If a phase your change cannot reach appears to move, you are reading noise.**

**Self time undercounts.** Ranking leads by self time led to sizing one at ~23 ms when its subtree was 42.9 ms. Use `children:` for anything whose cost is in its callees.

**Strings are the usual culprit.** Almost every real win here was an allocation removed, not an algorithm improved: a template literal built per call, a `Map` key concatenated per lookup, `String.normalize("NFD")` re-run over a constant. Prefer nested maps over combined string keys — `Map<parent, Map<child, V>>` allocates nothing per lookup.

## 5. Where the time goes

For a query matching most of the database (a single letter matches ~84% of a 22k-note document, since flat text includes `noteId`, `type` and `mime`):

| phase | what happens | typical share |
|---|---|---|
| `execute` | `getCandidateNotes` scans every flat text; `searchPathTowardsRoot` resolves a note path per candidate | ~50% |
| `build` | a `SearchResult` per match, each resolving its path segment titles | ~19% |
| `score` | `computeScore` per match: title, path and content contributions | ~27% |
| `sort` | full sort; the comparator's `notePathTitle` tiebreak fires constantly on equal scores | ~6% |

Every phase is **O(matches)**. That is the ceiling: no micro-optimisation halves a query that matches 18,000 notes. Reaching a large win means processing fewer results — which is what two-pass ranking does — or matching fewer notes, which is a product decision.

The slowest shape is not the biggest result set but **zero matches with several tokens**: a 5-token query with no matches costs ~650 ms, because fewer than five good results triggers the progressive search's second pass and the whole scan runs twice, with cost linear in token count. That is the shape behind issue #10712.

## 6. What has already been done

Eight commits on `perf/autocomplete-debounce` (PR #11542), each with its measurements in the commit body. Read those before re-treading:

- **Two-pass ranking** — score without the path, shortlist, then fully score the shortlist. −43% on large result sets; the only structural win.
- **Result cap** at 25 — detailing went 155-309 ms → 21-50 ms, response 212 KB → 16-30 KB.
- **Client debounce** rewritten — was `notesCount / 20` ms capped at a second, measured from the last *search* rather than the last keystroke.
- Four commits removing per-result re-derivation of query-side and note-side strings.

Tried and rejected, with numbers, so they are not retried blindly:

| | why |
|---|---|
| Reordering the archived filter after the fulltext match | broke 3 `parse.spec` assertions; `execute` +6 ms |
| Per-search `getAllNotePaths` cache | copy-on-extend allocation exactly cancelled the sharing |
| Lazy `notePathTitle` alone | `build` −16%, `sort` **+68%** — the sort tiebreak reads it |
| Lazy `notePathArray` | broke 5 tests for ~2% |
| `autocomplete: true` (the single-token fast path) | faster on 1 char, **slower** on 2+, and it changes results — it keeps candidates matching only via inherited attributes |
