---
name: measure-startup-requests
description: Use when measuring what the Trilium client loads at startup — "what loads at boot?", "did this change reduce the startup bundle?", "is <dependency> lazy?", or any before/after comparison for lazy-loading / code-splitting work. Drives a headless browser through login against the running dev server, records every request, and analyzes captures (summary, heavy-dependency probe, before/after diff). Don't write a new throwaway Playwright script or inline node analyzers — both already live here.
---

# Measuring Trilium startup requests

Two scripts in this folder do everything; don't reinvent them:

```bash
# 1. Capture a full startup (login → network quiet) into a JSON file:
TRILIUM_PASSWORD=<password> node .claude/skills/measure-startup-requests/capture-requests.mjs [--mobile] <out.json> [baseUrl]

# 2. Analyze captures:
node .claude/skills/measure-startup-requests/analyze-requests.mjs summary <capture.json> [--top N]
node .claude/skills/measure-startup-requests/analyze-requests.mjs probe <capture.json> [name ...]
node .claude/skills/measure-startup-requests/analyze-requests.mjs diff <before.json> <after.json> [--filter <regex>]
node .claude/skills/measure-startup-requests/analyze-requests.mjs modules <capture.json> [--depth N] [--list <regex>]
node .claude/skills/measure-startup-requests/analyze-requests.mjs roots <capture.json> [--top N]
node .claude/skills/measure-startup-requests/analyze-requests.mjs why <capture.json> <name>
```

The capture records what asked for each request, so the last three attribute a startup instead of
only counting it:

- `roots` splits the requests into groups by what started them: the page itself, or a dynamic
  import or fetch made by running script. Each group is one static import graph, so its size is
  what that one `import()` costs. Start here.
- `modules` counts requests by where the module lives; `--list <regex>` prints each matching
  module with its importer.
- `why <name>` prints the chain of importers from the page down to a module.

A module is attributed to whatever requested it first. A second importer is not recorded, so
removing the first one can leave the module loaded through another.

## Prerequisites

- **No password at hand?** Boot a login-free dev server on the e2e fixture database, in memory
  (`references/inspecting-the-running-app.md` in the `building-client-ui` skill has the command and
  how to stop it), and pass its URL as `baseUrl`. Request counts there are within a few of a real
  database's, as long as the startup does not depend on the open tabs.
- On NixOS the script launches the `chromium` on the PATH; set `CHROME_BIN` to use another browser.

