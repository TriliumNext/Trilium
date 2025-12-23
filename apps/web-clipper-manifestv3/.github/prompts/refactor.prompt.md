---
name: refactor
description: Refactor code for improved structure, readability, and maintainability
argument-hint: Describe what you want to refactor
agent: agent
tools:
  - codebase
  - editFiles
  - problems
  - runCommands
  - search
  - usages
---

# Refactor Prompt

You are **refactoring** code in the Trilium Web Clipper MV3 extension to improve structure, readability, and maintainability without changing functionality.

## Refactoring Principles

### 1. Preserve Behavior
- Refactoring changes structure, not functionality
- Run `npm run type-check` before and after
- Test core features after refactoring
- Small, incremental changes

### 2. Improve Readability
```typescript
// ❌ Before: Unclear intent
const r = d.map(x => x.t === 'l' ? x.v : null).filter(Boolean);

// ✅ After: Clear intent
const labelValues = attributes
  .filter(attr => attr.type === 'label')
  .map(attr => attr.value);
```

### 3. Single Responsibility
```typescript
// ❌ Before: Function does too much
async function saveContent(content, options) {
  // Sanitize
  // Format
  // Connect to Trilium
  // Create note
  // Add attributes
  // Show notification
}

// ✅ After: Separate concerns
async function saveContent(content: ClipContent, options: SaveOptions) {
  const sanitized = sanitizeContent(content);
  const formatted = formatForTrilium(sanitized);
  const connection = await getTriliumConnection();
  const note = await createNote(connection, formatted, options);
  await addClipperAttributes(connection, note.noteId, content.metadata);
  showSaveSuccess(note);
}
```

### 4. Extract Functions
```typescript
// ❌ Before: Inline complex logic
if (url.startsWith('http://') || url.startsWith('https://')) {
  const parsed = new URL(url);
  if (parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
    // process
  }
}

// ✅ After: Extracted to named function
function isExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const isHttp = ['http:', 'https:'].includes(parsed.protocol);
    const isLocal = ['localhost', '127.0.0.1'].includes(parsed.hostname);
    return isHttp && !isLocal;
  } catch {
    return false;
  }
}

if (isExternalUrl(url)) {
  // process
}
```

### 5. Type Improvements
```typescript
// ❌ Before: Loose typing
function handle(msg: any): any {
  if (msg.type === 'SAVE') {
    // ...
  }
}

// ✅ After: Discriminated union
interface SaveMessage {
  type: 'SAVE';
  content: string;
  url: string;
}

interface ScreenshotMessage {
  type: 'SCREENSHOT';
  dataUrl: string;
}

type Message = SaveMessage | ScreenshotMessage;

function handleMessage(msg: Message): MessageResponse {
  switch (msg.type) {
    case 'SAVE':
      return handleSave(msg);
    case 'SCREENSHOT':
      return handleScreenshot(msg);
  }
}
```

## Common Refactoring Patterns

### Extract Constant
```typescript
// ❌ Magic numbers
if (content.length > 1048576) { }

// ✅ Named constant
const MAX_CONTENT_SIZE = 1024 * 1024; // 1MB
if (content.length > MAX_CONTENT_SIZE) { }
```

### Extract Type
```typescript
// ❌ Inline object type
function save(options: { url: string; title: string; content: string }) { }

// ✅ Named interface
interface SaveOptions {
  url: string;
  title: string;
  content: string;
}
function save(options: SaveOptions) { }
```

### Consolidate Conditionals
```typescript
// ❌ Repeated conditions
if (isLoading) return <Loading />;
if (error) return <Error />;
if (!data) return <Empty />;

// ✅ Early returns with guards
function renderContent() {
  if (isLoading) return <Loading />;
  if (error) return <Error message={error} />;
  if (!data) return <Empty />;
  
  return <Content data={data} />;
}
```

### Replace Nested Conditionals with Guard Clauses
```typescript
// ❌ Deeply nested
function process(data) {
  if (data) {
    if (data.isValid) {
      if (data.hasContent) {
        // actual logic
      }
    }
  }
}

// ✅ Guard clauses
function process(data: Data | undefined) {
  if (!data) return;
  if (!data.isValid) return;
  if (!data.hasContent) return;
  
  // actual logic - flat and clear
}
```

## Refactoring Checklist

Before:
- [ ] Understand current behavior
- [ ] Identify code smells
- [ ] Plan small changes

During:
- [ ] One change at a time
- [ ] Run `npm run type-check` frequently
- [ ] Keep commits small

After:
- [ ] `npm run type-check` passes
- [ ] `npm run lint` passes
- [ ] `npm run build` succeeds
- [ ] Manual testing of affected features
- [ ] No functionality changed

## Code Smells to Address

| Smell | Refactoring |
|-------|-------------|
| Long function | Extract functions |
| Large file | Split into modules |
| Duplicate code | Extract shared utility |
| Magic numbers | Extract constants |
| any types | Add proper types |
| Deep nesting | Guard clauses |
| God object | Single responsibility |

## Reference Agents

- [TypeScript Quality Engineer](../agents/typescript-quality-engineer.md) - Code standards
- [Chrome Extension Architect](../agents/chrome-extension-architect.md) - Architecture patterns
