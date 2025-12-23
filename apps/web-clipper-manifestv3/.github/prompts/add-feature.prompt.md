---
name: add-feature
description: Add new features to the Web Clipper extension
argument-hint: Describe the feature you want to add
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
  - usages
---

# Add Feature Prompt

You are adding a **new feature** to the Trilium Web Clipper MV3 extension. Follow this structured approach to ensure consistent, high-quality feature implementation.

## Feature Implementation Workflow

### 1. Requirements Analysis

Before coding:
- Understand the user need this feature addresses
- Identify affected components (popup, content script, service worker, options)
- Check if similar functionality exists in `reference/` (legacy MV2)
- Consider security implications
- Plan for error handling and edge cases

### 2. Architecture Planning

Determine where code belongs:
- **Service Worker** (`src/background/`) - API calls, state management, cross-tab logic
- **Content Scripts** (`src/content/`) - Page DOM interaction, content extraction
- **Popup** (`src/popup/`) - User interface, quick actions
- **Options** (`src/options/`) - Configuration and settings
- **Shared** (`src/shared/` or `src/types/`) - Utilities, interfaces, constants

### 3. Implementation Standards

#### TypeScript Requirements
```typescript
// Define interfaces for new data structures
interface NewFeatureConfig {
  enabled: boolean;
  options: FeatureOptions;
}

// Use discriminated unions for messages
interface NewFeatureMessage {
  type: 'NEW_FEATURE_ACTION';
  payload: NewFeaturePayload;
}
```

#### Service Worker Pattern
```typescript
// Always handle async properly
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'NEW_FEATURE_ACTION') {
    handleNewFeature(message.payload)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // CRITICAL: Required for async
  }
});
```

#### Storage for State
```typescript
// Persist feature state properly
interface FeatureState {
  lastUsed: number;
  preferences: UserPreferences;
}

async function saveFeatureState(state: FeatureState): Promise<void> {
  await chrome.storage.local.set({ featureState: state });
}
```

### 4. Security Checklist

- [ ] All user input validated
- [ ] HTML sanitized with DOMPurify before display/storage
- [ ] No `eval()` or `innerHTML` with untrusted content
- [ ] Permissions minimized (only request what's needed)
- [ ] Sensitive data stored in `chrome.storage.local` (not sync)

### 5. UI/UX Considerations

- Follow existing design patterns (see [UI/UX Expert](../agents/ui-ux-consistency-expert.md))
- Use CSS variables for theming
- Provide clear feedback for actions
- Handle loading states
- Support keyboard navigation where appropriate

## Reference Agents

- [Chrome Extension Architect](../agents/chrome-extension-architect.md) - Extension patterns
- [TypeScript Quality Engineer](../agents/typescript-quality-engineer.md) - Code quality
- [Security & Privacy Specialist](../agents/security-privacy-specialist.md) - Security review
- [UI/UX Consistency Expert](../agents/ui-ux-consistency-expert.md) - Interface design
- [Trilium Integration Expert](../agents/trilium-integration-expert.md) - Trilium API features

## Feature Completion Checklist

- [ ] TypeScript types defined
- [ ] Error handling implemented
- [ ] User feedback provided (toasts, status)
- [ ] Settings added if configurable
- [ ] `npm run type-check` passes
- [ ] `npm run lint` passes
- [ ] `npm run build` succeeds
- [ ] Manual testing completed
- [ ] Documentation updated if user-facing

## File Structure Reference

```
src/
├── background/          # Service worker
│   ├── serviceWorker.ts
│   └── handlers/        # Message handlers
├── content/             # Content scripts
│   ├── contentScript.ts
│   └── extractors/      # Content extraction
├── popup/               # Extension popup
│   ├── popup.html
│   ├── popup.ts
│   └── popup.css
├── options/             # Options page
├── shared/              # Shared utilities
└── types/               # TypeScript definitions
```
