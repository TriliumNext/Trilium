# Theme Development Guide
This guide covers creating custom themes for Trilium Notes. Themes allow you to customize the visual appearance of the application to match your preferences or organizational branding.

## Prerequisites

*   CSS and CSS Variables knowledge
*   Understanding of color theory and accessibility
*   Basic knowledge of Trilium's note system
*   Familiarity with browser developer tools

## Understanding Trilium's Theme System

### Theme Architecture

Trilium's theming system uses CSS custom properties (variables) for consistent styling across the application. Themes are stored as CSS code notes that override default variables.

### Default Themes

Trilium includes several built-in themes:

*   **Light** - Default light theme
*   **Dark** - Dark mode theme
*   **Steel Blue** - Professional blue theme
*   **Next** - Modern, clean theme

### CSS Variable Structure

Themes work by overriding CSS custom properties defined in the root scope:

```css
:root {
    /* Main colors */
    --main-background-color: #ffffff;
    --main-text-color: #333333;
    --main-border-color: #dddddd;
    
    /* Accent colors */
    --primary-color: #007bff;
    --secondary-color: #6c757d;
    
    /* Component colors */
    --button-background-color: #f0f0f0;
    --button-text-color: #333333;
    
    /* And many more... */
}
```

## Creating Your First Theme

### Step 1: Create Theme Note

1.  Create a new code note
2.  Set type to "CSS"
3.  Add label `#appTheme=myThemeName`
4.  Add label `#appCss` (for global application)

### Step 2: Define Basic Colors

```css
/* My Custom Theme */
:root {
    /* Primary Palette */
    --theme-primary: #5e72e4;
    --theme-secondary: #825ee4;
    --theme-success: #2dce89;
    --theme-info: #11cdef;
    --theme-warning: #fb6340;
    --theme-danger: #f5365c;
    
    /* Neutral Colors */
    --theme-white: #ffffff;
    --theme-light: #f6f9fc;
    --theme-gray: #8898aa;
    --theme-dark: #32325d;
    --theme-black: #000000;
    
    /* Main Application Colors */
    --main-background-color: var(--theme-light);
    --main-text-color: var(--theme-dark);
    --main-border-color: #e9ecef;
    
    /* Primary Actions */
    --primary-color: var(--theme-primary);
    --primary-color-hover: #4c63d2;
    --primary-text-color: var(--theme-white);
    
    /* Menu and Navigation */
    --menu-background-color: var(--theme-white);
    --menu-text-color: var(--theme-dark);
    --menu-hover-background-color: var(--theme-light);
    
    /* Tree Component */
    --tree-background-color: var(--theme-white);
    --tree-text-color: var(--theme-dark);
    --tree-hover-background-color: #f0f4f8;
    --tree-selected-background-color: var(--theme-primary);
    --tree-selected-text-color: var(--theme-white);
    
    /* Editor */
    --editor-background-color: var(--theme-white);
    --editor-text-color: var(--theme-dark);
    --editor-selection-background: rgba(94, 114, 228, 0.2);
    
    /* Buttons */
    --button-background-color: var(--theme-white);
    --button-text-color: var(--theme-dark);
    --button-border-color: var(--main-border-color);
    --button-hover-background-color: var(--theme-light);
    
    /* Inputs */
    --input-background-color: var(--theme-white);
    --input-text-color: var(--theme-dark);
    --input-border-color: #cbd5e0;
    --input-focus-border-color: var(--theme-primary);
    
    /* Code */
    --code-background-color: #f7fafc;
    --code-text-color: #d63384;
    
    /* Links */
    --link-color: var(--theme-primary);
    --link-hover-color: var(--theme-secondary);
    
    /* Shadows */
    --box-shadow-sm: 0 1px 3px rgba(50, 50, 93, 0.15);
    --box-shadow-md: 0 4px 6px rgba(50, 50, 93, 0.11);
    --box-shadow-lg: 0 10px 40px rgba(50, 50, 93, 0.2);
}
```

### Step 3: Style Components

