# Development Guide - Trilium Web Clipper MV3

Practical guide for common development tasks and workflows.

---

## Daily Development Workflow

### Starting Your Session

```bash
# Navigate to project
cd apps/web-clipper-manifestv3

# Start development build (keep this running)
npm run dev

# In another terminal (optional)
npm run type-check --watch
```

### Loading Extension in Chrome

1. Open `chrome://extensions/`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select the `dist/` folder
5. Note the extension ID for debugging

### Development Loop

```
1. Make code changes in src/
   ↓
2. Build auto-rebuilds (watch mode)
   ↓
3. Reload extension in Chrome
   - Click reload icon on extension card
   - Or Ctrl+R on chrome://extensions/
   ↓
4. Test functionality
   ↓
5. Check for errors
   - Popup: Right-click → Inspect
   - Background: Extensions page → Service Worker → Inspect
   - Content: Page F12 → Console
   ↓
6. Check logs via extension Logs page
   ↓
7. Repeat
```

---

## Common Development Tasks

### Task 1: Add a New Capture Feature

**Example**: Implementing "Save Tabs" (bulk save all open tabs)

**Steps**:

1. **Reference the MV2 implementation**
   ```bash
   # Open and review
   code apps/web-clipper/background.js:302-326
   ```

2. **Plan the implementation**
   - What data do we need? (tab URLs, titles)
   - Where does the code go? (background service worker)
   - What messages are needed? (none - initiated by context menu)
   - What UI changes? (add context menu item)

3. **Ask Copilot for guidance** (Chat Pane - free)
   ```
   Looking at the "save tabs" feature in apps/web-clipper/background.js:302-326,
   what's the best approach for MV3? I need to:
   - Get all open tabs
   - Create a single note with links to all tabs
   - Handle errors gracefully
   
   See docs/MIGRATION-PATTERNS.md for our coding patterns.
   ```

4. **Implement using Agent Mode** (uses task)
   ```
   Implement "save tabs" feature from FEATURE-PARITY-CHECKLIST.md.
   
   Legacy reference: apps/web-clipper/background.js:302-326
   
   Files to modify:
   - src/background/index.ts (add context menu + handler)
   - manifest.json (verify permissions)
   
   Use Pattern 5 (context menu) and Pattern 8 (Trilium API) from 
   docs/MIGRATION-PATTERNS.md.
   
   Update FEATURE-PARITY-CHECKLIST.md when done.
   ```

5. **Fix TypeScript errors** (Inline Chat - free)
   - Press Ctrl+I on error
   - Copilot suggests fix
   - Accept or modify

6. **Test manually**
   - Open multiple tabs
   - Right-click → "Save Tabs to Trilium"
   - Check Trilium for new note
   - Verify all links present

7. **Update documentation**
   - Mark feature complete in `FEATURE-PARITY-CHECKLIST.md`
   - Commit changes

### Task 2: Fix a Bug

**Example**: Screenshot not being cropped

**Steps**:

1. **Reproduce the bug**
   - Take screenshot with selection
   - Save to Trilium
   - Check if image is cropped or full-page

2. **Check the logs**
   - Open extension popup → Logs button
   - Filter by "screenshot" or "crop"
   - Look for errors or unexpected values

3. **Locate the code**
   ```bash
   # Search for relevant functions
   rg "captureScreenshot" src/
   rg "cropImage" src/
   ```

4. **Review the legacy implementation**
   ```bash
   code apps/web-clipper/background.js:393-427  # MV2 crop function
   ```

5. **Ask Copilot for analysis** (Chat Pane - free)
   ```
   In src/background/index.ts around line 504-560, we capture screenshots
   but don't apply the crop rectangle. The crop rect is stored in metadata
   but the image is still full-page.
   
   MV2 implementation is in apps/web-clipper/background.js:393-427.
   
   What's the best way to implement cropping in MV3 using OffscreenCanvas?
   ```

