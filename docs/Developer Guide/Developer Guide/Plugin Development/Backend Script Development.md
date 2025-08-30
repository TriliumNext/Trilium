# Backend Script Development
## Backend Script Development Guide

This guide covers developing backend scripts in Trilium Notes. Backend scripts run in the Node.js context on the server, providing access to the database, file system, and external services.

## Prerequisites

*   JavaScript/Node.js knowledge
*   Understanding of async/await patterns
*   Familiarity with Trilium's database structure
*   Basic knowledge of SQL (optional but helpful)

## Getting Started

### Creating a Backend Script

1.  Create a new code note with type "JS Backend"
2.  Add appropriate execution labels:
    *   `#run=backendStartup` - Run once on startup
    *   `#run=hourly` - Run every hour
    *   `#run=daily` - Run daily
    *   `#run=never` - Manual execution only

```javascript
// Basic backend script
const note = await api.createNote(
    'root',
    'Generated Note',
    `Created at ${new Date().toISOString()}`
);

api.log(`Created note ${note.noteId}`);
```

### Execution Context

Backend scripts have access to:

*   Full Node.js API
*   Trilium's Backend API (`api` object)
*   Database access via SQL
*   File system operations
*   Network requests
*   System processes

## Backend API Reference

### Core API Methods

```javascript
// Logging
api.log('Information message');
api.logWarning('Warning message');
api.logError('Error message');

// Get application info
const appInfo = api.getAppInfo();
console.log(`Trilium ${appInfo.appVersion}`);

// Get instance name
const instanceName = api.getInstanceName();

// Get current date note
const todayNote = await api.getTodayNote();
const dateNote = await api.getDateNote('2024-01-15');

// Get week note
const weekNote = await api.getWeekNote('2024-01-15');

// Get month note
const monthNote = await api.getMonthNote('2024-01');

// Get year note  
const yearNote = await api.getYearNote('2024');
```

### Note Operations

#### Creating Notes

```javascript
// Simple note creation
const note = await api.createNote(
    parentNoteId,
    title,
    content
);

// Create note with parameters
const note = await api.createNewNote({
    parentNoteId: 'root',
    title: 'Advanced Note',
    content: 'Content here',
    type: 'text',
    mime: 'text/html',
    isProtected: false
});

// Create data note
const dataNote = await api.createDataNote(
    parentNoteId,
    'config.json',
    { 
        settings: {},
        version: 1
    }
);

// Create text note with attributes
const note = await api.createTextNote(
    parentNoteId,
    'Task',
    'Task description',
    {
        attributes: [
            { type: 'label', name: 'status', value: 'pending' },
            { type: 'label', name: 'priority', value: 'high' },
            { type: 'relation', name: 'assignedTo', value: userId }
        ]
    }
);
```

#### Reading Notes

```javascript
// Get note by ID
const note = await api.getNote(noteId);

// Get note with content
const noteWithContent = await api.getNoteWithContent(noteId);

// Get root note
const root = await api.getRootNote();

// Get notes by label
const tasksNote = await api.getNoteWithLabel('tasks');
const pendingTasks = await api.getNotesWithLabel('status', 'pending');

// Search notes
const results = await api.searchForNotes('type:text @label=important');

// Get note content
const content = await note.getContent();
const jsonContent = await note.getJsonContent();
```

#### Modifying Notes

```javascript
// Update note properties
note.title = 'New Title';
note.type = 'code';
note.mime = 'application/javascript';
await note.save();

// Set content
await note.setContent('New content');
await note.setJsonContent({ data: 'value' });

// Add attributes
await note.addLabel('status', 'completed');
await note.addRelation('relatedTo', targetNoteId);

// Remove attributes
await note.removeLabel('draft');
await note.removeRelation('obsolete');

// Toggle label
await note.toggleLabel('archived');
await note.toggleLabel('priority', 'low');

// Set label (add or update)
await note.setLabel('version', '2.0');

// Set relation
await note.setRelation('parent', parentNoteId);
```

### Database Operations

#### SQL Queries

```javascript
// Execute query
const rows = api.sql.getRows(`
    SELECT noteId, title, type 
    FROM notes 
    WHERE isDeleted = 0 
    AND type = ?
