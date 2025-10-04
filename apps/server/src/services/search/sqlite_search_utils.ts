/**
 * SQLite Search Utilities
 * 
 * Helper functions and utilities for SQLite-based search operations.
 * These utilities provide common functionality needed by the search service
 * and help with data preparation, validation, and performance monitoring.
 */

import sql from "../sql.js";
import log from "../log.js";
import { normalize, stripTags } from "../utils.js";

/**
 * Configuration for search utilities
 */
export const SEARCH_UTILS_CONFIG = {
    BATCH_SIZE: 1000,
    MAX_CONTENT_SIZE: 2 * 1024 * 1024, // 2MB
    MIN_TOKEN_LENGTH: 2,
    MAX_TOKEN_LENGTH: 100,
    LOG_SLOW_QUERIES: true,
    SLOW_QUERY_THRESHOLD: 100, // ms
} as const;

/**
 * Interface for note content data
 */
export interface NoteContentData {
    noteId: string;
    title: string;
    content: string;
    type: string;
    mime: string;
    isProtected: boolean;
    isDeleted: boolean;
}

/**
 * Normalize text for search indexing
 * Ensures consistent normalization across all search operations
 */
export function normalizeForSearch(text: string | null | undefined): string {
    if (!text || typeof text !== 'string') {
        return '';
    }
    
    // Use the standard normalize function and convert to lowercase
    return normalize(text).toLowerCase();
}

/**
 * Tokenize text into searchable words
 * Handles camelCase, snake_case, and special characters
 */
