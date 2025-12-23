---
name: maintenance
description: Routine maintenance tasks - dependency updates, refactoring, performance optimization
agent: agent
tools:
  - changes
  - codebase
  - editFiles
  - problems
  - runCommands
  - search
  - usages
---

# Maintenance Phase Prompt

You are assisting with **routine maintenance** of the Trilium Web Clipper MV3 extension. This includes dependency updates, refactoring, performance optimization, and technical debt reduction.

## Maintenance Categories

### 1. Dependency Updates

When updating dependencies:
- Check for breaking changes in changelogs
- Run `npm run type-check` after updates
- Test core functionality (save selection, save page, screenshot)
- Pay special attention to:
  - `dompurify` - Security critical, review sanitization behavior
  - `turndown` - Markdown conversion compatibility
  - `@types/chrome` - API type definitions

```bash
npm outdated           # Check for updates
npm update             # Update within semver
npm run type-check     # Verify types
npm run build          # Test build
```

### 2. Code Refactoring

Refactoring guidelines:
- Maintain strict TypeScript compliance
- Preserve service worker compatibility
- Keep functions small and testable
- Improve type definitions where possible
- Extract shared logic to utility modules

### 3. Performance Optimization

Focus areas:
- Service worker startup time
- Content script injection speed
- Storage read/write efficiency
- Message passing overhead
- Build output size

### 4. Technical Debt

Common debt items:
- Replace `any` types with proper typing
- Add missing error handling
- Improve logging consistency
- Update outdated patterns
- Remove dead code

## Reference Agents

- [TypeScript Quality Engineer](../agents/typescript-quality-engineer.md) - Code quality and refactoring
- [Chrome Extension Architect](../agents/chrome-extension-architect.md) - Architecture decisions
- [TriliumNext Repo Expert](../agents/triliumnext-repo-expert.md) - Monorepo conventions

## Maintenance Checklist

Before completing maintenance:
- [ ] `npm run type-check` passes
- [ ] `npm run lint` passes
- [ ] `npm run build` succeeds
- [ ] No new TypeScript errors
- [ ] Core functionality tested manually
- [ ] Changes documented if user-facing

## Code Quality Standards

```typescript
// ❌ Avoid
function process(data: any): any {
  // ...
}

// ✅ Prefer
function processClipData(data: ClipContent): ProcessedContent {
  // ...
}
```

## Common Maintenance Commands

```bash
npm run type-check   # Check TypeScript
npm run lint         # Lint and auto-fix
npm run build        # Production build
npm run dev          # Development mode
npm run clean        # Clear dist folder
```
