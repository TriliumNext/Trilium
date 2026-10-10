---
name: developing-web-clipper
description: Use when working on Trilium's browser extension, the web clipper (`apps/web-clipper`, built with WXT for Chrome MV3 and Firefox MV2) — its background script, content script (Readability, screenshots, toasts), the Preact popup and options page, `wxt.config.ts` (manifest, keyboard `commands`, the Firefox sources zip), or the server side it talks to (`apps/server/src/routes/api/clipper.ts`, `/api/login/token`, the desktop port). Covers the message protocol between the extension's parts, how it finds and authenticates to Trilium, the compatibility rule with older Trilium versions, styling the pages in the Next theme from the client's own stylesheets, running and building it, the `fakeBrowser` spec patterns and the 100% coverage gate, and the traps already hit (undeclared commands, image placeholders, `$&` in `replaceAll()` replacements, `javascript:` links, the sources zip).
---

# Developing the web clipper

`apps/web-clipper` is a browser extension built with [WXT](https://wxt.dev) (0.21, on Vite 8).
One source tree produces two builds: **Chrome, Manifest V3** (`pnpm build`, `.output/chrome-mv3`)
and **Firefox, Manifest V2** (`pnpm build:firefox`, `.output/firefox-mv2`). There is no Safari or
Edge target. The manifest is generated from `wxt.config.ts`; there is no `manifest.json` in the
repository.

## The parts and how they talk

| Entrypoint | Runs in | Does |
|---|---|---|
| `entrypoints/background/index.ts` | service worker (MV3) / background page (MV2) | context menus, keyboard commands, every save, image download, toasts |
| `entrypoints/background/trilium_server_facade.ts` | background | finds Trilium, authenticates, `callService()` |
| `entrypoints/content/index.ts` | every page (`<all_urls>`) | Readability extraction, selection, crop overlay, toast UI |
| `entrypoints/popup/main.tsx` | the toolbar popup | Preact `Popup`: capture buttons, link-with-note form, connection status |
| `entrypoints/options/main.tsx` | the options page | Preact `Options`: desktop port, server login |
| `entrypoints/offscreen/` | MV3 only (Chrome) | crops screenshots on a canvas, since an MV3 service worker has no DOM |

Everything goes through `browser.runtime.sendMessage` / `browser.tabs.sendMessage`, keyed by a
`name` field:

- **popup → background:** `save-cropped-screenshot`, `save-whole-screenshot`, `save-whole-page`,
  `save-link-with-note` (`title`, `content`), `save-tabs`, `trigger-trilium-search`,
  `send-trilium-search-status`, `trigger-trilium-search-note-url`, `openNoteInTrilium` (`noteId`),
  `closeTabs`.
- **background → popup:** `trilium-search-status` (`triliumSearch: TriliumSearchStatus`, which
  starts as `searching`) and `trilium-previously-visited` (`searchNote`). Both types
  are exported from `trilium_server_facade.ts`; the popup imports them.
- **background → content script:** `trilium-save-selection`, `trilium-save-page`,
  `trilium-get-rectangle-for-screenshot` (the content script answers with the payload), and `toast`
  (`message`, `noteId`, `tabIds`).
- **background → offscreen:** `{ type: "CROP_IMAGE" }`, the one message keyed by `type`.

Every user action in the background runs inside `showFailures()`, which turns an exception into a
toast. A new action belongs inside it too, or it fails silently. A toast cannot show on browser
pages or the extension stores, where no content script runs.

## Finding and authenticating to Trilium

- **Desktop first.** `getPort()` returns the port from the options page, or **37840** (production)
  / **37742** (development build). It tries that one port — there is no port scan — with
  `GET http://127.0.0.1:<port>/api/clipper/handshake`, then falls back to the configured server.
  It repeats every 60 seconds, and on the popup's **check** button.
- **Version check.** The handshake returns `protocolVersion` (`CLIPPER_PROTOCOL_VERSION` in
  `packages/trilium-core/src/services/app_info.ts`); the extension compares the major version and
  reports `version-mismatch`.
- **Desktop needs no auth**; the routes rely on the loopback bind and the Host-header check in
  `apps/server/src/services/desktop_network_gate.ts`. **A server needs an ETAPI token**: the options
  page posts the password and the optional TOTP code to `POST /api/login/token`, which creates a
  token named "Trilium Sender / Web Clipper", stored in `browser.storage.sync`.
- **Server routes** are in `apps/server/src/routes/routes.ts` (`/api/clipper/*`) with the handlers
  in `apps/server/src/routes/api/clipper.ts` (spec: `clipper.spec.ts`). They are **server-only**, not
  in `packages/trilium-core`, so the standalone and mobile builds cannot receive clippings.
- The desktop dev script (`apps/desktop/package.json`) currently runs on **37743**, so a dev build of
  the clipper does not find a dev desktop without setting the port in its options.

## Compatibility: the extension outlives the server version

Users update the extension and Trilium independently, so **a change on one side must keep working
against older versions of the other.** Prefer changes that need nothing new from the server.

- `/api/login/token` has verified TOTP since v0.99.0, but only recent servers report which factor
  failed (`{ message, factor }`); older ones answer a 401 with a plain string. That is why the
  options page always shows the optional code field and sends it on the first try, and treats the
  `factor` only as a hint for the error message (`requestToken()` catches the JSON parse failure).
  Asking for the code only after a reported failure would have locked out every older 2FA server.
- The image-failure fix put a failed image's original URL back into the content instead of adding a
  server field, so the server's existing `downloadImages()` retries it on every version.
- `/api/sender/login` (Trilium Sender) shares the token handler; keep its 401 status unchanged.
- A server-side change reaches beyond the clipper spec: `apps/server/src/routes/transport.spec.ts`
  used `/api/login/token` to check plain-text tuple results, and the JSON body broke it. Grep the
  server specs for the route (`grep -rn "api/login/token" apps/server/src apps/server/spec`) and run
  every hit, not only the route's own spec.

## Content and images

- The content script replaces each `<img src>` with a random **20-character placeholder**
  (`randomString(20)`) and lists the images; the background fetches each one into a data URL; the
  server stores them as attachments and rewrites the placeholder. `downloadImages()` in core skips
  20-character URLs on purpose, so **an image left with its placeholder is a broken image**.
  `postProcessImages()` therefore restores the original URL (escaped with `escapeHtml()`) for every
  image it cannot download and reports the count in the toast.
- **A `replaceAll()`/`replace()` replacement built from page data is a callback**
  (`replaceAll(id, () => escapeHtml(src))`). A string replacement reads `$&`, `$$`, `` $` `` and
  `$'` as patterns, so an image URL containing `$&` came back with the placeholder inside it.
- **HTML built by concatenation escapes every page-derived value** with `escapeHtml()` — the
  save-tabs list once put tab titles in raw. Tabs can also lack a `url` (still loading), and
  `new URL("")` throws, so `saveTabs()` filters them out.
- `fetchImage()` rejects a non-OK response and a non-image `Content-Type` — otherwise an error page
  gets saved as the "image".
- Readability (`lib/Readability.js`) is an old vendored copy that the README admits to; Firefox
  review flags its `innerHTML` use.

## The popup and options page: Preact in the Next theme

Both pages are Preact 11 (`preact`, `preact/hooks`), with JSX compiled by `oxc.jsx` in
`wxt.config.ts` and `jsx`/`jsxImportSource` in `tsconfig.json`. Each `index.html` is only a
`#root` and a `<script src="main.tsx">`; `main.tsx` renders the component and also exports it and
its pure helpers (`parseLinkNote`, `textToHtml`, `requestToken`) for the specs.

**Styling follows the share theme's approach** (`packages/share-theme/src/content/app_globals.ts`,
`base.css`): import the client's own stylesheets, carry the Next theme's colors.

