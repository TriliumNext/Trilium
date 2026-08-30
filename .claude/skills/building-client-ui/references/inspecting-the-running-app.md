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

Fixture gotchas:

- It opens on a **protected** note, so click another note first.
- It runs the **new layout**, so there is no ribbon — the attributes editor opens from the
  `… attributes` button in `.status-bar`.

## Stopping it

Killing the backgrounded `npx tsx` wrapper leaves the node child alive and still holding the port,
so the next boot fails with "Port 37999 is already in use". Kill the listener:

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