```css
/* Component Customizations */

/* Note Tree Styling */
.tree-wrapper {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    padding: 1px;
}

.tree {
    background: var(--tree-background-color);
    border-radius: 8px;
    margin: 1px;
}

.fancytree-node {
    border-radius: 4px;
    margin: 2px 4px;
    transition: all 0.2s ease;
}

.fancytree-node:hover {
    transform: translateX(2px);
    box-shadow: var(--box-shadow-sm);
}

/* Tab Styling */
.note-tab {
    background: var(--theme-white);
    border: none;
    border-radius: 8px 8px 0 0;
    margin-right: 2px;
    transition: all 0.2s ease;
}

.note-tab:hover {
    background: var(--theme-light);
    transform: translateY(-2px);
}

.note-tab.active {
    background: var(--theme-primary);
    color: var(--theme-white);
    box-shadow: var(--box-shadow-md);
}

/* Button Styling */
.btn {
    border-radius: 6px;
    padding: 8px 16px;
    font-weight: 500;
    transition: all 0.2s ease;
    border: 1px solid transparent;
}

.btn:hover {
    transform: translateY(-1px);
    box-shadow: var(--box-shadow-md);
}

.btn-primary {
    background: linear-gradient(135deg, var(--theme-primary) 0%, var(--theme-secondary) 100%);
    color: var(--theme-white);
    border: none;
}

/* Card/Panel Styling */
.card {
    border: none;
    border-radius: 12px;
    box-shadow: var(--box-shadow-sm);
    overflow: hidden;
}

.card-header {
    background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
    border-bottom: 2px solid var(--main-border-color);
    padding: 12px 16px;
}

/* Dialog Styling */
.modal-content {
    border-radius: 12px;
    border: none;
    box-shadow: var(--box-shadow-lg);
}

.modal-header {
    background: linear-gradient(135deg, var(--theme-primary) 0%, var(--theme-secondary) 100%);
    color: var(--theme-white);
    border-radius: 12px 12px 0 0;
}

/* Scrollbar Styling */
::-webkit-scrollbar {
    width: 10px;
    height: 10px;
}

::-webkit-scrollbar-track {
    background: var(--theme-light);
    border-radius: 10px;
}

::-webkit-scrollbar-thumb {
    background: linear-gradient(135deg, var(--theme-primary) 0%, var(--theme-secondary) 100%);
    border-radius: 10px;
}

::-webkit-scrollbar-thumb:hover {
    background: var(--theme-secondary);
}
```

## Complete Theme Example: Modern Dark

Here's a complete example of a modern dark theme:

```css
/* Modern Dark Theme for Trilium */

:root {
    /* Color Palette */
    --md-bg-primary: #0f0f23;
    --md-bg-secondary: #1a1b3a;
    --md-bg-tertiary: #252647;
    --md-bg-elevated: #2d2f54;
    
    --md-text-primary: #e4e4e7;
    --md-text-secondary: #a1a1aa;
    --md-text-muted: #71717a;
    
    --md-accent-primary: #7c3aed;
    --md-accent-secondary: #a855f7;
    --md-accent-success: #10b981;
    --md-accent-warning: #f59e0b;
    --md-accent-danger: #ef4444;
    --md-accent-info: #3b82f6;
    
    --md-border: rgba(255, 255, 255, 0.1);
    --md-border-strong: rgba(255, 255, 255, 0.2);
    
    /* Main Application */
    --main-background-color: var(--md-bg-primary);
    --main-text-color: var(--md-text-primary);
    --main-border-color: var(--md-border);
    --body-background-color: var(--md-bg-primary);
    
    /* Accents */
    --primary-color: var(--md-accent-primary);
    --primary-color-hover: var(--md-accent-secondary);
    --primary-text-color: #ffffff;
    
    --muted-text-color: var(--md-text-muted);
    --active-item-background-color: var(--md-bg-elevated);
    --active-item-text-color: var(--md-accent-primary);
    
    /* Menu */
    --menu-background-color: var(--md-bg-secondary);
    --menu-text-color: var(--md-text-primary);
    --menu-hover-background-color: var(--md-bg-tertiary);
    --dropdown-background-color: var(--md-bg-tertiary);
    --dropdown-item-hover-background-color: var(--md-bg-elevated);
    
    /* Tree */
    --tree-background-color: var(--md-bg-secondary);
    --tree-text-color: var(--md-text-primary);
    --tree-hover-background-color: var(--md-bg-tertiary);
    --tree-selected-background-color: var(--md-accent-primary);
    --tree-selected-text-color: #ffffff;
    
    /* Editor */
    --editor-background-color: var(--md-bg-primary);
    --editor-text-color: var(--md-text-primary);
    --editor-selection-background: rgba(124, 58, 237, 0.3);
    
    /* Note Detail */
    --detail-background-color: var(--md-bg-primary);
    --detail-text-color: var(--md-text-primary);
    --accented-background-color: var(--md-bg-secondary);
    
    /* Buttons */
    --button-background-color: var(--md-bg-tertiary);
    --button-text-color: var(--md-text-primary);
    --button-border-color: var(--md-border);
    --button-hover-background-color: var(--md-bg-elevated);
    --button-disabled-background-color: var(--md-bg-secondary);
    
    /* Inputs */
    --input-background-color: var(--md-bg-secondary);
    --input-text-color: var(--md-text-primary);
    --input-border-color: var(--md-border);
    --input-focus-border-color: var(--md-accent-primary);
    
    /* Modal */
    --modal-background-color: var(--md-bg-secondary);
    --modal-header-background-color: var(--md-bg-tertiary);
    --modal-backdrop-color: rgba(0, 0, 0, 0.7);
    
    /* Tabs */
    --tab-background-color: var(--md-bg-secondary);
    --tab-hover-background-color: var(--md-bg-tertiary);
    --tab-active-background-color: var(--md-bg-primary);
    --tab-active-text-color: var(--md-accent-primary);
    
    /* Code */
    --code-background-color: var(--md-bg-secondary);
    --code-text-color: var(--md-accent-info);
    
    /* Links */
    --link-color: var(--md-accent-info);
    --link-hover-color: var(--md-accent-primary);
    
    /* Tooltips */
    --tooltip-background-color: var(--md-bg-elevated);
    --tooltip-text-color: var(--md-text-primary);
    
    /* Scrollbar */
    --scrollbar-track-color: var(--md-bg-secondary);
    --scrollbar-thumb-color: var(--md-bg-elevated);
    
    /* Shadows */
    --box-shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.3);
    --box-shadow-md: 0 4px 6px rgba(0, 0, 0, 0.4);
    --box-shadow-lg: 0 10px 40px rgba(0, 0, 0, 0.5);
}

/* Component Overrides */

/* Smooth transitions */
* {
    transition: background-color 0.2s ease, color 0.2s ease;
}

/* Body and main containers */
body {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: var(--md-bg-primary);
}

/* Glass morphism effect for cards */
.card {
    background: rgba(26, 27, 58, 0.6);
    backdrop-filter: blur(10px);
    border: 1px solid var(--md-border);
    border-radius: 12px;
    box-shadow: var(--box-shadow-md);
}

.card-header {
    background: rgba(37, 38, 71, 0.8);
    border-bottom: 1px solid var(--md-border-strong);
}

/* Gradient accents */
.note-tab.active::after {
    content: '';
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 2px;
    background: linear-gradient(90deg, var(--md-accent-primary), var(--md-accent-secondary));
}

/* Glow effects for focused elements */
input:focus,
textarea:focus,
.CodeMirror-focused {
    outline: none;
    border-color: var(--md-accent-primary);
    box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.1);
}

/* Button animations */
.btn {
    position: relative;
    overflow: hidden;
    border-radius: 8px;
    font-weight: 500;
    letter-spacing: 0.025em;
}

.btn::before {
    content: '';
    position: absolute;
    top: 0;
    left: -100%;
    width: 100%;
    height: 100%;
    background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.1), transparent);
    transition: left 0.5s;
}

.btn:hover::before {
    left: 100%;
}

.btn-primary {
    background: linear-gradient(135deg, var(--md-accent-primary), var(--md-accent-secondary));
    border: none;
    color: white;
}

/* Tree styling with hover effects */
.fancytree-node {
    border-radius: 6px;
    padding: 2px 4px;
    margin: 2px 8px;
}

.fancytree-node:hover {
    background: var(--md-bg-tertiary);
    box-shadow: inset 0 0 0 1px var(--md-border-strong);
}

.fancytree-active {
    background: var(--md-accent-primary) !important;
    color: white !important;
}

.fancytree-active .fancytree-title {
    color: white !important;
}

/* Note content styling */
.note-detail {
    padding: 24px;
}

.note-detail h1 {
    color: var(--md-accent-primary);
    border-bottom: 2px solid var(--md-border-strong);
    padding-bottom: 12px;
    margin-bottom: 24px;
}

.note-detail h2 {
    color: var(--md-accent-secondary);
    margin-top: 32px;
    margin-bottom: 16px;
}

.note-detail code {
    background: var(--md-bg-tertiary);
    color: var(--md-accent-info);
    padding: 2px 6px;
    border-radius: 4px;
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
}

.note-detail pre {
    background: var(--md-bg-secondary);
    border: 1px solid var(--md-border);
    border-radius: 8px;
    padding: 16px;
    overflow-x: auto;
}

.note-detail blockquote {
    border-left: 4px solid var(--md-accent-primary);
    background: var(--md-bg-secondary);
    padding: 12px 20px;
    margin: 16px 0;
    border-radius: 0 8px 8px 0;
}

/* Table styling */
table {
    border-collapse: separate;
    border-spacing: 0;
    border-radius: 8px;
    overflow: hidden;
    box-shadow: var(--box-shadow-sm);
}

th {
    background: var(--md-bg-tertiary);
    color: var(--md-accent-primary);
    font-weight: 600;
    text-transform: uppercase;
    font-size: 0.875em;
    letter-spacing: 0.05em;
}

td {
    background: var(--md-bg-secondary);
    border-top: 1px solid var(--md-border);
}

tr:hover td {
    background: var(--md-bg-tertiary);
}

/* Scrollbar styling */
::-webkit-scrollbar {
    width: 12px;
    height: 12px;
}

::-webkit-scrollbar-track {
    background: var(--md-bg-secondary);
    border-radius: 6px;
}

::-webkit-scrollbar-thumb {
    background: var(--md-bg-elevated);
    border-radius: 6px;
    border: 2px solid var(--md-bg-secondary);
}

::-webkit-scrollbar-thumb:hover {
    background: var(--md-accent-primary);
}

/* Animations */
@keyframes fadeIn {
    from {
        opacity: 0;
        transform: translateY(-10px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}

.modal {
    animation: fadeIn 0.2s ease;
}

/* Loading states */
.loading {
    position: relative;
}

.loading::after {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: linear-gradient(90deg, 
        transparent,
        rgba(124, 58, 237, 0.1),
        transparent
    );
    animation: shimmer 2s infinite;
}

@keyframes shimmer {
    0% {
        transform: translateX(-100%);
    }
    100% {
        transform: translateX(100%);
    }
}

/* Focus visible for accessibility */
*:focus-visible {
    outline: 2px solid var(--md-accent-primary);
    outline-offset: 2px;
}

/* Custom tooltip styling */
.tooltip {
    background: var(--md-bg-elevated);
    border: 1px solid var(--md-border-strong);
    border-radius: 6px;
    padding: 8px 12px;
    font-size: 0.875em;
    box-shadow: var(--box-shadow-lg);
}

.tooltip-arrow {
    border-color: var(--md-bg-elevated);
}
```