6. **Implement the fix** (Agent Mode - uses task)
   ```
   Fix screenshot cropping in src/background/index.ts.
   
   Problem: Crop rectangle stored but not applied to image.
   Reference: apps/web-clipper/background.js:393-427 for logic
   Solution: Use OffscreenCanvas to crop before saving
   
   Use Pattern 3 from docs/MIGRATION-PATTERNS.md.
   
   Update FEATURE-PARITY-CHECKLIST.md when fixed.
   ```

7. **Test thoroughly**
   - Small crop (100x100)
   - Large crop (full page)
   - Edge crops (near borders)
   - Very tall/wide crops

8. **Verify logs show success**
   - Check Logs page for crop dimensions
   - Verify no errors

### Task 3: Add UI Component with Theme Support

**Example**: Adding a "Recent Notes" section to popup

**Steps**:

1. **Plan the UI**
   - Sketch layout on paper
   - Identify needed data (recent note IDs, titles)
   - Plan data flow (background ↔ popup)

2. **Update HTML** (`src/popup/popup.html`)
   ```html
   <div class="recent-notes">
     <h3>Recently Saved</h3>
     <ul id="recent-list"></ul>
   </div>
   ```

3. **Add CSS with theme variables** (`src/popup/popup.css`)
   ```css
   @import url('../shared/theme.css'); /* Critical */
   
   .recent-notes {
     background: var(--color-surface-elevated);
     border: 1px solid var(--color-border);
     padding: 12px;
     border-radius: 8px;
   }
   
   .recent-notes h3 {
     color: var(--color-text-primary);
     margin: 0 0 8px 0;
   }
   
   #recent-list {
     list-style: none;
     padding: 0;
     margin: 0;
   }
   
   #recent-list li {
     color: var(--color-text-secondary);
     padding: 4px 0;
     border-bottom: 1px solid var(--color-border-subtle);
   }
   
   #recent-list li:last-child {
     border-bottom: none;
   }
   
   #recent-list li a {
     color: var(--color-primary);
     text-decoration: none;
   }
   
   #recent-list li a:hover {
     color: var(--color-primary-hover);
   }
   ```

4. **Add TypeScript logic** (`src/popup/index.ts`)
   ```typescript
   import { Logger } from '@/shared/utils';
   import { ThemeManager } from '@/shared/theme';
   
   const logger = Logger.create('RecentNotes', 'popup');
   
   async function loadRecentNotes(): Promise<void> {
     try {
       const { recentNotes } = await chrome.storage.local.get(['recentNotes']);
       const list = document.getElementById('recent-list');
       
       if (!list || !recentNotes || recentNotes.length === 0) {
         list.innerHTML = '<li>No recent notes</li>';
         return;
       }
       
       list.innerHTML = recentNotes
         .slice(0, 5) // Show 5 most recent
         .map(note => `
           <li>
             <a href="${note.url}" target="_blank">
               ${escapeHtml(note.title)}
             </a>
           </li>
         `)
         .join('');
         
       logger.debug('Recent notes loaded', { count: recentNotes.length });
     } catch (error) {
       logger.error('Failed to load recent notes', error);
     }
   }
   
   function escapeHtml(text: string): string {
     const div = document.createElement('div');
     div.textContent = text;
     return div.innerHTML;
   }
   
   // Initialize when popup opens
   document.addEventListener('DOMContentLoaded', async () => {
     await ThemeManager.initialize();
     await loadRecentNotes();
   });
   ```