`, ['text']);

// Get single row
const note = api.sql.getRow(`
    SELECT * FROM notes WHERE noteId = ?
`, [noteId]);

// Get single value
const count = api.sql.getValue(`
    SELECT COUNT(*) FROM notes WHERE type = ?
`, ['text']);

// Execute statement (INSERT, UPDATE, DELETE)
api.sql.execute(`
    UPDATE notes 
    SET dateModified = ? 
    WHERE noteId = ?
`, [new Date().toISOString(), noteId]);

// Transaction
api.sql.transactional(() => {
    api.sql.execute('INSERT INTO ...', params1);
    api.sql.execute('UPDATE ...', params2);
    // All or nothing - rollback on error
});
```

#### Entity Access

```javascript
// Access Becca entities directly
const becca = api.getBecca();

// Get all notes
const allNotes = Object.values(becca.notes);

// Get all attributes
const allAttributes = Object.values(becca.attributes);

// Get branches (hierarchy)
const branches = Object.values(becca.branches);

// Find entities
const note = becca.getNote(noteId);
const attribute = becca.getAttribute(attributeId);
const branch = becca.getBranch(branchId);
```

### Date and Time

```javascript
// Using dayjs
const dayjs = api.dayjs;

// Current date/time
const now = dayjs();
const formatted = now.format('YYYY-MM-DD HH:mm:ss');

// Date arithmetic
const tomorrow = dayjs().add(1, 'day');
const lastWeek = dayjs().subtract(1, 'week');
const endOfMonth = dayjs().endOf('month');

// Parse dates
const date = dayjs('2024-01-15');
const parsed = dayjs('01/15/2024', 'MM/DD/YYYY');

// Compare dates
const isPast = dayjs('2024-01-01').isBefore(dayjs());
const isFuture = dayjs('2025-01-01').isAfter(dayjs());
const isSame = dayjs('2024-01-15').isSame('2024-01-15', 'day');
```

### HTTP Requests

```javascript
// Using fetch (recommended)
const response = await fetch('https://api.example.com/data', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer token'
    },
    body: JSON.stringify({ key: 'value' })
});

const data = await response.json();

// Using axios (deprecated but available)
const axios = api.axios;
const response = await axios.get('https://api.example.com/data');
const data = response.data;
```

### File System Operations

```javascript
const fs = require('fs').promises;
const path = require('path');

// Read file
const content = await fs.readFile('/path/to/file.txt', 'utf8');

// Write file
await fs.writeFile('/path/to/output.txt', 'Content here');

// Check if file exists
const exists = await fs.access('/path/to/file')
    .then(() => true)
    .catch(() => false);

// Read directory
const files = await fs.readdir('/path/to/directory');

// Get file stats
const stats = await fs.stat('/path/to/file');
const fileSize = stats.size;
const isDirectory = stats.isDirectory();
```

## Complete Example: Note Backup Automation

Here's a comprehensive example that automatically backs up important notes:

```javascript
/**
 * Automatic Note Backup System
 * Backs up notes with specific labels to JSON files
 * Run daily with #run=daily
 */

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

class BackupManager {
    constructor() {
        this.backupDir = this.getBackupDirectory();
        this.config = {
            maxBackups: 30,
            backupLabels: ['important', 'backup', 'critical'],
            excludeLabels: ['draft', 'temporary'],
            includeAttachments: true,
            compress: true
        };
    }
    
    async run() {
        try {
            api.log('Starting backup process...');
            
            // Ensure backup directory exists
            await this.ensureBackupDirectory();
            
            // Get notes to backup
            const notes = await this.getNotesToBackup();
            api.log(`Found ${notes.length} notes to backup`);
            
            // Create backup
            const backupPath = await this.createBackup(notes);
            api.log(`Backup created: ${backupPath}`);
            
            // Clean old backups
            await this.cleanOldBackups();
            
            // Send notification
            await this.sendNotification('success', notes.length);
            
            api.log('Backup process completed successfully');
            
        } catch (error) {
            api.logError(`Backup failed: ${error.message}`);
            await this.sendNotification('error', 0, error.message);
        }
    }
    
    getBackupDirectory() {
        // Use data directory for backups
        const dataDir = process.env.TRILIUM_DATA_DIR || './data';
        return path.join(dataDir, 'backups');
    }
    
    async ensureBackupDirectory() {
        try {
            await fs.access(this.backupDir);
        } catch {
            await fs.mkdir(this.backupDir, { recursive: true });
        }
    }
    
    async getNotesToBackup() {
        const notes = [];
        
        // Get notes with backup labels
        for (const label of this.config.backupLabels) {
            const labeledNotes = await api.getNotesWithLabel(label);
            notes.push(...labeledNotes);
        }
        
        // Filter out excluded notes
        const filtered = notes.filter(note => {
            const labels = note.getLabels();
            return !labels.some(l => 
                this.config.excludeLabels.includes(l.name)
            );
        });
        
        // Remove duplicates
        const uniqueNotes = Array.from(
            new Map(filtered.map(n => [n.noteId, n])).values()
        );
        
        return uniqueNotes;
    }
    
    async createBackup(notes) {
        const timestamp = api.dayjs().format('YYYY-MM-DD_HHmmss');
        const backupName = `backup_${timestamp}.json`;
        const backupPath = path.join(this.backupDir, backupName);
        
        const backupData = {
            version: '1.0',
            timestamp: new Date().toISOString(),
            instanceName: api.getInstanceName(),
            appVersion: api.getAppInfo().appVersion,
            noteCount: notes.length,
            notes: []
        };
        
        for (const note of notes) {
            const noteData = await this.exportNote(note);
            backupData.notes.push(noteData);
        }
        
        // Write backup file
        const json = JSON.stringify(backupData, null, 2);
        
        if (this.config.compress) {
            const zlib = require('zlib');
            const compressed = await new Promise((resolve, reject) => {
                zlib.gzip(json, (error, result) => {
                    if (error) reject(error);
                    else resolve(result);
                });
            });
            await fs.writeFile(backupPath + '.gz', compressed);
            return backupPath + '.gz';
        } else {
            await fs.writeFile(backupPath, json);
            return backupPath;
        }
    }
    
    async exportNote(note) {
        const content = await note.getContent();
        const attributes = note.getAttributes();
        const children = await note.getChildNotes();
        
        const noteData = {
            noteId: note.noteId,
            title: note.title,
            type: note.type,
            mime: note.mime,
            isProtected: note.isProtected,
            dateCreated: note.dateCreated,
            dateModified: note.dateModified,
            content: content,
            contentHash: this.hashContent(content),
            attributes: attributes.map(attr => ({
                type: attr.type,
                name: attr.name,
                value: attr.value,
                position: attr.position
            })),
            childrenIds: children.map(c => c.noteId),
            parentIds: note.getParentNotes().map(p => p.noteId)
        };
        
        // Include attachments if configured
        if (this.config.includeAttachments && note.type === 'file') {
            const attachments = await note.getAttachments();
            noteData.attachments = [];
            
            for (const attachment of attachments) {
                const blob = await attachment.getBlob();
                noteData.attachments.push({
                    attachmentId: attachment.attachmentId,
                    title: attachment.title,
                    role: attachment.role,
                    mime: attachment.mime,
                    content: blob.content.toString('base64')
                });
            }
        }
        
        return noteData;
    }
    
    hashContent(content) {
        return crypto.createHash('sha256')
            .update(content)
            .digest('hex');
    }
    
    async cleanOldBackups() {
        const files = await fs.readdir(this.backupDir);
        const backupFiles = files
            .filter(f => f.startsWith('backup_'))
            .sort()
            .reverse();
        
        if (backupFiles.length > this.config.maxBackups) {
            const toDelete = backupFiles.slice(this.config.maxBackups);
            
            for (const file of toDelete) {
                const filePath = path.join(this.backupDir, file);
                await fs.unlink(filePath);
                api.log(`Deleted old backup: ${file}`);
            }
        }
    }
    
    async sendNotification(status, noteCount, error = null) {
        // Create or update status note
        let statusNote = await api.getNoteWithLabel('backupStatus');
        
        if (!statusNote) {
            statusNote = await api.createNote(
                'root',
                'Backup Status',
                ''
            );
            await statusNote.addLabel('backupStatus', 'true');
            await statusNote.addLabel('hideFromTree', 'true');
        }
        
        const statusHtml = `
            <h2>Backup Status</h2>
            <table>
                <tr>
                    <td><strong>Last Run:</strong></td>
                    <td>${new Date().toISOString()}</td>
                </tr>
                <tr>
                    <td><strong>Status:</strong></td>
                    <td>${status === 'success' ? '✅ Success' : '❌ Failed'}</td>
                </tr>
                <tr>
                    <td><strong>Notes Backed Up:</strong></td>
                    <td>${noteCount}</td>
                </tr>
                ${error ? `
                <tr>
                    <td><strong>Error:</strong></td>
                    <td>${error}</td>
                </tr>
                ` : ''}
                <tr>
                    <td><strong>Backup Directory:</strong></td>
                    <td><code>${this.backupDir}</code></td>
                </tr>
            </table>
            
            <h3>Recent Backups</h3>
            <ul>
                ${await this.getRecentBackupsList()}
            </ul>
        `;
        
        await statusNote.setContent(statusHtml);
    }
    
    async getRecentBackupsList() {
        const files = await fs.readdir(this.backupDir);
        const backupFiles = files
            .filter(f => f.startsWith('backup_'))
            .sort()
            .reverse()
            .slice(0, 10);
        
        const items = [];
        for (const file of backupFiles) {
            const filePath = path.join(this.backupDir, file);
            const stats = await fs.stat(filePath);
            const size = (stats.size / 1024).toFixed(2);
            items.push(`<li>${file} (${size} KB)</li>`);
        }
        
        return items.join('\n');
    }
    
    // Restore functionality
    async restore(backupFile) {
        api.log(`Starting restore from ${backupFile}`);
        
        const backupPath = path.join(this.backupDir, backupFile);
        let content;
        
        if (backupFile.endsWith('.gz')) {
            const zlib = require('zlib');
            const compressed = await fs.readFile(backupPath);
            content = await new Promise((resolve, reject) => {
                zlib.gunzip(compressed, (error, result) => {
                    if (error) reject(error);
                    else resolve(result.toString());
                });
            });
        } else {
            content = await fs.readFile(backupPath, 'utf8');
        }
        
        const backupData = JSON.parse(content);
        
        // Create restore folder
        const restoreNote = await api.createNote(
            'root',
            `Restore ${backupData.timestamp}`,
            `<p>Restored ${backupData.noteCount} notes from backup</p>`
        );
        
        // Restore notes
        const noteIdMap = new Map();
        
        for (const noteData of backupData.notes) {
            const restoredNote = await this.restoreNote(
                noteData,
                restoreNote.noteId,
                noteIdMap
            );
        }
        
        api.log(`Restore completed: ${backupData.noteCount} notes`);
        return restoreNote;
    }
    
    async restoreNote(noteData, parentId, noteIdMap) {
        // Create note
        const note = await api.createNewNote({
            parentNoteId: parentId,
            title: noteData.title,
            content: noteData.content,
            type: noteData.type,
            mime: noteData.mime,
            isProtected: noteData.isProtected
        });
        
        // Map old ID to new ID
        noteIdMap.set(noteData.noteId, note.noteId);
        
        // Restore attributes
        for (const attr of noteData.attributes) {
            if (attr.type === 'label') {
                await note.addLabel(attr.name, attr.value);
            } else if (attr.type === 'relation') {
                // Will be restored in second pass
            }
        }
        
        // Restore attachments
        if (noteData.attachments) {
            for (const attachmentData of noteData.attachments) {
                const content = Buffer.from(
                    attachmentData.content,
                    'base64'
                );
                await note.addAttachment({
                    title: attachmentData.title,
                    role: attachmentData.role,
                    mime: attachmentData.mime,
                    content: content
                });
            }
        }
        
        return note;
    }
}

// Run backup
const backup = new BackupManager();
await backup.run();

// Optional: Add manual trigger
api.createNote(
    'root',
    'Run Backup',
    `
    <button onclick="api.runAsyncOnBackendWithManualTransactionHandling(async () => {
        const backup = new BackupManager();
        await backup.run();
    })">Run Backup Now</button>
    `
);
```

