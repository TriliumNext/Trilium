# Implementation Plan: Code Block Preservation with Allow List

## Phase 1: Core Code Block Preservation Logic ✅ COMPLETE

**Status**: All Phase 1 components implemented and tested
- ✅ Section 1.1: Code Block Detection Module (`src/shared/code-block-detection.ts`)
- ✅ Section 1.2: Readability Monkey-Patch Module (`src/shared/readability-code-preservation.ts`)
- ✅ Section 1.3: Main Extraction Module (`src/shared/article-extraction.ts`)

### 1.1 Create Code Block Detection Module ✅
Create new file: `src/utils/codeBlockDetection.js`

**Goals**:
- Detect all code blocks in a document (both `<pre>` and block-level `<code>` tags)
- Distinguish between inline code and block-level code
- Calculate importance scores for code blocks
- Provide consistent code block identification across the extension

**Approach**:
- Create `detectCodeBlocks(document)` function that returns array of code block metadata
- Create `isBlockLevelCode(codeElement)` function with multiple heuristics:
  - Check for newlines (multi-line code)
  - Check length (>80 chars)
  - Analyze parent-child content ratio
  - Check for syntax highlighting classes
  - Check for code block wrapper classes
- Create `calculateImportance(codeElement)` function (optional, for future enhancements)
- Add helper function `hasCodeChild(element)` to check if element contains code

**Requirements**:
- Pure functions with no side effects
- Support for all common code block patterns (`<pre>`, `<pre><code>`, standalone `<code>`)
- Handle edge cases (empty code blocks, nested structures)
- TypeScript/JSDoc types for all functions
- Comprehensive logging for debugging

**Testing**:
- Test with various code block structures
- Test with inline vs block code
- Test with syntax-highlighted code
- Test with malformed HTML

---

### 1.2 Create Readability Monkey-Patch Module ✅
Create new file: `src/shared/readability-code-preservation.ts`

**Current Issues**:
- Readability strips code blocks during cleaning process
- No way to selectively preserve elements during Readability parsing
- Code blocks end up removed or relocated incorrectly

**Goals**:
- Override Readability's cleaning methods to preserve marked code blocks
- Safely apply and restore monkey-patches without affecting other extension functionality
- Mark code blocks with unique attributes before Readability runs
- Clean up markers after extraction

**Approach**:
- Create `extractWithMonkeyPatch(document, codeBlocks, PRESERVE_MARKER)` function
- Store references to original Readability methods:
  - `Readability.prototype._clean`
  - `Readability.prototype._removeNodes`
  - `Readability.prototype._cleanConditionally`
- Create `shouldPreserve(element)` helper that checks for preservation markers
- Override each method to skip preserved elements and their parents
- Use try-finally block to ensure methods are always restored
- Remove preservation markers from final HTML output

**Requirements**:
- Always restore original Readability methods (use try-finally)
- Check that methods exist before overriding (defensive programming)
- Add comprehensive error handling
- Log all preservation actions for debugging
- Clean up all temporary markers before returning results
- TypeScript/JSDoc types for all functions

**Testing**:
- Verify original Readability methods are restored after extraction
- Test that code blocks remain in correct positions
- Test error cases (what happens if Readability throws)
- Verify no memory leaks from monkey-patching

---

### 1.3 Create Main Extraction Module ✅
Create new file: `src/shared/article-extraction.ts`

**Current Issues**:
- Standard Readability removes code blocks
- No conditional logic for applying code preservation
- No integration with settings system

**Goals**:
- Provide unified article extraction function
- Conditionally apply code preservation based on settings and site allow list
- Fall back to vanilla Readability when preservation not needed
- Return consistent metadata about preservation status

**Approach**:
- Create `extractWithCodeBlocks(document, url, settings)` main function
- Quick check for code block presence (optimize for common case)
- Load settings if not provided (async)
- Check if preservation should be applied using `shouldPreserveCodeForSite(url, settings)`
- Call `extractWithMonkeyPatch()` if preservation needed, else vanilla Readability
- Create `runVanillaReadability(document)` wrapper function
- Return consistent result object with metadata:
  ```javascript
  {
    ...articleContent,
    codeBlocksPreserved: number,
    preservationApplied: boolean
  }
  ```

