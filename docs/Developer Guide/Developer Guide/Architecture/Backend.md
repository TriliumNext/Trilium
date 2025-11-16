# Backend
### Application Entry Point

Location: `apps/server/src/main.ts`

**Startup Sequence:**

1.  Load configuration
2.  Initialize database
3.  Run migrations
4.  Load Becca cache
5.  Start Express server
6.  Initialize WebSocket
7.  Start scheduled tasks

### Service Layer

Located at: `apps/server/src/services/`

**Core Services:**

*   **Notes Management**
    *   `notes.ts` - CRUD operations
    *   `note_contents.ts` - Content handling
    *   `note_types.ts` - Type-specific logic
    *   `cloning.ts` - Note cloning/multi-parent
*   **Tree Operations**
    *   `tree.ts` - Tree structure management
    *   `branches.ts` - Branch operations
    *   `consistency_checks.ts` - Tree integrity
*   **Search**
    *   `search/search.ts` - Main search engine
    *   `search/expressions/` - Search expression parsing
    *   `search/services/` - Search utilities
*   **Sync**
    *   `sync.ts` - Synchronization protocol
    *   `sync_update.ts` - Update handling
    *   `sync_mutex.ts` - Concurrency control
*   **Scripting**
    *   `backend_script_api.ts` - Backend script API
    *   `script_context.ts` - Script execution context
*   **Import/Export**
    *   `import/` - Various import formats
    *   `export/` - Export to different formats
    *   `zip.ts` - Archive handling
*   **Security**
    *   `encryption.ts` - Note encryption
    *   `protected_session.ts` - Session management
    *   `password.ts` - Password handling

### Route Structure

Located at: `apps/server/src/routes/`

```
routes/
├── index.ts              # Route registration
├── api/                  # REST API endpoints
│   ├── notes.ts
│   ├── branches.ts
│   ├── attributes.ts
│   ├── search.ts
│   ├── login.ts
│   └── ...
└── custom/               # Special endpoints
    ├── setup.ts
    ├── share.ts
    └── ...
```

**API Endpoint Pattern:**

```typescript
router.get('/api/notes/:noteId', (req, res) => {
    const noteId = req.params.noteId
    const note = becca.getNote(noteId)
    res.json(note.getPojoWithContent())
})
```

### Middleware

Key middleware components:

*   `auth.ts` - Authentication
*   `csrf.ts` - CSRF protection
*   `request_context.ts` - Request-scoped data
*   `error_handling.ts` - Error responses