5. **Store recent notes when saving** (`src/background/index.ts`)
   ```typescript
   async function addToRecentNotes(noteId: string, title: string, url: string): Promise<void> {
     try {
       const { recentNotes = [] } = await chrome.storage.local.get(['recentNotes']);
       
       // Add to front, remove duplicates, limit to 10
       const updated = [
         { noteId, title, url: `${triliumUrl}/#${noteId}`, timestamp: Date.now() },
         ...recentNotes.filter(n => n.noteId !== noteId)
       ].slice(0, 10);
       
       await chrome.storage.local.set({ recentNotes: updated });
       logger.debug('Added to recent notes', { noteId, title });
     } catch (error) {
       logger.error('Failed to update recent notes', error);
     }
   }
   ```

6. **Test theme switching**
   - Open popup
   - Toggle theme (sun/moon icon)
   - Verify colors change immediately
   - Check both light and dark modes

### Task 4: Debug Service Worker Issues

**Problem**: Service worker terminating unexpectedly or not receiving messages

**Debugging Steps**:

1. **Check service worker status**
   ```
   chrome://extensions/
   → Find extension
   → "Service worker" link (should say "active")
   ```

2. **Open service worker console**
   - Click "Service worker" link
   - Console opens in new window
   - Check for errors on load

3. **Test message passing**
   - Add temporary logging in content script:
   ```typescript
   logger.info('Sending message to background');
   chrome.runtime.sendMessage({ type: 'TEST' }, (response) => {
     logger.info('Response received', response);
   });
   ```
   - Check both consoles for logs

4. **Check storage persistence**
   ```typescript
   // In background
   chrome.runtime.onInstalled.addListener(async () => {
     logger.info('Service worker installed');
     const data = await chrome.storage.local.get();
     logger.debug('Stored data', data);
   });
   ```

5. **Monitor service worker lifecycle**
   - Watch "Service worker" status on extensions page
   - Should stay "active" when doing work
   - May say "inactive" when idle (normal)
   - If it says "stopped" or errors, check console

6. **Common fixes**:
   - Ensure message handlers return `true` for async
   - Don't use global variables for state
   - Use `chrome.storage` for persistence
   - Check for syntax errors (TypeScript)

### Task 5: Test in Different Scenarios

**Coverage checklist**:

#### Content Types
- [ ] Simple article (blog post, news)
- [ ] Image-heavy page (gallery, Pinterest)
- [ ] Code documentation (GitHub, Stack Overflow)
- [ ] Social media (Twitter thread, LinkedIn post)
- [ ] Video page (YouTube, Vimeo)
- [ ] Dynamic SPA (React/Vue app)

#### Network Conditions
- [ ] Fast network
- [ ] Slow network (throttle in DevTools)
- [ ] Offline (service worker should handle gracefully)
- [ ] Trilium server down

#### Edge Cases
- [ ] Very long page (20+ screens)
- [ ] Page with 100+ images
- [ ] Page with no title
- [ ] Page with special characters in title
- [ ] Restricted URL (chrome://, about:, file://)
- [ ] Page with large selection (5000+ words)

#### Browser States
- [ ] Fresh install
- [ ] After settings change
- [ ] After theme toggle
- [ ] After browser restart
- [ ] Multiple tabs open simultaneously

---

## Debugging Checklist

When something doesn't work:

### 1. Check Build
```bash
# Any errors during build?
npm run build

# TypeScript errors?
npm run type-check
```

### 2. Check Extension Status
- [ ] Extension loaded in Chrome?
- [ ] Extension enabled?
- [ ] Correct dist/ folder selected?
- [ ] Service worker "active"?

### 3. Check Consoles
- [ ] Service worker console (no errors?)
- [ ] Popup console (if UI issue)
- [ ] Page console (if content script issue)
- [ ] Extension logs page

### 4. Check Permissions
- [ ] Required permissions in manifest.json?
- [ ] Host permissions for Trilium URL?
- [ ] User granted permissions?

### 5. Check Storage
```javascript
// In any context console
chrome.storage.local.get(null, (data) => console.log(data));
chrome.storage.sync.get(null, (data) => console.log(data));
```

### 6. Check Network
- [ ] Trilium server reachable?
- [ ] Auth token valid?
- [ ] CORS headers correct?
- [ ] Network tab in DevTools

---

## Performance Tips

### Keep Service Worker Fast
- Minimize work in message handlers
- Use `chrome.alarms` for scheduled tasks
- Offload heavy processing to content scripts when possible

### Optimize Content Scripts
- Inject only when needed (use `activeTab` permission)
- Remove listeners when done
- Don't poll DOM excessively

### Storage Best Practices
- Use `chrome.storage.local` for large data
- Use `chrome.storage.sync` for small settings only
- Clear old data periodically
- Batch storage operations

---

## Code Quality Checklist

Before committing:

- [ ] `npm run type-check` passes
- [ ] No console errors in any context
- [ ] Centralized logging used throughout
- [ ] Theme system integrated (if UI)
- [ ] Error handling on all async operations
- [ ] No hardcoded colors (use CSS variables)
- [ ] No emojis in code
- [ ] Comments explain "why", not "what"
- [ ] Updated FEATURE-PARITY-CHECKLIST.md
- [ ] Tested manually

---

## Git Workflow

### Commit Messages
```bash
# Feature
git commit -m "feat: add save tabs functionality"

