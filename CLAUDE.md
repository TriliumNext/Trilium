# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Trilium Notes is a hierarchical note-taking application with synchronization, scripting, and rich text editing. TypeScript monorepo using pnpm with multiple apps and shared packages.

## Development Commands

```bash
corepack enable && pnpm install         # setup
pnpm server:start                        # dev server at http://localhost:8080
pnpm desktop:start                       # Electron dev app
pnpm standalone:start                    # standalone (in-browser) client
pnpm client:build | server:build | desktop:build
pnpm --filter <pkg> test <pattern>      # e.g. pnpm --filter server test spec/etapi/search.spec.ts
pnpm --filter <pkg> coverage             # per-package coverage (client, server, standalone)
pnpm typecheck                           # all projects, native compiler, a few seconds
pnpm dev:format-check | dev:format-fix   # stylistic formatting
```

- **Never run ESLint** (`dev:linter-check`, `dev:linter-fix`, `npx eslint`) — it dies with an out-of-memory error, so a run tells you nothing. CI does not lint either — there is no `eslint`/`linter-check` step anywhere in `.github/workflows/`, so lint findings never block a merge; the gates are `pnpm typecheck` and the per-package `test --coverage` runs. (`packages/*` is ignored by the ESLint config anyway.)
- **Never run `pnpm test:all`, `test:parallel`, `test:sequential`, or a whole-package `coverage`** during development — CI runs them on every push. Run the **narrowest** suite that covers what you touched: `pnpm --filter <pkg> test <pattern>` (Vitest treats the trailing argument as a substring filter over spec paths). Core specs need **two** runs, server and standalone (see Testing). Only reach for a full suite if the user asks or wants a final check.
- **Typecheck with `pnpm typecheck`, not a raw `tsc`** — it resolves the project references a hand-written `tsc -p …` gets wrong, and is far cheaper than a test suite. Still, run it **once, after a piece of work is finished** — not after every edit: it builds the project references, and repeating it is a common way to lose minutes across a session.
- **Two TypeScript versions, on purpose**: root `package.json` has `typescript` 6.x (the JS compiler API that TypeDoc, typescript-eslint and the browser-bundled language service in `packages/codemirror` load) and `@typescript/native` (7, drives `pnpm typecheck` and owns the `tsc` bin). Do **not** bump `typescript` to 7, dedupe them, or switch to the `@typescript/typescript6` shim (no `lib.*.d.ts` → client build breaks). Reasoning: `docs/Developer Guide/Developer Guide/Environment Setup.md`, "TypeScript".

## Git Workflow

- **Committing directly on `main` is allowed and expected** for small fixes and self-contained features — do **not** create a branch first for those. The default "branch before committing on the default branch" rule does not apply to this repository.
- **Large or risky work goes on a branch**: multi-commit features, migrations, refactors spanning many packages, anything that needs review or a PR before landing.
- Only commit when explicitly asked to **in that message**, and the ask covers only the step it accompanies — a later step is left uncommitted until asked again. A remark like "commits go on main" is about branch choice, not standing permission to commit. Otherwise leave changes staged/unstaged for review.
- **The issue-closing keyword goes in the commit/PR subject**, not the body — `fix(markdown): wrap imported tables (closes #10270)`.
- **`git rm` is not a neutral delete.** It leaves the deletion staged, so a commit made before the matching reference updates are staged lands a `HEAD` pointing at a module that no longer exists. When removing a file whose references are edited in the same pass, delete it from the filesystem instead, or land the deletion and the reference updates together — never leave the index in a state that is broken on its own.
- **Never run a tree-wide git operation — no `git stash`, `git checkout --`, `git restore`.** The user edits this worktree at the same time, so a stash takes their uncommitted work with it, and their IDE can flush a partial buffer onto the stashed state and block the pop. To decide whether a failure predates your change, argue statically instead — check whether the failing spec even imports the module you touched. If a real A/B is unavoidable, copy the file, edit it in place, and restore it, touching only files you wrote; prefer `git worktree add` on a temp dir over anything that reaches the whole tree.

## Monorepo Structure

