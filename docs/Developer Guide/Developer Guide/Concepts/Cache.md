# Cache
### Three-Layer Cache System

Trilium implements a sophisticated **three-tier caching system** to optimize performance and enable offline functionality:

#### 1\. Becca (Backend Cache)

Located at: `apps/server/src/becca/`

```typescript
// Becca caches all entities in memory
class Becca {
    notes: Record<string, BNote>
    branches: Record<string, BBranch>
    attributes: Record<string, BAttribute>
    attachments: Record<string, BAttachment>
    // ... other entity collections
}
```

**Responsibilities:**

*   Server-side entity cache
*   Maintains complete note tree in memory
*   Handles entity relationships and integrity
*   Provides fast lookups without database queries
*   Manages entity lifecycle (create, update, delete)

**Key Files:**

*   `becca.ts` - Main cache instance
*   `becca_loader.ts` - Loads entities from database
*   `becca_service.ts` - Cache management operations
*   `entities/` - Entity classes (BNote, BBranch, etc.)

#### 2\. Froca (Frontend Cache)

Located at: `apps/client/src/services/froca.ts`

```typescript
// Froca is a read-only mirror of backend data
class Froca {
    notes: Record<string, FNote>
    branches: Record<string, FBranch>
    attributes: Record<string, FAttribute>
    // ... other entity collections
}
```

**Responsibilities:**

*   Frontend read-only cache
*   Lazy loading of note tree
*   Minimizes API calls
*   Enables fast UI rendering
*   Synchronizes with backend via WebSocket

**Loading Strategy:**

*   Initial load: root notes and immediate children
*   Lazy load: notes loaded when accessed
*   When note is loaded, all parent and child branches load
*   Deleted entities tracked via missing branches

#### 3\. Shaca (Share Cache)

Located at: `apps/server/src/share/`

**Responsibilities:**

*   Optimized cache for shared/published notes
*   Handles public note access without authentication
*   Performance-optimized for high-traffic scenarios
*   Separate from main Becca to isolate concerns

### Cache Invalidation

**Server-Side:**

*   Entities automatically update cache on save
*   WebSocket broadcasts changes to all clients
*   Synchronization updates trigger cache refresh

**Client-Side:**

*   WebSocket listeners update Froca
*   Manual reload via `froca.loadSubTree(noteId)`
*   Full reload on protected session changes

### Cache Consistency

**Entity Change Tracking:**

```typescript
// Every entity modification tracked
entity_changes (
    entityName: 'notes',
    entityId: 'note123',
    hash: 'abc...',
    changeId: 'change456',
    utcDateChanged: '2025-11-02...'
)
```

**Sync Protocol:**

1.  Client requests changes since last sync
2.  Server returns entity\_changes records
3.  Client applies changes to Froca
4.  Client sends local changes to server
5.  Server updates Becca and database