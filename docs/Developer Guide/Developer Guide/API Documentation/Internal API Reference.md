# Internal API Reference
## Table of Contents

1.  [Introduction](#introduction)
2.  [Authentication and Session Management](#authentication-and-session-management)
3.  [Core API Endpoints](#core-api-endpoints)
4.  [WebSocket Real-time Updates](#websocket-real-time-updates)
5.  [File Operations](#file-operations)
6.  [Import/Export Operations](#import-export-operations)
7.  [Synchronization API](#synchronization-api)
8.  [When to Use Internal vs ETAPI](#when-to-use-internal-vs-etapi)
9.  [Security Considerations](#security-considerations)

## Introduction

The Internal API is the primary interface used by the Trilium Notes client application to communicate with the server. While powerful and feature-complete, this API is primarily designed for internal use.

### Important Notice

**For external integrations, please use [ETAPI](ETAPI%20Complete%20Guide.md) instead.** The Internal API:

*   May change between versions without notice
*   Requires session-based authentication with CSRF protection
*   Is tightly coupled with the frontend application
*   Has limited documentation and stability guarantees

### Base URL

```
http://localhost:8080/api
```

### Key Characteristics

*   Session-based authentication with cookies
*   CSRF token protection for state-changing operations
*   WebSocket support for real-time updates
*   Full feature parity with the Trilium UI
*   Complex request/response formats optimized for the client

## Authentication and Session Management

### Password Login

**POST** `/api/login`

Authenticates user with password and creates a session.

**Request:**

```javascript
const formData = new URLSearchParams();
formData.append('password', 'your-password');

const response = await fetch('http://localhost:8080/api/login', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: formData,
    credentials: 'include'  // Important for cookie handling
});
```

**Response:**

```json
{
    "success": true,
    "message": "Login successful"
}
```

The server sets a session cookie (`trilium.sid`) that must be included in subsequent requests.

### TOTP Authentication (2FA)

If 2FA is enabled, include the TOTP token:

```javascript
formData.append('password', 'your-password');
formData.append('totpToken', '123456');
```

### Token Authentication

**POST** `/api/login/token`

Generate an API token for programmatic access:

```javascript
const response = await fetch('http://localhost:8080/api/login/token', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json'
    },
    body: JSON.stringify({
        password: 'your-password',
        tokenName: 'My Integration'
    })
});

const { authToken } = await response.json();
// Use this token in Authorization header for future requests
```

### Protected Session

**POST** `/api/login/protected`

Enter protected session to access encrypted notes:

```javascript
await fetch('http://localhost:8080/api/login/protected', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken
    },
    body: JSON.stringify({
        password: 'your-password'
    }),
    credentials: 'include'
});
```

### Logout

**POST** `/api/logout`

```javascript
await fetch('http://localhost:8080/api/logout', {
    method: 'POST',
    headers: {
        'X-CSRF-Token': csrfToken
    },
    credentials: 'include'
});
```

## Core API Endpoints

### Notes

#### Get Note

**GET** `/api/notes/{noteId}`

```javascript
const response = await fetch('http://localhost:8080/api/notes/root', {
    credentials: 'include'
});

const note = await response.json();
```

**Response:**

```json
{
    "noteId": "root",
    "title": "Trilium Notes",
    "type": "text",
    "mime": "text/html",
    "isProtected": false,
    "isDeleted": false,
    "dateCreated": "2024-01-01 00:00:00.000+0000",
    "dateModified": "2024-01-15 10:30:00.000+0000",
    "utcDateCreated": "2024-01-01 00:00:00.000Z",
    "utcDateModified": "2024-01-15 10:30:00.000Z",
    "parentBranches": [
        {
            "branchId": "root_root",
            "parentNoteId": "none",
            "prefix": null,
            "notePosition": 10
        }
    ],
    "attributes": [],
    "cssClass": "",
    "iconClass": "bx bx-folder"
}
```

#### Create Note

**POST** `/api/notes/{parentNoteId}/children`

```javascript
const response = await fetch('http://localhost:8080/api/notes/root/children', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken
    },
    body: JSON.stringify({
        title: 'New Note',
        type: 'text',
        content: '<p>Note content</p>',
        isProtected: false
    }),
    credentials: 'include'
});

const { note, branch } = await response.json();
```

#### Update Note

**PUT** `/api/notes/{noteId}`

```javascript
await fetch(`http://localhost:8080/api/notes/${noteId}`, {
    method: 'PUT',
    headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken
    },
    body: JSON.stringify({
        title: 'Updated Title',
        type: 'text',
        mime: 'text/html'
    }),
    credentials: 'include'
});
```

#### Delete Note

**DELETE** `/api/notes/{noteId}`

```javascript
await fetch(`http://localhost:8080/api/notes/${noteId}`, {
    method: 'DELETE',
    headers: {
        'X-CSRF-Token': csrfToken
    },
    credentials: 'include'
});
```

#### Get Note Content

**GET** `/api/notes/{noteId}/content`

Returns the actual content of the note:

```javascript
const response = await fetch(`http://localhost:8080/api/notes/${noteId}/content`, {
    credentials: 'include'
});

const content = await response.text();
```

#### Save Note Content

**PUT** `/api/notes/{noteId}/content`

```javascript
await fetch(`http://localhost:8080/api/notes/${noteId}/content`, {
    method: 'PUT',
    headers: {
        'Content-Type': 'text/html',
        'X-CSRF-Token': csrfToken
    },
    body: '<p>Updated content</p>',
    credentials: 'include'
});
```

### Tree Operations

#### Get Branch

**GET** `/api/branches/{branchId}`

```javascript
const branch = await fetch(`http://localhost:8080/api/branches/${branchId}`, {
    credentials: 'include'
}).then(r => r.json());
```

#### Move Note

**PUT** `/api/branches/{branchId}/move`

```javascript
await fetch(`http://localhost:8080/api/branches/${branchId}/move`, {
    method: 'PUT',
    headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken
    },
    body: JSON.stringify({
        parentNoteId: 'newParentId',
        beforeNoteId: 'siblingNoteId'  // optional, for positioning
    }),
    credentials: 'include'
});
```

#### Clone Note

**POST** `/api/notes/{noteId}/clone`

```javascript
const response = await fetch(`http://localhost:8080/api/notes/${noteId}/clone`, {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken
    },
    body: JSON.stringify({
        parentNoteId: 'targetParentId',
        prefix: 'Copy of '
    }),
    credentials: 'include'
});
```

#### Sort Child Notes

**PUT** `/api/notes/{noteId}/sort-children`

```javascript
await fetch(`http://localhost:8080/api/notes/${noteId}/sort-children`, {
    method: 'PUT',
    headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken
    },
    body: JSON.stringify({
        sortBy: 'title',  // or 'dateCreated', 'dateModified'
        reverse: false
    }),
    credentials: 'include'
});
```

### Attributes

#### Create Attribute

**POST** `/api/notes/{noteId}/attributes`

```javascript
const response = await fetch(`http://localhost:8080/api/notes/${noteId}/attributes`, {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken
    },
    body: JSON.stringify({
        type: 'label',
        name: 'todo',
        value: '',
        isInheritable: false
    }),
    credentials: 'include'
});
```

#### Update Attribute

**PUT** `/api/attributes/{attributeId}`

```javascript
await fetch(`http://localhost:8080/api/attributes/${attributeId}`, {
    method: 'PUT',
    headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken
    },
    body: JSON.stringify({
        value: 'updated value'
    }),
    credentials: 'include'
});
```

#### Delete Attribute

**DELETE** `/api/attributes/{attributeId}`

```javascript
await fetch(`http://localhost:8080/api/attributes/${attributeId}`, {
    method: 'DELETE',
    headers: {
        'X-CSRF-Token': csrfToken
    },
    credentials: 'include'
});
```

### Search

#### Search Notes

**GET** `/api/search`

```javascript
const params = new URLSearchParams({
    query: '#todo OR #task',
    fastSearch: 'false',
    includeArchivedNotes: 'false',
    ancestorNoteId: 'root',
    orderBy: 'relevancy',
    orderDirection: 'desc',
    limit: '50'
});

const response = await fetch(`http://localhost:8080/api/search?${params}`, {
    credentials: 'include'
});

const { results } = await response.json();
```

#### Search Note Map

**GET** `/api/search-note-map`

Returns hierarchical structure of search results:

```javascript
const params = new URLSearchParams({
    query: 'project',
    maxDepth: '3'
});

const noteMap = await fetch(`http://localhost:8080/api/search-note-map?${params}`, {
    credentials: 'include'
}).then(r => r.json());
```

### Revisions

#### Get Note Revisions

**GET** `/api/notes/{noteId}/revisions`

```javascript
const revisions = await fetch(`http://localhost:8080/api/notes/${noteId}/revisions`, {
    credentials: 'include'
}).then(r => r.json());
```

#### Get Revision Content

**GET** `/api/revisions/{revisionId}/content`

```javascript
const content = await fetch(`http://localhost:8080/api/revisions/${revisionId}/content`, {
    credentials: 'include'
}).then(r => r.text());
```

#### Restore Revision

**POST** `/api/revisions/{revisionId}/restore`

```javascript
await fetch(`http://localhost:8080/api/revisions/${revisionId}/restore`, {
    method: 'POST',
    headers: {
        'X-CSRF-Token': csrfToken
    },
    credentials: 'include'
});
```

#### Delete Revision

**DELETE** `/api/revisions/{revisionId}`

```javascript
await fetch(`http://localhost:8080/api/revisions/${revisionId}`, {
    method: 'DELETE',
    headers: {
        'X-CSRF-Token': csrfToken
    },
    credentials: 'include'
});
```

## WebSocket Real-time Updates

The Internal API provides WebSocket connections for real-time synchronization and updates.

### Connection Setup

```javascript
class TriliumWebSocket {
    constructor() {
        this.ws = null;
        this.reconnectInterval = 5000;
        this.shouldReconnect = true;
    }
    
    connect() {
        // WebSocket URL same as base URL but with ws:// protocol
        const wsUrl = 'ws://localhost:8080';
        
        this.ws = new WebSocket(wsUrl);
        
        this.ws.onopen = () => {
            console.log('WebSocket connected');
            this.sendPing();
        };
        
        this.ws.onmessage = (event) => {
            const message = JSON.parse(event.data);
            this.handleMessage(message);
        };
        
        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };
        
        this.ws.onclose = () => {
            console.log('WebSocket disconnected');
            if (this.shouldReconnect) {
                setTimeout(() => this.connect(), this.reconnectInterval);
            }
        };
    }
    
    handleMessage(message) {
        switch (message.type) {
            case 'sync':
                this.handleSync(message.data);
                break;
            case 'entity-changes':
                this.handleEntityChanges(message.data);
                break;
            case 'refresh-tree':
                this.refreshTree();
                break;
            case 'create-note':
                this.handleNoteCreated(message.data);
                break;
            case 'update-note':
                this.handleNoteUpdated(message.data);
                break;
            case 'delete-note':
                this.handleNoteDeleted(message.data);
                break;
            default:
                console.log('Unknown message type:', message.type);
        }
    }
    
    sendPing() {
        if (this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'ping' }));
            setTimeout(() => this.sendPing(), 30000); // Ping every 30 seconds
        }
    }
    
    send(type, data) {
        if (this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type, data }));
        }
    }
    
    handleSync(data) {
        // Handle synchronization data
        console.log('Sync data received:', data);
    }
    
    handleEntityChanges(changes) {
        // Handle entity change notifications
        changes.forEach(change => {
            console.log(`Entity ${change.entityName} ${change.entityId} changed`);
        });
    }
    
    refreshTree() {
        // Refresh the note tree UI
        console.log('Tree refresh requested');
    }
    
    handleNoteCreated(note) {
        console.log('Note created:', note);
    }
    
    handleNoteUpdated(note) {
        console.log('Note updated:', note);
    }
    
    handleNoteDeleted(noteId) {
        console.log('Note deleted:', noteId);
    }
    
    disconnect() {
        this.shouldReconnect = false;
        if (this.ws) {
            this.ws.close();
        }
    }
}

