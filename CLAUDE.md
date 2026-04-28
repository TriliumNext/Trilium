# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Note**: When updating this file, also update `.github/copilot-instructions.md` to keep both AI coding assistants in sync.

## Overview

Trilium Notes is a hierarchical note-taking application with advanced features like synchronization, scripting, and rich text editing. It's built as a TypeScript monorepo using pnpm, with multiple applications and shared packages.

## Development Commands

### Setup
- `pnpm install` - Install all dependencies
- `corepack enable` - Enable pnpm if not available

### Running Applications
- `pnpm run server:start` - Start development server (http://localhost:8080)
- `pnpm run server:start-prod` - Run server in production mode

### Building
- `pnpm run client:build` - Build client application
- `pnpm run server:build` - Build server application
- `pnpm run electron:build` - Build desktop application

### Testing
- `pnpm test:all` - Run all tests (parallel + sequential)
- `pnpm test:parallel` - Run tests that can run in parallel
- `pnpm test:sequential` - Run tests that must run sequentially (server, ckeditor5-mermaid, ckeditor5-math)
- `pnpm coverage` - Generate coverage reports

## Architecture Overview

### Monorepo Structure
- **apps/**: Runnable applications
  - `client/` - Frontend application (shared by server and desktop)
  - `server/` - Node.js server with web interface
  - `desktop/` - Electron desktop application
  - `web-clipper/` - Browser extension for saving web content
  - Additional tools: `db-compare`, `dump-db`, `edit-docs`

- **packages/**: Shared libraries
  - `commons/` - Shared interfaces and utilities
  - `ckeditor5/` - Custom rich text editor with Trilium-specific plugins
  - `codemirror/` - Code editor customizations
  - `highlightjs/` - Syntax highlighting
  - Custom CKEditor plugins: `ckeditor5-admonition`, `ckeditor5-footnotes`, `ckeditor5-math`, `ckeditor5-mermaid`

### Core Architecture Patterns

#### Three-Layer Cache System
- **Becca** (Backend Cache): Server-side entity cache (`apps/server/src/becca/`)
- **Froca** (Frontend Cache): Client-side mirror of backend data (`apps/client/src/services/froca.ts`)
- **Shaca** (Share Cache): Optimized cache for shared/published notes (`apps/server/src/share/`)

#### Entity System
Core entities are defined in `apps/server/src/becca/entities/`:
- `BNote` - Notes with content and metadata
- `BBranch` - Hierarchical relationships between notes (allows multiple parents)
- `BAttribute` - Key-value metadata attached to notes
- `BRevision` - Note version history
- `BOption` - Application configuration

#### Widget-Based UI
Frontend uses a widget system (`apps/client/src/widgets/`):
- `BasicWidget` - Base class for all UI components
- `NoteContextAwareWidget` - Widgets that respond to note changes
- `RightPanelWidget` - Widgets displayed in the right panel
- Type-specific widgets in `type_widgets/` directory

#### Reusable Preact Components
Common UI components are available in `apps/client/src/widgets/react/` — **always** reuse these instead of writing raw HTML elements or custom implementations:
- `NoItems` - Empty state placeholder with icon and message (use for "no results", "too many items", error states)
- `ActionButton` - Consistent button styling with icon support
- `FormTextBox` - Text input with validation and controlled input handling; `FormTextBoxWithUnit` for inputs with a unit suffix (e.g. "mm", "px")
- `FormSelect` - Dropdown/combobox taking an object array as data
- `Slider` - Range slider with label
- `Checkbox`, `RadioButton` - Form controls
- `CollapsibleSection` - Expandable content sections

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

### Key Files for Understanding Architecture

1. **Application Entry Points**:
   - `apps/server/src/main.ts` - Server startup
   - `apps/client/src/desktop.ts` - Client initialization

2. **Core Services**:
   - `apps/server/src/becca/becca.ts` - Backend data management
   - `apps/client/src/services/froca.ts` - Frontend data synchronization
   - `apps/server/src/services/backend_script_api.ts` - Scripting API

3. **Database Schema**:
   - `apps/server/src/assets/db/schema.sql` - Core database structure

4. **Configuration**:
   - `package.json` - Project dependencies and scripts

## Note Types and Features

Trilium supports multiple note types, each with specialized widgets:
- **Text**: Rich text with CKEditor5 (markdown import/export)
- **Code**: Syntax-highlighted code editing with CodeMirror
- **File**: Binary file attachments
- **Image**: Image display with editing capabilities
- **Canvas**: Drawing/diagramming with Excalidraw
- **Mermaid**: Diagram generation
- **Relation Map**: Visual note relationship mapping
- **Web View**: Embedded web pages
- **Doc/Book**: Hierarchical documentation structure

## Development Guidelines

### Testing Strategy
- Server tests run sequentially due to shared database
- Client tests can run in parallel
- E2E tests use Playwright for both server and desktop apps
- Build validation tests check artifact integrity
- **Write concise tests**: Group related assertions together in a single test case rather than creating many one-shot tests
- **Extract and test business logic**: When adding pure business logic (e.g., data transformations, migrations, validations), extract it as a separate function and always write unit tests for it

### Scripting System
Trilium provides powerful user scripting capabilities:
- Frontend scripts run in browser context
- Backend scripts run in Node.js context with full API access
- Script API documentation available in `docs/Script API/`

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

### Security Considerations
- Per-note encryption with granular protected sessions
- CSRF protection for API endpoints
- OpenID and TOTP authentication support
- Sanitization of user-generated content

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

## Common Development Tasks

### Adding New Note Types
1. Create widget in `apps/client/src/widgets/type_widgets/`
2. Register in `apps/client/src/services/note_types.ts`
3. Add backend handling in `apps/server/src/services/notes.ts`

### Extending Search
- Search expressions handled in `apps/server/src/services/search/`
- Add new search operators in search context files

### Custom CKEditor Plugins
- Create new package in `packages/` following existing plugin structure
- Register in `packages/ckeditor5/src/plugins.ts`

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