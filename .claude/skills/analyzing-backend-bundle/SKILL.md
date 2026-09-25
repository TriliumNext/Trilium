---
name: analyzing-backend-bundle
description: Use when analyzing the server/desktop backend bundle — "what does the server load at startup?", "is <dependency> lazy on the backend?", "why is <package> in the startup set?", "how big is the eager set?", chunk analysis after adding a dynamic-import seam, backend memory profiling (RSS, retained script source, heap), or any before/after comparison for backend lazy-loading. Records what a bundle actually loads at boot, joins it with the esbuild metafile, and explains why each package is eager. Don't write a new throwaway module-hook logger, metafile joiner, or heap-snapshot parser — all already live here.
---

# Analyzing the backend bundle

The backend bundles (`apps/server/dist`, `apps/desktop/dist`) are esbuild ESM output with
code splitting: an entry plus `chunks/`, where a chunk loads only when a dynamic `import()`
first needs it. Every megabyte the process loads at startup costs three ways, permanently:

- **Retained source** (~1 MB heap per loaded MB): V8 keeps each loaded script's source string
  for the life of the script. Double that for a chunk containing any character above U+00FF —
  esbuild escapes strings (`charset: "ascii"`) but emits regex literals verbatim, and one raw
  Arabic digit stores the whole chunk two-byte.
- **Parser high-water** (~5 B native per loaded byte, cold start): V8's parse of the loaded
  code peaks in malloc'd memory that glibc keeps as dirty pages after it is freed.
  `NODE_COMPILE_CACHE` roughly halves it on warm starts.
- **Bytecode and metadata** in the JS heap.

