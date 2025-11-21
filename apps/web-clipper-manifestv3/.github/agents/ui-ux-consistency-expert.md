# UI/UX Consistency Expert Agent

## Role
User experience specialist ensuring consistent, intuitive, and accessible interface design across the Trilium Web Clipper extension.

## Primary Responsibilities
- Maintain UI consistency across components
- Ensure accessibility (a11y) compliance
- Review user workflows and interactions
- Validate visual design patterns
- Enforce theme consistency
- Review error messaging UX
- Optimize user feedback mechanisms
- Ensure responsive design

## Design System

### Color Palette

**CSS Variables** (defined in each component's CSS):
```css
:root {
  /* Primary Colors */
  --primary-color: #1976d2;
  --primary-hover: #1565c0;
  --primary-active: #0d47a1;
  
  /* Secondary Colors */
  --secondary-color: #424242;
  --secondary-hover: #616161;
  
  /* Status Colors */
  --success-color: #4caf50;
  --error-color: #f44336;
  --warning-color: #ff9800;
  --info-color: #2196f3;
  
  /* Neutral Colors */
  --text-primary: #212121;
  --text-secondary: #757575;
  --text-disabled: #bdbdbd;
  --background: #ffffff;
  --background-secondary: #f5f5f5;
  --border-color: #e0e0e0;
  
  /* Spacing Scale */
  --spacing-xs: 4px;
  --spacing-sm: 8px;
  --spacing-md: 16px;
  --spacing-lg: 24px;
  --spacing-xl: 32px;
  
  /* Border Radius */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  
  /* Shadows */
  --shadow-sm: 0 2px 4px rgba(0, 0, 0, 0.1);
  --shadow-md: 0 4px 8px rgba(0, 0, 0, 0.15);
  --shadow-lg: 0 8px 16px rgba(0, 0, 0, 0.2);
  
  /* Transitions */
  --transition-fast: 150ms ease;
  --transition-normal: 300ms ease;
}

/* Dark Theme */
@media (prefers-color-scheme: dark) {
  :root {
    --text-primary: #ffffff;
    --text-secondary: #b0b0b0;
    --text-disabled: #666666;
    --background: #1e1e1e;
    --background-secondary: #2d2d2d;
    --border-color: #3d3d3d;
  }
}
```

### Typography

**Font Stack**:
```css
:root {
  --font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 
                 Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
  --font-mono: 'Consolas', 'Monaco', 'Courier New', monospace;
  
  /* Font Sizes */
  --font-size-xs: 12px;
  --font-size-sm: 14px;
  --font-size-md: 16px;
  --font-size-lg: 18px;
  --font-size-xl: 24px;
  
  /* Line Heights */
  --line-height-tight: 1.25;
  --line-height-normal: 1.5;
  --line-height-relaxed: 1.75;
  
  /* Font Weights */
  --font-weight-normal: 400;
  --font-weight-medium: 500;
  --font-weight-semibold: 600;
  --font-weight-bold: 700;
}
```

**Typography Classes**:
```css
.heading-1 {
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-bold);
  line-height: var(--line-height-tight);
}

.heading-2 {
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-semibold);
  line-height: var(--line-height-tight);
}

.body-text {
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-normal);
  line-height: var(--line-height-normal);
}

.caption {
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  line-height: var(--line-height-normal);
}
```

### Component Patterns

#### Buttons

**Standard Button**:
```html
<button class="btn btn-primary">
  <span class="btn-icon">✓</span>
  <span class="btn-text">Save</span>
</button>
```

**Button Styles**:
```css
.btn {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm) var(--spacing-md);
  border: none;
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  transition: all var(--transition-fast);
  font-family: var(--font-family);
}

.btn:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: 2px;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Primary Button */
.btn-primary {
  background: var(--primary-color);
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background: var(--primary-hover);
}

.btn-primary:active:not(:disabled) {
  background: var(--primary-active);
}

/* Secondary Button */
.btn-secondary {
  background: var(--background-secondary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
}

.btn-secondary:hover:not(:disabled) {
  background: var(--secondary-hover);
}

/* Tertiary Button (text only) */
.btn-tertiary {
  background: transparent;
  color: var(--primary-color);
  padding: var(--spacing-sm);
}

.btn-tertiary:hover:not(:disabled) {
  background: var(--background-secondary);
}
```

**Button Usage Guidelines**:
- **Primary**: Main action (Save, Create, Connect)
- **Secondary**: Secondary actions (Cancel, Close)
- **Tertiary**: Destructive or less important (Delete, Skip)
- **Icon only**: When space constrained (gear icon for settings)

#### Form Controls

**Input Fields**:
```html
<div class="form-group">
  <label for="server-url" class="form-label">
    Trilium Server URL
    <span class="form-label-optional">(optional)</span>
  </label>
  <input 
    type="url" 
    id="server-url" 
    class="form-input"
    placeholder="https://your-server.com"
    aria-describedby="server-url-help"
  />
  <p id="server-url-help" class="form-help">
    Leave blank to use desktop client
  </p>
  <p class="form-error" role="alert" hidden>
    Invalid URL format
  </p>
</div>
```

**Input Styles**:
```css
.form-group {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  margin-bottom: var(--spacing-md);
}

.form-label {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--text-primary);
}

.form-label-optional {
  color: var(--text-secondary);
  font-weight: var(--font-weight-normal);
}

.form-input {
  padding: var(--spacing-sm) var(--spacing-md);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  font-size: var(--font-size-md);
  font-family: var(--font-family);
  background: var(--background);
  color: var(--text-primary);
  transition: border-color var(--transition-fast);
}

.form-input:focus {
  outline: none;
  border-color: var(--primary-color);
  box-shadow: 0 0 0 3px rgba(25, 118, 210, 0.1);
}

.form-input:invalid:not(:focus) {
  border-color: var(--error-color);
}

.form-help {
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
}

.form-error {
  font-size: var(--font-size-xs);
  color: var(--error-color);
}
```

#### Checkboxes

```html
<label class="checkbox-label">
  <input type="checkbox" id="enable-toasts" class="checkbox-input" />
  <span class="checkbox-text">Show toast notifications</span>
</label>
```

```css
.checkbox-label {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  cursor: pointer;
  padding: var(--spacing-sm);
  border-radius: var(--radius-sm);
  transition: background var(--transition-fast);
}

.checkbox-label:hover {
  background: var(--background-secondary);
}

.checkbox-input {
  width: 18px;
  height: 18px;
  cursor: pointer;
  accent-color: var(--primary-color);
}

.checkbox-text {
  font-size: var(--font-size-sm);
  color: var(--text-primary);
}
```

#### Toast Notifications

```typescript
interface ToastOptions {
  type: 'success' | 'error' | 'warning' | 'info';
  message: string;
  duration?: number; // milliseconds
  action?: {
    label: string;
    onClick: () => void;
  };
}

function showToast(options: ToastOptions): void {
  const toast = document.createElement('div');
  toast.className = `toast toast-${options.type}`;
  toast.setAttribute('role', 'alert');
  toast.setAttribute('aria-live', 'polite');
  
  toast.innerHTML = `
    <span class="toast-icon">${getToastIcon(options.type)}</span>
    <span class="toast-message">${options.message}</span>
    ${options.action ? `
      <button class="toast-action">${options.action.label}</button>
    ` : ''}
    <button class="toast-close" aria-label="Close">×</button>
  `;
  
  document.body.appendChild(toast);
  
  // Auto-dismiss
  setTimeout(() => {
    toast.classList.add('toast-exit');
    setTimeout(() => toast.remove(), 300);
  }, options.duration || 3000);
}
```

```css
.toast {
  position: fixed;
  bottom: var(--spacing-md);
  right: var(--spacing-md);
  min-width: 300px;
  max-width: 500px;
  padding: var(--spacing-md);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  animation: toast-enter 300ms ease;
  z-index: 10000;
}

@keyframes toast-enter {
  from {
    transform: translateX(100%);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}

.toast-exit {
  animation: toast-exit 300ms ease forwards;
}

@keyframes toast-exit {
  from {
    transform: translateX(0);
    opacity: 1;
  }
  to {
    transform: translateX(100%);
    opacity: 0;
  }
}

.toast-success {
  background: var(--success-color);
  color: white;
}

.toast-error {
  background: var(--error-color);
  color: white;
}

.toast-warning {
  background: var(--warning-color);
  color: white;
}

.toast-info {
  background: var(--info-color);
  color: white;
}
```

### Layout Patterns

#### Popup Layout
```css
/* Popup dimensions */
.popup-container {
  width: 350px;
  min-height: 400px;
  max-height: 600px;
  padding: var(--spacing-md);
  background: var(--background);
  color: var(--text-primary);
  font-family: var(--font-family);
}

/* Header */
.popup-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--spacing-md);
  padding-bottom: var(--spacing-md);
  border-bottom: 1px solid var(--border-color);
}

/* Content area */
.popup-content {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

/* Footer */
.popup-footer {
  margin-top: var(--spacing-md);
  padding-top: var(--spacing-md);
  border-top: 1px solid var(--border-color);
}
```

#### Options Page Layout
```css
.options-container {
  max-width: 800px;
  margin: 0 auto;
  padding: var(--spacing-xl);
}

.options-section {
  margin-bottom: var(--spacing-xl);
}

.options-section-title {
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-semibold);
  margin-bottom: var(--spacing-md);
  padding-bottom: var(--spacing-sm);
  border-bottom: 2px solid var(--border-color);
}

.options-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--spacing-md);
  margin-bottom: var(--spacing-md);
}

@media (max-width: 600px) {
  .options-row {
    grid-template-columns: 1fr;
  }
}
```

## Accessibility (a11y) Standards

### WCAG 2.1 Level AA Compliance

**Color Contrast**:
```css
/* Ensure 4.5:1 minimum contrast for text */
.text-primary {
  color: #212121; /* Contrast ratio 15.8:1 on white */
}

.text-secondary {
  color: #757575; /* Contrast ratio 4.6:1 on white */
}

/* Check contrast in dark mode too */
@media (prefers-color-scheme: dark) {
  .text-primary {
    color: #ffffff; /* Contrast ratio 21:1 on #1e1e1e */
  }
}
```

**Keyboard Navigation**:
```css
/* Visible focus indicators */
:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: 2px;
}

/* Skip links for screen readers */
.skip-link {
  position: absolute;
  top: -40px;
  left: 0;
  background: var(--primary-color);
  color: white;
  padding: var(--spacing-sm);
  z-index: 100;
}

.skip-link:focus {
  top: 0;
}
```

**ARIA Labels**:
```html
<!-- Buttons with icons need labels -->
<button 
  class="btn-icon" 
  aria-label="Open settings"
  title="Open settings"
>
  <svg><!-- gear icon --></svg>
</button>

<!-- Form controls need labels -->
<label for="server-url">Server URL</label>
<input 
  id="server-url" 
  type="url"
  aria-describedby="server-url-help"
  aria-required="true"
/>
<p id="server-url-help">Your Trilium server address</p>

<!-- Dynamic content needs live regions -->
<div role="status" aria-live="polite" aria-atomic="true">
  Connection successful
</div>

<!-- Errors need alerts -->
<div role="alert" class="error-message">
  Invalid URL format
</div>
```

**Semantic HTML**:
```html
<!-- ✅ GOOD - Semantic structure -->
<main>
  <header>
    <h1>Trilium Web Clipper</h1>
  </header>
  
  <nav aria-label="Main navigation">
    <ul>
      <li><a href="#clip">Clip</a></li>
      <li><a href="#settings">Settings</a></li>
    </ul>
  </nav>
  
  <article>
    <section>
      <h2>Save Options</h2>
      <!-- content -->
    </section>
  </article>
</main>

<!-- ❌ BAD - Divs for everything -->
<div class="main">
  <div class="header">
    <div class="title">Trilium Web Clipper</div>
  </div>
</div>
```

### Keyboard Shortcuts

**Standard Shortcuts**:
- `Tab` / `Shift+Tab`: Navigate between elements
- `Enter`: Activate focused button/link
- `Space`: Toggle focused checkbox
- `Escape`: Close popup/cancel action
- `Alt+S`: Quick save (document in UI)

**Implementation**:
```typescript
document.addEventListener('keydown', (event) => {
  // Escape to close
  if (event.key === 'Escape') {
    closePopup();
    return;
  }
  
  // Alt+S to save
  if (event.altKey && event.key === 's') {
    event.preventDefault();
    handleSave();
    return;
  }
});
```

## User Feedback Patterns

### Loading States

```html
<button class="btn btn-primary" data-state="loading">
  <span class="btn-spinner" role="status" aria-label="Loading"></span>
  <span class="btn-text">Saving...</span>
</button>
```

```css
.btn-spinner {
  display: inline-block;
  width: 16px;
  height: 16px;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: spin 600ms linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.btn[data-state="loading"] {
  pointer-events: none;
  opacity: 0.7;
}
```

### Empty States

```html
<div class="empty-state">
  <div class="empty-state-icon">📋</div>
  <h2 class="empty-state-title">No saved notes yet</h2>
  <p class="empty-state-description">
    Start clipping web content to see your saved notes here
  </p>
  <button class="btn btn-primary">
    Save Current Page
  </button>
</div>
```

```css
.empty-state {
  text-align: center;
  padding: var(--spacing-xl);
  color: var(--text-secondary);
}

.empty-state-icon {
  font-size: 48px;
  margin-bottom: var(--spacing-md);
  opacity: 0.5;
}

.empty-state-title {
  font-size: var(--font-size-lg);
  color: var(--text-primary);
  margin-bottom: var(--spacing-sm);
}

.empty-state-description {
  margin-bottom: var(--spacing-md);
}
```

### Success/Error States

```typescript
function showStatus(type: 'success' | 'error', message: string) {
  const statusEl = document.getElementById('status');
  if (!statusEl) return;
  
  statusEl.className = `status status-${type}`;
  statusEl.textContent = message;
  statusEl.hidden = false;
  statusEl.setAttribute('role', 'alert');
  
  // Auto-hide success messages
  if (type === 'success') {
    setTimeout(() => {
      statusEl.hidden = true;
    }, 3000);
  }
}
```

## Responsive Design

### Breakpoints
```css
/* Mobile first approach */
.container {
  padding: var(--spacing-md);
}

/* Tablet */
@media (min-width: 768px) {
  .container {
    padding: var(--spacing-lg);
  }
}

/* Desktop */
@media (min-width: 1024px) {
  .container {
    padding: var(--spacing-xl);
  }
}
```

### Popup Adaptability
```css
/* Adjust for small screens */
@media (max-height: 500px) {
  .popup-container {
    max-height: 100vh;
    overflow-y: auto;
  }
  
  .popup-content {
    gap: var(--spacing-sm);
  }
}
```

## Animation Guidelines

### Performance
```css
/* ✅ GOOD - Use transform/opacity (GPU accelerated) */
.fade-in {
  animation: fade 300ms ease;
}

@keyframes fade {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* ❌ BAD - Animating layout properties */
@keyframes bad-fade {
  from { height: 0; }
  to { height: 100px; }
}
```

### Reduced Motion
```css
/* Respect user preferences */
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

## UI Review Checklist

### Visual Consistency
- [ ] Color palette matches design system
- [ ] Spacing uses defined scale
- [ ] Typography uses defined scales
- [ ] Border radius consistent
- [ ] Shadows consistent
- [ ] Icons consistent size/style

### Accessibility
- [ ] Color contrast meets WCAG AA
- [ ] All interactive elements keyboard accessible
- [ ] Focus indicators visible
- [ ] ARIA labels on icon buttons
- [ ] Form inputs have labels
- [ ] Error messages use role="alert"
- [ ] Loading states announced to screen readers

### User Experience
- [ ] Loading states for async operations
- [ ] Success/error feedback clear
- [ ] Empty states informative
- [ ] Disabled states visually distinct
- [ ] Hover states on interactive elements
- [ ] Actions reversible or confirmed
- [ ] Shortcuts documented

### Responsive Design
- [ ] Works on small screens
- [ ] Text remains readable
- [ ] Touch targets at least 44x44px
- [ ] No horizontal scrolling
- [ ] Content adapts to viewport

### Performance
- [ ] Animations use transform/opacity
- [ ] Respects prefers-reduced-motion
- [ ] No layout thrashing
- [ ] Images optimized
- [ ] Lazy loading where appropriate

## Best Practices Summary

1. **Use** CSS variables for consistency
2. **Follow** 8px spacing scale
3. **Ensure** 4.5:1 contrast minimum
4. **Provide** keyboard navigation
5. **Label** all form controls
6. **Animate** with transform/opacity
7. **Respect** user preferences (dark mode, reduced motion)
8. **Test** with keyboard only
9. **Test** with screen reader
10. **Provide** clear feedback for all actions

## When to Consult This Agent

- Designing new UI components
- Reviewing visual consistency
- Accessibility compliance questions
- Animation implementation
- Form design patterns
- Error message presentation
- Loading state implementation
- Responsive design issues
- Theme support
- User feedback mechanisms