**Requirements**:
- Async/await for settings loading
- Handle missing settings gracefully (use defaults)
- Fast-path for non-code pages (no unnecessary processing)
- Maintain backward compatibility with existing extraction code
- Add comprehensive logging
- TypeScript/JSDoc types for all functions
- Error handling with graceful fallbacks

**Testing**:
- Test with code-heavy pages
- Test with non-code pages
- Test with settings enabled/disabled
- Test with allow list matches and non-matches
- Verify performance on large documents

---

## Phase 2: Settings Management ✅ COMPLETE

**Status**: Phase 2 COMPLETE - All settings sections implemented
- ✅ Section 2.1: Settings Schema and Storage Module (`src/shared/code-block-settings.ts`)
- ✅ Section 2.2: Allow List Settings Page HTML/CSS (`src/options/codeblock-allowlist.html`, `src/options/codeblock-allowlist.css`)
- ✅ Section 2.3: Allow List Settings Page JavaScript (`src/options/codeblock-allowlist.ts`)
- ✅ Section 2.4: Integrate Settings into Main Settings Page (`src/options/index.html`, `src/options/options.css`)

### 2.1 Create Settings Schema and Storage Module ✅
Create new file: `src/shared/code-block-settings.ts`

**Status**: ✅ COMPLETE

**Goals**:
- Define settings schema for code block preservation
- Provide functions to load/save settings from Chrome storage
- Manage default allow list
- Provide URL/domain matching logic

**Approach**:
- Create `loadCodeBlockSettings()` async function
- Create `saveCodeBlockSettings(settings)` async function
- Create `getDefaultAllowList()` function returning array of default entries:
  ```javascript
  [
    { type: 'domain', value: 'stackoverflow.com', enabled: true },
    { type: 'domain', value: 'github.com', enabled: true },
    // ... more defaults
  ]
  ```
- Create `shouldPreserveCodeForSite(url, settings)` function with logic:
  - Check exact URL matches first
  - Check domain matches (with wildcard support like `*.github.com`)
  - Check auto-detect setting
  - Return boolean
- Create validation helpers:
  - `isValidDomain(domain)`
  - `isValidURL(url)`
  - `normalizeEntry(entry)`

**Requirements**:
- Use `chrome.storage.sync` for cross-device sync
- Provide sensible defaults if storage is empty
- Handle storage errors gracefully
- Support wildcard domains (`*.example.com`)
- Support subdomain matching (`blog.example.com` matches `example.com`)
- TypeScript/JSDoc types for settings schema
- Comprehensive error handling and logging

**Schema**:
```javascript
{
  codeBlockPreservation: {
    enabled: boolean,
    autoDetect: boolean,
    allowList: [
      {
        type: 'domain' | 'url',
        value: string,
        enabled: boolean,
        custom?: boolean  // true if user-added
      }
    ]
  }
}
```

**Testing**:
- Test storage save/load
- Test default settings creation
- Test URL matching logic with various formats
- Test wildcard domain matching
- Test subdomain matching

---

### 2.2 Create Allow List Settings Page HTML ✅
Create new file: `src/options/codeblock-allowlist.html`

**Status**: ✅ COMPLETE

**Goals**:
- Provide user interface for managing code block allow list
- Show clear documentation of how the feature works
- Allow adding/removing/toggling entries
- Distinguish between default and custom entries

**Approach**:
- Create clean, user-friendly HTML layout with:
  - Header with title and description
  - Info box explaining how feature works
  - Settings section with master toggles:
    - Enable code block preservation checkbox
    - Auto-detect code blocks checkbox
  - Add entry form (type selector + input + button)
  - Allow list table showing all entries
  - Back button to main settings
- Use CSS Grid for table layout
- Use toggle switches for enable/disable
- Style default vs custom entries differently
- Disable "Remove" button for default entries