## Advanced Techniques

### Scheduled Tasks

```javascript
// Schedule task for specific time
class TaskScheduler {
    constructor() {
        this.tasks = [];
    }
    
    scheduleDaily(hour, minute, taskFunc) {
        const task = {
            type: 'daily',
            hour,
            minute,
            func: taskFunc,
            lastRun: null
        };
        
        this.tasks.push(task);
        this.startScheduler();
    }
    
    scheduleHourly(minute, taskFunc) {
        const task = {
            type: 'hourly',
            minute,
            func: taskFunc,
            lastRun: null
        };
        
        this.tasks.push(task);
        this.startScheduler();
    }
    
    startScheduler() {
        setInterval(() => {
            this.checkTasks();
        }, 60000); // Check every minute
    }
    
    checkTasks() {
        const now = api.dayjs();
        
        for (const task of this.tasks) {
            if (this.shouldRun(task, now)) {
                this.runTask(task);
                task.lastRun = now;
            }
        }
    }
    
    shouldRun(task, now) {
        if (task.type === 'daily') {
            return now.hour() === task.hour && 
                   now.minute() === task.minute &&
                   (!task.lastRun || !now.isSame(task.lastRun, 'day'));
        } else if (task.type === 'hourly') {
            return now.minute() === task.minute &&
                   (!task.lastRun || !now.isSame(task.lastRun, 'hour'));
        }
        return false;
    }
    
    async runTask(task) {
        try {
            await task.func();
        } catch (error) {
            api.logError(`Task failed: ${error.message}`);
        }
    }
}

const scheduler = new TaskScheduler();

// Schedule daily report at 9:00 AM
scheduler.scheduleDaily(9, 0, async () => {
    await generateDailyReport();
});

// Schedule hourly sync at :30
scheduler.scheduleHourly(30, async () => {
    await syncWithExternalService();
});
```