- The dev server must already be running (`pnpm server:start`, http://localhost:8080 by default).
  Note which checkout it serves: the capture reflects the tree the *server* runs from, not your cwd
  (verify with `curl` on a file that only exists in one tree if unsure).
- `TRILIUM_PASSWORD` env var if the instance has a password. **Without it the capture still
  "succeeds"** — it just never gets past the login page, yielding a plausible-looking ~178-request
  file that measures nothing. Validate every capture before drawing conclusions: a real one
  contains `/api/` requests (`/api/tree`, `/api/options`, ...). Zero `/api/` hits means you
  captured the login screen.
- Playwright is resolved from `packages/trilium-e2e`; the script prefers system Edge/Chrome, so no
  `playwright install` is needed.

## The desktop app (Electron)

Start the dev desktop app with a debugging port, then attach to it with `--cdp`. The capture
reloads its main window and checks against the desktop allowlist as usual:

```bash
cd apps/desktop && env -u ELECTRON_RUN_AS_NODE -u ELECTRON_NO_ATTACH_CONSOLE pnpm dev --remote-debugging-port=9222
node .claude/skills/measure-startup-requests/capture-requests.mjs --cdp http://127.0.0.1:9222 electron.json
node .claude/skills/measure-startup-requests/analyze-requests.mjs check electron.json .claude/skills/measure-startup-requests/desktop-startup-allowlist.txt
```

- A shell inside VS Code inherits `ELECTRON_RUN_AS_NODE=1`, which makes Electron run as Node and
  fail with "Not running in an Electron environment!", hence the `env -u`.
- The dev app has its own database (`apps/desktop/data`), so its open notes differ from the
  server's; compare the two through `check`, which leaves those out, not through `diff`.
- The window is real: requests made before the reloaded document (seq below the one of `/`)
  belong to the page before, and modules loaded at the very end from a Preact event handler (a
  hover preload of the calendar or the global menu) come from the mouse over the window.
- Sizes read as negative: the `trilium-app://` protocol reports none. Compare the request sets.
- `electron_context_menu.ts` and `native_window.ts` load only in Electron, so the allowlist lists
  them with a `?`.

## Workflow for lazy-loading work

1. Capture a **baseline** before changing anything: `capture-requests.mjs baseline.json`.
2. Make the change (Vite dev picks it up automatically; a fresh headless session has no HMR state).
3. Capture again and compare: `analyze-requests.mjs diff baseline.json after.json`.
4. `probe` confirms specific heavy deps stayed off the boot path.

## The startup allowlist

`desktop-startup-allowlist.txt` lists every request the desktop client is allowed to make during
startup, one normalized name per line, and `mobile-startup-allowlist.txt` the mobile client's.
`check-startup.mjs` captures a startup of the dev server and exits with 1 when the two differ in
either direction; `--mobile` captures the mobile layout, in a phone's viewport with touch and the
`trilium-device=mobile` cookie, and checks it against the mobile allowlist:

```bash
pnpm dev:check-startup [--update] [--out <dir>]   # what CI runs: both layouts on the e2e fixture
TRILIUM_PASSWORD=<password> node .claude/skills/measure-startup-requests/check-startup.mjs [--update] [--mobile] [baseUrl]
# or, on a capture already taken:
node .claude/skills/measure-startup-requests/analyze-requests.mjs check <capture.json> [allowlist.txt] [--update]
```

- **CI runs the check** (`.github/workflows/startup.yml`) through `pnpm dev:check-startup`, which is
  `check-startup.mjs --fixture`: it boots a dev server on the e2e fixture database, in memory and
  without a login (`apps/server/spec/db/config.ini`), checks the desktop layout and then the mobile
  one, and stops the server. It takes about 30 s, on a cold Vite cache too. A failed run uploads
  both captures and the server's log. Regenerate the allowlists with this command, not against
  your own database: the fixture is the baseline, and the allowlists must also pass against a real
  database, which is what the `?` lines are for.
- The capture loads the app twice and records the second load only, in a new page, so neither the
  login page nor a first load in which Vite optimizes the dependencies of a cold cache reaches it.
  The first page is closed rather than reloaded: on a slow runner it can still be importing modules
  after its network goes quiet, and after a reload those responses reach the capture without an
  initiator, which puts the graph they start (the right pane's, for one) in the startup.
- The allowlists are the startup of the two layouts. A feature that is moved into a layout makes
  the check fail, and the failure lists what it loads: shrink that list first, then add what is
  left with `--update`. Never run `--update` to make a failure go away without reading it.
- Names drop what changes between runs: the content hash of a pre-bundled dependency chunk
  (`preact-*.js`) and the HMR websocket's host and token. They drop the note IDs of the database as
  well (`stableName()` in `analyze-requests.mjs` lists them), so an allowlist never names a note.
- A request that depends on the session (a font fetched only once text is on screen, the notes of
  the open tabs) is written with a leading `?`: it is allowed without being required. `--update`
  keeps those lines.
- What the session has open is left out of the check, since it depends on the session: every
  request with `NoteDetail.tsx`, `NoteList.tsx` or `RightPanelContainer.tsx` on its stack (the
  note's blob, its type widget's or collection view's import graph, the editor's searches and data,
  the previews of the child notes, the widgets of the right pane's open tab), and in turn what those
  modules request. The user's scripts are left out the same way, through `script_context.ts`: the
  script API it imports to run a `#widget` or startup script, with every Preact component a script
  can use (tabulator, FullCalendar, CKEditor), loads only for a user who has such notes. So is the
  idle preload of the common note types (`preloadCommonNoteTypes()` in `note_types.tsx`): which of
  its views an open note has already requested depends on the session. The capture records each request's full stack, async parents included, for
  this; a capture taken before that has no stacks and gets no such exclusion. `NoteDetail`,
  `NoteList`, `RightPanelContainer` and the containers around them stay in the allowlist: they
  load whatever the session has open. What the previews' markup and stylesheets fetch (images, a
  code font) carries no stack, so it is written with a `?`. A module of the allowlist that this
  load requests first, before the app does, still counts as made, and `--update` keeps it; a
  module the app no longer loads at startup but the session's load still requests is therefore
  removed from the allowlist by hand.

## Timing one module graph, without logging in

The capture above needs a session. To weigh a *single* entry point instead — "what does reaching
CKEditor actually cost?" — skip the login entirely: Vite serves module URLs unauthenticated.

- URL form: `http://localhost:8080/assets/v<version>/@fs/<absolute repo path>/…/file.ts`.
- Navigate a blank page to that origin, `setContent("<html><body>")`, then take `performance.now()`
  around `await import(url).catch(() => {})`.
- **The `.catch` is what makes this work.** An ES module graph is fully fetched and instantiated
  before any of it is evaluated, so a module whose *evaluation* throws without a session ("Logged in
  session not found") still yields a valid download-and-instantiate measurement.
- Constructing an editor in that page needs `{ licenseKey: "GPL" }`, or `create()` throws
  `license-key-missing`.

This is how the "first text note is slow" delay was attributed to the module graph rather than to
the editor (dev server, 2026-08): `packages/ckeditor5/src/index.ts` ~290 ms / 216 modules and
`EditableText.tsx` ~355 ms / 328 modules, against `PopupEditor.create()` at 83 ms first and ~25 ms
after. That is why the idle preload (`preloadCommonNoteTypes` in `note_types.tsx`) is the lever —
and why the 428 KB emoji `definitionsUrl` fetch is not a suspect: `EmojiRepository.init()` fires it
without returning the promise, so it never blocks `create()`.

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
  `.cache/vite-<port>/deps/` (each dev instance has its own): `grep -o '"[^"]*node_modules/[^"]*"'
  <chunk>.js.map | ...` and count by
  package. (The 800 KB `es-toolkit`+`mdast`/`hast` chunk is CKEditor's internals, for example.)

## Reference

The default `probe` list is the set of heavy deps that were deliberately made lazy (CKEditor,
highlight.js, KaTeX, codemirror-vim, snapdom, force-graph, the LLM chat graph, ...) — if one of
them reports `LOADED` on a plain board/empty note startup, a regression sneaked in. After the
2026-06 lazy-loading work the new-layout baseline was ~557 requests / 3.75 MB / 500 scripts
(down from 810 / 8.02 MB / 745).

Both eager-load offenders this file used to list have since been fixed (re-verified 2026-08):
`applyModals` in `layout_commons.tsx` now wraps every dialog in `LazyDialog` (a dynamic `import()`
on first summons), keeping only `PopupEditor`, `CallToAction`, `Toast` and `ShortcutHintsPanel`
eager — each with a comment saying why. The Inter font is served as woff2. Don't re-report either
as a finding; measure first.
