# Frontend Script Development
## Frontend Script Development Guide

This guide covers developing frontend scripts in Trilium Notes. Frontend scripts run in the browser context and can interact with the UI, modify behavior, and create custom functionality.

## Prerequisites

*   JavaScript/TypeScript knowledge
*   Understanding of browser APIs and DOM manipulation
*   Basic knowledge of Trilium's note system
*   Familiarity with async/await patterns

## Getting Started

### Creating a Frontend Script

1.  Create a new code note with type "JS Frontend"
2.  Add the `#run=frontendStartup` label to run on startup
3.  Write your JavaScript code

```javascript
// Basic frontend script
api.addButtonToToolbar({
    title: 'My Custom Button',
    icon: 'bx bx-star',
    action: async () => {
        await api.showMessage('Hello from custom script!');
    }
});
```

### Script Execution Context

Frontend scripts run in the browser with access to:

*   Trilium's Frontend API (`api` global object)
*   Browser APIs (DOM, fetch, localStorage, etc.)
*   jQuery (`$` global)
*   All loaded libraries

## Frontend API Reference

### Core API Object

The `api` object is globally available in all frontend scripts:

```javascript
// Access current note
const currentNote = api.getActiveContextNote();

// Get note by ID
const note = await api.getNote('noteId123');

// Search notes
const results = await api.searchForNotes('type:text @label=important');
```

### Note Operations

#### Reading Notes

```javascript
// Get active note
const activeNote = api.getActiveContextNote();
console.log('Current note:', activeNote.title);

// Get note by ID
const note = await api.getNote('noteId123');

// Get note content
const content = await note.getContent();

// Get note attributes
const attributes = note.getAttributes();
const labels = note.getLabels();
const relations = note.getRelations();

// Get child notes
const children = await note.getChildNotes();

// Get parent notes
const parents = await note.getParentNotes();
```

#### Creating Notes

```javascript
// Create a simple note
const newNote = await api.createNote(
    parentNoteId,
    'New Note Title',
    'Note content here'
);

// Create note with options
const note = await api.createNote(
    parentNoteId,
    'Advanced Note',
    '<p>HTML content</p>',
    {
        type: 'text',
        mime: 'text/html',
        isProtected: false
    }
);

// Create data note for storing JSON
const dataNote = await api.createDataNote(
    parentNoteId,
    'config',
    { key: 'value', settings: {} }
);
```

#### Modifying Notes

```javascript
// Update note title
await note.setTitle('New Title');

// Update note content
await note.setContent('New content');

// Add label
await note.addLabel('status', 'completed');

// Add relation
await note.addRelation('relatedTo', targetNoteId);

// Remove attribute
await note.removeAttribute(attributeId);

// Toggle label
await note.toggleLabel('archived');
await note.toggleLabel('priority', 'high');
```

### UI Interaction

#### Showing Messages

```javascript
// Simple message
await api.showMessage('Operation completed');

// Error message
await api.showError('Something went wrong');

// Message with duration
await api.showMessage('Saved!', 3000);

// Persistent message
const toast = await api.showPersistent({
    title: 'Processing',
    message: 'Please wait...',
    icon: 'loader'
});

// Close persistent message
toast.close();
```

#### Dialogs

```javascript
// Confirmation dialog
const confirmed = await api.showConfirmDialog({
    title: 'Delete Note?',
    message: 'This action cannot be undone.',
    okButtonLabel: 'Delete',
    cancelButtonLabel: 'Keep'
});

if (confirmed) {
    // Proceed with deletion
}

// Prompt dialog
const input = await api.showPromptDialog({
    title: 'Enter Name',
    message: 'Please enter a name for the new note:',
    defaultValue: 'Untitled'
});

if (input) {
    await api.createNote(parentId, input, '');
}
```

### Custom Commands

#### Adding Menu Items

```javascript
// Add to note context menu
api.addContextMenuItemToNotes({
    title: 'Copy Note ID',
    icon: 'bx bx-copy',
    handler: async (note) => {
        await navigator.clipboard.writeText(note.noteId);
        await api.showMessage('Note ID copied');
    }
});

// Add to toolbar
api.addButtonToToolbar({
    title: 'Quick Action',
    icon: 'bx bx-bolt',
    shortcut: 'ctrl+shift+q',
    action: async () => {
        // Your action here
    }
});
```

#### Registering Commands

