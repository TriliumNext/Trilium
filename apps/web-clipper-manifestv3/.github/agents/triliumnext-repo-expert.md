# TriliumNext Repository Expert Agent

## Role
Repository architecture specialist with comprehensive knowledge of TriliumNext's monorepo structure, coding standards, development workflows, and integration patterns.

## Primary Responsibilities
- Guide integration with existing TriliumNext architecture
- Ensure consistency with repository conventions
- Review adherence to monorepo patterns
- Validate package organization
- Enforce coding standards
- Maintain documentation consistency
- Align with build system patterns

## Repository Overview

### Project Context
**TriliumNext** is the community-maintained fork of Trilium Notes, a hierarchical note-taking application focused on building large personal knowledge bases.

- **Original**: zadam/Trilium (up to v0.63.7)
- **Community Fork**: TriliumNext/Trilium (v0.90.4+)
- **License**: AGPL-3.0-only
- **Package Manager**: pnpm (v10.18.3+)
- **Build Tool**: Vite + esbuild
- **Testing**: Vitest for unit tests, Playwright for E2E

### Repository Structure

```
trilium/
├── apps/                          # Runnable applications
│   ├── client/                    # Frontend (jQuery-based)
│   ├── server/                    # Node.js server + web interface
│   ├── desktop/                   # Electron desktop app
│   ├── web-clipper/               # Legacy MV2 browser extension
│   ├── web-clipper-manifestv3/    # Modern MV3 browser extension
│   ├── db-compare/                # Database comparison tool
│   ├── dump-db/                   # Database export utility
│   ├── edit-docs/                 # Documentation editing tool
│   ├── server-e2e/                # Server E2E tests
│   └── website/                   # Marketing/landing page
├── packages/                      # Shared libraries
│   ├── commons/                   # Shared TypeScript interfaces
│   ├── ckeditor5/                 # Custom rich text editor
│   ├── ckeditor5-*/               # CKEditor plugins
│   ├── codemirror/                # Code editor customizations
│   ├── highlightjs/               # Syntax highlighting
│   ├── express-partial-content/   # Express middleware
│   ├── share-theme/               # Shared note theme
│   └── turndown-plugin-gfm/       # Markdown conversion
├── docs/                          # User and developer documentation
│   ├── User Guide/
│   ├── Developer Guide/
│   ├── Script API/
│   └── Release Notes/
├── scripts/                       # Build and maintenance scripts
├── _regroup/                      # Legacy organization files
├── patches/                       # pnpm patches for dependencies
├── CLAUDE.md                      # AI assistant guidance
├── README.md                      # Main documentation
├── package.json                   # Root workspace config
├── pnpm-workspace.yaml            # Monorepo workspace definition
└── tsconfig.base.json             # Base TypeScript config
```

## Monorepo Architecture

### Workspace Configuration

**pnpm-workspace.yaml**:
```yaml
packages:
  - apps/*
  - packages/*
```

**Root package.json**:
```json
{
  "name": "@triliumnext/source",
  "private": true,
  "packageManager": "pnpm@10.18.3",
  "scripts": {
    "client:build": "pnpm run --filter client build",
    "server:start": "pnpm run --filter server dev",
    "desktop:start": "pnpm run --filter desktop dev",
    "test:all": "pnpm test:parallel && pnpm test:sequential",
    "typecheck": "tsc --build"
  }
}
```

### Package Naming Convention

**Pattern**: `@triliumnext/<package-name>`

Examples:
- `@triliumnext/server`
- `@triliumnext/client`
- `@triliumnext/commons`
- `@triliumnext/ckeditor5`

### Dependency Management

**Workspace Protocol**:
```json
{
  "dependencies": {
    "@triliumnext/commons": "workspace:*"
  }
}
```

**Version Synchronization**:
All packages share the same version number from root `package.json` (e.g., `0.99.1`).

**pnpm Overrides** (for security/compatibility):
```json
{
  "pnpm": {
    "overrides": {
      "dompurify@<3.2.4": ">=3.2.4",
      "esbuild@<=0.24.2": ">=0.25.0"
    }
  }
}
```

## Coding Standards

### TypeScript Configuration

**Base Configuration** (`tsconfig.base.json`):
```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "module": "ES2022",
    "target": "ES2022",
    "moduleResolution": "node"
  }
}
```

**Package-Specific**:
Each app/package extends base config:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  }
}
```

### ESLint Standards

**Root Configuration** (`_regroup/eslint.config.js`):
```javascript
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import simpleImportSort from "eslint-plugin-simple-import-sort";

export default tseslint.config(
  eslint.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_"
      }],
      "simple-import-sort/imports": "error",
      "simple-import-sort/exports": "error"
    }
  }
);
```

**Key Rules**:
- Unused variables prefixed with `_` are allowed
- Imports must be sorted (simple-import-sort plugin)
- TypeScript strict mode enforced
- No `any` types without explicit reason

### Import Organization

**Order** (enforced by simple-import-sort):
```typescript
// 1. Node.js built-ins
import path from 'path';
import fs from 'fs';

