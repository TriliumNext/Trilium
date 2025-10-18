# Optimized Copilot Workflow Guide

Complete guide for efficient development with GitHub Copilot Basic tier.

---

## File Structure Overview

```
apps/web-clipper-manifestv3/
├── .github/
│   └── copilot-instructions.md       # Auto-loaded by Copilot (streamlined)
├── .vscode/
│   └── settings.json                  # VS Code + Copilot config
├── docs/
│   ├── ARCHITECTURE.md                # One-time reference (systems)
│   ├── FEATURE-PARITY-CHECKLIST.md   # Working status + TODO
│   ├── DEVELOPMENT-GUIDE.md           # Common tasks + workflows
│   └── MIGRATION-PATTERNS.md          # MV2→MV3 code patterns
├── COPILOT-TASK-TEMPLATES.md         # Quick copy-paste prompts
├── src/                               # Source code
├── reference/                         # API documentation
└── dist/                              # Build output (gitignored)
```

---

## Step-by-Step Setup

### 1. Reorganize Your Documentation

```bash
cd apps/web-clipper-manifestv3

# Create directory structure
mkdir -p .github docs .vscode

# Move existing file
mv WORKING-STATUS.md docs/FEATURE-PARITY-CHECKLIST.md

# Create new files from artifacts I provided
# (Copy content from the artifacts above)
```

**Files to create**:
1. `.github/copilot-instructions.md` - Streamlined instructions
2. `docs/ARCHITECTURE.md` - System overview
3. `docs/MIGRATION-PATTERNS.md` - Code patterns
4. `docs/DEVELOPMENT-GUIDE.md` - Practical workflows
5. `COPILOT-TASK-TEMPLATES.md` - Quick prompts
6. `.vscode/settings.json` - Editor config

### 2. Update Your Existing Files

**Keep but review**:
- `BUILD-MIGRATION-SUMMARY.md` - Still useful reference
- `reference/` directory - API documentation

**Archive** (move to `docs/archive/` if needed):
- Old verbose documentation
- Duplicate information
- Outdated notes

---

## Three-Tier Copilot Usage Strategy

### Tier 1: Free Operations (Unlimited)

**Use For**: Quick fixes, small changes, understanding code

**Tools**:
- **Inline Chat** (Ctrl+I): Fix errors, add types, format
- **Chat Pane** (Ctrl+Alt+I): Ask questions, get explanations

**Examples**:
```
# Inline Chat (Ctrl+I)
"Fix this TypeScript error"
"Add proper logging"
"Extract this to a function"

# Chat Pane (Ctrl+Alt+I)
"Explain this function"
"What's the MV3 equivalent of chrome.webRequest?"
"How should I structure this component?"
```

**When to Use**: 
- Fixing TypeScript errors after implementation
- Understanding unfamiliar code
- Planning before using Agent mode
- Quick refactoring

### Tier 2: Strategic Agent Mode (Limited - Use Wisely)

**Use For**: Multi-file changes, feature implementation, complex logic

**Tool**:
- **Copilot Agent** (from chat pane): Cross-file coordination

**Examples**:
```
# Copy from COPILOT-TASK-TEMPLATES.md, fill in, paste:

Implement screenshot cropping from docs/FEATURE-PARITY-CHECKLIST.md.

Legacy Reference: apps/web-clipper/background.js:393-427
Target Files: src/background/index.ts

Use OffscreenCanvas API (Pattern 3 from docs/MIGRATION-PATTERNS.md).
Use centralized logging.
Update checklist when done.
```

**When to Use**:
- Implementing features from checklist
- Complex multi-file refactoring
- Bug fixes requiring multiple changes

**How to Maximize Value**:
1. **Prepare thoroughly** using Chat Pane first
2. **Use templates** from COPILOT-TASK-TEMPLATES.md
3. **Be specific** about files, patterns, requirements
4. **Let it run** without interruption
5. **Use Inline Chat** for cleanup after

### Tier 3: Manual Development (When Appropriate)

**Use For**: Simple changes, learning opportunities, debugging

**When to Use**:
- Adding a single line of code
- Fixing obvious typos
- Adjusting CSS values
- Learning the codebase
- Quick experiments

---

## Optimal Daily Workflow

### Session Start (5 minutes)

```bash
# 1. Navigate and start build
cd apps/web-clipper-manifestv3
npm run dev

# 2. Open VS Code
code .

# 3. Check current task
# Open: docs/FEATURE-PARITY-CHECKLIST.md
# Find next priority item
```

