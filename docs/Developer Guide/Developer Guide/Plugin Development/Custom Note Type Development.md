# Custom Note Type Development
## Custom Note Type Development Guide

This guide covers creating new note types in Trilium Notes. Custom note types enable specialized content handling with dedicated rendering, editing, and behavior.

## Prerequisites

*   TypeScript/JavaScript proficiency
*   Understanding of Trilium's widget system
*   Knowledge of frontend and backend development
*   Familiarity with HTML/CSS

## Understanding Note Types

### Built-in Note Types

Trilium includes several built-in note types:

*   **text** - Rich text with HTML content
*   **code** - Syntax-highlighted code
*   **file** - Binary attachments
*   **image** - Image display
*   **search** - Saved searches
*   **book** - Hierarchical documentation
*   **render** - HTML rendering
*   **canvas** - Drawing with Excalidraw
*   **mermaid** - Diagram generation
*   **webView** - Embedded web pages
*   **mindMap** - Mind mapping
*   **relationMap** - Note relationships
*   **noteMap** - Visual note hierarchy

### Note Type Architecture

Each note type consists of:

1.  **Type Widget** - Handles rendering and editing
2.  **MIME Type** - Content format specification
3.  **Backend Handler** - Server-side processing
4.  **Import/Export** - Data conversion logic

## Creating a Custom Note Type

### Step 1: Define the Note Type

Register your note type in the system:

```typescript
// apps/client/src/services/note_types.ts

export const NOTE_TYPES = {
    // ... existing types
    markdown: {
        type: 'markdown',
        mime: 'text/markdown',
        label: 'Markdown',
        icon: 'bx bx-markdown',
        description: 'Markdown document with live preview'
    }
};
```

### Step 2: Create the Type Widget

