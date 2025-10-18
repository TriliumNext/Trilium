# GitHub Copilot Instructions - Trilium Web Clipper MV3

## Project Identity
**Working Directory**: `apps/web-clipper-manifestv3/` (active development)  
**Reference Directory**: `apps/web-clipper/` (MV2 legacy - reference only)  
**Goal**: Feature-complete MV3 migration with architectural improvements

## Quick Context Links
- Architecture & Systems: See `docs/ARCHITECTURE.md`
- Feature Status: See `docs/FEATURE-PARITY-CHECKLIST.md`
- Development Patterns: See `docs/DEVELOPMENT-GUIDE.md`
- Migration Patterns: See `docs/MIGRATION-PATTERNS.md`

## Critical Rules

### Workspace Boundaries
- ✅ Work ONLY in `apps/web-clipper-manifestv3/`
- ✅ Reference `apps/web-clipper/` for feature understanding
- ❌ DO NOT suggest patterns from other monorepo projects
- ❌ DO NOT copy MV2 code directly

### Code Standards (Non-Negotiable)
1. **No Emojis in Code**: Never use emojis in `.ts`, `.js`, `.json` files, string literals, or code comments
2. **Use Centralized Logging**: `const logger = Logger.create('ComponentName', 'background')`
3. **Use Theme System**: Import `theme.css`, use CSS variables `var(--color-*)`, call `ThemeManager.initialize()`
4. **TypeScript Everything**: Full type safety, no `any` types
5. **Error Handling**: Always wrap async operations in try-catch with proper logging

### Development Mode
- **Current Phase**: Active development (use `npm run dev`)
- **Build**: Watch mode with live reload
- **Focus**: Debugging, rapid iteration, feature implementation
- ⚠️ Only use `npm run build` for final validation

## Essential Patterns

### Message Passing Template
```typescript
// Background service worker
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      const result = await handleMessage(message);
      sendResponse({ success: true, data: result });
    } catch (error) {
      logger.error('Handler error', error);
      sendResponse({ success: false, error: error.message });
    }
  })();
  return true; // Required for async
});
```

### Storage Pattern
```typescript
// Use chrome.storage, NEVER localStorage in service workers
await chrome.storage.local.set({ key: value });
const { key } = await chrome.storage.local.get(['key']);
```

### Component Structure
```typescript
import { Logger } from '@/shared/utils';
import { ThemeManager } from '@/shared/theme';

const logger = Logger.create('ComponentName', 'background');

async function initialize() {
  await ThemeManager.initialize();
  logger.info('Component initialized');
}
```

## When Suggesting Code

### Checklist for Every Response
1. [ ] Verify API usage against `reference/chrome_extension_docs/`
2. [ ] Include proper error handling with centralized logging
3. [ ] Use TypeScript with full type annotations
4. [ ] If UI code: integrate theme system
5. [ ] Reference legacy code for functionality, not implementation
6. [ ] Explain MV2→MV3 changes if applicable

### Response Format
```
**Task**: [What we're implementing]
**Legacy Pattern** (if migrating): [Brief description]
**Modern Approach**: [Show TypeScript implementation]
**Files Modified**: [List affected files]
**Testing**: [How to verify it works]
```

## Common MV3 Patterns

### Service Worker Persistence
```typescript
// State must be stored, not kept in memory
const getState = async () => {
  const { state } = await chrome.storage.local.get(['state']);
  return state || defaultState;
};
```

### Content Script Communication
```typescript
// Inject scripts programmatically
await chrome.scripting.executeScript({
  target: { tabId },
  files: ['content.js']
});
```

### Manifest V3 APIs
- `chrome.action` (not browserAction)
- `chrome.storage` (not localStorage)
- `chrome.alarms` (not setTimeout in service worker)
- `declarativeNetRequest` (not webRequest blocking)

## Feature Development Workflow

### Before Starting Work
1. Check `docs/FEATURE-PARITY-CHECKLIST.md` for feature status
2. Review legacy implementation in `apps/web-clipper/`
3. Check if feature needs manifest permissions
4. Plan which files will be modified

### During Development
1. Use centralized logging liberally for debugging
2. Test frequently with `npm run dev` + Chrome reload
3. Check console in both popup and service worker contexts
4. Update feature checklist when complete

### Before Committing
1. Run `npm run type-check`
2. Test all related functionality
3. Verify no console errors
4. Update `FEATURE-PARITY-CHECKLIST.md`

## What NOT to Include in Suggestions

❌ Long explanations of basic TypeScript concepts  
❌ Generic Chrome extension tutorials  
❌ Detailed history of MV2→MV3 migration  
❌ Code from other monorepo projects  
❌ Placeholder/TODO comments without implementation  
❌ Overly defensive coding for edge cases not in legacy version

## What TO Focus On

✅ Concrete, working code that solves the task  
✅ Feature parity with legacy extension  
✅ Modern TypeScript patterns  
✅ Proper error handling and logging  
✅ Clear migration explanations when relevant  
✅ Specific file paths and line references  
✅ Testing instructions

## Documentation References

- **Chrome APIs**: `reference/chrome_extension_docs/`
- **Readability**: `reference/Mozilla_Readability_docs/`
- **DOMPurify**: `reference/cure53_DOMPurify_docs/`
- **Cheerio**: `reference/cheerio_docs/`

---

**Remember**: This is an active development project in an existing codebase. Be specific, be practical, and focus on getting features working efficiently. When in doubt, check the architecture docs first.