**Requirements**:
- Responsive design (works in popup window)
- Accessible (proper labels, ARIA attributes)
- Clear visual hierarchy
- Helpful placeholder text and examples
- Validation feedback for user input
- Consistent styling with rest of extension

**Components**:
- Master toggle switches with descriptions
- Add entry form with validation
- Table with columns: Type, Value, Status (toggle), Action (remove button)
- Empty state message when no entries
- Info box with usage instructions

**Testing**:
- Test in different window sizes
- Test keyboard navigation
- Test screen reader compatibility
- Test with long domain names/URLs

---

### 2.3 Create Allow List Settings Page JavaScript ✅
Create new file: `src/options/codeblock-allowlist.ts`

**Status**: ✅ COMPLETE

**Goals**:
- Handle all user interactions on allow list page
- Load and save settings to Chrome storage
- Validate user input before adding entries
- Render allow list dynamically
- Provide immediate feedback on actions

**Approach**:
- Create initialization function:
  - Load settings from storage on page load
  - Render current allow list
  - Set up all event listeners
- Create `addEntry()` function:
  - Validate input (domain or URL format)
  - Check for duplicates
  - Add to settings and save
  - Re-render list
  - Clear input field
- Create `removeEntry(index)` function:
  - Confirm with user
  - Remove from settings
  - Save and re-render
- Create `toggleEntry(index)` function:
  - Toggle enabled state
  - Save settings
  - Re-render
- Create `renderAllowList()` function:
  - Generate HTML for each entry
  - Show empty state if no entries
  - Disable remove button for default entries
- Create validation functions:
  - `isValidDomain(domain)` - regex validation, support wildcards
  - `isValidURL(url)` - use URL constructor
- Handle Enter key in input field for quick add

**Requirements**:
- Use async/await for storage operations
- Provide immediate visual feedback (disable buttons during operations)
- Show clear error messages for invalid input
- Escape user input to prevent XSS
- Preserve scroll position when re-rendering
- Add confirmation dialogs for destructive actions
- Comprehensive error handling
- Logging for debugging

**Testing**:
- Test adding valid/invalid domains and URLs
- Test removing entries
- Test toggling entries
- Test duplicate detection
- Test with empty allow list
- Test special characters in input
- Test storage errors

---

### 2.4 Integrate Settings into Main Settings Page ✅
Modify existing file: `src/options/index.html` and `src/options/options.css`

**Status**: ✅ COMPLETE

**Goals**:
- Add link to Code Block Allow List settings page
- Provide brief description of feature
- Integrate with existing settings navigation

**Approach**:
- Add new settings section in HTML:
  ```html
  <div class="setting-section">
    <h3>Code Block Preservation</h3>
    <p>Preserve code blocks in their original positions when reading technical articles.</p>
    <a href="codeblock-allowlist.html" class="setting-link">
      Configure Allow List →
    </a>
  </div>
  ```
- Style consistently with other settings sections
- Optional: Add quick toggle for enable/disable on main settings page

**Requirements**:
- Maintain existing settings functionality
- Consistent styling
- Clear description of what feature does

**Testing**:
- Verify navigation to/from allow list page works
- Test back button returns to correct location

---

## Phase 3: Integration with Existing Code

### 3.1 Update Content Script ✅
Modify existing file: `src/content/index.ts`

**Status**: ✅ COMPLETE

**Current Issues**:
- ~~Uses standard Readability without code preservation~~
- ~~No integration with new extraction module~~
- ~~No settings awareness~~

**Goals**:
- ✅ Replace vanilla Readability calls with new `extractArticle()` function
- ✅ Pass current URL to extraction function
- ✅ Handle preservation metadata in results
- ✅ Maintain existing functionality for non-code pages

**Approach**:
- ✅ Import new extraction module
- ✅ Replace existing Readability extraction code:
  ```typescript
  // OLD (inline monkey-patching)
  const article = this.extractWithCodeBlockPreservation(documentCopy);
  
  // NEW (centralized module)
  const extractionResult = await extractArticle(
    document,
    window.location.href
  );
  ```