```typescript
// apps/client/src/widgets/type_widgets/markdown.ts

import TypeWidget from "./type_widget.js";
import { marked } from 'marked';
import SpacedUpdate from "../../services/spaced_update.js";
import server from "../../services/server.js";
import toastService from "../../services/toast.js";

export default class MarkdownTypeWidget extends TypeWidget {
    static getType() { 
        return "markdown"; 
    }
    
    constructor() {
        super();
        
        this.spacedUpdate = new SpacedUpdate(async () => {
            await this.saveContent();
        }, 1000);
        
        this.isEditing = false;
        this.lastContent = '';
    }
    
    doRender() {
        this.$widget = $(`
            <div class="markdown-type-widget">
                <div class="markdown-toolbar">
                    <button class="btn btn-sm toggle-edit">
                        <span class="bx bx-edit"></span> Edit
                    </button>
                    <button class="btn btn-sm toggle-preview">
                        <span class="bx bx-show"></span> Preview
                    </button>
                    <button class="btn btn-sm export-html">
                        <span class="bx bx-export"></span> Export HTML
                    </button>
                </div>
                
                <div class="markdown-container">
                    <div class="markdown-editor">
                        <textarea class="markdown-input"></textarea>
                    </div>
                    <div class="markdown-preview"></div>
                </div>
            </div>
        `);
        
        this.setupStyles();
        this.bindEvents();
    }
    
    setupStyles() {
        this.cssBlock(`
            .markdown-type-widget {
                height: 100%;
                display: flex;
                flex-direction: column;
            }
            
            .markdown-toolbar {
                padding: 10px;
                border-bottom: 1px solid var(--main-border-color);
                display: flex;
                gap: 10px;
            }
            
            .markdown-container {
                flex: 1;
                display: flex;
                overflow: hidden;
            }
            
            .markdown-editor,
            .markdown-preview {
                flex: 1;
                padding: 20px;
                overflow-y: auto;
            }
            
            .markdown-editor {
                border-right: 1px solid var(--main-border-color);
            }
            
            .markdown-input {
                width: 100%;
                height: 100%;
                border: none;
                outline: none;
                font-family: 'Monaco', 'Courier New', monospace;
                font-size: 14px;
                line-height: 1.6;
                resize: none;
                background: var(--main-background-color);
                color: var(--main-text-color);
            }
            
            .markdown-preview {
                background: var(--main-background-color);
            }
            
            .markdown-preview h1 { 
                font-size: 2em; 
                margin: 0.67em 0;
                border-bottom: 1px solid var(--main-border-color);
                padding-bottom: 0.3em;
            }
            
            .markdown-preview h2 {
                font-size: 1.5em;
                margin: 0.75em 0;
                border-bottom: 1px solid var(--main-border-color);
                padding-bottom: 0.3em;
            }
            
            .markdown-preview code {
                background: var(--code-background-color);
                padding: 2px 4px;
                border-radius: 3px;
                font-family: 'Monaco', 'Courier New', monospace;
            }
            
            .markdown-preview pre {
                background: var(--code-background-color);
                padding: 16px;
                border-radius: 6px;
                overflow-x: auto;
            }
            
            .markdown-preview blockquote {
                border-left: 4px solid var(--primary-color);
                margin: 0;
                padding-left: 16px;
                color: var(--muted-text-color);
            }
            
            .markdown-preview table {
                border-collapse: collapse;
                width: 100%;
                margin: 1em 0;
            }
            
            .markdown-preview th,
            .markdown-preview td {
                border: 1px solid var(--main-border-color);
                padding: 8px 12px;
            }
            
            .markdown-preview th {
                background: var(--button-background-color);
                font-weight: 600;
            }
            
            .markdown-type-widget.preview-only .markdown-editor {
                display: none;
            }
            
            .markdown-type-widget.preview-only .markdown-preview {
                border-right: none;
            }
            
            .markdown-type-widget.edit-only .markdown-preview {
                display: none;
            }
            
            .markdown-type-widget.edit-only .markdown-editor {
                border-right: none;
            }
        `);
    }
    
    bindEvents() {
        const $input = this.$widget.find('.markdown-input');
        const $preview = this.$widget.find('.markdown-preview');
        
        // Text input handler
        $input.on('input', () => {
            const content = $input.val() as string;
            this.updatePreview(content);
            this.spacedUpdate.scheduleUpdate();
        });
        
        // Toolbar buttons
        this.$widget.find('.toggle-edit').on('click', () => {
            this.$widget.toggleClass('edit-only');
            this.$widget.removeClass('preview-only');
        });
        
        this.$widget.find('.toggle-preview').on('click', () => {
            this.$widget.toggleClass('preview-only');
            this.$widget.removeClass('edit-only');
        });
        
        this.$widget.find('.export-html').on('click', () => {
            this.exportAsHtml();
        });
        
        // Keyboard shortcuts
        $input.on('keydown', (e) => {
            this.handleKeyboard(e);
        });
    }
    
    handleKeyboard(e: JQuery.KeyDownEvent) {
        const $input = $(e.target);
        
        // Tab handling for lists
        if (e.key === 'Tab') {
            e.preventDefault();
            const start = ($input[0] as HTMLTextAreaElement).selectionStart;
            const end = ($input[0] as HTMLTextAreaElement).selectionEnd;
            const value = $input.val() as string;
            
            $input.val(value.substring(0, start) + '    ' + value.substring(end));
            ($input[0] as HTMLTextAreaElement).selectionStart = 
            ($input[0] as HTMLTextAreaElement).selectionEnd = start + 4;
        }
        
        // Bold shortcut (Ctrl+B)
        if (e.ctrlKey && e.key === 'b') {
            e.preventDefault();
            this.wrapSelection('**', '**');
        }
        
        // Italic shortcut (Ctrl+I)
        if (e.ctrlKey && e.key === 'i') {
            e.preventDefault();
            this.wrapSelection('*', '*');
        }
        
        // Link shortcut (Ctrl+K)
        if (e.ctrlKey && e.key === 'k') {
            e.preventDefault();
            this.insertLink();
        }
    }
    
    wrapSelection(before: string, after: string) {
        const $input = this.$widget.find('.markdown-input');
        const textarea = $input[0] as HTMLTextAreaElement;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const value = $input.val() as string;
        const selection = value.substring(start, end);
        
        const newValue = value.substring(0, start) + 
                        before + selection + after + 
                        value.substring(end);
        
        $input.val(newValue);
        textarea.selectionStart = start + before.length;
        textarea.selectionEnd = end + before.length;
        
        $input.trigger('input');
    }
    
    async insertLink() {
        const url = prompt('Enter URL:');
        if (url) {
            const $input = this.$widget.find('.markdown-input');
            const textarea = $input[0] as HTMLTextAreaElement;
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            const value = $input.val() as string;
            const selection = value.substring(start, end) || 'link text';
            
            const link = `[${selection}](${url})`;
            const newValue = value.substring(0, start) + link + value.substring(end);
            
            $input.val(newValue);
            $input.trigger('input');
        }
    }
    
    updatePreview(content: string) {
        // Configure marked options
        marked.setOptions({
            breaks: true,
            gfm: true,
            tables: true,
            sanitize: false,
            smartLists: true,
            smartypants: true,
            highlight: (code, lang) => {
                // Add syntax highlighting if available
                if (window.hljs && lang && window.hljs.getLanguage(lang)) {
                    return window.hljs.highlight(code, { language: lang }).value;
                }
                return code;
            }
        });
        
        // Convert markdown to HTML
        const html = marked.parse(content);
        
        // Update preview
        this.$widget.find('.markdown-preview').html(html);
        
        // Process internal links
        this.processInternalLinks();
    }
    
    processInternalLinks() {
        this.$widget.find('.markdown-preview a').each((_, el) => {
            const $link = $(el);
            const href = $link.attr('href');
            
            // Check for internal note links
            if (href?.startsWith('#')) {
                const noteId = href.substring(1);
                $link.on('click', async (e) => {
                    e.preventDefault();
                    const note = await froca.getNote(noteId);
                    if (note) {
                        appContext.tabManager.getActiveContext()?.setNote(noteId);
                    }
                });
            }
        });
    }
    
    async doRefresh(note) {
        this.note = note;
        const content = await this.getContent();
        
        this.$widget.find('.markdown-input').val(content);
        this.updatePreview(content);
        
        this.lastContent = content;
    }
    
    async getContent() {
        return await this.note.getContent();
    }
    
    async saveContent() {
        const content = this.$widget.find('.markdown-input').val() as string;
        
        if (content === this.lastContent) {
            return; // No changes
        }
        
        try {
            await server.put(`notes/${this.note.noteId}/content`, {
                content: content
            });
            
            this.lastContent = content;
            
        } catch (error) {
            toastService.showError('Failed to save markdown content');
            console.error('Save error:', error);
        }
    }
    
    async exportAsHtml() {
        const content = this.$widget.find('.markdown-input').val() as string;
        const html = marked.parse(content);
        
        // Create full HTML document
        const fullHtml = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <title>${this.note.title}</title>
                <style>
                    body {
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
                        line-height: 1.6;
                        max-width: 800px;
                        margin: 0 auto;
                        padding: 20px;
                    }
                    h1, h2 {
                        border-bottom: 1px solid #eee;
                        padding-bottom: 0.3em;
                    }
                    code {
                        background: #f4f4f4;
                        padding: 2px 4px;
                        border-radius: 3px;
                    }
                    pre {
                        background: #f4f4f4;
                        padding: 16px;
                        border-radius: 6px;
                        overflow-x: auto;
                    }
                    blockquote {
                        border-left: 4px solid #ddd;
                        margin: 0;
                        padding-left: 16px;
                        color: #666;
                    }
                    table {
                        border-collapse: collapse;
                        width: 100%;
                    }
                    th, td {
                        border: 1px solid #ddd;
                        padding: 8px 12px;
                    }
                    th {
                        background: #f4f4f4;
                    }
                </style>
            </head>
            <body>
                ${html}
            </body>
            </html>
        `;
        
        // Download file
        const blob = new Blob([fullHtml], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${this.note.title}.html`;
        a.click();
        URL.revokeObjectURL(url);
        
        toastService.showMessage('Markdown exported as HTML');
    }
    
    cleanup() {
        this.$widget.find('.markdown-input').off();
        this.$widget.find('button').off();
        this.spacedUpdate = null;
    }
}
```

### Step 3: Register the Widget

```typescript
// apps/client/src/services/note_type_registry.ts

import MarkdownTypeWidget from "../widgets/type_widgets/markdown.js";

export function registerNoteTypes() {
    // ... existing registrations
    
    noteTypeService.register(MarkdownTypeWidget);
}
```

### Step 4: Add Backend Support

```typescript
// apps/server/src/services/notes.ts

// Add to note creation
export async function createNote(params: NoteParams) {
    // ... existing code
    
    if (params.type === 'markdown') {
        // Set appropriate MIME type
        params.mime = 'text/markdown';
        
        // Initialize with template if needed
        if (!params.content) {
            params.content = '# New Markdown Note\n\nStart writing...';
        }
    }
    
    // ... rest of creation logic
}

// Add import support
export async function importMarkdown(filePath: string, parentNoteId: string) {
    const fs = require('fs').promises;
    const content = await fs.readFile(filePath, 'utf8');
    
    const note = await createNote({
        parentNoteId,
        title: path.basename(filePath, '.md'),
        content,
        type: 'markdown',
        mime: 'text/markdown'
    });
    
    return note;
}

// Add export support
export async function exportMarkdown(noteId: string, targetPath: string) {
    const note = await becca.getNote(noteId);
    const content = await note.getContent();
    
    const fs = require('fs').promises;
    await fs.writeFile(targetPath, content, 'utf8');
}
```

## Complete Example: Markdown Preview Note Type

Here's a full implementation of a markdown note type with live preview:

### Widget Implementation

```typescript
// apps/client/src/widgets/type_widgets/markdown_preview.ts

import TypeWidget from "./type_widget.js";
import SpacedUpdate from "../../services/spaced_update.js";
import server from "../../services/server.js";
import toastService from "../../services/toast.js";
import appContext from "../../components/app_context.js";
import froca from "../../services/froca.js";
import linkService from "../../services/link.js";
import utils from "../../services/utils.js";

interface MarkdownConfig {
    splitView: boolean;
    syncScroll: boolean;
    showLineNumbers: boolean;
    theme: 'light' | 'dark' | 'auto';
}

export default class MarkdownPreviewWidget extends TypeWidget {
    static getType() { 
        return "markdownPreview"; 
    }
    
    private config: MarkdownConfig;
    private editor: any; // CodeMirror instance
    private spacedUpdate: SpacedUpdate;
    private isRendering: boolean = false;
    
    constructor() {
        super();
        
        this.config = {
            splitView: true,
            syncScroll: true,
            showLineNumbers: true,
            theme: 'auto'
        };
        
        this.spacedUpdate = new SpacedUpdate(async () => {
            await this.saveContent();
        }, 1000);
    }
    
    doRender() {
        this.$widget = $(`
            <div class="markdown-preview-widget">
                <div class="markdown-header">
                    <div class="markdown-toolbar">
                        <div class="btn-group">
                            <button class="btn btn-sm" data-action="bold" title="Bold (Ctrl+B)">
                                <span class="bx bx-bold"></span>
                            </button>
                            <button class="btn btn-sm" data-action="italic" title="Italic (Ctrl+I)">
                                <span class="bx bx-italic"></span>
                            </button>
                            <button class="btn btn-sm" data-action="strikethrough" title="Strikethrough">
                                <span class="bx bx-strikethrough"></span>
                            </button>
                        </div>
                        
                        <div class="btn-group">
                            <button class="btn btn-sm" data-action="h1" title="Heading 1">
                                H1
                            </button>
                            <button class="btn btn-sm" data-action="h2" title="Heading 2">
                                H2
                            </button>
                            <button class="btn btn-sm" data-action="h3" title="Heading 3">
                                H3
                            </button>
                        </div>
                        
                        <div class="btn-group">
                            <button class="btn btn-sm" data-action="ul" title="Unordered List">
                                <span class="bx bx-list-ul"></span>
                            </button>
                            <button class="btn btn-sm" data-action="ol" title="Ordered List">
                                <span class="bx bx-list-ol"></span>
                            </button>
                            <button class="btn btn-sm" data-action="task" title="Task List">
                                <span class="bx bx-checkbox"></span>
                            </button>
                        </div>
                        
                        <div class="btn-group">
                            <button class="btn btn-sm" data-action="quote" title="Quote">
                                <span class="bx bx-message-square-dots"></span>
                            </button>
                            <button class="btn btn-sm" data-action="code" title="Code">
                                <span class="bx bx-code"></span>
                            </button>
                            <button class="btn btn-sm" data-action="codeblock" title="Code Block">
                                <span class="bx bx-code-block"></span>
                            </button>
                        </div>
                        
                        <div class="btn-group">
                            <button class="btn btn-sm" data-action="link" title="Link (Ctrl+K)">
                                <span class="bx bx-link"></span>
                            </button>
                            <button class="btn btn-sm" data-action="image" title="Image">
                                <span class="bx bx-image"></span>
                            </button>
                            <button class="btn btn-sm" data-action="table" title="Table">
                                <span class="bx bx-table"></span>
                            </button>
                        </div>
                        
                        <div class="btn-group">
                            <button class="btn btn-sm" data-action="hr" title="Horizontal Rule">
                                —
                            </button>
                        </div>
                    </div>
                    
                    <div class="markdown-view-controls">
                        <button class="btn btn-sm" data-view="edit" title="Edit Only">
                            <span class="bx bx-edit"></span>
                        </button>
                        <button class="btn btn-sm active" data-view="split" title="Split View">
                            <span class="bx bx-columns"></span>
                        </button>
                        <button class="btn btn-sm" data-view="preview" title="Preview Only">
                            <span class="bx bx-show"></span>
                        </button>
                    </div>
                </div>
                
                <div class="markdown-content">
                    <div class="markdown-editor-container">
                        <textarea class="markdown-editor"></textarea>
                    </div>
                    <div class="markdown-preview-container">
                        <div class="markdown-preview"></div>
                    </div>
                </div>
                
                <div class="markdown-footer">
                    <div class="markdown-stats">
                        <span class="stat-item">
                            <span class="stat-label">Words:</span>
                            <span class="stat-value" data-stat="words">0</span>
                        </span>
                        <span class="stat-item">
                            <span class="stat-label">Characters:</span>
                            <span class="stat-value" data-stat="chars">0</span>
                        </span>
                        <span class="stat-item">
                            <span class="stat-label">Lines:</span>
                            <span class="stat-value" data-stat="lines">0</span>
                        </span>
                    </div>
                    
                    <div class="markdown-actions">
                        <button class="btn btn-sm" data-action="export-html">
                            Export HTML
                        </button>
                        <button class="btn btn-sm" data-action="export-pdf">
                            Export PDF
                        </button>
                    </div>
                </div>
            </div>
        `);
        
        this.setupStyles();
        this.initializeEditor();
        this.bindEvents();
    }
    
    setupStyles() {
        this.cssBlock(`
            .markdown-preview-widget {
                height: 100%;
                display: flex;
                flex-direction: column;
                background: var(--main-background-color);
            }
            
            .markdown-header {
                border-bottom: 1px solid var(--main-border-color);
                padding: 8px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                flex-wrap: wrap;
                gap: 8px;
            }
            
            .markdown-toolbar {
                display: flex;
                gap: 12px;
                flex-wrap: wrap;
            }
            
            .markdown-toolbar .btn-group {
                display: flex;
                gap: 2px;
            }
            
            .markdown-toolbar .btn {
                padding: 4px 8px;
                min-width: 32px;
            }
            
            .markdown-view-controls {
                display: flex;
                gap: 2px;
            }
            
            .markdown-content {
                flex: 1;
                display: flex;
                overflow: hidden;
            }
            
            .markdown-editor-container,
            .markdown-preview-container {
                flex: 1;
                overflow: auto;
            }
            
            .markdown-editor-container {
                border-right: 1px solid var(--main-border-color);
            }
            
            .CodeMirror {
                height: 100%;
                font-family: 'Monaco', 'Courier New', monospace;
                font-size: 14px;
            }
            
            .markdown-preview {
                padding: 20px;
                max-width: 900px;
                margin: 0 auto;
            }
            
            /* Markdown preview styles */
            .markdown-preview h1 {
                font-size: 2.5em;
                margin: 0.67em 0;
                padding-bottom: 0.3em;
                border-bottom: 2px solid var(--main-border-color);
            }
            
            .markdown-preview h2 {
                font-size: 2em;
                margin: 0.75em 0;
                padding-bottom: 0.3em;
                border-bottom: 1px solid var(--main-border-color);
            }
            
            .markdown-preview h3 {
                font-size: 1.5em;
                margin: 0.83em 0;
            }
            
            .markdown-preview h4 {
                font-size: 1.2em;
                margin: 1em 0;
            }
            
            .markdown-preview p {
                margin: 1em 0;
                line-height: 1.7;
            }
            
            .markdown-preview code {
                background: var(--code-background-color);
                padding: 2px 6px;
                border-radius: 3px;
                font-family: 'Monaco', 'Courier New', monospace;
                font-size: 0.9em;
            }
            
            .markdown-preview pre {
                background: var(--code-background-color);
                padding: 16px;
                border-radius: 6px;
                overflow-x: auto;
                line-height: 1.45;
            }
            
            .markdown-preview pre code {
                background: none;
                padding: 0;
            }
            
            .markdown-preview blockquote {
                border-left: 4px solid var(--primary-color);
                margin: 1em 0;
                padding: 0.5em 1em;
                color: var(--muted-text-color);
                background: var(--button-background-color);
            }
            
            .markdown-preview ul,
            .markdown-preview ol {
                margin: 1em 0;
                padding-left: 2em;
            }
            
            .markdown-preview li {
                margin: 0.5em 0;
            }
            
            .markdown-preview table {
                border-collapse: collapse;
                width: 100%;
                margin: 1em 0;
            }
            
            .markdown-preview th,
            .markdown-preview td {
                border: 1px solid var(--main-border-color);
                padding: 8px 12px;
                text-align: left;
            }
            
            .markdown-preview th {
                background: var(--button-background-color);
                font-weight: 600;
            }
            
            .markdown-preview img {
                max-width: 100%;
                height: auto;
                display: block;
                margin: 1em auto;
            }
            
            .markdown-preview a {
                color: var(--link-color);
                text-decoration: none;
            }
            
            .markdown-preview a:hover {
                text-decoration: underline;
            }
            
            .markdown-preview hr {
                border: none;
                border-top: 2px solid var(--main-border-color);
                margin: 2em 0;
            }
            
            .markdown-preview .task-list-item {
                list-style: none;
                margin-left: -1.5em;
            }
            
            .markdown-preview .task-list-item input[type="checkbox"] {
                margin-right: 0.5em;
            }
            
            .markdown-footer {
                border-top: 1px solid var(--main-border-color);
                padding: 8px 16px;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            
            .markdown-stats {
                display: flex;
                gap: 20px;
                font-size: 0.9em;
                color: var(--muted-text-color);
            }
            
            .stat-label {
                margin-right: 4px;
            }
            
            .stat-value {
                font-weight: 600;
                color: var(--main-text-color);
            }
            
            /* View modes */
            .markdown-preview-widget.edit-mode .markdown-preview-container {
                display: none;
            }
            
            .markdown-preview-widget.edit-mode .markdown-editor-container {
                border-right: none;
            }
            
            .markdown-preview-widget.preview-mode .markdown-editor-container {
                display: none;
            }
            
            /* Syntax highlighting */
            .hljs {
                background: var(--code-background-color);
                color: var(--main-text-color);
            }
        `);
    }
    
    initializeEditor() {
        // Initialize CodeMirror
        const textarea = this.$widget.find('.markdown-editor')[0];
        
        this.editor = CodeMirror.fromTextArea(textarea, {
            mode: 'markdown',
            lineNumbers: this.config.showLineNumbers,
            lineWrapping: true,
            theme: this.getEditorTheme(),
            extraKeys: {
                'Ctrl-B': () => this.insertFormatting('bold'),
                'Ctrl-I': () => this.insertFormatting('italic'),
                'Ctrl-K': () => this.insertFormatting('link'),
                'Tab': 'indentMore',
                'Shift-Tab': 'indentLess'
            }
        });
        
        // Handle editor changes
        this.editor.on('change', () => {
            this.handleContentChange();
        });
        
        // Sync scroll if enabled
        if (this.config.syncScroll) {
            this.setupScrollSync();
        }
    }
    
    getEditorTheme() {
        if (this.config.theme === 'auto') {
            const isDark = $('body').hasClass('theme-dark');
            return isDark ? 'monokai' : 'default';
        }
        return this.config.theme === 'dark' ? 'monokai' : 'default';
    }
    
    setupScrollSync() {
        const editorScroll = this.$widget.find('.CodeMirror-scroll');
        const previewScroll = this.$widget.find('.markdown-preview-container');
        
        let syncingScroll = false;
        
        editorScroll.on('scroll', () => {
            if (syncingScroll) return;
            syncingScroll = true;
            
            const percentage = editorScroll.scrollTop() / 
                             (editorScroll[0].scrollHeight - editorScroll.height());
            
            previewScroll.scrollTop(
                percentage * (previewScroll[0].scrollHeight - previewScroll.height())
            );
            
            setTimeout(() => syncingScroll = false, 100);
        });
        
        previewScroll.on('scroll', () => {
            if (syncingScroll) return;
            syncingScroll = true;
            
            const percentage = previewScroll.scrollTop() / 
                             (previewScroll[0].scrollHeight - previewScroll.height());
            
            editorScroll.scrollTop(
                percentage * (editorScroll[0].scrollHeight - editorScroll.height())
            );
            
            setTimeout(() => syncingScroll = false, 100);
        });
    }
    
    bindEvents() {
        // Toolbar buttons
        this.$widget.on('click', '[data-action]', (e) => {
            const action = $(e.currentTarget).attr('data-action');
            this.handleAction(action!);
        });
        
        // View mode buttons
        this.$widget.on('click', '[data-view]', (e) => {
            const $btn = $(e.currentTarget);
            const view = $btn.attr('data-view');
            
            this.$widget.find('[data-view]').removeClass('active');
            $btn.addClass('active');
            
            this.$widget.removeClass('edit-mode preview-mode');
            if (view === 'edit') {
                this.$widget.addClass('edit-mode');
            } else if (view === 'preview') {
                this.$widget.addClass('preview-mode');
            }
        });
    }
    
    handleContentChange() {
        const content = this.editor.getValue();
        
        // Update preview
        this.renderPreview(content);
        
        // Update statistics
        this.updateStatistics(content);
        
        // Schedule save
        this.spacedUpdate.scheduleUpdate();
    }
    
    renderPreview(content: string) {
        if (this.isRendering) return;
        this.isRendering = true;
        
        // Use marked.js for markdown rendering
        const marked = window.marked;
        
        marked.setOptions({
            breaks: true,
            gfm: true,
            tables: true,
            smartLists: true,
            smartypants: true,
            highlight: (code, lang) => {
                if (window.hljs && lang && window.hljs.getLanguage(lang)) {
                    try {
                        return window.hljs.highlight(code, { language: lang }).value;
                    } catch (e) {
                        console.error('Highlight error:', e);
                    }
                }
                return code;
            }
        });
        
        try {
            const html = marked.parse(content);
            this.$widget.find('.markdown-preview').html(html);
            
            // Process internal links
            this.processLinks();
            
            // Process checkboxes
            this.processCheckboxes();
            
        } catch (error) {
            console.error('Markdown render error:', error);
        }
        
        this.isRendering = false;
    }
    
    processLinks() {
        this.$widget.find('.markdown-preview a').each((_, el) => {
            const $link = $(el);
            const href = $link.attr('href');
            
            if (!href) return;
            
            // Internal note links (#noteId)
            if (href.startsWith('#')) {
                const noteId = href.substring(1);
                $link.on('click', async (e) => {
                    e.preventDefault();
                    await appContext.tabManager.getActiveContext()?.setNote(noteId);
                });
            }
            // External links
            else if (href.startsWith('http')) {
                $link.attr('target', '_blank');
                $link.attr('rel', 'noopener noreferrer');
            }
        });
    }
    
    processCheckboxes() {
        this.$widget.find('.markdown-preview input[type="checkbox"]').each((i, el) => {
            const $checkbox = $(el);
            const $li = $checkbox.closest('li');
            
            $li.addClass('task-list-item');
            
            $checkbox.on('change', () => {
                const isChecked = $checkbox.is(':checked');
                this.updateTaskInEditor(i, isChecked);
            });
        });
    }
    
    updateTaskInEditor(index: number, checked: boolean) {
        const content = this.editor.getValue();
        const lines = content.split('\n');
        
        let taskCount = 0;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].match(/^\s*[-*+]\s+\[[ x]\]/)) {
                if (taskCount === index) {
                    lines[i] = lines[i].replace(
                        /\[[ x]\]/,
                        checked ? '[x]' : '[ ]'
                    );
                    break;
                }
                taskCount++;
            }
        }
        
        this.editor.setValue(lines.join('\n'));
    }
    
    updateStatistics(content: string) {
        const words = content.match(/\b\w+\b/g)?.length || 0;
        const chars = content.length;
        const lines = content.split('\n').length;
        
        this.$widget.find('[data-stat="words"]').text(words);
        this.$widget.find('[data-stat="chars"]').text(chars);
        this.$widget.find('[data-stat="lines"]').text(lines);
    }
    
    handleAction(action: string) {
        switch (action) {
            case 'bold':
            case 'italic':
            case 'strikethrough':
            case 'h1':
            case 'h2':
            case 'h3':
            case 'ul':
            case 'ol':
            case 'task':
            case 'quote':
            case 'code':
            case 'codeblock':
            case 'link':
            case 'image':
            case 'table':
            case 'hr':
                this.insertFormatting(action);
                break;
                
            case 'export-html':
                this.exportAsHtml();
                break;
                
            case 'export-pdf':
                this.exportAsPdf();
                break;
        }
    }
    
    insertFormatting(type: string) {
        const cursor = this.editor.getCursor();
        const selection = this.editor.getSelection();
        
        const formats: Record<string, any> = {
            bold: { wrap: '**' },
            italic: { wrap: '*' },
            strikethrough: { wrap: '~~' },
            h1: { prefix: '# ' },
            h2: { prefix: '## ' },
            h3: { prefix: '### ' },
            ul: { prefix: '- ' },
            ol: { prefix: '1. ' },
            task: { prefix: '- [ ] ' },
            quote: { prefix: '> ' },
            code: { wrap: '`' },
            codeblock: { 
                before: '```\n',
                after: '\n```'
            },
            link: {
                template: '[${text}](${url})'
            },
            image: {
                template: '![${alt}](${url})'
            },
            table: {
                template: '| Header 1 | Header 2 |\n|----------|----------|\n| Cell 1   | Cell 2   |'
            },
            hr: {
                insert: '\n---\n'
            }
        };
        
        const format = formats[type];
        if (!format) return;
        
        if (format.wrap) {
            const wrapped = format.wrap + (selection || 'text') + format.wrap;
            this.editor.replaceSelection(wrapped);
        } else if (format.prefix) {
            this.editor.setCursor({ line: cursor.line, ch: 0 });
            this.editor.replaceRange(format.prefix, cursor);
        } else if (format.before && format.after) {
            const text = format.before + (selection || '') + format.after;
            this.editor.replaceSelection(text);
        } else if (format.template) {
            // Handle templates with placeholders
            if (type === 'link') {
                const url = prompt('Enter URL:') || '';
                const text = selection || 'link text';
                this.editor.replaceSelection(`[${text}](${url})`);
            } else if (type === 'image') {
                const url = prompt('Enter image URL:') || '';
                const alt = selection || 'alt text';
                this.editor.replaceSelection(`![${alt}](${url})`);
            } else {
                this.editor.replaceSelection(format.template);
            }
        } else if (format.insert) {
            this.editor.replaceSelection(format.insert);
        }
        
        this.editor.focus();
    }
    
    async doRefresh(note) {
        this.note = note;
        
        const content = await note.getContent();
        this.editor.setValue(content);
        
        this.renderPreview(content);
        this.updateStatistics(content);
    }
    
    async saveContent() {
        if (!this.note) return;
        
        const content = this.editor.getValue();
        
        try {
            await server.put(`notes/${this.note.noteId}/content`, {
                content: content
            });
        } catch (error) {
            console.error('Save error:', error);
            toastService.showError('Failed to save markdown content');
        }
    }
    
    async exportAsHtml() {
        const content = this.editor.getValue();
        const html = marked.parse(content);
        
        const fullHtml = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <title>${this.note.title}</title>
                <style>
                    /* Include comprehensive styles */
                    ${this.getExportStyles()}
                </style>
            </head>
            <body>
                <div class="markdown-body">
                    ${html}
                </div>
            </body>
            </html>
        `;
        
        const blob = new Blob([fullHtml], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${this.note.title}.html`;
        a.click();
        URL.revokeObjectURL(url);
        
        toastService.showMessage('Exported as HTML');
    }
    
    async exportAsPdf() {
        // This would require a backend service or library like jsPDF
        toastService.showMessage('PDF export not yet implemented');
    }
    
    getExportStyles() {
        return `
            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                line-height: 1.6;
                color: #333;
                max-width: 900px;
                margin: 0 auto;
                padding: 20px;
            }
            /* ... additional export styles ... */
        `;
    }
    
    cleanup() {
        if (this.editor) {
            this.editor.toTextArea();
        }
        this.$widget.off('click');
        this.spacedUpdate = null;
    }
}
```

## Advanced Features

### Custom Import/Export

```typescript
// apps/server/src/services/import_export/markdown_handler.ts

