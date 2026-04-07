# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

### Security Considerations
- Per-note encryption with granular protected sessions
- CSRF protection for API endpoints
- OpenID and TOTP authentication support
- Sanitization of user-generated content

### Client-Side API Restrictions
- **Do not use `crypto.randomUUID()`** or other Web Crypto APIs that require secure contexts - Trilium can run over HTTP, not just HTTPS
- Use `randomString()` from `apps/client/src/services/utils.ts` for generating IDs instead

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