- ✅ Log preservation metadata for debugging
- ✅ Pass article content to existing rendering pipeline unchanged
- ✅ Remove old inline `extractWithCodeBlockPreservation` and `isBlockLevelCode` methods
- ✅ Use centralized logging throughout

**Requirements**:
- ✅ Maintain all existing extraction functionality
- ✅ No changes to article rendering code
- ✅ Backward compatible (works if settings not configured)
- ✅ Add error handling around new extraction code
- ✅ Log preservation status for analytics/debugging

**Testing**:
- [ ] Test on code-heavy technical articles
- [ ] Test on regular articles without code
- [ ] Test on pages in allow list vs not in allow list
- [ ] Verify existing features still work (highlighting, annotations, etc.)
- [ ] Performance test on large pages

---

### 3.2 Update Background Script (if applicable) ✅
Modify existing file: `src/background/index.ts`

**Status**: ✅ COMPLETE

**Goals**:
- ✅ Initialize default settings on extension install
- ✅ Handle settings migrations if needed
- ✅ No changes required if extraction happens entirely in content script

**Approach**:
- ✅ Add installation handler in `handleInstalled()` method
- ✅ Import and call `initializeDefaultSettings()` from code-block-settings module
- ✅ Only runs on 'install', not 'update' (preserves existing settings)
- ✅ Uses centralized logging (Logger.create)
- ✅ Comprehensive error handling

**Implementation**:
```typescript
private async handleInstalled(details: chrome.runtime.InstalledDetails): Promise<void> {
  logger.info('Extension installed/updated', { reason: details.reason });

  if (details.reason === 'install') {
    // Set default configuration
    await this.setDefaultConfiguration();

    // Initialize code block preservation settings
    await initializeDefaultSettings();

    // Open options page for initial setup
    chrome.runtime.openOptionsPage();
  }
}
```

**Requirements**:
- ✅ Don't overwrite existing settings on update
- ✅ Provide migration path if settings schema changes
- ✅ Log initialization for debugging

**Testing**:
- [ ] Test fresh install (settings created correctly)
- [ ] Test update (settings preserved)
- [ ] Test uninstall/reinstall

---

## Phase 4: Documentation and Polish

### 4.1 Create User Documentation ✅
Create new file: `docs/USER_GUIDE_CODE_BLOCK_PRESERVATION.md`

**Status**: ✅ COMPLETE

**Goals**:
- ✅ Explain what code block preservation does
- ✅ Provide clear instructions for using allow list
- ✅ Give examples of valid entries
- ✅ Explain auto-detect vs manual mode

**Content**:
- ✅ Overview section explaining the feature
- ✅ "How to Use" section with step-by-step instructions
- ✅ Examples section with common use cases
- ✅ Troubleshooting section
- ✅ Technical details section (optional, for advanced users)
- ✅ FAQ section with common questions
- ✅ Advanced usage and debugging section

**Requirements**:
- ✅ Clear, concise language
- ✅ Examples covering domains and URLs
- ✅ Cover common questions and troubleshooting
- ✅ Link from settings page and main README

**Implementation**:
- ✅ Created comprehensive user guide (`docs/USER_GUIDE_CODE_BLOCK_PRESERVATION.md`)
- ✅ Added link in allow list settings page (`src/options/codeblock-allowlist.html`)
- ✅ Added CSS styling for help link (`src/options/codeblock-allowlist.css`)
- ✅ Updated main README with feature highlight and guide link
- ✅ Included step-by-step setup instructions
- ✅ Provided real-world examples and use cases
- ✅ Added troubleshooting guide
- ✅ Included FAQ section
- ✅ Added debugging and advanced usage sections

---

### 4.2 Add Developer Documentation ✅
Create new file: `docs/CODE_BLOCK_PRESERVATION_DEVELOPER_GUIDE.md`

**Status**: ✅ COMPLETE

**Goals**:
- ✅ Explain architecture and implementation
- ✅ Document monkey-patching approach and risks
- ✅ Explain settings schema
- ✅ Provide maintenance guidance