import fs from 'fs/promises';
import path from 'path';
import matter from 'gray-matter';

export class MarkdownImportExport {
    async importMarkdownFile(filePath: string, parentNoteId: string) {
        const content = await fs.readFile(filePath, 'utf8');
        
        // Parse frontmatter if present
        const { data: metadata, content: body } = matter(content);
        
        // Create note
        const note = await api.createNote(
            parentNoteId,
            metadata.title || path.basename(filePath, '.md'),
            body
        );
        
        // Set note type
        note.type = 'markdown';
        note.mime = 'text/markdown';
        
        // Add metadata as attributes
        if (metadata.tags) {
            for (const tag of metadata.tags) {
                await note.addLabel('tag', tag);
            }
        }
        
        if (metadata.date) {
            await note.addLabel('created', metadata.date);
        }
        
        await note.save();
        return note;
    }
    
    async exportMarkdownFile(noteId: string, targetDir: string) {
        const note = await api.getNote(noteId);
        const content = await note.getContent();
        
        // Build frontmatter
        const metadata: any = {
            title: note.title,
            date: note.dateCreated,
            modified: note.dateModified
        };
        
        // Add tags
        const tags = note.getLabels()
            .filter(l => l.name === 'tag')
            .map(l => l.value);
        
        if (tags.length > 0) {
            metadata.tags = tags;
        }
        
        // Create markdown with frontmatter
        const markdown = matter.stringify(content, metadata);
        
        // Write file
        const fileName = `${note.title.replace(/[^a-z0-9]/gi, '_')}.md`;
        const filePath = path.join(targetDir, fileName);
        
        await fs.writeFile(filePath, markdown, 'utf8');
        
        return filePath;
    }
}
```

### Custom Actions and Commands

```typescript
// Add custom actions for the note type
class MarkdownActions {
    static registerActions() {
        // Register command palette actions
        api.addCommand({
            name: 'markdown:togglePreview',
            label: 'Markdown: Toggle Preview',
            action: async () => {
                const widget = api.getActiveWidget();
                if (widget instanceof MarkdownPreviewWidget) {
                    widget.togglePreview();
                }
            }
        });
        
        // Register context menu items
        api.addContextMenuItem({
            noteType: 'markdown',
            label: 'Convert to HTML',
            action: async (note) => {
                await this.convertToHtml(note);
            }
        });
    }
    
