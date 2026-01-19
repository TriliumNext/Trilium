---
name: build-out
description: Active development phase for building core features and architecture of the MV3 Web Clipper
agent: agent
tools:
  - changes
  - codebase
  - editFiles
  - fetch
  - githubRepo
  - problems
  - runCommands
  - search
  - terminalLastCommand
  - terminalSelection
  - testFailure
  - usages
---

# Build-Out Phase Prompt

You are assisting with the **active build-out phase** of the Trilium Web Clipper Manifest V3 migration. This is new development work converting the legacy MV2 extension to a modern MV3 architecture.

## Context

This extension saves web content to [Trilium Notes](https://github.com/TriliumNext/Trilium). We are building a TypeScript-based MV3 extension with:

- Service worker background script (not persistent background page)
- Content scripts for page interaction
- Modern Chrome APIs (chrome.scripting, chrome.storage, etc.)
- DOMPurify for HTML sanitization
- Turndown for HTML→Markdown conversion

## Key Architecture Constraints

### Service Worker Requirements
- Service workers terminate when idle - NO persistent state
- All state must use `chrome.storage.local` or `chrome.storage.sync`
- Use `chrome.alarms` instead of `setTimeout`/`setInterval`
- Message handlers MUST return `true` for async responses
- Use offscreen documents for DOM/Canvas operations

### Code Standards
- Strict TypeScript with all checks enabled
- Interfaces for object shapes, type aliases for unions
- Comprehensive error handling with user feedback
- No `any` types - use proper typing
- DOMPurify for ALL HTML sanitization

## Reference Agents

Consult these specialized agents for domain expertise:
- [Chrome Extension Architect](../agents/chrome-extension-architect.md) - MV3 patterns and service workers
- [TypeScript Quality Engineer](../agents/typescript-quality-engineer.md) - Type safety and code quality
- [Trilium Integration Expert](../agents/trilium-integration-expert.md) - ETAPI and note creation
- [Security & Privacy Specialist](../agents/security-privacy-specialist.md) - XSS prevention and CSP
- [UI/UX Consistency Expert](../agents/ui-ux-consistency-expert.md) - Interface design patterns

## Build-Out Priorities

1. **Core Functionality First** - Ensure basic clipping works reliably
2. **Service Worker Stability** - Handle lifecycle correctly
3. **Type Safety** - Strict typing throughout
4. **Error Handling** - Graceful failures with user feedback
5. **Security** - Sanitize all HTML, validate all input

## When Building Features

1. Check if similar functionality exists in `reference/` (legacy MV2 code)
2. Adapt patterns to MV3 requirements (service worker, async storage)
3. Add proper TypeScript types
4. Include error handling and logging
5. Consider security implications
6. Write code that's testable

## Commands Available

```bash
npm run dev          # Watch mode development
npm run build        # Production build
npm run type-check   # TypeScript validation
npm run lint         # ESLint check
```

## Current Focus Areas

- Service worker message handling
- Content script injection
- Trilium API integration (ETAPI)
- Screenshot capture (offscreen documents)
- Settings management
- Popup UI functionality