### Working with External Services

```javascript
// Integrate with external API
class ExternalServiceClient {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.baseUrl = 'https://api.example.com';
    }
    
    async request(endpoint, method = 'GET', data = null) {
        const url = `${this.baseUrl}${endpoint}`;
        
        const options = {
            method,
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json'
            }
        };
        
        if (data) {
            options.body = JSON.stringify(data);
        }
        
        try {
            const response = await fetch(url, options);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            return await response.json();
            
        } catch (error) {
            api.logError(`External API error: ${error.message}`);
            throw error;
        }
    }
    
    async syncNotes() {
        // Get notes to sync
        const notes = await api.getNotesWithLabel('sync');
        
        for (const note of notes) {
            const content = await note.getContent();
            
            // Send to external service
            const result = await this.request('/notes', 'POST', {
                id: note.noteId,
                title: note.title,
                content: content,
                tags: note.getLabels().map(l => l.value)
            });
            
            // Update sync status
            await note.setLabel('syncId', result.id);
            await note.setLabel('lastSync', new Date().toISOString());
        }
        
        api.log(`Synced ${notes.length} notes`);
    }
}

// Use the client
const apiKey = await api.getOption('externalApiKey');
const client = new ExternalServiceClient(apiKey);
await client.syncNotes();
```

### Database Transactions

```javascript
// Complex database operation with transaction
async function reorganizeNotes() {
    await api.sql.transactional(async () => {
        // Get all notes to reorganize
        const notes = api.sql.getRows(`
            SELECT noteId, title, dateCreated 
            FROM notes 
            WHERE type = ? 
            AND isDeleted = 0
        `, ['text']);
        
        // Create year/month structure
        for (const noteRow of notes) {
            const date = api.dayjs(noteRow.dateCreated);
            const year = date.year();
            const month = date.format('MM');
            
            // Get or create year note
            let yearNote = await api.getYearNote(year.toString());
            if (!yearNote) {
                yearNote = await api.createNote(
                    'root',
                    year.toString(),
                    ''
                );
            }
            
            // Get or create month note
            let monthNote = await api.getMonthNote(`${year}-${month}`);
            if (!monthNote) {
                monthNote = await api.createNote(
                    yearNote.noteId,
                    date.format('MMMM'),
                    ''
                );
            }
            
            // Move note to month
            const note = await api.getNote(noteRow.noteId);
            await api.sql.execute(`
                UPDATE branches 
                SET parentNoteId = ? 
                WHERE noteId = ?
            `, [monthNote.noteId, note.noteId]);
        }
        
        api.log(`Reorganized ${notes.length} notes`);
    });
}
```