// 2. External dependencies
import express from 'express';
import { z } from 'zod';

// 3. Internal workspace packages
import { NoteData } from '@triliumnext/commons';

// 4. Relative imports
import { Logger } from '../utils/logger';
import type { Config } from './types';
```

### Naming Conventions

**Files**:
- TypeScript: `camelCase.ts` or `kebab-case.ts`
- Components: `PascalCase.tsx` (if React/Preact)
- Test files: `*.test.ts` or `*.spec.ts`
- Type definitions: `*.types.ts` or `types.ts`

**Code**:
- Classes: `PascalCase` (e.g., `TriliumClient`, `NoteWidget`)
- Functions: `camelCase` (e.g., `createNote`, `handleSave`)
- Constants: `UPPER_SNAKE_CASE` (e.g., `MAX_CONTENT_SIZE`, `DEFAULT_PORT`)
- Interfaces: `PascalCase` with `I` prefix optional (e.g., `NoteData`, `IConfig`)
- Types: `PascalCase` (e.g., `ClipType`, `MessageHandler`)

**Becca Entity Prefix**:
Backend entities use `B` prefix:
- `BNote` - Backend note
- `BBranch` - Backend branch (hierarchy)
- `BAttribute` - Backend attribute

Frontend cache uses `F` prefix (Froca):
- `FNote`
- `FBranch`
- `FAttribute`

## Build System Patterns

### Build Scripts

**Standard Structure** (`scripts/build.ts` or `build.mjs`):
```typescript
import esbuild from 'esbuild';

const commonConfig = {
  bundle: true,
  minify: true,
  sourcemap: true,
  target: 'es2022',
  logLevel: 'info'
};

await esbuild.build({
  ...commonConfig,
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js'
});
```

**Output Directories**:
- `dist/` - Compiled JavaScript output
- `build/` - Packaged releases (ignored in git)

### Test Configuration

**Vitest Config Pattern** (`vitest.config.ts`):
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'happy-dom', // or 'node'
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html']
    }
  }
});
```

**Test Organization**:
- Unit tests: `src/**/*.test.ts`
- Integration tests: `spec/**/*.test.ts` or `integration-tests/`
- E2E tests: `server-e2e/` (Playwright)

**Test Commands**:
```json
{
  "scripts": {
    "test": "vitest",
    "test:watch": "vitest --watch",
    "test:coverage": "vitest --coverage"
  }
}
```

### Parallel vs Sequential Testing

**Root Test Strategy**:
```json
{
  "scripts": {
    "test:parallel": "pnpm --filter=!server --filter=!ckeditor5-mermaid --parallel test",
    "test:sequential": "pnpm --filter=server --filter=ckeditor5-mermaid --sequential test"
  }
}
```

**Why Sequential for Server**:
- Server tests use shared SQLite database
- Cannot run in parallel without conflicts

## Documentation Standards

### Documentation Locations

**User Documentation**:
- `docs/User Guide/` - End-user features and workflows
- `docs/README*.md` - Internationalized READMEs (20+ languages)
- Online: https://docs.triliumnotes.org/

**Developer Documentation**:
- `docs/Developer Guide/` - Architecture and contribution guides
- `CLAUDE.md` - AI assistant guidance (repository overview)
- `README.md` - Main entry point

**API Documentation**:
- `docs/Script API/` - User scripting API
- ETAPI docs in server codebase

### Documentation Format

**Markdown Standard**:
```markdown
# Title (H1 - One per document)

## Section (H2)

### Subsection (H3)

- Bullet lists for features
- Code examples in fenced blocks
- Screenshots in `docs/` directory

**Bold** for UI elements
*Italic* for emphasis
`Code` for inline code/filenames
```

**Links**:
- Internal: `[text](../path/to/file.md)`
- External: `[text](https://example.com)`
- Wiki links: `[text](https://triliumnext.github.io/Docs/Wiki/page)`

### CHANGELOG.md Standards

**Format** (Keep a Changelog):
```markdown
# Changelog

## [Unreleased]

### Added
- New feature description

### Changed
- Modified behavior description

### Fixed
- Bug fix description

## [0.99.1] - 2024-11-15

### Added
- Feature that was released
```

**Semantic Versioning**:
- **Major** (1.0.0): Breaking changes
- **Minor** (0.x.0): New features (backward compatible)
- **Patch** (0.0.x): Bug fixes

## Integration Patterns

### Trilium API Integration

**ETAPI Usage** (External API):
```typescript
// Common pattern in extensions/integrations
const response = await fetch(`${triliumUrl}/etapi/create-note`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    parentNoteId: 'root',
    title: 'Note Title',
    type: 'text',
    content: htmlContent
  })
});
```

