# Database
Trilium uses **SQLite** (via `better-sqlite3`) as its embedded database engine, providing a reliable, file-based storage system that requires no separate database server. The database stores all notes, their relationships, metadata, and configuration.

Schema location: `apps/server/src/assets/db/schema.sql`

### Data Access Patterns

**Direct SQL:**

```typescript
// apps/server/src/services/sql.ts
sql.getRows("SELECT * FROM notes WHERE type = ?", ['text'])
sql.execute("UPDATE notes SET title = ? WHERE noteId = ?", [title, noteId])
```

**Through Becca:**

```typescript
// Recommended approach - uses cache
const note = becca.getNote('noteId')
note.title = 'New Title'
note.save()
```

**Through Froca (Frontend):**

```typescript
// Read-only access
const note = froca.getNote('noteId')
console.log(note.title)
```

### Database Migrations

*   The migration system is in `server/src/migrations/migrations.ts` (actual definitions) and `src/services/migration.ts`.
*   Both SQLite and TypeScript migrations are supported.
    *   Small migrations are contained directly in `src/migrations/migrations.ts`.
    *   Bigger TypeScript migrations are sequentially numbered (e.g., `XXXX_migration_name.ts`) and dynamically imported by `migrations.ts`.
*   Automatic execution on version upgrade.
*   Schema version tracked in options table.