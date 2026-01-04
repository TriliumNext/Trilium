---
name: performance
description: Analyze and optimize extension performance
argument-hint: Describe the performance issue or area to optimize
agent: agent
tools:
  - codebase
  - editFiles
  - problems
  - runCommands
  - search
  - usages
---

# Performance Optimization Prompt

You are analyzing and optimizing **performance** in the Trilium Web Clipper MV3 extension. Focus on service worker efficiency, content script speed, and resource usage.

## Performance Areas

### 1. Service Worker Performance

**Startup Time**:
- Minimize imports at top level
- Lazy-load modules when possible
- Avoid heavy computation during initialization

```typescript
// ❌ Slow: Heavy import at startup
import { heavyLibrary } from 'heavy-library';

// ✅ Fast: Dynamic import when needed
async function processContent() {
  const { heavyLibrary } = await import('heavy-library');
  return heavyLibrary.process(content);
}
```

**Event Handler Efficiency**:
```typescript
// ❌ Slow: Processing in listener
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Heavy processing here blocks other messages
  const result = heavyProcess(msg.data);
  sendResponse(result);
  return true;
});

// ✅ Fast: Async processing
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  processAsync(msg.data).then(sendResponse);
  return true;
});
```

### 2. Storage Performance

**Batch Operations**:
```typescript
// ❌ Slow: Multiple storage calls
await chrome.storage.local.set({ key1: value1 });
await chrome.storage.local.set({ key2: value2 });
await chrome.storage.local.set({ key3: value3 });

// ✅ Fast: Single batch call
await chrome.storage.local.set({
  key1: value1,
  key2: value2,
  key3: value3
});
```

**Minimize Reads**:
```typescript
// ❌ Slow: Read on every call
async function getSetting(key: string) {
  const data = await chrome.storage.local.get([key]);
  return data[key];
}

// ✅ Fast: Cache and batch
let settingsCache: Settings | null = null;

async function getSettings(): Promise<Settings> {
  if (!settingsCache) {
    const { settings } = await chrome.storage.local.get(['settings']);
    settingsCache = settings;
  }
  return settingsCache;
}

// Invalidate cache on changes
chrome.storage.onChanged.addListener(() => {
  settingsCache = null;
});
```

### 3. Content Script Performance

**Minimize DOM Operations**:
```typescript
// ❌ Slow: Multiple DOM queries
const title = document.querySelector('h1').textContent;
const content = document.querySelector('article').innerHTML;
const images = document.querySelectorAll('img');

// ✅ Fast: Single query scope
const article = document.querySelector('article');
if (article) {
  const title = article.querySelector('h1')?.textContent;
  const content = article.innerHTML;
  const images = article.querySelectorAll('img');
}
```

**Debounce Events**:
```typescript
// ✅ Debounce selection changes
let selectionTimeout: number;
document.addEventListener('selectionchange', () => {
  clearTimeout(selectionTimeout);
  selectionTimeout = setTimeout(() => {
    const selection = window.getSelection();
    // Process selection
  }, 150);
});
```

### 4. Build Output Size

**Analyze Bundle**:
```bash
# Check dist folder size
Get-ChildItem -Path dist -Recurse | Measure-Object -Property Length -Sum
```

**Minimize Dependencies**:
- Use tree-shaking friendly imports
- Consider lighter alternatives
- Remove unused dependencies

```typescript
// ❌ Import everything
import _ from 'lodash';
_.debounce(fn, 100);

// ✅ Import only what's needed
import debounce from 'lodash/debounce';
debounce(fn, 100);
```

### 5. Memory Management

**Cleanup Listeners**:
```typescript
// ✅ Remove listeners when done
const handler = (msg) => { /* ... */ };
chrome.runtime.onMessage.addListener(handler);

// Later, when no longer needed
chrome.runtime.onMessage.removeListener(handler);
```

**Avoid Memory Leaks**:
```typescript
// ❌ Leak: Growing array
const logs: string[] = [];
function log(msg: string) {
  logs.push(msg); // Never cleared
}

// ✅ Fixed: Bounded array
const MAX_LOGS = 100;
const logs: string[] = [];
function log(msg: string) {
  logs.push(msg);
  if (logs.length > MAX_LOGS) {
    logs.shift();
  }
}
```

## Performance Measurement

### Chrome DevTools

1. **Service Worker**: `chrome://extensions/` → Inspect service worker
2. **Performance Tab**: Record and analyze timeline
3. **Memory Tab**: Take heap snapshots
4. **Network Tab**: Monitor API calls

### Custom Timing

```typescript
// Measure function duration
async function withTiming<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    const duration = performance.now() - start;
    console.log(`[Perf] ${name}: ${duration.toFixed(2)}ms`);
  }
}

// Usage
const result = await withTiming('saveToTrilium', () => saveNote(content));
```

## Optimization Checklist

- [ ] Service worker starts quickly
- [ ] Storage operations batched
- [ ] Content script minimal
- [ ] No memory leaks
- [ ] Build size reasonable
- [ ] No blocking operations
- [ ] Efficient message passing
