---
name: documentation
description: Write and update documentation for the Web Clipper extension
argument-hint: Describe what documentation you need
agent: agent
tools:
  - codebase
  - editFiles
  - search
---

# Documentation Prompt

You are writing or updating **documentation** for the Trilium Web Clipper MV3 extension. Create clear, user-friendly, and technically accurate documentation.

## Documentation Types

### 1. User Documentation

**README.md** - Primary user-facing documentation:
- Installation instructions
- Quick start guide
- Feature overview
- Configuration
- Troubleshooting

**Style Guidelines**:
- Use simple, direct language
- Include screenshots where helpful
- Provide step-by-step instructions
- Anticipate common questions
- Progressive disclosure (basic → advanced)

### 2. Developer Documentation

**Architecture docs** - Technical overview:
- Component structure
- Message flow
- State management
- Build process

**Code comments** - Inline documentation:
```typescript
/**
 * Sanitizes HTML content before storage or display.
 * 
 * Uses DOMPurify with a strict allowlist to prevent XSS attacks.
 * All content from web pages MUST be sanitized before use.
 * 
 * @param html - Raw HTML string from web page
 * @returns Sanitized HTML safe for storage and display
 * 
 * @example
 * const clean = sanitizeHtml('<p>Hello</p><script>bad</script>');
 * // Returns: '<p>Hello</p>'
 */
function sanitizeHtml(html: string): string {
  // Implementation...
}
```

### 3. API Documentation

Document interfaces and types:
```typescript
/**
 * Configuration for the Web Clipper extension.
 */
interface ExtensionConfig {
  /** URL of the Trilium server (e.g., 'http://localhost:8080') */
  triliumServerUrl: string;
  
  /** ETAPI authentication token for server connection */
  authToken?: string;
  
  /** Whether to show toast notifications after saves */
  enableToasts: boolean;
  
  /** Default parent note ID for clipped content */
  defaultParentNoteId?: string;
}
```

## Documentation Templates

### Feature Documentation
```markdown
## [Feature Name]

### Overview
Brief description of what this feature does.

### How to Use
1. Step one
2. Step two
3. Step three

### Configuration
| Setting | Description | Default |
|---------|-------------|---------|
| Setting1 | What it does | value |

### Examples
[Concrete examples with screenshots if applicable]

### Troubleshooting
**Issue**: Common problem
**Solution**: How to fix it
```

### Changelog Entry
```markdown
## [Version] - YYYY-MM-DD

### Added
- New feature description

### Changed
- What was modified

### Fixed
- Bug that was fixed

### Security
- Security-related changes
```

### Migration Guide
```markdown
## Migrating from [Old Version] to [New Version]

### Breaking Changes
- Change that requires user action

### New Features
- What's new and how to use it

### Deprecated
- What's being phased out

### Step-by-Step Migration
1. Backup your settings
2. Update the extension
3. Reconfigure [specific settings]
```

## Writing Style

### Do
- Use active voice
- Be concise
- Provide examples
- Define technical terms
- Include keyboard shortcuts

### Don't
- Use jargon without explanation
- Write walls of text
- Assume user knowledge
- Skip error scenarios
- Forget accessibility considerations

## File Locations

```
docs/
├── USER_GUIDE.md           # End-user documentation
├── DEVELOPER_GUIDE.md      # Developer documentation
├── API_REFERENCE.md        # API documentation
├── TROUBLESHOOTING.md      # Common issues
├── CHANGELOG.md            # Version history
└── ARCHITECTURE.md         # System design
```

## Reference Agent

See [Documentation Specialist](../agents/documentation-specialist.md) for comprehensive documentation standards.

## Documentation Checklist

- [ ] Accurate and up-to-date
- [ ] Spelling and grammar checked
- [ ] Code examples tested
- [ ] Links verified
- [ ] Screenshots current
- [ ] Accessible language
- [ ] Consistent formatting
