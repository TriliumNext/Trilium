---
name: release
description: Prepare extension for release - version bump, changelog, build verification
argument-hint: Specify version number (e.g., 1.0.0) or type (major/minor/patch)
agent: agent
tools:
  - changes
  - codebase
  - editFiles
  - problems
  - runCommands
---

# Release Preparation Prompt

You are preparing the Trilium Web Clipper MV3 extension for **release**. This includes version bumps, changelog updates, and build verification.

## Release Checklist

### 1. Pre-Release Verification

```bash
# Clean build
npm run clean
npm install
npm run build

# Type checking
npm run type-check

# Linting
npm run lint

# Manual testing of core features
```

**Test Core Features**:
- [ ] Save text selection
- [ ] Save full page
- [ ] Take screenshot
- [ ] Screenshot cropping
- [ ] Context menu actions
- [ ] Settings persistence
- [ ] Trilium connection (desktop)
- [ ] Trilium connection (server)

### 2. Version Update

Update version in `package.json`:
```json
{
  "version": "X.Y.Z"
}
```

Update version in `public/manifest.json`:
```json
{
  "version": "X.Y.Z"
}
```

### 3. Changelog Update

Add entry to `CHANGELOG.md`:
```markdown
## [X.Y.Z] - YYYY-MM-DD

### Added
- New feature descriptions

### Changed
- Modified functionality

### Fixed
- Bug fixes

### Security
- Security improvements
```

### 4. Build Release Package

```bash
# Production build
npm run build

# Create zip for Chrome Web Store
npm run zip
```

### 5. Final Verification

- [ ] Version numbers match across files
- [ ] Changelog is complete
- [ ] No TypeScript errors
- [ ] No lint errors
- [ ] Build succeeds
- [ ] Zip file created
- [ ] Extension loads in Chrome
- [ ] Core features work

## Semantic Versioning

- **Major** (X.0.0): Breaking changes, major rewrites
- **Minor** (0.X.0): New features, backward compatible
- **Patch** (0.0.X): Bug fixes, minor improvements

## Chrome Web Store Submission

1. Go to [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
2. Upload the zip file from `dist/`
3. Update store listing if needed
4. Submit for review

## Post-Release

- [ ] Create git tag: `git tag vX.Y.Z`
- [ ] Push tag: `git push origin vX.Y.Z`
- [ ] Create GitHub release with changelog
- [ ] Announce release if appropriate

## Rollback Plan

If issues are discovered post-release:
1. Identify the issue
2. Fix in development
3. Increment patch version
4. Follow release process
5. Submit update to Chrome Web Store