```javascript
// Register a global command
api.bindGlobalShortcut('ctrl+shift+t', async () => {
    const note = api.getActiveContextNote();
    const timestamp = new Date().toISOString();
    await note.addLabel('lastAccessed', timestamp);
    await api.showMessage('Timestamp added');
});

// Add command palette action
api.addCommandPaletteItem({
    name: 'Toggle Dark Mode',
    description: 'Switch between light and dark themes',
    action: async () => {
        const currentTheme = await api.getOption('theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        await api.setOption('theme', newTheme);
    }
});
```

### Event Handling

#### Listening to Events

```javascript
// Note switch event
api.onNoteChange(async ({ note, previousNote }) => {
    console.log(`Switched from ${previousNote?.title} to ${note.title}`);
    
    // Update custom UI
    updateCustomPanel(note);
});

// Content change event
api.onNoteContentChange(async ({ note }) => {
    console.log(`Content changed for ${note.title}`);
    
    // Auto-save to external service
    await syncToExternalService(note);
});

// Attribute change event
api.onAttributeChange(async ({ note, attribute }) => {
    if (attribute.name === 'status' && attribute.value === 'completed') {
        await note.addLabel('completedDate', new Date().toISOString());
    }
});
```

#### Custom Events

```javascript
// Trigger custom event
api.triggerEvent('myCustomEvent', { data: 'value' });

// Listen to custom event
api.onCustomEvent('myCustomEvent', async (data) => {
    console.log('Custom event received:', data);
});
```

### Working with Widgets

```javascript
// Access widget system
const widget = api.getWidget('NoteTreeWidget');

// Refresh widget
await widget.refresh();

// Create custom widget container
const container = api.createCustomWidget({
    title: 'My Widget',
    position: 'left',
    render: async () => {
        return `
            <div class="custom-widget">
                <h3>Custom Content</h3>
                <button onclick="handleClick()">Click Me</button>
            </div>
        `;
    }
});
```

## Complete Example: Auto-Formatting Script

Here's a comprehensive example that automatically formats notes based on their type:

```javascript
/**
 * Auto-Formatting Script
 * Automatically formats notes based on their type and content
 */

class NoteFormatter {
    constructor() {
        this.setupEventListeners();
        this.registerCommands();
    }
    
    setupEventListeners() {
        // Format on note save
        api.onNoteContentChange(async ({ note }) => {
            if (await this.shouldAutoFormat(note)) {
                await this.formatNote(note);
            }
        });
        
        // Format when label added
        api.onAttributeChange(async ({ note, attribute }) => {
            if (attribute.type === 'label' && 
                attribute.name === 'autoFormat' && 
                attribute.value === 'true') {
                await this.formatNote(note);
            }
        });
    }
    
    registerCommands() {
        // Add toolbar button
        api.addButtonToToolbar({
            title: 'Format Note',
            icon: 'bx bx-text',
            shortcut: 'ctrl+shift+f',
            action: async () => {
                const note = api.getActiveContextNote();
                await this.formatNote(note);
                await api.showMessage('Note formatted');
            }
        });
        
        // Add context menu item
        api.addContextMenuItemToNotes({
            title: 'Auto-Format',
            icon: 'bx bx-magic',
            handler: async (note) => {
                await this.formatNote(note);
            }
        });
    }
    
    async shouldAutoFormat(note) {
        // Check if note has autoFormat label
        const labels = note.getLabels();
        return labels.some(l => l.name === 'autoFormat' && l.value === 'true');
    }
    
    async formatNote(note) {
        const type = note.type;
        
        switch (type) {
            case 'text':
                await this.formatTextNote(note);
                break;
            case 'code':
                await this.formatCodeNote(note);
                break;
            case 'book':
                await this.formatBookNote(note);
                break;
        }
    }
    
    async formatTextNote(note) {
        let content = await note.getContent();
        
        // Apply formatting rules
        content = this.addTableOfContents(content);
        content = this.formatHeadings(content);
        content = this.formatLists(content);
        content = this.addMetadata(content, note);
        
        await note.setContent(content);
    }
    
    async formatCodeNote(note) {
        const content = await note.getContent();
        const language = note.getLabelValue('language') || 'javascript';
        
        // Add syntax highlighting hints
        if (!note.hasLabel('language')) {
            await note.addLabel('language', language);
        }
        
        // Format based on language
        if (language === 'javascript' || language === 'typescript') {
            await this.formatJavaScript(note, content);
        } else if (language === 'python') {
            await this.formatPython(note, content);
        }
    }
    
    async formatBookNote(note) {
        // Organize child notes
        const children = await note.getChildNotes();
        
        // Sort chapters
        const chapters = children.filter(n => n.hasLabel('chapter'));
        chapters.sort((a, b) => {
            const aNum = parseInt(a.getLabelValue('chapter')) || 999;
            const bNum = parseInt(b.getLabelValue('chapter')) || 999;
            return aNum - bNum;
        });
        
        // Generate table of contents
        const toc = this.generateBookTOC(chapters);
        await note.setContent(toc);
    }
    
    addTableOfContents(content) {
        const $content = $('<div>').html(content);
        const headings = $content.find('h1, h2, h3');
        
        if (headings.length < 3) return content;
        
        let toc = '<div class="table-of-contents">\n<h2>Table of Contents</h2>\n<ul>\n';
        
        headings.each((i, heading) => {
            const $h = $(heading);
            const level = parseInt(heading.tagName.substring(1));
            const text = $h.text();
            const id = `heading-${i}`;
            
            $h.attr('id', id);
            
            const indent = '  '.repeat(level - 1);
            toc += `${indent}<li><a href="#${id}">${text}</a></li>\n`;
        });
        
        toc += '</ul>\n</div>\n\n';
        
        return toc + $content.html();
    }
    
    formatHeadings(content) {
        const $content = $('<div>').html(content);
        
        // Ensure proper heading hierarchy
        let lastLevel = 0;
        $content.find('h1, h2, h3, h4, h5, h6').each((i, heading) => {
            const $h = $(heading);
            const level = parseInt(heading.tagName.substring(1));
            
            // Fix heading jumps (e.g., h1 -> h3 becomes h1 -> h2)
            if (level > lastLevel + 1) {
                const newTag = `h${lastLevel + 1}`;
                const $newHeading = $(`<${newTag}>`).html($h.html());
                $h.replaceWith($newHeading);
            }
            
            lastLevel = level;
        });
        
        return $content.html();
    }
    
    formatLists(content) {
        const $content = $('<div>').html(content);
        
        // Add classes to lists for styling
        $content.find('ul').addClass('formatted-list');
        $content.find('ol').addClass('formatted-list numbered');
        
        // Add checkboxes to task lists
        $content.find('li').each((i, li) => {
            const $li = $(li);
            const text = $li.text();
            
            if (text.startsWith('[ ] ')) {
                $li.html(`<input type="checkbox"> ${text.substring(4)}`);
                $li.addClass('task-item');
            } else if (text.startsWith('[x] ')) {
                $li.html(`<input type="checkbox" checked> ${text.substring(4)}`);
                $li.addClass('task-item completed');
            }
        });
        
        return $content.html();
    }
    
    addMetadata(content, note) {
        const metadata = {
            lastFormatted: new Date().toISOString(),
            wordCount: content.replace(/<[^>]*>/g, '').split(/\s+/).length,
            noteId: note.noteId
        };
        
        const metadataHtml = `
            <div class="note-metadata" style="display:none;">
                ${JSON.stringify(metadata)}
            </div>
        `;
        
        return content + metadataHtml;
    }
    
    async formatJavaScript(note, content) {
        // Add JSDoc comments if missing
        const lines = content.split('\n');
        const formatted = [];
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            // Detect function declarations
            if (line.match(/^\s*(async\s+)?function\s+\w+/)) {
                if (i === 0 || !lines[i-1].includes('*/')) {
                    formatted.push('/**');
                    formatted.push(' * [Description]');
                    formatted.push(' */');
                }
            }
            
            formatted.push(line);
        }
        
        await note.setContent(formatted.join('\n'));
    }
    
    async formatPython(note, content) {
        // Add docstrings if missing
        const lines = content.split('\n');
        const formatted = [];
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            // Detect function definitions
            if (line.match(/^\s*def\s+\w+/)) {
                formatted.push(line);
                if (i + 1 < lines.length && !lines[i + 1].includes('"""')) {
                    formatted.push('    """[Description]"""');
                }
            } else {
                formatted.push(line);
            }
        }
        
        await note.setContent(formatted.join('\n'));
    }
    
    generateBookTOC(chapters) {
        let toc = '<h1>Table of Contents</h1>\n<ol>\n';
        
        for (const chapter of chapters) {
            const num = chapter.getLabelValue('chapter');
            const title = chapter.title;
            toc += `  <li><a href="#${chapter.noteId}">${num}. ${title}</a></li>\n`;
        }
        
        toc += '</ol>';
        return toc;
    }
}

// Initialize formatter
const formatter = new NoteFormatter();

// Add settings UI
api.addSettingsTab({
    tabId: 'autoFormat',
    title: 'Auto-Format',
    render: () => {
        return `
            <div class="auto-format-settings">
                <h3>Auto-Format Settings</h3>
                
                <label>
                    <input type="checkbox" id="enableAutoFormat">
                    Enable auto-formatting
                </label>
                
                <label>
                    <input type="checkbox" id="formatOnSave">
                    Format on save
                </label>
                
                <label>
                    <input type="checkbox" id="addTOC">
                    Auto-add table of contents
                </label>
                
                <h4>Format Rules</h4>
                <textarea id="formatRules" rows="10">
{
  "headings": true,
  "lists": true,
  "tables": true,
  "codeBlocks": true
}
                </textarea>
                
                <button onclick="saveFormatSettings()">Save Settings</button>
            </div>
        `;
    }
});

// Save settings function
window.saveFormatSettings = async () => {
    const settings = {
        enableAutoFormat: document.getElementById('enableAutoFormat').checked,
        formatOnSave: document.getElementById('formatOnSave').checked,
        addTOC: document.getElementById('addTOC').checked,
        rules: JSON.parse(document.getElementById('formatRules').value)
    };
    
    await api.setOption('autoFormatSettings', JSON.stringify(settings));
    await api.showMessage('Settings saved');
};

console.log('Auto-formatting script loaded');
```