- `assets/theme.css`, imported first by both pages, imports
  `@triliumnext/client/src/stylesheets/theme-next/forms.css` (which imports `buttons.css`). Those
  rules style **elements by class**, so use the app's markup:
  - command buttons: `<button className="btn btn-secondary">`, `btn-primary` for the main action,
    `btn btn-sm` for small ones. They only match `button.btn` — an `<input type="submit">` stays
    unstyled.
  - text boxes: plain `<input type="text|password">` and `<textarea>` are styled as they are.
  - check boxes: `<label className="tn-checkbox"><input type="checkbox" /> text</label>`.
- **Colors are copied, not imported.** `theme.css` carries the values of `theme-next-light.css` and
  `theme-next-dark.css` that those stylesheets read, under `:root` and
  `@media (prefers-color-scheme: dark)` — an extension page has no Trilium theme setting. A rule
  reading a new `--variable` needs its light and dark value added there, copied from those files.
  The connection status uses `--status-ok/warning/error-color`, the app's log status colors.
- `theme.css` also adds the bits of Bootstrap's reboot the app relies on (`font: inherit` on form
  controls, button cursor and line height) and the Inter font from `apps/client/src/fonts/Inter/`.
- Per-page CSS (`popup.css`, `options.css`) is nested under the page's root class (`.popup`,
  `.options`) and uses the tokens; no inline styles.