## Advanced Theming Techniques

### Dynamic Theme Switching

```javascript
// Frontend script for theme switching
class ThemeSwitcher {
    constructor() {
        this.themes = ['light', 'dark', 'modern-dark', 'custom'];
        this.currentTheme = this.getCurrentTheme();
        this.init();
    }
    
    init() {
        this.createThemeToggle();
        this.bindEvents();
        this.applyTheme(this.currentTheme);
    }
    
    createThemeToggle() {
        const $toggle = $(`
            <div class="theme-switcher">
                <button class="theme-toggle" title="Switch Theme">
                    <span class="bx bx-palette"></span>
                </button>
                <div class="theme-dropdown">
                    ${this.themes.map(theme => `
                        <div class="theme-option" data-theme="${theme}">
                            <span class="theme-preview ${theme}"></span>
                            <span class="theme-name">${this.formatThemeName(theme)}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `);
        
        $('body').append($toggle);
        
        // Add styles
        $('<style>').text(`
            .theme-switcher {
                position: fixed;
                bottom: 20px;
                right: 20px;
                z-index: 10000;
            }
            
            .theme-toggle {
                width: 50px;
                height: 50px;
                border-radius: 50%;
                background: var(--primary-color);
                color: white;
                border: none;
                box-shadow: 0 4px 12px rgba(0,0,0,0.2);
                cursor: pointer;
                font-size: 20px;
            }
            
            .theme-dropdown {
                position: absolute;
                bottom: 60px;
                right: 0;
                background: var(--menu-background-color);
                border: 1px solid var(--main-border-color);
                border-radius: 8px;
                padding: 8px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                display: none;
                min-width: 200px;
            }
            
            .theme-switcher.active .theme-dropdown {
                display: block;
            }
            
            .theme-option {
                display: flex;
                align-items: center;
                padding: 8px;
                border-radius: 4px;
                cursor: pointer;
                gap: 12px;
            }
            
            .theme-option:hover {
                background: var(--menu-hover-background-color);
            }
            
            .theme-preview {
                width: 24px;
                height: 24px;
                border-radius: 50%;
                border: 2px solid var(--main-border-color);
            }
            
            .theme-preview.light {
                background: linear-gradient(135deg, #ffffff, #f0f0f0);
            }
            
            .theme-preview.dark {
                background: linear-gradient(135deg, #1a1a1a, #2d2d2d);
            }
            
            .theme-preview.modern-dark {
                background: linear-gradient(135deg, #0f0f23, #7c3aed);
            }
            
            .theme-preview.custom {
                background: linear-gradient(135deg, #667eea, #764ba2);
            }
        `).appendTo('head');
    }
    
    bindEvents() {
        $('.theme-toggle').on('click', () => {
            $('.theme-switcher').toggleClass('active');
        });
        
        $('.theme-option').on('click', (e) => {
            const theme = $(e.currentTarget).data('theme');
            this.applyTheme(theme);
            $('.theme-switcher').removeClass('active');
        });
        
        // Close on outside click
        $(document).on('click', (e) => {
            if (!$(e.target).closest('.theme-switcher').length) {
                $('.theme-switcher').removeClass('active');
            }
        });
    }
    
    async applyTheme(themeName) {
        // Save preference
        await api.setOption('theme', themeName);
        
        // Apply theme class
        $('body').removeClass(this.themes.map(t => `theme-${t}`).join(' '));
        $('body').addClass(`theme-${themeName}`);
        
        this.currentTheme = themeName;
        
        // Show notification
        await api.showMessage(`Theme changed to ${this.formatThemeName(themeName)}`);
    }
    
    getCurrentTheme() {
        return api.getOption('theme') || 'light';
    }
    
    formatThemeName(theme) {
        return theme.split('-').map(word => 
            word.charAt(0).toUpperCase() + word.slice(1)
        ).join(' ');
    }
}