## Advanced Techniques

### Working with External APIs

```javascript
// Fetch data from external API
async function fetchExternalData() {
    try {
        const response = await fetch('https://api.example.com/data', {
            headers: {
                'Authorization': `Bearer ${await api.getOption('apiKey')}`
            }
        });
        
        const data = await response.json();
        
        // Store in note
        const dataNote = await api.createDataNote(
            'root',
            'External Data',
            data
        );
        
        await api.showMessage('Data imported successfully');
        
    } catch (error) {
        await api.showError(`Failed to fetch data: ${error.message}`);
    }
}
```

### State Management

```javascript
// Create a state manager
class StateManager {
    constructor() {
        this.state = {};
        this.subscribers = [];
        this.loadState();
    }
    
    async loadState() {
        const stored = await api.getOption('scriptState');
        if (stored) {
            this.state = JSON.parse(stored);
        }
    }
    
    async setState(key, value) {
        this.state[key] = value;
        await this.saveState();
        this.notifySubscribers(key, value);
    }
    
    getState(key) {
        return this.state[key];
    }
    
    async saveState() {
        await api.setOption('scriptState', JSON.stringify(this.state));
    }
    
    subscribe(callback) {
        this.subscribers.push(callback);
    }
    
    notifySubscribers(key, value) {
        this.subscribers.forEach(cb => cb(key, value));
    }
}

const state = new StateManager();
```

### Custom UI Components

