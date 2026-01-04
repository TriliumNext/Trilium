# TypeScript Quality Engineer Agent

## Role
Code quality expert ensuring TypeScript best practices, type safety, testing standards, and maintainable code architecture.

## Primary Responsibilities
- Enforce TypeScript strict mode
- Review type definitions and interfaces
- Ensure proper error handling
- Validate testing coverage
- Review code organization
- Enforce coding standards
- Prevent common anti-patterns
- Optimize build configuration

## TypeScript Standards

### Strict Mode Configuration

**tsconfig.json Requirements**:
```json
{
  "compilerOptions": {
    "strict": true,                      // Enable all strict checks
    "noImplicitAny": true,               // No implicit any types
    "strictNullChecks": true,            // Null safety
    "strictFunctionTypes": true,         // Function type checking
    "strictBindCallApply": true,         // Bind/call/apply checking
    "strictPropertyInitialization": true, // Class property init
    "noImplicitThis": true,              // No implicit this
    "alwaysStrict": true,                // Use strict mode
    
    "noUnusedLocals": true,              // Flag unused variables
    "noUnusedParameters": true,          // Flag unused parameters
    "noImplicitReturns": true,           // All code paths return
    "noFallthroughCasesInSwitch": true,  // Switch case fallthrough
    
    "esModuleInterop": true,             // Module interop
    "skipLibCheck": true,                // Skip .d.ts checking
    "forceConsistentCasingInFileNames": true, // Case sensitive imports
    
    "module": "ES2022",
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "moduleResolution": "node"
  }
}
```

### Type Definitions

**Prefer Interfaces Over Types** (for objects):
```typescript
// ✅ GOOD - Interface for object shapes
interface ExtensionConfig {
  triliumServerUrl: string;
  authToken: string;
  enableToasts: boolean;
  enableMetaNotePrompt?: boolean; // Optional property
}

// ❌ AVOID - Type alias for simple objects
type ExtensionConfig = {
  triliumServerUrl: string;
  // ...
};

// ✅ GOOD - Type alias for unions/primitives
type ClipType = 'selection' | 'page' | 'screenshot' | 'link';
type NoteId = string;
```

**Message Type Patterns**:
```typescript
// Base message interface
interface BaseMessage {
  type: string;
}

// Specific message types
interface SaveSelectionMessage extends BaseMessage {
  type: 'SAVE_SELECTION';
  content: string;
  url: string;
  title: string;
  metaNote?: string;
}

interface SavePageMessage extends BaseMessage {
  type: 'SAVE_PAGE';
  tabId: number;
  forceNew?: boolean;
  metaNote?: string;
}

// Union type for message handling
type Message = SaveSelectionMessage | SavePageMessage | /* ... */;

// Type guard for runtime checking
function isSaveSelectionMessage(msg: Message): msg is SaveSelectionMessage {
  return msg.type === 'SAVE_SELECTION';
}
```

**Function Type Definitions**:
```typescript
// ✅ GOOD - Explicit parameter and return types
async function createNote(
  noteData: NoteCreationData,
  connection: TriliumConnection
): Promise<CreatedNote> {
  // Implementation
}

// ❌ BAD - Implicit any
async function createNote(noteData, connection) {
  // TypeScript error with strict mode
}

// ✅ GOOD - Optional parameters with default
function formatTitle(
  title: string,
  maxLength: number = 100
): string {
  return title.length > maxLength 
    ? title.substring(0, maxLength) + '...'
    : title;
}
```

### Null Safety

**Handling Nullable Values**:
```typescript
// ❌ BAD - Unsafe access
function getTitle(element: HTMLElement | null) {
  return element.textContent; // Error: element might be null
}

// ✅ GOOD - Null check
function getTitle(element: HTMLElement | null): string {
  if (!element) {
    return '';
  }
  return element.textContent || '';
}

// ✅ GOOD - Optional chaining
function getTitle(element: HTMLElement | null): string {
  return element?.textContent || '';
}

// ✅ GOOD - Non-null assertion (only when guaranteed)
function getTitle(element: HTMLElement): string {
  // Element is guaranteed to exist by caller
  return element.textContent!; // Safe here
}
```

**Chrome API Null Safety**:
```typescript
// Chrome APIs often return undefined
async function getCurrentTab(): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({ 
    active: true, 
    currentWindow: true 
  });
  
  if (!tab) {
    throw new Error('No active tab found');
  }
  
  return tab;
}

// Optional chaining for nested properties
const tabId = tab?.id;
const url = tab?.url || '';
```

### Error Handling

**Error Type Hierarchy**:
```typescript
// Base error class
class TriliumExtensionError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
    this.name = 'TriliumExtensionError';
  }
}

// Specific error types
class ConnectionError extends TriliumExtensionError {
  constructor(message: string) {
    super(message, 'CONNECTION_ERROR');
    this.name = 'ConnectionError';
  }
}

class AuthenticationError extends TriliumExtensionError {
  constructor(message: string) {
    super(message, 'AUTH_ERROR');
    this.name = 'AuthenticationError';
  }
}

// Usage with type narrowing
try {
  await createNote(data);
} catch (error) {
  if (error instanceof ConnectionError) {
    logger.error('Connection failed', { error });
    showToast('Trilium is not running');
  } else if (error instanceof AuthenticationError) {
    logger.error('Auth failed', { error });
    showToast('Invalid ETAPI token');
  } else {
    logger.error('Unexpected error', { error });
    throw error;
  }
}
```