// Usage
const ws = new TriliumWebSocket();
ws.connect();

// Send custom message
ws.send('log-info', { info: 'Client started' });

// Clean up on page unload
window.addEventListener('beforeunload', () => {
    ws.disconnect();
});
```

### Message Types

#### Incoming Messages

| Type | Description | Data Format |
| --- | --- | --- |
| `sync` | Synchronization data | `{ entityChanges: [], lastSyncedPush: number }` |
| `entity-changes` | Entity modifications | `[{ entityName, entityId, action }]` |
| `refresh-tree` | Tree structure changed | None |
| `create-note` | Note created | Note object |
| `update-note` | Note updated | Note object |
| `delete-note` | Note deleted | `{ noteId }` |
| `frontend-script` | Execute frontend script | `{ script, params }` |

#### Outgoing Messages

| Type | Description | Data Format |
| --- | --- | --- |
| `ping` | Keep connection alive | None |
| `log-error` | Log client error | `{ error, stack }` |
| `log-info` | Log client info | `{ info }` |

### Real-time Collaboration Example

```javascript
class CollaborativeEditor {
    constructor(noteId) {
        this.noteId = noteId;
        this.ws = new TriliumWebSocket();
        this.content = '';
        this.lastSaved = '';
        
        this.ws.handleNoteUpdated = (note) => {
            if (note.noteId === this.noteId) {
                this.handleRemoteUpdate(note);
            }
        };
    }
    
