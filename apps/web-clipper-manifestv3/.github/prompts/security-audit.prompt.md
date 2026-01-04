---
name: security-audit
description: Perform security audit focusing on XSS prevention, CSP, and data handling
argument-hint: Specify scope or leave empty for full audit
agent: agent
tools:
  - codebase
  - problems
  - search
  - usages
---

# Security Audit Prompt

You are performing a **security audit** of the Trilium Web Clipper MV3 extension. Focus on identifying vulnerabilities and ensuring secure coding practices.

## Security Audit Scope

### 1. XSS Prevention

**Critical Areas**:
- Any use of `innerHTML`, `outerHTML`
- Dynamic script generation
- URL handling and redirects
- HTML content from web pages

**Audit Checks**:
```typescript
// Search for dangerous patterns
innerHTML        // Must use DOMPurify
outerHTML        // Must sanitize
insertAdjacentHTML  // Must sanitize
document.write   // Should not exist
eval(            // Should not exist
new Function(    // Should not exist
```

**Required Pattern**:
```typescript
import DOMPurify from 'dompurify';

// ✅ All HTML must be sanitized
const safeHtml = DOMPurify.sanitize(untrustedHtml, {
  ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'a', 'img', 'ul', 'ol', 'li'],
  ALLOWED_ATTR: ['href', 'src', 'alt', 'title'],
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed'],
  FORBID_ATTR: ['onerror', 'onload', 'onclick']
});
```

### 2. Content Security Policy

**Manifest CSP**:
```json
{
  "content_security_policy": {
    "extension_pages": "script-src 'self'; object-src 'self'"
  }
}
```

**Verify**:
- [ ] No inline scripts in HTML files
- [ ] No `unsafe-eval` in CSP
- [ ] No `unsafe-inline` in CSP
- [ ] External resources properly restricted

### 3. Credential Storage

**Audit**:
- [ ] Tokens stored in `chrome.storage.local` (not sync)
- [ ] No credentials in code or logs
- [ ] Tokens not exposed to content scripts
- [ ] Secure transmission (HTTPS encouraged)

```typescript
// ✅ Secure token storage
await chrome.storage.local.set({ 
  triliumToken: token  // Local only, not synced
});

// ❌ Never log credentials
console.log('Token:', token); // SECURITY RISK
```

### 4. Message Passing Security

**Verify**:
- [ ] Message origin validation
- [ ] No sensitive data to content scripts
- [ ] Type checking on received messages

```typescript
// ✅ Validate message types
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Validate sender
  if (!sender.tab?.id) {
    return false;
  }
  
  // Validate message structure
  if (!isValidMessage(message)) {
    console.warn('Invalid message received');
    return false;
  }
  
  // Process...
});
```

### 5. Input Validation

**All User Input**:
- [ ] URL validation
- [ ] Title/content length limits
- [ ] Special character handling
- [ ] Null/undefined checks

```typescript
// ✅ Validate URLs
function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}
```

### 6. Permission Minimization

**Review manifest.json**:
- [ ] Only required permissions
- [ ] Prefer optional permissions
- [ ] Host permissions scoped appropriately
- [ ] No unnecessary `<all_urls>`

### 7. Third-Party Dependencies

**Audit**:
- `dompurify` - Security critical, keep updated
- `turndown` - Review for vulnerabilities
- `webextension-polyfill` - Standard, low risk
- `cheerio` - Review HTML parsing security

```bash
npm audit              # Check for vulnerabilities
npm audit fix          # Auto-fix if possible
```

## Security Reference

See [Security & Privacy Specialist](../agents/security-privacy-specialist.md) for detailed security guidelines.

## Audit Output Format

```markdown
## Security Audit Report

**Date**: YYYY-MM-DD
**Scope**: [Full / Specific area]

### Critical Findings
🔴 [Finding] - [Location] - [Remediation]

### High Priority
🟠 [Finding] - [Location] - [Remediation]

### Medium Priority
🟡 [Finding] - [Location] - [Remediation]

### Low Priority
🟢 [Finding] - [Location] - [Remediation]

### Passed Checks
✅ [Check description]

### Recommendations
- [Improvement suggestion]
```

## Common Vulnerability Patterns

| Pattern | Risk | Fix |
|---------|------|-----|
| `innerHTML = userInput` | XSS | Use DOMPurify |
| `eval(userInput)` | RCE | Remove eval |
| Logging credentials | Exposure | Remove logging |
| HTTP API calls | MITM | Use HTTPS |
| `<all_urls>` permission | Over-privileged | Scope permissions |