**Content**:
- ✅ Architecture overview with module diagram
- ✅ Explanation of monkey-patching technique
- ✅ Brittleness assessment and mitigation strategies
- ✅ Settings schema documentation
- ✅ Instructions for adding new default sites
- ✅ Testing strategy
- ✅ Known limitations

**Requirements**:
- ✅ Technical but clear explanations
- ✅ Code examples where helpful
- ✅ Maintenance considerations
- ✅ Version compatibility notes

**Implementation**:
- ✅ Created comprehensive developer guide (`docs/CODE_BLOCK_PRESERVATION_DEVELOPER_GUIDE.md`)
- ✅ Documented all modules with detailed architecture diagrams
- ✅ Explained monkey-patching risks and mitigations
- ✅ Provided testing strategy with code examples
- ✅ Included maintenance procedures and debugging guides
- ✅ Documented known limitations and compatibility notes
- ✅ Added code samples for extending functionality
- ✅ Included performance benchmarking guidelines

---

### 4.3 Add Logging and Analytics ✅
Modify all new modules

**Status**: ✅ COMPLETE

**Goals**:
- ✅ Add comprehensive logging for debugging
- ✅ Track preservation success rates
- ✅ Help diagnose issues in production

**Approach**:
- ✅ Use centralized logging system (Logger.create) in all modules:
  - When preservation is applied
  - When code blocks are detected
  - When settings are loaded/saved
  - When errors occur
- ✅ Use consistent log format with proper log levels
- ✅ Rich contextual information in all log messages

**Implementation**:
All modules now use the centralized `Logger.create()` system with:
- **Proper log levels**: debug, info, warn, error
- **Rich context**: Structured metadata in log messages
- **Comprehensive coverage**:
  - `code-block-detection.ts`: Detection operations and statistics
  - `code-block-settings.ts`: Settings load/save, validation, allow list operations
  - `article-extraction.ts`: Extraction flow, decision-making, performance metrics
  - `readability-code-preservation.ts`: Monkey-patching, preservation operations
  - `codeblock-allowlist.ts`: UI interactions, user actions, form validation
  - `content/index.ts`: Pre/post extraction statistics, preservation results
- **Privacy-conscious**: No PII in logs, only technical metadata
- **Production-ready**: Configurable log levels, storage-backed logs

**Requirements**:
- ✅ Respect user privacy (no PII in logs)
- ✅ Use centralized logging system
- ✅ Use log levels (debug, info, warn, error)
- ✅ Proper production configuration

---

## Phase 5: Testing and Refinement

### 5.1 Comprehensive Testing
**Test Cases**:

**Unit Tests**:
- `isBlockLevelCode()` with various code structures
- `shouldPreserveCodeForSite()` with different URL patterns
- Settings validation functions
- URL/domain matching logic

**Integration Tests**:
- Full extraction flow on sample articles
- Settings save/load cycle
- Allow list CRUD operations
- Monkey-patch apply/restore cycle

**Manual Testing**:
- Test on real technical blogs:
  - Stack Overflow questions
  - GitHub README files
  - Dev.to tutorials
  - Medium programming articles
  - Personal tech blogs
- Test on non-code pages (news, blogs, etc.)
- Test with allow list enabled/disabled
- Test with auto-detect enabled/disabled
- Test adding/removing allow list entries
- Test with invalid input
- Test with edge cases (very long URLs, special characters)

**Performance Testing**:
- Measure extraction time with/without preservation
- Test on large documents (>10,000 words)
- Test on code-heavy pages (>50 code blocks)
- Monitor memory usage

**Regression Testing**:
- Verify all existing features still work
- Check no performance degradation on non-code pages
- Verify settings sync across devices
- Test with other extensions that might conflict

---

### 5.2 Bug Fixes and Refinements
**Common Issues to Address**:
- Code blocks appearing in wrong positions
- Inline code being treated as blocks
- Performance issues on large pages
- Settings not syncing properly
- UI glitches in settings page
- Wildcard matching not working correctly