# Bug fix
git commit -m "fix: screenshot cropping now works correctly"

# Docs
git commit -m "docs: update feature checklist"

# Refactor
git commit -m "refactor: extract image processing to separate function"
```

### Before Pull Request
1. Ensure all features from current phase complete
2. Run full test suite manually
3. Update all documentation
4. Clean commit history (squash if needed)
5. Write comprehensive PR description

---

## Troubleshooting Guide

### Issue: Extension won't load

**Symptoms**: Error on chrome://extensions/ page

**Solutions**:
```bash
# 1. Check manifest is valid
cat dist/manifest.json | jq .  # Should parse without errors

# 2. Rebuild from scratch
npm run clean
npm run build

# 3. Check for syntax errors
npm run type-check

# 4. Verify all referenced files exist
ls dist/background.js dist/content.js dist/popup.html
```

### Issue: Content script not injecting

**Symptoms**: No toast, no selection detection, no overlay

**Solutions**:
1. Check URL isn't restricted (chrome://, about:, file://)
2. Check manifest `content_scripts.matches` patterns
3. Verify extension has permission for the site
4. Check content.js exists in dist/
5. Look for errors in page console (F12)

### Issue: Buttons in popup don't work

**Symptoms**: Clicking buttons does nothing

**Solutions**:
1. Right-click popup → Inspect
2. Check console for JavaScript errors
3. Verify event listeners attached:
   ```typescript
   // In popup/index.ts, check DOMContentLoaded fired
   logger.info('Popup initialized');
   ```
4. Check if popup.js loaded:
   ```html
   <!-- In dist/popup.html, verify: -->
   <script src="popup.js"></script>
   ```

### Issue: Theme not working

**Symptoms**: Always light mode, or styles broken

**Solutions**:
1. Check theme.css imported:
   ```css
   /* At top of CSS file */
   @import url('../shared/theme.css');
   ```
2. Check ThemeManager initialized:
   ```typescript
   await ThemeManager.initialize();
   ```
3. Verify CSS variables used:
   ```css
   /* NOT: color: #333; */
   color: var(--color-text-primary); /* YES */
   ```
4. Check chrome.storage has theme data:
   ```javascript
   chrome.storage.sync.get(['theme'], (data) => console.log(data));
   ```

### Issue: Can't connect to Trilium

**Symptoms**: "Connection failed" or network errors

**Solutions**:
1. Test URL in browser directly
2. Check CORS headers on Trilium server
3. Verify auth token format (should be long string)
4. Check host_permissions in manifest includes Trilium URL
5. Test with curl:
   ```bash
   curl -H "Authorization: YOUR_TOKEN" https://trilium.example.com/api/notes
   ```

### Issue: Logs not showing

**Symptoms**: Empty logs page or missing entries

**Solutions**:
1. Check centralized logging initialized:
   ```typescript
   const logger = Logger.create('ComponentName', 'background');
   logger.info('Test message'); // Should appear in logs
   ```
2. Check storage has logs:
   ```javascript
   chrome.storage.local.get(['centralizedLogs'], (data) => {
     console.log(data.centralizedLogs?.length || 0, 'logs');
   });
   ```
3. Clear and regenerate logs:
   ```javascript
   chrome.storage.local.remove(['centralizedLogs']);
   // Then perform actions to generate new logs
   ```

### Issue: Service worker keeps stopping

**Symptoms**: "Service worker (stopped)" on extensions page

**Solutions**:
1. Check for unhandled promise rejections:
   ```typescript
   // Add to all async functions
   try {
     await someOperation();
   } catch (error) {
     logger.error('Operation failed', error);
     // Don't let error propagate unhandled
   }
   ```
2. Ensure message handlers return boolean:
   ```typescript
   chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
     handleMessageAsync(msg, sender, sendResponse);
     return true; // CRITICAL
   });
   ```
3. Check for syntax errors that crash on load:
   ```bash
   npm run type-check
   ```

---

## Quick Command Reference

### Development
```bash
# Start dev build (watch mode)
npm run dev