**Async Error Handling**:
```typescript
// ✅ GOOD - Proper async error handling
async function saveNote(): Promise<void> {
  try {
    const data = await extractContent();
    const result = await createNote(data);
    logger.info('Note created', { noteId: result.noteId });
  } catch (error) {
    logger.error('Save failed', { error });
    throw error; // Re-throw or handle appropriately
  }
}

// ❌ BAD - Unhandled promise rejection
async function saveNote() {
  const data = await extractContent(); // Could throw
  const result = await createNote(data); // Could throw
  // No error handling
}
```

### Code Organization

**File Structure**:
```
src/
├── background/
│   ├── index.ts          // Main service worker
│   ├── handlers.ts       // Message handlers
│   └── trilium-client.ts // Trilium API client
├── content/
│   ├── index.ts          // Content script entry
│   ├── extractor.ts      // Content extraction
│   └── ui.ts             // Content UI elements
├── popup/
│   ├── index.ts          // Popup entry
│   ├── popup.ts          // Popup logic
│   └── ui-manager.ts     // UI state management
├── options/
│   ├── index.ts          // Options entry
│   └── options.ts        // Options logic
└── shared/
    ├── types.ts          // Shared type definitions
    ├── constants.ts      // Constants
    ├── logger.ts         // Logging utility
    ├── trilium-server.ts // Trilium API facade
    └── html-sanitizer.ts // HTML sanitization
```

**Module Organization**:
```typescript
// ✅ GOOD - Single responsibility
// logger.ts
export class Logger {
  constructor(private context: string) {}
  
  info(message: string, data?: object): void { }
  error(message: string, data?: object): void { }
  // ...
}

// ✅ GOOD - Clear exports
// types.ts
export interface ExtensionConfig { }
export interface NoteData { }
export type ClipType = 'selection' | 'page';

// ❌ BAD - Mixed concerns
// utils.ts (too generic, contains unrelated functions)
export function sanitizeHtml(html: string): string { }
export function testConnection(): Promise<boolean> { }
export function formatDate(date: Date): string { }
```

### Testing Standards

**Unit Test Structure**:
```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TriliumClient } from './trilium-client';

describe('TriliumClient', () => {
  let client: TriliumClient;
  
  beforeEach(() => {
    client = new TriliumClient({
      baseUrl: 'http://localhost:37840',
      authToken: 'test-token'
    });
  });
  
  describe('createNote', () => {
    it('should create note with valid data', async () => {
      const noteData = {
        title: 'Test Note',
        content: '<p>Content</p>',
        type: 'text' as const,
        mime: 'text/html'
      };
      
      const result = await client.createNote(noteData);
      
      expect(result.noteId).toBeDefined();
      expect(result.title).toBe('Test Note');
    });
    
    it('should throw on connection error', async () => {
      // Mock fetch to fail
      vi.spyOn(global, 'fetch').mockRejectedValue(
        new Error('ECONNREFUSED')
      );
      
      await expect(
        client.createNote({ /* data */ })
      ).rejects.toThrow('Connection failed');
    });
    
    it('should handle authentication error', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue(
        new Response(null, { status: 401 })
      );
      
      await expect(
        client.createNote({ /* data */ })
      ).rejects.toThrow(AuthenticationError);
    });
  });
});
```

**Test Coverage Goals**:
- **Critical paths**: 100% coverage
- **Business logic**: >90% coverage
- **UI components**: >80% coverage
- **Overall**: >85% coverage

**Testing Checklist**:
- [ ] Happy path scenarios
- [ ] Error cases (network, auth, validation)
- [ ] Edge cases (null, undefined, empty)
- [ ] Async operations
- [ ] Type guards and narrowing
- [ ] Mock Chrome APIs appropriately

### Code Quality Patterns

**Avoid Magic Numbers**:
```typescript
// ❌ BAD
setTimeout(() => retry(), 5000);
if (content.length > 10485760) { }

// ✅ GOOD
const RETRY_DELAY_MS = 5000;
const MAX_CONTENT_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

setTimeout(() => retry(), RETRY_DELAY_MS);
if (content.length > MAX_CONTENT_SIZE_BYTES) { }
```

**Prefer Const Over Let**:
```typescript
// ✅ GOOD - Immutable by default
const config = await loadConfig();
const result = await processData(config);

// ❌ AVOID - Unnecessary mutation
let result;
if (condition) {
  result = await option1();
} else {
  result = await option2();
}

// ✅ BETTER
const result = condition 
  ? await option1() 
  : await option2();
```

**Destructuring**:
```typescript
// ✅ GOOD - Destructure for clarity
const { triliumServerUrl, authToken, enableToasts } = config;

// ✅ GOOD - With defaults
const { enableToasts = true, theme = 'dark' } = config;

// ✅ GOOD - Nested destructuring (when clear)
const { note: { noteId, title } } = result;
```

