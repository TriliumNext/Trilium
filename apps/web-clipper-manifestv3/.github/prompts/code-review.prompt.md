---
name: code-review
description: Review code changes for quality, security, and best practices
argument-hint: Specify files or describe changes to review
agent: agent
tools:
  - changes
  - codebase
  - problems
  - search
  - usages
---

# Code Review Prompt

You are performing a **code review** for the Trilium Web Clipper MV3 extension. Evaluate changes against project standards, security requirements, and best practices.

## Review Checklist

### 1. TypeScript Quality

- [ ] No `any` types (use proper typing)
- [ ] Interfaces for object shapes
- [ ] Type guards for runtime checking
- [ ] Proper null/undefined handling
- [ ] Consistent naming conventions

```typescript
// ❌ Avoid
function handle(data: any): any { }

// ✅ Expect
function handleClipData(data: ClipContent): ProcessedResult { }
```

### 2. MV3 Compliance

- [ ] No persistent background page patterns
- [ ] State persisted to chrome.storage
- [ ] Async message handlers return `true`
- [ ] No setTimeout/setInterval in service worker (use chrome.alarms)
- [ ] Proper use of chrome.scripting for content injection

### 3. Security Review

- [ ] All HTML sanitized with DOMPurify
- [ ] No `innerHTML` with untrusted content
- [ ] No `eval()` or `new Function()`
- [ ] User input validated
- [ ] Credentials stored securely
- [ ] Minimal permissions requested

```typescript
// ❌ Security risk
element.innerHTML = userContent;

// ✅ Safe
element.innerHTML = DOMPurify.sanitize(userContent);
```

### 4. Error Handling

- [ ] Try/catch for async operations
- [ ] User-friendly error messages
- [ ] Errors logged for debugging
- [ ] Graceful degradation

```typescript
// ✅ Proper error handling
try {
  const result = await saveToTrilium(content);
  showSuccess('Saved successfully');
} catch (error) {
  console.error('[Save] Failed:', error);
  showError('Failed to save. Check your connection.');
}
```

### 5. Code Organization

- [ ] Single responsibility principle
- [ ] Functions are small and focused
- [ ] Logic in appropriate component (background/content/popup)
- [ ] Shared code in utilities
- [ ] No code duplication

### 6. Performance

- [ ] No unnecessary storage reads
- [ ] Efficient message passing
- [ ] Appropriate use of async/await
- [ ] No memory leaks (cleanup listeners)

### 7. Maintainability

- [ ] Clear naming (self-documenting)
- [ ] Comments for complex logic
- [ ] Consistent code style
- [ ] No magic numbers/strings (use constants)

## Review Categories

### Critical (Must Fix)
- Security vulnerabilities
- MV3 compliance issues
- Type safety violations
- Runtime errors

### Important (Should Fix)
- Error handling gaps
- Performance issues
- Code organization problems
- Missing validation

### Suggestions (Nice to Have)
- Code style improvements
- Documentation additions
- Refactoring opportunities
- Test coverage

## Reference Agents

- [TypeScript Quality Engineer](../agents/typescript-quality-engineer.md) - Code standards
- [Security & Privacy Specialist](../agents/security-privacy-specialist.md) - Security review
- [Chrome Extension Architect](../agents/chrome-extension-architect.md) - MV3 patterns

## Review Commands

```bash
npm run type-check   # Verify types
npm run lint         # Check style
npm run build        # Ensure builds
```

## Review Output Format

```markdown
## Review Summary

**Overall**: ✅ Approve / ⚠️ Request Changes / ❌ Block

### Critical Issues
- [File:Line] Issue description

### Important Issues
- [File:Line] Issue description

### Suggestions
- [File:Line] Suggestion description

### Positive Notes
- Good patterns observed
```
