# Architecture Overview - Trilium Web Clipper MV3

## System Components

### Core Systems (Already Implemented)

#### 1. Centralized Logging System
**Location**: `src/shared/utils.ts`

The extension uses a centralized logging system that aggregates logs from all contexts (background, content, popup, options).

**Key Features**:
- Persistent storage in Chrome local storage
- Maintains up to 1,000 log entries
- Survives service worker restarts
- Unified viewer at `src/logs/`

**Usage Pattern**:
```typescript
import { Logger } from '@/shared/utils';
const logger = Logger.create('ComponentName', 'background'); // or 'content', 'popup', 'options'

logger.debug('Debug info', { data });
logger.info('Operation completed');
logger.warn('Potential issue');
logger.error('Error occurred', error);
```

**Why It Matters**: MV3 service workers terminate frequently, so console.log doesn't persist. This system ensures all debugging info is available in one place.

#### 2. Comprehensive Theme System
**Location**: `src/shared/theme.ts` + `src/shared/theme.css`

Professional light/dark/system theme system with full persistence.

**Features**:
- Three modes: Light, Dark, System (follows OS)
- Persists via `chrome.storage.sync`
- CSS custom properties for all colors
- Real-time updates on OS theme change

**Usage Pattern**:
```typescript
import { ThemeManager } from '@/shared/theme';

// Initialize (call once per context)
await ThemeManager.initialize();

// Toggle: System → Light → Dark → System
await ThemeManager.toggleTheme();

// Get current config
const config = await ThemeManager.getThemeConfig();
```

**CSS Integration**:
```css
@import url('../shared/theme.css');

.my-component {
  background: var(--color-surface);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border);
}
```

**Available CSS Variables**:
- `--color-text-primary`, `--color-text-secondary`, `--color-text-muted`
- `--color-surface`, `--color-surface-elevated`
- `--color-border`, `--color-border-subtle`
- `--color-primary`, `--color-primary-hover`
- `--color-success`, `--color-error`, `--color-warning`

#### 3. Content Processing Pipeline

The extension processes web content through a three-phase pipeline:

```
Raw HTML from page
    ↓
Phase 1: Readability
    - Extracts article content
    - Removes ads, navigation, footers
    - Identifies main content area
    ↓
Phase 2: DOMPurify
    - Security sanitization
    - Removes dangerous elements/attributes
    - XSS protection
    ↓
Phase 3: Cheerio
    - Final cleanup and polish
    - Fixes relative URLs
    - Removes empty elements
    ↓
Clean HTML → Trilium
```

**Libraries Used**:
- `@mozilla/readability` - Content extraction
- `dompurify` + `jsdom` - Security sanitization
- `cheerio` - HTML manipulation

## File Structure

```
src/
├── background/
│   └── index.ts              # Service worker (event-driven)
├── content/
│   ├── index.ts              # Content script entry
│   ├── screenshot.ts         # Screenshot selection UI
│   └── toast.ts              # In-page notifications
├── popup/
│   ├── index.ts              # Popup logic
│   ├── popup.html            # Popup UI
│   └── popup.css             # Popup styles
├── options/
│   ├── index.ts              # Settings logic
│   ├── options.html          # Settings UI
│   └── options.css           # Settings styles
├── logs/
│   ├── logs.ts               # Log viewer logic
│   ├── logs.html             # Log viewer UI
│   └── logs.css              # Log viewer styles
└── shared/
    ├── utils.ts              # Logger + utilities
    ├── theme.ts              # Theme management
    ├── theme.css             # CSS variables
    └── types.ts              # TypeScript definitions
```

## Message Flow

```
┌─────────────────┐
│  Content Script │
│   (Tab context) │
└────────┬────────┘
         │ chrome.runtime.sendMessage()
         ↓
┌─────────────────┐
│ Service Worker  │
│  (Background)   │
└────────┬────────┘
         │ Fetch API
         ↓
┌─────────────────┐
│ Trilium Server  │
│  or Desktop App │
└─────────────────┘
```

**Key Points**:
- Content scripts can access DOM but not Trilium API
- Service worker handles all network requests
- Messages must be serializable (no functions/DOM nodes)
- Always return `true` in listener for async `sendResponse`

## Storage Strategy

### chrome.storage.local
Used for:
- Extension state and data
- Centralized logs
- Connection settings
- Cached data

```typescript
await chrome.storage.local.set({ key: value });
const { key } = await chrome.storage.local.get(['key']);
```

### chrome.storage.sync
Used for:
- User preferences (theme, save format)
- Settings that should sync across devices
- Limited to 8KB per item, 100KB total

```typescript
await chrome.storage.sync.set({ preference: value });
```

### Never Use localStorage
Not available in service workers and will cause errors.

## Build System

**Tool**: esbuild via `build.mjs`  
**Output Format**: IIFE (Immediately Invoked Function Expression)  
**TypeScript**: Compiled to ES2020

### Build Process:
1. TypeScript files compiled to JavaScript
2. Bundled with esbuild (no code splitting in IIFE)
3. HTML files transformed (script refs updated)
4. CSS and assets copied to dist/
5. manifest.json validated and copied

### Development vs Production:
- **Development** (`npm run dev`): Source maps, watch mode, fast rebuilds
- **Production** (`npm run build`): Minification, optimization, no source maps

## Security Model

### Content Security Policy
- No inline scripts or `eval()`
- No remote script loading (except CDNs in manifest)
- All code must be bundled in extension

### Input Sanitization
- All user input passed through DOMPurify
- HTML content sanitized before display
- URL validation for Trilium connections

### Permissions
Requested only as needed:
- `storage` - For chrome.storage API
- `activeTab` - Current tab access
- `scripting` - Inject content scripts
- `contextMenus` - Right-click menu items
- `tabs` - Tab information
- Host permissions - Trilium server URLs

## MV3 Constraints

### Service Worker Lifecycle
- Terminates after 30 seconds of inactivity
- State must be persisted, not kept in memory
- Use `chrome.alarms` for scheduled tasks

### No Blocking APIs
- Cannot use synchronous XMLHttpRequest
- Cannot block webRequest
- Must use async/await patterns

### Content Script Injection
- Must declare in manifest OR inject programmatically
- Cannot execute code strings (must be files)

### Resource Access
- Content scripts can't directly access extension pages
- Must use `chrome.runtime.getURL()` for resources

---

**When developing**: Reference this doc for system design questions. Don't re-explain these systems in every task—just use them correctly.