    async loadNote() {
        const response = await fetch(`/api/notes/${this.noteId}/content`, {
            credentials: 'include'
        });
        this.content = await response.text();
        this.lastSaved = this.content;
    }
    
    handleRemoteUpdate(note) {
        // Check if the update is from another client
        if (this.content !== this.lastSaved) {
            // Show conflict resolution UI
            this.showConflictDialog(note);
        } else {
            // Apply remote changes
            this.loadNote();
        }
    }
    
    async saveContent(content) {
        this.content = content;
        
        await fetch(`/api/notes/${this.noteId}/content`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'text/html',
                'X-CSRF-Token': csrfToken
            },
            body: content,
            credentials: 'include'
        });
        
        this.lastSaved = content;
    }
    
    showConflictDialog(remoteNote) {
        // Implementation of conflict resolution UI
        console.log('Conflict detected with remote changes');
    }
}
```

## File Operations

### Upload File

**POST** `/api/notes/{noteId}/attachments/upload`

```javascript
const formData = new FormData();
formData.append('file', fileInput.files[0]);

const response = await fetch(`/api/notes/${noteId}/attachments/upload`, {
    method: 'POST',
    headers: {
        'X-CSRF-Token': csrfToken
    },
    body: formData,
    credentials: 'include'
});

const attachment = await response.json();
```

### Download Attachment

**GET** `/api/attachments/{attachmentId}/download`

```javascript
const response = await fetch(`/api/attachments/${attachmentId}/download`, {
    credentials: 'include'
});

