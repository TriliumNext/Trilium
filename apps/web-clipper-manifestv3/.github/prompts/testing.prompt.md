---
name: testing
description: Write and run tests for the Web Clipper extension
argument-hint: Describe what you want to test
agent: agent
tools:
  - codebase
  - editFiles
  - problems
  - runCommands
  - search
  - testFailure
---

# Testing Prompt

You are writing and running **tests** for the Trilium Web Clipper MV3 extension. Focus on unit tests, integration tests, and manual testing strategies.

## Testing Strategy

### Unit Tests

Test individual functions and modules in isolation:

```typescript
// Example: Testing sanitization
import { sanitizeHtml } from '../src/shared/sanitize';

describe('sanitizeHtml', () => {
  it('removes script tags', () => {
    const dirty = '<p>Hello</p><script>alert("xss")</script>';
    const clean = sanitizeHtml(dirty);
    expect(clean).not.toContain('script');
    expect(clean).toContain('<p>Hello</p>');
  });

  it('removes event handlers', () => {
    const dirty = '<img src="x" onerror="alert(1)">';
    const clean = sanitizeHtml(dirty);
    expect(clean).not.toContain('onerror');
  });

  it('preserves allowed tags', () => {
    const input = '<p><strong>Bold</strong> and <em>italic</em></p>';
    const clean = sanitizeHtml(input);
    expect(clean).toBe(input);
  });
});
```

### Message Handler Tests

```typescript
// Testing service worker message handling
describe('MessageHandler', () => {
  it('handles SAVE_SELECTION message', async () => {
    const message = {
      type: 'SAVE_SELECTION',
      content: '<p>Test content</p>',
      url: 'https://example.com',
      title: 'Test Page'
    };

    const result = await handleMessage(message);
    
    expect(result.success).toBe(true);
    expect(result.noteId).toBeDefined();
  });

  it('handles invalid message type', async () => {
    const message = { type: 'INVALID_TYPE' };
    
    const result = await handleMessage(message);
    
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown message type');
  });
});
```

### Storage Tests

```typescript
// Testing storage operations
describe('Storage', () => {
  beforeEach(() => {
    chrome.storage.local.clear();
  });

  it('saves and retrieves settings', async () => {
    const settings = {
      triliumUrl: 'http://localhost:8080',
      enableToasts: true
    };

    await saveSettings(settings);
    const retrieved = await getSettings();

    expect(retrieved).toEqual(settings);
  });
});
```

## Mocking Chrome APIs

```typescript
// Mock chrome.storage
const mockStorage: Record<string, unknown> = {};

global.chrome = {
  storage: {
    local: {
      get: jest.fn((keys) => Promise.resolve(
        keys.reduce((acc, key) => ({ ...acc, [key]: mockStorage[key] }), {})
      )),
      set: jest.fn((items) => {
        Object.assign(mockStorage, items);
        return Promise.resolve();
      }),
      clear: jest.fn(() => {
        Object.keys(mockStorage).forEach(key => delete mockStorage[key]);
        return Promise.resolve();
      })
    }
  },
  runtime: {
    sendMessage: jest.fn(),
    onMessage: {
      addListener: jest.fn()
    }
  }
} as unknown as typeof chrome;
```

## Manual Testing Checklist

### Core Functionality
- [ ] Save text selection
- [ ] Save full page
- [ ] Take screenshot
- [ ] Crop screenshot
- [ ] Save link from context menu
- [ ] Save image from context menu

### Connection
- [ ] Connect to desktop (localhost:37840)
- [ ] Connect to server with token
- [ ] Handle connection failure gracefully
- [ ] Auto-reconnect after disconnect

### Settings
- [ ] Save and load settings
- [ ] Token stored securely
- [ ] Settings persist across restarts

### Edge Cases
- [ ] Very long pages
- [ ] Pages with complex CSS
- [ ] Code blocks preserved
- [ ] Images handled correctly
- [ ] Special characters in titles

### Error Handling
- [ ] No Trilium connection
- [ ] Invalid token
- [ ] Network error during save
- [ ] Content script injection failure

## Browser Testing

### Chrome DevTools
1. Open `chrome://extensions/`
2. Enable Developer Mode
3. Load unpacked extension from `dist/`
4. Click "Inspect" on service worker
5. Check Console for errors

### Test Sites
- Simple article (Wikipedia)
- Code-heavy page (Stack Overflow, GitHub)
- Complex layout (news sites)
- Dynamic content (SPAs)

## Test Commands

```bash
# If using Vitest (planned)
npm test              # Run all tests
npm test -- --watch   # Watch mode
npm test -- --coverage # Coverage report

# Manual verification
npm run build         # Build extension
npm run type-check    # Verify types
```

## XSS Test Payloads

Always test sanitization with these:
```typescript
const xssPayloads = [
  '<script>alert("XSS")</script>',
  '<img src=x onerror=alert("XSS")>',
  '<svg onload=alert("XSS")>',
  'javascript:alert("XSS")',
  '<iframe src="javascript:alert(\'XSS\')">',
  '<body onload=alert("XSS")>',
  '<a href="javascript:alert(\'XSS\')">click</a>',
  '<div style="background:url(javascript:alert(\'XSS\'))">',
  '"><script>alert("XSS")</script>',
  '\';alert(String.fromCharCode(88,83,83))//\';'
];
```

## Reference

See [TypeScript Quality Engineer](../agents/typescript-quality-engineer.md) for testing standards.
