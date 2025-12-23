---
name: migrate-mv2
description: Migrate specific code or patterns from legacy MV2 to MV3
argument-hint: Describe the MV2 code or pattern to migrate
agent: agent
tools:
  - codebase
  - editFiles
  - fetch
  - search
  - usages
---

# MV2 to MV3 Migration Prompt

You are migrating code from the legacy **Manifest V2** Web Clipper to the new **Manifest V3** version. Reference the original code in `reference/` and adapt it to MV3 requirements.

## Key Migration Changes

### 1. Background Page → Service Worker

**MV2 (Persistent Background)**:
```javascript
// background.js - Always running
let state = {};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  state[msg.key] = msg.value;
  sendResponse({ success: true });
});
```

**MV3 (Service Worker)**:
```typescript
// serviceWorker.ts - Event-driven, terminates when idle
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    // Load state from storage
    const { state } = await chrome.storage.local.get(['state']);
    const newState = { ...state, [msg.key]: msg.value };
    
    // Persist updated state
    await chrome.storage.local.set({ state: newState });
    sendResponse({ success: true });
  })();
  return true; // Required for async
});
```

### 2. Content Script Injection

**MV2**:
```javascript
// manifest.json
{
  "content_scripts": [{
    "matches": ["<all_urls>"],
    "js": ["content.js"]
  }]
}
```

**MV3 (Prefer Programmatic)**:
```typescript
// Programmatic injection for better control
async function ensureContentScript(tabId: number): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'PING' });
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js']
    });
  }
}
```

### 3. Timers and Alarms

**MV2**:
```javascript
// setTimeout works in persistent background
setTimeout(() => {
  checkForUpdates();
}, 60000);
```

**MV3**:
```typescript
// Use chrome.alarms - survives service worker termination
chrome.alarms.create('checkUpdates', { periodInMinutes: 1 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'checkUpdates') {
    checkForUpdates();
  }
});
```

### 4. Web Accessible Resources

**MV2**:
```json
{
  "web_accessible_resources": ["images/*", "styles/*"]
}
```

**MV3**:
```json
{
  "web_accessible_resources": [{
    "resources": ["images/*", "styles/*"],
    "matches": ["<all_urls>"]
  }]
}
```

### 5. executeScript Changes

**MV2**:
```javascript
chrome.tabs.executeScript(tabId, {
  code: 'document.body.innerHTML'
}, (results) => {
  // ...
});
```

**MV3**:
```typescript
const results = await chrome.scripting.executeScript({
  target: { tabId },
  func: () => document.body.innerHTML
});
const content = results[0]?.result;
```

### 6. Permissions

**MV2**:
```json
{
  "permissions": [
    "tabs",
    "activeTab",
    "<all_urls>"
  ]
}
```

**MV3**:
```json
{
  "permissions": [
    "tabs",
    "activeTab",
    "scripting",
    "storage"
  ],
  "host_permissions": [
    "<all_urls>"
  ]
}
```

## Migration Patterns

### State Migration Pattern

```typescript
// MV2 state in memory → MV3 state in storage

interface ExtensionState {
  lastClip: ClipData | null;
  connectionStatus: 'connected' | 'disconnected';
  errorCount: number;
}

// Initialize state
chrome.runtime.onInstalled.addListener(async () => {
  const defaultState: ExtensionState = {
    lastClip: null,
    connectionStatus: 'disconnected',
    errorCount: 0
  };
  await chrome.storage.local.set({ state: defaultState });
});

// Read state
async function getState(): Promise<ExtensionState> {
  const { state } = await chrome.storage.local.get(['state']);
  return state;
}

// Update state
async function updateState(updates: Partial<ExtensionState>): Promise<void> {
  const current = await getState();
  await chrome.storage.local.set({ state: { ...current, ...updates } });
}
```

### DOM Operations in MV3

```typescript
// Cannot use DOM in service worker - use offscreen document

// Create offscreen document for DOM operations
async function createOffscreen(): Promise<void> {
  if (await chrome.offscreen.hasDocument()) return;
  
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: [chrome.offscreen.Reason.DOM_PARSER],
    justification: 'Parse HTML content'
  });
}

// Send work to offscreen document
async function parseHtml(html: string): Promise<ParsedContent> {
  await createOffscreen();
  return chrome.runtime.sendMessage({
    target: 'offscreen',
    type: 'PARSE_HTML',
    html
  });
}
```

## Reference Locations

- **Legacy MV2 Code**: `reference/` directory
- **MV3 Implementation**: `src/` directory

## Migration Checklist

When migrating a feature:
- [ ] Identify MV2 code in `reference/`
- [ ] Understand the functionality
- [ ] Identify MV3-incompatible patterns
- [ ] Implement with MV3 patterns
- [ ] Add TypeScript types
- [ ] Handle service worker lifecycle
- [ ] Test the migrated feature

## Reference Agents

- [Chrome Extension Architect](../agents/chrome-extension-architect.md) - MV3 patterns
- [TriliumNext Repo Expert](../agents/triliumnext-repo-expert.md) - Repository context
