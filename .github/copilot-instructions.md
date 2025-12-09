# Trilium Notes - AI Coding Agent Instructions

## Project Overview

Trilium Notes is a hierarchical note-taking application with advanced features like synchronization, scripting, and rich text editing. Built as a TypeScript monorepo using pnpm, it implements a three-layer caching architecture (Becca/Froca/Shaca) with a widget-based UI system and supports extensive user scripting capabilities.

## Essential Architecture Patterns

### Three-Layer Cache System (Critical to Understand)
- **Becca** (`apps/server/src/becca/`): Server-side entity cache, primary data source
- **Froca** (`apps/client/src/services/froca.ts`): Client-side mirror synchronized via WebSocket
- **Shaca** (`apps/server/src/share/`): Optimized cache for public/shared notes

**Key insight**: Never bypass these caches with direct DB queries. Always use `becca.notes[noteId]`, `froca.getNote()`, or equivalent cache methods.

### Entity Relationship Model
Notes use a **multi-parent tree** via branches:
- `BNote` - The note content and metadata
- `BBranch` - Tree relationships (one note can have multiple parents via cloning)
- `BAttribute` - Key-value metadata attached to notes (labels and relations)

### Entity Change System & Sync
Every entity modification (notes, branches, attributes) creates an `EntityChange` record that drives synchronization:

```typescript
// Entity changes are automatically tracked
note.title = "New Title";
note.save();  // Creates EntityChange record with changeId

// Sync protocol via WebSocket
ws.sendMessage({ type: 'sync-pull-in-progress', ... });
```

**Critical**: This is why you must use Becca/Froca methods instead of direct DB writes - they create the change tracking records needed for sync.

### Entity Lifecycle & Events
The event system (`apps/server/src/services/events.ts`) broadcasts entity lifecycle events:

```typescript
// Subscribe to events in widgets or services
eventService.subscribe('noteChanged', ({ noteId }) => {
    // React to note changes
});

// Common events: noteChanged, branchChanged, attributeChanged, noteDeleted
// Widget method: entitiesReloadedEvent({loadResults}) for handling reloads
```

**Becca loader priorities**: Events are emitted in order (notes → branches → attributes) during initial load to ensure referential integrity.

### TaskContext for Long Operations
Use `TaskContext` for operations with progress reporting (imports, exports, bulk operations):

```typescript
const taskContext = new TaskContext("task-id", "import", "Import Notes");
taskContext.increaseProgressCount();

// WebSocket messages: { type: 'taskProgressCount', taskId, taskType, data, progressCount }

**Pattern**: All long-running operations (delete note trees, export, import) use TaskContext to send WebSocket updates to the frontend.

### Protected Session Handling
Protected notes require an active encryption session:

```typescript
// Always check before accessing protected content
if (note.isContentAvailable()) {
    const content = note.getContent();  // Safe
} else {
    const title = note.getTitleOrProtected();  // Returns "[protected]"
}

// Protected session management
protectedSessionService.isProtectedSessionAvailable()  // Check session
protectedSessionService.startProtectedSession()  // After password entry
```

**Session timeout**: Protected sessions expire after inactivity. The encryption key is kept in memory only.

### Attribute Inheritance Patterns
Attributes can be inherited through three mechanisms:

```typescript
// 1. Standard inheritance (#hidePromotedAttributes ~hidePromotedAttributes)
note.getInheritableAttributes()  // Walks up parent tree

// 2. Child prefix inheritance (child:label copies to children)
parentNote.setLabel("child:icon", "book")  // All children inherit this

// 3. Template relation inheritance (#template=templateNoteId)
note.setRelation("template", templateNoteId)
note.getInheritedAttributes()  // Includes template's inheritable attributes
```

**Cycle prevention**: Inheritance tracking prevents infinite loops when notes reference each other.

### Widget-Based UI Architecture
All UI components extend from widget base classes (`apps/client/src/widgets/`):

```typescript
// Right panel widget (sidebar)
class MyWidget extends RightPanelWidget {
    get position() { return 100; }  // Order in panel
    get parentWidget() { return 'right-pane'; }
    isEnabled() { return this.note && this.note.hasLabel('myLabel'); }
    async refreshWithNote(note) { /* Update UI */ }
}