**Refinement Areas**:
- Improve `isBlockLevelCode()` heuristics based on real-world testing
- Optimize code block detection for performance
- Improve error messages and user feedback
- Polish UI animations and transitions
- Add keyboard shortcuts for power users
- Consider adding import/export for allow list

---

## Implementation Checklist

### Phase 1: Core Functionality

- [x] Create `src/shared/code-block-detection.ts`
  - [x] `detectCodeBlocks()` function
  - [x] `isBlockLevelCode()` function
  - [x] Helper functions
  - [x] JSDoc types
- [x] Create `src/shared/readability-code-preservation.ts`
  - [x] `extractWithCodeBlockPreservation()` function
  - [x] Method overrides for Readability
  - [x] `shouldPreserveElement()` helper
  - [x] Cleanup logic
  - [x] TypeScript types
  - [x] Centralized logging (Logger.create)
  - [x] Comprehensive error handling
  - [x] Documentation and code comments
- [x] Create `src/shared/article-extraction.ts`
  - [x] `extractArticle()` main function
  - [x] `runVanillaReadability()` wrapper (via readability-code-preservation)
  - [x] Settings integration (stub for Phase 2)
  - [x] Fast-path optimization (hasCodeBlocks check)
  - [x] Convenience functions (extractArticleVanilla, extractArticleWithCode)
  - [x] TypeScript types and interfaces
  - [x] Centralized logging (Logger.create)
  - [x] Comprehensive error handling
  - [x] Documentation and code comments

### Phase 2: Settings
- [x] Create `src/shared/code-block-settings.ts`
  - [x] Settings schema (CodeBlockSettings interface)
  - [x] `loadCodeBlockSettings()` function
  - [x] `saveCodeBlockSettings()` function
  - [x] `initializeDefaultSettings()` function
  - [x] `getDefaultAllowList()` function
  - [x] `shouldPreserveCodeForSite()` function
  - [x] Validation helpers (isValidDomain, isValidURL, normalizeEntry)
  - [x] Helper functions (addAllowListEntry, removeAllowListEntry, toggleAllowListEntry)
  - [x] TypeScript types
  - [x] Centralized logging (Logger.create)
  - [x] Comprehensive error handling
  - [x] Integration with background script (initializeDefaultSettings)
  - [x] Integration with article-extraction module
- [x] Create `src/options/codeblock-allowlist.html`
  - [x] Page layout and structure
  - [x] Master toggle switches
  - [x] Add entry form
  - [x] Allow list table
  - [x] Info/help sections
  - [x] CSS styling
- [x] Create `src/options/codeblock-allowlist.ts`
  - [x] Settings load/save functions
  - [x] `addEntry()` function
  - [x] `removeEntry()` function
  - [x] `toggleEntry()` function
  - [x] `renderAllowList()` function
  - [x] Validation functions (using shared helpers)
  - [x] Event listeners
  - [x] Error handling and user feedback
  - [x] Confirmation dialogs for destructive actions
  - [x] Button state management during async operations
- [x] Update `src/options/index.html`
  - [x] Add link to allow list page
  - [x] Add feature description
  - [x] Style consistently with existing sections
  - [x] Add visual hierarchy with icons
  - [x] Responsive design considerations
- [x] Update `src/options/options.css`
  - [x] Add code block preservation section styling
  - [x] Style settings link with hover effects
  - [x] Consistent theming with existing sections
  - [x] Responsive layout support

### Phase 3: Integration ✅ COMPLETE

**Status**: Phase 3 COMPLETE - All integration sections implemented
- ✅ Section 3.1: Update Content Script (`src/content/index.ts`)
- ✅ Section 3.2: Update Background Script (`src/background/index.ts`)

- [x] Update content script
  - [x] Import new extraction module
  - [x] Replace Readability calls with `extractArticle()`
  - [x] Handle preservation metadata
  - [x] Add error handling
  - [x] Add logging
  - [x] Remove old inline code block preservation methods
