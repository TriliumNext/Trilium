# Feature Parity Checklist - MV2 to MV3 Migration

**Last Updated**: November 8, 2025  
**Current Phase**: Quality of Life Features

---

## Status Legend
- ✅ **Complete** - Fully implemented and tested
- 🚧 **In Progress** - Currently being worked on
- ⚠️ **Partial** - Working but missing features
- ❌ **Missing** - Not yet implemented
- ❓ **Unknown** - Needs verification

---

## Core Capture Features

| Feature | Status | Notes | Priority |
|---------|--------|-------|----------|
| Save Selection | ✅ | Working with image processing | - |
| Save Full Page | ✅ | Readability + DOMPurify + Cheerio | - |
| Save Link | ✅ | Full implementation with custom notes | - |
| Save Screenshot (Full) | ✅ | Captures visible viewport | - |
| Save Screenshot (Cropped) | ✅ | With zoom adjustment & validation | - |
| Save Image | ✅ | Downloads and embeds | - |
| Save Tabs (Bulk) | ✅ | Saves all tabs in current window as list of links | - |

---

## Content Processing

| Feature | Status | Notes | Files |
|---------|--------|-------|-------|
| Readability extraction | ✅ | Working | `background/index.ts:608-630` |
| DOMPurify sanitization | ✅ | Working | `background/index.ts:631-653` |
| Cheerio cleanup | ✅ | Working | `background/index.ts:654-666` |
| Image downloading | ✅ | All capture types | `background/index.ts:832-930` |
| Screenshot cropping | ✅ | Implemented with offscreen document | `background/index.ts:536-668`, `offscreen/offscreen.ts` |
| Date metadata extraction | ✅ | Fully implemented with customizable formats | `shared/date-formatter.ts`, `content/index.ts:313-328`, `options/` |
| Codeblock formatting preservation | ✅ | Preserves code blocks through Readability + enhanced Turndown rules | `content/index.ts:506-648`, `background/index.ts:1512-1590` |

---

## UI Features

| Feature | Status | Notes | Priority |
|---------|--------|-------|----------|
| Popup interface | ✅ | With theme support | - |
| Settings page | ✅ | Connection config | - |
| Logs viewer | ✅ | Filter/search/export | - |
| Context menus | ✅ | All save types including cropped/full screenshot | - |
| Keyboard shortcuts | ✅ | Save (Ctrl+Shift+S), Screenshot (Ctrl+Shift+E) | - |
| Toast notifications | ✅ | Interactive with "Open in Trilium" button | - |
| Already visited banner | ✅ | Shows when page was previously clipped | - |
| Screenshot selection UI | ✅ | Drag-to-select with ESC cancel | - |

### Priority Issues:

_(No priority issues remaining in this category)_

---

## Save Format Options

| Format | Status | Notes |
|--------|--------|-------|
| HTML | ✅ | Rich formatting preserved |
| Markdown | ✅ | AI/LLM-friendly |
| Both (parent/child) | ✅ | HTML parent + MD child |

---

## Trilium Integration

| Feature | Status | Notes |
|---------|--------|-------|
| HTTP/HTTPS connection | ✅ | Working |
| Desktop app mode | ✅ | Working |
| Connection testing | ✅ | Working |
| Auto-reconnect | ✅ | Working |
| Duplicate detection | ✅ | User choice dialog |
| Parent note selection | ✅ | Working |
| Note attributes | ✅ | Labels and relations |

---

## Quality of Life Features

