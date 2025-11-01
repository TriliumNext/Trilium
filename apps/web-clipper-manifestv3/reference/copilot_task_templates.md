# Copilot Task Templates

Quick copy-paste templates for common Copilot tasks. Fill in the blanks and paste into Copilot Agent mode.

---

## Template 1: Implement Feature from Checklist

```
Implement [FEATURE_NAME] from docs/FEATURE-PARITY-CHECKLIST.md.

**Legacy Reference**: apps/web-clipper/[FILE]:[LINE_RANGE]

**Target Files**:
- src/[FILE_1]
- src/[FILE_2]

**Requirements**:
- Use centralized logging (Logger.create)
- Use theme system if UI component
- Follow patterns from docs/MIGRATION-PATTERNS.md
- Handle all errors gracefully

**Testing**:
- Test on [SCENARIO_1]
- Test on [SCENARIO_2]
- Verify no console errors

**Update**:
- Mark feature complete in docs/FEATURE-PARITY-CHECKLIST.md
```

**Example**:
```
Implement screenshot cropping from docs/FEATURE-PARITY-CHECKLIST.md.

**Legacy Reference**: apps/web-clipper/background.js:393-427

**Target Files**:
- src/background/index.ts (add cropImage function)
- src/background/index.ts (update captureScreenshot handler)

**Requirements**:
- Use OffscreenCanvas API (Pattern 3 from docs/MIGRATION-PATTERNS.md)
- Use centralized logging (Logger.create)
- Handle edge cases (crop outside bounds, zero-size crop)
- Handle all errors gracefully

**Testing**:
- Test small crop (100x100)
- Test large crop (full page)
- Test edge crops (near borders)
- Verify cropped dimensions correct

**Update**:
- Mark screenshot cropping complete in docs/FEATURE-PARITY-CHECKLIST.md
```

---

## Template 2: Fix Bug

```
Fix [BUG_DESCRIPTION] in src/[FILE].

**Problem**: [WHAT'S BROKEN]

**Expected Behavior**: [WHAT SHOULD HAPPEN]

**Current Behavior**: [WHAT ACTUALLY HAPPENS]

**Error Logs** (if any):
```
[PASTE ERROR FROM LOGS]
```

**Root Cause** (if known): [HYPOTHESIS]

**Solution Approach**: [HOW TO FIX]

**Testing**:
- Reproduce bug before fix
- Verify fix resolves issue
- Test edge cases
- Check for regressions
```

**Example**:
```
Fix image processing not running on full page captures in src/background/index.ts.

**Problem**: Images not being downloaded and embedded for full-page saves

**Expected Behavior**: All images should be converted to base64 and embedded in the note

**Current Behavior**: Only works for selection saves, full page keeps external URLs

**Root Cause**: postProcessImages() only called in saveSelection handler, not in savePage handler

**Solution Approach**: 
1. Call postProcessImages() in processContent function (line ~608)
2. Ensure it runs for all capture types
3. Handle CORS errors gracefully

**Testing**:
- Save full page with multiple images
- Save page with CORS-restricted images
- Verify embedded images display in Trilium
- Check external images still work as fallback
```

---

## Template 3: Add UI Component

```
Add [COMPONENT_NAME] to [PAGE].

**Purpose**: [WHAT IT DOES]

**Visual Design**:
- [DESCRIBE LAYOUT]
- [LIST UI ELEMENTS]

**Data Source**: [WHERE DATA COMES FROM]

**Interactions**:
- [USER ACTION 1] → [RESULT]
- [USER ACTION 2] → [RESULT]

**Files to Modify**:
- src/[PAGE]/[PAGE].html (markup)
- src/[PAGE]/[PAGE].css (styles with theme variables)
- src/[PAGE]/index.ts (logic with logging)

**Requirements**:
- Import and use theme.css
- Initialize ThemeManager
- Use centralized logging
- Handle empty/error states

**Testing**:
- Test in light mode
- Test in dark mode
- Test with no data
- Test with error condition
```

**Example**:
```
Add "Recent Notes" section to popup.

**Purpose**: Show last 5 saved notes with links to open in Trilium

**Visual Design**:
- Card/panel below main action buttons
- Heading "Recently Saved"
- List of note titles (clickable links)
- If empty, show "No recent notes"

**Data Source**: 
- chrome.storage.local.recentNotes array
- Populated by background when saving notes

**Interactions**:
- Click note title → Opens note in Trilium (new tab)

**Files to Modify**:
- src/popup/popup.html (add <div> for recent notes)
- src/popup/popup.css (styles with theme variables)
- src/popup/index.ts (load and display recent notes)
- src/background/index.ts (store recent notes on save)

**Requirements**:
- Import and use theme.css with CSS variables
- Initialize ThemeManager
- Use centralized logging
- Handle empty state (no recent notes)
- Escape HTML in note titles

**Testing**:
- Test in light mode
- Test in dark mode
- Test with no recent notes
- Test with 1 note, 5 notes, 10+ notes
- Test note title with special characters
```

