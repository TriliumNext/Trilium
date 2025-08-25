# Three-Layer-Cache-System
## Three-Layer Cache System Architecture

Trilium implements a sophisticated three-layer caching system to optimize performance and reduce database load. This architecture ensures fast access to frequently used data while maintaining consistency across different application contexts.

## Overview

The three cache layers are:

1.  **Becca** (Backend Cache) - Server-side entity cache
2.  **Froca** (Frontend Cache) - Client-side mirror of backend data
3.  **Shaca** (Share Cache) - Optimized cache for shared/published notes

```
graph TB
    subgraph "Database Layer"
        DB[(SQLite Database)]
    end
    
    subgraph "Backend Layer"
        Becca[Becca Cache<br/>Backend Cache]
        API[API Layer]
    end
    
    subgraph "Frontend Layer"
        Froca[Froca Cache<br/>Frontend Cache]
        UI[UI Components]
    end
    
    subgraph "Share Layer"
        Shaca[Shaca Cache<br/>Share Cache]
        Share[Public Share Interface]
    end
    
    DB <--> Becca
    Becca <--> API
    API <--> Froca
    Froca <--> UI
    DB <--> Shaca
    Shaca <--> Share
    
    style Becca fill:#e1f5fe
    style Froca fill:#fff3e0
    style Shaca fill:#f3e5f5
```

## Becca (Backend Cache)

**Location**: `/apps/server/src/becca/`

Becca is the authoritative cache layer that maintains all notes, branches, attributes, and options in server memory.

### Key Components

#### Becca Interface (`becca-interface.ts`)

```typescript
export default class Becca {
    loaded: boolean;
    notes: Record<string, BNote>;
    branches: Record<string, BBranch>;
    childParentToBranch: Record<string, BBranch>;
    attributes: Record<string, BAttribute>;
    attributeIndex: Record<string, BAttribute[]>;
    options: Record<string, BOption>;
    etapiTokens: Record<string, BEtapiToken>;
    allNoteSetCache: NoteSet | null;
}
```

### Features

*   **In-memory storage**: All active entities are kept in memory for fast access
*   **Lazy loading**: Related entities (revisions, attachments) loaded on demand
*   **Index structures**: Optimized lookups via `childParentToBranch` and `attributeIndex`
*   **Cache invalidation**: Automatic cache updates on entity changes
*   **Protected note decryption**: On-demand decryption of encrypted content

### Usage Example

```typescript
import becca from "./becca/becca.js";

// Get a note
const note = becca.getNote("noteId");

// Find attributes by type and name
const labels = becca.findAttributes("label", "todoItem");

// Get branch relationships
const branch = becca.getBranchFromChildAndParent(childId, parentId);
```

### Data Flow

1.  **Initialization**: Load all notes, branches, and attributes from database
2.  **Access**: Direct memory access for cached entities
3.  **Updates**: Write-through cache with immediate database persistence
4.  **Invalidation**: Automatic cache refresh on entity changes

## Froca (Frontend Cache)

**Location**: `/apps/client/src/services/froca.ts`

Froca is the frontend mirror of Becca, maintaining a subset of backend data for client-side operations.

### Key Components

#### Froca Implementation (`froca.ts`)

```typescript
class FrocaImpl implements Froca {
    notes: Record<string, FNote>;
    branches: Record<string, FBranch>;
    attributes: Record<string, FAttribute>;
    attachments: Record<string, FAttachment>;
    blobPromises: Record<string, Promise<FBlob | null> | null>;
}
```

### Features

*   **Lazy loading**: Notes loaded on-demand with their immediate context
*   **Subtree loading**: Efficient loading of note hierarchies
*   **Real-time updates**: WebSocket synchronization with backend changes
*   **Search note support**: Virtual branches for search results
*   **Promise-based blob loading**: Asynchronous content loading

### Loading Strategy

```typescript
// Initial load - loads root and immediate children
await froca.loadInitialTree();

// Load subtree on demand
const note = await froca.loadSubTree(noteId);

// Reload specific notes
await froca.reloadNotes([noteId1, noteId2]);
```

### Synchronization

Froca maintains consistency with Becca through:

1.  **Initial sync**: Load essential tree structure on startup
2.  **On-demand loading**: Fetch notes as needed
3.  **WebSocket updates**: Real-time push of changes from backend
4.  **Batch reloading**: Efficient refresh of multiple notes

## Shaca (Share Cache)

**Location**: `/apps/server/src/share/shaca/`

Shaca is a specialized cache for publicly shared notes, optimized for read-only access.

### Key Components

#### Shaca Interface (`shaca-interface.ts`)

```typescript
export default class Shaca {
    notes: Record<string, SNote>;
    branches: Record<string, SBranch>;
    childParentToBranch: Record<string, SBranch>;
    attributes: Record<string, SAttribute>;
    attachments: Record<string, SAttachment>;
    aliasToNote: Record<string, SNote>;
    shareRootNote: SNote | null;
    shareIndexEnabled: boolean;
}
```

