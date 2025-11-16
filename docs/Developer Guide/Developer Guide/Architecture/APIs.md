# APIs
### Internal API

**REST Endpoints** (`/api/*`)

Used by the frontend for all operations:

**Note Operations:**

*   `GET /api/notes/:noteId` - Get note
*   `POST /api/notes/:noteId/content` - Update content
*   `PUT /api/notes/:noteId` - Update metadata
*   `DELETE /api/notes/:noteId` - Delete note

**Tree Operations:**

*   `GET /api/tree` - Get note tree
*   `POST /api/branches` - Create branch
*   `PUT /api/branches/:branchId` - Update branch
*   `DELETE /api/branches/:branchId` - Delete branch

**Search:**

*   `GET /api/search?query=...` - Search notes
*   `GET /api/search-note/:noteId` - Execute search note

### ETAPI (External API)

Located at: `apps/server/src/etapi/`

**Purpose:** Third-party integrations and automation

**Authentication:** Token-based (ETAPI tokens)

**OpenAPI Spec:** Auto-generated

**Key Endpoints:**

*   `/etapi/notes` - Note CRUD
*   `/etapi/branches` - Branch management
*   `/etapi/attributes` - Attribute operations
*   `/etapi/attachments` - Attachment handling

**Example:**

```
curl -H "Authorization: YOUR_TOKEN" \
  https://trilium.example.com/etapi/notes/noteId
```

### WebSocket API

Located at: `apps/server/src/services/ws.ts`

**Purpose:** Real-time updates and synchronization

**Protocol:** WebSocket (Socket.IO-like custom protocol)

**Message Types:**

*   `sync` - Synchronization request
*   `entity-change` - Entity update notification
*   `refresh-tree` - Tree structure changed
*   `open-note` - Open note in UI

**Client Subscribe:**

```typescript
ws.subscribe('entity-change', (data) => {
    froca.processEntityChange(data)
})
```