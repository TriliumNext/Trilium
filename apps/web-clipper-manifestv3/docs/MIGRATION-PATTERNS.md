# MV2 to MV3 Migration Patterns

Quick reference for common migration scenarios when implementing features from the legacy extension.

---

## Pattern 1: Background Page → Service Worker

### MV2 (Don't Use)
```javascript
// Persistent background page with global state
let cachedData = {};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  cachedData[msg.id] = msg.data;
  sendResponse({success: true});
});
```

### MV3 (Use This)
```typescript
// Stateless service worker with chrome.storage
import { Logger } from '@/shared/utils';
const logger = Logger.create('BackgroundHandler', 'background');

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      // Store in chrome.storage, not memory
      await chrome.storage.local.set({ [msg.id]: msg.data });
      logger.info('Data stored', { id: msg.id });
      sendResponse({ success: true });
    } catch (error) {
      logger.error('Storage failed', error);
      sendResponse({ success: false, error: error.message });
    }
  })();
  return true; // Required for async sendResponse
});
```

**Key Changes:**
- No global state (service worker can terminate)
- Use `chrome.storage` for persistence
- Always return `true` for async handlers
- Centralized logging for debugging

---

## Pattern 2: Content Script DOM Manipulation

### MV2 Pattern
```javascript
// Simple DOM access
const content = document.body.innerHTML;
```

### MV3 Pattern (Same, but with error handling)
```typescript
import { Logger } from '@/shared/utils';
const logger = Logger.create('ContentExtractor', 'content');

function extractContent(): string {
  try {
    if (!document.body) {
      logger.warn('Document body not available');
      return '';
    }
    
    const content = document.body.innerHTML;
    logger.debug('Content extracted', { length: content.length });
    return content;
  } catch (error) {
    logger.error('Content extraction failed', error);
    return '';
  }
}
```

**Key Changes:**
- Add null checks for DOM elements
- Use centralized logging
- Handle errors gracefully

---

## Pattern 3: Screenshot Capture

### MV2 Pattern
```javascript
chrome.tabs.captureVisibleTab(null, {format: 'png'}, (dataUrl) => {
  // Crop using canvas
  const canvas = document.createElement('canvas');
  // ... cropping logic
});
```

### MV3 Pattern
```typescript
import { Logger } from '@/shared/utils';
const logger = Logger.create('ScreenshotCapture', 'background');

async function captureAndCrop(
  tabId: number, 
  cropRect: { x: number; y: number; width: number; height: number }
): Promise<string> {
  try {
    // Step 1: Capture full tab
    const dataUrl = await chrome.tabs.captureVisibleTab(null, { 
      format: 'png' 
    });
    logger.info('Screenshot captured', { tabId });
    
    // Step 2: Crop using OffscreenCanvas (MV3 service worker compatible)
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);
    
    const offscreen = new OffscreenCanvas(cropRect.width, cropRect.height);
    const ctx = offscreen.getContext('2d');
    
    if (!ctx) {
      throw new Error('Could not get canvas context');
    }
    
    ctx.drawImage(
      bitmap,
      cropRect.x, cropRect.y, cropRect.width, cropRect.height,
      0, 0, cropRect.width, cropRect.height
    );
    
    const croppedBlob = await offscreen.convertToBlob({ type: 'image/png' });
    const reader = new FileReader();
    
    return new Promise((resolve, reject) => {
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(croppedBlob);
    });
  } catch (error) {
    logger.error('Screenshot crop failed', error);
    throw error;
  }
}
```

**Key Changes:**
- Use `OffscreenCanvas` (available in service workers)
- No DOM canvas manipulation in background
- Full async/await pattern
- Comprehensive error handling

---

## Pattern 4: Image Processing

### MV2 Pattern
```javascript
// Download image and convert to base64
function processImage(imgSrc) {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', imgSrc);
    xhr.responseType = 'blob';
    xhr.onload = () => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.readAsDataURL(xhr.response);
    };
    xhr.send();
  });
}
```