# Type check (watch mode)
npm run type-check --watch

# Clean build artifacts
npm run clean

# Full rebuild
npm run clean && npm run build

# Format code
npm run format

# Lint code
npm run lint
```

### Chrome Commands
```javascript
// In any console

// View all storage
chrome.storage.local.get(null, console.log);
chrome.storage.sync.get(null, console.log);

// Clear storage
chrome.storage.local.clear();
chrome.storage.sync.clear();

// Check runtime info
chrome.runtime.getManifest();
chrome.runtime.id;

// Get extension version
chrome.runtime.getManifest().version;
```

### Debugging Shortcuts
```typescript
// Temporary debug logging
const DEBUG = true;
if (DEBUG) logger.debug('Debug info', { data });

// Quick performance check
console.time('operation');
await longRunningOperation();
console.timeEnd('operation');

// Inspect object
console.dir(complexObject, { depth: null });

// Trace function calls
console.trace('Function called');
```

---

## VS Code Tips

### Essential Extensions
- **GitHub Copilot**: AI pair programming
- **ESLint**: Code quality
- **Prettier**: Code formatting
- **Error Lens**: Inline error display
- **TypeScript Vue Plugin**: Enhanced TS support

### Keyboard Shortcuts
- `Ctrl+Shift+P`: Command palette
- `Ctrl+P`: Quick file open
- `Ctrl+B`: Toggle sidebar
- `Ctrl+\``: Toggle terminal
- `Ctrl+Shift+F`: Find in files
- `Ctrl+I`: Inline Copilot chat
- `Ctrl+Alt+I`: Copilot chat pane

### Useful Copilot Prompts

```
# Quick explanation
/explain What does this function do?

# Generate tests
/tests Generate test cases for this function

# Fix issues
/fix Fix the TypeScript errors in this file

# Optimize
/optimize Make this function more efficient
```

### Custom Snippets

Add to `.vscode/snippets.code-snippets`:

```json
{
  "Logger Import": {
    "prefix": "log-import",
    "body": [
      "import { Logger } from '@/shared/utils';",
      "const logger = Logger.create('$1', '$2');"
    ]
  },
  "Try-Catch Block": {
    "prefix": "try-log",
    "body": [
      "try {",
      "  $1",
      "} catch (error) {",
      "  logger.error('$2', error);",
      "  throw error;",
      "}"
    ]
  },
  "Message Handler": {
    "prefix": "msg-handler",
    "body": [
      "chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {",
      "  (async () => {",
      "    try {",
      "      const result = await handle$1(message);",
      "      sendResponse({ success: true, data: result });",
      "    } catch (error) {",
      "      logger.error('$1 handler error', error);",
      "      sendResponse({ success: false, error: error.message });",
      "    }",
      "  })();",
      "  return true;",
      "});"
    ]
  }
}
```

---

## Architecture Decision Log

Keep track of important decisions:

### Decision 1: Use IIFE Build Format
**Date**: October 2025  
**Reason**: Simpler than ES modules for Chrome extensions, better browser compatibility  
**Trade-off**: No dynamic imports, larger bundle size

### Decision 2: Centralized Logging System
**Date**: October 2025  
**Reason**: Service workers terminate frequently, console.log doesn't persist  
**Trade-off**: Small overhead, but massive debugging improvement

### Decision 3: OffscreenCanvas for Screenshots
**Date**: October 2025 (planned)  
**Reason**: Service workers can't access DOM canvas  
**Trade-off**: More complex API, but necessary for MV3