const blob = await response.blob();
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = 'attachment.pdf';
a.click();
```

### Upload Image

**POST** `/api/images/upload`

```javascript
const formData = new FormData();
formData.append('image', imageFile);
formData.append('noteId', noteId);

const response = await fetch('/api/images/upload', {
    method: 'POST',
    headers: {
        'X-CSRF-Token': csrfToken
    },
    body: formData,
    credentials: 'include'
});

const { url, noteId: imageNoteId } = await response.json();
```

## Import/Export Operations

### Import ZIP

**POST** `/api/import`

```javascript
const formData = new FormData();
formData.append('file', zipFile);
formData.append('parentNoteId', 'root');

const response = await fetch('/api/import', {
    method: 'POST',
    headers: {
        'X-CSRF-Token': csrfToken
    },
    body: formData,
    credentials: 'include'
});

const result = await response.json();
```

### Export Subtree

**GET** `/api/notes/{noteId}/export`

```javascript
const params = new URLSearchParams({
    format: 'html',  // or 'markdown'
    exportRevisions: 'true'
});

const response = await fetch(`/api/notes/${noteId}/export?${params}`, {
    credentials: 'include'
});

const blob = await response.blob();
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = 'export.zip';
a.click();
```

### Import Markdown

**POST** `/api/import/markdown`

```javascript
const response = await fetch('/api/import/markdown', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken
    },
    body: JSON.stringify({
        parentNoteId: 'root',
        content: '# Markdown Content\n\nParagraph text...',
        title: 'Imported from Markdown'
    }),
    credentials: 'include'
});
```

### Export as PDF

**GET** `/api/notes/{noteId}/export/pdf`

```javascript
const response = await fetch(`/api/notes/${noteId}/export/pdf`, {
    credentials: 'include'
});

const blob = await response.blob();
const url = URL.createObjectURL(blob);
window.open(url, '_blank');
```

## Synchronization API

### Get Sync Status

**GET** `/api/sync/status`

```javascript
const status = await fetch('/api/sync/status', {
    credentials: 'include'
}).then(r => r.json());

console.log('Sync enabled:', status.syncEnabled);
console.log('Last sync:', status.lastSyncedPush);
```

### Force Sync

**POST** `/api/sync/now`

```javascript
await fetch('/api/sync/now', {
    method: 'POST',
    headers: {
        'X-CSRF-Token': csrfToken
    },
    credentials: 'include'
});
```

### Get Sync Log

**GET** `/api/sync/log`

```javascript
const log = await fetch('/api/sync/log', {
    credentials: 'include'
}).then(r => r.json());

log.forEach(entry => {
    console.log(`${entry.date}: ${entry.message}`);
});
```

## Script Execution

### Execute Script

**POST** `/api/script/run`

```javascript
const response = await fetch('/api/script/run', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken
    },
    body: JSON.stringify({
        script: `
            const note = await api.getNote('root');
            return { title: note.title, children: note.children.length };
        `,
        params: {}
    }),
    credentials: 'include'
});

const result = await response.json();
```

### Execute Note Script

**POST** `/api/notes/{noteId}/run`

Run a script note:

```javascript
const response = await fetch(`/api/notes/${scriptNoteId}/run`, {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken
    },
    body: JSON.stringify({
        params: {
            targetNoteId: 'someNoteId'
        }
    }),
    credentials: 'include'
});

const result = await response.json();
```

## Special Features

### Calendar API

#### Get Day Note

**GET** `/api/calendar/days/{date}`

```javascript
const date = '2024-01-15';
const dayNote = await fetch(`/api/calendar/days/${date}`, {
    credentials: 'include'
}).then(r => r.json());
```

#### Get Week Note

**GET** `/api/calendar/weeks/{date}`

```javascript
const weekNote = await fetch(`/api/calendar/weeks/2024-01-15`, {
    credentials: 'include'
}).then(r => r.json());
```

#### Get Month Note

**GET** `/api/calendar/months/{month}`

```javascript
const monthNote = await fetch(`/api/calendar/months/2024-01`, {
    credentials: 'include'
}).then(r => r.json());
```

### Inbox Note

**GET** `/api/inbox/{date}`

```javascript
const inboxNote = await fetch(`/api/inbox/2024-01-15`, {
    credentials: 'include'
}).then(r => r.json());
```

### Note Map

**GET** `/api/notes/{noteId}/map`

Get visual map data for a note:

```javascript
const mapData = await fetch(`/api/notes/${noteId}/map`, {
    credentials: 'include'
}).then(r => r.json());

