---
name: type-check
description: Fix TypeScript type errors and improve type safety
argument-hint: Paste error output or describe the type issue
agent: agent
tools:
  - codebase
  - editFiles
  - problems
  - runCommands
  - search
  - usages
---

# Type Check Prompt

You are fixing **TypeScript type errors** and improving type safety in the Trilium Web Clipper MV3 extension.

## Quick Diagnostics

```bash
# Run type checker
npm run type-check

# See all errors
npx tsc --noEmit --pretty
```

## Common Type Errors and Fixes

### 1. Property Does Not Exist

```typescript
// Error: Property 'foo' does not exist on type 'X'

// ❌ Problem
interface User {
  name: string;
}
const user: User = { name: 'John' };
console.log(user.foo); // Error!

// ✅ Fix: Add missing property
interface User {
  name: string;
  foo?: string; // Add optional property
}

// ✅ Or: Type assertion if certain
console.log((user as ExtendedUser).foo);
```

### 2. Type 'X' Is Not Assignable to Type 'Y'

```typescript
// ❌ Problem
const value: string = someFunction(); // Returns string | undefined

// ✅ Fix: Handle undefined
const value = someFunction();
if (value !== undefined) {
  // value is string here
}

// ✅ Or: Provide default
const value = someFunction() ?? 'default';

// ✅ Or: Non-null assertion (if certain)
const value = someFunction()!; // Use sparingly
```

### 3. Parameter Implicitly Has 'any' Type

```typescript
// ❌ Problem
function process(data) { } // data is implicit any

// ✅ Fix: Add type annotation
function process(data: ProcessData): void { }

// ✅ Or: Define inline type
function process(data: { id: string; value: number }): void { }
```

### 4. Object Is Possibly 'undefined'

```typescript
// ❌ Problem
const result = array.find(x => x.id === id);
console.log(result.name); // Error: result possibly undefined

// ✅ Fix: Guard check
const result = array.find(x => x.id === id);
if (result) {
  console.log(result.name);
}

// ✅ Or: Optional chaining
console.log(result?.name);
```

### 5. Argument Type Mismatch

```typescript
// ❌ Problem
function save(content: string): void { }
save(123); // Error: number not assignable to string

// ✅ Fix: Correct the argument
save(String(123));

// ✅ Or: Update function signature if needed
function save(content: string | number): void { }
```

### 6. Cannot Find Module

```typescript
// Error: Cannot find module './types' or its declarations

// ✅ Check file exists
// ✅ Check path is correct (case-sensitive)
// ✅ Check tsconfig paths
// ✅ Check for index.ts if importing folder
```

## Type Safety Improvements

### Replace 'any' with Proper Types

```typescript
// ❌ Avoid
function handleMessage(msg: any): any { }

// ✅ Use discriminated unions
type Message = 
  | { type: 'SAVE'; content: string }
  | { type: 'SCREENSHOT'; dataUrl: string };

function handleMessage(msg: Message): MessageResponse {
  switch (msg.type) {
    case 'SAVE': return handleSave(msg.content);
    case 'SCREENSHOT': return handleScreenshot(msg.dataUrl);
  }
}
```

### Type Guards

```typescript
// Runtime type checking
function isValidMessage(value: unknown): value is Message {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    typeof (value as Message).type === 'string'
  );
}

// Usage
if (isValidMessage(data)) {
  // data is typed as Message here
}
```

### Generic Types

```typescript
// Reusable typed storage
interface StorageResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

async function getFromStorage<T>(key: string): Promise<StorageResult<T>> {
  try {
    const result = await chrome.storage.local.get(key);
    return { success: true, data: result[key] as T };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// Usage with type safety
const settings = await getFromStorage<ExtensionSettings>('settings');
```

## Chrome API Types

```typescript
// Ensure @types/chrome is installed
// Types are available globally as 'chrome' namespace

// Message handler with proper types
chrome.runtime.onMessage.addListener(
  (
    message: Message,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: MessageResponse) => void
  ) => {
    // Handle message
    return true; // For async response
  }
);

// Storage with types
interface StorageData {
  settings: ExtensionSettings;
  cache: CacheData;
}

const { settings } = await chrome.storage.local.get(['settings']) as {
  settings?: ExtensionSettings;
};
```

## tsconfig.json Requirements

Ensure these strict options are enabled:

```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  }
}
```

## Type Check Workflow

1. Run `npm run type-check`
2. Address errors from top to bottom
3. Start with type definitions, then implementations
4. Run type-check again after fixes
5. Continue until clean

## Reference

See [TypeScript Quality Engineer](../agents/typescript-quality-engineer.md) for comprehensive TypeScript standards.
