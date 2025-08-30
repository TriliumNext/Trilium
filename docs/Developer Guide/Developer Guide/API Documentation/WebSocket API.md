# WebSocket API
## WebSocket API Documentation

## Table of Contents

1.  [Introduction](#introduction)
2.  [Connection Setup](#connection-setup)
3.  [Authentication](#authentication)
4.  [Message Format](#message-format)
5.  [Event Types](#event-types)
6.  [Real-time Synchronization](#real-time-synchronization)
7.  [Custom Event Broadcasting](#custom-event-broadcasting)
8.  [Client Implementation Examples](#client-implementation-examples)
9.  [Debugging WebSocket Connections](#debugging-websocket-connections)
10.  [Best Practices](#best-practices)
11.  [Error Handling](#error-handling)
12.  [Performance Optimization](#performance-optimization)

## Introduction

The Trilium WebSocket API provides real-time bidirectional communication between the server and clients. It's primarily used for:

*   **Real-time synchronization** of note changes across multiple clients
*   **Live collaboration** features
*   **Push notifications** for events
*   **Streaming updates** for long-running operations
*   **Frontend script execution** from backend

### Key Features

*   Automatic reconnection with exponential backoff
*   Message queuing during disconnection
*   Event-based architecture
*   Support for custom event types
*   Built-in heartbeat/ping mechanism

### WebSocket URL

```
ws://localhost:8080   // Local development
wss://your-server.com  // Production with SSL
```

## Connection Setup

### Basic Connection

```javascript
// JavaScript - Basic WebSocket connection
const ws = new WebSocket('ws://localhost:8080');

ws.onopen = (event) => {
    console.log('Connected to Trilium WebSocket');
};

ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    console.log('Received:', message);
};

ws.onerror = (error) => {
    console.error('WebSocket error:', error);
};

ws.onclose = (event) => {
    console.log('Disconnected from WebSocket');
};
```

### Advanced Connection Manager

```javascript
class TriliumWebSocketManager {
    constructor(url, options = {}) {
        this.url = url;
        this.options = {
            reconnectInterval: 5000,
            maxReconnectInterval: 30000,
            reconnectDecay: 1.5,
            timeoutInterval: 2000,
            maxReconnectAttempts: null,
            ...options
        };
        
        this.ws = null;
        this.forcedClose = false;
        this.reconnectAttempts = 0;
        this.messageQueue = [];
        this.eventHandlers = new Map();
        this.reconnectTimer = null;
        this.pingTimer = null;
    }
    
    connect() {
        this.ws = new WebSocket(this.url);
        
        this.ws.onopen = (event) => {
            console.log('WebSocket connected');
            this.onOpen(event);
        };
        
        this.ws.onmessage = (event) => {
            this.onMessage(event);
        };
        
        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            this.onError(error);
        };
        
        this.ws.onclose = (event) => {
            console.log('WebSocket closed');
            this.onClose(event);
        };
    }
    
    onOpen(event) {
        this.reconnectAttempts = 0;
        
        // Send queued messages
        while (this.messageQueue.length > 0) {
            const message = this.messageQueue.shift();
            this.send(message);
        }
        
        // Start ping timer
        this.startPing();
        
        // Emit open event
        this.emit('open', event);
    }
    
    onMessage(event) {
        try {
            const message = JSON.parse(event.data);
            
            // Handle different message types
            if (message.type === 'pong') {
                this.handlePong(message);
            } else {
                this.emit('message', message);
                
                // Emit specific event type
                if (message.type) {
                    this.emit(message.type, message.data || message);
                }
            }
        } catch (error) {
            console.error('Failed to parse message:', error);
        }
    }
    
    onError(error) {
        this.emit('error', error);
    }
    
    onClose(event) {
        this.ws = null;
        
        if (!this.forcedClose) {
            this.reconnect();
        }
        
        this.stopPing();
        this.emit('close', event);
    }
    
    reconnect() {
        if (this.options.maxReconnectAttempts && 
            this.reconnectAttempts >= this.options.maxReconnectAttempts) {
            this.emit('max-reconnects');
            return;
        }
        
        this.reconnectAttempts++;
        
        const timeout = Math.min(
            this.options.reconnectInterval * Math.pow(
                this.options.reconnectDecay,
                this.reconnectAttempts - 1
            ),
            this.options.maxReconnectInterval
        );
        
        console.log(`Reconnecting in ${timeout}ms (attempt ${this.reconnectAttempts})`);
        
        this.reconnectTimer = setTimeout(() => {
            console.log('Reconnecting...');
            this.connect();
        }, timeout);
        
        this.emit('reconnecting', {
            attempt: this.reconnectAttempts,
            timeout
        });
    }
    
    send(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            const message = typeof data === 'string' ? data : JSON.stringify(data);
            this.ws.send(message);
        } else {
            // Queue message for later
            this.messageQueue.push(data);
        }
    }
    
    startPing() {
        this.pingTimer = setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.send({ type: 'ping', timestamp: Date.now() });
            }
        }, 30000); // Ping every 30 seconds
    }
    
    stopPing() {
        if (this.pingTimer) {
            clearInterval(this.pingTimer);
            this.pingTimer = null;
        }
    }
    
    handlePong(message) {
        const latency = Date.now() - message.timestamp;
        this.emit('latency', latency);
    }
    
    on(event, handler) {
        if (!this.eventHandlers.has(event)) {
            this.eventHandlers.set(event, []);
        }
        this.eventHandlers.get(event).push(handler);
    }
    
    off(event, handler) {
        const handlers = this.eventHandlers.get(event);
        if (handlers) {
            const index = handlers.indexOf(handler);
            if (index !== -1) {
                handlers.splice(index, 1);
            }
        }
    }
    
    emit(event, data) {
        const handlers = this.eventHandlers.get(event);
        if (handlers) {
            handlers.forEach(handler => {
                try {
                    handler(data);
                } catch (error) {
                    console.error(`Error in event handler for ${event}:`, error);
                }
            });
        }
    }
    
    close() {
        this.forcedClose = true;
        
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        
        if (this.ws) {
            this.ws.close();
        }
        
        this.stopPing();
    }
    
    getState() {
        if (!this.ws) {
            return 'DISCONNECTED';
        }
        
        switch (this.ws.readyState) {
            case WebSocket.CONNECTING:
                return 'CONNECTING';
            case WebSocket.OPEN:
                return 'CONNECTED';
            case WebSocket.CLOSING:
                return 'CLOSING';
            case WebSocket.CLOSED:
                return 'DISCONNECTED';
            default:
                return 'UNKNOWN';
        }
    }
}
```

## Authentication

WebSocket connections inherit authentication from the HTTP session or require token-based auth.

### Session-Based Authentication

```javascript
// Session auth (cookies must be included)
const ws = new WebSocket('ws://localhost:8080', {
    headers: {
        'Cookie': document.cookie  // Include session cookie
    }
});
```

### Token-Based Authentication

```javascript
// Send auth token after connection
class AuthenticatedWebSocket {
    constructor(url, token) {
        this.url = url;
        this.token = token;
        this.authenticated = false;
    }
    
    connect() {
        this.ws = new WebSocket(this.url);
        
        this.ws.onopen = () => {
            // Send authentication message
            this.send({
                type: 'auth',
                token: this.token
            });
        };
        
        this.ws.onmessage = (event) => {
            const message = JSON.parse(event.data);
            
            if (message.type === 'auth-success') {
                this.authenticated = true;
                this.onAuthenticated();
            } else if (message.type === 'auth-error') {
                this.onAuthError(message.error);
            } else if (this.authenticated) {
                this.handleMessage(message);
            }
        };
    }
    
    send(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        }
    }
    
    onAuthenticated() {
        console.log('WebSocket authenticated');
    }
    
    onAuthError(error) {
        console.error('Authentication failed:', error);
    }
    
    handleMessage(message) {
        // Handle authenticated messages
    }
}
```

## Message Format

### Standard Message Structure

```typescript
interface WebSocketMessage {
    type: string;           // Message type identifier
    data?: any;            // Message payload
    timestamp?: number;    // Unix timestamp
    id?: string;          // Message ID for tracking
    error?: string;       // Error message if applicable
}
```

### Common Message Types

```javascript
// Incoming messages from server
const incomingMessages = {
    // Synchronization
    'sync': {
        type: 'sync',
        data: {
            entityChanges: [],
            lastSyncedPush: 12345
        }
    },
    
    // Entity changes
    'entity-changes': {
        type: 'entity-changes',
        data: [
            {
                entityName: 'notes',
                entityId: 'noteId123',
                action: 'update',
                entity: { /* note data */ }
            }
        ]
    },
    
    // Note events
    'note-created': {
        type: 'note-created',
        data: {
            noteId: 'newNoteId',
            title: 'New Note',
            parentNoteId: 'parentId'
        }
    },
    
    'note-updated': {
        type: 'note-updated',
        data: {
            noteId: 'noteId123',
            changes: { title: 'Updated Title' }
        }
    },
    
    'note-deleted': {
        type: 'note-deleted',
        data: {
            noteId: 'deletedNoteId'
        }
    },
    
    // Tree structure changes
    'refresh-tree': {
        type: 'refresh-tree',
        data: {
            noteId: 'affectedNoteId'
        }
    },
    
    // Script execution
    'frontend-script': {
        type: 'frontend-script',
        data: {
            script: 'console.log("Hello from backend")',
            params: { key: 'value' }
        }
    },
    
    // Progress updates
    'progress-update': {
        type: 'progress-update',
        data: {
            taskId: 'task123',
            progress: 75,
            message: 'Processing...'
        }
    },
    
    // LLM streaming
    'llm-stream': {
        type: 'llm-stream',
        chatNoteId: 'chatNote123',
        content: 'Streaming response...',
        done: false
    }
};

// Outgoing messages to server
const outgoingMessages = {
    // Keep-alive ping
    'ping': {
        type: 'ping',
        timestamp: Date.now()
    },
    
    // Client logging
    'log-error': {
        type: 'log-error',
        error: 'Error message',
        stack: 'Stack trace'
    },
    
    'log-info': {
        type: 'log-info',
        info: 'Information message'
    },
    
    // Custom events
    'custom-event': {
        type: 'custom-event',
        data: {
            eventName: 'user-action',
            payload: { /* custom data */ }
        }
    }
};
```

## Event Types

### System Events

```javascript
class TriliumEventHandler {
    constructor(wsManager) {
        this.wsManager = wsManager;
        this.setupEventHandlers();
    }
    
    setupEventHandlers() {
        // Connection events
        this.wsManager.on('open', () => {
            console.log('Connected to Trilium');
            this.onConnect();
        });
        
        this.wsManager.on('close', () => {
            console.log('Disconnected from Trilium');
            this.onDisconnect();
        });
        
        this.wsManager.on('error', (error) => {
            console.error('WebSocket error:', error);
            this.onError(error);
        });
        
        this.wsManager.on('reconnecting', (info) => {
            console.log(`Reconnecting... Attempt ${info.attempt}`);
            this.onReconnecting(info);
        });
        
        // Trilium-specific events
        this.wsManager.on('sync', (data) => {
            this.handleSync(data);
        });
        
        this.wsManager.on('entity-changes', (changes) => {
            this.handleEntityChanges(changes);
        });
        
        this.wsManager.on('note-created', (note) => {
            this.handleNoteCreated(note);
        });
        
        this.wsManager.on('note-updated', (update) => {
            this.handleNoteUpdated(update);
        });
        
        this.wsManager.on('note-deleted', (deletion) => {
            this.handleNoteDeleted(deletion);
        });
        
        this.wsManager.on('refresh-tree', (data) => {
            this.handleTreeRefresh(data);
        });
    }
    
    onConnect() {
        // Update UI to show connected status
        this.updateConnectionStatus('connected');
    }
    
    onDisconnect() {
        // Update UI to show disconnected status
        this.updateConnectionStatus('disconnected');
    }
    
    onError(error) {
        // Handle error
        this.showError(error.message);
    }
    
    onReconnecting(info) {
        // Show reconnection status
        this.updateConnectionStatus(`reconnecting (${info.attempt})`);
    }
    
    handleSync(data) {
        console.log('Sync data received:', data);
        // Process synchronization data
        if (data.entityChanges && data.entityChanges.length > 0) {
            this.processSyncChanges(data.entityChanges);
        }
    }
    
    handleEntityChanges(changes) {
        console.log('Entity changes:', changes);
        
        changes.forEach(change => {
            switch (change.entityName) {
                case 'notes':
                    this.processNoteChange(change);
                    break;
                case 'branches':
                    this.processBranchChange(change);
                    break;
                case 'attributes':
                    this.processAttributeChange(change);
                    break;
            }
        });
    }
    
    handleNoteCreated(note) {
        console.log('Note created:', note);
        // Update local cache
        this.addNoteToCache(note);
        // Update UI
        this.addNoteToTree(note);
    }
    
    handleNoteUpdated(update) {
        console.log('Note updated:', update);
        // Update local cache
        this.updateNoteInCache(update.noteId, update.changes);
        // Update UI if note is visible
        if (this.isNoteVisible(update.noteId)) {
            this.refreshNoteDisplay(update.noteId);
        }
    }
    
    handleNoteDeleted(deletion) {
        console.log('Note deleted:', deletion);
        // Remove from cache
        this.removeNoteFromCache(deletion.noteId);
        // Update UI
        this.removeNoteFromTree(deletion.noteId);
    }
    
    handleTreeRefresh(data) {
        console.log('Tree refresh requested:', data);
        // Refresh tree structure
        this.refreshTreeBranch(data.noteId);
    }
    
    // Placeholder methods for UI updates
    updateConnectionStatus(status) { /* ... */ }
    showError(message) { /* ... */ }
    processSyncChanges(changes) { /* ... */ }
    processNoteChange(change) { /* ... */ }
    processBranchChange(change) { /* ... */ }
    processAttributeChange(change) { /* ... */ }
    addNoteToCache(note) { /* ... */ }
    addNoteToTree(note) { /* ... */ }
    updateNoteInCache(noteId, changes) { /* ... */ }
    isNoteVisible(noteId) { /* ... */ }
    refreshNoteDisplay(noteId) { /* ... */ }
    removeNoteFromCache(noteId) { /* ... */ }
    removeNoteFromTree(noteId) { /* ... */ }
    refreshTreeBranch(noteId) { /* ... */ }
}
```

## Real-time Synchronization

### Sync Protocol Implementation

```javascript
class TriliumSyncManager {
    constructor(wsManager) {
        this.wsManager = wsManager;
        this.lastSyncedPush = null;
        this.pendingChanges = [];
        this.syncInProgress = false;
        
        this.setupSyncHandlers();
    }
    
    setupSyncHandlers() {
        this.wsManager.on('sync', (data) => {
            this.handleIncomingSync(data);
        });
        
        this.wsManager.on('sync-complete', (data) => {
            this.onSyncComplete(data);
        });
        
        this.wsManager.on('sync-error', (error) => {
            this.onSyncError(error);
        });
    }
    
    async handleIncomingSync(syncData) {
        console.log('Processing sync data:', syncData);
        
        this.syncInProgress = true;
        
        try {
            // Process entity changes in order
            for (const change of syncData.entityChanges) {
                await this.processEntityChange(change);
            }
            
            // Update sync position
            this.lastSyncedPush = syncData.lastSyncedPush;
            
            // Send acknowledgment
            this.wsManager.send({
                type: 'sync-ack',
                lastSyncedPush: this.lastSyncedPush
            });
            
        } catch (error) {
            console.error('Sync processing error:', error);
            this.wsManager.send({
                type: 'sync-error',
                error: error.message,
                lastSyncedPush: this.lastSyncedPush
            });
        } finally {
            this.syncInProgress = false;
            this.processPendingChanges();
        }
    }
    
    async processEntityChange(change) {
        const { entityName, entityId, action, entity } = change;
        
        console.log(`Processing ${action} for ${entityName}:${entityId}`);
        
        switch (entityName) {
            case 'notes':
                await this.processNoteChange(action, entityId, entity);
                break;
            case 'branches':
                await this.processBranchChange(action, entityId, entity);
                break;
            case 'attributes':
                await this.processAttributeChange(action, entityId, entity);
                break;
            case 'note_contents':
                await this.processContentChange(action, entityId, entity);
                break;
        }
    }
    
    async processNoteChange(action, noteId, noteData) {
        switch (action) {
            case 'create':
                await this.createNote(noteId, noteData);
                break;
            case 'update':
                await this.updateNote(noteId, noteData);
                break;
            case 'delete':
                await this.deleteNote(noteId);
                break;
        }
    }
    
    async createNote(noteId, noteData) {
        // Add to local database/cache
        await localDB.notes.add({
            ...noteData,
            noteId,
            syncVersion: this.lastSyncedPush
        });
        
        // Emit event for UI update
        this.emit('note-created', { noteId, noteData });
    }
    
    async updateNote(noteId, updates) {
        // Update local database/cache
        await localDB.notes.update(noteId, {
            ...updates,
            syncVersion: this.lastSyncedPush
        });
        
        // Emit event for UI update
        this.emit('note-updated', { noteId, updates });
    }
    
    async deleteNote(noteId) {
        // Remove from local database/cache
        await localDB.notes.delete(noteId);
        
        // Emit event for UI update
        this.emit('note-deleted', { noteId });
    }
    
    // Send local changes to server
    async pushLocalChanges() {
        if (this.syncInProgress) {
            return;
        }
        
        const localChanges = await this.getLocalChanges();
        
        if (localChanges.length === 0) {
            return;
        }
        
        this.wsManager.send({
            type: 'push-changes',
            changes: localChanges,
            lastSyncedPull: this.lastSyncedPull
        });
    }
    
    async getLocalChanges() {
        // Get changes from local database that haven't been synced
        const changes = await localDB.changes
            .where('syncVersion')
            .above(this.lastSyncedPush || 0)
            .toArray();
        
        return changes;
    }
    
    processPendingChanges() {
        if (this.pendingChanges.length > 0 && !this.syncInProgress) {
            const changes = this.pendingChanges.splice(0);
            this.handleIncomingSync({ entityChanges: changes });
        }
    }
    
    emit(event, data) {
        // Emit events to application
        window.dispatchEvent(new CustomEvent(`trilium:${event}`, { detail: data }));
    }
}
```

### Conflict Resolution

```javascript
class ConflictResolver {
    constructor(syncManager) {
        this.syncManager = syncManager;
    }
    
    async resolveConflict(localEntity, remoteEntity) {
        // Compare timestamps
        const localTime = new Date(localEntity.utcDateModified).getTime();
        const remoteTime = new Date(remoteEntity.utcDateModified).getTime();
        
        if (localTime === remoteTime) {
            // Same timestamp, compare content
            return this.resolveByContent(localEntity, remoteEntity);
        }
        
        // Default: last-write-wins
        if (remoteTime > localTime) {
            return {
                winner: 'remote',
                entity: remoteEntity,
                backup: localEntity
            };
        } else {
            return {
                winner: 'local',
                entity: localEntity,
                backup: remoteEntity
            };
        }
    }
    
    resolveByContent(localEntity, remoteEntity) {
        // Create three-way merge if possible
        const baseEntity = this.getBaseEntity(localEntity.entityId);
        
        if (baseEntity) {
            return this.threeWayMerge(baseEntity, localEntity, remoteEntity);
        }
        
        // Fall back to manual resolution
        return this.promptUserResolution(localEntity, remoteEntity);
    }
    
    threeWayMerge(base, local, remote) {
        // Implement three-way merge logic
        const merged = { ...base };
        
        // Merge each property
        for (const key in local) {
            if (local[key] !== base[key] && remote[key] !== base[key]) {
                // Both changed - conflict
                if (local[key] === remote[key]) {
                    // Same change
                    merged[key] = local[key];
                } else {
                    // Different changes - need resolution
                    merged[key] = this.mergeProperty(key, base[key], local[key], remote[key]);
                }
            } else if (local[key] !== base[key]) {
                // Only local changed
                merged[key] = local[key];
            } else if (remote[key] !== base[key]) {
                // Only remote changed
                merged[key] = remote[key];
            }
        }
        
        return {
            winner: 'merged',
            entity: merged,
            localChanges: this.diff(base, local),
            remoteChanges: this.diff(base, remote)
        };
    }
    
    mergeProperty(key, base, local, remote) {
        // Property-specific merge strategies
        switch (key) {
            case 'content':
                // For content, try text merge
                return this.mergeText(base, local, remote);
            case 'attributes':
                // For attributes, merge arrays
                return this.mergeArrays(base, local, remote);
            default:
                // Default to remote for safety
                return remote;
        }
    }
    
    async promptUserResolution(local, remote) {
        // Show conflict resolution UI
        const resolution = await this.showConflictDialog({
            local,
            remote,
            diff: this.diff(local, remote)
        });
        
        return resolution;
    }
    
    diff(obj1, obj2) {
        const changes = {};
        
        for (const key in obj2) {
            if (obj1[key] !== obj2[key]) {
                changes[key] = {
                    old: obj1[key],
                    new: obj2[key]
                };
            }
        }
        
        return changes;
    }
}
```

## Custom Event Broadcasting

### Creating Custom Events

```javascript
class CustomEventBroadcaster {
    constructor(wsManager) {
        this.wsManager = wsManager;
        this.eventListeners = new Map();
    }
    
    // Broadcast event to all connected clients
    broadcast(eventName, data) {
        this.wsManager.send({
            type: 'custom-broadcast',
            eventName,
            data,
            timestamp: Date.now()
        });
    }
    
    // Send event to specific clients
    sendToClients(clientIds, eventName, data) {
        this.wsManager.send({
            type: 'targeted-broadcast',
            targets: clientIds,
            eventName,
            data,
            timestamp: Date.now()
        });
    }
    
    // Subscribe to custom events
    subscribe(eventName, handler) {
        if (!this.eventListeners.has(eventName)) {
            this.eventListeners.set(eventName, []);
        }
        
        this.eventListeners.get(eventName).push(handler);
        
        // Register with server
        this.wsManager.send({
            type: 'subscribe',
            eventName
        });
    }
    
    // Unsubscribe from events
    unsubscribe(eventName, handler) {
        const handlers = this.eventListeners.get(eventName);
        if (handlers) {
            const index = handlers.indexOf(handler);
            if (index !== -1) {
                handlers.splice(index, 1);
            }
            
            if (handlers.length === 0) {
                this.eventListeners.delete(eventName);
                
                // Unregister with server
                this.wsManager.send({
                    type: 'unsubscribe',
                    eventName
                });
            }
        }
    }
    
    // Handle incoming custom events
    handleCustomEvent(message) {
        const { eventName, data } = message;
        const handlers = this.eventListeners.get(eventName);
        
        if (handlers) {
            handlers.forEach(handler => {
                try {
                    handler(data);
                } catch (error) {
                    console.error(`Error handling custom event ${eventName}:`, error);
                }
            });
        }
    }
}

// Usage example
const broadcaster = new CustomEventBroadcaster(wsManager);

// Subscribe to custom events
broadcaster.subscribe('user-joined', (data) => {
    console.log(`User ${data.username} joined`);
});

broadcaster.subscribe('collaborative-edit', (data) => {
    console.log(`Edit on note ${data.noteId}: ${data.change}`);
});

// Broadcast custom event
broadcaster.broadcast('user-action', {
    action: 'viewed-note',
    noteId: 'abc123',
    userId: 'user456'
});
```

### Collaborative Features

```javascript
class CollaborationManager {
    constructor(wsManager, userId) {
        this.wsManager = wsManager;
        this.userId = userId;
        this.activeSessions = new Map();
        this.cursorPositions = new Map();
        
        this.setupCollaborationHandlers();
    }
    
    setupCollaborationHandlers() {
        this.wsManager.on('collab-session-started', (data) => {
            this.handleSessionStarted(data);
        });
        
        this.wsManager.on('collab-user-joined', (data) => {
            this.handleUserJoined(data);
        });
        
        this.wsManager.on('collab-user-left', (data) => {
            this.handleUserLeft(data);
        });
        
        this.wsManager.on('collab-cursor-update', (data) => {
            this.handleCursorUpdate(data);
        });
        
        this.wsManager.on('collab-selection-update', (data) => {
            this.handleSelectionUpdate(data);
        });
        
        this.wsManager.on('collab-content-change', (data) => {
            this.handleContentChange(data);
        });
    }
    
    startCollaborationSession(noteId) {
        this.wsManager.send({
            type: 'start-collab-session',
            noteId,
            userId: this.userId
        });
        
        const session = {
            noteId,
            users: new Set([this.userId]),
            startTime: Date.now()
        };
        
        this.activeSessions.set(noteId, session);
        
        return session;
    }
    
    joinCollaborationSession(noteId) {
        this.wsManager.send({
            type: 'join-collab-session',
            noteId,
            userId: this.userId
        });
    }
    
    leaveCollaborationSession(noteId) {
        this.wsManager.send({
            type: 'leave-collab-session',
            noteId,
            userId: this.userId
        });
        
        this.activeSessions.delete(noteId);
    }
    
    sendCursorPosition(noteId, position) {
        this.wsManager.send({
            type: 'collab-cursor-update',
            noteId,
            userId: this.userId,
            position
        });
    }
    
    sendSelectionUpdate(noteId, selection) {
        this.wsManager.send({
            type: 'collab-selection-update',
            noteId,
            userId: this.userId,
            selection
        });
    }
    
    sendContentChange(noteId, change) {
        this.wsManager.send({
            type: 'collab-content-change',
            noteId,
            userId: this.userId,
            change
        });
    }
    
    handleSessionStarted(data) {
        const { noteId, users } = data;
        
        const session = {
            noteId,
            users: new Set(users),
            startTime: Date.now()
        };
        
        this.activeSessions.set(noteId, session);
        
        // Update UI to show collaboration indicators
        this.showCollaborationIndicator(noteId, users);
    }
    
    handleUserJoined(data) {
        const { noteId, userId, userInfo } = data;
        const session = this.activeSessions.get(noteId);
        
        if (session) {
            session.users.add(userId);
            this.showUserJoinedNotification(userInfo);
        }
    }
    
    handleUserLeft(data) {
        const { noteId, userId } = data;
        const session = this.activeSessions.get(noteId);
        
        if (session) {
            session.users.delete(userId);
            this.removeUserCursor(userId);
        }
    }
    
    handleCursorUpdate(data) {
        const { userId, position } = data;
        
        if (userId !== this.userId) {
            this.cursorPositions.set(userId, position);
            this.updateUserCursor(userId, position);
        }
    }
    
    handleSelectionUpdate(data) {
        const { userId, selection } = data;
        
        if (userId !== this.userId) {
            this.updateUserSelection(userId, selection);
        }
    }
    
    handleContentChange(data) {
        const { noteId, userId, change } = data;
        
        if (userId !== this.userId) {
            this.applyRemoteChange(noteId, change);
        }
    }
    
    // UI update methods (implement based on your UI framework)
    showCollaborationIndicator(noteId, users) { /* ... */ }
    showUserJoinedNotification(userInfo) { /* ... */ }
    removeUserCursor(userId) { /* ... */ }
    updateUserCursor(userId, position) { /* ... */ }
    updateUserSelection(userId, selection) { /* ... */ }
    applyRemoteChange(noteId, change) { /* ... */ }
}
```

## Client Implementation Examples

### React Hook

```
// useWebSocket.js
import { useEffect, useRef, useState, useCallback } from 'react';

export function useTriliumWebSocket(url, options = {}) {
    const [isConnected, setIsConnected] = useState(false);
    const [lastMessage, setLastMessage] = useState(null);
    const [error, setError] = useState(null);
    
    const wsManager = useRef(null);
    const messageHandlers = useRef(new Map());
    
    useEffect(() => {
        wsManager.current = new TriliumWebSocketManager(url, options);
        
        wsManager.current.on('open', () => {
            setIsConnected(true);
            setError(null);
        });
        
        wsManager.current.on('close', () => {
            setIsConnected(false);
        });
        
        wsManager.current.on('error', (err) => {
            setError(err);
        });
        
        wsManager.current.on('message', (msg) => {
            setLastMessage(msg);
            
            // Call registered handlers
            const handler = messageHandlers.current.get(msg.type);
            if (handler) {
                handler(msg.data || msg);
            }
        });
        
        wsManager.current.connect();
        
        return () => {
            wsManager.current.close();
        };
    }, [url]);
    
    const sendMessage = useCallback((message) => {
        if (wsManager.current) {
            wsManager.current.send(message);
        }
    }, []);
    
    const subscribe = useCallback((messageType, handler) => {
        messageHandlers.current.set(messageType, handler);
        
        return () => {
            messageHandlers.current.delete(messageType);
        };
    }, []);
    
    return {
        isConnected,
        lastMessage,
        error,
        sendMessage,
        subscribe
    };
}

// Usage in React component
function TriliumNoteEditor({ noteId }) {
    const { isConnected, sendMessage, subscribe } = useTriliumWebSocket(
        'ws://localhost:8080'
    );
    
    const [content, setContent] = useState('');
    
    useEffect(() => {
        // Subscribe to note updates
        const unsubscribe = subscribe('note-updated', (data) => {
            if (data.noteId === noteId) {
                setContent(data.content);
            }
        });
        
        return unsubscribe;
    }, [noteId, subscribe]);
    
    const handleContentChange = (newContent) => {
        setContent(newContent);
        
        // Send update via WebSocket
        sendMessage({
            type: 'update-note',
            noteId,
            content: newContent
        });
    };
    
    return (
        <div>
            <div>Connection: {isConnected ? '🟢' : '🔴'}</div>
            <textarea
                value={content}
                onChange={(e) => handleContentChange(e.target.value)}
            />
        </div>
    );
}
```

### Vue 3 Composable

```javascript
// useTriliumWebSocket.js
import { ref, onMounted, onUnmounted } from 'vue';

export function useTriliumWebSocket(url, options = {}) {
    const isConnected = ref(false);
    const lastMessage = ref(null);
    const error = ref(null);
    
    let wsManager = null;
    const messageHandlers = new Map();
    
    onMounted(() => {
        wsManager = new TriliumWebSocketManager(url, options);
        
        wsManager.on('open', () => {
            isConnected.value = true;
            error.value = null;
        });
        
        wsManager.on('close', () => {
            isConnected.value = false;
        });
        
        wsManager.on('error', (err) => {
            error.value = err;
        });
        
        wsManager.on('message', (msg) => {
            lastMessage.value = msg;
            
            const handler = messageHandlers.get(msg.type);
            if (handler) {
                handler(msg.data || msg);
            }
        });
        
        wsManager.connect();
    });
    
    onUnmounted(() => {
        if (wsManager) {
            wsManager.close();
        }
    });
    
    const sendMessage = (message) => {
        if (wsManager) {
            wsManager.send(message);
        }
    };
    
    const subscribe = (messageType, handler) => {
        messageHandlers.set(messageType, handler);
        
        return () => {
            messageHandlers.delete(messageType);
        };
    };
    
    return {
        isConnected,
        lastMessage,
        error,
        sendMessage,
        subscribe
    };
}
```

### Angular Service

```typescript
// trilium-websocket.service.ts
import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { filter, map } from 'rxjs/operators';

@Injectable({
    providedIn: 'root'
})
export class TriliumWebSocketService implements OnDestroy {
    private wsManager: TriliumWebSocketManager | null = null;
    private isConnected$ = new BehaviorSubject<boolean>(false);
    private messages$ = new Subject<any>();
    private error$ = new Subject<Error>();
    
    constructor() {}
    
    connect(url: string, options: any = {}): void {
        this.wsManager = new TriliumWebSocketManager(url, options);
        
        this.wsManager.on('open', () => {
            this.isConnected$.next(true);
        });
        
        this.wsManager.on('close', () => {
            this.isConnected$.next(false);
        });
        
        this.wsManager.on('error', (error) => {
            this.error$.next(error);
        });
        
        this.wsManager.on('message', (message) => {
            this.messages$.next(message);
        });
        
        this.wsManager.connect();
    }
    
    disconnect(): void {
        if (this.wsManager) {
            this.wsManager.close();
            this.wsManager = null;
        }
    }
    
    send(message: any): void {
        if (this.wsManager) {
            this.wsManager.send(message);
        }
    }
    
    getConnectionStatus(): Observable<boolean> {
        return this.isConnected$.asObservable();
    }
    
    getMessages(): Observable<any> {
        return this.messages$.asObservable();
    }
    
    getMessagesByType(type: string): Observable<any> {
        return this.messages$.pipe(
            filter(msg => msg.type === type),
            map(msg => msg.data || msg)
        );
    }
    
    getErrors(): Observable<Error> {
        return this.error$.asObservable();
    }
    
    ngOnDestroy(): void {
        this.disconnect();
    }
}
```

## Debugging WebSocket Connections

### Debug Logger

```javascript
class WebSocketDebugger {
    constructor(wsManager, options = {}) {
        this.wsManager = wsManager;
        this.options = {
            logMessages: true,
            logEvents: true,
            logErrors: true,
            maxLogSize: 100,
            ...options
        };
        
        this.logs = [];
        this.stats = {
            messagesSent: 0,
            messagesReceived: 0,
            bytesReceived: 0,
            errors: 0,
            reconnects: 0,
            latency: []
        };
        
        this.setupDebugHandlers();
    }
    
    setupDebugHandlers() {
        // Intercept send method
        const originalSend = this.wsManager.send.bind(this.wsManager);
        this.wsManager.send = (data) => {
            this.logOutgoing(data);
            this.stats.messagesSent++;
            return originalSend(data);
        };
        
        // Log incoming messages
        this.wsManager.on('message', (message) => {
            this.logIncoming(message);
            this.stats.messagesReceived++;
        });
        
        // Log events
        this.wsManager.on('open', () => {
            this.logEvent('Connected');
        });
        
        this.wsManager.on('close', (event) => {
            this.logEvent(`Disconnected (code: ${event.code})`);
        });
        
        this.wsManager.on('error', (error) => {
            this.logError(error);
            this.stats.errors++;
        });
        
        this.wsManager.on('reconnecting', (info) => {
            this.logEvent(`Reconnecting (attempt ${info.attempt})`);
            this.stats.reconnects++;
        });
        
        this.wsManager.on('latency', (latency) => {
            this.stats.latency.push(latency);
            if (this.stats.latency.length > 100) {
                this.stats.latency.shift();
            }
        });
    }
    
    logOutgoing(data) {
        if (this.options.logMessages) {
            this.addLog('OUT', data);
            console.log('%c→ OUT', 'color: #4CAF50', data);
        }
    }
    
    logIncoming(data) {
        if (this.options.logMessages) {
            this.addLog('IN', data);
            console.log('%c← IN', 'color: #2196F3', data);
        }
        
        // Track data size
        const size = JSON.stringify(data).length;
        this.stats.bytesReceived += size;
    }
    
    logEvent(event) {
        if (this.options.logEvents) {
            this.addLog('EVENT', event);
            console.log('%c● EVENT', 'color: #FF9800', event);
        }
    }
    
    logError(error) {
        if (this.options.logErrors) {
            this.addLog('ERROR', error);
            console.error('WebSocket Error:', error);
        }
    }
    
    addLog(type, data) {
        const log = {
            type,
            data,
            timestamp: new Date().toISOString()
        };
        
        this.logs.push(log);
        
        // Limit log size
        if (this.logs.length > this.options.maxLogSize) {
            this.logs.shift();
        }
    }
    
    getStats() {
        const avgLatency = this.stats.latency.length > 0
            ? this.stats.latency.reduce((a, b) => a + b, 0) / this.stats.latency.length
            : 0;
        
        return {
            ...this.stats,
            averageLatency: avgLatency,
            currentLatency: this.stats.latency[this.stats.latency.length - 1] || 0
        };
    }
    
    getLogs(filter = null) {
        if (filter) {
            return this.logs.filter(log => log.type === filter);
        }
        return this.logs;
    }
    
    exportLogs() {
        const data = {
            logs: this.logs,
            stats: this.getStats(),
            timestamp: new Date().toISOString()
        };
        
        const blob = new Blob([JSON.stringify(data, null, 2)], {
            type: 'application/json'
        });
        
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `websocket-debug-${Date.now()}.json`;
        a.click();
        
        URL.revokeObjectURL(url);
    }
    
    createDebugPanel() {
        const panel = document.createElement('div');
        panel.id = 'ws-debug-panel';
        panel.innerHTML = `
            <style>
                #ws-debug-panel {
                    position: fixed;
                    bottom: 0;
                    right: 0;
                    width: 400px;
                    height: 300px;
                    background: #1e1e1e;
                    color: #fff;
                    font-family: monospace;
                    font-size: 12px;
                    z-index: 10000;
                    display: flex;
                    flex-direction: column;
                }
                #ws-debug-header {
                    padding: 10px;
                    background: #2d2d2d;
                    display: flex;
                    justify-content: space-between;
                }
                #ws-debug-stats {
                    padding: 10px;
                    border-bottom: 1px solid #444;
                }
                #ws-debug-logs {
                    flex: 1;
                    overflow-y: auto;
                    padding: 10px;
                }
                .ws-log-entry {
                    margin-bottom: 5px;
                    padding: 5px;
                    background: #2d2d2d;
                    border-radius: 3px;
                }
                .ws-log-out { border-left: 3px solid #4CAF50; }
                .ws-log-in { border-left: 3px solid #2196F3; }
                .ws-log-event { border-left: 3px solid #FF9800; }
                .ws-log-error { border-left: 3px solid #f44336; }
            </style>
            <div id="ws-debug-header">
                <span>WebSocket Debug</span>
                <button onclick="this.parentElement.parentElement.remove()">✕</button>
            </div>
            <div id="ws-debug-stats"></div>
            <div id="ws-debug-logs"></div>
        `;
        
        document.body.appendChild(panel);
        
        // Update stats periodically
        setInterval(() => {
            this.updateDebugPanel();
        }, 1000);
    }
    
    updateDebugPanel() {
        const statsEl = document.getElementById('ws-debug-stats');
        const logsEl = document.getElementById('ws-debug-logs');
        
        if (!statsEl || !logsEl) return;
        
        const stats = this.getStats();
        statsEl.innerHTML = `
            <div>Sent: ${stats.messagesSent} | Received: ${stats.messagesReceived}</div>
            <div>Bytes: ${(stats.bytesReceived / 1024).toFixed(2)} KB</div>
            <div>Latency: ${stats.currentLatency}ms (avg: ${stats.averageLatency.toFixed(1)}ms)</div>
            <div>Errors: ${stats.errors} | Reconnects: ${stats.reconnects}</div>
        `;
        
        // Show recent logs
        const recentLogs = this.logs.slice(-10);
        logsEl.innerHTML = recentLogs.map(log => `
            <div class="ws-log-entry ws-log-${log.type.toLowerCase()}">
                <small>${new Date(log.timestamp).toLocaleTimeString()}</small>
                ${log.type}: ${typeof log.data === 'object' ? JSON.stringify(log.data).substring(0, 100) : log.data}
            </div>
        `).join('');
    }
}

// Usage
const debugger = new WebSocketDebugger(wsManager, {
    logMessages: true,
    logEvents: true,
    logErrors: true
});

// Create visual debug panel
debugger.createDebugPanel();

// Export logs for analysis
debugger.exportLogs();
```

## Best Practices

### 1\. Connection Management

*   Always implement reconnection logic with exponential backoff
*   Handle connection state changes gracefully
*   Queue messages during disconnection
*   Implement heartbeat/ping mechanism

### 2\. Message Handling

*   Always validate incoming message format
*   Use structured message types
*   Implement message acknowledgment for critical operations
*   Handle message ordering and deduplication

### 3\. Error Recovery

*   Implement comprehensive error handling
*   Log errors for debugging
*   Provide user feedback for connection issues
*   Implement fallback mechanisms

### 4\. Performance

*   Batch messages when possible
*   Implement message compression for large payloads
*   Use binary frames for file transfers
*   Limit message frequency (throttle/debounce)

### 5\. Security

*   Always use WSS (WebSocket Secure) in production
*   Validate all incoming data
*   Implement rate limiting
*   Use authentication tokens with expiration

## Conclusion

The Trilium WebSocket API provides powerful real-time capabilities for building responsive, collaborative applications. Key takeaways:

1.  **Use WebSocket for real-time features** - synchronization, collaboration, live updates
2.  **Implement robust connection management** - reconnection, queuing, state handling
3.  **Handle all message types** - system events, custom events, errors
4.  **Debug thoroughly** - use logging, monitoring, and debugging tools
5.  **Follow best practices** - security, performance, error handling

For more information:

*   [Internal API Reference](Internal%20API%20Reference.md)
*   [ETAPI Complete Guide](ETAPI%20Complete%20Guide.md)
*   [API Client Libraries](API%20Client%20Libraries.md)