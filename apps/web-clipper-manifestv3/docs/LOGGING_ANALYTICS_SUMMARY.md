# Code Block Preservation: Logging and Analytics Summary

## Overview

All code block preservation modules use a centralized logging system (`Logger.create()`) that provides:
- Structured, contextual logging with rich metadata
- Proper log levels (debug, info, warn, error)
- Storage-backed logs for debugging
- Production-ready configuration
- Privacy-conscious design (no PII)

## Module Coverage

### 1. Code Block Detection (`src/shared/code-block-detection.ts`)

**Logger**: `Logger.create('CodeBlockDetection', 'content')`

**Logged Events**:
- Starting code block detection with options
- Number of potential code elements found (pre/code tags)
- Analysis of individual elements (success/error)
- Detection complete with statistics (total, block-level, inline)
- Individual code block analysis (type, length, characteristics)
- Element ancestry and context analysis
- Syntax highlighting detection
- Importance score calculation

**Key Metrics Tracked**:
- Total code blocks found
- Block-level vs inline code count
- Processing errors per element
- Element characteristics (length, line count, classes)

### 2. Code Block Settings (`src/shared/code-block-settings.ts`)

**Logger**: `Logger.create('CodeBlockSettings', 'background')`

**Logged Events**:
- Loading settings from storage
- Settings loaded successfully with counts
- Using default settings (first run)
- Saving settings with summary
- Settings saved successfully
- Initializing default settings
- Adding/removing/toggling allow list entries
- Domain/URL validation results
- URL matching decisions
- Settings validation and merging

**Key Metrics Tracked**:
- Settings enabled/disabled state
- Auto-detect enabled/disabled state
- Allow list entry count
- Custom vs default entries
- Validation success/failure

### 3. Article Extraction (`src/shared/article-extraction.ts`)

**Logger**: `Logger.create('ArticleExtraction', 'content')`

**Logged Events**:
- Starting article extraction with settings
- Fast code block check results
- Code blocks detected with count
- Preservation decision logic
- Extraction method selected (vanilla vs code-preservation)
- Extraction complete with comprehensive stats
- Settings load/save operations
- Extraction failures with fallback handling

**Key Metrics Tracked**:
- URL being processed
- Settings configuration
- Code block presence (boolean)
- Code block count
- Preservation decision (yes/no + reason)
- Extraction method used
- Content length
- Title, byline, excerpt metadata
- Code blocks preserved count
- Performance characteristics

### 4. Readability Code Preservation (`src/shared/readability-code-preservation.ts`)

**Logger**: `Logger.create('ReadabilityCodePreservation', 'content')`

**Logged Events**:
- Starting extraction with preservation
- Code block marking operations
- Number of elements marked
- Monkey-patch application
- Original method storage
- Method restoration
- Preservation decisions per element
- Skipping clean/remove for preserved elements
- Extraction complete with stats
- Cleanup operations

**Key Metrics Tracked**:
- Number of blocks marked for preservation
- Monkey-patch success/failure
- Elements skipped during cleaning
- Final preserved block count
- Method restoration status

### 5. Allow List Settings Page (`src/options/codeblock-allowlist.ts`)

**Logger**: `Logger.create('CodeBlockAllowList', 'options')`

**Logged Events**:
- Page initialization
- Settings rendering
- Allow list rendering with count
- Event listener setup
- Master toggle changes
- Entry addition with validation
- Entry removal with confirmation
- Entry toggling
- Form validation results
- UI state updates
- Save/load operations

**Key Metrics Tracked**:
- Total entries in allow list
- Add/remove/toggle operations
- Validation success/failure
- User actions (clicks, changes)
- Settings state changes

### 6. Content Script Integration (`src/content/index.ts`)

**Logger**: `Logger.create('WebClipper', 'content')`

**Logged Events**:
- Phase 1: Starting article extraction
- Pre-extraction DOM statistics
- Extraction result metadata
- Post-extraction content statistics
- Elements removed during extraction
- Content reduction percentage
- Code block preservation results
- Extraction method used

**Key Metrics Tracked**:
- Total DOM elements (before/after)
- Element types (paragraphs, headings, images, links, tables, code blocks)
- Content length
- Extraction efficiency (reduction %)
- Preservation applied (yes/no)
- Code blocks preserved count
- Code blocks detected count

## Log Levels Usage

### DEBUG
Used for detailed internal state and operations:
- Method entry/exit
- Internal calculations
- Loop iterations
- Detailed element analysis
- Method storage/restoration

### INFO
Used for normal operations and key milestones:
- Feature initialization
- Operation completion
- Important state changes
- Successful operations
- Key decisions made

### WARN
Used for recoverable issues:
- Invalid inputs that can be handled
- Missing optional data
- Fallback scenarios
- User attempting invalid operations
- Configuration issues

### ERROR
Used for actual errors:
- Operation failures
- Invalid required data
- Unrecoverable conditions
- Exception catching
- Data corruption

## Privacy and Security