### Event Processing

```javascript
// Process entity change events
class EventProcessor {
    constructor() {
        this.handlers = new Map();
        this.registerHandlers();
    }
    
    registerHandlers() {
        // Handle note creation
        this.handlers.set('create_note', async (entity) => {
            api.log(`Note created: ${entity.title}`);
            
            // Auto-tag based on content
            const content = await entity.getContent();
            if (content.includes('TODO')) {
                await entity.addLabel('todo', 'true');
            }
            if (content.includes('IMPORTANT')) {
                await entity.addLabel('priority', 'high');
            }
        });
        
        // Handle attribute changes
        this.handlers.set('update_attribute', async (entity) => {
            if (entity.name === 'status' && entity.value === 'completed') {
                const note = await api.getNote(entity.noteId);
                await note.addLabel('completedDate', new Date().toISOString());
            }
        });
    }
    
    async processEvent(event) {
        const handler = this.handlers.get(event.type);
        if (handler) {
            await handler(event.entity);
        }
    }
}

const processor = new EventProcessor();

// Process events (usually triggered by note changes)
api.onNoteChange(async (note) => {
    await processor.processEvent({
        type: 'update_note',
        entity: note
    });
});
```

## Performance Optimization

### Batch Operations

```javascript
// Batch process notes for better performance
async function batchProcess(notes, batchSize = 100) {
    const results = [];
    
    for (let i = 0; i < notes.length; i += batchSize) {
        const batch = notes.slice(i, i + batchSize);
        
        // Process batch in parallel
        const batchResults = await Promise.all(
            batch.map(note => processNote(note))
        );
        
        results.push(...batchResults);
        
        // Log progress
        const progress = Math.min(i + batchSize, notes.length);
        api.log(`Processed ${progress}/${notes.length} notes`);
    }
    
    return results;
}

async function processNote(note) {
    // Process individual note
    const content = await note.getContent();
    // ... processing logic
    return result;
}
```

### Caching

```javascript
// Implement caching for expensive operations
class Cache {
    constructor(ttl = 3600000) { // 1 hour default
        this.cache = new Map();
        this.ttl = ttl;
    }
    
    set(key, value) {
        this.cache.set(key, {
            value,
            expires: Date.now() + this.ttl
        });
    }
    
    get(key) {
        const item = this.cache.get(key);
        
        if (!item) return null;
        
        if (Date.now() > item.expires) {
            this.cache.delete(key);
            return null;
        }
        
        return item.value;
    }
    
    clear() {
        this.cache.clear();
    }
}

const cache = new Cache();

async function getProcessedContent(noteId) {
    let result = cache.get(noteId);
    
    if (!result) {
        const note = await api.getNote(noteId);
        result = await expensiveProcessing(note);
        cache.set(noteId, result);
    }
    
    return result;
}
```

### Resource Management

```javascript
// Manage resources properly
class ResourceManager {
    constructor() {
        this.resources = [];
    }
    
    async acquireConnection() {
        // Get database connection
        const conn = await api.sql.getConnection();
        this.resources.push(conn);
        return conn;
    }
    
    async cleanup() {
        // Clean up all resources
        for (const resource of this.resources) {
            try {
                if (resource.close) {
                    await resource.close();
                }
            } catch (error) {
                api.logError(`Failed to close resource: ${error.message}`);
            }
        }
        
        this.resources = [];
    }
}

const manager = new ResourceManager();

try {
    // Use resources
    const conn = await manager.acquireConnection();
    // ... do work
} finally {
    // Always cleanup
    await manager.cleanup();
}
```

## Error Handling and Logging

