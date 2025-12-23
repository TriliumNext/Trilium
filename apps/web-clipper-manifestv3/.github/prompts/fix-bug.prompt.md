---
name: fix-bug
description: Debug and fix issues in the Web Clipper extension
argument-hint: Describe the bug or paste the error message
agent: agent
tools:
  - changes
  - codebase
  - editFiles
  - problems
  - runCommands
  - search
  - terminalLastCommand
  - terminalSelection
  - testFailure
  - usages
---

# Fix Bug Prompt

You are debugging and fixing a **bug** in the Trilium Web Clipper MV3 extension. Follow this systematic approach to identify, understand, and resolve issues.

## Bug Investigation Workflow

### 1. Reproduce & Understand

First, gather information:
- What is the expected behavior?
- What is the actual behavior?
- What are the steps to reproduce?
- Does it happen consistently or intermittently?
- What browser version? Extension version?

### 2. Check Common MV3 Issues

#### Service Worker Problems
```typescript
// Issue: State lost between events
// ❌ Wrong - global state
let cache = {};

// ✅ Fix - use storage
const cache = await chrome.storage.local.get(['cache']);
```

```typescript
// Issue: Async response not working
// ❌ Wrong - missing return true
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  doAsyncWork().then(sendResponse);
});

// ✅ Fix - return true for async
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  doAsyncWork().then(sendResponse);
  return true; // CRITICAL
});
```

#### Content Script Issues
```typescript
// Issue: Content script not loaded
// Check if page requires programmatic injection
try {
  await chrome.tabs.sendMessage(tabId, message);
} catch (error) {
  // Inject first, then retry
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content.js']
  });
  await chrome.tabs.sendMessage(tabId, message);
}
```

### 3. Debugging Tools

#### Chrome DevTools
- **Service Worker**: `chrome://extensions/` → Inspect service worker
- **Content Script**: Page DevTools → Sources → Content scripts
- **Popup**: Right-click popup → Inspect
- **Storage**: DevTools → Application → Storage

#### Logging Strategy
```typescript
// Use structured logging
const log = (component: string, action: string, data?: unknown) => {
  console.log(`[${component}] ${action}`, data ?? '');
};

log('ServiceWorker', 'Message received', { type: message.type });
```

### 4. Common Bug Categories

#### Type Errors
- Run `npm run type-check` to find type issues
- Check for `undefined` access
- Verify message type discriminators

#### Runtime Errors
- Check console for stack traces
- Verify async/await usage
- Check for null/undefined

#### Logic Errors
- Trace data flow through components
- Verify message handling routes
- Check conditional logic

#### UI/Display Issues
- Inspect CSS in DevTools
- Check for style conflicts
- Verify state updates trigger re-renders

### 5. Fix Implementation

When implementing the fix:
```typescript
// Document the fix
/**
 * Fix for: [Brief description of bug]
 * Root cause: [What was wrong]
 * Solution: [How it's fixed]
 */
```

## Reference Agents

- [Chrome Extension Architect](../agents/chrome-extension-architect.md) - MV3-specific issues
- [TypeScript Quality Engineer](../agents/typescript-quality-engineer.md) - Type errors
- [Security & Privacy Specialist](../agents/security-privacy-specialist.md) - Security-related bugs

## Bug Fix Checklist

- [ ] Root cause identified
- [ ] Fix addresses root cause (not just symptoms)
- [ ] No regressions introduced
- [ ] `npm run type-check` passes
- [ ] `npm run lint` passes
- [ ] `npm run build` succeeds
- [ ] Bug verified fixed manually
- [ ] Edge cases considered

## Debugging Commands

```bash
npm run type-check   # Find type errors
npm run lint         # Find code issues
npm run build        # Build and check for errors
npm run dev          # Watch mode for testing
```

## Common Error Patterns

| Error | Likely Cause | Solution |
|-------|-------------|----------|
| "Receiving end does not exist" | Content script not loaded | Inject script first |
| "Service worker inactive" | Worker terminated | Persist state to storage |
| "Cannot read property of undefined" | Missing null check | Add optional chaining |
| "Extension context invalidated" | Extension reloaded | Handle gracefully |