**No PII Logged**:
- URLs are logged (necessary for debugging)
- Page titles are logged (necessary for debugging)
- No user identification
- No personal data
- No authentication tokens
- No sensitive content

**What is Logged**:
- Technical metadata
- Configuration values
- Performance metrics
- Operation results
- Error conditions
- DOM structure stats

## Performance Considerations

**Logging Impact**:
- Minimal performance overhead
- Logs stored efficiently in chrome.storage.local
- Automatic log rotation (keeps last 1000 entries)
- Debug logs can be filtered in production
- No blocking operations

**Production Mode**:
- Debug logs still captured but can be filtered
- Error logs always captured
- Info logs provide user-visible status
- Warn logs highlight potential issues

## Debugging Workflow

### Viewing Logs

1. **Extension Logs Page**: Navigate to `chrome-extension://<ID>/logs/index.html`
2. **Browser Console**: Filter by logger name (e.g., "CodeBlockDetection")
3. **Background DevTools**: For background script logs
4. **Content Script DevTools**: For content script logs

### Common Debug Scenarios

**Code blocks not preserved**:
1. Check `CodeBlockDetection` logs for detection results
2. Check `ArticleExtraction` logs for preservation decision
3. Check `CodeBlockSettings` logs for allow list matching
4. Check `ReadabilityCodePreservation` logs for monkey-patch status

**Settings not saving**:
1. Check `CodeBlockSettings` logs for save operations
2. Check browser console for storage errors
3. Verify chrome.storage.sync permissions

**Performance issues**:
1. Check extraction time in `ArticleExtraction` logs
2. Check code block count in `CodeBlockDetection` logs
3. Review DOM stats in content script logs

**Allow list not working**:
1. Check `CodeBlockSettings` logs for URL matching
2. Verify domain/URL format in validation logs
3. Check enabled state in settings logs

## Analytics Opportunities (Future)

The current logging system captures sufficient data for analytics:

**Preservation Metrics**:
- Success rate (preserved vs attempted)
- Most preserved sites
- Average code blocks per page
- Preservation vs vanilla extraction usage

**Performance Metrics**:
- Extraction time distribution
- DOM size impact
- Code block count distribution
- Browser performance

**User Behavior** (anonymous):
- Most common allow list entries
- Auto-detect usage
- Custom entries added
- Feature enable/disable patterns

**Note**: Analytics would require:
- Explicit user consent
- Opt-in mechanism
- Privacy policy update
- Aggregation server
- No PII collection

## Log Storage

**Storage Location**: `chrome.storage.local` with key `centralizedLogs`

**Storage Limits**:
- Maximum 1000 log entries
- Oldest entries automatically removed
- Estimated ~5MB storage usage
- No quota concerns for normal usage

**Log Entry Format**:
```typescript
{
  timestamp: '2025-11-09T12:34:56.789Z',
  level: 'info' | 'debug' | 'warn' | 'error',
  loggerName: 'CodeBlockDetection',
  context: 'content',
  message: 'Code block detection complete',
  args: { totalFound: 12, blockLevel: 10, inline: 2 },
  error?: { name: 'Error', message: 'Details', stack: '...' }
}
```

## Best Practices

1. **Use appropriate log levels** - Don't log debug info as errors
2. **Include context** - Add metadata objects for structured data
3. **Be specific** - Describe what's happening, not just "error"
4. **Don't log sensitive data** - No passwords, tokens, personal info
5. **Use structured data** - Pass objects, not concatenated strings
6. **Log at decision points** - Why was a choice made?
7. **Log performance markers** - Start/end of expensive operations
8. **Handle errors gracefully** - Log, then decide on fallback

## Example Log Output

```typescript
// Starting extraction
[INFO] ArticleExtraction: Starting article extraction
{
  url: 'https://stackoverflow.com/questions/12345',
  settings: { preserveCodeBlocks: true, autoDetect: true },
  documentTitle: 'How to preserve code blocks'
}

// Detection results
[INFO] CodeBlockDetection: Code block detection complete
{
  totalFound: 8,
  blockLevel: 7,
  inline: 1
}

// Preservation decision
[INFO] ArticleExtraction: Preservation decision
{
  shouldPreserve: true,
  hasCode: true,
  codeBlockCount: 7,
  preservationEnabled: true,
  autoDetect: true
}

// Extraction complete
[INFO] ArticleExtraction: Article extraction complete
{
  title: 'How to preserve code blocks',
  contentLength: 4532,
  extractionMethod: 'code-preservation',
  preservationApplied: true,
  codeBlocksPreserved: 7,
  codeBlocksDetected: true,
  codeBlocksDetectedCount: 8
}
```

## Conclusion

The code block preservation feature has comprehensive logging coverage across all modules, providing:
- **Visibility**: What's happening at every stage
- **Debuggability**: Rich context for troubleshooting
- **Accountability**: Clear decision trails
- **Performance**: Metrics for optimization
- **Privacy**: No personal data logged
- **Production-ready**: Configurable and efficient

All logging follows the project's centralized logging patterns and best practices outlined in `docs/MIGRATION-PATTERNS.md`.