// Initialize theme switcher
new ThemeSwitcher();
```

### Responsive Theme Variables

```css
/* Responsive theme adjustments */
@media (max-width: 768px) {
    :root {
        /* Adjust spacing for mobile */
        --mobile-padding: 12px;
        --mobile-margin: 8px;
        
        /* Larger touch targets */
        --button-min-height: 44px;
        --input-min-height: 44px;
    }
    
    .btn {
        min-height: var(--button-min-height);
        padding: 12px 16px;
    }
    
    input,
    textarea,
    select {
        min-height: var(--input-min-height);
        font-size: 16px; /* Prevent zoom on iOS */
    }
    
    .tree {
        font-size: 14px;
    }
    
    .note-detail {
        padding: var(--mobile-padding);
    }
}

/* High contrast mode support */
@media (prefers-contrast: high) {
    :root {
        --main-border-color: #000000;
        --button-border-width: 2px;
        --focus-outline-width: 3px;
    }
    
    .btn {
        border: var(--button-border-width) solid var(--button-border-color);
    }
    
    *:focus {
        outline: var(--focus-outline-width) solid var(--primary-color);
    }
}

/* Dark mode preference */
@media (prefers-color-scheme: dark) {
    :root:not(.theme-light) {
        /* Automatically use dark colors */
        --main-background-color: #1a1a1a;
        --main-text-color: #e0e0e0;
        /* ... other dark mode variables */
    }
}

