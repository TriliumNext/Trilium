# Security Policy

## Supported Versions

Only the latest stable minor release receives security fixes.

For example, if the latest stable version is 0.92.3 and the latest beta is 0.93.0-beta, then only the 0.92.x line will receive security patches. Older versions (like 0.91.x) will not receive fixes.

This policy may be altered on a case-by-case basis for critical vulnerabilities.

## Reporting a Vulnerability

**Please report all security vulnerabilities through [GitHub Security Advisories](https://github.com/TriliumNext/Notes/security/advisories/new).**

We do not accept security reports via email, public issues, or other channels. GitHub Security Advisories allows us to:
- Discuss and triage vulnerabilities privately
- Coordinate fixes before public disclosure
- Credit reporters appropriately
- Publish advisories with CVE identifiers

### What to Include

When reporting, please provide:
- A clear description of the vulnerability
- Steps to reproduce or proof-of-concept
- Affected versions (if known)
- Potential impact assessment
- Any suggested mitigations or fixes

### Response Timeline

- **Initial response**: Within 7 days
- **Triage decision**: Within 14 days
- **Fix timeline**: Depends on severity and complexity

## Scope

### In Scope

- Remote code execution
- Authentication/authorization bypass
- Cross-site scripting (XSS) that affects other users
- SQL injection
- Path traversal
- Sensitive data exposure
- Privilege escalation

### Out of Scope (Won't Fix)

The following are considered out of scope or accepted risks:

#### Self-XSS / Self-Injection
Trilium is a personal knowledge base where users have full control over their own data. Users can intentionally create notes containing scripts, HTML, or other executable content. This is by design - Trilium's scripting system allows users to extend functionality with custom JavaScript.

Vulnerabilities that require a user to inject malicious content into their own notes and then view it themselves are not considered security issues.

#### Electron Architecture
The desktop application follows the Electron security checklist: `nodeIntegration` is disabled, `contextIsolation` is enabled, and the renderer can only reach the main process through a whitelisted `contextBridge` API (`window.electronApi`). Embedded web content (Web View notes) is isolated in a dedicated session partition with deny-by-default permission handlers, `<webview>` attach requests are vetted in the main process, and window-open/navigation requests are checked against a scheme allowlist. Electron fuses additionally prevent external abuse.

User scripting (see Self-XSS above) still intentionally allows arbitrary JavaScript in the renderer, so reports that reduce to "a user script can call the frontend API" remain out of scope. Renderer-to-main escapes, however, **are in scope**: gaining Node.js access from the renderer, bypassing the preload bridge whitelist, or escaping the webview isolation.

#### Authenticated User Actions
Actions that require valid authentication and only affect the authenticated user's own data are generally not vulnerabilities.

#### Denial of Service via Resource Exhaustion
Creating extremely large notes or performing many operations is expected user behavior in a note-taking application.

#### Missing Security Headers on Non-Sensitive Endpoints
We implement security headers where they provide meaningful protection, but may omit them on endpoints where they provide no practical benefit.

## Coordinated Disclosure

We follow a coordinated disclosure process:

1. **Report received** - We acknowledge receipt and begin triage
2. **Fix developed** - We develop and test a fix privately
3. **Release prepared** - Security release is prepared with vague changelog
4. **Users notified** - Release is published, users encouraged to upgrade
5. **Advisory published** - After reasonable upgrade window (typically 2-4 weeks), full advisory is published

We appreciate reporters allowing us time to fix issues before public disclosure. We aim to credit all reporters in published advisories unless they prefer to remain anonymous.

## Security Updates

Security fixes are released as patch versions (e.g., 0.92.1 → 0.92.2) to minimize upgrade friction. We recommend all users keep their installations up to date.

Subscribe to GitHub releases or watch the repository to receive notifications of new releases.
