---
name: analyzing-coverage
description: Use when measuring or chasing Vitest/v8 code coverage in the Trilium monorepo — "what's below 100%?", "which files need tests?", "what lines of X are uncovered?", "take <area> to 100%", or feeding coverage gaps to test-writing agents. Provides one reusable analyzer (coverage.mjs) for lcov.info / coverage-summary.json / coverage-final.json, the correct commands to produce that data on Windows, and the known footguns. Pairs with writing-unit-tests.
---

# Analyzing coverage in Trilium

There is **one** coverage analyzer — `coverage.mjs` in this skill folder. Don't write a new throwaway parser; every past session that did (`cov-analyze.mjs`, `cov-parse.mjs`, `cov-lines.mjs`, `cov-gaps.cjs`) reinvented the same two operations. Use this instead.

```
node .claude/skills/analyzing-coverage/coverage.mjs <coverage-file> [summary|gaps] [options]
```

It **auto-detects** the format, so point it at whatever Vitest produced:
- `lcov.info` — the **default** `lcov` reporter, so it's almost always already on disk. Supports both modes.
- `coverage-summary.json` — from `--coverage.reporter=json-summary`. **summary only** (no per-line detail).
- `coverage-final.json` — from `--coverage.reporter=json`. Supports both modes.

## Two modes

**summary** (default) — list files below a threshold, worst-first, plus aggregate totals over the matched set. This is the "where's the coverage debt?" view.

```bash
# trilium-core services below 100%, worst first (measured through the server suite):
node .claude/skills/analyzing-coverage/coverage.mjs \
    apps/server/test-output/vitest/coverage/lcov.info \
    --filter packages/trilium-core/src/services
```
Options: `--threshold N` (default 100), `--metric lines|branches|functions|any` (default `any` — flag a file if *any* metric is below), `--top N`, `--json`.

**gaps** — for the file(s) matched by `--filter`, print the exact uncovered line numbers (statements + functions) and uncovered branch lines, compressed to ranges. This is the "what does my new test have to exercise?" view — feed it straight into a test-writing agent's prompt.

```bash
node .claude/skills/analyzing-coverage/coverage.mjs \
    apps/server/test-output/vitest/coverage/lcov.info gaps \
    --filter becca/entities/bnote.ts
# ### packages/trilium-core/src/becca/entities/bnote.ts — lines 78% (...)
#   uncovered lines:        163, 240-257, 266-267, ...
#   uncovered branch lines: 245, 249, ...
```

`--filter` takes a path substring; repeat it or comma-separate to match any (`--filter src/services,src/entities`). `--json` on either mode emits machine-readable output for workflows.

## Producing the coverage data

trilium-core has **no runner of its own** — its coverage is measured *through* the `apps/server` and `apps/standalone` suites (both set `allowExternal: true` + a core `include` glob; see writing-unit-tests). Pick the suite that exercises your file:

| Target area | Suite to run | lcov lands at |
|---|---|---|
| `apps/client/src/**` | client | `apps/client/test-output/vitest/coverage/lcov.info` |
| `apps/server/src/**`, `packages/trilium-core/src/**` | server | `apps/server/test-output/vitest/coverage/lcov.info` |
| `apps/standalone/src/**`, or `packages/trilium-core/src/**` under the sqlite-wasm runtime | standalone | `apps/standalone/test-output/vitest/coverage/lcov.info` |

`packages/trilium-core/src/**` is covered by **both** the server and standalone suites (its specs are pulled into each via the core `include` glob), so a core file shows two separate lcov entries. They aren't identical: the standalone suite runs core through happy-dom + sqlite-wasm, so a line uncovered there but covered under server (or vice-versa) is a real runtime-specific gap, not noise. Pick the suite matching the runtime you care about; to chase core to 100% everywhere, check both.

Run the suite (or a scoped subset) with coverage, then analyze the lcov:

```bash
# Whole package (slow but complete):
pnpm --filter @triliumnext/client test --coverage
pnpm --filter server test --coverage
pnpm --filter @triliumnext/standalone coverage   # core under sqlite-wasm; lcov anchored to apps/standalone/test-output

# Scoped to specific specs (fast iteration). On Windows/sandbox, pnpm exec can
# EPERM — call the hoisted binary in the REPO-ROOT node_modules directly:
cd apps/server
CI=true node ../../node_modules/vitest/vitest.mjs run \
    ../../packages/trilium-core/src/becca/entities/bnote.spec.ts \
    --reporter=dot --coverage --coverage.reporter=lcov \
    --coverage.reportsDirectory=./test-output/cov-bnote
node ../../.claude/skills/analyzing-coverage/coverage.mjs \
    ./test-output/cov-bnote/lcov.info gaps --filter bnote.ts
```

### Footguns (learned the hard way)
- **Always pass `--reporter=dot`** for scoped runs — the project's configured `html`/`@vitest/ui` reporter can crash at end-of-run and abort coverage.
- **The v8 `text` reporter crashes** (`PARSE_ERROR` remapping unrelated core files) on single-spec `--coverage` runs. Use `lcov`/`json`/`json-summary` and analyze with this script — never rely on the terminal table for a scoped run.
- **The per-file table row renders blank** when a single included file is exactly 100% (cosmetic v8 quirk). This script reads the raw data, so it shows the real number.
- **Multi-file client runs must `cd apps/client` first.** Running multiple specs from the repo root with `--root apps/client` triggers a vitest "failed to find the runner" crash; a single spec with `--root` is fine.
- **Isolated vs full-suite gaps:** when you run only *your* spec, lines covered by *other* specs in the full suite show as uncovered. That's expected — only your assigned lines need to disappear. Don't chase the rest.
- **`--coverage.reportsDirectory` is relative to `--root`**, so it can double a path prefix — pass a simple relative dir like `./test-output/cov-<slug>`.
- For provably-dead defensive branches, mark with `/* v8 ignore next N -- reason */` rather than writing a fake test (sanctioned by writing-unit-tests).

## Writing the tests

This skill only *measures*. To actually raise coverage — fixtures, the real-DB vs mocked-becca decision, import paths, component rendering — use the **writing-unit-tests** skill. The typical loop: run suite with `--coverage` → `coverage.mjs … summary` to pick the worst file → `coverage.mjs … gaps --filter <file>` to get the line list → write tests → re-run scoped with `--coverage` → `gaps` again until your lines are gone.

For a large fan-out (e.g. "take all of becca to 100%"), a Workflow that gives one agent per file its `gaps` line-list as the assignment works well — see the pattern this skill's analyzer was extracted from.