```javascript
// Comprehensive error handling
class ErrorHandler {
    async handle(error, context) {
        // Log error
        api.logError(`Error in ${context}: ${error.message}`);
        api.logError(`Stack: ${error.stack}`);
        
        // Create error note
        const errorNote = await this.getOrCreateErrorLog();
        await this.logErrorToNote(errorNote, error, context);
        
        // Send notification if critical
        if (this.isCritical(error)) {
            await this.sendNotification(error, context);
        }
    }
    
    async getOrCreateErrorLog() {
        let errorLog = await api.getNoteWithLabel('errorLog');
        
        if (!errorLog) {
            errorLog = await api.createNote(
                'root',
                'Script Error Log',
                '<h1>Script Errors</h1>'
            );
            await errorLog.addLabel('errorLog', 'true');
            await errorLog.addLabel('hideFromTree', 'true');
        }
        
        return errorLog;
    }
    
    async logErrorToNote(note, error, context) {
        const content = await note.getContent();
        const errorEntry = `
            <div class="error-entry">
                <h3>${new Date().toISOString()}</h3>
                <p><strong>Context:</strong> ${context}</p>
                <p><strong>Error:</strong> ${error.message}</p>
                <pre>${error.stack}</pre>
            </div>
            <hr>
        `;
        
        await note.setContent(errorEntry + content);
    }
    
    isCritical(error) {
        return error.message.includes('CRITICAL') ||
               error.code === 'ECONNREFUSED' ||
               error.code === 'EACCES';
    }
    
    async sendNotification(error, context) {
        // Create notification note
        const notification = await api.createNote(
            'root',
            `CRITICAL ERROR: ${context}`,
            `<p style="color: red;">A critical error occurred:</p>
             <pre>${error.message}</pre>`
        );
        
        await notification.addLabel('notification', 'error');
        await notification.addLabel('priority', 'high');
    }
}

const errorHandler = new ErrorHandler();

// Usage in scripts
try {
    await riskyOperation();
} catch (error) {
    await errorHandler.handle(error, 'riskyOperation');
}
```

## Security Considerations

```javascript
// Secure handling of sensitive data
class SecureStorage {
    async storeSecret(key, value) {
        // Encrypt before storing
        const encrypted = await this.encrypt(value);
        
        // Store in protected note
        let secretNote = await api.getNoteWithLabel('secrets');
        if (!secretNote) {
            secretNote = await api.createNote(
                'root',
                'Secrets',
                '{}'
            );
            await secretNote.addLabel('secrets', 'true');
            await secretNote.addLabel('hideFromTree', 'true');
            await secretNote.setProtected(true);
        }
        
        const secrets = await secretNote.getJsonContent();
        secrets[key] = encrypted;
        await secretNote.setJsonContent(secrets);
    }
    
    async getSecret(key) {
        const secretNote = await api.getNoteWithLabel('secrets');
        if (!secretNote) return null;
        
        const secrets = await secretNote.getJsonContent();
        const encrypted = secrets[key];
        if (!encrypted) return null;
        
        return await this.decrypt(encrypted);
    }
    
    async encrypt(text) {
        const crypto = require('crypto');
        const algorithm = 'aes-256-gcm';
        const key = await this.getKey();
        const iv = crypto.randomBytes(16);
        
        const cipher = crypto.createCipheriv(algorithm, key, iv);
        
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        
        const authTag = cipher.getAuthTag();
        
        return {
            encrypted,
            authTag: authTag.toString('hex'),
            iv: iv.toString('hex')
        };
    }
    
    async decrypt(data) {
        const crypto = require('crypto');
        const algorithm = 'aes-256-gcm';
        const key = await this.getKey();
        
        const decipher = crypto.createDecipheriv(
            algorithm,
            key,
            Buffer.from(data.iv, 'hex')
        );
        
        decipher.setAuthTag(Buffer.from(data.authTag, 'hex'));
        
        let decrypted = decipher.update(data.encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        
        return decrypted;
    }
    
    async getKey() {
        // Derive key from instance ID or use environment variable
        const crypto = require('crypto');
        const instanceId = api.getInstanceName();
        return crypto.scryptSync(instanceId, 'salt', 32);
    }
}

const storage = new SecureStorage();

// Store API key securely
await storage.storeSecret('apiKey', 'secret-key-123');

// Retrieve API key
const apiKey = await storage.getSecret('apiKey');
```