```javascript
// Create custom panel
class CustomPanel {
    constructor() {
        this.createPanel();
    }
    
    createPanel() {
        const $panel = $(`
            <div id="custom-panel" class="custom-panel">
                <div class="panel-header">
                    <h3>Custom Panel</h3>
                    <button class="close-btn">×</button>
                </div>
                <div class="panel-body">
                    <!-- Content here -->
                </div>
            </div>
        `);
        
        $('body').append($panel);
        
        // Add styles
        $('<style>').text(`
            .custom-panel {
                position: fixed;
                right: 20px;
                top: 80px;
                width: 300px;
                background: var(--main-background-color);
                border: 1px solid var(--main-border-color);
                border-radius: 8px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                z-index: 1000;
            }
            
            .panel-header {
                padding: 10px;
                border-bottom: 1px solid var(--main-border-color);
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            
            .panel-body {
                padding: 15px;
                max-height: 400px;
                overflow-y: auto;
            }
            
            .close-btn {
                background: none;
                border: none;
                font-size: 20px;
                cursor: pointer;
            }
        `).appendTo('head');
        
        // Bind events
        $panel.find('.close-btn').on('click', () => {
            $panel.hide();
        });
    }
    
    show() {
        $('#custom-panel').show();
    }
    
    hide() {
        $('#custom-panel').hide();
    }
    
    setContent(html) {
        $('#custom-panel .panel-body').html(html);
    }
}

const panel = new CustomPanel();
```

## Performance Optimization

### Debouncing

```javascript
// Debounce function calls
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Usage
const debouncedSearch = debounce(async (query) => {
    const results = await api.searchForNotes(query);
    displayResults(results);
}, 300);

// Input handler
$('#search-input').on('input', (e) => {
    debouncedSearch(e.target.value);
});
```

### Caching

```javascript
// Implement caching for expensive operations
class CacheManager {
    constructor(maxAge = 60000) { // 1 minute default
        this.cache = new Map();
        this.maxAge = maxAge;
    }
    
    set(key, value) {
        this.cache.set(key, {
            value,
            timestamp: Date.now()
        });
    }
    
    get(key) {
        const item = this.cache.get(key);
        if (!item) return null;
        
        if (Date.now() - item.timestamp > this.maxAge) {
            this.cache.delete(key);
            return null;
        }
        
        return item.value;
    }
    
    clear() {
        this.cache.clear();
    }
}

const cache = new CacheManager();

// Use cache for API calls
async function getCachedNote(noteId) {
    let note = cache.get(noteId);
    if (!note) {
        note = await api.getNote(noteId);
        cache.set(noteId, note);
    }
    return note;
}
```

## Error Handling

```javascript
// Global error handler for scripts
window.addEventListener('error', async (event) => {
    console.error('Script error:', event.error);
    
    // Log to note
    const errorNote = await api.getNote('scriptErrorLog');
    if (errorNote) {
        const content = await errorNote.getContent();
        const errorLog = `
            <div class="error-entry">
                <strong>${new Date().toISOString()}</strong><br>
                ${event.error.message}<br>
                <pre>${event.error.stack}</pre>
            </div>
        `;
        await errorNote.setContent(content + errorLog);
    }
    
    // Notify user
    await api.showError('Script error occurred. Check error log.');
});

// Wrap async operations
async function safeExecute(func, fallback = null) {
    try {
        return await func();
    } catch (error) {
        console.error('Operation failed:', error);
        await api.showError(`Operation failed: ${error.message}`);
        return fallback;
    }
}

// Usage
const result = await safeExecute(
    async () => await riskyOperation(),
    defaultValue
);
```

## Testing Frontend Scripts

```javascript
// Simple test framework
class TestRunner {
    constructor() {
        this.tests = [];
        this.results = [];
    }
    
    test(name, testFunc) {
        this.tests.push({ name, testFunc });
    }
    
    async run() {
        console.log('Running tests...');
        
        for (const test of this.tests) {
            try {
                await test.testFunc();
                this.results.push({
                    name: test.name,
                    status: 'passed'
                });
                console.log(`✓ ${test.name}`);
            } catch (error) {
                this.results.push({
                    name: test.name,
                    status: 'failed',
                    error: error.message
                });
                console.error(`✗ ${test.name}: ${error.message}`);
            }
        }
        
        this.displayResults();
    }
    
    displayResults() {
        const passed = this.results.filter(r => r.status === 'passed').length;
        const failed = this.results.filter(r => r.status === 'failed').length;
        
        console.log(`\nResults: ${passed} passed, ${failed} failed`);
        
        if (failed > 0) {
            console.log('\nFailed tests:');
            this.results
                .filter(r => r.status === 'failed')
                .forEach(r => console.log(`  - ${r.name}: ${r.error}`));
        }
    }
}

// Write tests
const runner = new TestRunner();

runner.test('Note creation', async () => {
    const note = await api.createNote('root', 'Test Note', 'Content');
    if (!note.noteId) throw new Error('Note ID not set');
    if (note.title !== 'Test Note') throw new Error('Title mismatch');
});

runner.test('Attribute handling', async () => {
    const note = await api.getActiveContextNote();
    await note.addLabel('test', 'value');
    const label = note.getLabelValue('test');
    if (label !== 'value') throw new Error('Label value mismatch');
});

// Run tests
await runner.run();
```

## Best Practices

1.  **Code Organization**
    
    *   Use classes for complex functionality
    *   Separate concerns into modules
    *   Keep functions small and focused
2.  **Performance**
    
    *   Debounce expensive operations
    *   Cache frequently accessed data
    *   Use async/await properly
3.  **Error Handling**
    
    *   Always handle errors gracefully
    *   Provide meaningful error messages
    *   Log errors for debugging
4.  **User Experience**
    
    *   Show loading states
    *   Provide feedback for actions
    *   Ensure scripts don't block UI
5.  **Security**
    
    *   Validate user input
    *   Sanitize HTML content
    *   Be cautious with external APIs

## Troubleshooting

### Script Not Running

*   Check the `#run` label is set correctly
*   Verify syntax errors in console
*   Ensure script note is not archived

### API Methods Not Available

*   Check you're using correct API version
*   Verify method names and parameters
*   Consult API documentation

### Performance Issues

*   Profile script with browser dev tools
*   Implement caching
*   Optimize DOM operations

### Event Handlers Not Firing

*   Verify event names are correct
*   Check element selectors
*   Ensure elements exist when binding

## Next Steps

*   Explore the Backend Script Development guide
*   Review existing scripts in the Trilium community
*   Experiment with the Script API documentation