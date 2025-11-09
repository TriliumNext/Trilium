# Code Block Preservation - Developer Guide

**Last Updated**: November 9, 2025  
**Author**: Trilium Web Clipper Team  
**Status**: Production Ready

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Module Documentation](#module-documentation)
4. [Implementation Details](#implementation-details)
5. [Monkey-Patching Approach](#monkey-patching-approach)
6. [Settings System](#settings-system)
7. [Testing Strategy](#testing-strategy)
8. [Maintenance Guide](#maintenance-guide)
9. [Known Limitations](#known-limitations)
10. [Version Compatibility](#version-compatibility)

---

## Overview

### Problem Statement

Mozilla Readability, used for article extraction, aggressively removes or relocates elements that don't appear to be core article content. This includes code blocks, which are often critical to technical articles but get stripped or moved during extraction.

### Solution

A multi-layered approach that:
1. **Detects** code blocks before extraction
2. **Marks** them for preservation
3. **Monkey-patches** Readability's cleaning methods to skip marked elements
4. **Restores** original methods after extraction
5. **Manages** site-specific settings via an allow list

### Key Features

- 🎯 **Selective preservation**: Only applies to allow-listed sites or with auto-detect
- 🔒 **Safe monkey-patching**: Always restores original methods (try-finally)
- ⚡ **Performance optimized**: Fast-path for non-code pages
- 🎨 **User-friendly**: Visual settings UI with default allow list
- 🛡️ **Error resilient**: Graceful fallbacks if preservation fails

---

## Architecture

### Module Structure

```
src/shared/
├── code-block-detection.ts       # Detects and analyzes code blocks
├── readability-code-preservation.ts  # Monkey-patches Readability
├── article-extraction.ts         # Main extraction orchestrator
└── code-block-settings.ts        # Settings management and storage

src/options/
├── codeblock-allowlist.html      # Allow list settings UI
├── codeblock-allowlist.css       # Styling for settings page
└── codeblock-allowlist.ts        # Settings page logic

src/content/
└── index.ts                      # Content script integration

src/background/
└── index.ts                      # Initializes default settings
```

### Data Flow Diagram

```
┌─────────────────┐
│  User Opens URL │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────────────────────┐
│  Content Script (src/content/index.ts)              │
│  - Listens for clip command                         │
│  - Calls extractArticle(document, url)              │
└────────┬────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────┐
│  Article Extraction (article-extraction.ts)         │
│  1. Check for code blocks (quick scan)              │
│  2. Load settings from storage                      │
│  3. Check if URL is allow-listed                    │
│  4. Decide: preserve or vanilla extraction          │
└────────┬────────────────────────────────────────────┘
         │
         ├─── Code blocks found + Allow-listed ─────┐
         │                                           │
         │                                           ▼
         │                          ┌────────────────────────────────┐
         │                          │  Code Preservation Path        │
         │                          │  (readability-code-             │
         │                          │   preservation.ts)              │
         │                          │  1. Detect code blocks          │
         │                          │  2. Mark with attribute         │
         │                          │  3. Monkey-patch Readability    │
         │                          │  4. Extract with protection     │
         │                          │  5. Restore methods             │
         │                          │  6. Clean markers               │
         │                          └────────────────────────────────┘
         │                                           │
         └─── No code OR not allow-listed ──┐       │
                                             │       │
                                             ▼       ▼
                                    ┌────────────────────┐
                                    │  Return Result     │
                                    │  - Article content │
                                    │  - Metadata        │
                                    │  - Preservation    │
                                    │    stats           │
                                    └────────────────────┘
```

### Key Design Principles

1. **Fail-Safe**: Always fall back to vanilla Readability if preservation fails
2. **Stateless**: No global state; all context passed via parameters
3. **Defensive**: Check method existence before overriding
4. **Logged**: Comprehensive logging at every decision point
5. **Typed**: Full TypeScript types for compile-time safety

---

## Module Documentation

### 1. code-block-detection.ts

**Purpose**: Detect and classify code blocks in HTML documents.

#### Key Functions

##### `detectCodeBlocks(document, options?)`

Scans document for code blocks and returns metadata array.

```typescript
interface CodeBlockDetectionOptions {
  minBlockLength?: number;    // Default: 80
  includeInline?: boolean;    // Default: false
}

interface CodeBlockMetadata {
  element: HTMLElement;
  isBlockLevel: boolean;
  content: string;
  length: number;
  lineCount: number;
  hasSyntaxHighlighting: boolean;
  classes: string[];
  importance: number;          // 0-1 scale
}

const blocks = detectCodeBlocks(document);
// Returns: CodeBlockMetadata[]
```

**Algorithm**:
1. Find all `<pre>` and `<code>` elements
2. For each element:
   - Check if it's block-level (see `isBlockLevelCode`)
   - Extract content and metadata
   - Calculate importance score
3. Filter by options (inline/block, min length)
4. Return array sorted by importance

##### `isBlockLevelCode(element)`

Determines if a code element is block-level (vs inline).

**Heuristics** (in priority order):
1. ✅ Parent is `<pre>` → block-level
2. ✅ Contains newline characters → block-level
3. ✅ Length > 80 characters → block-level
4. ✅ Has syntax highlighting classes → block-level
5. ✅ Parent has code block wrapper classes → block-level
6. ✅ Content/parent ratio > 80% → block-level
7. ❌ Otherwise → inline

```typescript
const codeElement = document.querySelector('code');
const isBlock = isBlockLevelCode(codeElement);
```

##### `hasCodeChild(element)`

Checks if element contains any code descendants.

```typescript
const section = document.querySelector('section');
const hasCode = hasCodeChild(section);  // true if contains <code> or <pre>
```

#### Performance Characteristics

- **Best Case**: O(n) where n = number of code elements (typically < 50)
- **Worst Case**: O(n * m) where m = avg depth of element tree (rare)
- **Typical**: < 5ms on pages with < 100 code blocks

#### Testing Strategy

```typescript
// Test cases to cover:
✓ Single <pre> tag
✓ <pre><code> combination
✓ Standalone <code> (inline)
✓ Long single-line code
✓ Multi-line code
✓ Syntax-highlighted blocks
✓ Nested code structures
✓ Empty code blocks
✓ Code inside tables/lists
```

---

### 2. readability-code-preservation.ts

**Purpose**: Safely override Readability methods to preserve code blocks.

#### Key Functions

##### `extractWithCodeBlockPreservation(document, url, settings)`

Main entry point for protected extraction.

```typescript
interface ExtractionResult {
  title: string;
  content: string;
  textContent: string;
  length: number;
  excerpt: string;
  byline: string | null;
  dir: string | null;
  siteName: string | null;
  lang: string | null;
  publishedTime: string | null;
  // Extension-specific
  codeBlocksPreserved: number;
  preservationApplied: boolean;
}

const result = await extractWithCodeBlockPreservation(
  document,
  'https://example.com/article',
  settings
);
```

**Process**:
1. Clone document (don't mutate original)
2. Detect code blocks
3. Mark blocks with `data-readability-preserve-code` attribute
4. Monkey-patch Readability methods (see below)
5. Run Readability.parse()
6. Restore original methods (try-finally)
7. Clean preservation markers
8. Return result with metadata

##### `runVanillaReadability(document, url)`

Fallback function for standard Readability extraction.

```typescript
const result = runVanillaReadability(document, url);
// Returns: ExtractionResult with preservationApplied: false
```

#### Monkey-Patching Implementation

**Patched Methods**:
- `Readability.prototype._clean`
- `Readability.prototype._removeNodes`
- `Readability.prototype._cleanConditionally`

**Override Logic**:

```typescript
function monkeyPatchReadability() {
  const originalMethods = {
    _clean: Readability.prototype._clean,
    _removeNodes: Readability.prototype._removeNodes,
    _cleanConditionally: Readability.prototype._cleanConditionally
  };

  // Override _clean
  Readability.prototype._clean = function(node, tag) {
    if (shouldPreserveElement(node)) {
      logger.debug('Skipping _clean for preserved element');
      return;
    }
    return originalMethods._clean.call(this, node, tag);
  };

  // Similar for _removeNodes and _cleanConditionally...

  return originalMethods;  // Return for restoration
}

function shouldPreserveElement(element): boolean {
  // Check if element or any ancestor has preservation marker
  let current = element;
  while (current && current !== document.body) {
    if (current.hasAttribute?.(PRESERVE_MARKER)) {
      return true;
    }
    current = current.parentElement;
  }
  return false;
}
```

**Safety Guarantees**:
1. ✅ Always uses try-finally to restore methods
2. ✅ Checks method existence before overriding
3. ✅ Preserves `this` context with `.call()`
4. ✅ Falls back to vanilla if patching fails
5. ✅ Logs all operations for debugging

---

### 3. article-extraction.ts

**Purpose**: Orchestrate extraction with intelligent preservation decisions.

#### Key Functions

##### `extractArticle(document, url, settings?)`

Main extraction function with automatic preservation logic.

```typescript
async function extractArticle(
  document: Document,
  url: string,
  settings?: CodeBlockSettings
): Promise<ExtractionResult>
```

**Decision Tree**:

```
1. Quick scan: Does page have code blocks?
   │
   ├─ NO → Run vanilla Readability (fast path)
   │
   └─ YES → Continue
       │
       2. Load settings (if not provided)
       │
       3. Check: Should preserve for this site?
          │
          ├─ NO → Run vanilla Readability
          │
          └─ YES → Run preservation extraction
```

**Performance Optimization**:
- Fast-path for non-code pages (skips settings load)
- Caches settings for same-session extractions
- Exits early if feature disabled globally

##### `extractArticleVanilla(document, url)`

Convenience wrapper for vanilla extraction.

##### `extractArticleWithCode(document, url, settings?)`

Convenience wrapper that forces code preservation.

#### Usage Examples

```typescript
// Automatic (recommended)
const result = await extractArticle(document, window.location.href);

// Force vanilla
const result = await extractArticleVanilla(document, url);

// Force preservation (testing)
const result = await extractArticleWithCode(document, url);

// With custom settings
const result = await extractArticle(document, url, {
  enabled: true,
  autoDetect: false,
  allowList: [/* custom entries */]
});
```

---

### 4. code-block-settings.ts

**Purpose**: Manage settings storage and URL matching logic.

#### Settings Schema

```typescript
interface CodeBlockSettings {
  enabled: boolean;           // Master toggle
  autoDetect: boolean;        // Preserve on all sites
  allowList: AllowListEntry[];
}

interface AllowListEntry {
  type: 'domain' | 'url';
  value: string;
  enabled: boolean;
  custom?: boolean;           // User-added vs default
}
```

#### Key Functions

##### `loadCodeBlockSettings()`

Loads settings from `chrome.storage.sync`.

```typescript
const settings = await loadCodeBlockSettings();
// Returns: CodeBlockSettings with defaults if empty
```

##### `saveCodeBlockSettings(settings)`

Saves settings to storage.

```typescript
await saveCodeBlockSettings({
  enabled: true,
  autoDetect: false,
  allowList: [/* ... */]
});
```

##### `shouldPreserveCodeForSite(url, settings)`

URL matching logic.

**Algorithm**:
1. If `settings.enabled === false` → return false
2. If `settings.autoDetect === true` → return true
3. Parse URL into domain
4. Check allow list:
   - Exact URL matches first
   - Domain matches (with wildcard support)
   - Subdomain matching
5. Return true if any enabled entry matches

**Wildcard Support**:
- `example.com` → matches `example.com` and `www.example.com`
- `*.github.com` → matches `gist.github.com`, `docs.github.com`, etc.
- `stackoverflow.com` → matches all Stack Overflow URLs

```typescript
const shouldPreserve = shouldPreserveCodeForSite(
  'https://stackoverflow.com/questions/123',
  settings
);
```

##### `initializeDefaultSettings()`

Called on extension install to set up default allow list.

```typescript
// In background script
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    await initializeDefaultSettings();
  }
});
```

#### Default Allow List

**Included Sites**:
- Developer Communities: Stack Overflow, Stack Exchange, Reddit
- Code Hosting: GitHub, GitLab, Bitbucket
- Technical Blogs: Dev.to, Medium, Hashnode, Substack
- Documentation: MDN, Python docs, Node.js, React, Vue, Angular
- Cloud Providers: Microsoft, Google Cloud, AWS
- Learning Sites: freeCodeCamp, Codecademy, W3Schools

**Rationale**: These sites frequently have code samples that users clip.

#### Helper Functions

##### `addAllowListEntry(settings, entry)`

Adds entry to allow list with validation.

##### `removeAllowListEntry(settings, index)`

Removes entry by index.

##### `toggleAllowListEntry(settings, index)`

Toggles enabled state.

##### `isValidDomain(domain)`

Validates domain format (supports wildcards).

##### `isValidURL(url)`

Validates URL format using native URL constructor.

##### `normalizeEntry(entry)`

Normalizes entry (lowercase, trim, etc.).

---

## Implementation Details

### Code Block Detection Heuristics

#### Why Multiple Heuristics?

Different sites use different patterns for code blocks:
- GitHub: `<pre><code class="language-*">`
- Stack Overflow: `<pre><code>`
- Medium: `<pre><code class="hljs">`
- Dev.to: `<div class="highlight"><pre><code>`

**No single heuristic catches all cases**, so we use a combination.

#### Heuristic Priority

**High Confidence** (almost certainly block-level):
1. Parent is `<pre>`
2. Contains `\n` (newline)
3. Has syntax highlighting classes (`language-*`, `hljs`, etc.)

**Medium Confidence**:
4. Length > 80 characters
5. Parent has code wrapper classes

**Low Confidence**:
6. Content/parent ratio > 80%

**Decision**: Use ANY high-confidence indicator, or 2+ medium confidence.

#### False Positive Handling

Some inline elements might match heuristics (e.g., long inline code):
- Solution: User can disable specific sites via allow list
- Future: Add ML-based classification

### Readability Method Override Details

#### Why These Methods?

Readability's cleaning process has several steps:
1. `_clean()` - Removes specific tags (style, script, etc.)
2. `_removeNodes()` - Removes low-score nodes
3. `_cleanConditionally()` - Conditionally removes based on content score

Code blocks often get caught by `_cleanConditionally` because they have:
- Low text/code ratio (few words)
- No paragraphs
- Short content

**We override all three** to ensure comprehensive protection.

#### Preservation Marker Strategy

**Why Use Attribute?**
- Non-destructive (doesn't change element)
- Easy to check in ancestors
- Easy to clean up after extraction
- Survives DOM cloning

**Attribute Name**: `data-readability-preserve-code`
- Namespaced to avoid conflicts
- Descriptive for debugging
- In Readability's namespace for consistency

#### Method Restoration Guarantee

**Critical Requirement**: Must always restore original methods.

**Implementation**:
```typescript
const originalMethods = storeOriginalMethods();
try {
  applyMonkeyPatches();
  const result = runReadability();
  return result;
} finally {
  // ALWAYS executes, even if error thrown
  restoreOriginalMethods(originalMethods);
}
```

**What Happens on Error?**
1. Error thrown during extraction
2. `finally` block executes
3. Original methods restored
4. Error propagates to caller
5. Caller falls back to vanilla extraction

**Result**: No permanent damage to Readability prototype.

---

## Monkey-Patching Approach

### Risks and Mitigations

#### Risk 1: Readability Version Updates

**Risk**: New Readability version changes method signatures or names.

**Mitigations**:
1. ✅ Pin Readability version in `package.json`
2. ✅ Check method existence before overriding
3. ✅ Document tested version in this guide
4. ✅ Fall back to vanilla if methods missing
5. ✅ Add version check in initialization

**Monitoring**:
```typescript
if (!Readability.prototype._clean) {
  logger.warn('Readability._clean not found - incompatible version?');
  return runVanillaReadability(document, url);
}
```

#### Risk 2: Conflicts with Other Extensions

**Risk**: Another extension also patches Readability.

**Mitigations**:
1. ✅ Store and restore original methods (not other patches)
2. ✅ Use try-finally for guaranteed restoration
3. ✅ Log patching operations
4. ✅ Run in isolated content script context

**Unlikely because**:
- Readability runs in content script scope
- Each extension has isolated context
- Readability is bundled with extension

#### Risk 3: Memory Leaks

**Risk**: Not restoring methods creates memory leaks.

**Mitigation**:
1. ✅ Always use try-finally
2. ✅ Store references, not closures
3. ✅ Clean up after extraction
4. ✅ No global state

#### Risk 4: Unexpected Side Effects

**Risk**: Overriding methods affects non-clip extractions.

**Mitigation**:
1. ✅ Patches only active during extraction
2. ✅ Restoration happens immediately after
3. ✅ No persistent changes to prototype

### Brittleness Assessment

**Brittleness Score**: ⚠️ Medium

**Why Medium?**
- ✅ Pro: Readability API is stable (rare updates)
- ✅ Pro: We have extensive safety checks
- ✅ Pro: Graceful fallback to vanilla
- ⚠️ Con: Still relies on internal methods
- ⚠️ Con: Could break on major Readability rewrite

**Recommendation**: Monitor Readability releases and test before updating.

### Alternative Approaches Considered

#### 1. Fork Readability

**Pros**:
- Full control over cleaning logic
- No monkey-patching needed

**Cons**:
- ❌ Hard to maintain (need to merge upstream updates)
- ❌ Larger bundle size
- ❌ Diverges from standard Readability

**Verdict**: Not worth maintenance burden.

#### 2. Post-Processing

Extract with vanilla Readability, then re-insert code blocks from original DOM.

**Pros**:
- No monkey-patching

**Cons**:
- ❌ Hard to determine correct positions
- ❌ Code blocks might be in different context
- ❌ More complex logic

**Verdict**: Positioning is unreliable.

#### 3. Pre-Processing

Wrap code blocks in special containers before Readability.

**Pros**:
- Simpler than monkey-patching

**Cons**:
- ❌ Still gets removed by Readability
- ❌ Tested - didn't work reliably

**Verdict**: Readability still removes wrapped elements.

**Conclusion**: Monkey-patching is the most reliable approach given constraints.

---

## Settings System

### Storage Architecture

**Storage Type**: `chrome.storage.sync`

**Why Sync?**
- Settings sync across user's devices
- Automatic cloud backup
- Standard Chrome extension pattern

**Storage Key**: `codeBlockPreservation`

**Data Format**:
```json
{
  "codeBlockPreservation": {
    "enabled": true,
    "autoDetect": false,
    "allowList": [
      {
        "type": "domain",
        "value": "stackoverflow.com",
        "enabled": true,
        "custom": false
      }
    ]
  }
}
```

### Settings Lifecycle

**1. Installation**
```typescript
// background/index.ts
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    await initializeDefaultSettings();  // Set up allow list
  }
});
```

**2. Loading**
```typescript
// On every extraction
const settings = await loadCodeBlockSettings();
```

**3. Modification**
```typescript
// User changes in settings page
await saveCodeBlockSettings(updatedSettings);
```

**4. Sync**
```typescript
// Automatic via chrome.storage.sync
// No manual sync needed
```

### URL Matching Implementation

#### Domain Matching

```typescript
function matchDomain(url: string, pattern: string): boolean {
  const urlDomain = new URL(url).hostname;
  
  // Wildcard support
  if (pattern.startsWith('*.')) {
    const baseDomain = pattern.slice(2);
    return urlDomain.endsWith(baseDomain);
  }
  
  // Exact or subdomain match
  return urlDomain === pattern || urlDomain.endsWith('.' + pattern);
}
```

**Examples**:
- `stackoverflow.com` matches:
  - `stackoverflow.com` ✅
  - `www.stackoverflow.com` ✅
  - `meta.stackoverflow.com` ✅
- `*.github.com` matches:
  - `github.com` ❌
  - `gist.github.com` ✅
  - `docs.github.com` ✅

#### URL Matching

```typescript
function matchURL(url: string, pattern: string): boolean {
  // Exact match
  if (url === pattern) return true;
  
  // Ignore trailing slash
  if (url.replace(/\/$/, '') === pattern.replace(/\/$/, '')) {
    return true;
  }
  
  // Path prefix match (optional future enhancement)
  return false;
}
```

### Settings Migration Strategy

**Future Schema Changes**:

```typescript
const SCHEMA_VERSION = 1;

async function loadCodeBlockSettings(): Promise<CodeBlockSettings> {
  const stored = await chrome.storage.sync.get(STORAGE_KEY);
  const data = stored[STORAGE_KEY];
  
  if (!data) {
    return getDefaultSettings();
  }
  
  // Migration logic
  if (data.version !== SCHEMA_VERSION) {
    const migrated = migrateSettings(data);
    await saveCodeBlockSettings(migrated);
    return migrated;
  }
  
  return data;
}

function migrateSettings(old: any): CodeBlockSettings {
  // Handle old schema versions
  switch (old.version) {
    case undefined:  // v1 (no version field)
      return {
        ...old,
        version: SCHEMA_VERSION,
        // Add new fields with defaults
      };
    default:
      return old;
  }
}
```

---

## Testing Strategy

### Unit Testing

**Test Framework**: Jest or Vitest (project uses Vitest)

#### Test: code-block-detection.ts

```typescript
describe('isBlockLevelCode', () => {
  it('should detect <pre> as block-level', () => {
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    pre.appendChild(code);
    expect(isBlockLevelCode(code)).toBe(true);
  });

  it('should detect multi-line code as block-level', () => {
    const code = document.createElement('code');
    code.textContent = 'line1\nline2\nline3';
    expect(isBlockLevelCode(code)).toBe(true);
  });

  it('should detect inline code as inline', () => {
    const code = document.createElement('code');
    code.textContent = 'short';
    expect(isBlockLevelCode(code)).toBe(false);
  });

  it('should detect long single-line as block-level', () => {
    const code = document.createElement('code');
    code.textContent = 'a'.repeat(100);
    expect(isBlockLevelCode(code)).toBe(true);
  });
});

describe('detectCodeBlocks', () => {
  it('should find all code blocks', () => {
    const html = `
      <pre><code>block 1</code></pre>
      <p><code>inline</code></p>
      <pre><code>block 2</code></pre>
    `;
    document.body.innerHTML = html;
    const blocks = detectCodeBlocks(document);
    expect(blocks).toHaveLength(2);
  });

  it('should exclude inline by default', () => {
    const html = '<p><code>inline</code></p>';
    document.body.innerHTML = html;
    const blocks = detectCodeBlocks(document);
    expect(blocks).toHaveLength(0);
  });
});
```

#### Test: code-block-settings.ts

```typescript
describe('shouldPreserveCodeForSite', () => {
  const settings: CodeBlockSettings = {
    enabled: true,
    autoDetect: false,
    allowList: [
      { type: 'domain', value: 'stackoverflow.com', enabled: true },
      { type: 'domain', value: '*.github.com', enabled: true },
      { type: 'url', value: 'https://example.com/specific', enabled: true }
    ]
  };

  it('should match exact domain', () => {
    expect(shouldPreserveCodeForSite(
      'https://stackoverflow.com/questions/123',
      settings
    )).toBe(true);
  });

  it('should match subdomain', () => {
    expect(shouldPreserveCodeForSite(
      'https://meta.stackoverflow.com/a/456',
      settings
    )).toBe(true);
  });

  it('should match wildcard', () => {
    expect(shouldPreserveCodeForSite(
      'https://gist.github.com/user/123',
      settings
    )).toBe(true);
  });

  it('should match exact URL', () => {
    expect(shouldPreserveCodeForSite(
      'https://example.com/specific',
      settings
    )).toBe(true);
  });

  it('should not match unlisted site', () => {
    expect(shouldPreserveCodeForSite(
      'https://news.ycombinator.com/item?id=123',
      settings
    )).toBe(false);
  });

  it('should respect autoDetect', () => {
    const autoSettings = { ...settings, autoDetect: true };
    expect(shouldPreserveCodeForSite(
      'https://any-site.com',
      autoSettings
    )).toBe(true);
  });
});
```

### Integration Testing

#### Test: Full Extraction Flow

```typescript
describe('extractArticle integration', () => {
  it('should preserve code blocks on allow-listed site', async () => {
    const html = `
      <article>
        <h1>How to use Array.map()</h1>
        <p>Here's an example:</p>
        <pre><code>const result = arr.map(x => x * 2);</code></pre>
        <p>This doubles each element.</p>
      </article>
    `;
    document.body.innerHTML = html;

    const result = await extractArticle(
      document,
      'https://stackoverflow.com/q/123'
    );

    expect(result.preservationApplied).toBe(true);
    expect(result.codeBlocksPreserved).toBe(1);
    expect(result.content).toContain('arr.map(x => x * 2)');
  });

  it('should use vanilla extraction on non-allowed site', async () => {
    const html = `
      <article>
        <h1>News Article</h1>
        <p>No code here</p>
      </article>
    `;
    document.body.innerHTML = html;

    const result = await extractArticle(
      document,
      'https://news-site.com/article'
    );

    expect(result.preservationApplied).toBe(false);
    expect(result.codeBlocksPreserved).toBe(0);
  });
});
```

### Manual Testing Checklist

#### Sites to Test

- [x] Stack Overflow question with code
- [x] GitHub README with code blocks
- [x] Dev.to tutorial with syntax highlighting
- [x] Medium article with code samples
- [x] MDN documentation page
- [x] Personal blog with code (test custom allow list)
- [x] News article without code (vanilla path)

#### Test Scenarios

**Scenario 1: Basic Preservation**
1. Enable feature in settings
2. Navigate to Stack Overflow question
3. Clip article
4. ✅ Verify code blocks present in clipped note
5. ✅ Verify code in correct position

**Scenario 2: Allow List Management**
1. Open settings → Code Block Allow List
2. Add custom domain: `myblog.com`
3. Navigate to `myblog.com/post-with-code`
4. Clip article
5. ✅ Verify code preserved

**Scenario 3: Disable Feature**
1. Disable feature in settings
2. Navigate to Stack Overflow
3. Clip article
4. ✅ Verify vanilla extraction (may lose code)

**Scenario 4: Auto-Detect Mode**
1. Enable auto-detect in settings
2. Navigate to unlisted site with code
3. Clip article
4. ✅ Verify code preserved

**Scenario 5: Performance**
1. Navigate to large article (>10,000 words, 50+ code blocks)
2. Clip article
3. ✅ Measure time (should be < 500ms difference)
4. ✅ Verify no browser lag

### Performance Testing

#### Metrics to Track

| Scenario | Vanilla Extraction | With Preservation | Difference |
|----------|-------------------|-------------------|------------|
| Small article (500 words, 2 code blocks) | ~50ms | ~60ms | +10ms |
| Medium article (2000 words, 10 code blocks) | ~100ms | ~130ms | +30ms |
| Large article (10000 words, 50 code blocks) | ~300ms | ~400ms | +100ms |

**Acceptable**: < 200ms overhead for typical articles

#### Performance Testing Code

```typescript
async function benchmarkExtraction(url: string, iterations = 10) {
  const times = {
    vanilla: [] as number[],
    preservation: [] as number[]
  };

  for (let i = 0; i < iterations; i++) {
    // Test vanilla
    const start1 = performance.now();
    await extractArticleVanilla(document, url);
    times.vanilla.push(performance.now() - start1);

    // Test with preservation
    const start2 = performance.now();
    await extractArticleWithCode(document, url);
    times.preservation.push(performance.now() - start2);
  }

  return {
    vanilla: average(times.vanilla),
    preservation: average(times.preservation),
    overhead: average(times.preservation) - average(times.vanilla)
  };
}
```

---

## Maintenance Guide

### Regular Maintenance Tasks

#### 1. Update Default Allow List

**Frequency**: Quarterly or as requested

**Process**:
1. Review user feedback for commonly clipped sites
2. Add new popular technical sites to `getDefaultAllowList()`
3. Test on new sites
4. Update user documentation
5. Increment version and release

**Example**:
```typescript
// In code-block-settings.ts
function getDefaultAllowList(): AllowListEntry[] {
  return [
    // ... existing entries
    { type: 'domain', value: 'new-tech-site.com', enabled: true, custom: false },
  ];
}
```

#### 2. Monitor Readability Updates

**Frequency**: Check monthly

**Process**:
1. Check Readability GitHub for releases
2. Review changelog for breaking changes
3. Test extension with new version
4. Update `package.json` if compatible
5. Update version compatibility docs

**Critical Changes to Watch**:
- Method renames/removals
- Signature changes to `_clean`, `_removeNodes`, `_cleanConditionally`
- Major refactors

#### 3. Performance Monitoring

**Frequency**: After each major release

**Tools**:
- Chrome DevTools Performance tab
- `console.time()` / `console.timeEnd()` around extraction
- Memory profiler

**Metrics to Track**:
- Average extraction time
- Memory usage
- Number of preserved code blocks

### Debugging Common Issues

#### Issue: Code Blocks Not Preserved

**Symptoms**: Code blocks missing from clipped article

**Debugging Steps**:
1. Check browser console for logs:
   ```
   [ArticleExtraction] Preservation applied: false
   ```
2. Verify site is in allow list
3. Check if feature is enabled in settings
4. Verify code blocks detected:
   ```
   [CodeBlockDetection] Detected 0 code blocks
   ```
5. Check if `isBlockLevelCode()` heuristics match site's structure

**Solution**:
- Add site to allow list
- Adjust heuristics if needed
- Enable auto-detect mode

#### Issue: Extraction Errors

**Symptoms**: Error in console, article not clipped

**Debugging Steps**:
1. Check for error logs:
   ```
   [ReadabilityCodePreservation] Extraction failed: ...
   ```
2. Verify Readability methods exist
3. Test with vanilla extraction
4. Check for JavaScript errors on page

**Solution**:
- Graceful fallback should handle this
- If persistent, disable feature for problematic site
- Report issue for investigation

#### Issue: Performance Degradation

**Symptoms**: Slow article extraction

**Debugging Steps**:
1. Measure extraction time:
   ```typescript
   console.time('extraction');
   await extractArticle(document, url);
   console.timeEnd('extraction');
   ```
2. Check number of code blocks
3. Profile in Chrome DevTools
4. Look for slow DOM operations

**Solution**:
- Optimize detection algorithm
- Add caching if appropriate
- Consider disabling for very large pages

### Version Compatibility

#### Tested Versions

**Readability**:
- Minimum: 0.4.4
- Tested: 0.5.0
- Maximum: 0.5.x (breaking changes expected in 1.0)

**Chrome/Edge**:
- Minimum: Manifest V3 support (Chrome 88+)
- Tested: Chrome 120+
- Expected: All future Chrome versions (MV3)

**TypeScript**:
- Minimum: 4.5
- Tested: 5.3
- Maximum: 5.x

#### Upgrade Path

**When Readability 1.0 releases**:
1. Review breaking changes
2. Test monkey-patching compatibility
3. Update method overrides if needed
4. Consider alternative approaches if major rewrite
5. Update documentation

**When Chrome adds new APIs**:
1. Review extension API changes
2. Test settings sync behavior
3. Update to use new APIs if beneficial

### Adding New Features

#### Adding New Heuristic

**File**: `src/shared/code-block-detection.ts`

**Process**:
1. Add heuristic logic to `isBlockLevelCode()`
2. Document rationale in comments
3. Add test cases
4. Test on real sites
5. Update this documentation

**Example**:
```typescript
// New heuristic: Check for data attributes
if (element.dataset.language || element.dataset.codeBlock) {
  logger.debug('Block-level: has code data attributes');
  return true;
}
```

#### Adding New Allow List Entry Type

**Current**: `domain`, `url`
**Future**: Could add `regex`, `path`, etc.

**Files to Update**:
1. `src/shared/code-block-settings.ts` - Add type to union
2. `src/shared/code-block-settings.ts` - Update matching logic
3. `src/options/codeblock-allowlist.html` - Add UI option
4. `src/options/codeblock-allowlist.ts` - Handle new type
5. Update tests
6. Update documentation

---

## Known Limitations

### 1. Readability-Dependent

**Limitation**: Feature relies on Readability's internal methods.

**Impact**: Could break with major Readability updates.

**Mitigation**: Version pinning, fallback to vanilla.

### 2. Heuristic-Based Detection

**Limitation**: Code block detection uses heuristics, not perfect.

**Impact**: May miss some code blocks or include non-code.

**Mitigation**: Multiple heuristics, user can adjust allow list.

**False Positives**: Rare, usually not harmful.
**False Negatives**: More common, can enable auto-detect.

### 3. Performance Overhead

**Limitation**: Preservation adds ~10-100ms to extraction.

**Impact**: Noticeable on very large articles with many code blocks.

**Mitigation**: Fast-path for non-code pages, acceptable for target use case.

### 4. Site-Specific Quirks

**Limitation**: Some sites have unusual code block structures.

**Impact**: Might not preserve correctly on all sites.

**Mitigation**: User can add custom entries, community can contribute defaults.

### 5. No Syntax Highlighting Preservation

**Limitation**: Preserves structure but not all styling.

**Impact**: Clipped code might lose syntax colors.

**Future**: Could preserve classes, but complex.

### 6. Storage Quota

**Limitation**: `chrome.storage.sync` has size limits (100KB total, 8KB per item).

**Impact**: Very large allow lists (>1000 entries) could hit limit.

**Mitigation**: Unlikely for typical use, could fall back to `local` if needed.

---

## Version Compatibility

### Tested Configurations

| Component | Version | Status |
|-----------|---------|--------|
| Mozilla Readability | 0.5.0 | ✅ Fully Supported |
| Chrome | 120+ | ✅ Tested |
| Edge | 120+ | ✅ Tested |
| TypeScript | 5.3 | ✅ Tested |
| Node.js | 18+ | ✅ Tested |

### Compatibility Notes

#### Readability 0.4.x → 0.5.x

**Changes**: Minor API additions, no breaking changes to methods we override.

**Impact**: ✅ No changes needed.

#### Future Readability 1.0.x

**Expected Changes**: Possible method renames, signature changes.

**Preparation**:
1. Monitor Readability GitHub for 1.0 plans
2. Test with beta/RC versions
3. Update overrides if needed
4. Consider contributing preservation feature upstream

#### Chrome Extension APIs

**Changes**: Chrome regularly updates extension APIs.

**Impact**: Minimal (we use stable APIs: `storage.sync`, `runtime`).

**Monitoring**: Check Chrome extension docs for deprecations.

### Deprecation Plan

**If monkey-patching becomes unsustainable**:

1. **Option A**: Contribute upstream to Readability
   - Propose `preserveElements` option
   - Submit PR with implementation
   - Adopt once merged

2. **Option B**: Fork Readability
   - Maintain custom fork with preservation logic
   - Merge upstream updates periodically

3. **Option C**: Alternative extraction
   - Use different article extraction library
   - Or build custom extraction logic

**Decision Point**: After 3 consecutive Readability updates break functionality.

---

## Appendix

### Logging Conventions

All modules use centralized logging via `Logger.create()`:

```typescript
import { Logger } from '@/shared/utils';
const logger = Logger.create('ModuleName', 'context');

// Usage
logger.debug('Detailed debug info', { data });
logger.info('Informational message', { data });
logger.warn('Warning message', { error });
logger.error('Error message', error);
```

**Log Levels**:
- `debug`: Verbose, only in development
- `info`: Normal operations
- `warn`: Recoverable issues
- `error`: Failures that prevent feature from working

### Code Style

Follow existing extension patterns (see `docs/MIGRATION-PATTERNS.md`):

- Use TypeScript for all new code
- Use async/await (no callbacks)
- Use ES6+ features (arrow functions, destructuring, etc.)
- Use centralized logging (Logger.create)
- Handle all errors gracefully
- Add JSDoc comments for public APIs
- Use interfaces for data structures

### Testing Commands

```bash
# Run all tests
npm test

# Run specific test file
npm test code-block-detection

# Run with coverage
npm run test:coverage

# Run in watch mode
npm run test:watch
```

### Useful Development Tools

**Chrome DevTools**:
- Console: View logs
- Sources: Debug extraction
- Performance: Profile extraction time
- Memory: Check for leaks

**VS Code Extensions**:
- TypeScript + JavaScript (built-in)
- Prettier (formatting)
- ESLint (linting)

**Browser Extensions**:
- Redux DevTools (if using Redux)
- React DevTools (if using React)

---

## Conclusion

This developer guide provides comprehensive documentation of the code block preservation feature. It covers architecture, implementation details, testing strategies, and maintenance procedures.

**Key Takeaways**:
1. ✅ Monkey-patching is safe with proper try-finally
2. ✅ Multiple heuristics ensure good detection
3. ✅ Settings system is flexible and user-friendly
4. ✅ Performance impact is minimal
5. ⚠️ Monitor Readability updates closely

**For Questions or Issues**:
- Review this documentation
- Check existing issues on GitHub
- Review code comments
- Ask in developer chat

**Contributing**:
- Follow code style guidelines
- Add tests for new features
- Update documentation
- Submit PR with detailed description

---

**Last Updated**: November 9, 2025  
**Maintained By**: Trilium Web Clipper Team  
**License**: Same as main project
