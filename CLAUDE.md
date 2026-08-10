# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Trilium Notes is a hierarchical note-taking application with synchronization, scripting, and rich text editing. TypeScript monorepo using pnpm with multiple apps and shared packages.

## Development Commands

```bash
# Setup
corepack enable && pnpm install

# Run
pnpm server:start              # Dev server at http://localhost:8080
pnpm desktop:start             # Electron dev app
pnpm standalone:start          # Standalone client dev

# Build
pnpm client:build              # Frontend
pnpm server:build              # Backend
pnpm desktop:build             # Electron

# Test — run the narrowest thing that covers your change (see below)
pnpm --filter server test <path-or-pattern>    # One package, filtered
pnpm test:all                  # All tests (parallel + sequential) — CI's job, not yours
pnpm test:parallel             # Client + most package tests
pnpm test:sequential           # Server (shared DB) + browser-mode tests (ckeditor5)
pnpm coverage                  # Coverage reports

# Lint & Format
pnpm dev:format-check          # Format check (stricter stylistic rules)
pnpm dev:format-fix            # Format fix
pnpm typecheck                 # TypeScript type check across all projects
```

**Running a single test file**: `pnpm --filter server test spec/etapi/search.spec.ts`

### Do not run full suites or ESLint

- **Never run ESLint** — `pnpm dev:linter-check`, `dev:linter-fix`, or `npx eslint` on any path. It currently dies with an out-of-memory error, so a run tells you nothing and costs minutes. CI lints. (Note `packages/*` is globally ignored by the ESLint config anyway, so most of `trilium-core` was never linted locally to begin with.)
- **Never run `pnpm test:all`, `test:parallel`, `test:sequential`, or `pnpm coverage`** during development. They take a long time, and CI runs them on every push.
- **Run the narrowest suite that covers what you touched**, and iterate on that: `pnpm --filter <pkg> test <path-or-pattern>`. Vitest treats the trailing argument as a substring filter over test file paths, so `pnpm --filter server test special_notes` runs every matching spec.
- **Typecheck with `pnpm typecheck`, not a raw `tsc` invocation.** It resolves the project references and per-project configs that a hand-written `tsc --noEmit -p …` or `tsc -b …` gets wrong. It drives the native compiler, so even a full check of every project is a few seconds — cheap enough to run whenever you finish a change.
- Core specs are the one case where "narrowest" means **two** commands: they run under both the server and standalone suites (see Testing below), so a targeted run against each is still the right scope.
- Only reach for a full suite if the user asks, or when the work is finished and they want a final check.

## Git Workflow

- **Committing directly on `main` is allowed and expected** for small fixes and self-contained features — do **not** create a branch first for those. The default "branch before committing on the default branch" rule does not apply to this repository.
- **Large or risky work goes on a branch**: multi-commit features, migrations, refactors spanning many packages, anything that needs review or a PR before landing.
- Only commit when explicitly asked to in that message; leave changes staged/unstaged for review otherwise.

## Main Applications

- **client** (`apps/client/`): Preact frontend with jQuery widget system. Shared UI layer used by both server and desktop.
- **server** (`apps/server/`): Node.js backend (Express, better-sqlite3). Serves the client and provides REST/WebSocket APIs.
- **desktop** (`apps/desktop/`): Electron wrapper around server + client, running both in a single process.
- **standalone** (`apps/standalone/` + `apps/standalone-desktop/`): Runs the entire stack in the browser — server logic compiled to WASM via sql.js, executed in a service worker. No Node.js dependency at runtime.

**`packages/trilium-core/` is shared by server, desktop and standalone — *not* by the client.** `apps/client` neither depends on it nor imports it (zero `@triliumnext/core` imports); it reaches the backend over REST/WebSocket and shares only **types**, via `@triliumnext/commons`. The split that matters is backend-vs-frontend, not Node-vs-browser: standalone runs core in a browser worker, which is why core carries the no-Node-built-ins rules below.

Practical consequences:
- A dependency added to core lands in the **server, desktop and standalone** bundles. It does **not** reach the client, so "the client would pay for it" is never an argument for or against putting something in core — the argument is standalone's worker, which imports core at startup.
- Frontend code cannot call a core function. Anything the client needs is either an API route or a type in `@triliumnext/commons`.

## Monorepo Structure

```
apps/
  client/               # Preact frontend (shared by server, desktop, standalone)
  server/               # Node.js backend (Express, better-sqlite3)
  desktop/              # Electron (bundles server + client)
  standalone/           # Standalone client (WASM + service workers, no Node.js)
  standalone-desktop/   # Standalone desktop variant
  web-clipper/          # Browser extension
  website/              # Project website
  db-compare/, dump-db/, edit-docs/, build-docs/, icon-pack-builder/

packages/
  trilium-core/         # Core business logic: entities, services, SQL, sync
  commons/              # Shared interfaces and utilities
  trilium-e2e/          # Shared Playwright E2E tests
  ckeditor5/            # Custom rich text editor bundle
  codemirror/           # Code editor integration
  highlightjs/          # Syntax highlighting
  share-theme/          # Theme for shared/published notes
  pdfjs-viewer/, splitjs/
  turndown-plugin-gfm/
```

