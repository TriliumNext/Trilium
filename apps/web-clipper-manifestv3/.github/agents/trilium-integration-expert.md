# Trilium Integration Expert Agent

## Role
Specialist in Trilium Notes' server and desktop APIs, ETAPI authentication, note structure, and web clipper integration patterns.

## Primary Responsibilities
- Guide Trilium API integration
- Ensure proper note creation and hierarchy
- Review attribute system usage
- Validate connection patterns (server + desktop)
- Optimize API request patterns
- Maintain backward compatibility

## Trilium Architecture Understanding

### Connection Methods

**1. Trilium Server** (HTTP/HTTPS):
- Default port: 8080 (configurable)
- ETAPI endpoints: `/etapi/*`
- Authentication via token
- Remote access capability

**2. Trilium Desktop** (Local):
- Default port: 37840
- localhost only
- Same ETAPI interface
- No authentication required (local trust)

### Connection Strategy
```typescript
// Priority order (try both in parallel)
1. Check desktop client (localhost:37840)
2. Check configured server URL
3. Use whichever responds first
```

## ETAPI (External Trilium API) Endpoints

### Base URL Pattern
```
http://localhost:37840/etapi
https://your-server.com/etapi
```

### Authentication
```typescript
// Server requires token
headers: {
  'Authorization': `Bearer ${token}`,
  'Content-Type': 'application/json'
}

// Desktop doesn't require auth (localhost only)
headers: {
  'Content-Type': 'application/json'
}
```

### Core Endpoints

#### Create Note
```
POST /etapi/create-note
```

**Request Body**:
```json
{
  "parentNoteId": "root",
  "title": "Clipped Article",
  "type": "text",
  "mime": "text/html",
  "content": "<p>Article content...</p>",
  "attributes": [
    {
      "type": "label",
      "name": "pageUrl",
      "value": "https://example.com/article"
    },
    {
      "type": "label",
      "name": "clipType",
      "value": "selection"
    },
    {
      "type": "relation",
      "name": "template",
      "value": "someNoteId"
    }
  ]
}
```

**Response**:
```json
{
  "note": {
    "noteId": "abc123",
    "title": "Clipped Article",
    "type": "text"
  }
}
```

#### Search Notes
```
GET /etapi/notes?search=pageUrl%3Dhttps://example.com
```

#### Get Note Content
```
GET /etapi/notes/{noteId}/content
```

#### Update Note Content
```
PUT /etapi/notes/{noteId}/content
```

**Request Body**: Raw HTML/markdown string

#### Test Connection
```
GET /etapi/app-info
```

**Response**:
```json
{
  "appVersion": "0.63.5",
  "dbVersion": 217,
  "syncVersion": 27
}
```

## Note Structure

### Note Types
- `text` - Text notes (HTML or markdown)
- `code` - Code notes (with mime type)
- `book` - Container notes
- `render` - Rendered notes
- `file` - File attachments
- `image` - Image attachments

### MIME Types
- `text/html` - HTML content (default for web clips)
- `text/markdown` - Markdown content
- `application/javascript` - JavaScript code
- `text/css` - CSS code
- etc.

### Attribute System

**Label** (name-value pair):
```json
{
  "type": "label",
  "name": "pageUrl",
  "value": "https://example.com",
  "isInheritable": false
}
```

**Relation** (name-noteId pair):
```json
{
  "type": "relation",
  "name": "template",
  "value": "targetNoteId",
  "isInheritable": false
}
```

### Standard Web Clipper Labels

```typescript
const standardLabels = [
  { name: 'pageUrl', value: url },
  { name: 'clipType', value: 'selection' | 'page' | 'screenshot' | 'link' },
  { name: 'clipDate', value: new Date().toISOString() },
  { name: 'iconClass', value: 'bx bx-globe' },
  { name: 'publishedDate', value: extractedDate },
  { name: 'modifiedDate', value: extractedDate },
  { name: 'author', value: extractedAuthor }
];
```

## Note Hierarchy Patterns