### Planning Phase (10-15 minutes - Free)

**Use Chat Pane** (Ctrl+Alt+I):

```
1. "Looking at feature [X] in docs/FEATURE-PARITY-CHECKLIST.md, 
    what's the implementation approach?"

2. "Review the MV2 code in apps/web-clipper/[FILE]:[LINES].
    What's the core logic?"

3. "What's the best MV3 pattern for this?
    See docs/MIGRATION-PATTERNS.md for our patterns."

4. "What files need to be modified?"
```

**Output**: Clear plan before using Agent mode

### Implementation Phase (Uses 1 Task)

**Use Agent Mode**:

1. Open `COPILOT-TASK-TEMPLATES.md`
2. Copy appropriate template
3. Fill in all blanks
4. Paste into Copilot Agent
5. Let it work
6. Review generated code

**Example Session**:
```
# You paste (from template):
Implement screenshot cropping from docs/FEATURE-PARITY-CHECKLIST.md.

Legacy Reference: apps/web-clipper/background.js:393-427
Target Files: 
- src/background/index.ts (add cropImage function)

Requirements:
- Use OffscreenCanvas API (Pattern 3)
- Use centralized logging
- Handle edge cases

Testing:
- Small crops, large crops, edge crops
- Verify dimensions correct

Update: docs/FEATURE-PARITY-CHECKLIST.md
```

### Cleanup Phase (Free)

**Use Inline Chat** (Ctrl+I):

1. Fix any TypeScript errors
2. Add missing imports
3. Improve logging
4. Format code

```
# Select code, press Ctrl+I:
"Fix TypeScript errors"
"Add better error handling"
"Add logging statement"
```

### Testing Phase (Manual)

```bash
# 1. Reload extension in Chrome
chrome://extensions/ → Reload button

# 2. Test functionality
# - Happy path
# - Error cases
# - Edge cases

# 3. Check logs
# - Open extension logs page
# - Filter by component
# - Verify no errors

# 4. Check consoles
# - Service worker console
# - Popup console (if UI)
# - Page console (if content script)
```

### Documentation Phase (Manual)

```bash
# 1. Update checklist
# Edit: docs/FEATURE-PARITY-CHECKLIST.md
# Mark feature as ✅ complete

# 2. Commit changes
git add .
git commit -m "feat: implement screenshot cropping"

# 3. Push (when ready)
git push
```

---

## Task Budgeting Strategy

**With Copilot Basic**: You have limited Agent mode tasks per month.

### Prioritize Tasks For:

**HIGH VALUE (Use Agent Mode)**:
1. ✅ Implementing missing features from checklist
2. ✅ Complex multi-file refactoring
3. ✅ Bug fixes requiring investigation
4. ✅ New component creation with UI

**LOW VALUE (Use Free Tools Instead)**:
1. ❌ Fixing simple TypeScript errors → Use Inline Chat
2. ❌ Understanding code → Use Chat Pane
3. ❌ Small CSS adjustments → Do manually
4. ❌ Adding comments → Use Inline Chat
5. ❌ Renaming variables → Do manually or use VS Code refactor
6. ❌ Formatting code → Use Prettier (Shift+Alt+F)

### Monthly Task Planning

**Estimate your tasks per month**: ~20-30 tasks (varies by plan)

**For this project** (Phase 2 - Screenshot Features):
- Task 1: Screenshot cropping implementation
- Task 2: Image processing for full page
- Task 3: Screenshot selection UI improvements
- **Total**: 3 tasks for Phase 2

**For Phase 3** (Image Processing):
- Task 4: Apply image processing to all capture types
- Task 5: CORS error handling improvements
- **Total**: 2 tasks for Phase 3

**For Phase 4** (Quality of Life):
- Task 6: Save tabs feature
- Task 7: Already visited detection
- Task 8: Custom note text for links
- **Total**: 3 tasks for Phase 4

**Total for project completion**: ~8-10 Agent mode tasks

---

## Real-World Example: Implementing Screenshot Cropping

Let's walk through a complete feature implementation using the optimized workflow.

### Phase 1: Planning (Free - Chat Pane)

**You ask**:
```
I need to implement screenshot cropping for the extension. The current 
implementation captures full-page screenshots but doesn't apply the crop 
rectangle that's stored in metadata.

MV2 implementation: apps/web-clipper/background.js:393-427

Questions:
1. Can I use regular Canvas in a service worker, or do I need OffscreenCanvas?
2. What's the best way to crop the image?
3. How should I handle errors?

See docs/MIGRATION-PATTERNS.md Pattern 3 for reference.
```