```
apps/
  client/               # Preact frontend (+ legacy jQuery widgets); shared by server, desktop, standalone
  server/               # Node.js backend (Express, better-sqlite3); serves the client, REST/WebSocket
  desktop/              # Electron: server + client in one process (see developing-electron-desktop skill)
  standalone/           # whole stack in the browser: core in a Web Worker on SQLite WASM + OPFS, no Node (see developing-standalone skill)
  mobile/               # Capacitor shell around standalone (see developing-capacitor-mobile skill)
  web-clipper/, website/, db-compare/, dump-db/, edit-docs/, build-docs/, icon-pack-builder/, script-deployer/
packages/
  trilium-core/         # entities, services, SQL, sync, most API routes — shared by server, desktop, standalone
  commons/              # types + utilities shared with the client
  trilium-e2e/          # shared Playwright tests
  ckeditor5/, codemirror/, highlightjs/, share-theme/, pdfjs-viewer/, splitjs/, turndown-plugin-gfm/
```

`pnpm --filter <package> <command>` runs a command in one package.

**`packages/trilium-core` is shared by server, desktop and standalone — *not* by the client.** `apps/client` has zero `@triliumnext/core` imports; it reaches the backend over REST/WebSocket and shares only **types** via `@triliumnext/commons`. So: a dependency added to core lands in server, desktop and standalone bundles (standalone's worker imports core at startup — that is the cost to weigh, never "the client would pay for it"), and frontend code can never call a core function — it needs an API route or a type in commons. The split is backend-vs-frontend, not Node-vs-browser: standalone runs core in a browser worker, which is why core carries the no-Node-built-ins rules below.

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

**Widget lifecycle**: `doRenderBody()` for initial render, `refreshWithNote()` for note changes, `entitiesReloadedEvent({loadResults})` for entity updates. Fluent builder pattern: `.child()`, `.class()`, `.css()` chaining with position-based ordering. These legacy widgets are jQuery; new UI is Preact under `widgets/react/` — don't mix the two inside one component.

#### Reusable Preact Components
Shared components live in `apps/client/src/widgets/react/` — **always** reuse them (`FormTextBox`, `FormSelect`, `Button`, `Badge`, `NoItems`, `Dropdown`, `Table`, `Calendar`, …) instead of writing raw HTML elements or a custom implementation, and never put Bootstrap utility classes (`form-control-sm`, `input-group`, …) on them. Any control floating **over** a note's content (map, mind map, image, diagram) goes on `OverlayControlGroup` / `OverlayToolbar` — never a hand-rolled `<button>`. The full catalogue, the `Dropdown` backdrop-blur rules (`noDropdownListStyle` / `portalToBody`) and the overlay-control contract are in the **`building-client-ui` skill** — load it before building client UI.

#### Component Styling
- **Avoid inline styles** — do not use the `style` attribute/prop on JSX elements unless absolutely necessary (e.g. a truly dynamic, computed value that cannot be expressed in CSS). Static layout, sizing, spacing, and visual properties must go in CSS.
- **Per-component CSS files**: each component should have a matching `.css` file (e.g. `my_dialog.tsx` → `my_dialog.css`), imported at the top of the component file.
- **CSS nesting for scoping**: since CSS modules are not available, scope styles using a root class and native CSS nesting. For example, a dialog with `className="my-dialog"` should have its styles nested under `.modal.my-dialog { … }`.
- **Reuse existing components** instead of building custom markup — prefer `FormTextBox`, `FormTextBoxWithUnit`, `FormSelect`, `Slider`, `Button`, etc. over hand-rolled `<input>`, `<select>`, or `<button>` elements.

### API Architecture

- **Internal API** — REST, trusts the frontend. Most routes are core-shared and also run under WASM (`packages/trilium-core/src/routes/`); Node-only ones live in `apps/server/src/routes/api/`. Load the **`adding-internal-api-route` skill** for the wrapper/return conventions before adding one.
- **ETAPI** (`apps/server/src/etapi/`) — external API with token auth; keep it backwards compatible.
- **WebSocket** (`packages/trilium-core/src/services/ws.ts`) — real-time sync to the client (IPC-backed on desktop).

### Platform Abstraction and core rules

`packages/trilium-core/src/services/platform.ts` defines `PlatformProvider` (`crash()`, `getEnv()`, `isElectron`/`isMac`/`isWindows`), implemented per app in `apps/desktop`, `apps/server`, `apps/standalone`; singleton via `initPlatform()`/`getPlatform()`. Because core also runs in standalone's browser worker:

- **No `process.env`** — `getPlatform().getEnv(key)` (standalone maps URL params like `?safeMode` → `TRILIUM_SAFE_MODE`).
- **No Node built-ins** in core, including `path` — use `packages/trilium-core/src/services/utils/path.ts` (`extname()`/`basename()`) and the platform providers.
- **Platform checks are functions** — `isElectron()`, `isMac()`, `isWindows()` from `utils/index.ts` call `getPlatform()` and only work after `initializeCore()`; in static definitions wrap them in a closure (`value: () => isWindows() ? "0.9" : "1.0"`).
- **Avoid the barrel** in early-loading modules — `import { x } from "@triliumnext/core"` loads every export; `config.ts`-like modules import subpaths (`@triliumnext/core/src/services/utils/index`) to dodge init-order cycles.
- **Binary conversions** go through `packages/trilium-core/src/services/utils/binary.ts` (`wrapStringOrBuffer`/`unwrapStringOrBuffer` for `string | Uint8Array`, `encodeBase64`/`decodeBase64`, `encodeUtf8`/`decodeUtf8`; also exported as `binary_utils`), not hand-rolled `TextEncoder`/`Buffer.from()`.

### Electron Desktop App
`apps/desktop` runs server + client in one Electron process; the renderer loads over the `trilium-app://` custom protocol and talks to main only through the preload bridge (`window.electronApi`, typed by `packages/commons/src/lib/electron_api_interface.ts`). The main process bundles to **ESM with code splitting** (`dist/main.mjs` + lazy `chunks/`, via `buildBackend(..., { format: "esm" })`); the preload and `image_worker.cjs` stay CJS. `nodeIntegration` is off, `contextIsolation` is on, `@electron/remote` is gone — never `require("electron")` in client code. Adding an API means interface + `preload.ts` + an `ipcMain` handler in the owning service + a spec. Load the **`developing-electron-desktop` skill** for the recipe, the security model, running/launch errors and testing.

### Standalone (in-browser) app
`apps/standalone` runs the client on the page and `@triliumnext/core` — plain JS — in a dedicated Web Worker over `@sqlite.org/sqlite-wasm` persisted in OPFS; a Web Lock elects the one tab that owns the database and the service worker forwards other tabs' API calls to it. Every core provider has a browser twin in `apps/standalone/src/lightweight/` — **a new provider or Node import in core breaks this build first.** Load the **`developing-standalone` skill** before touching `sw.ts`, `main.ts`, `local-server-worker.ts`, `lightweight/*` or `vite.config.mts`.

### Mobile (Capacitor) app
`apps/mobile` wraps the standalone WASM build in a Capacitor WebView — no network backend. Android runs at `https://localhost` and routes API calls through the service worker; iOS runs at `capacitor://localhost`, where no service worker can register, so `apps/standalone/src/ios-interceptors.ts` stands in. **`iosScheme: "https"` is a no-op and must not be re-added, and the iOS interceptor path is not dead code.** Load the **`developing-capacitor-mobile` skill** before touching `apps/mobile`, `ios-interceptors.ts`, `capacitor_http_handler.ts` or the `capacitor:` branches of `sw.ts`/`main.ts`.

### Database

SQLite (`better-sqlite3` on Node, `@sqlite.org/sqlite-wasm` on OPFS in standalone) behind `packages/trilium-core/src/services/sql/` (`DatabaseProvider`, prepared-statement cache, transactions). Schema: `packages/trilium-core/src/assets/schema.sql`; migrations: integer-versioned entries in the descending `MIGRATIONS` array in `packages/trilium-core/src/migrations/migrations.ts` (inline SQL or a `NNNN__description.ts` module) — load the **`evolving-the-data-model` skill** before adding a column or migration.

### Internationalization

- English is the only catalogue you edit; 40+ other locales come from Weblate. Three English catalogues, chosen by who loads the string: `apps/client/src/translations/en/translation.json` (the app), `en/entry.json` (`setup.*`, `login.*`, `set_password.*` — the setup/login/password pages load only this ~11 KB file), and `apps/server/src/assets/translations/en/server.json` (server, `trilium-core`, the Electron main process **and** standalone's worker — it is the catalogue for every non-browser-UI runtime, so a `t()` in core needs no fallback). Load the **`working-with-translations` skill** to find, add or audit keys without reading the 226 KB file.
- Client: `import { t } from "../services/i18n"`; everywhere else: `import { t } from "i18next"`. Never hardcode user-facing text, including in Electron dialogs/tray/IPC.
- `{{var}}` interpolates escaped; `{{- var}}` unescaped (values with quotes etc.). Interpolated **components** whose order can vary by language (links, note references) use `<Trans>` from `react-i18next`, not `t()`.
- Third-party components (mind-map context menu, …) still go through `t()` with their strings under a dedicated namespace (e.g. `"mind-map"`).
- **Text editor (`packages/ckeditor5`)**: plugins call `editor.t("English text")` — the English text *is* the message id, the entry lives under `text-editor.ck` keyed by its slug, and `apps/client/src/services/i18n.spec.ts` fails on a missing or stale one. Rules (name it `t`, literal argument, don't shadow upstream strings, `MESSAGE_OVERRIDES`, `renderShortcut`): **`ckeditor5-plugin-development` skill**.
- New locale: `docs/Developer Guide/Developer Guide/Concepts/Internationalisation  Translations/Adding a new locale.md`.

### Attribute Inheritance

Three inheritance mechanisms:
1. **Standard**: `note.getInheritableAttributes()` walks parent tree
2. **Child prefix**: `child:label` on parent copies to children
3. **Template relation**: `#template=noteNoteId` includes template's inheritable attributes

Use `note.getOwnedAttribute()` for direct, `note.getAttribute()` for inherited.

### Client-Side API Restrictions
- **Do not use `crypto.randomUUID()`** or other Web Crypto APIs that require secure contexts - Trilium can run over HTTP, not just HTTPS
- Use `randomString()` from `apps/client/src/services/utils.ts` for generating IDs instead

### Shared Types Policy
- Types shared between client and server belong in `@triliumnext/commons` (`packages/commons/src/lib/`)
- Import shared types directly from `@triliumnext/commons` - do not re-export them from app-specific modules
- Keep app-specific types (e.g., `LlmProvider` for server, `StreamCallbacks` for client) in their respective apps

## Important Patterns

- **Protected notes**: Check `note.isContentAvailable()` before accessing content; use `note.getTitleOrProtected()` for safe title access
- **Long operations**: Use `TaskContext` for progress reporting via WebSocket
- **Event system** (`packages/trilium-core/src/services/events.ts`): Events emitted in order (notes → branches → attributes) during load for referential integrity
- **Backend lazy loading**: a heavy or rarely-used dependency in server/desktop code loads via dynamic `import()` inside its (async) call site, so the ESM split build puts it in a lazy chunk instead of the startup path. When the target is a **CommonJS** package, read it through the interop — `const mod = await import("pkg"); const { x } = mod.default ?? mod;` — a plain destructure of the namespace silently yields `undefined` in split ESM output, and unit tests mock past it. Measure and verify with the **`analyzing-backend-bundle` skill** (`check-dynamic-imports.mjs` catches the interop break)
- **Search**: Expression-based, scoring happens in-memory — cannot add SQL-level LIMIT/OFFSET without losing scoring
- **Widget cleanup**: Unsubscribe from events in `cleanup()`/`doDestroy()` to prevent memory leaks

## Code Style

- 4-space indent, semicolons, double quotes, max line 100, Unix line endings (the format config enforces these). Imports sorted per `eslint-plugin-simple-import-sort` (packages before relative, alphabetical within a group) — only ESLint checks that and it isn't run locally, so sort by hand.
- **Never use the non-null assertion `!`**, tests included. Narrow instead: `?.`, `?? fallback`, an explicit check, or an `*OrThrow` accessor (`becca.getNoteOrThrow(id)`).
- **Never use `Array.prototype.forEach`** — write a `for...of` loop instead, and iterate `array.entries()` when the index is needed (`for (const [index, item] of arr.entries())`). It reads better and allows `break`/`continue`/`await`.
- **Helpers go below the primary export** they support (or in another module), never between the imports and the main definition — the entry point reads first.
- **No ~10-SLOC modules.** A component, hook or helper of about ten lines of substance joins an existing module that owns the same concept (e.g. `OverlayFullscreenButton` lives in `OverlayControlGroup.tsx`, its tests in that spec); a file of its own costs a module boundary and an import per call site and buys nothing. Split out once it has grown.
- **Comments** — Google developer-documentation style: plain English, present tense, active voice, real identifiers (`froca.getNote()`, not "the cache lookup"); *can*/*might*/*must* used precisely, never *may*. Say what the code does or why it is shaped so, not what changed. Keep it to a line or two — the reproduction, the measurements and the before/after belong in the commit body, which is the place to be thorough. A comment narrating a defect ("at 375px those ran 28px past the card") ages the moment the layout moves, and the next reader needs only the constraint that still binds, not the investigation.
  - **This rule overrides the file you are editing.** Most comments in the repository predate it and use a literary register — personified subjects, em-dash asides, inverted clauses. Do not match them; they are history, not house style. Code has no voice: a card does not *state*, a row does not *say*, a request does not *stand*, a tool does not *hand over*.
  - Name the identifier instead of alluding to it. Write ``// Erasing changes the note and attachment counts, so `DatabaseInfo` reads them again.`` — not `// Erasing frees pages inside the file rather than shrinking it, so what the card above has to re-read is what the database holds.`
  - **Never comment an absence.** A removal — a prop, a flag, a CSS rule, a branch, a whole widget — is explained by the commit that makes it, not by a note left where the code was: at the call site it defends something the reader cannot see. The same goes for a removal's mirror image: don't annotate a default that was left alone, or an option deliberately not passed. If an absence needs defending in the source, name the code better instead.
- **CSS comments** never narrate a change (`/* was 8px */`, `/* moved from the toolbar */`) — that is the commit message. Comment only what is non-obvious in place: a browser workaround, a value that must match one elsewhere, a `z-index` in a stacking contract.

## Testing

- **Server tests** (`apps/server/spec/`): Vitest, must run sequentially (shared DB), forks pool, max 6 workers
- **Client tests** (`apps/client/src/`): Vitest with happy-dom environment, can run in parallel
- **Core tests** (`packages/trilium-core/src/**/*.spec.ts`): `trilium-core` has no runner of its own — the **server and standalone suites both include** its specs (`apps/server/vite.config.mts`, `apps/standalone/vite.config.mts`) and run them against different platform providers (node + better-sqlite3 vs. happy-dom + sqlite-wasm). Green under `pnpm --filter server test` is **not** proof; run `pnpm --filter standalone test` as well. See the `writing-unit-tests` skill for the cross-runtime traps
- **E2E tests** (`packages/trilium-e2e/`): Shared Playwright tests, run via `pnpm --filter server e2e` or `pnpm --filter standalone e2e`
- **ETAPI tests** (`apps/server/spec/etapi/`): External API contract tests
- **Browser-mode tests** (`packages/ckeditor5`) drive a real headless Chrome via `@vitest/browser-webdriverio`; where its downloaded Chrome cannot run (NixOS), point `CHROME_BIN`/`CHROMEDRIVER_PATH` at a matching system pair — never start a chromedriver by hand or add a local override config. See the `ckeditor5-testing` skill
- **Build validation tests** check artifact integrity
- **Write concise tests**: Group related assertions together in a single test case rather than creating many one-shot tests
- **Extract and test business logic**: When adding pure business logic (e.g., data transformations, migrations, validations), extract it as a separate function and always write unit tests for it
- **Confirm a new spec fails without the fix**: after adding a spec that covers a bug you just fixed, revert the fix, run the spec, confirm it fails, restore the fix, and report both results. A spec written against already-correct code can pass for the wrong reason — check every assertion in the reverted run, since one that still passes is either covering something else or is vacuous, and needs tightening (look the element up, assert it exists, *then* act on it)
- **Don't drive the running app to verify a UI change** — the user exercises the UI and reports back, so a headless-browser walkthrough duplicates their work and adds no information. Ship once the relevant unit tests and `pnpm typecheck` are green, and state plainly what is and isn't verified. Booting an instance is for what the user cannot answer from the UI — which CSS rule actually won, a stacking or placement bug, a fixture-only repro: see `references/inspecting-the-running-app.md` in the `building-client-ui` skill

## Documentation

- Script API reference — Generated by `apps/build-docs` (TypeDoc) into the gitignored `site/script-api/{backend,frontend,electron}` and published to [docs.triliumnotes.org](https://docs.triliumnotes.org/). Not committed; never hand-edit — it's regenerated from the script API type definitions
- `docs/User Guide/` — Edit via `pnpm edit-docs:edit-docs`, not manually
- `docs/Developer Guide/` and `docs/Release Notes/` — Safe for direct Markdown editing

### Always check the docs against a user-visible change

Any change to what the user sees or does — a button moved or removed, a keyboard shortcut, a label, an
option, a default, where a feature is configured — **can leave the User Guide describing an affordance
that no longer exists**. Before reporting the work done, grep `docs/User Guide/` for the feature and for
the control you touched (its name, its icon, the panel it lived in) and read every hit. Report what needs
updating as part of the change, without waiting to be asked; the docs are a deliverable, not a follow-up.

Two traps this catches:

- **The doc named the wrong place to begin with.** Verify where a control actually mounts by grepping for
  the component, not by inferring it from an i18n namespace or from another doc page — `NoteBadges` is
  keyed `breadcrumb_badges.*` and renders in the title row.
- **A capability gate has a blast radius.** Widening one (a note type added to a list a widget switches
  on) can surface panels, bars and menu entries the change never mentioned. Grep the gate's other readers
  and say what else now appears.

## Recipes

### Storing User Preferences
**No `localStorage`** — preferences are synced options. To add one: (1) type in `OptionDefinitions`, `packages/commons/src/lib/options_interface.ts`; (2) default in `defaultOptions`, `packages/trilium-core/src/services/options_init.ts`; (3) **whitelist it in `ALLOWED_OPTIONS`**, `packages/trilium-core/src/routes/api/options.ts` — otherwise the API rejects writes with "Option 'X' is not allowed to be changed"; (4) a control in the matching settings pane (`apps/client/src/widgets/type_widgets/options/*.tsx`) plus its English key; (5) read/write via `useTriliumOption` / `useTriliumOptionBool` / `useTriliumOptionInt` / `useTriliumOptionJson`. Details: `docs/Developer Guide/Developer Guide/Concepts/Options/Creating a new option.md`.

### Adding Hidden System Notes
The `_hidden` subtree holds system notes with deterministic `_`-prefixed IDs so every sync instance builds the same tree; `checkHiddenSubtree()` creates them at startup. Add the `HiddenSubtreeItem` (from `@triliumnext/commons`) to `buildHiddenSubtreeDefinition()` in `packages/trilium-core/src/services/hidden_subtree.ts` — `id` (starts with `_`), `title` (key under `"hidden-subtree"` in `server.json`), `type`, `icon` (`bx-name`, no `bx ` prefix), `attributes`, `children`, `content`; `enforceAttributes` / `enforceBranches` / `enforceDeleted: true` keep attributes, placement and removals in sync. Launcher-bar entries: `hidden_subtree_launcherbar.ts`; templates: `hidden_subtree_templates.ts`.

### Writing to Notes from Server Services
- `note.setContent()` requires a CLS (Continuation Local Storage) context — wrap calls in `cls.init(() => { ... })` (from `packages/trilium-core/src/services/context.ts`)
- Operations called from Express routes already have CLS context; standalone services (schedulers, Electron IPC handlers) do not

### Adding New LLM Tools
Tools are `defineTools({...})` registries in `packages/trilium-core/src/services/llm/tools/` (`note_tools`, `attribute_tools`, `attachment_tools`, `hierarchy_tools`, …), served to both the LLM chat and the MCP server. Each tool: `description`, Zod `inputSchema`, `execute`, `mutates: true` for writes. A new module goes into `allToolRegistries` in `tools/index.ts`; Node-only tools (in-app docs) live in `apps/server/src/services/llm/tools/` and register via `registerToolRegistryLoader()` (a lazy dynamic-import loader — see `registerServerLlmExtensions` in `apps/server/src/services/llm/index.ts`) so the tool stack stays out of the startup path. Add the client label under `llm.tools.<tool_name>` in imperative tense ("Search notes"). Mirror ETAPI's field choices but **don't import ETAPI mappers** — inline them so the LLM layer stays decoupled.

### Server-Side Static Assets
Node-side assets (templates, translations, prompts) live in `apps/server/src/assets/` and are read via `RESOURCE_DIR` from `apps/server/src/services/resource_dir.ts` (`path.join(RESOURCE_DIR, "llm", "prompts", …)`); assets core itself reads (`schema.sql`, LLM skills) live in `packages/trilium-core/src/assets/`. **Never resolve paths with `import.meta.url`/`fileURLToPath` or `__dirname` + relative path** — the server bundles to `dist/main.mjs` plus lazy `chunks/`, so both point at the bundle (or at whichever chunk the module landed in), not the source tree.

## MCP Server

Trilium exposes an MCP server at `http://localhost:8080/mcp` (`.mcp.json`) — only while `pnpm server:start` is running, and only with an ETAPI token exported as `TRILIUM_ETAPI_TOKEN` before starting Claude Code (otherwise `401`; create one in Options → ETAPI). Use it to read/search/modify real note data when developing note-related features.