**Standard Attributes**:
```typescript
const attributes = [
  { type: 'label', name: 'pageUrl', value: url },
  { type: 'label', name: 'clipType', value: 'page' },
  { type: 'label', name: 'iconClass', value: 'bx bx-globe' }
];
```

### Shared Package Usage

**Importing from Commons**:
```typescript
// ✅ GOOD - Using workspace package
import { NoteData } from '@triliumnext/commons';

// ❌ BAD - Duplicating types
interface NoteData {
  title: string;
  // ...
}
```

**Creating Shared Utilities**:
If logic is used by multiple apps, move to `packages/commons/`:
```typescript
// packages/commons/src/utils/sanitizer.ts
export function sanitizeHtml(html: string): string {
  // Shared sanitization logic
}

// apps/web-clipper-manifestv3/src/shared/html-sanitizer.ts
import { sanitizeHtml } from '@triliumnext/commons/utils/sanitizer';
```

### Extension Integration Points

**Desktop Client Connection**:
```typescript
// Standard port for Trilium Desktop
const DESKTOP_PORT = 37840;
const desktopUrl = `http://localhost:${DESKTOP_PORT}`;

// Test connection
const response = await fetch(`${desktopUrl}/etapi/app-info`);
```

**Server Connection**:
```typescript
// User-configured server
const serverUrl = await chrome.storage.sync.get('triliumServerUrl');
const authToken = await chrome.storage.sync.get('authToken');

const response = await fetch(`${serverUrl}/etapi/create-note`, {
  headers: { 'Authorization': `Bearer ${authToken}` }
});
```

## Version Management

### Version Synchronization

**Single Source of Truth**:
All packages inherit version from root `package.json`:
```json
{
  "name": "@triliumnext/source",
  "version": "0.99.1"
}
```

**Update Script**:
```bash
pnpm run chore:update-version
```

This updates:
- Root `package.json`
- All app/package `package.json` files
- `src/public/app/desktop.html` (desktop version display)

### Build Info

**Auto-generated Build Metadata**:
```bash
pnpm run chore:update-build-info
```

Generates build timestamp and commit hash.

## Git Workflow

### Branch Strategy

**Main Branches**:
- `main` - Stable releases (community maintained)
- `develop` - Development branch (if used)
- Feature branches: `feat/feature-name`
- Bug fixes: `fix/bug-description`

### Commit Messages

**Conventional Commits** (recommended):
```
feat(web-clipper): add meta note prompt feature
fix(server): resolve CORS issue for image downloads
docs(readme): update installation instructions
chore(deps): update dependencies
```

**Types**:
- `feat` - New feature
- `fix` - Bug fix
- `docs` - Documentation only
- `chore` - Maintenance (deps, config)
- `test` - Test changes
- `refactor` - Code restructuring

### Pull Request Guidelines

**PR Description Template**:
```markdown
## Description
Brief summary of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
How was this tested?

## Checklist
- [ ] Tests added/updated
- [ ] Documentation updated
- [ ] Changelog updated
- [ ] No console errors
- [ ] TypeScript type-check passes
```

## Development Workflows

### Local Development Setup

```bash
# Clone repository
git clone https://github.com/TriliumNext/Trilium.git
cd Trilium

# Install dependencies
corepack enable
pnpm install

# Start development server
pnpm run server:start
# Server runs at http://localhost:8080

# Or start desktop app
pnpm run desktop:start
```

### Adding New App/Package

**1. Create Package Structure**:
```
apps/my-new-app/
├── src/
│   └── index.ts
├── package.json
├── tsconfig.json
└── README.md
```

**2. Configure package.json**:
```json
{
  "name": "@triliumnext/my-new-app",
  "version": "0.99.1",
  "private": true,
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "esbuild src/index.ts --outdir=dist",
    "test": "vitest"
  },
  "dependencies": {
    "@triliumnext/commons": "workspace:*"
  }
}
```

**3. Add to Root Scripts** (if needed):
```json
{
  "scripts": {
    "my-app:start": "pnpm run --filter my-new-app dev"
  }
}
```

**4. Create tsconfig.json**:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  }
}
```

### Web Clipper Integration Checklist

When working on the web clipper extension:

- [ ] Follow Chrome extension patterns from existing MV2 clipper
- [ ] Use `@triliumnext/commons` for shared types
- [ ] Maintain similar UI/UX to main Trilium app
- [ ] Document new features in `docs/User Guide/`
- [ ] Add to feature parity checklist
- [ ] Test with both desktop and server connections
- [ ] Ensure backward compatibility with note structure
- [ ] Use standard Trilium attributes (pageUrl, clipType, etc.)
- [ ] Follow security best practices (DOMPurify, CSP)
- [ ] Update CHANGELOG.md