**Copilot responds** (paraphrased):
```
1. Must use OffscreenCanvas - regular Canvas requires DOM
2. Best approach:
   - Convert dataURL to Blob
   - Create ImageBitmap from Blob
   - Draw cropped section to OffscreenCanvas
   - Convert back to dataURL
3. Handle errors:
   - Invalid crop dimensions (width/height <= 0)
   - Crop outside image bounds
   - Canvas context creation failure

Here's the basic structure:
[Shows code structure]
```

**Output**: Clear implementation plan, no task used.

### Phase 2: Implementation (Uses 1 Task)

**You prepare the prompt** (from template):
```
Implement screenshot cropping from docs/FEATURE-PARITY-CHECKLIST.md.

**Legacy Reference**: apps/web-clipper/background.js:393-427

**Target Files**:
- src/background/index.ts (add cropImage function around line 500)
- src/background/index.ts (update captureScreenshot handler to call cropImage)

**Requirements**:
- Use OffscreenCanvas API (service worker compatible)
- Follow Pattern 3 from docs/MIGRATION-PATTERNS.md
- Use centralized logging (Logger.create('ScreenshotCrop', 'background'))
- Handle edge cases:
  - Crop dimensions <= 0 (return error)
  - Crop outside image bounds (clamp to bounds)
  - Canvas context creation failure (log and throw)
- Return cropped image as base64 dataURL

**Implementation Details**:
1. Create async function `cropImage(dataUrl: string, cropRect: CropRect): Promise<string>`
2. Convert dataURL to Blob using fetch
3. Create ImageBitmap from Blob
4. Create OffscreenCanvas with crop dimensions
5. Draw cropped section using drawImage with source/dest rects
6. Convert to Blob, then back to dataURL
7. Log success with final dimensions

**Testing**:
- Small crop (100x100px)
- Large crop (full viewport)
- Edge crop (near image borders)
- Invalid crop (negative dimensions) - should error
- Verify cropped image dimensions match crop rect

**Update**:
- Mark "Screenshot cropping" as ✅ in docs/FEATURE-PARITY-CHECKLIST.md
- Add comment about implementation in checklist
```

**Copilot implements**: Multiple files, full feature.

### Phase 3: Cleanup (Free - Inline Chat)

**You notice**: Some TypeScript errors, missing null checks.

**You do** (Ctrl+I on error):
```
"Fix this TypeScript error"
"Add null check for canvas context"
"Improve error message"
```

**Result**: Clean, type-safe code.

### Phase 4: Testing (Manual)

```bash
# Reload extension
chrome://extensions/ → Reload

# Test cases
1. Visit any webpage
2. Press Ctrl+Shift+A (screenshot shortcut)
3. Drag to select small area
4. Save to Trilium
5. Check image in Trilium - should be cropped

# Check logs
- Open extension Logs page
- Search "crop"
- Should see "Screenshot cropped" with dimensions
- Should see "Screenshot captured" with dimensions
- No errors

# Test edge cases
- Try very small crop (10x10)
- Try very large crop (full page)
- Try crop at page edge
```

### Phase 5: Documentation (Manual)

```bash
# Update checklist
# In docs/FEATURE-PARITY-CHECKLIST.md:
## Content Processing
| Screenshot cropping | ✅ | Using OffscreenCanvas | - |

# Commit
git add docs/FEATURE-PARITY-CHECKLIST.md src/background/index.ts
git commit -m "feat: implement screenshot cropping with OffscreenCanvas

- Add cropImage function using OffscreenCanvas API
- Update captureScreenshot handler to apply crop
- Handle edge cases (invalid dimensions, out of bounds)
- Add comprehensive logging and error handling
- Tested with various crop sizes and positions

Closes #XX (if issue exists)"

# Push when ready
git push origin feature/screenshot-cropping
```

**Total Time**: 
- Planning: 10 min (free)
- Implementation: 5 min (1 task)
- Cleanup: 5 min (free)
- Testing: 15 min (manual)
- Documentation: 5 min (manual)
- **Total**: ~40 minutes, 1 task used

---

## Troubleshooting Copilot Issues

### Issue: Copilot Not Using copilot-instructions.md

**Check**:
1. File must be at `.github/copilot-instructions.md`
2. VS Code setting must reference it
3. Restart VS Code after creating file

**Fix**:
```json
// In .vscode/settings.json
{
  "github.copilot.chat.codeGeneration.instructions": [
    {
      "file": ".github/copilot-instructions.md"
    }
  ]
}
```

