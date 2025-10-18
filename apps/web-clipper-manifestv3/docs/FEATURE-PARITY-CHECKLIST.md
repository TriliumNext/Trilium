# Feature Parity Checklist - MV2 to MV3 Migration

**Last Updated**: October 18, 2025  
**Current Phase**: Screenshot Features

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
| Save Link | ⚠️ | Basic (URL + title only) | LOW |
| Save Screenshot | ⚠️ | No cropping applied | **HIGH** |
| Save Image | ✅ | Downloads and embeds | - |
| Save Tabs (Bulk) | ❌ | Not implemented | MED |

---

## Content Processing

| Feature | Status | Notes | Files |
|---------|--------|-------|-------|
| Readability extraction | ✅ | Working | `background/index.ts:608-630` |
| DOMPurify sanitization | ✅ | Working | `background/index.ts:631-653` |
| Cheerio cleanup | ✅ | Working | `background/index.ts:654-666` |
| Image downloading | ⚠️ | Selection only | `background/index.ts:668-740` |
| Screenshot cropping | ❌ | Rect stored, not applied | `background/index.ts:504-560` |
| Date metadata extraction | ❌ | Not implemented | - |
| Codeblock formatting preservation | ❌ | Not implemented | - |

### Priority Issues:

#### 1. Screenshot Cropping (HIGH)
**Problem**: Full-page screenshot captured, crop rectangle stored in metadata, but crop NOT applied to image.

**MV2 Implementation**: `apps/web-clipper/background.js:393-427` (cropImage function)

**What's Needed**:
- Implement `cropImage()` function in background
- Use OffscreenCanvas API or send to content script
- Apply crop before saving to Trilium
- Test with various screen sizes

**Files to Modify**:
- `src/background/index.ts` (add crop function)
- Possibly `src/content/screenshot.ts` (if canvas needed)

#### 2. Image Processing for Full Page (HIGH)
**Problem**: `postProcessImages()` only runs for selection saves, not full page captures.

**MV2 Implementation**: `apps/web-clipper/background.js:293-301` (downloads all images)

**What's Needed**:
- Call `postProcessImages()` for all capture types
- Handle CORS errors gracefully
- Test with various image formats
- Consider performance for image-heavy pages

**Files to Modify**:
- `src/background/index.ts:608-630` (processContent function)

---

## UI Features

| Feature | Status | Notes | Priority |
|---------|--------|-------|----------|
| Popup interface | ✅ | With theme support | - |
| Settings page | ✅ | Connection config | - |
| Logs viewer | ✅ | Filter/search/export | - |
| Context menus | ✅ | All save types | - |
| Keyboard shortcuts | ✅ | Save (Ctrl+Shift+S), Screenshot (Ctrl+Shift+A) | - |
| Toast notifications | ⚠️ | Basic only | LOW |
| Already visited banner | ❌ | Backend exists, UI doesn't use | MED |
| Screenshot selection UI | ❓ | Needs verification | **HIGH** |

### Priority Issues:

#### 3. Screenshot Selection UI Verification (HIGH)
**Problem**: Unknown if MV3 version has feature parity with MV2 overlay UI.

**MV2 Implementation**: `apps/web-clipper/content.js:66-193`
- Drag-to-select with visual overlay
- Escape key to cancel
- Visual feedback during selection
- Crosshair cursor

**What's Needed**:
- Test MV3 screenshot selection workflow
- Compare UI/UX with MV2 version
- Verify all keyboard shortcuts work
- Check visual styling matches

**Files to Check**:
- `src/content/screenshot.ts`
- `src/content/index.ts`

#### 4. Already Visited Detection (MED)
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
| Link with custom note | ❌ | Only URL + title | LOW |
| Date metadata | ❌ | publishedDate, modifiedDate | LOW |
| Interactive toasts | ⚠️ | No "Open in Trilium" button | LOW |
| Save tabs feature | ❌ | Bulk save all tabs | MED |

---

## Current Development Phase

### Phase 1: Core Functionality ✅ COMPLETE
- [x] Build system working
- [x] Content script injection
- [x] Basic save operations
- [x] Settings and logs UI
- [x] Theme system
- [x] Centralized logging

### Phase 2: Screenshot Features 🚧 IN PROGRESS
- [ ] **Task 2.1**: Verify screenshot selection UI against MV2
- [ ] **Task 2.2**: Implement screenshot cropping function
- [ ] **Task 2.3**: Test end-to-end screenshot workflow
- [ ] **Task 2.4**: Handle edge cases (very large/small crops)

**Current Task**: Screenshot selection UI verification

### Phase 3: Image Processing (PLANNED)
- [ ] Apply image processing to full page captures
- [ ] Test with various image formats (PNG, JPG, WebP, SVG)
- [ ] Handle CORS edge cases
- [ ] Performance testing with image-heavy pages

### Phase 4: Quality of Life (PLANNED)
- [ ] Implement "save tabs" feature
- [ ] Add "already visited" detection to popup
- [ ] Add custom note text for links
- [ ] Extract date metadata from pages
- [ ] Add interactive toast buttons

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

### Critical (Blocking)
1. **Screenshot cropping not applied** - Full image saved instead of selection
2. **Images not embedded in full page** - Only works for selection saves

### Important (Should fix)
3. **Screenshot selection UI untested** - Need to verify against MV2
4. **No "already visited" indicator** - Backend function exists but unused

### Nice to Have
5. **No custom note text for links** - Only saves URL and title
6. **No date metadata extraction** - Loses temporal context
7. **Basic toast notifications** - No interactive buttons

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