// Returns nodes and links for visualization
console.log('Nodes:', mapData.nodes);
console.log('Links:', mapData.links);
```

### Similar Notes

**GET** `/api/notes/{noteId}/similar`

Find notes similar to the given note:

```javascript
const similarNotes = await fetch(`/api/notes/${noteId}/similar`, {
    credentials: 'include'
}).then(r => r.json());
```

## Options and Configuration

### Get All Options

**GET** `/api/options`

```javascript
const options = await fetch('/api/options', {
    credentials: 'include'
}).then(r => r.json());
```

### Update Option

**PUT** `/api/options/{optionName}`

```javascript
await fetch(`/api/options/theme`, {
    method: 'PUT',
    headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken
    },
    body: JSON.stringify({
        value: 'dark'
    }),
    credentials: 'include'
});
```

### Get User Preferences

**GET** `/api/options/user`

```javascript
const preferences = await fetch('/api/options/user', {
    credentials: 'include'
}).then(r => r.json());
```

## Database Operations

### Backup Database

**POST** `/api/database/backup`

```javascript
const response = await fetch('/api/database/backup', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken
    },
    body: JSON.stringify({
        backupName: 'manual-backup'
    }),
    credentials: 'include'
});

const { backupFile } = await response.json();
```

### Vacuum Database

**POST** `/api/database/vacuum`

```javascript
await fetch('/api/database/vacuum', {
    method: 'POST',
    headers: {
        'X-CSRF-Token': csrfToken
    },
    credentials: 'include'
});
```

### Get Database Info

**GET** `/api/database/info`

```javascript
const info = await fetch('/api/database/info', {
    credentials: 'include'
}).then(r => r.json());

console.log('Database size:', info.size);
console.log('Note count:', info.noteCount);
console.log('Revision count:', info.revisionCount);
```

## When to Use Internal vs ETAPI

### Use Internal API When:

*   Building custom Trilium clients
*   Needing WebSocket real-time updates
*   Requiring full feature parity with the UI
*   Working within the Trilium frontend environment
*   Accessing advanced features not available in ETAPI

### Use ETAPI When:

*   Building external integrations
*   Creating automation scripts
*   Developing third-party applications
*   Needing stable, documented API
*   Working with different programming languages

### Feature Comparison

| Feature | Internal API | ETAPI |
| --- | --- | --- |
| **Authentication** | Session/Cookie | Token |
| **CSRF Protection** | Required | Not needed |
| **WebSocket** | Yes | No  |
| **Stability** | May change | Stable |
| **Documentation** | Limited | Comprehensive |
| **Real-time updates** | Yes | No  |
| **File uploads** | Complex | Simple |
| **Scripting** | Full support | Limited |
| **Synchronization** | Yes | No  |

## Security Considerations

### CSRF Protection

All state-changing operations require a CSRF token:

```javascript
// Get CSRF token from meta tag or API
async function getCsrfToken() {
    const response = await fetch('/api/csrf-token', {
        credentials: 'include'
    });
    const { token } = await response.json();
    return token;
}

// Use in requests
const csrfToken = await getCsrfToken();

await fetch('/api/notes', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken
    },
    body: JSON.stringify(data),
    credentials: 'include'
});
```

### Session Management

```javascript
class TriliumSession {
    constructor() {
        this.isAuthenticated = false;
        this.csrfToken = null;
    }
    
    async login(password) {
        const formData = new URLSearchParams();
        formData.append('password', password);
        
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: formData,
            credentials: 'include'
        });
        
        if (response.ok) {
            this.isAuthenticated = true;
            this.csrfToken = await this.getCsrfToken();
            return true;
        }
        
        return false;
    }
    
    async getCsrfToken() {
        const response = await fetch('/api/csrf-token', {
            credentials: 'include'
        });
        const { token } = await response.json();
        return token;
    }
    
    async request(url, options = {}) {
        if (!this.isAuthenticated) {
            throw new Error('Not authenticated');
        }
        
        const headers = {
            ...options.headers
        };
        
        if (options.method && options.method !== 'GET') {
            headers['X-CSRF-Token'] = this.csrfToken;
        }
        
        return fetch(url, {
            ...options,
            headers,
            credentials: 'include'
        });
    }
    
    async logout() {
        await this.request('/api/logout', { method: 'POST' });
        this.isAuthenticated = false;
        this.csrfToken = null;
    }
}

// Usage
const session = new TriliumSession();
await session.login('password');

// Make authenticated requests
const notes = await session.request('/api/notes/root').then(r => r.json());

// Create note with CSRF protection
await session.request('/api/notes/root/children', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'New Note', type: 'text' })
});

await session.logout();
```

### Protected Notes

Handle encrypted notes properly:

```javascript
class ProtectedNoteHandler {
    constructor(session) {
        this.session = session;
        this.protectedSessionTimeout = null;
    }
    
    async enterProtectedSession(password) {
        const response = await this.session.request('/api/login/protected', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });
        
        if (response.ok) {
            // Protected session expires after inactivity
            this.resetProtectedSessionTimeout();
            return true;
        }
        