// Note-aware widget (responds to note changes)
class MyNoteWidget extends NoteContextAwareWidget {
    async refreshWithNote(note) { /* Refresh when note changes */ }
    async entitiesReloadedEvent({loadResults}) { /* Handle entity updates */ }
}
```

**Important**: Widgets use jQuery (`this.$widget`) for DOM manipulation. Don't mix React patterns here.

## Development Workflow

### Running & Testing
```bash
# From root directory
pnpm install                                    # Install dependencies
corepack enable                                 # Enable pnpm if not available
pnpm server:start                               # Dev server (http://localhost:8080)
pnpm server:start-prod                          # Production mode server
pnpm desktop:start                              # Desktop app development
pnpm server:test spec/etapi/search.spec.ts     # Run specific test
pnpm test:parallel                              # Client tests (can run parallel)
pnpm test:sequential                            # Server tests (sequential due to shared DB)
pnpm test:all                                   # All tests (parallel + sequential)
pnpm coverage                                   # Generate coverage reports
pnpm typecheck                                  # Type check all projects
```

### Building
```bash
pnpm client:build                               # Build client application
pnpm server:build                               # Build server application
pnpm desktop:build                              # Build desktop application
```

### Test Organization
- **Server tests** (`apps/server/spec/`): Must run sequentially (shared database state)
- **Client tests** (`apps/client/src/`): Can run in parallel
- **E2E tests** (`apps/server-e2e/`): Use Playwright for integration testing
- **ETAPI tests** (`apps/server/spec/etapi/`): External API contract tests

**Pattern**: When adding new API endpoints, add tests in `spec/etapi/` following existing patterns (see `search.spec.ts`).

### Monorepo Navigation
```
apps/
  client/          # Frontend (shared by server & desktop)
  server/          # Node.js backend with REST API
  desktop/         # Electron wrapper
  web-clipper/     # Browser extension for saving web content
  db-compare/      # Database comparison tool
  dump-db/         # Database export utility
  edit-docs/       # Documentation editing tools
packages/
  commons/         # Shared types and utilities
  ckeditor5/       # Custom rich text editor with Trilium-specific plugins
  codemirror/      # Code editor integration
  highlightjs/     # Syntax highlighting
  share-theme/     # Theme for shared/published notes
  ckeditor5-admonition/  # Admonition blocks plugin
  ckeditor5-footnotes/   # Footnotes plugin
  ckeditor5-math/        # Math equations plugin
  ckeditor5-mermaid/     # Mermaid diagrams plugin
```

**Filter commands**: Use `pnpm --filter server test` to run commands in specific packages.

## Critical Code Patterns

### ETAPI Backwards Compatibility
When adding query parameters to ETAPI endpoints (`apps/server/src/etapi/`), maintain backwards compatibility by checking if new params exist before changing response format.

**Pattern**: ETAPI consumers expect specific response shapes. Always check for breaking changes.

### Frontend-Backend Communication
- **REST API**: `apps/server/src/routes/api/` - Internal endpoints (no auth required when `noAuthentication=true`)
- **ETAPI**: `apps/server/src/etapi/` - External API with authentication
- **WebSocket**: Real-time sync via `apps/server/src/services/ws.ts`

**Auth note**: ETAPI uses basic auth with tokens. Internal API endpoints trust the frontend.

### Database Migrations
- Add scripts in `apps/server/src/migrations/YYMMDD_HHMM__description.sql`
- Update schema in `apps/server/src/assets/db/schema.sql`
- Never bypass Becca cache after migrations

## Common Pitfalls

1. **Never bypass the cache layers** - Always use `becca.notes[noteId]`, `froca.getNote()`, or equivalent cache methods. Direct database queries will cause sync issues between Becca/Froca/Shaca and won't create EntityChange records needed for synchronization.

2. **Protected notes require session check** - Before accessing `note.title` or `note.getContent()` on protected notes, check `note.isContentAvailable()` or use `note.getTitleOrProtected()` which handles this automatically.

3. **Widget lifecycle matters** - Override `refreshWithNote()` for note changes, `doRenderBody()` for initial render, `entitiesReloadedEvent()` for entity updates. Widgets use jQuery (`this.$widget`) - don't mix React patterns.

4. **Tests run differently** - Server tests must run sequentially (shared database state), client tests can run in parallel. Use `pnpm test:sequential` for backend, `pnpm test:parallel` for frontend.

5. **ETAPI requires authentication** - ETAPI endpoints use basic auth with tokens. Internal API endpoints (`apps/server/src/routes/api/`) trust the frontend when `noAuthentication=true`.

6. **Search expressions are evaluated in memory** - The search service loads all matching notes, scores them in JavaScript, then sorts. You cannot add SQL-level LIMIT/OFFSET without losing scoring functionality.

7. **Documentation edits have rules** - `docs/Script API/` is auto-generated (never edit directly). `docs/User Guide/` should be edited via `pnpm edit-docs:edit-docs`, not manually. Only `docs/Developer Guide/` and `docs/Release Notes/` are safe for direct Markdown editing.

8. **pnpm workspace filtering** - Use `pnpm --filter server <command>` or shorthand `pnpm server:test` defined in root `package.json`. Note the `--filter` syntax, not `-F` or other shortcuts.

9. **Event subscription cleanup** - When subscribing to events in widgets, unsubscribe in `cleanup()` or `doDestroy()` to prevent memory leaks.

10. **Attribute inheritance can be complex** - When checking for labels/relations, use `note.getOwnedAttribute()` for direct attributes or `note.getAttribute()` for inherited ones. Don't assume attributes are directly on the note.

## TypeScript Configuration

- **Project references**: Monorepo uses TypeScript project references (`tsconfig.json`)
- **Path mapping**: Use relative imports, not path aliases
- **Build order**: `pnpm typecheck` builds all projects in dependency order
- **Build system**: Uses Vite for fast development, ESBuild for production optimization
- **Patches**: Custom patches in `patches/` directory for CKEditor and other dependencies

## Key Files for Context

- `apps/server/src/becca/entities/bnote.ts` - Note entity methods
- `apps/client/src/services/froca.ts` - Frontend cache API
- `apps/server/src/services/search/services/search.ts` - Search implementation
- `apps/server/src/routes/routes.ts` - API route registration
- `apps/client/src/widgets/basic_widget.ts` - Widget base class
- `apps/server/src/main.ts` - Server startup entry point
- `apps/client/src/desktop.ts` - Client initialization
- `apps/server/src/services/backend_script_api.ts` - Scripting API
- `apps/server/src/assets/db/schema.sql` - Database schema

## Note Types and Features

Trilium supports multiple note types with specialized widgets in `apps/client/src/widgets/type_widgets/`:
- **Text**: Rich text with CKEditor5 (markdown import/export)
- **Code**: Syntax-highlighted code editing with CodeMirror
- **File**: Binary file attachments
- **Image**: Image display with editing capabilities
- **Canvas**: Drawing/diagramming with Excalidraw
- **Mermaid**: Diagram generation
- **Relation Map**: Visual note relationship mapping
- **Web View**: Embedded web pages
- **Doc/Book**: Hierarchical documentation structure

### Collections
Notes can be marked with the `#collection` label to enable collection view modes. Collections support multiple view types:
- **List**: Standard list view
- **Grid**: Card/grid layout
- **Calendar**: Calendar-based view
- **Table**: Tabular data view
- **GeoMap**: Geographic map view
- **Board**: Kanban-style board
- **Presentation**: Slideshow presentation mode

