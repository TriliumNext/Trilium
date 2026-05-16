# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Note**: When updating this file, also update `.github/copilot-instructions.md` to keep both AI coding assistants in sync.

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

# Test
pnpm test:all                  # All tests (parallel + sequential)
pnpm test:parallel             # Client + most package tests
pnpm test:sequential           # Server, ckeditor5-mermaid, ckeditor5-math (shared DB)
pnpm --filter server test      # Single package tests
pnpm coverage                  # Coverage reports

# Lint & Format
pnpm dev:linter-check          # ESLint check
pnpm dev:linter-fix            # ESLint fix
pnpm dev:format-check          # Format check (stricter stylistic rules)
pnpm dev:format-fix            # Format fix
pnpm typecheck                 # TypeScript type check across all projects
```

**Running a single test file**: `pnpm --filter server test spec/etapi/search.spec.ts`

## Main Applications

The four main apps share `packages/trilium-core/` for business logic but differ in runtime:

- **client** (`apps/client/`): Preact frontend with jQuery widget system. Shared UI layer used by both server and desktop.
- **server** (`apps/server/`): Node.js backend (Express, better-sqlite3). Serves the client and provides REST/WebSocket APIs.
- **desktop** (`apps/desktop/`): Electron wrapper around server + client, running both in a single process.
- **standalone** (`apps/client-standalone/` + `apps/standalone-desktop/`): Runs the entire stack in the browser — server logic compiled to WASM via sql.js, executed in a service worker. No Node.js dependency at runtime.

## Monorepo Structure

```
apps/
  client/               # Preact frontend (shared by server, desktop, standalone)
  server/               # Node.js backend (Express, better-sqlite3)
  desktop/              # Electron (bundles server + client)
  client-standalone/    # Standalone client (WASM + service workers, no Node.js)
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
  ckeditor5-admonition/, ckeditor5-footnotes/, ckeditor5-math/, ckeditor5-mermaid/
  ckeditor5-keyboard-marker/, express-partial-content/, pdfjs-viewer/, splitjs/
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
- `CollapsibleSection` - Expandable content sections

Fluent builder pattern: `.child()`, `.class()`, `.css()` chaining with position-based ordering.

**Do not use Bootstrap utility classes** (e.g. `form-control-sm`, `form-select-sm`, `input-group`) on these components — they manage their own styling internally. If you need to adjust sizing or layout, use props provided by the component or CSS custom properties, not Bootstrap overrides.

#### Component Styling
- **Avoid inline styles** — do not use the `style` attribute/prop on JSX elements unless absolutely necessary (e.g. a truly dynamic, computed value that cannot be expressed in CSS). Static layout, sizing, spacing, and visual properties must go in CSS.
- **Per-component CSS files**: each component should have a matching `.css` file (e.g. `my_dialog.tsx` → `my_dialog.css`), imported at the top of the component file.
- **CSS nesting for scoping**: since CSS modules are not available, scope styles using a root class and native CSS nesting. For example, a dialog with `className="my-dialog"` should have its styles nested under `.modal.my-dialog { … }`.
- **Reuse existing components** instead of building custom markup — prefer `FormTextBox`, `FormTextBoxWithUnit`, `FormSelect`, `Slider`, `Button`, etc. over hand-rolled `<input>`, `<select>`, or `<button>` elements.

#### API Architecture
- **Internal API**: REST endpoints in `apps/server/src/routes/api/`
- **ETAPI**: External API for third-party integrations (`apps/server/src/etapi/`)
- **WebSocket**: Real-time synchronization (`apps/server/src/services/ws.ts`)

### API Architecture

- **Internal API** (`apps/server/src/routes/api/`): REST endpoints, trusts frontend
- **ETAPI** (`apps/server/src/etapi/`): External API with basic auth tokens — maintain backwards compatibility
- **WebSocket** (`apps/server/src/services/ws.ts`): Real-time sync

### Platform Abstraction

`packages/trilium-core/src/services/platform.ts` defines `PlatformProvider` interface with implementations in `apps/desktop/`, `apps/server/`, and `apps/client-standalone/`. Singleton via `initPlatform()`/`getPlatform()`.

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
- **Electron IPC** — In desktop mode, client API calls use Electron IPC (not HTTP). The IPC handler in `apps/server/src/routes/electron.ts` must be registered via `utils.isElectron` from the **server's** utils (which correctly checks `process.versions["electron"]`), not from core's utils

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
- **Interpolation**: Use `{{variable}}` for normal interpolation; use `{{- variable}}` (with hyphen) for **unescaped** interpolation when the value contains special characters like quotes that shouldn't be HTML-escaped

### Electron Desktop App
- Desktop entry point: `apps/desktop/src/main.ts`, window management: `apps/server/src/services/window.ts`
- IPC communication: use `electron.ipcMain.on(channel, handler)` on server side, `electron.ipcRenderer.send(channel, data)` on client side
- Electron-only features should check `isElectron()` from `apps/client/src/services/utils.ts` (client) or `utils.isElectron` (server)

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

## Testing

- **Server tests** (`apps/server/spec/`): Vitest, must run sequentially (shared DB), forks pool, max 6 workers
- **Client tests** (`apps/client/src/`): Vitest with happy-dom environment, can run in parallel
- **E2E tests** (`packages/trilium-e2e/`): Shared Playwright tests, run via `pnpm --filter server e2e` or `pnpm --filter client-standalone e2e`
- **ETAPI tests** (`apps/server/spec/etapi/`): External API contract tests

## Documentation

- `docs/Script API/` — Auto-generated, never edit directly
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
1. Update `pdfjs-dist` version in `packages/pdfjs-viewer/package.json`
2. Run `npx tsx scripts/update-viewer.ts` from that directory
3. Run `pnpm build` to verify success
4. Commit all changes including updated viewer files

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
- It provides tools for reading, searching, and modifying notes directly from the AI assistant
- Use it to interact with actual note data when developing or debugging note-related features

## Build System Notes
- Uses pnpm for monorepo management
- Vite for fast development builds
- ESBuild for production optimization
- pnpm workspaces for dependency management
- Docker support with multi-stage builds