- **Do not expect the client's Preact components to work.** Only dependency-free ones
  (`FormTextBox`, `FormSelect`) can be imported; `Button`, `FormCheckbox`, `NoteAutocomplete` and
  the like pull in `appContext`, froca, i18n or Bootstrap's JS, which an extension page does not
  have. Build the small component the page needs on the same classes.
- Never `href="javascript:"` — Manifest V3's CSP can block it. Use `href="#"` with an `onClick` that
  calls `preventDefault()`.

The cost of the theme: Inter is 349 kB and the shared CSS chunk 24 kB of the build.

## The manifest

- **Keyboard commands must be declared** in `commands` in `wxt.config.ts`. A command the background
  handles but the manifest omits never fires and does not appear on the browser's shortcut page
  (`saveTabs` was missing for years).
- Chrome allows **at most four `suggested_key`s**; declare further commands without one, so users
  bind them themselves (`about:addons` → gear → Manage Extension Shortcuts; `chrome://extensions/shortcuts`).
- The defaults clash with Firefox (`Ctrl+Shift+S` is its screenshot tool).
- `offscreen` is an MV3-only permission and entrypoint (`include`/`exclude` meta in its `index.html`).

## Running, building, releasing

```bash
pnpm --filter web-clipper dev            # Chrome with the extension loaded, hot reload
pnpm --filter web-clipper dev:firefox
pnpm --filter web-clipper build          # .output/chrome-mv3
pnpm --filter web-clipper build:firefox  # .output/firefox-mv2
pnpm --filter web-clipper zip            # store zips (+ sources zip for Firefox: zip:firefox)
```

Check a manifest change in the built `manifest.json`, e.g.
`grep -o '"saveTabs":{[^}]*}' apps/web-clipper/.output/firefox-mv2/manifest.json`.

CI (`.github/workflows/web-clipper.yml`) builds both zips; it runs no tests, so a
`web-clipper-v*` tag ships whatever the tagged commit holds — the tests run only in `dev.yml`, on
pushes and pull requests. **Mozilla's review rebuilds from the
sources zip**, which the `zip:sources:*` hooks assemble from `apps/web-clipper` plus a copied
`tsconfig.base.json` and the Chrome-only offscreen page. Since the pages import
`@triliumnext/client` stylesheets and fonts, those files must go into the sources zip as well — the
hook does not do that yet, so fix it before the next Firefox submission.

To compare bundle sizes with `main`, build it in a temporary `git worktree` (never stash). `main`
may still need dependencies the branch removed (`cash-dom`): give the worktree its own
`node_modules` copy rather than touching the shared one.