View types are configured via `#viewType` label (e.g., `#viewType=table`). Each view mode stores its configuration in a separate attachment (e.g., `table.json`). Collections are organized separately from regular note type templates in the note creation menu.

## Common Development Tasks

### Adding New Note Types
1. Create widget in `apps/client/src/widgets/type_widgets/`
2. Register in `apps/client/src/services/note_types.ts`
3. Add backend handling in `apps/server/src/services/notes.ts`

### Extending Search
- Search expressions handled in `apps/server/src/services/search/`
- Add new search operators in search context files
- Remember: scoring happens in-memory, not at database level

### Custom CKEditor Plugins
- Create new package in `packages/` following existing plugin structure
- Register in `packages/ckeditor5/src/plugins.ts`
- See `ckeditor5-admonition`, `ckeditor5-footnotes`, `ckeditor5-math`, `ckeditor5-mermaid` for examples

### Database Migrations
- Add migration scripts in `apps/server/src/migrations/YYMMDD_HHMM__description.sql`
- Update schema in `apps/server/src/assets/db/schema.sql`
- Never bypass Becca cache after migrations

## Security & Features

### Security Considerations
- Per-note encryption with granular protected sessions
- CSRF protection for API endpoints
- OpenID and TOTP authentication support
- Sanitization of user-generated content

### Scripting System
Trilium provides powerful user scripting capabilities:
- **Frontend scripts**: Run in browser context with UI access
- **Backend scripts**: Run in Node.js context with full API access
- Script API documentation in `docs/Script API/`
- Backend API available via `api` object in script context

### Internationalization
- Translation files in `apps/client/src/translations/`
- Use translation system via `t()` function
- Automatic pluralization: Add `_other` suffix to translation keys (e.g., `item` and `item_other` for singular/plural)

## Testing Conventions

```typescript
// ETAPI test pattern
describe("etapi/feature", () => {
    beforeAll(async () => {
        config.General.noAuthentication = false;
        app = await buildApp();
        token = await login(app);
    });

    it("should test feature", async () => {
        const response = await supertest(app)
            .get("/etapi/notes?search=test")
            .auth(USER, token, { type: "basic" })
            .expect(200);
        
        expect(response.body.results).toBeDefined();
    });
});
```

## Questions to Verify Understanding

Before implementing significant changes, confirm:
- Is this touching the cache layer? (Becca/Froca/Shaca must stay in sync via EntityChange records)
- Does this change API response shape? (Check backwards compatibility for ETAPI)
- Are you adding search features? (Understand expression-based architecture and in-memory scoring first)
- Is this a new widget? (Know which base class and lifecycle methods to use)
- Does this involve protected notes? (Check `isContentAvailable()` before accessing content)
- Is this a long-running operation? (Use TaskContext for progress reporting)
- Are you working with attributes? (Understand inheritance patterns: direct, child-prefix, template)