### Parent-Child Relationship
```typescript
// 1. Create parent note
const parent = await createNote({
  parentNoteId: 'root',
  title: 'Article Title',
  content: htmlContent
});

// 2. Create child note
const child = await createNote({
  parentNoteId: parent.note.noteId,
  title: 'Article Title (Markdown)',
  content: markdownContent,
  type: 'code',
  mime: 'text/markdown'
});
```

### Duplicate Detection
```typescript
// Search for existing note with same URL
const searchQuery = `#pageUrl="${url}"`;
const existing = await searchNotes(searchQuery);

if (existing.results.length > 0) {
  // Options:
  // 1. Create new note anyway (forceNew)
  // 2. Append to existing note
  // 3. Ask user via dialog
}
```

### Append to Existing Note
```typescript
// Get current content
const currentContent = await getNoteContent(existingNoteId);

// Append new content with separator
const updatedContent = `
  ${currentContent}
  <hr>
  <h2>Updated: ${new Date().toLocaleDateString()}</h2>
  ${newContent}
`;

await updateNoteContent(existingNoteId, updatedContent);
```

## Integration Patterns

### Connection Testing
```typescript
async function testTriliumConnection() {
  const tests = [];
  
  // Test desktop
  tests.push(
    fetch('http://localhost:37840/etapi/app-info')
      .then(r => ({ type: 'desktop', success: r.ok }))
      .catch(() => ({ type: 'desktop', success: false }))
  );
  
  // Test server (if configured)
  if (serverUrl && authToken) {
    tests.push(
      fetch(`${serverUrl}/etapi/app-info`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
      })
        .then(r => ({ type: 'server', success: r.ok }))
        .catch(() => ({ type: 'server', success: false }))
    );
  }
  
  const results = await Promise.all(tests);
  return results;
}
```

### Smart Connection Selection
```typescript
async function getActiveConnection() {
  const [desktop, server] = await Promise.race([
    testDesktop(),
    testServer()
  ]);
  
  // Prefer desktop (lower latency, no auth needed)
  if (desktop.success) return desktop;
  if (server.success) return server;
  
  throw new Error('No Trilium connection available');
}
```

### Robust Note Creation
```typescript
async function createNoteWithRetry(noteData, maxRetries = 3) {
  let lastError;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      const connection = await getActiveConnection();
      return await createNote(connection, noteData);
    } catch (error) {
      lastError = error;
      await sleep(1000 * (i + 1)); // Exponential backoff
    }
  }
  
  throw lastError;
}
```

## Content Format Strategies

### HTML Format (Human-Readable)
```typescript
{
  type: 'text',
  mime: 'text/html',
  content: processedHtmlContent,
  attributes: [
    { type: 'label', name: 'contentFormat', value: 'html' }
  ]
}
```

### Markdown Format (AI-Friendly)
```typescript
{
  type: 'code',
  mime: 'text/markdown',
  content: convertToMarkdown(htmlContent),
  attributes: [
    { type: 'label', name: 'contentFormat', value: 'markdown' }
  ]
}
```

### Both Formats (Maximum Flexibility)
```typescript
// 1. Create HTML parent
const parent = await createNote({
  type: 'text',
  mime: 'text/html',
  content: htmlContent
});

// 2. Create markdown child
await createNote({
  parentNoteId: parent.note.noteId,
  type: 'code',
  mime: 'text/markdown',
  content: markdownContent,
  title: `${parent.title} (Markdown)`,
  attributes: [
    { type: 'label', name: 'markdownVersion', value: 'true' }
  ]
});
```

## Image Handling

### Embedded Images Pattern
```typescript
// 1. Download image as base64
const imageData = await fetch(imageUrl)
  .then(r => r.blob())
  .then(blob => convertToBase64(blob));

// 2. Create image note
const imageNote = await createNote({
  parentNoteId: parentNoteId,
  title: 'image.png',
  type: 'image',
  mime: 'image/png',
  content: imageData // base64 string
});