## Testing Backend Scripts

```javascript
// Test framework for backend scripts
class TestSuite {
    constructor(name) {
        this.name = name;
        this.tests = [];
        this.results = [];
    }
    
    test(description, testFunc) {
        this.tests.push({ description, testFunc });
    }
    
    async run() {
        api.log(`Running test suite: ${this.name}`);
        
        for (const test of this.tests) {
            try {
                await test.testFunc();
                this.results.push({
                    description: test.description,
                    status: 'PASS'
                });
                api.log(`✓ ${test.description}`);
            } catch (error) {
                this.results.push({
                    description: test.description,
                    status: 'FAIL',
                    error: error.message
                });
                api.logError(`✗ ${test.description}: ${error.message}`);
            }
        }
        
        await this.generateReport();
    }
    
    async generateReport() {
        const passed = this.results.filter(r => r.status === 'PASS').length;
        const failed = this.results.filter(r => r.status === 'FAIL').length;
        
        const report = `
            <h1>Test Report: ${this.name}</h1>
            <p>Run at: ${new Date().toISOString()}</p>
            <p>Results: ${passed} passed, ${failed} failed</p>
            
            <h2>Test Results</h2>
            <table>
                <tr>
                    <th>Test</th>
                    <th>Status</th>
                    <th>Error</th>
                </tr>
                ${this.results.map(r => `
                    <tr>
                        <td>${r.description}</td>
                        <td style="color: ${r.status === 'PASS' ? 'green' : 'red'}">
                            ${r.status}
                        </td>
                        <td>${r.error || ''}</td>
                    </tr>
                `).join('')}
            </table>
        `;
        
        const reportNote = await api.createNote(
            'root',
            `Test Report ${this.name}`,
            report
        );
        
        await reportNote.addLabel('testReport', 'true');
    }
}

// Write tests
const suite = new TestSuite('Backend API Tests');

suite.test('Create and retrieve note', async () => {
    const note = await api.createNote('root', 'Test Note', 'Content');
    const retrieved = await api.getNote(note.noteId);
    
    if (retrieved.title !== 'Test Note') {
        throw new Error('Title mismatch');
    }
});

suite.test('Add and get label', async () => {
    const note = await api.createNote('root', 'Label Test', '');
    await note.addLabel('testLabel', 'testValue');
    
    const value = note.getLabelValue('testLabel');
    if (value !== 'testValue') {
        throw new Error('Label value mismatch');
    }
});

suite.test('SQL query', async () => {
    const count = api.sql.getValue('SELECT COUNT(*) FROM notes');
    if (typeof count !== 'number') {
        throw new Error('Count is not a number');
    }
});

// Run tests
await suite.run();
```

## Best Practices

1.  **Error Handling**
    
    *   Always wrap async operations in try-catch
    *   Log errors appropriately
    *   Provide fallback behavior
2.  **Performance**
    
    *   Use batch operations for multiple items
    *   Implement caching for expensive operations
    *   Clean up resources properly
3.  **Security**
    
    *   Never hardcode sensitive data
    *   Use protected notes for secrets
    *   Validate and sanitize input
4.  **Maintainability**
    
    *   Use classes for complex logic
    *   Add logging for debugging
    *   Write tests for critical functions
5.  **Database Operations**
    
    *   Use transactions for related changes
    *   Parameterize SQL queries
    *   Handle database errors gracefully

## Troubleshooting

### Script Not Executing

*   Check the `#run` label value
*   Verify script has no syntax errors
*   Check logs for error messages

### Database Errors

*   Ensure SQL syntax is correct
*   Check table and column names
*   Verify data types match

### Memory Issues

*   Implement pagination for large datasets
*   Clear caches periodically
*   Use streaming for large files

### External API Issues

*   Check network connectivity
*   Verify API credentials
*   Implement retry logic

## Next Steps

*   Review the Custom Note Type Development guide
*   Explore existing backend scripts in the community
*   Learn about Theme Development