## Testing

Specs are Vitest with happy-dom (`vitest.config.mts`, `.ts` and `.tsx`), run with
`pnpm --filter web-clipper test [pattern]`. The extension has no i18n, so strings are asserted
literally.

**Coverage is held at 100%** of lines, statements, functions and branches by the `thresholds` in
`vitest.config.mts`. CI runs the suite in its own `dev.yml` step
(`pnpm run --filter=web-clipper test --coverage`, excluded from "Run the rest of the tests") and
uploads to Codecov under the `web-clipper` flag (`codecov.yml`). Run the same command locally; for
the exact uncovered lines and branches, use the **`analyzing-coverage`** skill on
`apps/web-clipper/test-output/vitest/coverage/lcov.info`. A branch no input can reach is restructured
(narrow the type instead of re-checking it), not tested around.

- **The browser API** is WXT's `fakeBrowser` (`wxt/testing/fake-browser`): call `fakeBrowser.reset()`
  in `beforeEach`, override what the code calls with `Object.assign(fakeBrowser.runtime,
  { sendMessage, openOptionsPage })`, and deliver a message with
  `await fakeBrowser.runtime.onMessage.trigger(message, {})`. `browser.storage.sync` works for real.
- **The background script** is started with `background.main()` after mocking
  `./trilium_server_facade`; its listeners are captured by replacing `addListener`
  (`entrypoints/background/index.spec.ts`). `__MANIFEST_VERSION__` on `globalThis` switches between
  the MV2 and MV3 code paths (see `manifestVersionGlobal()` in `vitest.config.mts`).
- **Preact pages** render with `render(<Popup />, container)` inside `act()` from
  `preact/test-utils`; unmount with `render(null, container)` in `act()`. After an effect starts an
  async storage read, flush with a `setTimeout` inside `act()` before asserting.
- Stub `fetch` with `vi.stubGlobal` and `window.close` with `vi.spyOn` — the popup closes itself.
  happy-dom has no `window.alert`, so `vi.spyOn(window, "alert")` throws; use
  `vi.stubGlobal("alert", vi.fn())`. Undo stubs in `afterEach` (`vi.unstubAllGlobals()`,
  `vi.unstubAllEnvs()`), not at the end of a test, so a failing assertion does not leak them.
- **A mocked `Response` can be read once.** `fetchMock.mockResolvedValue(response)` hands the same
  object to every call, so the second `text()` throws "body already used" and the code takes its
  error path instead of the branch under test. Use `mockImplementation(async () => Response.json(…))`.
- **`document.title = …` creates a `<title>` element**, so it cannot test a page without one; clear
  `document.head` and leave the title unset.
- **The production port** is reached with `vi.stubEnv("DEV", false)`; Vitest runs with `DEV` true.
- **The render into `#root`** at the top of each `main.tsx` is covered by appending a `#root`
  element, calling `vi.resetModules()` and `await import("./main")`.
- When the code came before the spec, break it on purpose a few ways (copy the file to the
  scratchpad, `sed` one change, run, restore with `cp`) and make sure each break fails a test; one
  that passes shows an assertion to add.

Hardcoded English is expected: reviewers (Greptile) cite `CLAUDE.md`'s translation rule, but its
catalogues are the app's. Translating the extension is a project of its own (`_locales` or i18next),
not something to start for a few new strings.

The VS Code TypeScript server can keep showing "Cannot use JSX" after `tsconfig.json` changes;
"TypeScript: Restart TS Server" clears it. `pnpm typecheck` is the authority.

## Documentation

The User Guide page is `docs/User Guide/User Guide/Installation & Setup/Web Clipper.md` (shortcuts,
configuration, the port, two-factor login, failures and missing images). A user-facing change to
the extension updates it in the same commit; follow the **`writing-documentation`** skill and revert
the pages `docs.mjs sync` reformats but you did not touch.