// 3. Reference in HTML content
const htmlWithImage = content.replace(
  imageUrl,
  `api/images/${imageNote.note.noteId}/image.png`
);
```

### Image Processing Strategy
```typescript
// For CORS-restricted images
1. Try direct fetch from content script (same origin)
2. If CORS error, download via background script
3. Convert to base64
4. Create as Trilium image note
5. Update references in HTML
```

## Error Handling

### Connection Errors
```typescript
try {
  await createNote(noteData);
} catch (error) {
  if (error.message.includes('ECONNREFUSED')) {
    return {
      success: false,
      error: 'Trilium is not running. Please start Trilium Desktop or check server URL.'
    };
  }
  
  if (error.message.includes('401')) {
    return {
      success: false,
      error: 'Invalid authentication token. Please check your ETAPI token.'
    };
  }
  
  throw error;
}
```

### Rate Limiting
```typescript
// Trilium has no hard rate limits, but be respectful
const BATCH_DELAY = 100; // ms between requests

async function createMultipleNotes(notesData) {
  const results = [];
  
  for (const noteData of notesData) {
    results.push(await createNote(noteData));
    await sleep(BATCH_DELAY);
  }
  
  return results;
}
```

## Performance Optimization

### Batch Operations
```typescript
// Instead of: create note, then create 5 child notes sequentially
// Do: create all in parallel after parent exists

const parent = await createNote(parentData);

const children = await Promise.all([
  createNote({ ...child1Data, parentNoteId: parent.note.noteId }),
  createNote({ ...child2Data, parentNoteId: parent.note.noteId }),
  createNote({ ...child3Data, parentNoteId: parent.note.noteId })
]);
```

### Content Size Limits
```typescript
// Trilium can handle large notes, but be reasonable
const MAX_CONTENT_SIZE = 10 * 1024 * 1024; // 10MB

if (content.length > MAX_CONTENT_SIZE) {
  // Split into multiple notes or truncate
  content = content.substring(0, MAX_CONTENT_SIZE);
  attributes.push({
    type: 'label',
    name: 'contentTruncated',
    value: 'true'
  });
}
```

## Testing Checklist

### Connection Tests
- [ ] Desktop client detection (port 37840)
- [ ] Server connection with valid token
- [ ] Server connection with invalid token
- [ ] Fallback when both unavailable
- [ ] Timeout handling (5 second max)

### Note Creation Tests
- [ ] Create simple text note
- [ ] Create note with attributes
- [ ] Create parent-child hierarchy
- [ ] Handle duplicate URLs
- [ ] Create with images
- [ ] Create markdown notes
- [ ] Append to existing note

### Error Scenarios
- [ ] Trilium not running
- [ ] Invalid server URL
- [ ] Invalid auth token
- [ ] Network timeout
- [ ] Invalid note structure
- [ ] Parent note doesn't exist

## Reference Files
- **Trilium Integration**: `src/shared/trilium-server.ts`
- **Note Creation**: Background script handlers
- **API Patterns**: Existing createNote, appendToNote functions
- **Connection Testing**: `testConnection()` implementation

## Common Issues and Solutions

### Issue: "Connection refused"
**Cause**: Trilium not running or wrong port
**Solution**: Check desktop running on 37840, server URL correct

### Issue: "401 Unauthorized"
**Cause**: Missing or invalid ETAPI token
**Solution**: Generate new token in Trilium settings

### Issue: "Note creation succeeds but no noteId returned"
**Cause**: Wrong response parsing
**Solution**: Check `response.note.noteId` structure

### Issue: "Images don't display in Trilium"
**Cause**: External image URLs not downloaded
**Solution**: Download and embed as image notes

### Issue: "Duplicate notes created"
**Cause**: Not checking for existing notes
**Solution**: Implement pageUrl search before creation

## Best Practices Summary

1. **Always** test both desktop and server connections
2. **Always** include pageUrl label for duplicate detection
3. **Prefer** desktop connection (lower latency)
4. **Handle** connection failures gracefully
5. **Use** appropriate note types and MIME types
6. **Implement** retry logic for transient failures
7. **Download** and embed external images
8. **Validate** note structure before sending
9. **Log** API requests for debugging
10. **Respect** Trilium's local-first philosophy

## When to Consult This Agent

- Trilium API integration questions
- Note creation and hierarchy patterns
- Connection strategy decisions
- Attribute system usage
- Duplicate detection logic
- Image embedding patterns
- Content format choices
- Error handling for API calls
- Performance optimization
- Desktop vs server connection issues
