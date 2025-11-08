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
| Date metadata extraction | ❌ | Not implemented | - |
| Codeblock formatting preservation | ❌ | See Trilium Issue [#2092](https://github.com/TriliumNext/Trilium/issues/2092) | - |

---

## UI Features

| Feature | Status | Notes | Priority |
|---------|--------|-------|----------|
| Popup interface | ✅ | With theme support | - |
| Settings page | ✅ | Connection config | - |
| Logs viewer | ✅ | Filter/search/export | - |
| Context menus | ✅ | All save types including cropped/full screenshot | - |
| Keyboard shortcuts | ✅ | Save (Ctrl+Shift+S), Screenshot (Ctrl+Shift+E) | - |
| Toast notifications | ⚠️ | Basic only | LOW |
| Already visited banner | ❌ | Backend exists, UI doesn't use | MED |
| Screenshot selection UI | ✅ | Drag-to-select with ESC cancel | - |

### Priority Issues:

#### 1. Already Visited Detection (MED)
**Problem**: Popup doesn't show if page was already clipped.

**MV2 Implementation**: `apps/web-clipper/popup/popup.js` (checks on open)

**What's Needed**:
- Call `checkForExistingNote()` when popup opens
- Show banner with link to existing note
- Allow user to still save (update or new note)

**Files to Modify**:
- `src/popup/index.ts`

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
| Date metadata | ❌ | publishedDate, modifiedDate | LOW |
| Interactive toasts | ⚠️ | No "Open in Trilium" button | LOW |
| Save tabs feature | ✅ | Bulk save all tabs as note with links | - |
| Meta Note Popup option | ❌ | See Trilium Issue [#5350](https://github.com/TriliumNext/Trilium/issues/5350) | MED |
| Add custom keyboard shortcuts | ❌ | See Trilium Issue [#5349](https://github.com/TriliumNext/Trilium/issues/5349) | LOW |
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

### Phase 4: Quality of Life (PLANNED)
- [ ] Implement "save tabs" feature
- [ ] Add "already visited" detection to popup
- [ ] Add custom note text for links
- [ ] Extract date metadata from pages
- [ ] Add interactive toast buttons
- [ ] Add meta note popup option (see Trilium Issue [#5350](https://github.com/TriliumNext/Trilium/issues/5350))
- [ ] Add custom keyboard shortcuts (see Trilium Issue [#5349](https://github.com/TriliumNext/Trilium/issues/5349))
- [ ] Handle Firefox keyboard shortcut bug (see Trilium Issue [#5226](https://github.com/TriliumNext/Trilium/issues/5226))

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
1. **No "already visited" indicator** - Backend function exists but unused

### Nice to Have
2. **No date metadata extraction** - Loses temporal context
3. **Basic toast notifications** - No interactive buttons

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