Reference points (2026-08, Node 22, real 146 MB DB, same source built both ways; the full
table is in PR #11111): the monolithic 14.8 MB CJS bundle cost 207 MB RSS / 64 MB heap
post-GC and 1 177 ms to first HTTP response; the split ESM build loaded 7.65 MB at startup
and cost 120 MB / 42 MB and 895 ms, with the V8 parser's native peak down from 78 MB to
21 MB. ESM *without* seams matched CJS on every metric — splitting only pays through
dynamic-import boundaries. So the question that matters is never "how big is the bundle" but
**"how much of it loads at startup"** — and the tools here answer it with runtime evidence,
not static guessing.

## Tools

All in this folder, zero dependencies. `record` and `profile-bundle` boot the real server, so
they need the usual environment (adapt paths; use a scratch copy of a real `document.db` for
realistic becca numbers, or an empty dir for setup-mode):

```bash
ENV="TRILIUM_ENV=production TRILIUM_DATA_DIR=<scratch>/data TRILIUM_PORT=8123 \
     TRILIUM_RESOURCE_DIR=$PWD/apps/server/dist"

# 1. Record which dist/ files the server loads at startup (ground truth):
env $ENV node .claude/skills/analyzing-backend-bundle/analyze-bundle.mjs record \
    --bundle apps/server/dist/main.mjs --out /tmp/loaded.txt --port 8123

# 2. Join with the metafile: eager vs lazy totals, per package, biggest eager chunks:
node .claude/skills/analyzing-backend-bundle/analyze-bundle.mjs startup \
    --meta <meta.json> --loaded /tmp/loaded.txt

# 3. Explain WHY a package is eager (shortest static import chain from the entry;
#    --from <input> traces from a module that is itself dynamically imported):
node .claude/skills/analyzing-backend-bundle/analyze-bundle.mjs why \
    --meta <meta.json> iconv-lite undici
node .claude/skills/analyzing-backend-bundle/analyze-bundle.mjs why \
    --meta <meta.json> --from apps/server/src/www.ts highlight.js

# 4. Whole-bundle composition, no boot needed:
node .claude/skills/analyzing-backend-bundle/analyze-bundle.mjs packages --meta <meta.json>

# 5. After adding any lazy seam — catches the CJS interop break described below:
node .claude/skills/analyzing-backend-bundle/check-dynamic-imports.mjs apps/server/dist

# Memory numbers (RSS/heap post-GC; add --snapshot for a heap snapshot):
env $ENV node --expose-gc .claude/skills/analyzing-backend-bundle/profile-bundle.cjs \
    apps/server/dist/main.mjs --port 8123 --snapshot /tmp/s.heapsnapshot

# Startup speed (spawn -> first HTTP response, median of N runs):
env $ENV node .claude/skills/analyzing-backend-bundle/bench-startup.mjs \
    apps/server/dist/main.mjs 5

# What the heap actually retains (proves which chunk sources are resident):
node --max-old-space-size=8192 .claude/skills/analyzing-backend-bundle/heap-strings.mjs \
    /tmp/s.heapsnapshot
```

The desktop bundle embeds the same server code, so server recordings generalize to it;
`record`/`profile-bundle` cannot boot `apps/desktop/dist/main.mjs` under plain node (it
imports `electron`), but `packages` and `why` work on its metafile directly.

## Getting the metafile

`buildBackend()` writes `dist/meta.json`, and **the last call in the app's build script
wins** — after `pnpm server:build` it describes `image_worker.cjs`, not main. To get the
main bundle's metafile, temporarily leave only the `main.ts` `buildBackend` call in
`apps/server/scripts/build.ts`, run the build, and save `dist/meta.json` elsewhere before
restoring. (Making buildBackend write per-entry metafiles is the real fix if this grates.)

## Interpreting the results

- **Eagerness is decided only by the recording.** The metafile marks every dynamic-import
  target chunk with `entryPoint` (240 of 286 outputs in the first analysis), so any static
  reasoning that consults `entryPoint`, or assumes "chunk = lazy", overcounts. Conversely the
  static-reachability closure *undercounts*: a dynamic import executed during boot loads its
  chunk anyway.
- **"NOT statically reachable" + present in the startup set** has two causes, and they call
  for opposite fixes. Either a dynamic import runs during startup — the seam exists and
  boot-time code defeats it, so defer that call (example: the `/mcp` route registering the
  MCP SDK at boot instead of on first request) — or the package is reached by an ordinary
  static chain from a module that is *itself* dynamically imported at boot, such as
  `apps/server/src/www.ts`. `why --from apps/server/src/www.ts <pkg>` shows the second kind;
  the fix there is a seam somewhere along the chain it prints.
- **`why` takes a package name, not a substring.** A bare needle matches at
  `node_modules/<name>/` or a whole path segment, because plain substring matching silently
  confuses a package with any file whose name merely ends the same way — "highlight.js" also
  appears in postcss's `terminal-highlight.js`, which reads as a plausible but entirely
  fictitious dependency edge.
- **Chunks load as units.** A package can be "lazy" in source but ride in a chunk shared
  with eager code; `startup`'s biggest-chunks table shows each chunk's dominant input so
  this is visible.
- **A `why` chain through an absurd path is a stubbing opportunity** — e.g. highlight.js
  reached via `sanitize-html → postcss/lib/terminal-highlight` (postcss's terminal error
  pretty-printer). An esbuild alias to a stub kills such an edge at build level.

## Fix patterns, by constraint

| Situation | Fix |
|---|---|
| Used only inside an `async` function | Move the import into it: `const { x } = await import("pkg")` (the pattern in `pdf_processor.ts`, `office_processor.ts`, `claude_agent.ts`) |
| Loaded at boot by a dynamic import | Keep the registration eager, import the payload in the request handler on first use |
| Consumed synchronously (script API, sucrase transpile) | Per-call import is impossible — preload conditionally at startup behind the feature's flag (backend scripting is off by default) |
| Pulled by a dep's edge that never runs meaningfully | esbuild `alias`/stub for that one file |

After any fix: re-run `record` + `startup` and compare the eager total, run
`check-dynamic-imports.mjs` (see below), and check no chunk in the new startup set carries
characters above U+00FF (`grep -lP '[^\x00-\xFF]'` over the loaded chunks; `heap-strings.mjs`
shows a ~2x source string when one slips through).

## The CommonJS interop trap — verify every new seam

**`const { x } = await import("some-cjs-package")` is silently broken in the split ESM
build.** esbuild cannot know a CommonJS module's named exports, so it emits the chunk with a
single `default` export; destructuring names off the namespace yields `undefined`, and the
first call fails with something like "l is not a constructor". Unit tests do not catch it,
because a `vi.mock("some-cjs-package", …)` supplies whatever names the test asks for.

Write the seam through the interop instead, and give the test mock a matching `default` (the
real module has one — that is the shape Node's own CJS interop produces):

```ts
const mod = await import("undici");
const { Agent, fetch } = mod.default ?? mod;   // works in ESM chunks, CJS output, and Node
```

Seams whose target is **own source or a real ESM package** (unpdf, the agent SDK, the MCP
SDK, core's own modules) are unaffected — they have genuine named exports. Only CJS
packages bite. `check-dynamic-imports.mjs` compares, for every dynamic import in the built
bundle, the names the consumer destructures against the names the target chunk exports; run
it on a clean build after adding a seam, and confirm the seam works for real (import the
emitted chunk in a scratch script and call into it) rather than trusting the unit tests.

## Gotchas

- `NODE_V8_COVERAGE` does not capture the loaded-script list here (the dump held only node
  internals) — the module hook (`loghook.cjs`, preloaded by `record`) is the reliable tool.
- The server handles SIGTERM without exiting (DB close), so anything that boots it must
  escalate to SIGKILL — `record` does; a hand-rolled runner that waits on `exit` after
  SIGTERM hangs and leaks an orphaned server.
- `__dirname` in ESM output is defined by the buildBackend banner and resolves to the
  **bundle root even inside `chunks/`** — bundled code locates `preload.cjs`,
  `image_worker.cjs` and assets relative to the entry. Don't "simplify" the banner; which
  chunk a module lands in must not change what `__dirname` means.
- Heap snapshots for a ~55 MB heap parse fine with `--max-old-space-size=8192`; write them
  only when needed (`--snapshot`), they're ~70-90 MB on disk.

Related skills: **measure-startup-requests** (the client-side counterpart),
**profiling-client-performance** (renderer-side cost), **developing-electron-desktop**
(desktop launch specifics when verifying a change in the real app).