| Feature | Status | Notes | Priority |
|---------|--------|-------|----------|
| Link with custom note | ✅ | Full UI with title parsing | - |
| Date metadata | ✅ | publishedDate, modifiedDate with customizable formats | - |
| Interactive toasts | ✅ | With "Open in Trilium" button when noteId provided | - |
| Save tabs feature | ✅ | Bulk save all tabs as note with links | - |
| Meta Note Popup option | ✅ | Prompt to add personal note about why clip is interesting | - |
| Add custom keyboard shortcuts | ✅ | Implemented in options UI, uses chrome.commands.update | LOW |
| Handle Firefox Keyboard Shortcut Bug | ❌ | See Trilium Issue [#5226](https://github.com/TriliumNext/Trilium/issues/5226) | LOW |

---

## Current Development Phase

### Phase 1: Core Functionality ✅ COMPLETE
- [x] Build system working
- [x] Content script injection
- [x] Basic save operations
- [x] Settings and logs UI
- [x] Theme system
- [x] Centralized logging

### Phase 2: Screenshot Features ✅ COMPLETE
- [x] **Task 2.1**: Implement screenshot cropping with offscreen document
- [x] **Task 2.2**: Add separate UI for cropped vs full screenshots  
- [x] **Task 2.3**: Handle edge cases (small selections, cancellation, zoom)
- [x] **Task 2.4**: Verify screenshot selection UI works correctly

**Implementation Details**:
- Offscreen document for canvas operations: `src/offscreen/offscreen.ts`
- Background service handlers: `src/background/index.ts:536-668`
- Content script UI: `src/content/index.ts:822-967`
- Popup buttons: `src/popup/index.html`, `src/popup/popup.ts`
- Context menus for both cropped and full screenshots
- Keyboard shortcut: Ctrl+Shift+E for cropped screenshot

### Phase 3: Image Processing ✅ COMPLETE
- [x] Apply image processing to full page captures
- [x] Test with various image formats (PNG, JPG, WebP, SVG)
- [x] Handle CORS edge cases
- [x] Performance considerations for image-heavy pages

**Implementation Details**:
- Image processing function: `src/background/index.ts:832-930`
- Called for all capture types (selections, full page, screenshots)
- CORS errors handled gracefully with fallback to Trilium server
- Enhanced logging with success/error counts and rates
- Validates image content types before processing
- Successfully builds without TypeScript errors

### Phase 4: Quality of Life
- [x] Implement "save tabs" feature
- [x] Add custom note text for links
- [x] **Extract date metadata from pages** - Implemented with customizable formats
- [x] **Add "already visited" detection to popup** - Fully implemented
- [x] **Add interactive toast buttons** - "Open in Trilium" button when noteId provided
- [x] **Add "save with custom note" for all save types** - Fully implemented with meta note popup
- [ ] Add robust table handling (nested tables, complex structures, include gridlines in saved notes)
- [x] Add custom keyboard shortcuts (see Trilium Issue [#5349](https://github.com/TriliumNext/Trilium/issues/5349))
- [ ] Handle Firefox keyboard shortcut bug (see Trilium Issue [#5226](https://github.com/TriliumNext/Trilium/issues/5226))

**Date Metadata Implementation** (November 8, 2025):
- Created `src/shared/date-formatter.ts` with comprehensive date extraction and formatting
- Extracts dates from Open Graph meta tags, JSON-LD structured data, and other metadata
- Added settings UI in options page with 11 preset formats and custom format support
- Format cheatsheet with live preview
- Dates formatted per user preference before saving as labels
- Files: `src/shared/date-formatter.ts`, `src/content/index.ts`, `src/options/`

**Already Visited Detection Implementation** (November 8, 2025):
- Feature was already fully implemented in the MV3 extension
- Backend: `checkForExistingNote()` in `src/shared/trilium-server.ts` calls Trilium API
- Popup: Automatically checks when popup opens via `loadCurrentPageInfo()`
- UI: Shows green banner with checkmark and "Open in Trilium" link
- Styling: Theme-aware success colors with proper hover states
- Files: `src/popup/popup.ts:759-862`, `src/popup/index.html:109-117`, `src/popup/popup.css:297-350`

**Save with Custom Note Implementation** (December 14, 2025):
- Feature enables users to add a personal note ("Why is this interesting?") when saving any content type
- Popup UI: Meta note panel with textarea, Save/Skip/Cancel buttons (`src/popup/popup.ts:460-557`, `src/popup/index.html:93-125`)
- Settings: Toggle in options page to enable/disable the prompt (`src/options/index.html:49`, `src/options/options.ts:86-162`)
- All save handlers check `enableMetaNotePrompt` setting and show panel if enabled
- Background service creates child note titled "Why this is interesting" with user's note content
- Supported save types: Selection, Page, Cropped Screenshot, Full Screenshot
- Files: `src/popup/popup.ts`, `src/background/index.ts:1729-1758`, `src/shared/types.ts`

---

## Testing Checklist

### Before Each Session
- [ ] `npm run type-check` passes
- [ ] `npm run dev` running successfully
- [ ] No console errors in service worker
- [ ] No console errors in content script

### Feature Testing
- [ ] Test on regular article pages
- [ ] Test on image-heavy pages
- [ ] Test on dynamic/SPA pages
- [ ] Test on restricted URLs (chrome://)
- [ ] Test with slow network
- [ ] Test with Trilium server down

### Edge Cases
- [ ] Very long pages
- [ ] Pages with many images
- [ ] Pages with embedded media
- [ ] Pages with complex layouts
- [ ] Mobile-responsive pages

---

## Known Issues

### Important (Should fix)

_(No important issues remaining)_

### Nice to Have

_(No nice-to-have issues remaining)_

---

## Quick Reference: Where Features Live

### Capture Handlers
- **Background**: `src/background/index.ts:390-850`
- **Content Script**: `src/content/index.ts:1-200`
- **Screenshot UI**: `src/content/screenshot.ts`

### UI Components
- **Popup**: `src/popup/`
- **Options**: `src/options/`
- **Logs**: `src/logs/`

### Shared Systems
- **Logging**: `src/shared/utils.ts`
- **Theme**: `src/shared/theme.ts` + `src/shared/theme.css`
- **Types**: `src/shared/types.ts`

---

## Migration Reference

When implementing missing features, compare against MV2:

```
apps/web-clipper/
├── background.js       # Service worker logic
├── content.js          # Content script logic
└── popup/
    └── popup.js        # Popup UI logic
```

**Remember**: Reference for functionality, not implementation. Use modern TypeScript patterns.