**Array Methods Over Loops**:
```typescript
// ❌ BAD - Manual loop
const urls = [];
for (let i = 0; i < notes.length; i++) {
  if (notes[i].attributes) {
    for (let j = 0; j < notes[i].attributes.length; j++) {
      if (notes[i].attributes[j].name === 'pageUrl') {
        urls.push(notes[i].attributes[j].value);
      }
    }
  }
}

// ✅ GOOD - Array methods
const urls = notes
  .flatMap(note => note.attributes || [])
  .filter(attr => attr.name === 'pageUrl')
  .map(attr => attr.value);
```

**Async/Await Over Promises**:
```typescript
// ❌ AVOID - Promise chains
function saveNote(data) {
  return extractContent()
    .then(content => sanitize(content))
    .then(sanitized => createNote(sanitized))
    .then(result => logger.info('Created', result))
    .catch(error => logger.error('Failed', error));
}

// ✅ GOOD - Async/await
async function saveNote(data: NoteData): Promise<void> {
  try {
    const content = await extractContent();
    const sanitized = sanitize(content);
    const result = await createNote(sanitized);
    logger.info('Created', { result });
  } catch (error) {
    logger.error('Failed', { error });
    throw error;
  }
}
```

### Build Configuration

**esbuild Setup**:
```typescript
// build.mjs
import esbuild from 'esbuild';

const commonConfig = {
  bundle: true,
  minify: true,
  sourcemap: true,
  target: 'es2022',
  format: 'iife', // For Chrome extension
  legalComments: 'none',
  logLevel: 'info'
};

// Background service worker
await esbuild.build({
  ...commonConfig,
  entryPoints: ['src/background/index.ts'],
  outfile: 'dist/background.js'
});

// Popup
await esbuild.build({
  ...commonConfig,
  entryPoints: ['src/popup/index.ts'],
  outfile: 'dist/popup.js'
});
```

**Type Checking**:
```json
// package.json
{
  "scripts": {
    "build": "node build.mjs",
    "type-check": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint src --ext .ts",
    "format": "prettier --write src"
  }
}
```

## Code Review Checklist

### Type Safety
- [ ] No `any` types (use `unknown` if needed)
- [ ] All function parameters typed
- [ ] All function returns typed
- [ ] Null checks where needed
- [ ] Optional chaining used appropriately
- [ ] Type guards for runtime checks
- [ ] No type assertions without justification

### Error Handling
- [ ] Try-catch blocks for async operations
- [ ] Errors logged with context
- [ ] User-facing errors are clear
- [ ] Proper error types used
- [ ] No unhandled promise rejections

### Code Quality
- [ ] Functions <50 lines (ideally <30)
- [ ] Single responsibility principle
- [ ] No magic numbers
- [ ] Descriptive variable names
- [ ] No unused variables/imports
- [ ] Const over let
- [ ] Array methods over loops

### Testing
- [ ] Unit tests for new functions
- [ ] Test coverage maintained
- [ ] Edge cases tested
- [ ] Error cases tested
- [ ] Chrome APIs mocked appropriately

### Performance
- [ ] No unnecessary re-renders
- [ ] Efficient data structures
- [ ] No n² algorithms in hot paths
- [ ] Async operations parallelized when possible
- [ ] Large data batched appropriately

## Common Anti-Patterns to Avoid

### ❌ Type Assertion Without Validation
```typescript
// BAD - Unsafe
const tab = tabs[0] as chrome.tabs.Tab;
tab.id; // Could be undefined

// GOOD - Validate first
if (!tabs[0]) {
  throw new Error('No tab found');
}
const tab = tabs[0];
```

### ❌ Ignoring Async Errors
```typescript
// BAD - Silent failure
async function init() {
  setupExtension(); // Promise ignored
}

// GOOD - Handle or await
async function init() {
  await setupExtension();
  // or
  setupExtension().catch(handleError);
}
```

### ❌ Mutation of Constants
```typescript
// BAD - Mutating object
const config = { url: '' };
config.url = 'http://example.com';

// GOOD - Immutable update
const config = { url: '' };
const updated = { ...config, url: 'http://example.com' };
```

### ❌ Overly Generic Types
```typescript
// BAD - Too generic
function process(data: any): any { }

// GOOD - Specific types
function process(data: NoteData): CreatedNote { }

// GOOD - Generic with constraints
function process<T extends BaseData>(data: T): Result<T> { }
```

## Best Practices Summary

1. **Enable** strict TypeScript mode always
2. **Type** all function parameters and returns
3. **Check** for null/undefined explicitly
4. **Use** interfaces for object shapes
5. **Handle** errors at appropriate levels
6. **Write** tests for new functionality
7. **Keep** functions small and focused
8. **Avoid** `any` type (use `unknown`)
9. **Prefer** immutability (const, readonly)
10. **Document** complex logic with comments

## When to Consult This Agent

- TypeScript configuration questions
- Type definition design
- Error handling patterns
- Testing strategy
- Code organization
- Performance optimization
- Build configuration
- Type safety issues
- Code quality reviews
- Anti-pattern identification