### Decision 4: Store Recent Notes in Local Storage
**Date**: October 2025 (planned)  
**Reason**: Faster access, doesn't need to sync across devices  
**Trade-off**: Won't sync, but not critical for this feature

---

## Performance Benchmarks

Track performance as you develop:

### Screenshot Capture (Target)
- Full page capture: < 500ms
- Crop operation: < 100ms
- Total save time: < 2s

### Content Processing (Target)
- Readability extraction: < 300ms
- DOMPurify sanitization: < 200ms
- Cheerio cleanup: < 100ms
- Image processing (10 images): < 3s

### Storage Operations (Target)
- Save settings: < 50ms
- Load settings: < 50ms
- Add log entry: < 20ms

**How to measure**:
```typescript
const start = performance.now();
await someOperation();
const duration = performance.now() - start;
logger.info('Operation completed', { duration });
```

---

## Testing Scenarios

### Scenario 1: New User First-Time Setup
1. Install extension
2. Open popup
3. Click "Configure Trilium"
4. Enter server URL and token
5. Test connection
6. Save settings
7. Try to save a page
8. Verify note created in Trilium

**Expected**: Smooth onboarding, clear error messages if something fails

### Scenario 2: Network Interruption
1. Start saving a page
2. Disconnect network mid-save
3. Check error handling
4. Reconnect network
5. Retry save

**Expected**: Graceful error, no crashes, clear user feedback

### Scenario 3: Service Worker Restart
1. Trigger service worker to sleep (wait 30s idle)
2. Perform action that wakes it (open popup)
3. Check if state persisted correctly
4. Verify functionality still works

**Expected**: Seamless experience, user doesn't notice restart

### Scenario 4: Theme Switching
1. Open popup in light mode
2. Toggle to dark mode
3. Close popup
4. Reopen popup
5. Verify dark mode persisted
6. Change system theme
7. Set extension to "System"
8. Verify it follows system theme

**Expected**: Instant visual feedback, persistent preference

---

## Code Review Checklist

Before asking for PR review:

### Functionality
- [ ] Feature works as intended
- [ ] Edge cases handled
- [ ] Error messages are helpful
- [ ] No console errors/warnings

### Code Quality
- [ ] TypeScript with no `any` types
- [ ] Centralized logging used
- [ ] Theme system integrated (if UI)
- [ ] No hardcoded values (use constants)
- [ ] Functions are single-purpose
- [ ] No duplicate code

### Documentation
- [ ] Code comments explain "why", not "what"
- [ ] Complex logic has explanatory comments
- [ ] FEATURE-PARITY-CHECKLIST.md updated
- [ ] README updated if needed

### Testing
- [ ] Manually tested all paths
- [ ] Tested error scenarios
- [ ] Tested on different page types
- [ ] Checked performance

### Git
- [ ] Meaningful commit messages
- [ ] Commits are logical units
- [ ] No debug code committed
- [ ] No commented-out code

---

## Resources

### Chrome Extension Docs (Local)
- `reference/chrome_extension_docs/` - Manifest V3 API reference

### Library Docs (Local)
- `reference/Mozilla_Readability_docs/` - Content extraction
- `reference/cure53_DOMPurify_docs/` - HTML sanitization
- `reference/cheerio_docs/` - DOM manipulation

### External Links
- [Chrome Extension MV3 Migration Guide](https://developer.chrome.com/docs/extensions/migrating/)
- [Trilium API Documentation](https://github.com/zadam/trilium/wiki/Document-API)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)

### Community
- [Trilium Discussion Board](https://github.com/zadam/trilium/discussions)
- [Chrome Extensions Google Group](https://groups.google.com/a/chromium.org/g/chromium-extensions)

---

**Last Updated**: October 18, 2025  
**Maintainer**: Development team

---

**Quick Links**:
- [Architecture Overview](./ARCHITECTURE.md)
- [Feature Checklist](./FEATURE-PARITY-CHECKLIST.md)
- [Migration Patterns](./MIGRATION-PATTERNS.md)