/* Reduced motion support */
@media (prefers-reduced-motion: reduce) {
    * {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
    }
}
```

### Theme-Specific Icons

```css
/* Custom icon styling per theme */
.theme-modern-dark .bx {
    /* Add glow effect to icons */
    filter: drop-shadow(0 0 2px rgba(124, 58, 237, 0.5));
}

.theme-modern-dark .bx-star {
    color: gold;
    filter: drop-shadow(0 0 4px gold);
}

/* Replace icons with theme-specific versions */
.theme-cyberpunk .bx-folder::before {
    content: '\eb1f'; /* Different icon */
    color: #00ff00;
}

/* Animated icons */
@keyframes pulse {
    0%, 100% {
        transform: scale(1);
    }
    50% {
        transform: scale(1.1);
    }
}

.theme-animated .bx-bell {
    animation: pulse 2s infinite;
}

.theme-animated .note-modified .bx {
    animation: pulse 1s;
}
```

## Accessibility Considerations

```css
/* Ensure sufficient color contrast */
:root {
    /* WCAG AAA compliant contrast ratios */
    --text-on-primary: #ffffff; /* 7:1 contrast with primary */
    --text-on-secondary: #000000; /* 7:1 contrast with secondary */
}

/* Focus indicators */
*:focus-visible {
    outline: 3px solid var(--primary-color);
    outline-offset: 2px;
}

/* Skip to content link */
.skip-to-content {
    position: absolute;
    top: -40px;
    left: 0;
    background: var(--primary-color);
    color: var(--text-on-primary);
    padding: 8px;
    text-decoration: none;
    z-index: 100000;
}

.skip-to-content:focus {
    top: 0;
}

/* High contrast borders */
.high-contrast {
    --main-border-color: #000000;
    --input-border-width: 2px;
}

/* Color blind friendly palette */
.theme-colorblind {
    --success-color: #0066cc; /* Blue instead of green */
    --danger-color: #cc6600; /* Orange instead of red */
    --warning-color: #663399; /* Purple instead of yellow */
}

/* Readable fonts */
body {
    font-size: 16px;
    line-height: 1.6;
    letter-spacing: 0.02em;
}

/* Sufficient click targets */
button,
a,
input[type="checkbox"],
input[type="radio"] {
    min-width: 44px;
    min-height: 44px;
}
```

## Publishing Your Theme

### Package Structure

```
my-theme/
├── theme.css         # Main theme file
├── preview.png       # Screenshot of theme
├── README.md        # Documentation
├── package.json     # Metadata
└── variants/        # Optional theme variants
    ├── dark.css
    └── light.css
```

### Metadata File

```json
{
  "name": "my-awesome-theme",
  "version": "1.0.0",
  "description": "A beautiful theme for Trilium Notes",
  "author": "Your Name",
  "license": "MIT",
  "trilium": {
    "minVersion": "0.90.0",
    "type": "theme",
    "variants": ["light", "dark"],
    "labels": {
      "appTheme": "myAwesomeTheme",
      "appCss": true
    }
  },
  "repository": {
    "type": "git",
    "url": "https://github.com/username/trilium-theme"
  },
  "keywords": ["trilium", "theme", "dark", "modern"]
}
```

### Installation Instructions

```gfm
# My Awesome Theme

A modern theme for Trilium Notes with beautiful gradients and smooth animations.

## Installation

1. Create a new CSS code note in Trilium
2. Copy the contents of `theme.css`
3. Add the following labels to the note:
   - `#appTheme=myAwesomeTheme`
   - `#appCss`