### Features

*   **Read-only optimization**: Streamlined for public access
*   **Alias support**: URL-friendly note access via aliases
*   **Share index**: Optional indexing of all shared subtrees
*   **Minimal memory footprint**: Only shared content cached
*   **Security isolation**: Separate from main application cache

### Usage Patterns

```typescript
// Get shared note by ID
const note = shaca.getNote(noteId);

// Access via alias
const aliasedNote = shaca.aliasToNote[alias];

// Check if note is shared
const isShared = shaca.hasNote(noteId);
```

## Cache Interaction and Data Flow

### 1\. Create/Update Flow

```
sequenceDiagram
    participant Client
    participant Froca
    participant API
    participant Becca
    participant DB
    
    Client->>API: Update Note
    API->>Becca: Update Cache
    Becca->>DB: Persist Change
    Becca->>API: Confirm
    API->>Froca: Push Update (WebSocket)
    Froca->>Client: Update UI
```

### 2\. Read Flow

```
sequenceDiagram
    participant Client
    participant Froca
    participant API
    participant Becca
    
    Client->>Froca: Request Note
    alt Note in Cache
        Froca->>Client: Return Cached Note
    else Note not in Cache
        Froca->>API: Fetch Note
        API->>Becca: Get Note
        Becca->>API: Return Note
        API->>Froca: Send Note Data
        Froca->>Froca: Cache Note
        Froca->>Client: Return Note
    end
```

### 3\. Share Access Flow

```
sequenceDiagram
    participant Browser
    participant ShareUI
    participant Shaca
    participant DB
    
    Browser->>ShareUI: Access Shared URL
    ShareUI->>Shaca: Get Shared Note
    alt Note in Cache
        Shaca->>ShareUI: Return Cached
    else Not in Cache
        Shaca->>DB: Load Shared Tree
        DB->>Shaca: Return Data
        Shaca->>Shaca: Build Cache
        Shaca->>ShareUI: Return Note
    end
    ShareUI->>Browser: Render Content
```

## Performance Considerations

### Memory Management

*   **Becca**: Keeps entire note tree in memory (~100-500MB for typical use)
*   **Froca**: Loads notes on-demand, automatic cleanup of unused notes
*   **Shaca**: Minimal footprint, only shared content

### Cache Warming

*   **Becca**: Full load on server startup
*   **Froca**: Progressive loading based on user navigation
*   **Shaca**: Lazy loading with configurable index

### Optimization Strategies

1.  **Attribute Indexing**: Pre-built indexes for fast attribute queries
2.  **Batch Operations**: Group updates to minimize round trips
3.  **Partial Loading**: Load only required fields for lists
4.  **WebSocket Compression**: Compressed real-time updates

## Best Practices

### When to Use Each Cache

**Use Becca when**:

*   Implementing server-side business logic
*   Performing bulk operations
*   Handling synchronization
*   Managing protected notes

**Use Froca when**:

*   Building UI components
*   Handling user interactions
*   Displaying note content
*   Managing client state

**Use Shaca when**:

*   Serving public content
*   Building share pages
*   Implementing read-only access
*   Creating public APIs

### Cache Invalidation

```typescript
// Becca - automatic on entity save
note.save(); // Cache updated automatically

// Froca - manual reload when needed
await froca.reloadNotes([noteId]);

// Shaca - rebuild on share changes
shaca.reset();
shaca.load();
```

### Error Handling

```typescript
// Becca - throw on missing required entities
const note = becca.getNoteOrThrow(noteId); // throws NotFoundError

// Froca - graceful degradation
const note = await froca.getNote(noteId);
if (!note) {
    // Handle missing note
}

// Shaca - check existence first
if (shaca.hasNote(noteId)) {
    const note = shaca.getNote(noteId);
}
```

## Troubleshooting

### Common Issues

1.  **Cache Inconsistency**
    
    *   Symptom: UI shows outdated data
    *   Solution: Force reload with `froca.reloadNotes()`
2.  **Memory Growth**
    
    *   Symptom: Server memory usage increases
    *   Solution: Check for memory leaks in custom scripts
3.  **Slow Initial Load**
    
    *   Symptom: Long startup time
    *   Solution: Optimize database queries, add indexes

### Debug Commands

```javascript
// Check cache sizes
console.log('Becca notes:', Object.keys(becca.notes).length);
console.log('Froca notes:', Object.keys(froca.notes).length);
console.log('Shaca notes:', Object.keys(shaca.notes).length);

// Force cache refresh
await froca.loadInitialTree();

// Clear and reload Shaca
shaca.reset();
await shaca.load();
```

## Related Documentation

*   [Entity System](Entity-System.md) - Detailed entity documentation
*   [Database Schema](#root/eZcnGfMUmic0) - Database structure
*   [WebSocket Synchronization](#root/UBgXVlHv3d66) - Real-time updates