        return false;
    }
    
    resetProtectedSessionTimeout() {
        if (this.protectedSessionTimeout) {
            clearTimeout(this.protectedSessionTimeout);
        }
        
        // Assume 5 minute timeout
        this.protectedSessionTimeout = setTimeout(() => {
            console.log('Protected session expired');
            this.onProtectedSessionExpired();
        }, 5 * 60 * 1000);
    }
    
    async accessProtectedNote(noteId) {
        try {
            const note = await this.session.request(`/api/notes/${noteId}`)
                .then(r => r.json());
            
            if (note.isProtected) {
                // Reset timeout on successful access
                this.resetProtectedSessionTimeout();
            }
            
            return note;
        } catch (error) {
            if (error.message.includes('Protected session required')) {
                // Prompt for password
                const password = await this.promptForPassword();
                if (await this.enterProtectedSession(password)) {
                    return this.accessProtectedNote(noteId);
                }
            }
            throw error;
        }
    }
    
    async promptForPassword() {
        // Implementation depends on UI framework
        return prompt('Enter password for protected notes:');
    }
    
    onProtectedSessionExpired() {
        // Handle expiration (e.g., show notification, lock UI)
        console.log('Please re-enter password to access protected notes');
    }
}
```

## Error Handling

### Common Error Responses

```javascript
// 401 Unauthorized
{
    "status": 401,
    "message": "Authentication required"
}

// 403 Forbidden
{
    "status": 403,
    "message": "CSRF token validation failed"
}

// 404 Not Found
{
    "status": 404,
    "message": "Note 'invalidId' not found"
}

// 400 Bad Request
{
    "status": 400,
    "message": "Invalid note type: 'invalid'"
}

// 500 Internal Server Error
{
    "status": 500,
    "message": "Database error",
    "stack": "..." // Only in development
}
```

### Error Handler Implementation

```javascript
class APIErrorHandler {
    async handleResponse(response) {
        if (!response.ok) {
            const error = await this.parseError(response);
            
            switch (response.status) {
                case 401:
                    this.handleAuthError(error);
                    break;
                case 403:
                    this.handleForbiddenError(error);
                    break;
                case 404:
                    this.handleNotFoundError(error);
                    break;
                case 400:
                    this.handleBadRequestError(error);
                    break;
                case 500:
                    this.handleServerError(error);
                    break;
                default:
                    this.handleGenericError(error);
            }
            
            throw error;
        }
        
        return response;
    }
    
    async parseError(response) {
        try {
            const errorData = await response.json();
            return new APIError(
                response.status,
                errorData.message || response.statusText,
                errorData
            );
        } catch {
            return new APIError(
                response.status,
                response.statusText
            );
        }
    }
    
    handleAuthError(error) {
        console.error('Authentication required');
        // Redirect to login
        window.location.href = '/login';
    }
    
    handleForbiddenError(error) {
        if (error.message.includes('CSRF')) {
            console.error('CSRF token invalid, refreshing...');
            // Refresh CSRF token
            this.refreshCsrfToken();
        } else {
            console.error('Access forbidden:', error.message);
        }
    }
    
    handleNotFoundError(error) {
        console.error('Resource not found:', error.message);
    }
    
    handleBadRequestError(error) {
        console.error('Bad request:', error.message);
    }
    
    handleServerError(error) {
        console.error('Server error:', error.message);
        // Show user-friendly error message
        this.showErrorNotification('An error occurred. Please try again later.');
    }
    
    handleGenericError(error) {
        console.error('API error:', error);
    }
    
    showErrorNotification(message) {
        // Implementation depends on UI framework
        alert(message);
    }
}

class APIError extends Error {
    constructor(status, message, data = {}) {
        super(message);
        this.status = status;
        this.data = data;
        this.name = 'APIError';
    }
}
```

## Performance Optimization

### Request Batching

```javascript
class BatchedAPIClient {
    constructor() {
        this.batchQueue = [];
        this.batchTimeout = null;
        this.batchDelay = 50; // ms
    }
    
    async batchRequest(request) {
        return new Promise((resolve, reject) => {
            this.batchQueue.push({ request, resolve, reject });
            
            if (!this.batchTimeout) {
                this.batchTimeout = setTimeout(() => {
                    this.processBatch();
                }, this.batchDelay);
            }
        });
    }
    
    async processBatch() {
        const batch = this.batchQueue.splice(0);
        this.batchTimeout = null;
        
        if (batch.length === 0) return;
        
        try {
            const response = await fetch('/api/batch', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': csrfToken
                },
                body: JSON.stringify({
                    requests: batch.map(b => b.request)
                }),
                credentials: 'include'
            });
            
            const results = await response.json();
            
            batch.forEach((item, index) => {
                if (results[index].error) {
                    item.reject(new Error(results[index].error));
                } else {
                    item.resolve(results[index].data);
                }
            });
        } catch (error) {
            batch.forEach(item => item.reject(error));
        }
    }
    
    async getNote(noteId) {
        return this.batchRequest({
            method: 'GET',
            url: `/api/notes/${noteId}`
        });
    }
    
    async getAttribute(attributeId) {
        return this.batchRequest({
            method: 'GET',
            url: `/api/attributes/${attributeId}`
        });
    }
}

