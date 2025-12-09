# Frontend
### Application Entry Point

**Desktop:** `apps/client/src/desktop.ts` **Web:** `apps/client/src/index.ts`

### Service Layer

Located at: `apps/client/src/services/`

Key services:

*   `froca.ts` - Frontend cache
*   `server.ts` - API communication
*   `ws.ts` - WebSocket connection
*   `tree_service.ts` - Note tree management
*   `note_context.ts` - Active note tracking
*   `protected_session.ts` - Encryption key management
*   `link.ts` - Note linking and navigation
*   `export.ts` - Note export functionality

### UI Components

**Component Locations:**

*   `widgets/containers/` - Layout containers
*   `widgets/buttons/` - Toolbar buttons
*   `widgets/dialogs/` - Modal dialogs
*   `widgets/ribbon_widgets/` - Tab widgets
*   `widgets/type_widgets/` - Note type editors

### Event System

**Application Events:**

```typescript
// Subscribe to events
appContext.addBeforeUnloadListener(() => {
    // Cleanup before page unload
})

// Trigger events
appContext.trigger('noteTreeLoaded')
```

**Note Context Events:**

```typescript
// NoteContextAwareWidget automatically receives:
- noteSwitched()
- noteChanged()
- refresh()
```

### State Management

Trilium uses **custom state management** rather than Redux/MobX:

*   `note_context.ts` - Active note and context
*   `froca.ts` - Entity cache
*   Component local state
*   URL parameters for shareable state