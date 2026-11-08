# Inspecting the running app

Some UI questions cannot be answered from the stylesheets — which rule actually won, why a menu
landed where it did, whether a blur is real or a flat tint. Reasoning about the cascade from the
sources is unreliable enough to have produced wrong diagnoses more than once, because the load
order in a hand-built test page does not match the app's. Measure `getComputedStyle` in a real
instance instead.

## Boot a login-free instance on the e2e fixture

Run the server against the e2e fixture document, entirely in memory, so there is no production
build, no password, and no risk to the user's own data:

```bash
cd apps/server && NODE_ENV=development TRILIUM_ENV=dev TRILIUM_PORT=37999 \
  TRILIUM_DATA_DIR=spec/db \
  TRILIUM_DOCUMENT_PATH=../../packages/trilium-core/src/test/fixtures/document.db \
  TRILIUM_INTEGRATION_TEST=memory TRILIUM_RESOURCE_DIR=src npx tsx ./src/main.ts
```

`TRILIUM_INTEGRATION_TEST=memory` keeps every write in RAM, so `spec/db` stays clean. There is no
login screen. Append `/?mobile` to the URL to force the mobile layout.

**Do not assume the user's own instance is usable instead.** Ports 8080 and 37840 are typically a
share-only server and the *installed* Trilium, not the repo build — and two processes can share one
data directory, which makes cross-process writes look like cache corruption.

## Driving it

Use Playwright imported by **absolute path**
(`file:///…/node_modules/playwright/index.mjs`) — a script written into the scratchpad cannot
resolve `playwright` by name.

`window.glob` is exposed, so most UI can be summoned without clicking through to it:
`glob.appContext.triggerCommand("showOptions")`, `"openInTreePopup"` (with
`{ noteIdOrPath, hoistedNoteId }`), `"showDeleteNotesDialog"`, …, and `glob.froca` for note lookups.

Fixture gotchas:

- It opens on a **protected** note, so click another note first.
- It runs the **new layout**, so there is no ribbon — the attributes editor opens from the
  `… attributes` button in `.status-bar`.
- **On NixOS, Playwright's downloaded browsers fail on libX11.** Launch the system one instead:
  `chromium.launch({ executablePath: "/etc/profiles/per-user/<user>/bin/chromium" })` — the same
  trick as the untracked `apps/server/playwright.config.nixos.ts`.

## Stopping it

Killing the backgrounded `npx tsx` wrapper leaves the node child alive and still holding the port,
so the next boot fails with "Port 37999 is already in use". Kill the listener:

```bash
fuser -k 37999/tcp          # Linux; or: ss -tlnp 'sport = :37999' to find the pid first
```

```powershell
Get-NetTCPConnection -LocalPort 37999 -State Listen | % { Stop-Process -Id $_.OwningProcess -Force }
```

## What to measure once it is up

- **A rule that seems not to apply** — dump `getComputedStyle` on the element, then scan the
  stylesheets with `el.matches(rule.selectorText)` to find what actually set the property. If no
  rule matches, suspect a global selector from the CKEditor theme CSS, which Vite injects app-wide
  the first time a text note renders (see the **ckeditor5-plugin-development** skill,
  `references/conventions.md`). That is the usual cause of "this UI breaks only after opening a
  note".
- **A mispositioned or self-dimming fixed-position menu** — walk the ancestors for `transform`,
  `filter` and `container-type` rather than reading the stylesheets; any of them creates a
  containing block and a stacking context (see "Dropdown menus and the backdrop blur" in `SKILL.md`).

- **A flicker, a ghost or a jump** — a state that lasts one frame cannot be screenshotted reliably.
  Record it instead: start a `requestAnimationFrame` loop in the page that pushes, per frame, the
  rects and row counts of the elements in question onto a `window` array, drive the interaction
  with Playwright, then read the array back and print only the frames that differ. That shows which
  change landed in which frame (a popup placed at the new caret one frame before its rows change).
  Work driven from CodeMirror's `requestMeasure()` runs inside a rAF callback, so an effect it
  schedules lands a full frame later.
- **"It did not do this before"** — measure the old build next to the new one instead of reasoning
  about the diff: `git worktree add --detach <scratch>/wt-main main`, `pnpm install --frozen-lockfile`
  there, and boot it on another port (`TRILIUM_PORT=38000`) with the same fixture. Run the same
  recording against both. Remove the worktree and `fuser -k` both ports afterwards.

**Transient state can vanish between reading it and screenshotting it.** An async re-render between
the `evaluate()` that dumps computed styles and the later `screenshot()` can wipe the state you are
studying (`fancytree-active`, a hover class, an open menu), which reads as "the CSS never painted"
and has produced a wrong diagnosis before. Re-assert the state *at screenshot time*, and pixel-sample
with `pngjs` (available through the e2e require) rather than eyeballing the image.