Use `pnpm --filter <package-name> <command>` to run commands in specific packages.

## Core Architecture

### Three-Layer Cache System

All data access goes through cache layers — never bypass with direct DB queries:

- **Becca** (`packages/trilium-core/src/becca/`): Server-side entity cache. Access via `becca.notes[noteId]`.
- **Froca** (`apps/client/src/services/froca.ts`): Client-side mirror synced via WebSocket. Access via `froca.getNote()`.
- **Shaca** (`apps/server/src/share/`): Optimized cache for shared/published notes.

**Critical**: Always use cache methods, not direct DB writes. Cache methods create `EntityChange` records needed for synchronization.

### Entity System

Core entities live in `packages/trilium-core/src/becca/entities/` (not `apps/server/`):

- `BNote` — Notes with content and metadata
- `BBranch` — Multi-parent tree relationships (cloning supported)
- `BAttribute` — Key-value metadata (labels and relations)
- `BRevision` — Version history
- `BOption` — Application configuration
- `BBlob` — Binary content storage

Entities extend `AbstractBeccaEntity<T>` with built-in change tracking, hash generation, and date management.

### Entity Change & Sync Protocol

Every entity modification creates an `EntityChange` record driving sync:
1. Login with HMAC authentication (document secret + timestamp)
2. Push changes → Pull changes → Push again (conflict resolution)
3. Content hash verification with retry loop

Sync services: `packages/trilium-core/src/services/sync.ts`, `syncMutexService`, `syncUpdateService`.

### Widget-Based UI

Frontend widgets in `apps/client/src/widgets/`:
- `BasicWidget` / `TypedBasicWidget` — Base classes (jQuery `this.$widget` for DOM)
- `NoteContextAwareWidget` — Responds to note changes
- `RightPanelWidget` — Sidebar widgets with position ordering
- Type-specific widgets in `type_widgets/` directory

**Widget lifecycle**: `doRenderBody()` for initial render, `refreshWithNote()` for note changes, `entitiesReloadedEvent({loadResults})` for entity updates. Uses jQuery — don't mix React patterns.

