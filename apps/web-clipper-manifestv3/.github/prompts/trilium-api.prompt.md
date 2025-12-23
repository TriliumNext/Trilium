---
name: trilium-api
description: Work with Trilium ETAPI integration - note creation, attributes, and connections
argument-hint: Describe the Trilium API task
agent: agent
tools:
  - codebase
  - editFiles
  - fetch
  - search
  - usages
---

# Trilium API Integration Prompt

You are working on **Trilium ETAPI integration** for the Web Clipper extension. This involves note creation, attribute management, and server/desktop connection handling.

## Trilium Connection Methods

### Desktop Client (Preferred)
```typescript
// localhost:37840 - No auth required
const DESKTOP_URL = 'http://localhost:37840/etapi';

// No authentication header needed
const response = await fetch(`${DESKTOP_URL}/notes`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(noteData)
});
```

### Server (Remote)
```typescript
// Custom URL with authentication
const SERVER_URL = 'https://your-trilium.example.com/etapi';

const response = await fetch(`${SERVER_URL}/notes`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`  // Required for server
  },
  body: JSON.stringify(noteData)
});
```

### Connection Strategy
```typescript
// Try both in parallel, use first successful
async function connectToTrilium(): Promise<TriliumConnection> {
  const [desktop, server] = await Promise.allSettled([
    tryDesktopConnection(),
    tryServerConnection()
  ]);
  
  if (desktop.status === 'fulfilled') return desktop.value;
  if (server.status === 'fulfilled') return server.value;
  throw new Error('Could not connect to Trilium');
}
```

## ETAPI Endpoints

### Create Note
```typescript
// POST /etapi/create-note
interface CreateNoteRequest {
  parentNoteId: string;      // "root" or specific note ID
  title: string;
  type: 'text' | 'code' | 'image' | 'file';
  mime?: string;             // e.g., 'text/html', 'image/png'
  content: string;           // Note content
  attributes?: NoteAttribute[];
}

interface NoteAttribute {
  type: 'label' | 'relation';
  name: string;
  value: string;
}
```

### Common Attributes
```typescript
// Labels for clipped content
const clipperAttributes: NoteAttribute[] = [
  { type: 'label', name: 'pageUrl', value: sourceUrl },
  { type: 'label', name: 'clipType', value: 'selection' | 'page' | 'screenshot' },
  { type: 'label', name: 'clipDate', value: new Date().toISOString() },
  { type: 'label', name: 'sourceTitle', value: pageTitle }
];
```

### Search Notes
```typescript
// GET /etapi/notes?search=<query>
const response = await fetch(`${baseUrl}/notes?search=${encodeURIComponent(query)}`);
const notes = await response.json();
```

### Get Note
```typescript
// GET /etapi/notes/<noteId>
const response = await fetch(`${baseUrl}/notes/${noteId}`);
const note = await response.json();
```

### Get Note Content
```typescript
// GET /etapi/notes/<noteId>/content
const response = await fetch(`${baseUrl}/notes/${noteId}/content`);
const content = await response.text();
```

## Error Handling

```typescript
interface ETAPIError {
  status: number;
  code: string;
  message: string;
}

async function handleETAPIResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const error = await response.json() as ETAPIError;
    
    switch (response.status) {
      case 401:
        throw new Error('Authentication failed. Check your token.');
      case 404:
        throw new Error('Note not found.');
      case 400:
        throw new Error(`Invalid request: ${error.message}`);
      default:
        throw new Error(`Trilium error: ${error.message}`);
    }
  }
  
  return response.json();
}
```

## Content Formatting

### HTML Content
```typescript
// Trilium expects clean HTML
const prepareHtmlContent = (html: string): string => {
  const sanitized = DOMPurify.sanitize(html);
  // Trilium wraps in note container, no need for full HTML
  return sanitized;
};
```

### Image Content
```typescript
// Images as base64 in data URL or binary
const saveImage = async (dataUrl: string, title: string) => {
  const base64 = dataUrl.split(',')[1];
  const binary = atob(base64);
  
  // For binary upload, use appropriate content-type
  const response = await fetch(`${baseUrl}/create-note`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      parentNoteId: 'root',
      title,
      type: 'image',
      mime: 'image/png',
      content: base64  // Base64 encoded
    })
  });
};
```

## Reference Agent

See [Trilium Integration Expert](../agents/trilium-integration-expert.md) for comprehensive ETAPI documentation.

## Testing Connection

```typescript
// Health check endpoint
async function testConnection(url: string, token?: string): Promise<boolean> {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    
    const response = await fetch(`${url}/app-info`, { headers });
    return response.ok;
  } catch {
    return false;
  }
}
```

## Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| 401 Unauthorized | Invalid/missing token | Check ETAPI token |
| Connection refused | Desktop not running | Start Trilium Desktop |
| CORS error | Browser blocking | Use service worker for requests |
| Note not created | Invalid parent | Use "root" for top-level |
