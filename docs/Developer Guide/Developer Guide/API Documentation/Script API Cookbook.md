# Script API Cookbook
## Table of Contents

1.  [Introduction](#introduction)
2.  [Backend Script Recipes](#backend-script-recipes)
3.  [Frontend Script Recipes](#frontend-script-recipes)
4.  [Common Patterns](#common-patterns)
5.  [Note Manipulation](#note-manipulation)
6.  [Attribute Operations](#attribute-operations)
7.  [Search and Filtering](#search-and-filtering)
8.  [Automation Examples](#automation-examples)
9.  [Integration with External Services](#integration-with-external-services)
10.  [Custom Widgets](#custom-widgets)
11.  [Event Handling](#event-handling)
12.  [Best Practices](#best-practices)

## Introduction

Trilium's Script API provides powerful automation capabilities through JavaScript code that runs either on the backend (Node.js) or frontend (browser). This cookbook contains practical recipes and patterns for common scripting tasks.

### Script Types

| Type | Environment | Access | Use Cases |
| --- | --- | --- | --- |
| **Backend Script** | Node.js | Full database, file system, network | Automation, data processing, integrations |
| **Frontend Script** | Browser | UI manipulation, user interaction | Custom widgets, UI enhancements |
| **Custom Widget** | Browser | Widget lifecycle, note context | Interactive components, visualizations |

### Basic Script Structure

**Backend Script:**

```javascript
// Access to api object is automatic
const note = await api.getNoteWithLabel('todoList');
const children = await note.getChildNotes();

// Return value becomes script output
return {
    noteTitle: note.title,
    childCount: children.length
};
```

**Frontend Script:**

```javascript
// Access to api object is automatic
api.showMessage('Script executed!');

// Manipulate UI
const $button = $('<button>').text('Click Me').click(() => {
    api.showMessage('Button clicked!');
});

$('body').append($button);
```

## Backend Script Recipes

### 1\. Daily Note Generator

Create a daily note with template content:

```javascript
// #run=hourly

async function createDailyNote() {
    const today = api.dayjs().format('YYYY-MM-DD');
    const dayNote = await api.getDayNote(today);
    
    // Check if content already exists
    const content = await dayNote.getContent();
    if (content && content.length > 100) {
        return; // Already has content
    }
    
    // Get template
    const template = await api.getNoteWithLabel('dailyTemplate');
    if (!template) {
        await dayNote.setContent(`
            <h2>📅 ${api.dayjs().format('dddd, MMMM D, YYYY')}</h2>
            
            <h3>☀️ Morning Routine</h3>
            <ul>
                <li>[ ] Morning meditation</li>
                <li>[ ] Exercise</li>
                <li>[ ] Review daily goals</li>
            </ul>
            
            <h3>📋 Today's Tasks</h3>
            <ul>
                <li></li>
            </ul>
            
            <h3>📝 Notes</h3>
            <p></p>
            
            <h3>🌙 Evening Reflection</h3>
            <p></p>
        `);
    } else {
        const templateContent = await template.getContent();
        await dayNote.setContent(templateContent);
    }
    
    // Add metadata
    await dayNote.setLabel('type', 'daily');
    await dayNote.setLabel('created', api.dayjs().format());
    
    api.log(`Daily note created for ${today}`);
}

await createDailyNote();
```

### 2\. Note Statistics Collector

Collect and display statistics about your notes:

```javascript
async function collectStatistics() {
    const stats = {
        totalNotes: 0,
        notesByType: {},
        notesByMonth: {},
        largestNotes: [],
        recentlyModified: [],
        tagCloud: {}
    };
    
    // Get all notes
    const notes = await api.searchForNotes('');
    stats.totalNotes = notes.length;
    
    for (const note of notes) {
        // Count by type
        stats.notesByType[note.type] = (stats.notesByType[note.type] || 0) + 1;
        
        // Count by creation month
        const month = api.dayjs(note.utcDateCreated).format('YYYY-MM');
        stats.notesByMonth[month] = (stats.notesByMonth[month] || 0) + 1;
        
        // Track largest notes
        const content = await note.getContent();
        if (content) {
            stats.largestNotes.push({
                noteId: note.noteId,
                title: note.title,
                size: content.length
            });
        }
        
        // Collect labels for tag cloud
        const labels = await note.getLabels();
        for (const label of labels) {
            if (!label.name.startsWith('child:')) {
                stats.tagCloud[label.name] = (stats.tagCloud[label.name] || 0) + 1;
            }
        }
    }
    
    // Sort largest notes
    stats.largestNotes.sort((a, b) => b.size - a.size);
    stats.largestNotes = stats.largestNotes.slice(0, 10);
    
    // Get recently modified
    const recentNotes = await api.searchForNotes('orderBy:dateModified limit:10');
    stats.recentlyModified = recentNotes.map(n => ({
        noteId: n.noteId,
        title: n.title,
        modified: n.utcDateModified
    }));
    
    // Create or update statistics note
    let statsNote = await api.getNoteWithLabel('statistics');
    if (!statsNote) {
        statsNote = await api.createTextNote('root', 'Statistics', '');
        await statsNote.setLabel('statistics');
    }
    
    // Generate report
    const report = `
        <h1>📊 Note Statistics</h1>
        <p>Generated: ${api.dayjs().format('YYYY-MM-DD HH:mm:ss')}</p>
        
        <h2>Overview</h2>
        <ul>
            <li>Total Notes: <strong>${stats.totalNotes}</strong></li>
            <li>Note Types: ${Object.entries(stats.notesByType)
                .map(([type, count]) => `${type} (${count})`)
                .join(', ')}</li>
        </ul>
        
        <h2>Largest Notes</h2>
        <ol>
            ${stats.largestNotes.map(n => 
                `<li><a href="#root/${n.noteId}">${n.title}</a> - ${(n.size / 1024).toFixed(1)} KB</li>`
            ).join('')}
        </ol>
        
        <h2>Recently Modified</h2>
        <ul>
            ${stats.recentlyModified.map(n => 
                `<li><a href="#root/${n.noteId}">${n.title}</a> - ${api.dayjs(n.modified).fromNow()}</li>`
            ).join('')}
        </ul>
        
        <h2>Top Tags</h2>
        <div class="tag-cloud">
            ${Object.entries(stats.tagCloud)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 20)
                .map(([tag, count]) => 
                    `<span style="font-size: ${Math.min(200, 100 + count * 5)}%">#${tag} (${count})</span>`
                ).join(' ')}
        </div>
    `;
    
    await statsNote.setContent(report);
    
    return stats;
}

return await collectStatistics();
```

### 3\. Backup Automation

Automated backup with rotation:

```javascript
// #run=daily

const fs = require('fs');
const path = require('path');

async function performBackup() {
    const backupDir = '/backups/trilium';
    const maxBackups = 7; // Keep last 7 backups
    
    // Ensure backup directory exists
    if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
    }
    
    // Create backup
    const timestamp = api.dayjs().format('YYYY-MM-DD_HHmmss');
    const backupName = `backup_${timestamp}`;
    
    await api.backupDatabase(backupName);
    api.log(`Backup created: ${backupName}`);
    
    // Rotate old backups
    const files = fs.readdirSync(api.getDataDir())
        .filter(f => f.startsWith('backup-') && f.endsWith('.db'))
        .map(f => ({
            name: f,
            path: path.join(api.getDataDir(), f),
            time: fs.statSync(path.join(api.getDataDir(), f)).mtime
        }))
        .sort((a, b) => b.time - a.time);
    
    // Move latest backup to backup directory
    if (files.length > 0) {
        const latestBackup = files[0];
        const targetPath = path.join(backupDir, latestBackup.name);
        fs.renameSync(latestBackup.path, targetPath);
        api.log(`Backup moved to: ${targetPath}`);
    }
    
    // Clean up old backups in backup directory
    const backupFiles = fs.readdirSync(backupDir)
        .filter(f => f.startsWith('backup-') && f.endsWith('.db'))
        .map(f => ({
            name: f,
            path: path.join(backupDir, f),
            time: fs.statSync(path.join(backupDir, f)).mtime
        }))
        .sort((a, b) => b.time - a.time);
    
    if (backupFiles.length > maxBackups) {
        for (let i = maxBackups; i < backupFiles.length; i++) {
            fs.unlinkSync(backupFiles[i].path);
            api.log(`Deleted old backup: ${backupFiles[i].name}`);
        }
    }
    
    // Create backup log note
    let logNote = await api.getNoteWithLabel('backupLog');
    if (!logNote) {
        logNote = await api.createTextNote('root', 'Backup Log', '');
        await logNote.setLabel('backupLog');
    }
    
    const currentLog = await logNote.getContent();
    const newEntry = `<p>${api.dayjs().format('YYYY-MM-DD HH:mm:ss')} - Backup completed: ${backupName}</p>\n`;
    await logNote.setContent(newEntry + currentLog);
    
    return {
        success: true,
        backupName: backupName,
        totalBackups: Math.min(backupFiles.length, maxBackups)
    };
}

return await performBackup();
```

### 4\. Task Aggregator

Collect all tasks from different notes:

```javascript
async function aggregateTasks() {
    // Find all notes with todos
    const todoNotes = await api.searchForNotes('#todo OR #task OR content:"[ ]" OR content:"[x]"');
    
    const tasks = {
        pending: [],
        completed: [],
        overdue: []
    };
    
    for (const note of todoNotes) {
        const content = await note.getContent();
        if (!content) continue;
        
        // Parse checkbox tasks
        const checkboxRegex = /\[([ x])\]\s*(.+?)(?=\n|\<|$)/gi;
        let match;
        
        while ((match = checkboxRegex.exec(content)) !== null) {
            const isCompleted = match[1] === 'x';
            const taskText = match[2].replace(/<[^>]*>/g, ''); // Strip HTML
            
            const task = {
                noteId: note.noteId,
                noteTitle: note.title,
                text: taskText,
                completed: isCompleted
            };
            
            // Check for due date
            const dueDateLabel = await note.getLabel('dueDate');
            if (dueDateLabel) {
                task.dueDate = dueDateLabel.value;
                const dueDate = api.dayjs(dueDateLabel.value);
                if (!isCompleted && dueDate.isBefore(api.dayjs())) {
                    tasks.overdue.push(task);
                    continue;
                }
            }
            
            if (isCompleted) {
                tasks.completed.push(task);
            } else {
                tasks.pending.push(task);
            }
        }
    }
    
    // Create or update task dashboard
    let dashboard = await api.getNoteWithLabel('taskDashboard');
    if (!dashboard) {
        dashboard = await api.createTextNote('root', '📋 Task Dashboard', '');
        await dashboard.setLabel('taskDashboard');
    }
    
    const dashboardContent = `
        <h1>📋 Task Dashboard</h1>
        <p>Last updated: ${api.dayjs().format('YYYY-MM-DD HH:mm:ss')}</p>
        
        <h2>⚠️ Overdue (${tasks.overdue.length})</h2>
        <ul>
            ${tasks.overdue.map(t => 
                `<li style="color: red;">
                    <strong>${t.text}</strong> 
                    (Due: ${api.dayjs(t.dueDate).format('MMM D')}) 
                    - <a href="#root/${t.noteId}">${t.noteTitle}</a>
                </li>`
            ).join('')}
        </ul>
        
        <h2>📌 Pending (${tasks.pending.length})</h2>
        <ul>
            ${tasks.pending.slice(0, 20).map(t => 
                `<li>
                    ${t.text} 
                    ${t.dueDate ? `(Due: ${api.dayjs(t.dueDate).format('MMM D')})` : ''} 
                    - <a href="#root/${t.noteId}">${t.noteTitle}</a>
                </li>`
            ).join('')}
        </ul>
        ${tasks.pending.length > 20 ? `<p><em>...and ${tasks.pending.length - 20} more</em></p>` : ''}
        
        <h2>✅ Recently Completed (${tasks.completed.length})</h2>
        <ul>
            ${tasks.completed.slice(0, 10).map(t => 
                `<li style="text-decoration: line-through; opacity: 0.7;">
                    ${t.text} - <a href="#root/${t.noteId}">${t.noteTitle}</a>
                </li>`
            ).join('')}
        </ul>
    `;
    
    await dashboard.setContent(dashboardContent);
    
    return tasks;
}

return await aggregateTasks();
```

### 5\. Content Validator

Validate and fix common issues in notes:

```javascript
async function validateContent() {
    const issues = [];
    const fixes = [];
    
    const notes = await api.searchForNotes('type:text');
    
    for (const note of notes) {
        const content = await note.getContent();
        if (!content) continue;
        
        let newContent = content;
        let hasIssues = false;
        
        // Check for broken internal links
        const linkRegex = /<a[^>]*href="#root\/([^"]+)"[^>]*>/g;
        let linkMatch;
        
        while ((linkMatch = linkRegex.exec(content)) !== null) {
            const linkedNoteId = linkMatch[1];
            const linkedNote = await api.getNote(linkedNoteId);
            
            if (!linkedNote) {
                issues.push({
                    noteId: note.noteId,
                    noteTitle: note.title,
                    issue: `Broken link to note: ${linkedNoteId}`
                });
                hasIssues = true;
            }
        }
        
        // Check for missing images
        const imgRegex = /<img[^>]*src="api/images/UJHeJYbU9B0N/[^"]*\/([^"]+)"[^>]*>/g;
        let imgMatch;
        
        while ((imgMatch = imgRegex.exec(content)) !== null) {
            const imageId = imgMatch[1];
            const imageNote = await api.getNote(imageId);
            
            if (!imageNote) {
                issues.push({
                    noteId: note.noteId,
                    noteTitle: note.title,
                    issue: `Missing image: ${imageId}`
                });
                hasIssues = true;
            }
        }
        
        // Fix common formatting issues
        // Fix double spaces
        if (newContent.includes('  ')) {
            newContent = newContent.replace(/  +/g, ' ');
            fixes.push({
                noteId: note.noteId,
                noteTitle: note.title,
                fix: 'Removed double spaces'
            });
        }
        
        // Fix empty paragraphs
        if (newContent.includes('<p></p>')) {
            newContent = newContent.replace(/<p><\/p>/g, '');
            fixes.push({
                noteId: note.noteId,
                noteTitle: note.title,
                fix: 'Removed empty paragraphs'
            });
        }
        
        // Fix unclosed tags
        const openTags = (newContent.match(/<[^/>]+>/g) || []).map(tag => tag.replace(/<|>/g, ''));
        const closeTags = (newContent.match(/<\/[^>]+>/g) || []).map(tag => tag.replace(/<\/|>/g, ''));
        
        const unclosed = openTags.filter(tag => !closeTags.includes(tag) && !['br', 'hr', 'img', 'input'].includes(tag));
        if (unclosed.length > 0) {
            issues.push({
                noteId: note.noteId,
                noteTitle: note.title,
                issue: `Unclosed HTML tags: ${unclosed.join(', ')}`
            });
        }
        
        // Apply fixes if content changed
        if (newContent !== content) {
            await note.setContent(newContent);
        }
    }
    
    // Create validation report
    let reportNote = await api.getNoteWithLabel('validationReport');
    if (!reportNote) {
        reportNote = await api.createTextNote('root', 'Content Validation Report', '');
        await reportNote.setLabel('validationReport');
    }
    
    const report = `
        <h1>🔍 Content Validation Report</h1>
        <p>Validated: ${api.dayjs().format('YYYY-MM-DD HH:mm:ss')}</p>
        <p>Total notes checked: ${notes.length}</p>
        
        <h2>❌ Issues Found (${issues.length})</h2>
        <ul>
            ${issues.map(i => 
                `<li><a href="#root/${i.noteId}">${i.noteTitle}</a>: ${i.issue}</li>`
            ).join('')}
        </ul>
        
        <h2>✅ Automatic Fixes Applied (${fixes.length})</h2>
        <ul>
            ${fixes.map(f => 
                `<li><a href="#root/${f.noteId}">${f.noteTitle}</a>: ${f.fix}</li>`
            ).join('')}
        </ul>
    `;
    
    await reportNote.setContent(report);
    
    return { issues, fixes };
}

return await validateContent();
```

## Frontend Script Recipes

### 6\. Quick Note Creator

Add a floating button to quickly create notes:

```javascript
// Create floating button
const $button = $(`
    <div id="quick-note-btn" style="
        position: fixed;
        bottom: 20px;
        right: 20px;
        width: 60px;
        height: 60px;
        background: #4CAF50;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        z-index: 10000;
        color: white;
        font-size: 30px;
    ">+</div>
`);

// Create modal
const $modal = $(`
    <div id="quick-note-modal" style="
        display: none;
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: white;
        padding: 20px;
        border-radius: 10px;
        box-shadow: 0 10px 25px rgba(0,0,0,0.2);
        z-index: 10001;
        min-width: 400px;
    ">
        <h3>Quick Note</h3>
        <input type="text" id="quick-note-title" placeholder="Title..." style="
            width: 100%;
            padding: 10px;
            margin: 10px 0;
            border: 1px solid #ddd;
            border-radius: 5px;
        ">
        <textarea id="quick-note-content" placeholder="Content..." style="
            width: 100%;
            height: 200px;
            padding: 10px;
            margin: 10px 0;
            border: 1px solid #ddd;
            border-radius: 5px;
            resize: vertical;
        "></textarea>
        <div>
            <select id="quick-note-type" style="
                padding: 8px;
                margin-right: 10px;
                border: 1px solid #ddd;
                border-radius: 5px;
            ">
                <option value="text">Text</option>
                <option value="code">Code</option>
                <option value="task">Task</option>
            </select>
            <button id="quick-note-save" style="
                padding: 10px 20px;
                background: #4CAF50;
                color: white;
                border: none;
                border-radius: 5px;
                cursor: pointer;
            ">Save</button>
            <button id="quick-note-cancel" style="
                padding: 10px 20px;
                background: #f44336;
                color: white;
                border: none;
                border-radius: 5px;
                cursor: pointer;
                margin-left: 10px;
            ">Cancel</button>
        </div>
    </div>
`);

// Create overlay
const $overlay = $(`
    <div id="quick-note-overlay" style="
        display: none;
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.5);
        z-index: 10000;
    "></div>
`);

// Add to page
$('body').append($button, $overlay, $modal);

// Handle button click
$button.click(() => {
    $overlay.show();
    $modal.show();
    $('#quick-note-title').focus();
});

// Handle save
$('#quick-note-save').click(async () => {
    const title = $('#quick-note-title').val() || 'Quick Note';
    const content = $('#quick-note-content').val() || '';
    const type = $('#quick-note-type').val();
    
    let finalContent = content;
    
    // Format based on type
    if (type === 'task') {
        finalContent = `
            <h2>📋 ${title}</h2>
            <ul>
                <li>[ ] ${content}</li>
            </ul>
        `;
    } else if (type === 'code') {
        finalContent = `// ${title}\n${content}`;
    } else {
        finalContent = `<h2>${title}</h2><p>${content}</p>`;
    }
    
    // Get current note or use inbox
    const currentNote = api.getActiveContextNote();
    const parentNoteId = currentNote ? currentNote.noteId : (await api.getDayNote()).noteId;
    
    // Create note
    const { note } = await api.runOnBackend(async (parentId, noteTitle, noteContent, noteType) => {
        const parent = await api.getNote(parentId);
        const newNote = await api.createNote(parent, noteTitle, noteContent, noteType === 'code' ? 'code' : 'text');
        
        if (noteType === 'task') {
            await newNote.setLabel('task');
            await newNote.setLabel('created', api.dayjs().format());
        }
        
        return { note: newNote.getPojo() };
    }, [parentNoteId, title, finalContent, type]);
    
    api.showMessage(`Note "${title}" created!`);
    
    // Clear and close
    $('#quick-note-title').val('');
    $('#quick-note-content').val('');
    $overlay.hide();
    $modal.hide();
    
    // Navigate to new note
    await api.activateNewNote(note.noteId);
});

// Handle cancel
$('#quick-note-cancel, #quick-note-overlay').click(() => {
    $overlay.hide();
    $modal.hide();
});

// Keyboard shortcuts
$(document).keydown((e) => {
    // Ctrl+Shift+N to open quick note
    if (e.ctrlKey && e.shiftKey && e.key === 'N') {
        e.preventDefault();
        $button.click();
    }
    
    // Escape to close
    if (e.key === 'Escape' && $modal.is(':visible')) {
        $overlay.hide();
        $modal.hide();
    }
});
```

### 7\. Note Graph Visualizer

Create an interactive graph of note relationships:

```javascript
// Load D3.js
await api.requireLibrary('d3');

// Create container
const $container = $(`
    <div id="note-graph" style="
        width: 100%;
        height: 600px;
        border: 1px solid #ddd;
        border-radius: 5px;
        background: #f9f9f9;
    "></div>
`);

// Add to current note
const $noteDetail = $(`.note-detail-code`);
$noteDetail.empty().append($container);

// Get note data
const graphData = await api.runOnBackend(async () => {
    const currentNote = api.getActiveContextNote();
    const maxDepth = 3;
    const nodes = [];
    const links = [];
    const visited = new Set();
    
    async function traverse(note, depth = 0) {
        if (!note || depth > maxDepth || visited.has(note.noteId)) {
            return;
        }
        
        visited.add(note.noteId);
        
        nodes.push({
            id: note.noteId,
            title: note.title,
            type: note.type,
            depth: depth
        });
        
        // Get children
        const children = await note.getChildNotes();
        for (const child of children) {
            links.push({
                source: note.noteId,
                target: child.noteId,
                type: 'child'
            });
            await traverse(child, depth + 1);
        }
        
        // Get relations
        const relations = await note.getRelations();
        for (const relation of relations) {
            const targetNote = await relation.getTargetNote();
            if (targetNote) {
                links.push({
                    source: note.noteId,
                    target: targetNote.noteId,
                    type: 'relation',
                    name: relation.name
                });
                
                if (!visited.has(targetNote.noteId)) {
                    nodes.push({
                        id: targetNote.noteId,
                        title: targetNote.title,
                        type: targetNote.type,
                        depth: depth + 1
                    });
                    visited.add(targetNote.noteId);
                }
            }
        }
    }
    
    await traverse(currentNote);
    
    return { nodes, links };
});

// Create D3 visualization
const width = $container.width();
const height = $container.height();

const svg = d3.select('#note-graph')
    .append('svg')
    .attr('width', width)
    .attr('height', height);

// Create force simulation
const simulation = d3.forceSimulation(graphData.nodes)
    .force('link', d3.forceLink(graphData.links).id(d => d.id).distance(100))
    .force('charge', d3.forceManyBody().strength(-300))
    .force('center', d3.forceCenter(width / 2, height / 2));

// Create links
const link = svg.append('g')
    .selectAll('line')
    .data(graphData.links)
    .enter().append('line')
    .style('stroke', d => d.type === 'child' ? '#999' : '#f00')
    .style('stroke-opacity', 0.6)
    .style('stroke-width', d => d.type === 'child' ? 2 : 1);

// Create nodes
const node = svg.append('g')
    .selectAll('circle')
    .data(graphData.nodes)
    .enter().append('circle')
    .attr('r', d => 10 - d.depth * 2)
    .style('fill', d => {
        const colors = {
            text: '#4CAF50',
            code: '#2196F3',
            file: '#FF9800',
            image: '#9C27B0'
        };
        return colors[d.type] || '#666';
    })
    .call(d3.drag()
        .on('start', dragstarted)
        .on('drag', dragged)
        .on('end', dragended));

// Add labels
const label = svg.append('g')
    .selectAll('text')
    .data(graphData.nodes)
    .enter().append('text')
    .text(d => d.title)
    .style('font-size', '12px')
    .style('fill', '#333');

// Add tooltips
node.append('title')
    .text(d => d.title);

// Update positions on tick
simulation.on('tick', () => {
    link
        .attr('x1', d => d.source.x)
        .attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x)
        .attr('y2', d => d.target.y);
    
    node
        .attr('cx', d => d.x)
        .attr('cy', d => d.y);
    
    label
        .attr('x', d => d.x + 12)
        .attr('y', d => d.y + 4);
});

// Drag functions
function dragstarted(event, d) {
    if (!event.active) simulation.alphaTarget(0.3).restart();
    d.fx = d.x;
    d.fy = d.y;
}

function dragged(event, d) {
    d.fx = event.x;
    d.fy = event.y;
}

function dragended(event, d) {
    if (!event.active) simulation.alphaTarget(0);
    d.fx = null;
    d.fy = null;
}

// Handle node clicks
node.on('click', async (event, d) => {
    await api.activateNote(d.id);
});
```

### 8\. Markdown Preview Toggle

Add live markdown preview for notes:

```javascript
// Create preview pane
const $previewPane = $(`
    <div id="markdown-preview" style="
        display: none;
        position: absolute;
        top: 50px;
        right: 10px;
        width: 45%;
        height: calc(100% - 60px);
        background: white;
        border: 1px solid #ddd;
        border-radius: 5px;
        padding: 20px;
        overflow-y: auto;
        box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        z-index: 100;
    ">
        <div id="preview-content"></div>
    </div>
`);

// Create toggle button
const $toggleBtn = $(`
    <button id="preview-toggle" style="
        position: absolute;
        top: 10px;
        right: 10px;
        padding: 8px 15px;
        background: #2196F3;
        color: white;
        border: none;
        border-radius: 5px;
        cursor: pointer;
        z-index: 101;
    ">
        <i class="bx bx-show"></i> Preview
    </button>
`);

// Add to note detail
$('.note-detail-text').css('position', 'relative').append($previewPane, $toggleBtn);

let previewVisible = false;
let updateTimeout;

// Load markdown library
await api.requireLibrary('markdown-it');
const md = window.markdownit({
    html: true,
    linkify: true,
    typographer: true,
    breaks: true
});

// Toggle preview
$toggleBtn.click(() => {
    previewVisible = !previewVisible;
    
    if (previewVisible) {
        $previewPane.show();
        $('.note-detail-text .note-detail-editable').css('width', '50%');
        $toggleBtn.html('<i class="bx bx-hide"></i> Hide');
        updatePreview();
    } else {
        $previewPane.hide();
        $('.note-detail-text .note-detail-editable').css('width', '100%');
        $toggleBtn.html('<i class="bx bx-show"></i> Preview');
    }
});

// Update preview function
async function updatePreview() {
    if (!previewVisible) return;
    
    const content = await api.getActiveContextTextEditor().getContent();
    
    // Convert HTML to markdown first (simplified)
    let markdown = content
        .replace(/<h1[^>]*>(.*?)<\/h1>/g, '# $1\n')
        .replace(/<h2[^>]*>(.*?)<\/h2>/g, '## $1\n')
        .replace(/<h3[^>]*>(.*?)<\/h3>/g, '### $1\n')
        .replace(/<p[^>]*>(.*?)<\/p>/g, '$1\n\n')
        .replace(/<strong[^>]*>(.*?)<\/strong>/g, '**$1**')
        .replace(/<b[^>]*>(.*?)<\/b>/g, '**$1**')
        .replace(/<em[^>]*>(.*?)<\/em>/g, '*$1*')
        .replace(/<i[^>]*>(.*?)<\/i>/g, '*$1*')
        .replace(/<code[^>]*>(.*?)<\/code>/g, '`$1`')
        .replace(/<ul[^>]*>/g, '')
        .replace(/<\/ul>/g, '\n')
        .replace(/<li[^>]*>(.*?)<\/li>/g, '- $1\n')
        .replace(/<ol[^>]*>/g, '')
        .replace(/<\/ol>/g, '\n')
        .replace(/<li[^>]*>(.*?)<\/li>/g, '1. $1\n')
        .replace(/<a href="#root/Z7VzyCVBZwf1"]*)"[^>]*>(.*?)<\/a>/g, '[$2]($1)')
        .replace(/<img[^>]*src="api/images/Z7VzyCVBZwf1/([^"]*)"[^>]*alt="([^"]*)"[^>]*>/g, '![$2]($1)')
        .replace(/<br[^>]*>/g, '\n')
        .replace(/<[^>]+>/g, ''); // Remove remaining HTML tags
    
    // Render markdown
    const html = md.render(markdown);
    
    $('#preview-content').html(html);
    
    // Syntax highlight code blocks
    $('#preview-content pre code').each(function() {
        if (window.hljs) {
            window.hljs.highlightElement(this);
        }
    });
}

// Auto-update preview on content change
api.bindGlobalShortcut('mod+s', async () => {
    if (previewVisible) {
        clearTimeout(updateTimeout);
        updateTimeout = setTimeout(updatePreview, 500);
    }
});

// Update on note change
api.onActiveContextNoteChange(async () => {
    if (previewVisible) {
        updatePreview();
    }
});
```

## Common Patterns

### 9\. Template System

Create and apply templates to new notes:

```javascript
// Backend script to manage templates

async function createFromTemplate(templateName, targetParentId, customData = {}) {
    // Find template
    const template = await api.getNoteWithLabel(`template:${templateName}`);
    if (!template) {
        throw new Error(`Template "${templateName}" not found`);
    }
    
    // Get template content and metadata
    const content = await template.getContent();
    const attributes = await template.getAttributes();
    
    // Process template variables
    let processedContent = content;
    const variables = {
        DATE: api.dayjs().format('YYYY-MM-DD'),
        TIME: api.dayjs().format('HH:mm:ss'),
        DATETIME: api.dayjs().format('YYYY-MM-DD HH:mm:ss'),
        USER: api.getAppInfo().username || 'User',
        ...customData
    };
    
    for (const [key, value] of Object.entries(variables)) {
        const regex = new RegExp(`{{${key}}}`, 'g');
        processedContent = processedContent.replace(regex, value);
    }
    
    // Create new note
    const parentNote = await api.getNote(targetParentId);
    const title = customData.title || `${templateName} - ${variables.DATE}`;
    const newNote = await api.createNote(parentNote, title, processedContent);
    
    // Copy attributes (except template label)
    for (const attr of attributes) {
        if (!attr.name.startsWith('template:')) {
            if (attr.type === 'label') {
                await newNote.setLabel(attr.name, attr.value);
            } else if (attr.type === 'relation') {
                await newNote.setRelation(attr.name, attr.value);
            }
        }
    }
    
    return newNote;
}

// Example: Meeting notes template
const meetingTemplate = `
<h1>Meeting Notes - {{DATE}}</h1>

<table>
    <tr><th>Date:</th><td>{{DATE}}</td></tr>
    <tr><th>Time:</th><td>{{TIME}}</td></tr>
    <tr><th>Attendees:</th><td>{{ATTENDEES}}</td></tr>
    <tr><th>Subject:</th><td>{{SUBJECT}}</td></tr>
</table>

<h2>Agenda</h2>
<ul>
    <li>{{AGENDA_ITEM_1}}</li>
    <li>{{AGENDA_ITEM_2}}</li>
    <li>{{AGENDA_ITEM_3}}</li>
</ul>

<h2>Discussion</h2>
<p></p>

<h2>Action Items</h2>
<ul>
    <li>[ ] </li>
</ul>

<h2>Next Steps</h2>
<p></p>
`;

// Create template note if it doesn't exist
let templateNote = await api.getNoteWithLabel('template:meeting');
if (!templateNote) {
    templateNote = await api.createTextNote('root', 'Meeting Template', meetingTemplate);
    await templateNote.setLabel('template:meeting');
    await templateNote.setLabel('hideFromTree'); // Hide template from tree
}

// Use template
const meeting = await createFromTemplate('meeting', 'root', {
    title: 'Team Standup',
    ATTENDEES: 'John, Jane, Bob',
    SUBJECT: 'Weekly Status Update',
    AGENDA_ITEM_1: 'Review last week\'s tasks',
    AGENDA_ITEM_2: 'Current blockers',
    AGENDA_ITEM_3: 'Next week\'s priorities'
});

api.log(`Created meeting note: ${meeting.title}`);
```

### 10\. Hierarchical Tag System

Implement hierarchical tags with inheritance:

```javascript
class HierarchicalTags {
    constructor() {
        this.tagHierarchy = {};
    }
    
    async buildTagHierarchy() {
        // Find all tag definition notes
        const tagNotes = await api.searchForNotes('#tagDef');
        
        for (const note of tagNotes) {
            const tagName = await note.getLabel('tagName');
            const parentTag = await note.getLabel('parentTag');
            
            if (tagName) {
                this.tagHierarchy[tagName.value] = {
                    noteId: note.noteId,
                    parent: parentTag ? parentTag.value : null,
                    children: []
                };
            }
        }
        
        // Build children arrays
        for (const [tag, data] of Object.entries(this.tagHierarchy)) {
            if (data.parent && this.tagHierarchy[data.parent]) {
                this.tagHierarchy[data.parent].children.push(tag);
            }
        }
        
        return this.tagHierarchy;
    }
    
    async applyHierarchicalTag(noteId, tagName) {
        const note = await api.getNote(noteId);
        
        // Apply the tag
        await note.setLabel(tagName);
        
        // Apply all parent tags
        let currentTag = tagName;
        while (this.tagHierarchy[currentTag] && this.tagHierarchy[currentTag].parent) {
            const parentTag = this.tagHierarchy[currentTag].parent;
            await note.setLabel(parentTag);
            currentTag = parentTag;
        }
    }
    
    async getNotesWithTagHierarchy(tagName) {
        // Get all child tags
        const allTags = [tagName];
        const queue = [tagName];
        
        while (queue.length > 0) {
            const current = queue.shift();
            if (this.tagHierarchy[current]) {
                for (const child of this.tagHierarchy[current].children) {
                    allTags.push(child);
                    queue.push(child);
                }
            }
        }
        
        // Search for notes with any of these tags
        const searchQuery = allTags.map(t => `#${t}`).join(' OR ');
        return await api.searchForNotes(searchQuery);
    }
    
    async createTagReport() {
        await this.buildTagHierarchy();
        
        let report = '<h1>Tag Hierarchy Report</h1>\n';
        
        // Build tree visualization
        const renderTree = (tag, level = 0) => {
            const indent = '&nbsp;'.repeat(level * 4);
            let html = `${indent}• ${tag}`;
            
            const notes = api.searchForNotes(`#${tag}`);
            html += ` (${notes.length} notes)<br>\n`;
            
            if (this.tagHierarchy[tag] && this.tagHierarchy[tag].children.length > 0) {
                for (const child of this.tagHierarchy[tag].children) {
                    html += renderTree(child, level + 1);
                }
            }
            
            return html;
        };
        
        // Find root tags (no parent)
        const rootTags = Object.keys(this.tagHierarchy)
            .filter(tag => !this.tagHierarchy[tag].parent);
        
        for (const rootTag of rootTags) {
            report += renderTree(rootTag);
        }
        
        // Create or update report note
        let reportNote = await api.getNoteWithLabel('tagHierarchyReport');
        if (!reportNote) {
            reportNote = await api.createTextNote('root', 'Tag Hierarchy Report', '');
            await reportNote.setLabel('tagHierarchyReport');
        }
        
        await reportNote.setContent(report);
        
        return report;
    }
}

// Usage
const tagSystem = new HierarchicalTags();

// Define tag hierarchy
const createTagDefinition = async (tagName, parentTag = null) => {
    let tagDef = await api.getNoteWithLabel(`tagDef:${tagName}`);
    if (!tagDef) {
        tagDef = await api.createTextNote('root', `Tag: ${tagName}`, `Tag definition for ${tagName}`);
        await tagDef.setLabel('tagDef');
        await tagDef.setLabel(`tagDef:${tagName}`);
        await tagDef.setLabel('tagName', tagName);
        if (parentTag) {
            await tagDef.setLabel('parentTag', parentTag);
        }
    }
    return tagDef;
};

// Create tag hierarchy
await createTagDefinition('project');
await createTagDefinition('work', 'project');
await createTagDefinition('personal', 'project');
await createTagDefinition('development', 'work');
await createTagDefinition('documentation', 'work');

// Apply hierarchical tag
await tagSystem.buildTagHierarchy();
await tagSystem.applyHierarchicalTag('someNoteId', 'documentation');
// This will also apply 'work' and 'project' tags

// Get all notes in hierarchy
const projectNotes = await tagSystem.getNotesWithTagHierarchy('project');
// Returns notes tagged with 'project', 'work', 'personal', 'development', or 'documentation'

// Generate report
await tagSystem.createTagReport();
```

## Integration with External Services

### 11\. GitHub Integration

Sync GitHub issues with notes:

```javascript
// Requires axios library
const axios = require('axios');

class GitHubSync {
    constructor(token, repo) {
        this.token = token;
        this.repo = repo; // format: "owner/repo"
        this.apiBase = 'https://api.github.com';
    }
    
    async getIssues(state = 'open') {
        const response = await axios.get(`${this.apiBase}/repos/${this.repo}/issues`, {
            headers: {
                'Authorization': `token ${this.token}`,
                'Accept': 'application/vnd.github.v3+json'
            },
            params: { state }
        });
        
        return response.data;
    }
    
    async syncIssuesToNotes() {
        // Get or create GitHub folder
        let githubFolder = await api.getNoteWithLabel('githubSync');
        if (!githubFolder) {
            githubFolder = await api.createTextNote('root', 'GitHub Issues', '');
            await githubFolder.setLabel('githubSync');
        }
        
        const issues = await this.getIssues();
        const syncedNotes = [];
        
        for (const issue of issues) {
            // Check if issue note already exists
            let issueNote = await api.getNoteWithLabel(`github:issue:${issue.number}`);
            
            const content = `
                <h1>${issue.title}</h1>
                
                <table>
                    <tr><th>Issue #</th><td>${issue.number}</td></tr>
                    <tr><th>State</th><td>${issue.state}</td></tr>
                    <tr><th>Author</th><td>${issue.user.login}</td></tr>
                    <tr><th>Created</th><td>${api.dayjs(issue.created_at).format('YYYY-MM-DD HH:mm')}</td></tr>
                    <tr><th>Updated</th><td>${api.dayjs(issue.updated_at).format('YYYY-MM-DD HH:mm')}</td></tr>
                    <tr><th>Labels</th><td>${issue.labels.map(l => l.name).join(', ')}</td></tr>
                </table>
                
                <h2>Description</h2>
                <div style="background: #f5f5f5; padding: 10px; border-radius: 5px;">
                    ${issue.body || 'No description'}
                </div>
                
                <h2>Links</h2>
                <ul>
                    <li><a href="#root/BapEoNvlb1Hl">View on GitHub</a></li>
                    <li><a href="#root/IgmpadAfZP9V">API URL</a></li>
                </ul>
            `;
            
            if (!issueNote) {
                // Create new note
                issueNote = await api.createNote(
                    githubFolder,
                    `#${issue.number}: ${issue.title}`,
                    content
                );
                await issueNote.setLabel(`github:issue:${issue.number}`);
            } else {
                // Update existing note
                await issueNote.setContent(content);
            }
            
            // Set labels based on issue state and labels
            await issueNote.setLabel('githubIssue');
            await issueNote.setLabel('state', issue.state);
            
            for (const label of issue.labels) {
                await issueNote.setLabel(`gh:${label.name}`);
            }
            
            syncedNotes.push({
                noteId: issueNote.noteId,
                issueNumber: issue.number,
                title: issue.title
            });
        }
        
        api.log(`Synced ${syncedNotes.length} GitHub issues`);
        return syncedNotes;
    }
    
    async createIssueFromNote(noteId) {
        const note = await api.getNote(noteId);
        const content = await note.getContent();
        
        // Extract plain text from HTML
        const plainText = content.replace(/<[^>]*>/g, '');
        
        const response = await axios.post(
            `${this.apiBase}/repos/${this.repo}/issues`,
            {
                title: note.title,
                body: plainText,
                labels: ['from-trilium']
            },
            {
                headers: {
                    'Authorization': `token ${this.token}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            }
        );
        
        // Link note to issue
        await note.setLabel(`github:issue:${response.data.number}`);
        await note.setLabel('githubIssue');
        
        return response.data;
    }
}

// Usage
const github = new GitHubSync(
    process.env.GITHUB_TOKEN || 'your-token',
    'your-org/your-repo'
);

// Sync issues to notes
const synced = await github.syncIssuesToNotes();

// Create issue from current note
// const issue = await github.createIssueFromNote('currentNoteId');
```

### 12\. Email Integration

Send notes via email:

```javascript
const nodemailer = require('nodemailer');

class EmailIntegration {
    constructor(config) {
        this.transporter = nodemailer.createTransporter({
            host: config.host || 'smtp.gmail.com',
            port: config.port || 587,
            secure: false,
            auth: {
                user: config.user,
                pass: config.pass
            }
        });
    }
    
    async sendNoteAsEmail(noteId, to, options = {}) {
        const note = await api.getNote(noteId);
        const content = await note.getContent();
        
        // Get attachments
        const attachments = await note.getAttachments();
        const mailAttachments = [];
        
        for (const attachment of attachments) {
            const blob = await attachment.getBlob();
            mailAttachments.push({
                filename: attachment.title,
                content: blob.content,
                contentType: attachment.mime
            });
        }
        
        // Convert note content to email-friendly HTML
        const emailHtml = `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body { font-family: Arial, sans-serif; line-height: 1.6; }
                    h1 { color: #333; }
                    h2 { color: #666; }
                    code { background: #f4f4f4; padding: 2px 4px; }
                    pre { background: #f4f4f4; padding: 10px; overflow-x: auto; }
                </style>
            </head>
            <body>
                ${content}
                <hr>
                <p style="color: #999; font-size: 12px;">
                    Sent from Trilium Notes on ${api.dayjs().format('YYYY-MM-DD HH:mm:ss')}
                </p>
            </body>
            </html>
        `;
        
        const mailOptions = {
            from: options.from || this.transporter.options.auth.user,
            to: to,
            subject: options.subject || note.title,
            html: emailHtml,
            attachments: mailAttachments
        };
        
        const info = await this.transporter.sendMail(mailOptions);
        
        // Log email send
        await note.setLabel('emailSent', api.dayjs().format());
        await note.setLabel('emailRecipient', to);
        
        api.log(`Email sent: ${info.messageId}`);
        
        return info;
    }
    
    async createEmailCampaign(templateNoteId, recipientListNoteId) {
        const template = await api.getNote(templateNoteId);
        const recipientNote = await api.getNote(recipientListNoteId);
        const recipientContent = await recipientNote.getContent();
        
        // Parse recipient list (assume one email per line)
        const recipients = recipientContent
            .split('\n')
            .map(line => line.trim())
            .filter(line => line && line.includes('@'));
        
        const results = [];
        
        for (const recipient of recipients) {
            try {
                const result = await this.sendNoteAsEmail(
                    templateNoteId,
                    recipient,
                    {
                        subject: template.title
                    }
                );
                
                results.push({
                    recipient,
                    success: true,
                    messageId: result.messageId
                });
                
                // Add delay to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (error) {
                results.push({
                    recipient,
                    success: false,
                    error: error.message
                });
            }
        }
        
        // Create campaign report
        const reportNote = await api.createTextNote(
            'root',
            `Email Campaign Report - ${api.dayjs().format('YYYY-MM-DD')}`,
            `
                <h1>Email Campaign Report</h1>
                <p>Template: ${template.title}</p>
                <p>Sent: ${api.dayjs().format('YYYY-MM-DD HH:mm:ss')}</p>
                <p>Total Recipients: ${recipients.length}</p>
                <p>Successful: ${results.filter(r => r.success).length}</p>
                <p>Failed: ${results.filter(r => !r.success).length}</p>
                
                <h2>Results</h2>
                <table>
                    <tr><th>Recipient</th><th>Status</th><th>Details</th></tr>
                    ${results.map(r => `
                        <tr>
                            <td>${r.recipient}</td>
                            <td>${r.success ? '✅ Sent' : '❌ Failed'}</td>
                            <td>${r.success ? r.messageId : r.error}</td>
                        </tr>
                    `).join('')}
                </table>
            `
        );
        
        await reportNote.setLabel('emailCampaignReport');
        
        return results;
    }
}

// Usage
const email = new EmailIntegration({
    host: 'smtp.gmail.com',
    port: 587,
    user: 'your-email@gmail.com',
    pass: 'your-app-password'
});

// Send single note
// await email.sendNoteAsEmail('noteId', 'recipient@example.com');

// Send campaign
// await email.createEmailCampaign('templateNoteId', 'recipientListNoteId');
```

## Best Practices

### Error Handling

Always wrap scripts in try-catch blocks:

```javascript
async function safeScriptExecution() {
    try {
        // Your script code here
        const result = await riskyOperation();
        
        return {
            success: true,
            data: result
        };
    } catch (error) {
        api.log(`Error in script: ${error.message}`, 'error');
        
        // Create error report note
        const errorNote = await api.createTextNote(
            'root',
            `Script Error - ${api.dayjs().format('YYYY-MM-DD HH:mm:ss')}`,
            `
                <h1>Script Error</h1>
                <p><strong>Error:</strong> ${error.message}</p>
                <p><strong>Stack:</strong></p>
                <pre>${error.stack}</pre>
                <p><strong>Script:</strong> ${api.currentNote.title}</p>
            `
        );
        
        await errorNote.setLabel('scriptError');
        
        return {
            success: false,
            error: error.message
        };
    }
}

return await safeScriptExecution();
```

### Performance Optimization

Use batch operations and caching:

```javascript
class OptimizedNoteProcessor {
    constructor() {
        this.cache = new Map();
    }
    
    async processNotes(noteIds) {
        // Batch fetch notes
        const notes = await Promise.all(
            noteIds.map(id => this.getCachedNote(id))
        );
        
        // Process in chunks to avoid memory issues
        const chunkSize = 100;
        const results = [];
        
        for (let i = 0; i < notes.length; i += chunkSize) {
            const chunk = notes.slice(i, i + chunkSize);
            const chunkResults = await Promise.all(
                chunk.map(note => this.processNote(note))
            );
            results.push(...chunkResults);
            
            // Allow other operations
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        
        return results;
    }
    
    async getCachedNote(noteId) {
        if (!this.cache.has(noteId)) {
            const note = await api.getNote(noteId);
            this.cache.set(noteId, note);
        }
        return this.cache.get(noteId);
    }
    
    async processNote(note) {
        // Process individual note
        return {
            noteId: note.noteId,
            processed: true
        };
    }
}
```

### Script Organization

Organize complex scripts with modules:

```javascript
// Create a utility module note
const utilsNote = await api.createCodeNote('root', 'Script Utils', `
    module.exports = {
        formatDate: (date) => api.dayjs(date).format('YYYY-MM-DD'),
        
        sanitizeHtml: (html) => {
            return html
                .replace(/<script[^>]*>.*?<\/script>/gi, '')
                .replace(/on\w+="[^"]*"/gi, '');
        },
        
        async createBackup(name) {
            await api.backupDatabase(name);
            api.log(\`Backup created: \\${name}\`);
        }
    };
`, 'js');

await utilsNote.setLabel('scriptModule');
await utilsNote.setLabel('moduleName', 'utils');

// Use in another script
const utils = await api.requireModule('utils');
const formattedDate = utils.formatDate(new Date());
```

### Testing Scripts

Create test suites for your scripts:

```javascript
class ScriptTester {
    constructor(scriptName) {
        this.scriptName = scriptName;
        this.tests = [];
        this.results = [];
    }
    
    test(description, testFn) {
        this.tests.push({ description, testFn });
    }
    
    async run() {
        api.log(`Running tests for ${this.scriptName}`);
        
        for (const test of this.tests) {
            try {
                await test.testFn();
                this.results.push({
                    description: test.description,
                    passed: true
                });
                api.log(`✅ ${test.description}`);
            } catch (error) {
                this.results.push({
                    description: test.description,
                    passed: false,
                    error: error.message
                });
                api.log(`❌ ${test.description}: ${error.message}`);
            }
        }
        
        return this.generateReport();
    }
    
    generateReport() {
        const passed = this.results.filter(r => r.passed).length;
        const failed = this.results.filter(r => !r.passed).length;
        
        return {
            script: this.scriptName,
            total: this.results.length,
            passed,
            failed,
            results: this.results
        };
    }
    
    assert(condition, message) {
        if (!condition) {
            throw new Error(message || 'Assertion failed');
        }
    }
    
    assertEquals(actual, expected, message) {
        if (actual !== expected) {
            throw new Error(message || `Expected ${expected}, got ${actual}`);
        }
    }
}

// Example test suite
const tester = new ScriptTester('Note Utils');

tester.test('Create note', async () => {
    const note = await api.createTextNote('root', 'Test Note', 'Content');
    tester.assert(note !== null, 'Note should be created');
    tester.assertEquals(note.title, 'Test Note', 'Title should match');
    
    // Clean up
    await note.delete();
});

tester.test('Search notes', async () => {
    const results = await api.searchForNotes('test');
    tester.assert(Array.isArray(results), 'Results should be an array');
});

const report = await tester.run();
return report;
```

## Conclusion

The Script API provides powerful capabilities for automating and extending Trilium Notes. Key takeaways:

1.  **Use Backend Scripts** for data processing, automation, and integrations
2.  **Use Frontend Scripts** for UI enhancements and user interactions
3.  **Always handle errors** gracefully and provide meaningful feedback
4.  **Optimize performance** with caching and batch operations
5.  **Organize complex scripts** into modules for reusability
6.  **Test your scripts** to ensure reliability

For more information:

*   [Backend Script API Reference](https://triliumnext.github.io/Docs/api/Backend_Script_API.html)
*   [Frontend Script API Reference](https://triliumnext.github.io/Docs/api/Frontend_Script_API.html)
*   [Custom Widget Development](#root/CXtjbrjXfIlk)