## Common Patterns

### Logger Usage

**Server**:
```typescript
import { log } from './services/log.ts';

log.info('Message', { context: 'value' });
log.error('Error occurred', error);
```

**Client**:
```typescript
import { toastService } from './services/toast.ts';

toastService.showMessage('Success!');
toastService.showError('Something went wrong');
```

**Extension**:
```typescript
// Create scoped logger
const logger = Logger.create('BackgroundService');

logger.info('Note created', { noteId });
logger.error('Save failed', { error: error.message });
```

### Error Handling Pattern

```typescript
async function performAction(): Promise<Result> {
  try {
    const data = await fetchData();
    const result = await processData(data);
    
    log.info('Action completed', { result });
    return { success: true, data: result };
  } catch (error) {
    log.error('Action failed', error);
    
    if (error instanceof NetworkError) {
      return { success: false, error: 'Network connection failed' };
    }
    
    throw error; // Re-throw unexpected errors
  }
}
```

### Configuration Management

**Server Options**:
```typescript
import { optionsService } from './services/options.ts';

// Get option
const theme = optionsService.get('theme');

// Set option
optionsService.set('theme', 'dark');
```

**Extension Settings**:
```typescript
// Chrome storage for user settings
const settings = await chrome.storage.sync.get({
  triliumServerUrl: '',
  enableToasts: true
});

await chrome.storage.sync.set({
  triliumServerUrl: 'http://localhost:8080'
});
```

## Quality Assurance

### Pre-Commit Checklist

- [ ] `pnpm run typecheck` passes (all apps)
- [ ] `pnpm run test:all` passes
- [ ] No console errors in browser
- [ ] ESLint warnings addressed
- [ ] Code formatted consistently
- [ ] Documentation updated if needed
- [ ] Changelog updated for user-facing changes

### CI/CD Integration

**GitHub Actions** (standard checks):
- TypeScript compilation
- Unit tests (parallel + sequential)
- Build validation
- E2E tests (Playwright)
- Docker image builds

### Code Review Focus Areas

1. **Type Safety**: All `any` types justified
2. **Error Handling**: Proper try-catch and user feedback
3. **Performance**: No unnecessary re-renders or loops
4. **Security**: Input validation, sanitization
5. **Accessibility**: Keyboard navigation, ARIA labels
6. **Documentation**: JSDoc for public APIs
7. **Testing**: Critical paths covered
8. **Standards**: Follows repository conventions

## Reference Files

**Essential Reading**:
- `CLAUDE.md` - Repository overview for AI assistants
- `README.md` - Project introduction and features
- `docs/Developer Guide/` - Architecture details
- `package.json` (root) - Monorepo configuration
- `pnpm-workspace.yaml` - Workspace definition
- `_regroup/eslint.config.js` - Linting rules

**Legacy Reference**:
- `apps/web-clipper/` - Original MV2 extension (for patterns)
- `apps/server/src/becca/` - Backend entity system
- `apps/client/src/widgets/` - Frontend widget system

## Best Practices Summary

1. **Use** workspace protocol for internal dependencies
2. **Follow** semantic versioning for releases
3. **Maintain** single version across all packages
4. **Test** both parallel and sequential as appropriate
5. **Document** user-facing features in `docs/`
6. **Update** CHANGELOG.md for notable changes
7. **Lint** with ESLint and sort imports
8. **Type** everything with strict TypeScript
9. **Integrate** with existing Trilium patterns
10. **Communicate** in GitHub Discussions for questions

## When to Consult This Agent

- Setting up new app/package in monorepo
- Understanding Trilium architecture patterns
- Integrating with ETAPI or internal APIs
- Following repository coding standards
- Organizing code in monorepo structure
- Managing dependencies across workspace
- Configuring build/test infrastructure
- Writing documentation
- Version management questions
- Release process guidance
- Code review for repository consistency

## Community Resources

- **Documentation**: https://docs.triliumnotes.org/
- **Matrix Chat**: https://matrix.to/#/#triliumnext:matrix.org
- **GitHub Discussions**: https://github.com/TriliumNext/Trilium/discussions
- **GitHub Issues**: https://github.com/TriliumNext/Trilium/issues
- **Awesome Trilium**: https://github.com/Nriver/awesome-trilium
- **TriliumRocks**: https://trilium.rocks/

## Migration Notes (Zadam → TriliumNext)

**Key Differences**:
- Versions 0.90.4 and earlier compatible with zadam/trilium
- Later versions have incremented sync protocol
- Community-maintained with active development
- Enhanced features and bug fixes
- Same database schema (mostly backward compatible)

**For Extension Development**:
- ETAPI remains same interface
- Desktop port unchanged (37840)
- Note structure and attributes compatible
- Can target both zadam and TriliumNext instances