### Issue: Copilot Suggests Wrong Patterns

**Cause**: Instructions too vague or missing context

**Fix**: Be more specific in prompts
```
# ❌ Vague
"Add screenshot feature"

# ✅ Specific
"Implement screenshot cropping using OffscreenCanvas API.
See Pattern 3 in docs/MIGRATION-PATTERNS.md.
Target file: src/background/index.ts around line 500."
```

### Issue: Copilot Runs Out of Context

**Cause**: Trying to process too many files at once

**Fix**: Break into smaller tasks
```
# ❌ Too broad
"Implement all screenshot features"

# ✅ Focused
"Implement screenshot cropping in src/background/index.ts"
[Then in next task]
"Add screenshot selection UI improvements in src/content/screenshot.ts"
```

### Issue: Generated Code Doesn't Follow Project Patterns

**Cause**: Copilot didn't read migration patterns

**Fix**: Reference specific patterns
```
"Implement X using Pattern Y from docs/MIGRATION-PATTERNS.md.
Use centralized logging (Logger.create).
Use theme system for UI."
```

---

## Advanced Tips

### Tip 1: Pre-Load Context in Chat

Before using Agent mode, load context in Chat Pane:

```
# In Chat Pane (free):
"Review docs/MIGRATION-PATTERNS.md Pattern 3"
"Review apps/web-clipper/background.js:393-427"
"Review docs/FEATURE-PARITY-CHECKLIST.md screenshot section"

# Then use Agent mode with:
"Now implement screenshot cropping as discussed"
```

**Benefit**: Copilot has context loaded, better results.

### Tip 2: Use Multi-Turn Conversations

Instead of one complex prompt, break into conversation:

```
# Turn 1 (Chat Pane):
"What's the best way to crop screenshots in MV3 service worker?"

# Turn 2:
"Show me example code using OffscreenCanvas"

# Turn 3:
"Now adapt that for our project structure. 
Target: src/background/index.ts, use our Logger"

# Turn 4 (Agent Mode):
"Implement this in the project"
```

**Benefit**: Iterative refinement, only uses 1 task at the end.

### Tip 3: Create Code Snippets for Common Patterns

In VS Code, create snippets (File → Preferences → User Snippets):

```json
{
  "Message Handler": {
    "prefix": "msg-handler",
    "body": [
      "chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {",
      "  (async () => {",
      "    try {",
      "      const result = await handle${1:Action}(message);",
      "      sendResponse({ success: true, data: result });",
      "    } catch (error) {",
      "      logger.error('${1:Action} handler error', error);",
      "      sendResponse({ success: false, error: error.message });",
      "    }",
      "  })();",
      "  return true;",
      "});"
    ]
  }
}
```

**Benefit**: Common patterns without using any Copilot resources.

### Tip 4: Batch Similar Tasks

When implementing multiple similar features:

```
# Instead of 3 separate Agent tasks:
Task 1: Add "Save Tabs" context menu
Task 2: Add "Save Tabs" handler
Task 3: Add "Save Tabs" to manifest

# Do in 1 Agent task:
"Implement complete 'Save Tabs' feature:
- Add context menu item
- Add message handler in background
- Update manifest permissions
- Add to docs/FEATURE-PARITY-CHECKLIST.md"
```

**Benefit**: 3x fewer tasks used.

### Tip 5: Use Git Diffs for Review

Before committing, review with Copilot:

```
# In Chat Pane (free):
"Review my changes in src/background/index.ts.
Check for:
- Proper error handling
- Centralized logging
- Type safety
- Edge cases"
```

**Benefit**: Code review without using a task.

---

## Measuring Success

Track these metrics to optimize your workflow:

### Time Metrics
- **Planning time**: How long to prepare a good prompt
- **Implementation time**: How long Copilot takes
- **Cleanup time**: How much fixing needed after
- **Testing time**: How long to verify functionality

**Goal**: Minimize cleanup time through better prompts.

### Quality Metrics
- **First-time success rate**: Does implementation work immediately?
- **Error count**: How many TypeScript/runtime errors?
- **Test pass rate**: Does it work in all test scenarios?

**Goal**: >80% first-time success rate.

### Efficiency Metrics
- **Tasks used per feature**: How many Agent mode tasks?
- **Rework count**: How many times did you need to fix?
- **Documentation accuracy**: Are docs up to date?

**Goal**: <2 tasks per feature on average.

---

## Project Completion Roadmap