4. Reload Trilium (Ctrl+R)
5. Select the theme from Options → Appearance → Theme

## Features

- Beautiful gradient accents
- Smooth animations
- Dark and light variants
- High contrast support
- Mobile responsive

## Customization

You can customize the theme by modifying the CSS variables at the top of the file.

## Screenshots

![Light Mode](./screenshots/light.png)
![Dark Mode](./screenshots/dark.png)
```

## Testing Your Theme

### Browser Developer Tools

```javascript
// Test theme in console
function testTheme() {
    // Check contrast ratios
    const bg = getComputedStyle(document.documentElement)
        .getPropertyValue('--main-background-color');
    const fg = getComputedStyle(document.documentElement)
        .getPropertyValue('--main-text-color');
    
    console.log(`Background: ${bg}`);
    console.log(`Foreground: ${fg}`);
    
    // Test all theme variables
    const styles = getComputedStyle(document.documentElement);
    const themeVars = Array.from(document.styleSheets)
        .flatMap(sheet => Array.from(sheet.cssRules))
        .filter(rule => rule.selectorText === ':root')
        .flatMap(rule => Array.from(rule.style))
        .filter(prop => prop.startsWith('--'));
    
    themeVars.forEach(varName => {
        const value = styles.getPropertyValue(varName);
        console.log(`${varName}: ${value}`);
    });
}

// Apply test theme
function applyTestTheme(cssText) {
    const style = document.createElement('style');
    style.id = 'test-theme';
    style.textContent = cssText;
    document.head.appendChild(style);
}

// Remove test theme
function removeTestTheme() {
    document.getElementById('test-theme')?.remove();
}
```

### Automated Testing

```javascript
// Theme validation script
class ThemeValidator {
    validate(themeCSS) {
        const errors = [];
        const warnings = [];
        
        // Check required variables
        const requiredVars = [
            '--main-background-color',
            '--main-text-color',
            '--main-border-color',
            '--primary-color'
        ];
        
        requiredVars.forEach(varName => {
            if (!themeCSS.includes(varName)) {
                errors.push(`Missing required variable: ${varName}`);
            }
        });
        
        // Check color contrast
        const colorPairs = [
            ['--main-background-color', '--main-text-color'],
            ['--primary-color', '--primary-text-color'],
            ['--button-background-color', '--button-text-color']
        ];
        
        // Validate color values
        const colorRegex = /#[0-9a-fA-F]{3,6}|rgb\(|hsl\(/;
        const matches = themeCSS.match(/--[\w-]+:\s*([^;]+);/g);
        
        matches?.forEach(match => {
            const value = match.split(':')[1].trim().replace(';', '');
            if (value && !colorRegex.test(value) && !value.startsWith('var(')) {
                warnings.push(`Invalid color value: ${match}`);
            }
        });
        
        return { errors, warnings };
    }
}
```

## Best Practices

1.  **Use CSS Variables**
    
    *   Define all colors as variables
    *   Use semantic naming
    *   Provide fallback values
2.  **Maintain Consistency**
    
    *   Use consistent spacing
    *   Keep border radii uniform
    *   Use a limited color palette
3.  **Ensure Accessibility**
    
    *   Test color contrast
    *   Provide focus indicators
    *   Support high contrast mode
4.  **Performance**
    
    *   Avoid complex selectors
    *   Minimize animations
    *   Use efficient gradients
5.  **Documentation**
    
    *   Comment complex styles
    *   Provide customization guide
    *   Include screenshots

## Troubleshooting

### Theme Not Loading

*   Verify labels are correct
*   Check for CSS syntax errors
*   Ensure note type is CSS
*   Reload application

### Styles Not Applying

*   Check specificity conflicts
*   Verify variable names
*   Use browser dev tools
*   Clear cache

### Performance Issues

*   Reduce animation complexity
*   Optimize gradients
*   Minimize shadow usage
*   Profile with dev tools

## Next Steps

*   Share your theme with the community
*   Create theme variants
*   Add custom animations
*   Build a theme generator tool