// Usage
const client = new BatchedAPIClient();

// These requests will be batched
const [note1, note2, note3] = await Promise.all([
    client.getNote('noteId1'),
    client.getNote('noteId2'),
    client.getNote('noteId3')
]);
```

### Caching Strategy

```javascript
class CachedAPIClient {
    constructor() {
        this.cache = new Map();
        this.cacheExpiry = new Map();
        this.defaultTTL = 5 * 60 * 1000; // 5 minutes
    }
    
    getCacheKey(method, url, params = {}) {
        return `${method}:${url}:${JSON.stringify(params)}`;
    }
    
    isExpired(key) {
        const expiry = this.cacheExpiry.get(key);
        return !expiry || Date.now() > expiry;
    }
    
    async cachedRequest(method, url, options = {}, ttl = this.defaultTTL) {
        const key = this.getCacheKey(method, url, options.params);
        
        if (method === 'GET' && this.cache.has(key) && !this.isExpired(key)) {
            return this.cache.get(key);
        }
        
        const response = await fetch(url, {
            method,
            ...options,
            credentials: 'include'
        });
        
        const data = await response.json();
        
        if (method === 'GET') {
            this.cache.set(key, data);
            this.cacheExpiry.set(key, Date.now() + ttl);
        }
        
        return data;
    }
    
    invalidate(pattern) {
        for (const key of this.cache.keys()) {
            if (key.includes(pattern)) {
                this.cache.delete(key);
                this.cacheExpiry.delete(key);
            }
        }
    }
    
    async getNote(noteId) {
        return this.cachedRequest('GET', `/api/notes/${noteId}`);
    }
    