    static async convertToHtml(note) {
        const content = await note.getContent();
        const html = marked.parse(content);
        
        // Create new HTML note
        const htmlNote = await api.createNote(
            note.getParentNoteIds()[0],
            `${note.title} (HTML)`,
            html
        );
        
        htmlNote.type = 'text';
        htmlNote.mime = 'text/html';
        await htmlNote.save();
        
        toastService.showMessage('Converted to HTML note');
    }
}
```

## Testing Your Note Type

```typescript
// apps/client/test/widgets/markdown_preview.test.ts

import MarkdownPreviewWidget from '../../src/widgets/type_widgets/markdown_preview';

describe('MarkdownPreviewWidget', () => {
    let widget: MarkdownPreviewWidget;
    let mockNote: any;
    
    beforeEach(() => {
        widget = new MarkdownPreviewWidget();
        mockNote = {
            noteId: 'test123',
            title: 'Test Note',
            type: 'markdown',
            getContent: jest.fn().mockResolvedValue('# Test\n\nContent'),
            setContent: jest.fn()
        };
    });
    
    test('renders markdown correctly', async () => {
        widget.doRender();
        await widget.doRefresh(mockNote);
        
        const preview = widget.$widget.find('.markdown-preview').html();
        expect(preview).toContain('<h1>Test</h1>');
        expect(preview).toContain('<p>Content</p>');
    });
    
    test('handles formatting shortcuts', () => {
        widget.doRender();
        widget.initializeEditor();
        
        // Test bold formatting
        widget.editor.setValue('test');
        widget.editor.setSelection(
            { line: 0, ch: 0 },
            { line: 0, ch: 4 }
        );
        widget.insertFormatting('bold');
        
        expect(widget.editor.getValue()).toBe('**test**');
    });
    
    test('saves content on change', async () => {
        jest.useFakeTimers();
        
        widget.doRender();
        await widget.doRefresh(mockNote);
        
        // Change content
        widget.editor.setValue('New content');
        
        // Wait for debounce
        jest.advanceTimersByTime(1100);
        
        expect(server.put).toHaveBeenCalledWith(
            'notes/test123/content',
            { content: 'New content' }
        );
    });
});
```

## Best Practices

1.  **Performance**
    
    *   Debounce saves and preview updates
    *   Use virtual scrolling for large documents
    *   Cache rendered content when possible
2.  **User Experience**
    
    *   Provide keyboard shortcuts
    *   Show visual feedback for actions
    *   Maintain cursor position on refresh
3.  **Data Integrity**
    
    *   Validate content before saving
    *   Handle conflicts gracefully
    *   Provide undo/redo functionality
4.  **Extensibility**
    
    *   Use configuration options
    *   Support plugins/extensions
    *   Provide hooks for customization
5.  **Testing**
    
    *   Test rendering edge cases
    *   Verify import/export functionality
    *   Test keyboard shortcuts and actions

## Troubleshooting

### Widget Not Loading

*   Check type registration
*   Verify MIME type matches
*   Check console for errors

### Content Not Saving

*   Verify backend handler
*   Check network requests
*   Review error logs

### Preview Not Updating

*   Check markdown parser
*   Verify event bindings
*   Debug render function

### Performance Issues

*   Profile rendering
*   Optimize DOM updates
*   Implement virtual scrolling

## Next Steps

*   Review the Theme Development Guide
*   Explore existing note type implementations
*   Join the community to share your custom types