export function tokenizeText(text: string | null | undefined): string[] {
    if (!text || typeof text !== 'string') {
        return [];
    }

    const tokens = new Set<string>();
    
    // Split on word boundaries
    const words = text
        .split(/[\s\n\r\t,;.!?()[\]{}"'`~@#$%^&*+=|\\/<>:-]+/)
        .filter(word => word.length >= SEARCH_UTILS_CONFIG.MIN_TOKEN_LENGTH &&
                       word.length <= SEARCH_UTILS_CONFIG.MAX_TOKEN_LENGTH);
    
    for (const word of words) {
        // Add the original word (lowercase)
        tokens.add(word.toLowerCase());
        
        // Handle snake_case
        const snakeParts = word.split('_').filter(part => part.length > 0);
        if (snakeParts.length > 1) {
            for (const part of snakeParts) {
                tokens.add(part.toLowerCase());
                
                // Also handle camelCase within snake_case parts
                const camelParts = splitCamelCase(part);
                for (const camelPart of camelParts) {
                    if (camelPart.length >= SEARCH_UTILS_CONFIG.MIN_TOKEN_LENGTH) {
                        tokens.add(camelPart.toLowerCase());
                    }
                }
            }
        } else {
            // Handle camelCase
            const camelParts = splitCamelCase(word);
            for (const part of camelParts) {
                if (part.length >= SEARCH_UTILS_CONFIG.MIN_TOKEN_LENGTH) {
                    tokens.add(part.toLowerCase());
                }
            }
        }
    }
    
    return Array.from(tokens);
}

/**
 * Split camelCase strings into parts
 */
function splitCamelCase(str: string): string[] {
    // Split on transitions from lowercase to uppercase
    // Also handle sequences of uppercase letters (e.g., "XMLParser" -> ["XML", "Parser"])
    return str.split(/(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/);
}

/**
 * Process HTML content for indexing
 * Removes tags and normalizes the text
 */
export function processHtmlContent(html: string | null | undefined): string {
    if (!html || typeof html !== 'string') {
        return '';
    }
    
    // Remove script and style content
    let text = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
    
    // Strip remaining tags
    text = stripTags(text);
    
    // Decode HTML entities
    text = text.replace(/&nbsp;/g, ' ');
    text = text.replace(/&lt;/g, '<');
    text = text.replace(/&gt;/g, '>');
    text = text.replace(/&amp;/g, '&');
    text = text.replace(/&quot;/g, '"');
    text = text.replace(/&#39;/g, "'");
    text = text.replace(/&apos;/g, "'");
    
    // Normalize whitespace
    text = text.replace(/\s+/g, ' ').trim();
    
    return text;
}

/**
 * Process JSON content (e.g., mindmaps, canvas) for indexing
 */
export function processJsonContent(json: string | null | undefined, type: string): string {
    if (!json || typeof json !== 'string') {
        return '';
    }
    
    try {
        const data = JSON.parse(json);
        
        if (type === 'mindMap') {
            return extractMindMapText(data);
        } else if (type === 'canvas') {
            return extractCanvasText(data);
        }
        
        // For other JSON types, try to extract text content
        return extractTextFromObject(data);
    } catch (error) {
        log.info(`Failed to process JSON content: ${error}`);
        return '';
    }
}

/**
 * Extract text from mindmap JSON structure
 */
function extractMindMapText(data: any): string {
    const texts: string[] = [];
    
    function collectTopics(node: any): void {
        if (!node) return;
        
        if (node.topic) {
            texts.push(node.topic);
        }
        
        if (node.children && Array.isArray(node.children)) {
            for (const child of node.children) {
                collectTopics(child);
            }
        }
    }
    
    if (data.nodedata) {
        collectTopics(data.nodedata);
    }
    
    return texts.join(' ');
}

/**
 * Extract text from canvas JSON structure
 */
function extractCanvasText(data: any): string {
    const texts: string[] = [];
    
    if (data.elements && Array.isArray(data.elements)) {
        for (const element of data.elements) {
            if (element.type === 'text' && element.text) {
                texts.push(element.text);
            }
        }
    }
    
    return texts.join(' ');
}

/**
 * Generic text extraction from JSON objects
 */
function extractTextFromObject(obj: any, maxDepth = 10): string {
    if (maxDepth <= 0) return '';
    
    const texts: string[] = [];
    
    if (typeof obj === 'string') {
        return obj;
    } else if (Array.isArray(obj)) {
        for (const item of obj) {
            const text = extractTextFromObject(item, maxDepth - 1);
            if (text) texts.push(text);
        }
    } else if (typeof obj === 'object' && obj !== null) {
        for (const key of Object.keys(obj)) {
            // Look for common text field names
            if (['text', 'content', 'value', 'title', 'name', 'label', 'description'].includes(key.toLowerCase())) {
                const value = obj[key];
                if (typeof value === 'string') {
                    texts.push(value);
                }
            } else {
                const text = extractTextFromObject(obj[key], maxDepth - 1);
                if (text) texts.push(text);
            }
        }
    }
    
    return texts.join(' ');
}

/**
 * Prepare note content for indexing
 * Handles different note types and formats
 */
export function prepareNoteContent(note: NoteContentData): {
    normalizedContent: string;
    normalizedTitle: string;
    tokens: string[];
} {
    let content = note.content;
    
    // Process content based on type
    if (note.type === 'text' && note.mime === 'text/html') {
        content = processHtmlContent(content);
    } else if ((note.type === 'mindMap' || note.type === 'canvas') && note.mime === 'application/json') {
        content = processJsonContent(content, note.type);
    }
    
    // Check content size
    if (content.length > SEARCH_UTILS_CONFIG.MAX_CONTENT_SIZE) {
        log.info(`Note ${note.noteId} content exceeds max size (${content.length} bytes), truncating`);
        content = content.substring(0, SEARCH_UTILS_CONFIG.MAX_CONTENT_SIZE);
    }
    
    // Normalize content and title
    const normalizedContent = normalizeForSearch(content);
    const normalizedTitle = normalizeForSearch(note.title);
    
    // Generate tokens from both content and title
    const allText = `${note.title} ${content}`;
    const tokens = tokenizeText(allText);
    
    return {
        normalizedContent,
        normalizedTitle,
        tokens
    };
}

/**
 * Update search index for a single note
 */
export async function updateNoteSearchIndex(noteId: string): Promise<void> {
    try {
        // Get note data
        const noteData = sql.getRow<NoteContentData>(`
            SELECT n.noteId, n.title, b.content, n.type, n.mime, n.isProtected, n.isDeleted
            FROM notes n
            LEFT JOIN blobs b ON n.blobId = b.blobId
            WHERE n.noteId = ?
        `, [noteId]);
        
        if (!noteData) {
            log.info(`Note ${noteId} not found for indexing`);
            return;
        }
        
        // Prepare content for indexing
        const { normalizedContent, normalizedTitle, tokens } = prepareNoteContent(noteData);
        
        // Update search content table
        // Note: note_search_content doesn't have isProtected/isDeleted columns
        // Those are in the notes table which we join with
        sql.execute(`
            INSERT OR REPLACE INTO note_search_content 
            (noteId, title, content, title_normalized, content_normalized, full_text_normalized)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [noteId, noteData.title, noteData.content || '', 
            normalizedTitle, normalizedContent, 
            normalizedTitle + ' ' + normalizedContent]);
        
        // Delete existing tokens for this note
        sql.execute(`DELETE FROM note_tokens WHERE noteId = ?`, [noteId]);
        
        // Insert new tokens with proper structure
        let position = 0;
        for (const token of tokens) {
            sql.execute(`
                INSERT INTO note_tokens (noteId, token, token_normalized, position, source)
                VALUES (?, ?, ?, ?, 'content')
            `, [noteId, token, normalizeForSearch(token), position]);
            position++;
        }
        
        log.info(`Updated search index for note ${noteId}`);
    } catch (error) {
        log.error(`Failed to update search index for note ${noteId}: ${error}`);
        throw error;
    }
}

/**
 * Batch update search index for multiple notes
 */
export async function batchUpdateSearchIndex(noteIds: string[]): Promise<void> {
    const startTime = Date.now();
    let successCount = 0;
    let errorCount = 0;
    
    // Process in batches
    for (let i = 0; i < noteIds.length; i += SEARCH_UTILS_CONFIG.BATCH_SIZE) {
        const batch = noteIds.slice(i, i + SEARCH_UTILS_CONFIG.BATCH_SIZE);
        
        try {
            sql.transactional(() => {
                for (const noteId of batch) {
                    try {
                        updateNoteSearchIndex(noteId);
                        successCount++;
                    } catch (error) {
                        log.error(`Failed to index note ${noteId}: ${error}`);
                        errorCount++;
                    }
                }
            });
        } catch (error) {
            log.error(`Batch indexing failed: ${error}`);
            errorCount += batch.length;
        }
    }
    
    const elapsed = Date.now() - startTime;
    log.info(`Batch search indexing completed: ${successCount} success, ${errorCount} errors, ${elapsed}ms`);
}

/**
 * Verify search index integrity
 */
export function verifySearchIndex(): {
    valid: boolean;
    issues: string[];
    stats: {
        totalNotes: number;
        indexedNotes: number;
        missingFromIndex: number;
        orphanedEntries: number;
    };
} {
    const issues: string[] = [];
    
    // Count total notes
    const totalNotes = sql.getValue<number>(`
        SELECT COUNT(*) FROM notes WHERE isDeleted = 0
    `) || 0;
    
    // Count indexed notes - JOIN with notes table for isDeleted filter
    const indexedNotes = sql.getValue<number>(`
        SELECT COUNT(DISTINCT nsc.noteId) 
        FROM note_search_content nsc
        JOIN notes n ON nsc.noteId = n.noteId
        WHERE n.isDeleted = 0
    `) || 0;
    
    // Find notes missing from index
    const missingNotes = sql.getColumn<string>(`
        SELECT noteId FROM notes 
        WHERE isDeleted = 0 
        AND noteId NOT IN (SELECT noteId FROM note_search_content)
    `);
    
    if (missingNotes.length > 0) {
        issues.push(`${missingNotes.length} notes missing from search index`);
    }
    
    // Find orphaned index entries
    const orphanedEntries = sql.getColumn<string>(`
        SELECT noteId FROM note_search_content 
        WHERE noteId NOT IN (SELECT noteId FROM notes)
    `);
    
    if (orphanedEntries.length > 0) {
        issues.push(`${orphanedEntries.length} orphaned entries in search index`);
    }
    
    // Check token table consistency
    const tokenMismatch = sql.getValue<number>(`
        SELECT COUNT(*) FROM note_search_content 
        WHERE noteId NOT IN (SELECT noteId FROM note_tokens)
    `) || 0;
    
    if (tokenMismatch > 0) {
        issues.push(`${tokenMismatch} notes missing from token index`);
    }
    
    return {
        valid: issues.length === 0,
        issues,
        stats: {
            totalNotes,
            indexedNotes,
            missingFromIndex: missingNotes.length,
            orphanedEntries: orphanedEntries.length
        }
    };
}

/**
 * Performance monitoring wrapper for search queries
 */
export function monitorQuery<T>(
    queryName: string,
    queryFn: () => T
): T {
    const startTime = Date.now();
    
    try {
        const result = queryFn();
        
        const elapsed = Date.now() - startTime;
        if (SEARCH_UTILS_CONFIG.LOG_SLOW_QUERIES && elapsed > SEARCH_UTILS_CONFIG.SLOW_QUERY_THRESHOLD) {
            log.info(`Slow search query detected: ${queryName} took ${elapsed}ms`);
        }
        
        return result;
    } catch (error) {
        const elapsed = Date.now() - startTime;
        log.error(`Search query failed: ${queryName} after ${elapsed}ms - ${error}`);
        throw error;
    }
}

/**
 * Export utility functions for testing
 */
export const testUtils = {
    splitCamelCase,
    extractMindMapText,
    extractCanvasText,
    extractTextFromObject
};