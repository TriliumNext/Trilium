# API Client Libraries
## Table of Contents

1.  [Overview](#overview)
2.  [JavaScript/TypeScript Client](#javascripttypescript-client)
3.  [Python Client - trilium-py](#python-client---trilium-py)
4.  [Go Client](#go-client)
5.  [Ruby Client](#ruby-client)
6.  [PHP Client](#php-client)
7.  [C# Client](#c-client)
8.  [Rust Client](#rust-client)
9.  [REST Client Best Practices](#rest-client-best-practices)
10.  [Error Handling Patterns](#error-handling-patterns)
11.  [Retry Strategies](#retry-strategies)
12.  [Testing Client Libraries](#testing-client-libraries)

## Overview

This guide provides comprehensive examples of Trilium API client libraries in various programming languages. Each implementation follows best practices for that language while maintaining consistent functionality across all clients.

### Common Features

All client libraries should implement:

*   Token-based authentication
*   CRUD operations for notes, attributes, branches, and attachments
*   Search functionality
*   Error handling with retry logic
*   Connection pooling
*   Request/response logging (optional)
*   Rate limiting support

## JavaScript/TypeScript Client

### Full-Featured TypeScript Implementation

```typescript
// trilium-client.ts

import axios, { AxiosInstance, AxiosRequestConfig, AxiosError } from 'axios';

// Types
export interface Note {
    noteId: string;
    title: string;
    type: string;
    mime: string;
    isProtected: boolean;
    attributes?: Attribute[];
    parentNoteIds?: string[];
    childNoteIds?: string[];
    dateCreated: string;
    dateModified: string;
    utcDateCreated: string;
    utcDateModified: string;
}

export interface CreateNoteParams {
    parentNoteId: string;
    title: string;
    type: string;
    content: string;
    notePosition?: number;
    prefix?: string;
    isExpanded?: boolean;
    noteId?: string;
    branchId?: string;
}

export interface Attribute {
    attributeId: string;
    noteId: string;
    type: 'label' | 'relation';
    name: string;
    value: string;
    position?: number;
    isInheritable?: boolean;
}

export interface Branch {
    branchId: string;
    noteId: string;
    parentNoteId: string;
    prefix?: string;
    notePosition?: number;
    isExpanded?: boolean;
}

export interface Attachment {
    attachmentId: string;
    ownerId: string;
    role: string;
    mime: string;
    title: string;
    position?: number;
    blobId?: string;
    dateModified?: string;
    utcDateModified?: string;
}

export interface SearchParams {
    search: string;
    fastSearch?: boolean;
    includeArchivedNotes?: boolean;
    ancestorNoteId?: string;
    ancestorDepth?: string;
    orderBy?: string;
    orderDirection?: 'asc' | 'desc';
    limit?: number;
    debug?: boolean;
}

export interface SearchResponse {
    results: Note[];
    debugInfo?: any;
}

export interface AppInfo {
    appVersion: string;
    dbVersion: number;
    syncVersion: number;
    buildDate: string;
    buildRevision: string;
    dataDirectory: string;
    clipperProtocolVersion: string;
    utcDateTime: string;
}

export interface TriliumClientConfig {
    baseUrl: string;
    token: string;
    timeout?: number;
    retryAttempts?: number;
    retryDelay?: number;
    enableLogging?: boolean;
}

// Error classes
export class TriliumError extends Error {
    constructor(
        message: string,
        public statusCode?: number,
        public code?: string,
        public details?: any
    ) {
        super(message);
        this.name = 'TriliumError';
    }
}

export class TriliumConnectionError extends TriliumError {
    constructor(message: string, details?: any) {
        super(message, undefined, 'CONNECTION_ERROR', details);
        this.name = 'TriliumConnectionError';
    }
}

export class TriliumAuthError extends TriliumError {
    constructor(message: string, details?: any) {
        super(message, 401, 'AUTH_ERROR', details);
        this.name = 'TriliumAuthError';
    }
}

// Main client class
export class TriliumClient {
    private client: AxiosInstance;
    private config: Required<TriliumClientConfig>;
    
    constructor(config: TriliumClientConfig) {
        this.config = {
            timeout: 30000,
            retryAttempts: 3,
            retryDelay: 1000,
            enableLogging: false,
            ...config
        };
        
        this.client = axios.create({
            baseURL: this.config.baseUrl,
            timeout: this.config.timeout,
            headers: {
                'Authorization': this.config.token,
                'Content-Type': 'application/json'
            }
        });
        
        this.setupInterceptors();
    }
    
    private setupInterceptors(): void {
        // Request interceptor for logging
        this.client.interceptors.request.use(
            (config) => {
                if (this.config.enableLogging) {
                    console.log(`[Trilium] ${config.method?.toUpperCase()} ${config.url}`);
                }
                return config;
            },
            (error) => Promise.reject(error)
        );
        
        // Response interceptor for error handling and retry
        this.client.interceptors.response.use(
            (response) => response,
            async (error: AxiosError) => {
                const originalRequest = error.config as AxiosRequestConfig & { _retryCount?: number };
                
                if (!originalRequest) {
                    throw new TriliumConnectionError('No request config available');
                }
                
                // Initialize retry count
                if (!originalRequest._retryCount) {
                    originalRequest._retryCount = 0;
                }
                
                // Handle different error types
                if (error.response) {
                    // Server responded with error
                    if (error.response.status === 401) {
                        throw new TriliumAuthError('Authentication failed', error.response.data);
                    }
                    
                    // Don't retry client errors (4xx)
                    if (error.response.status >= 400 && error.response.status < 500) {
                        throw new TriliumError(
                            error.response.data?.message || error.message,
                            error.response.status,
                            error.response.data?.code,
                            error.response.data
                        );
                    }
                } else if (error.request) {
                    // No response received
                    if (originalRequest._retryCount < this.config.retryAttempts) {
                        originalRequest._retryCount++;
                        
                        if (this.config.enableLogging) {
                            console.log(`[Trilium] Retry attempt ${originalRequest._retryCount}/${this.config.retryAttempts}`);
                        }
                        
                        // Wait before retry
                        await this.sleep(this.config.retryDelay * originalRequest._retryCount);
                        
                        return this.client(originalRequest);
                    }
                    
                    throw new TriliumConnectionError('No response from server', error.request);
                }
                
                throw new TriliumError(error.message);
            }
        );
    }
    
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    // Note operations
    async createNote(params: CreateNoteParams): Promise<{ note: Note; branch: Branch }> {
        const response = await this.client.post<{ note: Note; branch: Branch }>('/create-note', params);
        return response.data;
    }
    
    async getNote(noteId: string): Promise<Note> {
        const response = await this.client.get<Note>(`/notes/${noteId}`);
        return response.data;
    }
    
    async updateNote(noteId: string, updates: Partial<Note>): Promise<Note> {
        const response = await this.client.patch<Note>(`/notes/${noteId}`, updates);
        return response.data;
    }
    
    async deleteNote(noteId: string): Promise<void> {
        await this.client.delete(`/notes/${noteId}`);
    }
    
    async getNoteContent(noteId: string): Promise<string> {
        const response = await this.client.get(`/notes/${noteId}/content`, {
            responseType: 'text'
        });
        return response.data;
    }
    
    async updateNoteContent(noteId: string, content: string): Promise<void> {
        await this.client.put(`/notes/${noteId}/content`, content, {
            headers: { 'Content-Type': 'text/plain' }
        });
    }
    
    // Search
    async searchNotes(params: SearchParams): Promise<SearchResponse> {
        const response = await this.client.get<SearchResponse>('/notes', { params });
        return response.data;
    }
    
    // Attributes
    async createAttribute(attribute: Omit<Attribute, 'attributeId'>): Promise<Attribute> {
        const response = await this.client.post<Attribute>('/attributes', attribute);
        return response.data;
    }
    
    async updateAttribute(attributeId: string, updates: Partial<Attribute>): Promise<Attribute> {
        const response = await this.client.patch<Attribute>(`/attributes/${attributeId}`, updates);
        return response.data;
    }
    
    async deleteAttribute(attributeId: string): Promise<void> {
        await this.client.delete(`/attributes/${attributeId}`);
    }
    
    // Branches
    async createBranch(branch: Omit<Branch, 'branchId'>): Promise<Branch> {
        const response = await this.client.post<Branch>('/branches', branch);
        return response.data;
    }
    
    async updateBranch(branchId: string, updates: Partial<Branch>): Promise<Branch> {
        const response = await this.client.patch<Branch>(`/branches/${branchId}`, updates);
        return response.data;
    }
    
    async deleteBranch(branchId: string): Promise<void> {
        await this.client.delete(`/branches/${branchId}`);
    }
    
    // Attachments
    async createAttachment(attachment: {
        ownerId: string;
        role: string;
        mime: string;
        title: string;
        content: string;
        position?: number;
    }): Promise<Attachment> {
        const response = await this.client.post<Attachment>('/attachments', attachment);
        return response.data;
    }
    
    async getAttachment(attachmentId: string): Promise<Attachment> {
        const response = await this.client.get<Attachment>(`/attachments/${attachmentId}`);
        return response.data;
    }
    
    async getAttachmentContent(attachmentId: string): Promise<ArrayBuffer> {
        const response = await this.client.get(`/attachments/${attachmentId}/content`, {
            responseType: 'arraybuffer'
        });
        return response.data;
    }
    
    async deleteAttachment(attachmentId: string): Promise<void> {
        await this.client.delete(`/attachments/${attachmentId}`);
    }
    
    // Special notes
    async getInboxNote(date: string): Promise<Note> {
        const response = await this.client.get<Note>(`/inbox/${date}`);
        return response.data;
    }
    
    async getDayNote(date: string): Promise<Note> {
        const response = await this.client.get<Note>(`/calendar/days/${date}`);
        return response.data;
    }
    
    async getWeekNote(date: string): Promise<Note> {
        const response = await this.client.get<Note>(`/calendar/weeks/${date}`);
        return response.data;
    }
    
    async getMonthNote(month: string): Promise<Note> {
        const response = await this.client.get<Note>(`/calendar/months/${month}`);
        return response.data;
    }
    
    async getYearNote(year: string): Promise<Note> {
        const response = await this.client.get<Note>(`/calendar/years/${year}`);
        return response.data;
    }
    
    // Utility
    async getAppInfo(): Promise<AppInfo> {
        const response = await this.client.get<AppInfo>('/app-info');
        return response.data;
    }
    
    async createBackup(backupName: string): Promise<void> {
        await this.client.put(`/backup/${backupName}`);
    }
    
    async exportNotes(noteId: string, format: 'html' | 'markdown' = 'html'): Promise<ArrayBuffer> {
        const response = await this.client.get(`/notes/${noteId}/export`, {
            params: { format },
            responseType: 'arraybuffer'
        });
        return response.data;
    }
}

// Helper functions
export function createClient(baseUrl: string, token: string, options?: Partial<TriliumClientConfig>): TriliumClient {
    return new TriliumClient({
        baseUrl,
        token,
        ...options
    });
}

// Batch operations helper
export class TriliumBatchClient extends TriliumClient {
    async createMultipleNotes(notes: CreateNoteParams[]): Promise<Array<{ note: Note; branch: Branch }>> {
        const results = [];
        
        for (const noteParams of notes) {
            try {
                const result = await this.createNote(noteParams);
                results.push(result);
            } catch (error) {
                if (this.config.enableLogging) {
                    console.error(`Failed to create note "${noteParams.title}":`, error);
                }
                throw error;
            }
        }
        
        return results;
    }
    
    async searchAndUpdate(
        searchQuery: string,
        updateFn: (note: Note) => Partial<Note> | null
    ): Promise<Note[]> {
        const searchResults = await this.searchNotes({ search: searchQuery });
        const updatedNotes = [];
        
        for (const note of searchResults.results) {
            const updates = updateFn(note);
            if (updates) {
                const updated = await this.updateNote(note.noteId, updates);
                updatedNotes.push(updated);
            }
        }
        
        return updatedNotes;
    }
}

// Usage example
async function example() {
    const client = createClient('http://localhost:8080/etapi', 'your-token', {
        enableLogging: true,
        retryAttempts: 5
    });
    
    try {
        // Create a note
        const { note } = await client.createNote({
            parentNoteId: 'root',
            title: 'Test Note',
            type: 'text',
            content: '<p>Hello, Trilium!</p>'
        });
        
        console.log('Created note:', note.noteId);
        
        // Search for notes
        const searchResults = await client.searchNotes({
            search: '#todo',
            limit: 10,
            orderBy: 'dateModified',
            orderDirection: 'desc'
        });
        
        console.log(`Found ${searchResults.results.length} todo notes`);
        
        // Add a label
        await client.createAttribute({
            noteId: note.noteId,
            type: 'label',
            name: 'priority',
            value: 'high'
        });
        
    } catch (error) {
        if (error instanceof TriliumAuthError) {
            console.error('Authentication failed:', error.message);
        } else if (error instanceof TriliumConnectionError) {
            console.error('Connection error:', error.message);
        } else if (error instanceof TriliumError) {
            console.error(`API error (${error.statusCode}):`, error.message);
        } else {
            console.error('Unexpected error:', error);
        }
    }
}
```

### Browser-Compatible JavaScript Client

```javascript
// trilium-browser-client.js

class TriliumBrowserClient {
    constructor(baseUrl, token) {
        this.baseUrl = baseUrl.replace(/\/$/, '');
        this.token = token;
        this.headers = {
            'Authorization': token,
            'Content-Type': 'application/json'
        };
    }
    
    async request(endpoint, options = {}) {
        const url = `${this.baseUrl}${endpoint}`;
        const config = {
            headers: { ...this.headers, ...options.headers },
            ...options
        };
        
        try {
            const response = await fetch(url, config);
            
            if (!response.ok) {
                const error = await response.json().catch(() => ({}));
                throw new Error(error.message || `HTTP ${response.status}: ${response.statusText}`);
            }
            
            if (response.status === 204) {
                return null;
            }
            
            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
                return response.json();
            }
            
            return response.text();
        } catch (error) {
            console.error(`Request failed: ${endpoint}`, error);
            throw error;
        }
    }
    
    // Notes
    async createNote(parentNoteId, title, content, type = 'text') {
        return this.request('/create-note', {
            method: 'POST',
            body: JSON.stringify({
                parentNoteId,
                title,
                type,
                content
            })
        });
    }
    
    async getNote(noteId) {
        return this.request(`/notes/${noteId}`);
    }
    
    async updateNote(noteId, updates) {
        return this.request(`/notes/${noteId}`, {
            method: 'PATCH',
            body: JSON.stringify(updates)
        });
    }
    
    async deleteNote(noteId) {
        return this.request(`/notes/${noteId}`, {
            method: 'DELETE'
        });
    }
    
    async getNoteContent(noteId) {
        return this.request(`/notes/${noteId}/content`);
    }
    
    async updateNoteContent(noteId, content) {
        return this.request(`/notes/${noteId}/content`, {
            method: 'PUT',
            headers: { 'Content-Type': 'text/plain' },
            body: content
        });
    }
    
    // Search
    async searchNotes(query, options = {}) {
        const params = new URLSearchParams({
            search: query,
            ...options
        });
        
        return this.request(`/notes?${params}`);
    }
    
    // Attributes
    async addLabel(noteId, name, value = '') {
        return this.request('/attributes', {
            method: 'POST',
            body: JSON.stringify({
                noteId,
                type: 'label',
                name,
                value
            })
        });
    }
    
    async addRelation(noteId, name, targetNoteId) {
        return this.request('/attributes', {
            method: 'POST',
            body: JSON.stringify({
                noteId,
                type: 'relation',
                name,
                value: targetNoteId
            })
        });
    }
    
    // Special notes
    async getTodayNote() {
        const today = new Date().toISOString().split('T')[0];
        return this.request(`/calendar/days/${today}`);
    }
    
    async getInbox() {
        const today = new Date().toISOString().split('T')[0];
        return this.request(`/inbox/${today}`);
    }
}

// Usage in browser
const trilium = new TriliumBrowserClient('http://localhost:8080/etapi', 'your-token');

// Create a quick note
async function createQuickNote(title, content) {
    try {
        const inbox = await trilium.getInbox();
        const result = await trilium.createNote(inbox.noteId, title, content);
        console.log('Note created:', result.note.noteId);
        return result;
    } catch (error) {
        console.error('Failed to create note:', error);
    }
}
```

## Python Client - trilium-py

### Installation

```sh
pip install trilium-py
```

### Complete Python Implementation

```python
# trilium_client.py

import requests
from typing import Optional, Dict, List, Any, Union
from datetime import datetime, date
from dataclasses import dataclass, asdict
from enum import Enum
import time
import logging
from urllib.parse import urljoin
import json
import base64

# Set up logging
logger = logging.getLogger(__name__)

# Enums
class NoteType(Enum):
    TEXT = "text"
    CODE = "code"
    FILE = "file"
    IMAGE = "image"
    SEARCH = "search"
    BOOK = "book"
    RELATION_MAP = "relationMap"
    RENDER = "render"

class AttributeType(Enum):
    LABEL = "label"
    RELATION = "relation"

# Data classes
@dataclass
class Note:
    noteId: str
    title: str
    type: str
    mime: Optional[str] = None
    isProtected: bool = False
    dateCreated: Optional[str] = None
    dateModified: Optional[str] = None
    utcDateCreated: Optional[str] = None
    utcDateModified: Optional[str] = None
    parentNoteIds: Optional[List[str]] = None
    childNoteIds: Optional[List[str]] = None
    attributes: Optional[List[Dict]] = None

@dataclass
class CreateNoteRequest:
    parentNoteId: str
    title: str
    type: str
    content: str
    notePosition: Optional[int] = None
    prefix: Optional[str] = None
    isExpanded: Optional[bool] = None
    noteId: Optional[str] = None
    branchId: Optional[str] = None

@dataclass
class Attribute:
    noteId: str
    type: str
    name: str
    value: str = ""
    position: Optional[int] = None
    isInheritable: bool = False
    attributeId: Optional[str] = None

@dataclass
class Branch:
    noteId: str
    parentNoteId: str
    prefix: Optional[str] = None
    notePosition: Optional[int] = None
    isExpanded: Optional[bool] = None
    branchId: Optional[str] = None

# Exceptions
class TriliumError(Exception):
    """Base exception for Trilium API errors"""
    def __init__(self, message: str, status_code: Optional[int] = None, details: Optional[Dict] = None):
        super().__init__(message)
        self.status_code = status_code
        self.details = details

class TriliumAuthError(TriliumError):
    """Authentication error"""
    pass

class TriliumNotFoundError(TriliumError):
    """Resource not found error"""
    pass

class TriliumConnectionError(TriliumError):
    """Connection error"""
    pass

# Main client class
class TriliumClient:
    """Python client for Trilium ETAPI"""
    
    def __init__(
        self,
        base_url: str,
        token: str,
        timeout: int = 30,
        retry_attempts: int = 3,
        retry_delay: float = 1.0,
        verify_ssl: bool = True,
        debug: bool = False
    ):
        self.base_url = base_url.rstrip('/')
        self.token = token
        self.timeout = timeout
        self.retry_attempts = retry_attempts
        self.retry_delay = retry_delay
        self.verify_ssl = verify_ssl
        self.debug = debug
        
        # Set up session
        self.session = requests.Session()
        self.session.headers.update({
            'Authorization': token,
            'Content-Type': 'application/json'
        })
        
        # Configure logging
        if debug:
            logging.basicConfig(level=logging.DEBUG)
        
    def _request(
        self,
        method: str,
        endpoint: str,
        json_data: Optional[Dict] = None,
        params: Optional[Dict] = None,
        data: Optional[Union[str, bytes]] = None,
        headers: Optional[Dict] = None,
        **kwargs
    ) -> Any:
        """Make HTTP request with retry logic"""
        url = urljoin(self.base_url, endpoint)
        
        # Merge headers
        req_headers = self.session.headers.copy()
        if headers:
            req_headers.update(headers)
        
        # Retry logic
        last_exception = None
        for attempt in range(self.retry_attempts):
            try:
                if self.debug:
                    logger.debug(f"[Attempt {attempt + 1}] {method} {url}")
                
                response = self.session.request(
                    method=method,
                    url=url,
                    json=json_data,
                    params=params,
                    data=data,
                    headers=req_headers,
                    timeout=self.timeout,
                    verify=self.verify_ssl,
                    **kwargs
                )
                
                # Handle different status codes
                if response.status_code == 401:
                    raise TriliumAuthError("Authentication failed", 401)
                elif response.status_code == 404:
                    raise TriliumNotFoundError("Resource not found", 404)
                elif response.status_code >= 500:
                    # Server error - retry
                    if attempt < self.retry_attempts - 1:
                        time.sleep(self.retry_delay * (attempt + 1))
                        continue
                    else:
                        response.raise_for_status()
                elif not response.ok:
                    error_data = {}
                    try:
                        error_data = response.json()
                    except:
                        pass
                    raise TriliumError(
                        error_data.get('message', f"HTTP {response.status_code}"),
                        response.status_code,
                        error_data
                    )
                
                # Parse response
                if response.status_code == 204:
                    return None
                
                content_type = response.headers.get('content-type', '')
                if 'application/json' in content_type:
                    return response.json()
                elif 'text' in content_type:
                    return response.text
                else:
                    return response.content
                    
            except requests.exceptions.ConnectionError as e:
                last_exception = e
                if attempt < self.retry_attempts - 1:
                    logger.warning(f"Connection error, retrying in {self.retry_delay * (attempt + 1)}s...")
                    time.sleep(self.retry_delay * (attempt + 1))
                else:
                    raise TriliumConnectionError(f"Connection failed after {self.retry_attempts} attempts") from e
            except requests.exceptions.Timeout as e:
                last_exception = e
                if attempt < self.retry_attempts - 1:
                    logger.warning(f"Request timeout, retrying...")
                    time.sleep(self.retry_delay * (attempt + 1))
                else:
                    raise TriliumConnectionError("Request timeout") from e
            except TriliumError:
                raise
            except Exception as e:
                raise TriliumError(f"Unexpected error: {str(e)}") from e
        
        if last_exception:
            raise TriliumConnectionError(f"Request failed after {self.retry_attempts} attempts") from last_exception
    
    # Note operations
    def create_note(
        self,
        parent_note_id: str,
        title: str,
        content: str,
        note_type: Union[str, NoteType] = NoteType.TEXT,
        **kwargs
    ) -> Dict[str, Any]:
        """Create a new note"""
        if isinstance(note_type, NoteType):
            note_type = note_type.value
        
        data = {
            'parentNoteId': parent_note_id,
            'title': title,
            'type': note_type,
            'content': content,
            **kwargs
        }
        
        return self._request('POST', '/create-note', json_data=data)
    
    def get_note(self, note_id: str) -> Note:
        """Get note by ID"""
        data = self._request('GET', f'/notes/{note_id}')
        return Note(**data)
    
    def update_note(self, note_id: str, **updates) -> Note:
        """Update note properties"""
        data = self._request('PATCH', f'/notes/{note_id}', json_data=updates)
        return Note(**data)
    
    def delete_note(self, note_id: str) -> None:
        """Delete a note"""
        self._request('DELETE', f'/notes/{note_id}')
    
    def get_note_content(self, note_id: str) -> str:
        """Get note content"""
        return self._request('GET', f'/notes/{note_id}/content')
    
    def update_note_content(self, note_id: str, content: str) -> None:
        """Update note content"""
        self._request(
            'PUT',
            f'/notes/{note_id}/content',
            data=content,
            headers={'Content-Type': 'text/plain'}
        )
    
    # Search
    def search_notes(
        self,
        query: str,
        fast_search: bool = False,
        include_archived: bool = False,
        ancestor_note_id: Optional[str] = None,
        order_by: Optional[str] = None,
        order_direction: str = 'asc',
        limit: Optional[int] = None,
        debug: bool = False
    ) -> List[Note]:
        """Search for notes"""
        params = {
            'search': query,
            'fastSearch': fast_search,
            'includeArchivedNotes': include_archived
        }
        
        if ancestor_note_id:
            params['ancestorNoteId'] = ancestor_note_id
        if order_by:
            params['orderBy'] = order_by
            params['orderDirection'] = order_direction
        if limit:
            params['limit'] = limit
        if debug:
            params['debug'] = debug
        
        data = self._request('GET', '/notes', params=params)
        return [Note(**note) for note in data.get('results', [])]
    
    # Attributes
    def add_label(
        self,
        note_id: str,
        name: str,
        value: str = "",
        inheritable: bool = False,
        position: Optional[int] = None
    ) -> Attribute:
        """Add a label to a note"""
        data = {
            'noteId': note_id,
            'type': 'label',
            'name': name,
            'value': value,
            'isInheritable': inheritable
        }
        
        if position is not None:
            data['position'] = position
        
        result = self._request('POST', '/attributes', json_data=data)
        return Attribute(**result)
    
    def add_relation(
        self,
        note_id: str,
        name: str,
        target_note_id: str,
        inheritable: bool = False,
        position: Optional[int] = None
    ) -> Attribute:
        """Add a relation to a note"""
        data = {
            'noteId': note_id,
            'type': 'relation',
            'name': name,
            'value': target_note_id,
            'isInheritable': inheritable
        }
        
        if position is not None:
            data['position'] = position
        
        result = self._request('POST', '/attributes', json_data=data)
        return Attribute(**result)
    
    def update_attribute(self, attribute_id: str, **updates) -> Attribute:
        """Update an attribute"""
        result = self._request('PATCH', f'/attributes/{attribute_id}', json_data=updates)
        return Attribute(**result)
    
    def delete_attribute(self, attribute_id: str) -> None:
        """Delete an attribute"""
        self._request('DELETE', f'/attributes/{attribute_id}')
    
    # Branches
    def clone_note(
        self,
        note_id: str,
        parent_note_id: str,
        prefix: Optional[str] = None,
        note_position: Optional[int] = None
    ) -> Branch:
        """Clone a note to another location"""
        data = {
            'noteId': note_id,
            'parentNoteId': parent_note_id
        }
        
        if prefix:
            data['prefix'] = prefix
        if note_position is not None:
            data['notePosition'] = note_position
        
        result = self._request('POST', '/branches', json_data=data)
        return Branch(**result)
    
    def update_branch(self, branch_id: str, **updates) -> Branch:
        """Update a branch"""
        result = self._request('PATCH', f'/branches/{branch_id}', json_data=updates)
        return Branch(**result)
    
    def delete_branch(self, branch_id: str) -> None:
        """Delete a branch"""
        self._request('DELETE', f'/branches/{branch_id}')
    
    # Attachments
    def upload_attachment(
        self,
        note_id: str,
        file_path: str,
        title: Optional[str] = None,
        mime: Optional[str] = None,
        position: Optional[int] = None
    ) -> Dict[str, Any]:
        """Upload a file as attachment"""
        import mimetypes
        import os
        
        if title is None:
            title = os.path.basename(file_path)
        
        if mime is None:
            mime = mimetypes.guess_type(file_path)[0] or 'application/octet-stream'
        
        with open(file_path, 'rb') as f:
            content = base64.b64encode(f.read()).decode('utf-8')
        
        data = {
            'ownerId': note_id,
            'role': 'file',
            'mime': mime,
            'title': title,
            'content': content
        }
        
        if position is not None:
            data['position'] = position
        
        return self._request('POST', '/attachments', json_data=data)
    
    def download_attachment(self, attachment_id: str, output_path: str) -> str:
        """Download an attachment"""
        content = self._request('GET', f'/attachments/{attachment_id}/content')
        
        with open(output_path, 'wb') as f:
            if isinstance(content, bytes):
                f.write(content)
            else:
                f.write(content.encode('utf-8'))
        
        return output_path
    
    # Special notes
    def get_inbox(self, target_date: Optional[Union[str, date]] = None) -> Note:
        """Get inbox note for a date"""
        if target_date is None:
            target_date = date.today()
        elif isinstance(target_date, date):
            target_date = target_date.strftime('%Y-%m-%d')
        
        data = self._request('GET', f'/inbox/{target_date}')
        return Note(**data)
    
    def get_day_note(self, target_date: Optional[Union[str, date]] = None) -> Note:
        """Get day note for a date"""
        if target_date is None:
            target_date = date.today()
        elif isinstance(target_date, date):
            target_date = target_date.strftime('%Y-%m-%d')
        
        data = self._request('GET', f'/calendar/days/{target_date}')
        return Note(**data)
    
    def get_week_note(self, target_date: Optional[Union[str, date]] = None) -> Note:
        """Get week note for a date"""
        if target_date is None:
            target_date = date.today()
        elif isinstance(target_date, date):
            target_date = target_date.strftime('%Y-%m-%d')
        
        data = self._request('GET', f'/calendar/weeks/{target_date}')
        return Note(**data)
    
    def get_month_note(self, month: Optional[str] = None) -> Note:
        """Get month note"""
        if month is None:
            month = date.today().strftime('%Y-%m')
        
        data = self._request('GET', f'/calendar/months/{month}')
        return Note(**data)
    
    def get_year_note(self, year: Optional[Union[str, int]] = None) -> Note:
        """Get year note"""
        if year is None:
            year = str(date.today().year)
        elif isinstance(year, int):
            year = str(year)
        
        data = self._request('GET', f'/calendar/years/{year}')
        return Note(**data)
    
    # Utility
    def get_app_info(self) -> Dict[str, Any]:
        """Get application information"""
        return self._request('GET', '/app-info')
    
    def create_backup(self, backup_name: str) -> None:
        """Create a backup"""
        self._request('PUT', f'/backup/{backup_name}')
    
    def export_notes(
        self,
        note_id: str,
        output_file: str,
        format: str = 'html'
    ) -> str:
        """Export notes to ZIP file"""
        content = self._request(
            'GET',
            f'/notes/{note_id}/export',
            params={'format': format}
        )
        
        with open(output_file, 'wb') as f:
            f.write(content)
        
        return output_file
    
    def create_note_revision(self, note_id: str) -> None:
        """Create a revision for a note"""
        self._request('POST', f'/notes/{note_id}/revision')
    
    def refresh_note_ordering(self, parent_note_id: str) -> None:
        """Refresh note ordering"""
        self._request('POST', f'/refresh-note-ordering/{parent_note_id}')

# Helper class for batch operations
class TriliumBatchClient(TriliumClient):
    """Extended client with batch operations"""
    
    def create_notes_batch(
        self,
        notes: List[CreateNoteRequest],
        delay: float = 0.1
    ) -> List[Dict[str, Any]]:
        """Create multiple notes with delay between requests"""
        results = []
        
        for note_req in notes:
            result = self.create_note(**asdict(note_req))
            results.append(result)
            time.sleep(delay)
        
        return results
    
    def add_labels_batch(
        self,
        note_id: str,
        labels: Dict[str, str]
    ) -> List[Attribute]:
        """Add multiple labels to a note"""
        results = []
        
        for name, value in labels.items():
            attr = self.add_label(note_id, name, value)
            results.append(attr)
        
        return results
    
    def search_and_tag(
        self,
        search_query: str,
        tag_name: str,
        tag_value: str = ""
    ) -> List[str]:
        """Search for notes and add a tag to all results"""
        notes = self.search_notes(search_query)
        tagged = []
        
        for note in notes:
            self.add_label(note.noteId, tag_name, tag_value)
            tagged.append(note.noteId)
        
        return tagged

# Context manager for automatic connection handling
class TriliumContext:
    """Context manager for Trilium client"""
    
    def __init__(self, base_url: str, token: str, **kwargs):
        self.base_url = base_url
        self.token = token
        self.kwargs = kwargs
        self.client = None
    
    def __enter__(self) -> TriliumClient:
        self.client = TriliumClient(self.base_url, self.token, **self.kwargs)
        return self.client
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        if self.client and hasattr(self.client, 'session'):
            self.client.session.close()

# Usage examples
if __name__ == "__main__":
    # Basic usage
    client = TriliumClient(
        base_url="http://localhost:8080/etapi",
        token="your-token",
        debug=True
    )
    
    # Create a note
    result = client.create_note(
        parent_note_id="root",
        title="Test Note",
        content="<p>This is a test note</p>",
        note_type=NoteType.TEXT
    )
    print(f"Created note: {result['note']['noteId']}")
    
    # Search notes
    todo_notes = client.search_notes("#todo", limit=10)
    for note in todo_notes:
        print(f"- {note.title}")
    
    # Using context manager
    with TriliumContext("http://localhost:8080/etapi", "your-token") as api:
        inbox = api.get_inbox()
        print(f"Inbox note ID: {inbox.noteId}")
    
    # Batch operations
    batch_client = TriliumBatchClient(
        base_url="http://localhost:8080/etapi",
        token="your-token"
    )
    
    # Tag all notes matching a search
    tagged = batch_client.search_and_tag(
        search_query="type:text",
        tag_name="processed",
        tag_value=datetime.now().isoformat()
    )
    print(f"Tagged {len(tagged)} notes")
```

## Go Client

```go
// trilium_client.go

package trilium

import (
    "bytes"
    "encoding/json"
    "fmt"
    "io"
    "net/http"
    "net/url"
    "time"
)

// Note represents a Trilium note
type Note struct {
    NoteID          string      `json:"noteId"`
    Title           string      `json:"title"`
    Type            string      `json:"type"`
    Mime            string      `json:"mime,omitempty"`
    IsProtected     bool        `json:"isProtected"`
    DateCreated     string      `json:"dateCreated,omitempty"`
    DateModified    string      `json:"dateModified,omitempty"`
    UTCDateCreated  string      `json:"utcDateCreated,omitempty"`
    UTCDateModified string      `json:"utcDateModified,omitempty"`
    Attributes      []Attribute `json:"attributes,omitempty"`
    ParentNoteIDs   []string    `json:"parentNoteIds,omitempty"`
    ChildNoteIDs    []string    `json:"childNoteIds,omitempty"`
}

// CreateNoteRequest represents a request to create a note
type CreateNoteRequest struct {
    ParentNoteID string `json:"parentNoteId"`
    Title        string `json:"title"`
    Type         string `json:"type"`
    Content      string `json:"content"`
    NotePosition int    `json:"notePosition,omitempty"`
    Prefix       string `json:"prefix,omitempty"`
    IsExpanded   bool   `json:"isExpanded,omitempty"`
}

// Attribute represents a note attribute
type Attribute struct {
    AttributeID   string `json:"attributeId,omitempty"`
    NoteID        string `json:"noteId"`
    Type          string `json:"type"`
    Name          string `json:"name"`
    Value         string `json:"value"`
    Position      int    `json:"position,omitempty"`
    IsInheritable bool   `json:"isInheritable,omitempty"`
}

// Branch represents a note branch
type Branch struct {
    BranchID     string `json:"branchId,omitempty"`
    NoteID       string `json:"noteId"`
    ParentNoteID string `json:"parentNoteId"`
    Prefix       string `json:"prefix,omitempty"`
    NotePosition int    `json:"notePosition,omitempty"`
    IsExpanded   bool   `json:"isExpanded,omitempty"`
}

// SearchParams represents search parameters
type SearchParams struct {
    Search               string `url:"search"`
    FastSearch           bool   `url:"fastSearch,omitempty"`
    IncludeArchivedNotes bool   `url:"includeArchivedNotes,omitempty"`
    AncestorNoteID       string `url:"ancestorNoteId,omitempty"`
    AncestorDepth        string `url:"ancestorDepth,omitempty"`
    OrderBy              string `url:"orderBy,omitempty"`
    OrderDirection       string `url:"orderDirection,omitempty"`
    Limit                int    `url:"limit,omitempty"`
    Debug                bool   `url:"debug,omitempty"`
}

// SearchResponse represents search results
type SearchResponse struct {
    Results   []Note                 `json:"results"`
    DebugInfo map[string]interface{} `json:"debugInfo,omitempty"`
}

// Client is the Trilium API client
type Client struct {
    BaseURL    string
    Token      string
    HTTPClient *http.Client
}

// NewClient creates a new Trilium client
func NewClient(baseURL, token string) *Client {
    return &Client{
        BaseURL: baseURL,
        Token:   token,
        HTTPClient: &http.Client{
            Timeout: 30 * time.Second,
        },
    }
}

// request makes an HTTP request to the API
func (c *Client) request(method, endpoint string, body interface{}) (*http.Response, error) {
    url := c.BaseURL + endpoint
    
    var reqBody io.Reader
    if body != nil {
        jsonBody, err := json.Marshal(body)
        if err != nil {
            return nil, fmt.Errorf("failed to marshal request body: %w", err)
        }
        reqBody = bytes.NewBuffer(jsonBody)
    }
    
    req, err := http.NewRequest(method, url, reqBody)
    if err != nil {
        return nil, fmt.Errorf("failed to create request: %w", err)
    }
    
    req.Header.Set("Authorization", c.Token)
    if body != nil {
        req.Header.Set("Content-Type", "application/json")
    }
    
    resp, err := c.HTTPClient.Do(req)
    if err != nil {
        return nil, fmt.Errorf("request failed: %w", err)
    }
    
    if resp.StatusCode >= 400 {
        defer resp.Body.Close()
        bodyBytes, _ := io.ReadAll(resp.Body)
        return nil, fmt.Errorf("API error %d: %s", resp.StatusCode, string(bodyBytes))
    }
    
    return resp, nil
}

// CreateNote creates a new note
func (c *Client) CreateNote(req CreateNoteRequest) (*Note, *Branch, error) {
    resp, err := c.request("POST", "/create-note", req)
    if err != nil {
        return nil, nil, err
    }
    defer resp.Body.Close()
    
    var result struct {
        Note   Note   `json:"note"`
        Branch Branch `json:"branch"`
    }
    
    if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
        return nil, nil, fmt.Errorf("failed to decode response: %w", err)
    }
    
    return &result.Note, &result.Branch, nil
}

// GetNote retrieves a note by ID
func (c *Client) GetNote(noteID string) (*Note, error) {
    resp, err := c.request("GET", fmt.Sprintf("/notes/%s", noteID), nil)
    if err != nil {
        return nil, err
    }
    defer resp.Body.Close()
    
    var note Note
    if err := json.NewDecoder(resp.Body).Decode(&note); err != nil {
        return nil, fmt.Errorf("failed to decode response: %w", err)
    }
    
    return &note, nil
}

// UpdateNote updates a note
func (c *Client) UpdateNote(noteID string, updates map[string]interface{}) (*Note, error) {
    resp, err := c.request("PATCH", fmt.Sprintf("/notes/%s", noteID), updates)
    if err != nil {
        return nil, err
    }
    defer resp.Body.Close()
    
    var note Note
    if err := json.NewDecoder(resp.Body).Decode(&note); err != nil {
        return nil, fmt.Errorf("failed to decode response: %w", err)
    }
    
    return &note, nil
}

// DeleteNote deletes a note
func (c *Client) DeleteNote(noteID string) error {
    resp, err := c.request("DELETE", fmt.Sprintf("/notes/%s", noteID), nil)
    if err != nil {
        return err
    }
    resp.Body.Close()
    return nil
}

// GetNoteContent retrieves note content
func (c *Client) GetNoteContent(noteID string) (string, error) {
    resp, err := c.request("GET", fmt.Sprintf("/notes/%s/content", noteID), nil)
    if err != nil {
        return "", err
    }
    defer resp.Body.Close()
    
    content, err := io.ReadAll(resp.Body)
    if err != nil {
        return "", fmt.Errorf("failed to read response: %w", err)
    }
    
    return string(content), nil
}

// UpdateNoteContent updates note content
func (c *Client) UpdateNoteContent(noteID, content string) error {
    req, err := http.NewRequest("PUT", c.BaseURL+fmt.Sprintf("/notes/%s/content", noteID), bytes.NewBufferString(content))
    if err != nil {
        return fmt.Errorf("failed to create request: %w", err)
    }
    
    req.Header.Set("Authorization", c.Token)
    req.Header.Set("Content-Type", "text/plain")
    
    resp, err := c.HTTPClient.Do(req)
    if err != nil {
        return fmt.Errorf("request failed: %w", err)
    }
    defer resp.Body.Close()
    
    if resp.StatusCode >= 400 {
        bodyBytes, _ := io.ReadAll(resp.Body)
        return fmt.Errorf("API error %d: %s", resp.StatusCode, string(bodyBytes))
    }
    
    return nil
}

// SearchNotes searches for notes
func (c *Client) SearchNotes(params SearchParams) (*SearchResponse, error) {
    query := url.Values{}
    query.Set("search", params.Search)
    
    if params.FastSearch {
        query.Set("fastSearch", "true")
    }
    if params.IncludeArchivedNotes {
        query.Set("includeArchivedNotes", "true")
    }
    if params.AncestorNoteID != "" {
        query.Set("ancestorNoteId", params.AncestorNoteID)
    }
    if params.OrderBy != "" {
        query.Set("orderBy", params.OrderBy)
    }
    if params.OrderDirection != "" {
        query.Set("orderDirection", params.OrderDirection)
    }
    if params.Limit > 0 {
        query.Set("limit", fmt.Sprintf("%d", params.Limit))
    }
    
    resp, err := c.request("GET", fmt.Sprintf("/notes?%s", query.Encode()), nil)
    if err != nil {
        return nil, err
    }
    defer resp.Body.Close()
    
    var searchResp SearchResponse
    if err := json.NewDecoder(resp.Body).Decode(&searchResp); err != nil {
        return nil, fmt.Errorf("failed to decode response: %w", err)
    }
    
    return &searchResp, nil
}

// AddLabel adds a label to a note
func (c *Client) AddLabel(noteID, name, value string) (*Attribute, error) {
    attr := Attribute{
        NoteID: noteID,
        Type:   "label",
        Name:   name,
        Value:  value,
    }
    
    resp, err := c.request("POST", "/attributes", attr)
    if err != nil {
        return nil, err
    }
    defer resp.Body.Close()
    
    var result Attribute
    if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
        return nil, fmt.Errorf("failed to decode response: %w", err)
    }
    
    return &result, nil
}

// Usage example
func Example() {
    client := NewClient("http://localhost:8080/etapi", "your-token")
    
    // Create a note
    note, branch, err := client.CreateNote(CreateNoteRequest{
        ParentNoteID: "root",
        Title:        "Test Note",
        Type:         "text",
        Content:      "<p>Hello from Go!</p>",
    })
    
    if err != nil {
        panic(err)
    }
    
    fmt.Printf("Created note %s with branch %s\n", note.NoteID, branch.BranchID)
    
    // Search notes
    results, err := client.SearchNotes(SearchParams{
        Search: "#todo",
        Limit:  10,
    })
    
    if err != nil {
        panic(err)
    }
    
    fmt.Printf("Found %d todo notes\n", len(results.Results))
}
```

## REST Client Best Practices

### 1\. Connection Management

```python
# Python - Connection pooling with requests
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

class RobustTriliumClient:
    def __init__(self, base_url, token):
        self.base_url = base_url
        self.token = token
        
        # Configure connection pooling and retries
        self.session = requests.Session()
        
        retry_strategy = Retry(
            total=3,
            backoff_factor=1,
            status_forcelist=[429, 500, 502, 503, 504],
            allowed_methods=["HEAD", "GET", "PUT", "DELETE", "OPTIONS", "TRACE", "POST"]
        )
        
        adapter = HTTPAdapter(
            max_retries=retry_strategy,
            pool_connections=10,
            pool_maxsize=10
        )
        
        self.session.mount("http://", adapter)
        self.session.mount("https://", adapter)
        
        self.session.headers.update({
            'Authorization': token,
            'Content-Type': 'application/json'
        })
```

### 2\. Request Timeout Handling

```javascript
// JavaScript - Timeout with abort controller
class TimeoutClient {
    constructor(baseUrl, token, timeout = 30000) {
        this.baseUrl = baseUrl;
        this.token = token;
        this.timeout = timeout;
    }
    
    async request(endpoint, options = {}) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);
        
        try {
            const response = await fetch(`${this.baseUrl}${endpoint}`, {
                ...options,
                headers: {
                    'Authorization': this.token,
                    ...options.headers
                },
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            return response.json();
        } catch (error) {
            if (error.name === 'AbortError') {
                throw new Error(`Request timeout after ${this.timeout}ms`);
            }
            throw error;
        } finally {
            clearTimeout(timeoutId);
        }
    }
}
```

### 3\. Rate Limiting

```python
# Python - Rate limiting with token bucket
import time
from threading import Lock

class RateLimitedClient:
    def __init__(self, base_url, token, requests_per_second=10):
        self.base_url = base_url
        self.token = token
        self.rate_limit = requests_per_second
        self.tokens = requests_per_second
        self.last_update = time.time()
        self.lock = Lock()
    
    def _wait_for_token(self):
        with self.lock:
            now = time.time()
            elapsed = now - self.last_update
            self.tokens = min(
                self.rate_limit,
                self.tokens + elapsed * self.rate_limit
            )
            self.last_update = now
            
            if self.tokens < 1:
                sleep_time = (1 - self.tokens) / self.rate_limit
                time.sleep(sleep_time)
                self.tokens = 1
            
            self.tokens -= 1
    
    def request(self, method, endpoint, **kwargs):
        self._wait_for_token()
        # Make actual request here
        return self._make_request(method, endpoint, **kwargs)
```

### 4\. Caching

```typescript
// TypeScript - Response caching
interface CacheEntry<T> {
    data: T;
    timestamp: number;
    ttl: number;
}

class CachedTriliumClient extends TriliumClient {
    private cache = new Map<string, CacheEntry<any>>();
    private defaultTTL = 5 * 60 * 1000; // 5 minutes
    
    private getCacheKey(method: string, endpoint: string, params?: any): string {
        return `${method}:${endpoint}:${JSON.stringify(params || {})}`;
    }
    
    private isExpired(entry: CacheEntry<any>): boolean {
        return Date.now() - entry.timestamp > entry.ttl;
    }
    
    async cachedRequest<T>(
        method: string,
        endpoint: string,
        options: {
            params?: any;
            ttl?: number;
            forceRefresh?: boolean;
        } = {}
    ): Promise<T> {
        const key = this.getCacheKey(method, endpoint, options.params);
        
        // Check cache for GET requests
        if (method === 'GET' && !options.forceRefresh) {
            const cached = this.cache.get(key);
            if (cached && !this.isExpired(cached)) {
                return cached.data;
            }
        }
        
        // Make request
        const data = await this.request(endpoint, {
            method,
            params: options.params
        });
        
        // Cache GET responses
        if (method === 'GET') {
            this.cache.set(key, {
                data,
                timestamp: Date.now(),
                ttl: options.ttl || this.defaultTTL
            });
        }
        
        return data;
    }
    
    clearCache(pattern?: string): void {
        if (pattern) {
            for (const key of this.cache.keys()) {
                if (key.includes(pattern)) {
                    this.cache.delete(key);
                }
            }
        } else {
            this.cache.clear();
        }
    }
}
```

## Error Handling Patterns

### Comprehensive Error Handling

```python
# Python - Detailed error handling
class TriliumAPIError(Exception):
    """Base exception for API errors"""
    def __init__(self, message, status_code=None, response_data=None):
        super().__init__(message)
        self.status_code = status_code
        self.response_data = response_data

class TriliumValidationError(TriliumAPIError):
    """Validation error (400)"""
    pass

class TriliumAuthenticationError(TriliumAPIError):
    """Authentication error (401)"""
    pass

class TriliumPermissionError(TriliumAPIError):
    """Permission error (403)"""
    pass

class TriliumNotFoundError(TriliumAPIError):
    """Resource not found (404)"""
    pass

class TriliumRateLimitError(TriliumAPIError):
    """Rate limit exceeded (429)"""
    pass

class TriliumServerError(TriliumAPIError):
    """Server error (5xx)"""
    pass

def handle_api_error(response):
    """Handle API error responses"""
    try:
        error_data = response.json()
        message = error_data.get('message', response.reason)
    except:
        message = response.reason
        error_data = None
    
    status_code = response.status_code
    
    if status_code == 400:
        raise TriliumValidationError(message, status_code, error_data)
    elif status_code == 401:
        raise TriliumAuthenticationError(message, status_code, error_data)
    elif status_code == 403:
        raise TriliumPermissionError(message, status_code, error_data)
    elif status_code == 404:
        raise TriliumNotFoundError(message, status_code, error_data)
    elif status_code == 429:
        raise TriliumRateLimitError(message, status_code, error_data)
    elif status_code >= 500:
        raise TriliumServerError(message, status_code, error_data)
    else:
        raise TriliumAPIError(message, status_code, error_data)

# Usage
try:
    note = client.get_note('invalid_id')
except TriliumNotFoundError as e:
    print(f"Note not found: {e}")
except TriliumAuthenticationError as e:
    print(f"Authentication failed: {e}")
    # Refresh token or re-authenticate
except TriliumServerError as e:
    print(f"Server error: {e}")
    # Retry after delay
except TriliumAPIError as e:
    print(f"API error ({e.status_code}): {e}")
```

## Retry Strategies

### Exponential Backoff

```javascript
// JavaScript - Exponential backoff with jitter
class RetryClient {
    constructor(baseUrl, token, maxRetries = 3) {
        this.baseUrl = baseUrl;
        this.token = token;
        this.maxRetries = maxRetries;
    }
    
    async requestWithRetry(endpoint, options = {}, attempt = 0) {
        try {
            const response = await fetch(`${this.baseUrl}${endpoint}`, {
                ...options,
                headers: {
                    'Authorization': this.token,
                    ...options.headers
                }
            });
            
            if (response.status >= 500 && attempt < this.maxRetries) {
                throw new Error(`Server error: ${response.status}`);
            }
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || `HTTP ${response.status}`);
            }
            
            return response.json();
            
        } catch (error) {
            if (attempt >= this.maxRetries) {
                throw error;
            }
            
            // Calculate delay with exponential backoff and jitter
            const baseDelay = Math.pow(2, attempt) * 1000;
            const jitter = Math.random() * 1000;
            const delay = baseDelay + jitter;
            
            console.log(`Retry attempt ${attempt + 1} after ${delay}ms`);
            
            await new Promise(resolve => setTimeout(resolve, delay));
            
            return this.requestWithRetry(endpoint, options, attempt + 1);
        }
    }
}
```

### Circuit Breaker Pattern

```python
# Python - Circuit breaker implementation
import time
from enum import Enum
from threading import Lock

class CircuitState(Enum):
    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"

class CircuitBreaker:
    def __init__(
        self,
        failure_threshold=5,
        recovery_timeout=60,
        expected_exception=Exception
    ):
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.expected_exception = expected_exception
        
        self.failure_count = 0
        self.last_failure_time = None
        self.state = CircuitState.CLOSED
        self.lock = Lock()
    
    def call(self, func, *args, **kwargs):
        with self.lock:
            if self.state == CircuitState.OPEN:
                if time.time() - self.last_failure_time > self.recovery_timeout:
                    self.state = CircuitState.HALF_OPEN
                else:
                    raise Exception("Circuit breaker is OPEN")
        
        try:
            result = func(*args, **kwargs)
            with self.lock:
                self.on_success()
            return result
        except self.expected_exception as e:
            with self.lock:
                self.on_failure()
            raise e
    
    def on_success(self):
        self.failure_count = 0
        self.state = CircuitState.CLOSED
    
    def on_failure(self):
        self.failure_count += 1
        self.last_failure_time = time.time()
        
        if self.failure_count >= self.failure_threshold:
            self.state = CircuitState.OPEN

class CircuitBreakerClient(TriliumClient):
    def __init__(self, base_url, token):
        super().__init__(base_url, token)
        self.circuit_breaker = CircuitBreaker(
            failure_threshold=5,
            recovery_timeout=60,
            expected_exception=TriliumConnectionError
        )
    
    def _request(self, method, endpoint, **kwargs):
        return self.circuit_breaker.call(
            super()._request,
            method,
            endpoint,
            **kwargs
        )
```

## Testing Client Libraries

### Unit Testing

```python
# Python - Unit tests with mocking
import unittest
from unittest.mock import Mock, patch, MagicMock
import json

class TestTriliumClient(unittest.TestCase):
    def setUp(self):
        self.client = TriliumClient(
            base_url="http://localhost:8080/etapi",
            token="test-token"
        )
    
    @patch('requests.Session.request')
    def test_create_note(self, mock_request):
        # Mock response
        mock_response = Mock()
        mock_response.status_code = 201
        mock_response.json.return_value = {
            'note': {
                'noteId': 'test123',
                'title': 'Test Note',
                'type': 'text'
            },
            'branch': {
                'branchId': 'branch123',
                'noteId': 'test123',
                'parentNoteId': 'root'
            }
        }
        mock_request.return_value = mock_response
        
        # Test create note
        result = self.client.create_note(
            parent_note_id='root',
            title='Test Note',
            content='<p>Test content</p>'
        )
        
        # Assertions
        self.assertEqual(result['note']['noteId'], 'test123')
        self.assertEqual(result['note']['title'], 'Test Note')
        
        # Verify request was made correctly
        mock_request.assert_called_once()
        call_args = mock_request.call_args
        self.assertEqual(call_args[1]['method'], 'POST')
        self.assertEqual(call_args[1]['url'], 'http://localhost:8080/etapi/create-note')
    
    @patch('requests.Session.request')
    def test_search_notes(self, mock_request):
        # Mock response
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            'results': [
                {'noteId': 'note1', 'title': 'Note 1'},
                {'noteId': 'note2', 'title': 'Note 2'}
            ]
        }
        mock_request.return_value = mock_response
        
        # Test search
        results = self.client.search_notes('#todo', limit=10)
        
        # Assertions
        self.assertEqual(len(results), 2)
        self.assertEqual(results[0].noteId, 'note1')
        
    @patch('requests.Session.request')
    def test_error_handling(self, mock_request):
        # Mock error response
        mock_response = Mock()
        mock_response.status_code = 404
        mock_response.json.return_value = {
            'status': 404,
            'code': 'NOTE_NOT_FOUND',
            'message': 'Note not found'
        }
        mock_request.return_value = mock_response
        
        # Test error handling
        with self.assertRaises(TriliumNotFoundError) as context:
            self.client.get_note('invalid_id')
        
        self.assertEqual(context.exception.status_code, 404)
        self.assertIn('Note not found', str(context.exception))

class TestRetryLogic(unittest.TestCase):
    @patch('time.sleep')
    @patch('requests.Session.request')
    def test_retry_on_server_error(self, mock_request, mock_sleep):
        client = TriliumClient(
            base_url="http://localhost:8080/etapi",
            token="test-token",
            retry_attempts=3
        )
        
        # Mock server error then success
        mock_response_error = Mock()
        mock_response_error.status_code = 500
        
        mock_response_success = Mock()
        mock_response_success.status_code = 200
        mock_response_success.json.return_value = {'noteId': 'test123'}
        
        mock_request.side_effect = [
            mock_response_error,
            mock_response_error,
            mock_response_success
        ]
        
        # Should succeed after retries
        result = client.get_note('test123')
        self.assertEqual(result.noteId, 'test123')
        
        # Verify retries happened
        self.assertEqual(mock_request.call_count, 3)
        self.assertEqual(mock_sleep.call_count, 2)

if __name__ == '__main__':
    unittest.main()
```

### Integration Testing

```javascript
// JavaScript - Integration tests with Jest
describe('TriliumClient Integration Tests', () => {
    let client;
    let testNoteId;
    
    beforeAll(() => {
        client = new TriliumClient({
            baseUrl: process.env.TRILIUM_URL || 'http://localhost:8080/etapi',
            token: process.env.TRILIUM_TOKEN || 'test-token'
        });
    });
    
    afterAll(async () => {
        // Cleanup test notes
        if (testNoteId) {
            await client.deleteNote(testNoteId);
        }
    });
    
    test('should create and retrieve a note', async () => {
        // Create note
        const createResult = await client.createNote({
            parentNoteId: 'root',
            title: 'Integration Test Note',
            type: 'text',
            content: '<p>Test content</p>'
        });
        
        expect(createResult.note).toBeDefined();
        expect(createResult.note.title).toBe('Integration Test Note');
        
        testNoteId = createResult.note.noteId;
        
        // Retrieve note
        const note = await client.getNote(testNoteId);
        expect(note.noteId).toBe(testNoteId);
        expect(note.title).toBe('Integration Test Note');
    });
    
    test('should update note content', async () => {
        const newContent = '<p>Updated content</p>';
        
        await client.updateNoteContent(testNoteId, newContent);
        
        const content = await client.getNoteContent(testNoteId);
        expect(content).toBe(newContent);
    });
    
    test('should add and retrieve attributes', async () => {
        // Add label
        const attribute = await client.createAttribute({
            noteId: testNoteId,
            type: 'label',
            name: 'testLabel',
            value: 'testValue'
        });
        
        expect(attribute.attributeId).toBeDefined();
        
        // Retrieve note with attributes
        const note = await client.getNote(testNoteId);
        const label = note.attributes.find(a => a.name === 'testLabel');
        
        expect(label).toBeDefined();
        expect(label.value).toBe('testValue');
    });
    
    test('should search notes', async () => {
        // Add searchable label
        await client.createAttribute({
            noteId: testNoteId,
            type: 'label',
            name: 'integrationTest',
            value: ''
        });
        
        // Search
        const results = await client.searchNotes({
            search: '#integrationTest',
            limit: 10
        });
        
        expect(results.results).toBeDefined();
        expect(results.results.length).toBeGreaterThan(0);
        
        const foundNote = results.results.find(n => n.noteId === testNoteId);
        expect(foundNote).toBeDefined();
    });
});
```

## Conclusion

These client libraries provide robust, production-ready implementations for interacting with the Trilium API. Key considerations:

1.  **Choose the right language** for your use case and environment
2.  **Implement proper error handling** with specific exception types
3.  **Use connection pooling** for better performance
4.  **Add retry logic** for resilience against transient failures
5.  **Consider rate limiting** to avoid overwhelming the server
6.  **Cache responses** when appropriate to reduce API calls
7.  **Write comprehensive tests** for reliability
8.  **Document your client** with clear examples

For additional resources:

*   [ETAPI Complete Guide](ETAPI%20Complete%20Guide.md)
*   [WebSocket API Documentation](WebSocket%20API.md)
*   [Script API Cookbook](Script%20API%20Cookbook.md)