    async updateNote(noteId, data) {
        const result = await fetch(`/api/notes/${noteId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrfToken
            },
            body: JSON.stringify(data),
            credentials: 'include'
        }).then(r => r.json());
        
        // Invalidate cache for this note
        this.invalidate(`/api/notes/${noteId}`);
        
        return result;
    }
}
```

## Advanced Examples

### Building a Note Explorer

```javascript
class NoteExplorer {
    constructor() {
        this.currentNote = null;
        this.history = [];
        this.historyIndex = -1;
    }
    
    async navigateToNote(noteId) {
        // Add to history
        if (this.historyIndex < this.history.length - 1) {
            this.history = this.history.slice(0, this.historyIndex + 1);
        }
        this.history.push(noteId);
        this.historyIndex++;
        
        // Load note
        this.currentNote = await this.loadNoteWithChildren(noteId);
        this.render();
    }
    
    async loadNoteWithChildren(noteId) {
        const [note, children] = await Promise.all([
            fetch(`/api/notes/${noteId}`, { credentials: 'include' })
                .then(r => r.json()),
            fetch(`/api/notes/${noteId}/children`, { credentials: 'include' })
                .then(r => r.json())
        ]);
        
        return { ...note, children };
    }
    
    canGoBack() {
        return this.historyIndex > 0;
    }
    
    canGoForward() {
        return this.historyIndex < this.history.length - 1;
    }
    
    async goBack() {
        if (this.canGoBack()) {
            this.historyIndex--;
            const noteId = this.history[this.historyIndex];
            this.currentNote = await this.loadNoteWithChildren(noteId);
            this.render();
        }
    }
    
    async goForward() {
        if (this.canGoForward()) {
            this.historyIndex++;
            const noteId = this.history[this.historyIndex];
            this.currentNote = await this.loadNoteWithChildren(noteId);
            this.render();
        }
    }
    
    async searchInSubtree(query) {
        const params = new URLSearchParams({
            query: query,
            ancestorNoteId: this.currentNote.noteId,
            includeArchivedNotes: 'false'
        });
        
        const response = await fetch(`/api/search?${params}`, {
            credentials: 'include'
        });
        
        return response.json();
    }
    
    async createChildNote(title, content, type = 'text') {
        const response = await fetch(`/api/notes/${this.currentNote.noteId}/children`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': await getCsrfToken()
            },
            body: JSON.stringify({ title, content, type }),
            credentials: 'include'
        });
        
        const result = await response.json();
        
        // Refresh current note to show new child
        this.currentNote = await this.loadNoteWithChildren(this.currentNote.noteId);
        this.render();
        
        return result;
    }
    
    render() {
        // Render UI - implementation depends on framework
        console.log('Current note:', this.currentNote.title);
        console.log('Children:', this.currentNote.children.map(c => c.title));
    }
}

// Usage
const explorer = new NoteExplorer();
await explorer.navigateToNote('root');
await explorer.createChildNote('New Child', '<p>Content</p>');
const searchResults = await explorer.searchInSubtree('keyword');
```

### Building a Task Management System

```javascript
class TaskManager {
    constructor() {
        this.taskRootId = null;
        this.csrfToken = null;
    }
    
    async initialize() {
        this.csrfToken = await getCsrfToken();
        this.taskRootId = await this.getOrCreateTaskRoot();
    }
    
    async getOrCreateTaskRoot() {
        // Search for existing task root
        const searchParams = new URLSearchParams({ query: '#taskRoot' });
        const searchResponse = await fetch(`/api/search?${searchParams}`, {
            credentials: 'include'
        });
        const { results } = await searchResponse.json();
        
        if (results.length > 0) {
            return results[0].noteId;
        }
        
        // Create task root
        const response = await fetch('/api/notes/root/children', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': this.csrfToken
            },
            body: JSON.stringify({
                title: 'Tasks',
                type: 'text',
                content: '<h1>Task Management</h1>'
            }),
            credentials: 'include'
        });
        
        const { note } = await response.json();
        
        // Add taskRoot label
        await this.addLabel(note.noteId, 'taskRoot');
        
        return note.noteId;
    }
    
    async createTask(title, description, priority = 'medium', dueDate = null) {
        // Create task note
        const response = await fetch(`/api/notes/${this.taskRootId}/children`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': this.csrfToken
            },
            body: JSON.stringify({
                title,
                type: 'text',
                content: `<h2>${title}</h2><p>${description}</p>`
            }),
            credentials: 'include'
        });
        
        const { note } = await response.json();
        
        // Add task metadata
        await Promise.all([
            this.addLabel(note.noteId, 'task'),
            this.addLabel(note.noteId, 'status', 'todo'),
            this.addLabel(note.noteId, 'priority', priority),
            dueDate ? this.addLabel(note.noteId, 'dueDate', dueDate) : null
        ].filter(Boolean));
        
        return note;
    }
    
    async addLabel(noteId, name, value = '') {
        await fetch(`/api/notes/${noteId}/attributes`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': this.csrfToken
            },
            body: JSON.stringify({
                type: 'label',
                name,
                value,
                isInheritable: false
            }),
            credentials: 'include'
        });
    }
    
    async getTasks(status = null, priority = null) {
        let query = '#task';
        if (status) query += ` #status=${status}`;
        if (priority) query += ` #priority=${priority}`;
        
        const params = new URLSearchParams({
            query,
            ancestorNoteId: this.taskRootId,
            orderBy: 'dateModified',
            orderDirection: 'desc'
        });
        
        const response = await fetch(`/api/search?${params}`, {
            credentials: 'include'
        });
        
        const { results } = await response.json();
        return results;
    }
    
    async updateTaskStatus(noteId, newStatus) {
        // Get task attributes
        const note = await fetch(`/api/notes/${noteId}`, {
            credentials: 'include'
        }).then(r => r.json());
        
        // Find status attribute
        const statusAttr = note.attributes.find(a => a.name === 'status');
        
        if (statusAttr) {
            // Update existing status
            await fetch(`/api/attributes/${statusAttr.attributeId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': this.csrfToken
                },
                body: JSON.stringify({ value: newStatus }),
                credentials: 'include'
            });
        } else {
            // Add status attribute
            await this.addLabel(noteId, 'status', newStatus);
        }
        
        // Add completion timestamp if marking as done
        if (newStatus === 'done') {
            const timestamp = new Date().toISOString();
            await this.addLabel(noteId, 'completedAt', timestamp);
        }
    }
    
    async getTaskStats() {
        const [todoTasks, inProgressTasks, doneTasks] = await Promise.all([
            this.getTasks('todo'),
            this.getTasks('in-progress'),
            this.getTasks('done')
        ]);
        
        return {
            todo: todoTasks.length,
            inProgress: inProgressTasks.length,
            done: doneTasks.length,
            total: todoTasks.length + inProgressTasks.length + doneTasks.length
        };
    }
}

// Usage
const taskManager = new TaskManager();
await taskManager.initialize();

// Create tasks
const task1 = await taskManager.createTask(
    'Review Documentation',
    'Review and update API documentation',
    'high',
    '2024-01-20'
);

const task2 = await taskManager.createTask(
    'Fix Bug #123',
    'Investigate and fix the reported issue',
    'medium'
);

// Get tasks
const todoTasks = await taskManager.getTasks('todo');
console.log('Todo tasks:', todoTasks);

// Update task status
await taskManager.updateTaskStatus(task1.noteId, 'in-progress');

// Get statistics
const stats = await taskManager.getTaskStats();
console.log('Task statistics:', stats);
```

## Conclusion

The Internal API provides complete access to Trilium's functionality but should be used with caution due to its complexity and potential for changes. For most external integrations, [ETAPI](ETAPI%20Complete%20Guide.md) is the recommended choice due to its stability and comprehensive documentation.

Key takeaways:

*   Always include CSRF tokens for state-changing operations
*   Handle session management carefully
*   Use WebSocket for real-time updates
*   Implement proper error handling
*   Consider using ETAPI for external integrations
*   Cache responses when appropriate for better performance

For additional information, refer to:

*   [ETAPI Complete Guide](ETAPI%20Complete%20Guide.md)
*   [Script API Cookbook](Script%20API%20Cookbook.md)
*   [WebSocket API Documentation](WebSocket%20API.md)