---

## Template 4: Refactor Code

```
Refactor [FUNCTION/MODULE] in src/[FILE].

**Current Issues**:
- [PROBLEM 1]
- [PROBLEM 2]

**Goals**:
- [IMPROVEMENT 1]
- [IMPROVEMENT 2]

**Approach**:
- [STEP 1]
- [STEP 2]

**Requirements**:
- Maintain existing functionality (no behavior changes)
- Improve type safety
- Add/improve logging
- Add error handling if missing

**Testing**:
- Verify all existing functionality still works
- Check no regressions
```

---

## Template 5: Investigate Issue

```
Investigate [ISSUE_DESCRIPTION].

**Symptoms**:
- [WHAT USER SEES]

**Context**:
- Happens when [SCENARIO]
- Doesn't happen when [SCENARIO]

**What to Check**:
1. Review relevant code in [FILE]
2. Check logs for errors
3. Check storage state
4. Compare with MV2 implementation (apps/web-clipper/[FILE])

**Expected Output**:
- Root cause analysis
- Proposed solution
- Code changes needed (if applicable)
```

---

## Template 6: Optimize Performance

```
Optimize performance of [FEATURE] in src/[FILE].

**Current Performance**: [METRICS]

**Target Performance**: [GOAL]

**Bottlenecks** (if known):
- [ISSUE 1]
- [ISSUE 2]

**Approach**:
- [OPTIMIZATION 1]
- [OPTIMIZATION 2]

**Requirements**:
- Measure before/after with performance.now()
- Log performance metrics
- Don't break existing functionality

**Testing**:
- Test with small dataset
- Test with large dataset
- Verify functionality unchanged
```

---

## Template 7: Update Documentation

```
Update [DOCUMENTATION_FILE].

**Changes Needed**:
- [CHANGE 1]
- [CHANGE 2]

**Reason**: [WHY UPDATING]

**Files**:
- docs/[FILE]
```

---

## Quick Copilot Commands

### For Understanding Legacy Code
```
Explain the [FEATURE] implementation in apps/web-clipper/[FILE]:[LINES].

Focus on:
- Core logic and data flow
- Key functions and their purpose
- Data structures used
- Edge cases handled

I need to replicate this in MV3 with modern patterns.
```

### For Code Review
```
Review the implementation in src/[FILE].

Check for:
- Proper error handling
- Centralized logging usage
- Theme system integration (if UI)
- Type safety (no 'any' types)
- Edge cases handled
- Performance concerns

Suggest improvements if any.
```

### For Pattern Guidance
```
What's the best MV3 pattern for [TASK]?

Constraints:
- Must work in service worker (no DOM)
- Need to handle [EDGE_CASE]
- Should follow docs/MIGRATION-PATTERNS.md

Show example implementation.
```

---

## Copilot Chat Shortcuts

### Quick Questions (Use Chat Pane - Free)

```
# Understand code
What does this function do?

# Check compatibility
Is this MV3 compatible?

# Get suggestions
How can I improve this?

# Find examples
Show example of [PATTERN]

# Explain error
Why is TypeScript showing this error?
```

### Inline Fixes (Use Ctrl+I - Free)

```
# Fix error
Fix this TypeScript error

# Add types
Add proper TypeScript types

# Improve logging
Add centralized logging

# Format code
Format this properly

# Add comments
Add explanatory comment
```

---

## Usage Tips

### When to Use Templates

1. **Use Template** when:
   - Implementing planned feature
   - Bug has clear reproduction steps
   - Adding designed UI component
   - Following established pattern

2. **Ask for Guidance First** when:
   - Unclear how to approach problem
   - Need to understand legacy code
   - Choosing between approaches
   - Architectural decision needed

3. **Use Inline Chat** when:
   - Fixing TypeScript errors
   - Adding missing imports
   - Formatting code
   - Quick refactoring

### Maximizing Copilot Efficiency

**Before Using Agent Mode (Task)**:
1. Understand the problem clearly
2. Review legacy code if migrating
3. Check docs/MIGRATION-PATTERNS.md for relevant pattern
4. Plan which files need changes
5. Fill out template completely

**During Agent Mode**:
1. Let it work uninterrupted
2. Review generated code carefully
3. Test immediately
4. Use inline chat for small fixes

**After Task**:
1. Update feature checklist
2. Commit with good message
3. Document any decisions

---

## Context File Quick Reference

Point Copilot to these when needed:

```
See docs/ARCHITECTURE.md for system overview
See docs/MIGRATION-PATTERNS.md for coding patterns
See docs/DEVELOPMENT-GUIDE.md for workflow guidance
See docs/FEATURE-PARITY-CHECKLIST.md for current status
See apps/web-clipper/[FILE] for MV2 reference
```

---

**Remember**: Well-prepared prompts = better results + fewer task retries = more efficient Copilot usage!