#### Reusable Preact Components
Common UI components are available in `apps/client/src/widgets/react/` — **always** reuse these instead of writing raw HTML elements or custom implementations:
- `NoItems` - Empty state placeholder with icon and message (use for "no results", "too many items", error states)
- `ActionButton` - Consistent button styling with icon support
- `FormTextBox` - Text input with validation and controlled input handling; `FormTextBoxWithUnit` for inputs with a unit suffix (e.g. "mm", "px")
- `FormSelect` - Dropdown/combobox taking an object array as data
- `Slider` - Range slider with label
- `Checkbox`, `RadioButton` - Form controls
- `Collapsible` - Expandable content section (animated, theme-styled); `ExternallyControlledCollapsible` is the controlled variant (caller owns `expanded`/`setExpanded`) vs. `Collapsible`'s self-managed `initiallyExpanded`
- `ColorPicker` - Color picker combining preset swatches with the browser's native `<input type="color">`; value is a CSS color string (`onChange(null)` clears). A controlled, flat swatch row — wrap it in a `Dropdown` to get a popover, or use it inline; don't hand-roll a color palette from scratch. `NoteColorPicker` is the note-bound variant that reads/writes the note's `color` label
- `Badge` - Colored pill/label with optional icon, tooltip, and `onClick` (for counts, status flags). Set its color via the `--color` CSS variable on a wrapper class (not inline styles); pass `outline` for a colored-border/transparent-fill variant instead of a solid background. `BadgeWithDropdown` pairs a badge with a dropdown menu. Don't hand-roll pill/badge markup — reuse it
- `Table` - Generic [Tabulator](https://tabulator.info/)-based data grid (`columns`, `data`, `events`, `modules`, `tabulatorRef`; props typed via `TableProps<T>`). Decoupled from the note/collection model — deals purely in columns/data/events, so use it for any grid (e.g. the SQL console results, the note collection table view). Prefer it over instantiating `tabulator-tables` directly
- `Calendar` - Generic [FullCalendar](https://fullcalendar.io/) wrapper (accepts any `CalendarOptions` plus a `calendarRef`; props typed via `CalendarProps`). Decoupled from the note/collection model — deals purely in FullCalendar options, so use it for any calendar rather than instantiating `@fullcalendar/core` directly
- `Dropdown` - Bootstrap dropdown wrapper (toggle button + menu, with `FormListItem`/`FormDropdownDivider` as the items). **Pass `noDropdownListStyle` unless the menu actually scrolls** — see "Dropdown menus and the backdrop blur" below

Fluent builder pattern: `.child()`, `.class()`, `.css()` chaining with position-based ordering.

**Do not use Bootstrap utility classes** (e.g. `form-control-sm`, `form-select-sm`, `input-group`) on these components — they manage their own styling internally. If you need to adjust sizing or layout, use props provided by the component or CSS custom properties, not Bootstrap overrides.

#### Component Styling
- **Avoid inline styles** — do not use the `style` attribute/prop on JSX elements unless absolutely necessary (e.g. a truly dynamic, computed value that cannot be expressed in CSS). Static layout, sizing, spacing, and visual properties must go in CSS.
- **Per-component CSS files**: each component should have a matching `.css` file (e.g. `my_dialog.tsx` → `my_dialog.css`), imported at the top of the component file.
- **CSS nesting for scoping**: since CSS modules are not available, scope styles using a root class and native CSS nesting. For example, a dialog with `className="my-dialog"` should have its styles nested under `.modal.my-dialog { … }`.
- **Reuse existing components** instead of building custom markup — prefer `FormTextBox`, `FormTextBoxWithUnit`, `FormSelect`, `Slider`, `Button`, etc. over hand-rolled `<input>`, `<select>`, or `<button>` elements.

#### Dropdown menus and the backdrop blur
The Next theme frosts every `.dropdown-menu` with `backdrop-filter`, but it does so along **two different paths**, and only one of them is reliable:

- **`::before` layer** (default for a menu *without* `tn-dropdown-list`) — the blur lives on a background-less pseudo-element at `z-index: -1`. This one works everywhere.
- **Element-level filter** (what the `tn-dropdown-list` class switches to) — the blur is put on the menu element itself, which also paints a translucent background. This exists only because a **scrollable** menu can't use the pseudo: it would scroll away with the content. Opened inside the note's scrolling content area, this filter silently does nothing, and the menu degrades to its bare ~85 %-alpha background — i.e. it reads as see-through over anything dark. `body.background-effects` already forces such menus to an opaque fallback for the same underlying reason (see the comment in `theme-next/base.css`).

`Dropdown` adds `tn-dropdown-list` **by default**, so a new menu opts into the fragile path unless you say otherwise:

- Pass **`noDropdownListStyle`** on any menu that doesn't scroll — that is nearly every action/`[…]` menu. `NoteActions`, the global menu, the note-icon picker and `HelpDropdown` all do.
- Pass **`portalToBody`** instead when the menu is fine but an *ancestor* establishes a containment/backdrop root (`container-type`, `transform`, `filter` — e.g. the peeked right pane), which flattens the blur into a flat tint.
- If a menu looks transparent rather than frosted, check these two before reaching for CSS overrides.

#### API Architecture
- **Internal API**: REST endpoints in `apps/server/src/routes/api/`
- **ETAPI**: External API for third-party integrations (`apps/server/src/etapi/`)
- **WebSocket**: Real-time synchronization (`apps/server/src/services/ws.ts`)

### API Architecture

- **Internal API** (`apps/server/src/routes/api/`): REST endpoints, trusts frontend
- **ETAPI** (`apps/server/src/etapi/`): External API with basic auth tokens — maintain backwards compatibility
- **WebSocket** (`apps/server/src/services/ws.ts`): Real-time sync

### Platform Abstraction

`packages/trilium-core/src/services/platform.ts` defines `PlatformProvider` interface with implementations in `apps/desktop/`, `apps/server/`, and `apps/standalone/`. Singleton via `initPlatform()`/`getPlatform()`.

**PlatformProvider** provides:
- `crash(message)` — Platform-specific fatal error handling
- `getEnv(key)` — Environment variable access (server/desktop use `process.env`, standalone maps URL query params like `?safeMode` → `TRILIUM_SAFE_MODE`)
- `isElectron`, `isMac`, `isWindows` — Platform detection flags

**Critical rules for `trilium-core`**:
- **No `process.env` in core** — use `getPlatform().getEnv()` instead (not available in standalone/browser)
- **No `import path from "path"` in core** — Node's `path` module is externalized in browser builds. Use `packages/trilium-core/src/services/utils/path.ts` for `extname()`/`basename()` equivalents
- **No Node.js built-in modules in core** — core runs in both Node.js and the browser (standalone). Use platform-agnostic alternatives or platform providers
- **Platform detection via functions** — `isElectron()`, `isMac()`, `isWindows()` from `utils/index.ts` are functions (not constants) that call `getPlatform()`. They can only be called after `initializeCore()`, not at module top-level. If used in static definitions, wrap in a closure: `value: () => isWindows() ? "0.9" : "1.0"`
- **Barrel import caution** — `import { x } from "@triliumnext/core"` loads ALL core exports. Early-loading modules like `config.ts` should import specific subpaths (e.g. `@triliumnext/core/src/services/utils/index`) to avoid circular dependencies or initialization ordering issues
- **Electron custom protocol** — In desktop mode, the renderer loads the UI and makes API calls via the `trilium-app://` custom protocol (not HTTP). `apps/desktop/src/protocol.ts` dispatches these requests into the Express app running in the main process; the dispatcher tags them via `apps/server/src/services/electron_request.ts` so auth/CSRF middleware can distinguish them from external TCP traffic

### Mobile (Capacitor) request routing — Android vs iOS

The mobile app (`apps/mobile/`) wraps the standalone WASM stack in a Capacitor WebView. There is no network backend; the client's API/sync calls (`/api`, `/sync`, `/bootstrap`, `/search`) reach the in-process worker via **two platform-specific request paths**:
- **Android**: `androidScheme: "https"` works → the app runs at `https://localhost` → the **service worker** (`apps/standalone/src/sw.ts`) routes those requests to the worker.
- **iOS**: the app runs at **`capacitor://localhost`**, where service workers cannot register, so `apps/standalone/src/main.ts` installs **fetch/XHR/image interceptors** (gated on `location.protocol === "capacitor:"`) instead.

**`iosScheme: "https"` is a no-op on iOS and must not be re-added.** Capacitor rejects it — `CAPInstanceDescriptor.normalize()` checks `WKWebView.handlesURLScheme(scheme) == false`, and WKWebView reserves `http`/`https`, so the scheme is reset to the default `capacitor`. The config line only misleads (it implies an https origin that never exists on iOS). **Do not delete the iOS interceptor path as "dead code"** — it is the only working request path on iOS; a code reviewer assuming `iosScheme:https` ⇒ https origin will wrongly flag it.

### Binary Utilities

Use utilities from `packages/trilium-core/src/services/utils/binary.ts` for string/buffer conversions instead of manual `TextEncoder`/`TextDecoder` or `Buffer.from()` calls:

- **`wrapStringOrBuffer(input)`** — Converts `string` to `Uint8Array`, returns `Uint8Array` unchanged. Use when a function expects `Uint8Array` but receives `string | Uint8Array`.
- **`unwrapStringOrBuffer(input)`** — Converts `Uint8Array` to `string`, returns `string` unchanged. Use when a function expects `string` but receives `string | Uint8Array`.
- **`encodeBase64(input)`** / **`decodeBase64(input)`** — Base64 encoding/decoding that works in both Node.js and browser.
- **`encodeUtf8(string)`** / **`decodeUtf8(buffer)`** — UTF-8 encoding/decoding.

Import via `import { binary_utils } from "@triliumnext/core"` or directly from the module.

### Database

SQLite via `better-sqlite3`. SQL abstraction in `packages/trilium-core/src/services/sql/` with `DatabaseProvider` interface, prepared statement caching, and transaction support.

- Schema: `apps/server/src/assets/db/schema.sql`
- Migrations: `apps/server/src/migrations/YYMMDD_HHMM__description.sql`

### Testing Strategy
- Server tests run sequentially due to shared database
- Client tests can run in parallel
- E2E tests use Playwright for both server and desktop apps
- Build validation tests check artifact integrity
- **Browser-mode tests** (`packages/ckeditor5`) drive a real headless Chrome via `@vitest/browser-webdriverio`, which downloads its own Chrome and chromedriver. Where those cannot run (NixOS: they die on a missing `libxcb.so.1`), set `CHROME_BIN` and `CHROMEDRIVER_PATH` to a system pair of matching versions — `nix develop` exports both. Never start a chromedriver by hand or add a local override config; see `docs/Developer Guide/Developer Guide/Testing.md`
- **Write concise tests**: Group related assertions together in a single test case rather than creating many one-shot tests
- **Extract and test business logic**: When adding pure business logic (e.g., data transformations, migrations, validations), extract it as a separate function and always write unit tests for it

### Internationalization
- Translation files in `apps/client/src/translations/`
- Supported languages: English, German, Spanish, French, Romanian, Chinese
- **Only add new translation keys to `en/translation.json`** — translations for other languages are managed via Weblate and will be contributed by the community
- Third-party components (e.g., mind-map context menu) should use i18next `t()` for their labels, with the English strings added to `en/translation.json` under a dedicated namespace (e.g., `"mind-map"`)
- When a translated string contains **interpolated components** (e.g. links, note references) whose order may vary across languages, use `<Trans>` from `react-i18next` instead of `t()`. This lets translators reorder components freely (e.g. `"<Note/> in <Parent/>"` vs `"in <Parent/>, <Note/>"`)
- When adding a new locale, follow the step-by-step guide in `docs/Developer Guide/Developer Guide/Concepts/Internationalisation  Translations/Adding a new locale.md`
- **Server-side translations** (e.g. hidden subtree titles) go in `apps/server/src/assets/translations/en/server.json`, not in the client `translation.json`

#### Client vs Server Translation Usage
- **Client-side**: `import { t } from "../services/i18n"` with keys in `apps/client/src/translations/en/translation.json`
- **Server-side**: `import { t } from "i18next"` with keys in `apps/server/src/assets/translations/en/server.json`
- **Electron main process** (e.g. `apps/desktop/src/`): `import { t } from "i18next"` — uses server-side keys from `apps/server/src/assets/translations/en/server.json` (same as server-side). **Never hardcode user-facing strings** in Electron dialogs, tray menus, or IPC handlers — always use `t()`.
- **`packages/trilium-core`**: `import { t } from "i18next"` — also the server catalog. Despite the name, `server.json` is the catalog for **every** non-browser-UI runtime, standalone included: `apps/standalone/src/lightweight/translation_provider.ts` initialises i18next in the worker with `ns: "server"` and fetches `server-assets/translations/{{lng}}/server.json`, which `apps/standalone/vite.config.mts` populates by copying `apps/server/src/assets/**/*`. So a `t()` call added to core resolves in server, desktop **and** standalone with no extra work — don't assume a core string needs relocating or a fallback to run in the browser build. (That copy excludes `doc_notes/en/User Guide/**`, so the in-app User Guide itself is *not* in the standalone build.)
- **Interpolation**: Use `{{variable}}` for normal interpolation; use `{{- variable}}` (with hyphen) for **unescaped** interpolation when the value contains special characters like quotes that shouldn't be HTML-escaped

#### Text Editor (`packages/ckeditor5`) Translation Usage
The rich-text editor does **not** use i18next keys in plugin code. A plugin passes the **English text itself** to CKEditor's own translation function, and that text *is* the message id:

```ts
const t = editor.t;                 // or locale.t, or this.t inside a View
t("Insert a table.");
t("Insert footnote %0", index);     // %0/%1 placeholders — never a template literal
```

With no dictionary configured (a test, a standalone editor) the message id renders, so the UI is always correct English rather than a raw key. To translate it, add the English entry under `text-editor.ck` in `apps/client/src/translations/en/translation.json`, keyed by the **slug of the English text** (lowercase, every run of non-alphanumerics collapsed to `-`):

```jsonc
"text-editor": { "ck": { "insert-a-table": "Insert a table." } }
```

That is the whole procedure — call site plus English entry. `apps/client/src/services/i18n.spec.ts` enforces it in **both** directions by scanning the editor package's source, so a missing entry and a stale one both fail.

Rules specific to this mechanism:

- **The function must be named `t`.** The scan matches `\bt\(` followed by a quoted literal, so `translate("Save")` or `_t("Save")` is invisible and the string silently stays English in every locale. Name the local or parameter `t` (`.t(` matches too, e.g. `editor.t(…)`).
- **The first argument must be a literal.** `t(definition.title)` is invisible for the same reason. Where labels would otherwise live in a table, use a switch with a literal at each call — see `getAdmonitionTitle()`, `getLinkDisplayModeLabel()`, `getBoxSizeLabel()`.
- **Never add an entry for a string CKEditor already translates.** Our dictionary is merged *after* the core one, so an entry overrides upstream in every locale. Still call `t()` — CKEditor's own catalog resolves it. Check before adding:
  `node --input-type=module -e "const c=(await import('ckeditor5/translations/de.js')).default; console.log(new Set(Object.keys(c.de.dictionary)).has('Save'))"`
- **Renaming an upstream string** (Trilium calls CKEditor's bookmarks "anchors") is the one case where id and text differ: add the pair to `MESSAGE_OVERRIDES` in `packages/ckeditor5/src/messages.ts` and give the replacement its own English entry.
- **Code that runs before an editor exists** (the slash-command definitions) uses `translateMessage(hostTranslate, message, values)` from `messages.ts` — same lookup and same `%0` substitution, minus the editor.
- **A keystroke inside a message** comes from `renderShortcut(editor, SHORTCUT)` (`packages/ckeditor5/src/shortcut.ts`). Key names live in the app-wide `keyboard_shortcut_keys` catalog, which the command palette and help dialog share; don't resolve them inside the package.
- There is no `config.translate` bridge and no `lang/*.po` catalogs any more — both were removed. Any doc or plugin still describing them is stale.

### Electron Desktop App
- Desktop entry point: `apps/desktop/src/main.ts`, window management: `apps/desktop/src/services/window.ts`
- **Security**: `nodeIntegration` is **disabled** and `contextIsolation` is **enabled**. The renderer has no access to Node.js APIs or Electron internals.
- **Preload script** (`apps/desktop/src/preload.ts`): Uses `contextBridge.exposeInMainWorld("electronApi", ...)` to expose a whitelisted API to the renderer. Compiled to CJS via esbuild (dev: `scripts/electron-start.mts`, prod: `apps/desktop/scripts/build.ts`).
- **ElectronApi interface** (`packages/commons/src/lib/electron_api_interface.ts`): Shared type definition used by both the preload script (`satisfies ElectronApi`) and the client (`window.electronApi`). Grouped into sub-objects: `window`, `clipboard`, `shell`, `contextMenu`, `spellcheck`, `tray`, `printing`, `navigation`.
- **Client-side access**: Use `window.electronApi?.group.method()` — never use `require("electron")` or `dynamicRequire()` in client code.
- **Adding new Electron APIs**: Add the method to the interface in commons, implement it in `preload.ts`, add the IPC handler in `apps/desktop/src/services/window.ts`, and add a test in `apps/desktop/spec/preload.spec.ts`.
- **IPC handlers**: Use `electron.ipcMain.on(channel, handler)` for fire-and-forget, `electron.ipcMain.handle(channel, handler)` for async request/response, `ipcMain.on` + `event.returnValue` for synchronous queries.
- Electron-only features should check `isElectron()` from `apps/client/src/services/utils.ts` (client) or `utils.isElectron` (server)
- **`@electron/remote` is removed** — do not use it. All renderer↔main communication goes through the preload bridge.
- **Spurious `electron.app is undefined` error** — when running Electron-based apps (`pnpm desktop:start`, `pnpm edit-docs:edit-docs`, etc.), the console may print `TypeError: Cannot read properties of undefined (reading 'commandLine')` from `apps/desktop/src/main.ts` (the `app.commandLine.appendSwitch("disable-http-cache")` line). This is **not a real failure** — the app runs correctly. Do not try to fix it, guard it, or investigate electron initialization order unless the user explicitly raises it as a bug.
- **`ELECTRON_RUN_AS_NODE` leak crashes Electron launches** — shells spawned by Electron-based tools (the VS Code extension host, AI coding agents running inside it) often inherit `ELECTRON_RUN_AS_NODE=1`. With it set, launching the desktop app (`pnpm desktop:start`, `pnpm --filter desktop start-prod`, `electron dist`) crashes at startup with `TypeError: Not running in an Electron environment!` (thrown by `electron-is-dev`, because `require("electron")` resolves to the npm stub's path string instead of the built-in module). This is an environment problem, not an app bug — unset the variable before launching: `Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue` (PowerShell) or `unset ELECTRON_RUN_AS_NODE` (bash).

Three inheritance mechanisms:
1. **Standard**: `note.getInheritableAttributes()` walks parent tree
2. **Child prefix**: `child:label` on parent copies to children
3. **Template relation**: `#template=noteNoteId` includes template's inheritable attributes

### Attribute Inheritance

Use `note.getOwnedAttribute()` for direct, `note.getAttribute()` for inherited.
### Client-Side API Restrictions
- **Do not use `crypto.randomUUID()`** or other Web Crypto APIs that require secure contexts - Trilium can run over HTTP, not just HTTPS
- Use `randomString()` from `apps/client/src/services/utils.ts` for generating IDs instead

### Storing User Preferences
- **Do not use `localStorage`** for user preferences — Trilium has a synced options system that persists across devices
- To add a new user preference:
  1. Add the option type to `OptionDefinitions` in `packages/commons/src/lib/options_interface.ts`
  2. Add a default value in `apps/server/src/services/options_init.ts` in the `defaultOptions` array
  3. **Whitelist the option** in `apps/server/src/routes/api/options.ts` by adding it to the `ALLOWED_OPTIONS` array — **without this, the API will reject changes with "Option 'X' is not allowed to be changed"**
  4. If the option should be user-editable in the UI, add a control in the appropriate settings component (e.g., `apps/client/src/widgets/type_widgets/options/other.tsx`) and a translation key in `apps/client/src/translations/en/translation.json`
  5. Use `useTriliumOption("optionName")` hook in React components to read/write the option
- Available hooks: `useTriliumOption` (string), `useTriliumOptionBool`, `useTriliumOptionInt`, `useTriliumOptionJson`
- See `docs/Developer Guide/Developer Guide/Concepts/Options/Creating a new option.md` for detailed documentation

### Shared Types Policy
- Types shared between client and server belong in `@triliumnext/commons` (`packages/commons/src/lib/`)
- Import shared types directly from `@triliumnext/commons` - do not re-export them from app-specific modules
- Keep app-specific types (e.g., `LlmProvider` for server, `StreamCallbacks` for client) in their respective apps

## Important Patterns

- **Protected notes**: Check `note.isContentAvailable()` before accessing content; use `note.getTitleOrProtected()` for safe title access
- **Long operations**: Use `TaskContext` for progress reporting via WebSocket
- **Event system** (`packages/trilium-core/src/services/events.ts`): Events emitted in order (notes → branches → attributes) during load for referential integrity
- **Search**: Expression-based, scoring happens in-memory — cannot add SQL-level LIMIT/OFFSET without losing scoring
- **Widget cleanup**: Unsubscribe from events in `cleanup()`/`doDestroy()` to prevent memory leaks

## Code Style

- 4-space indentation, semicolons always required
- Double quotes (enforced by format config)
- Max line length: 100 characters
- Unix line endings
- Import sorting via `eslint-plugin-simple-import-sort`
- **Never use the TypeScript non-null assertion operator (postfix `!`)** — including in tests. Narrow instead: optional chaining (`?.`), a `?? fallback`, an explicit null check before use, or an `*OrThrow` accessor (e.g. `becca.getNoteOrThrow(id)` rather than `becca.getNote(id)!`).
- **Helper placement** — when extracting a standalone helper function from a component, widget, hook, or route, place it **below** the primary export it supports (or in a separate module), not wedged between the imports and the main definition. Keep the file's primary export near the top so the entry point reads first; supporting helpers follow it.

## Testing

- **Server tests** (`apps/server/spec/`): Vitest, must run sequentially (shared DB), forks pool, max 6 workers
- **Client tests** (`apps/client/src/`): Vitest with happy-dom environment, can run in parallel
- **Core tests** (`packages/trilium-core/src/**/*.spec.ts`): `trilium-core` has no runner of its own — the **server and standalone suites both include** its specs (`apps/server/vite.config.mts`, `apps/standalone/vite.config.mts`) and run them against different platform providers (node + better-sqlite3 vs. happy-dom + sql.js WASM). Green under `pnpm --filter server test` is **not** proof; run `pnpm --filter standalone test` as well. See the `writing-unit-tests` skill for the cross-runtime traps
- **E2E tests** (`packages/trilium-e2e/`): Shared Playwright tests, run via `pnpm --filter server e2e` or `pnpm --filter standalone e2e`
- **ETAPI tests** (`apps/server/spec/etapi/`): External API contract tests

## Documentation

- Script API reference — Generated by `apps/build-docs` (TypeDoc) into the gitignored `site/script-api/{backend,frontend,electron}` and published to [docs.triliumnotes.org](https://docs.triliumnotes.org/). Not committed; never hand-edit — it's regenerated from the script API type definitions
- `docs/User Guide/` — Edit via `pnpm edit-docs:edit-docs`, not manually
- `docs/Developer Guide/` and `docs/Release Notes/` — Safe for direct Markdown editing

## Key Entry Points

- `apps/server/src/main.ts` — Server startup
- `apps/client/src/desktop.ts` — Client initialization
- `packages/trilium-core/src/becca/becca.ts` — Backend data management
- `apps/client/src/services/froca.ts` — Frontend cache
- `apps/server/src/routes/routes.ts` — API route registration
- `packages/trilium-core/src/services/sql/sql.ts` — Database abstraction

### Adding Hidden System Notes
The hidden subtree (`_hidden`) contains system notes with predictable IDs (prefixed with `_`). Defined in `apps/server/src/services/hidden_subtree.ts` via the `HiddenSubtreeItem` interface from `@triliumnext/commons`.

1. Add the note definition to `buildHiddenSubtreeDefinition()` in `apps/server/src/services/hidden_subtree.ts`
2. Add a translation key for the title in `apps/server/src/assets/translations/en/server.json` under `"hidden-subtree"`
3. The note is auto-created on startup by `checkHiddenSubtree()` — uses deterministic IDs so all sync cluster instances generate the same structure
4. Key properties: `id` (must start with `_`), `title`, `type`, `icon` (format: `bx-icon-name` without `bx ` prefix), `attributes`, `children`, `content`
5. Use `enforceAttributes: true` to keep attributes in sync, `enforceBranches: true` for correct placement, `enforceDeleted: true` to remove deprecated notes
6. For launcher bar entries, see `hidden_subtree_launcherbar.ts`; for templates, see `hidden_subtree_templates.ts`

### Writing to Notes from Server Services
- `note.setContent()` requires a CLS (Continuation Local Storage) context — wrap calls in `cls.init(() => { ... })` (from `apps/server/src/services/cls.ts`)
- Operations called from Express routes already have CLS context; standalone services (schedulers, Electron IPC handlers) do not

### Adding New LLM Tools
Tools are defined using `defineTools()` in `apps/server/src/services/llm/tools/` and automatically registered for both the LLM chat and MCP server.

1. Add the tool definition in the appropriate module (`note_tools.ts`, `attribute_tools.ts`, `attachment_tools.ts`, `hierarchy_tools.ts`) or create a new module
2. Each tool needs: `description`, `inputSchema` (Zod), `execute` function, and optionally `mutates: true` for write operations
3. If creating a new module, wrap tools in `defineTools({...})` and add the registry to `allToolRegistries` in `tools/index.ts`
4. Add a client-side friendly name in `apps/client/src/translations/en/translation.json` under `llm.tools.<tool_name>` — use **imperative tense** (e.g. "Search notes", "Create note", "Get attributes"), not present continuous
5. Use ETAPI (`apps/server/src/etapi/`) as inspiration for what fields to expose, but **do not import ETAPI mappers** — inline the field mappings directly in the tool so the LLM layer stays decoupled from the API layer

### Updating PDF.js
The viewer under `packages/pdfjs-viewer/viewer/` is vendored from the pdf.js GitHub release matching the `pdfjs-dist` dependency, and pdf.js refuses to start when the two versions disagree — so a bump must always be followed by a re-vendor. `src/vendored_viewer.spec.ts` fails when they drift.

**This is automated**: the weekly `update-pdfjs-viewer` workflow bumps `pdfjs-dist`, re-vendors, verifies, and opens a single PR carrying both. Renovate is deliberately disabled for `pdfjs-dist` (see `renovate.json`) because a bare version bump is never usable on its own. To do it by hand:
1. Update the `pdfjs-dist` version in `packages/pdfjs-viewer/package.json`
2. Run `pnpm --filter pdfjs-viewer update-viewer`
3. Run `pnpm --filter pdfjs-viewer test` and `pnpm --filter pdfjs-viewer e2e` to verify
4. Commit all changes including the updated viewer files

`update-viewer.ts` re-applies our patches to `viewer.html` (custom stylesheet/script, relaxed `style-src-elem` CSP) and throws if an upstream markup change means it can no longer find them.

### Database Migrations
- Add migration scripts in `apps/server/src/migrations/`
- Update schema in `apps/server/src/assets/db/schema.sql`

### Server-Side Static Assets
- Static assets (templates, SQL, translations, etc.) go in `apps/server/src/assets/`
- Access them at runtime via `RESOURCE_DIR` from `apps/server/src/services/resource_dir.ts` (e.g. `path.join(RESOURCE_DIR, "llm", "skills", "file.md")`)
- **Do not use `import.meta.url`/`fileURLToPath`** to resolve file paths — the server is bundled into CJS for production, so `import.meta.url` will not point to the source directory
- **Do not use `__dirname` with relative paths** from source files — after bundling, `__dirname` points to the bundle output, not the original source tree

## MCP Server
- Trilium exposes an MCP (Model Context Protocol) server at `http://localhost:8080/mcp`, configured in `.mcp.json`
- The MCP server is **only available when the Trilium server is running** (`pnpm run server:start`)
- It requires an ETAPI token on every request — create one in Options → ETAPI and export it as `TRILIUM_ETAPI_TOKEN` before starting Claude Code (`.mcp.json` reads that variable). Without it the endpoint answers `401`
- It provides tools for reading, searching, and modifying notes directly from the AI assistant
- Use it to interact with actual note data when developing or debugging note-related features

## Build System Notes
- Uses pnpm for monorepo management
- Vite for fast development builds
- ESBuild for production optimization
- pnpm workspaces for dependency management
- Docker support with multi-stage builds

### Two TypeScript versions, on purpose
The root `package.json` declares **both** `typescript` (6.x) and `@typescript/native` (an alias of `typescript@7`). Do not "deduplicate" them by bumping `typescript` to 7:

- **`typescript` 6.x is the library.** TypeScript 7 is the native Go port and its package no longer exports the JS compiler API (`exports["."]` is just a version stub). Everything that does `require("typescript")` needs 6.x: TypeDoc, typescript-eslint, and — the one that also ships to users — `packages/codemirror`, which runs the real language service in the browser for script-note IntelliSense.
- **`@typescript/native` is the compiler binary**, used only by `scripts/filter-tsc-output.mts` behind `pnpm typecheck`. It builds the whole project graph in roughly a seventh of the time 6.x takes.
- pnpm gives `node_modules/.bin/tsc` to the alias, so a bare `tsc` on the command line is **7**, not the 6.x that tooling loads. That is also what keeps `.tsbuildinfo` in one format — the two majors cannot read each other's, and mixing them forces a full rebuild every time.

**Do not switch to `@typescript/typescript6`.** Microsoft's documented side-by-side layout aliases `typescript` to that compatibility shim so the native compiler can own the `tsc` bin name. It does not fit here, for two reasons that only show up at build time:

- The shim ships five files and **no `lib.*.d.ts`**, so the 96 `typescript/lib/lib.*.d.ts?raw` imports in `packages/codemirror/src/type_completion/ts_lib_files.ts` fail to resolve and the client build dies.
- Working around that by keeping a real `typescript` under `packages/codemirror` splits resolution: `@typescript/vfs` and `@valtown/codemirror-ts` are hoisted to the root and follow the shim, while codemirror's own source follows its nested copy. Two physical paths means the 3.3 MB compiler is bundled **twice** into the lazy script-note chunk (measured: client `dist` 69 M → 72 M).

The official layout assumes the only consumer of the `typescript` name is tooling. This repo also bundles it into a browser app, so the plain package has to stay.
