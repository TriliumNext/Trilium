---
name: measure-startup-requests
description: Use when measuring what the Trilium client loads at startup — "what loads at boot?", "did this change reduce the startup bundle?", "is <dependency> lazy?", or any before/after comparison for lazy-loading / code-splitting work. Drives a headless browser through login against the running dev server, records every request, and analyzes captures (summary, heavy-dependency probe, before/after diff). Don't write a new throwaway Playwright script or inline node analyzers — both already live here.
---

# Measuring Trilium startup requests

Two scripts in this folder do everything; don't reinvent them:

```bash
# 1. Capture a full startup (login → network quiet) into a JSON file:
TRILIUM_PASSWORD=<password> node .claude/skills/measure-startup-requests/capture-requests.mjs <out.json> [baseUrl]

# 2. Analyze captures:
node .claude/skills/measure-startup-requests/analyze-requests.mjs summary <capture.json> [--top N]
node .claude/skills/measure-startup-requests/analyze-requests.mjs probe <capture.json> [name ...]
node .claude/skills/measure-startup-requests/analyze-requests.mjs diff <before.json> <after.json> [--filter <regex>]
```

## Prerequisites

- The dev server must already be running (`pnpm server:start`, http://localhost:8080 by default).
  Note which checkout it serves: the capture reflects the tree the *server* runs from, not your cwd
  (verify with `curl` on a file that only exists in one tree if unsure).
- `TRILIUM_PASSWORD` env var if the instance has a password.
- Playwright is resolved from `packages/trilium-e2e`; the script prefers system Edge/Chrome, so no
  `playwright install` is needed.

## Workflow for lazy-loading work

1. Capture a **baseline** before changing anything: `capture-requests.mjs baseline.json`.
2. Make the change (Vite dev picks it up automatically; a fresh headless session has no HMR state).
3. Capture again and compare: `analyze-requests.mjs diff baseline.json after.json`.
4. `probe` confirms specific heavy deps stayed off the boot path.

## Interpreting results

- **Dev-mode numbers, not production.** The dev server serves unbundled ES modules (~500+ script
  requests is normal), so sizes are uncompressed and per-module. The *module sets* and import
  chains are what matter; production chunk sizes differ.
- **Request order ≈ import discovery order.** To find what triggers a heavy load, look at the
  `seq` of the first module of that package and at the `/src/...` modules requested just before it,
  then confirm the chain by grepping for static importers.
- **Sessions are stateful.** Open tabs / the active note change what loads (e.g. a text note pulls
  CKEditor legitimately). Totals between two captures are only comparable for the same session
  state; prefer the `diff` of targeted module sets, and treat full-MB totals as indicative.
- **Never filter raw URLs.** Dev URLs embed the absolute checkout path via `/@fs/...`, so a
  worktree named e.g. `lazy-ribbon` makes every request match `/ribbon/`. The analyzer normalizes
  paths (strips host, `?v=`/`?t=` params, `/assets/vX.Y.Z`, and the `/@fs/<checkout>` prefix) —
  rely on that.
- Vite's hash-named shared chunks (`dist-XXXX.js`) are identified by their `.js.map` in
  `.cache/vite/deps/`: `grep -o '"[^"]*node_modules/[^"]*"' <chunk>.js.map | ...` and count by
  package. (The 800 KB `es-toolkit`+`mdast`/`hast` chunk is CKEditor's internals, for example.)

## Reference

The default `probe` list is the set of heavy deps that were deliberately made lazy (CKEditor,
highlight.js, KaTeX, codemirror-vim, snapdom, force-graph, the LLM chat graph, ...) — if one of
them reports `LOADED` on a plain board/empty note startup, a regression sneaked in. After the
2026-06 lazy-loading work the new-layout baseline was ~557 requests / 3.75 MB / 500 scripts
(down from 810 / 8.02 MB / 745).

Known remaining eager-load offenders (candidates for future work): `applyModals` in
`layout_commons.tsx` statically mounts ~30 dialogs and their graphs at boot; the Inter font ships
as a 433 KB TTF instead of woff2.