Using this workflow, here's your path to completion:

### Phase 2: Screenshot Features (Current)
- [ ] Task 1: Implement screenshot cropping (~40 min, 1 task)
- [ ] Task 2: Verify/improve screenshot selection UI (~30 min, 1 task)
- [ ] Manual: Update documentation and testing (~20 min)
- **Total**: ~90 minutes, 2 tasks

### Phase 3: Image Processing
- [ ] Task 3: Apply image processing to all captures (~45 min, 1 task)
- [ ] Manual: Test with various image types (~30 min)
- [ ] Manual: Update documentation (~15 min)
- **Total**: ~90 minutes, 1 task

### Phase 4: Quality of Life Features
- [ ] Task 4: Implement "Save Tabs" (~40 min, 1 task)
- [ ] Task 5: Add "Already Visited" detection (~35 min, 1 task)
- [ ] Task 6: Add custom note text for links (~30 min, 1 task)
- [ ] Manual: Comprehensive testing (~60 min)
- [ ] Manual: Final documentation (~30 min)
- **Total**: ~3 hours, 3 tasks

### Phase 5: Polish & PR
- [ ] Manual: Full feature testing (~2 hours)
- [ ] Task 7: Final refactoring (if needed) (~30 min, 1 task)
- [ ] Manual: Write PR description (~30 min)
- [ ] Manual: Address review comments (varies)
- **Total**: ~3+ hours, 1 task

**Grand Total**: 
- ~7-8 hours of development
- ~8 Agent mode tasks
- Ready for production PR

---

## Quick Reference Card

Print or keep open while developing:

```
╔════════════════════════════════════════════════════╗
║         COPILOT WORKFLOW QUICK REFERENCE           ║
╠════════════════════════════════════════════════════╣
║ PLANNING (Free)                                    ║
║ • Ctrl+Alt+I → Ask questions                       ║
║ • Review legacy code in chat                       ║
║ • Check docs/MIGRATION-PATTERNS.md                 ║
║ • Plan which files to modify                       ║
╠════════════════════════════════════════════════════╣
║ IMPLEMENTING (Uses Task)                           ║
║ • Copy template from COPILOT-TASK-TEMPLATES.md     ║
║ • Fill in all blanks                               ║
║ • Paste to Agent mode                              ║
║ • Let it work                                      ║
╠════════════════════════════════════════════════════╣
║ CLEANUP (Free)                                     ║
║ • Ctrl+I → Fix TypeScript errors                   ║
║ • Ctrl+I → Add logging/types                       ║
║ • Shift+Alt+F → Format code                        ║
╠════════════════════════════════════════════════════╣
║ TESTING (Manual)                                   ║
║ • chrome://extensions/ → Reload                    ║
║ • Test happy path + edge cases                     ║
║ • Check Logs page                                  ║
║ • Verify consoles (SW, popup, content)             ║
╠════════════════════════════════════════════════════╣
║ DOCUMENTING (Manual)                               ║
║ • Update docs/FEATURE-PARITY-CHECKLIST.md          ║
║ • git commit -m "feat: description"                ║
╠════════════════════════════════════════════════════╣
║ KEY FILES                                          ║
║ • .github/copilot-instructions.md (auto-loaded)    ║
║ • docs/FEATURE-PARITY-CHECKLIST.md (status)        ║
║ • docs/MIGRATION-PATTERNS.md (code patterns)       ║
║ • COPILOT-TASK-TEMPLATES.md (copy-paste)           ║
╠════════════════════════════════════════════════════╣
║ ALWAYS INCLUDE IN PROMPTS                          ║
║ • Target files with line numbers                   ║
║ • Reference to relevant pattern/docs               ║
║ • "Use centralized logging"                        ║
║ • "Update FEATURE-PARITY-CHECKLIST.md"             ║
╚════════════════════════════════════════════════════╝
```

---

## Next Steps

1. **Right Now**: 
   - Create the new file structure
   - Copy content from artifacts to new files
   - Review and understand the workflow

2. **Today**:
   - Implement one small feature using the workflow
   - Get comfortable with the templates
   - Measure your time and task usage

3. **This Week**:
   - Complete Phase 2 (Screenshot Features)
   - Refine your prompts based on results
   - Update templates if needed

4. **This Month**:
   - Complete Phases 3-4
   - Prepare pull request
   - Document any workflow improvements

---

**Remember**: The goal is to work smarter, not harder. Good preparation = better results = fewer tasks used = faster completion!

Ready to implement! 🚀