### MV3 Pattern
```typescript
import { Logger } from '@/shared/utils';
const logger = Logger.create('ImageProcessor', 'background');

async function downloadAndEncodeImage(
  imgSrc: string, 
  baseUrl: string
): Promise<string> {
  try {
    // Resolve relative URLs
    const absoluteUrl = new URL(imgSrc, baseUrl).href;
    logger.debug('Downloading image', { url: absoluteUrl });
    
    // Use fetch API (modern, async)
    const response = await fetch(absoluteUrl);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const blob = await response.blob();
    
    // Convert to base64
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('FileReader failed'));
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    logger.warn('Image download failed', { url: imgSrc, error });
    // Return original URL as fallback
    return imgSrc;
  }
}
```

**Key Changes:**
- Use `fetch()` instead of `XMLHttpRequest`
- Handle CORS errors gracefully
- Return original URL on failure (don't break the note)
- Resolve relative URLs properly

---

## Pattern 5: Context Menu Creation

### MV2 Pattern
```javascript
chrome.contextMenus.create({
  id: "save-selection",
  title: "Save to Trilium",
  contexts: ["selection"]
});
```

### MV3 Pattern (Same API, better structure)
```typescript
import { Logger } from '@/shared/utils';
const logger = Logger.create('ContextMenu', 'background');

interface MenuConfig {
  id: string;
  title: string;
  contexts: chrome.contextMenus.ContextType[];
}

const MENU_ITEMS: MenuConfig[] = [
  { id: 'save-selection', title: 'Save Selection to Trilium', contexts: ['selection'] },
  { id: 'save-page', title: 'Save Page to Trilium', contexts: ['page'] },
  { id: 'save-link', title: 'Save Link to Trilium', contexts: ['link'] },
  { id: 'save-image', title: 'Save Image to Trilium', contexts: ['image'] },
  { id: 'save-screenshot', title: 'Save Screenshot to Trilium', contexts: ['page'] }
];

async function setupContextMenus(): Promise<void> {
  try {
    // Remove existing menus
    await chrome.contextMenus.removeAll();
    
    // Create all menu items
    for (const item of MENU_ITEMS) {
      await chrome.contextMenus.create(item);
      logger.debug('Context menu created', { id: item.id });
    }
    
    logger.info('Context menus initialized', { count: MENU_ITEMS.length });
  } catch (error) {
    logger.error('Context menu setup failed', error);
  }
}

// Call during service worker initialization
chrome.runtime.onInstalled.addListener(() => {
  setupContextMenus();
});
```

**Key Changes:**
- Centralized menu configuration
- Clear typing with interfaces
- Proper error handling
- Logging for debugging

---

## Pattern 6: Sending Messages from Content to Background

### MV2 Pattern
```javascript
chrome.runtime.sendMessage({type: 'SAVE', data: content}, (response) => {
  console.log('Saved:', response);
});
```

### MV3 Pattern
```typescript
import { Logger } from '@/shared/utils';
const logger = Logger.create('ContentScript', 'content');

interface SaveMessage {
  type: 'SAVE_SELECTION' | 'SAVE_PAGE' | 'SAVE_LINK';
  data: {
    content: string;
    metadata: {
      title: string;
      url: string;
    };
  };
}

interface SaveResponse {
  success: boolean;
  noteId?: string;
  error?: string;
}

async function sendToBackground(message: SaveMessage): Promise<SaveResponse> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: SaveResponse) => {
      if (chrome.runtime.lastError) {
        logger.error('Message send failed', chrome.runtime.lastError);
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      
      if (!response.success) {
        logger.warn('Background operation failed', { error: response.error });
        reject(new Error(response.error));
        return;
      }
      
      logger.info('Message handled successfully', { noteId: response.noteId });
      resolve(response);
    });
  });
}

// Usage
try {
  const result = await sendToBackground({
    type: 'SAVE_SELECTION',
    data: {
      content: selectedHtml,
      metadata: {
        title: document.title,
        url: window.location.href
      }
    }
  });
  
  showToast(`Saved to Trilium: ${result.noteId}`);
} catch (error) {
  logger.error('Save failed', error);
  showToast('Failed to save to Trilium', 'error');
}
```

**Key Changes:**
- Strong typing for messages and responses
- Promise wrapper for callback API
- Always check `chrome.runtime.lastError`
- Handle errors at both send and response levels

---

## Pattern 7: Storage Operations

### MV2 Pattern
```javascript
// Mix of localStorage and chrome.storage
localStorage.setItem('setting', value);
chrome.storage.local.get(['data'], (result) => {
  console.log(result.data);
});
```

### MV3 Pattern
```typescript
import { Logger } from '@/shared/utils';
const logger = Logger.create('StorageManager', 'background');

// NEVER use localStorage in service workers - it doesn't exist

interface StorageData {
  settings: {
    triliumUrl: string;
    authToken: string;
    saveFormat: 'html' | 'markdown' | 'both';
  };
  cache: {
    lastSync: number;
    noteIds: string[];
  };
}

async function loadSettings(): Promise<StorageData['settings']> {
  try {
    const { settings } = await chrome.storage.local.get(['settings']);
    logger.debug('Settings loaded', { hasToken: !!settings?.authToken });
    return settings || getDefaultSettings();
  } catch (error) {
    logger.error('Settings load failed', error);
    return getDefaultSettings();
  }
}

async function saveSettings(settings: Partial<StorageData['settings']>): Promise<void> {
  try {
    const current = await loadSettings();
    const updated = { ...current, ...settings };
    await chrome.storage.local.set({ settings: updated });
    logger.info('Settings saved', { keys: Object.keys(settings) });
  } catch (error) {
    logger.error('Settings save failed', error);
    throw error;
  }
}

function getDefaultSettings(): StorageData['settings'] {
  return {
    triliumUrl: '',
    authToken: '',
    saveFormat: 'html'
  };
}
```

**Key Changes:**
- NEVER use `localStorage` (not available in service workers)
- Use `chrome.storage.local` for all data
- Use `chrome.storage.sync` for user preferences (sync across devices)
- Full TypeScript typing for stored data
- Default values for missing data

---

## Pattern 8: Trilium API Communication

### MV2 Pattern
```javascript
function saveToTrilium(content, metadata) {
  const xhr = new XMLHttpRequest();
  xhr.open('POST', triliumUrl + '/api/notes');
  xhr.setRequestHeader('Authorization', token);
  xhr.send(JSON.stringify({content, metadata}));
}
```

### MV3 Pattern
```typescript
import { Logger } from '@/shared/utils';
const logger = Logger.create('TriliumAPI', 'background');

interface TriliumNote {
  title: string;
  content: string;
  type: 'text';
  mime: 'text/html' | 'text/markdown';
  parentNoteId?: string;
}

interface TriliumResponse {
  note: {
    noteId: string;
    title: string;
  };
}

async function createNote(
  note: TriliumNote,
  triliumUrl: string,
  authToken: string
): Promise<string> {
  try {
    const url = `${triliumUrl}/api/create-note`;
    
    logger.debug('Creating note in Trilium', { 
      title: note.title, 
      contentLength: note.content.length 
    });
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': authToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(note)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }
    
    const data: TriliumResponse = await response.json();
    logger.info('Note created successfully', { noteId: data.note.noteId });
    
    return data.note.noteId;
  } catch (error) {
    logger.error('Note creation failed', error);
    throw error;
  }
}
```

**Key Changes:**
- Use `fetch()` API (modern, promise-based)
- Full TypeScript typing for requests/responses
- Comprehensive error handling
- Detailed logging for debugging

---

## Quick Reference: When to Use Each Pattern

| Task | Pattern | Files Typically Modified |
|------|---------|-------------------------|
| Add capture feature | Pattern 1, 6, 8 | `background/index.ts`, `content/index.ts` |
| Process images | Pattern 4 | `background/index.ts` |
| Add context menu | Pattern 5 | `background/index.ts` |
| Screenshot with crop | Pattern 3 | `background/index.ts`, possibly `content/screenshot.ts` |
| Settings management | Pattern 7 | `options/index.ts`, `background/index.ts` |
| Trilium communication | Pattern 8 | `background/index.ts` |

---

## Common Gotchas

1. **Service Worker Termination**
   - Don't store state in global variables
   - Use `chrome.storage` or `chrome.alarms`

2. **Async Message Handlers**
   - Always return `true` in listener
   - Always check `chrome.runtime.lastError`

3. **Canvas in Service Workers**
   - Use `OffscreenCanvas`, not regular `<canvas>`
   - No DOM access in background scripts

4. **CORS Issues**
   - Handle fetch failures gracefully
   - Provide fallbacks for external resources

5. **Type Safety**
   - Define interfaces for all messages
   - Type all chrome.storage data structures

---

**Usage**: When implementing a feature, find the relevant pattern above and adapt it. Don't copy MV2 code directly—use these proven MV3 patterns instead.