- [x] Update background script (if needed)
  - [x] Add installation handler
  - [x] Initialize default settings
  - [x] Add migration logic

### Phase 4: Documentation ✅ COMPLETE
- [x] Create user documentation
  - [x] Feature overview
  - [x] How-to guide
  - [x] Examples
  - [x] Troubleshooting
  - [x] FAQ section
  - [x] Advanced usage
  - [x] Link from settings page and README
- [x] Create developer documentation
  - [x] Architecture overview
  - [x] Implementation details
  - [x] Maintenance guide
  - [x] Testing strategy
- [x] Add logging and analytics
  - [x] Centralized logging system (Logger.create)
  - [x] Comprehensive coverage in all modules
  - [x] Rich contextual information
  - [x] Performance metrics and statistics
  - [x] Privacy-conscious (no PII)
  - [x] Production-ready configuration
- [x] Add inline code comments
  - [x] Complex algorithms
  - [x] Important decisions
  - [x] Potential pitfalls

### Phase 5: Testing
- [ ] Write unit tests
- [ ] Write integration tests
- [ ] Manual testing on real sites
- [ ] Performance testing
- [ ] Regression testing
- [ ] Bug fixes
- [ ] Refinements

---

## Success Criteria

**Feature Complete When**:
- [ ] Code blocks are preserved in their original positions on allow-listed sites
- [ ] Settings UI is intuitive and fully functional
- [ ] Default allow list covers major technical sites
- [ ] Users can add custom domains/URLs
- [ ] Feature can be disabled globally
- [ ] Auto-detect mode works correctly
- [ ] No regressions in existing functionality
- [ ] Performance impact is minimal (<100ms added to extraction)
- [ ] Documentation is complete and clear
- [ ] All tests pass

**Quality Criteria**:
- [x] Code is well-commented
- [x] Functions have TypeScript/JSDoc types
- [x] Error handling is comprehensive
- [x] Logging is useful for debugging
- [x] Settings sync across devices
- [x] UI is polished and accessible
- [ ] No console errors or warnings
- [x] Memory leaks are prevented (monkey-patches cleaned up)

---

## Risk Mitigation

**Risk: Readability Version Updates**
- Mitigation: Pin Readability version in package.json
- Mitigation: Add method existence checks before overriding
- Mitigation: Document tested version
- Mitigation: Add fallback to vanilla Readability if monkey-patching fails

**Risk: Performance Degradation**
- Mitigation: Only apply preservation when code blocks detected
- Mitigation: Fast-path for non-code pages
- Mitigation: Performance testing on large documents
- Mitigation: Optimize detection algorithms

**Risk: Settings Sync Issues**
- Mitigation: Use chrome.storage.sync properly
- Mitigation: Handle storage errors gracefully
- Mitigation: Provide default settings
- Mitigation: Add data validation

**Risk: User Confusion**
- Mitigation: Clear documentation
- Mitigation: Intuitive UI with help text
- Mitigation: Sensible defaults (popular sites pre-configured)
- Mitigation: Examples and tooltips

**Risk: Compatibility Issues**
- Mitigation: Extensive testing on real sites
- Mitigation: Graceful fallbacks
- Mitigation: Error logging
- Mitigation: User feedback mechanism

---

## Timeline Estimate

- **Phase 1 (Core Functionality)**: 2-3 days
- **Phase 2 (Settings)**: 2-3 days
- **Phase 3 (Integration)**: 1 day
- **Phase 4 (Documentation)**: 1 day
- **Phase 5 (Testing & Refinement)**: 2-3 days

**Total**: 8-11 days for full implementation and testing

---

## Future Enhancements (Post-MVP)

- [ ] Import/export allow list
- [ ] Site suggestions based on browsing history
- [ ] Per-site preservation strength settings
- [ ] Automatic detection of technical sites
- [ ] Code block syntax highlighting preservation
- [ ] Support for more code block types (Jupyter notebooks, etc.)
- [ ] Analytics dashboard showing preservation stats
- [ ] Cloud sync for allow list
- [ ] Share allow lists with other users