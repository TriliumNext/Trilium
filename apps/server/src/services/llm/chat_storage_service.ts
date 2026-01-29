import notes from '../notes.js';
import sql from '../sql.js';
import attributes from '../attributes.js';
import type { Message } from './ai_interface.js';
import type { ToolCall } from './tools/tool_interfaces.js';
import { t } from 'i18next';
import log from '../log.js';

export interface StoredChat {
    id: string;
    title: string;
    messages: Message[];
    noteId?: string;
    createdAt: Date;
    updatedAt: Date;
    metadata?: ChatMetadata;
}

interface ChatMetadata {
    sources?: Array<{
        noteId: string;
        title: string;
        similarity?: number;
        path?: string;
        branchId?: string;
        content?: string;
    }>;
    model?: string;
    provider?: string;
    contextNoteId?: string;
    toolExecutions?: Array<ToolExecution>;
    usage?: {
        promptTokens?: number;
        completionTokens?: number;
        totalTokens?: number;
    };
    temperature?: number;
    maxTokens?: number;
}

interface ToolExecution {
    id: string;
    name: string;
    arguments: Record<string, any> | string;
    result: string | Record<string, any>;
    error?: string;
    timestamp: Date;
    executionTime?: number;
}

/**
 * Service for storing and retrieving chat histories
 * Chats are stored as a special type of note
 */
export class ChatStorageService {
    private static readonly CHAT_LABEL = 'triliumChat';
    private static readonly CHAT_ROOT_LABEL = 'triliumChatRoot';
    private static readonly CHAT_TYPE = 'code';
    private static readonly CHAT_MIME = 'application/json';

    /**
     * Get or create the root note for all chats
     */
    async getOrCreateChatRoot(): Promise<string> {
        const existingRoot = await sql.getRow<{noteId: string}>(
            `SELECT noteId FROM attributes WHERE name = ? AND value = ?`,
            ['label', ChatStorageService.CHAT_ROOT_LABEL]
        );

        if (existingRoot) {
            return existingRoot.noteId;
        }

        // Create root note for chats
        const { note } = notes.createNewNote({
            parentNoteId: 'root',
            title: t('ai.chat.root_note_title'),
            type: 'text',
            content: t('ai.chat.root_note_content')
        });

        attributes.createLabel(
            note.noteId,
            ChatStorageService.CHAT_ROOT_LABEL,
            ''
        );

        return note.noteId;
    }

    /**
     * Create a new chat
     */
    async createChat(title: string, messages: Message[] = [], metadata?: ChatMetadata): Promise<StoredChat> {
        const rootNoteId = await this.getOrCreateChatRoot();
        const now = new Date();

        const { note } = notes.createNewNote({
            parentNoteId: rootNoteId,
            title: title || t('ai.chat.new_chat_title') + ' ' + now.toLocaleString(),
            type: ChatStorageService.CHAT_TYPE,
            mime: ChatStorageService.CHAT_MIME,
            content: JSON.stringify({
                messages,
                metadata: metadata || {},
                createdAt: now,
                updatedAt: now
            }, null, 2)
        });

        attributes.createLabel(
            note.noteId,
            ChatStorageService.CHAT_LABEL,
            ''
        );

        return {
            id: note.noteId,
            title: title || t('ai.chat.new_chat_title') + ' ' + now.toLocaleString(),
            messages,
            noteId: note.noteId,
            createdAt: now,
            updatedAt: now,
            metadata: metadata || {}
        };
    }

    /**
     * Get all chats (excludes soft-deleted chats)
     */
    async getAllChats(): Promise<StoredChat[]> {
        const chats = await sql.getRows<{noteId: string, title: string, dateCreated: string, dateModified: string, content: string}>(
            `SELECT notes.noteId, notes.title, notes.dateCreated, notes.dateModified, blobs.content
             FROM notes
             JOIN blobs ON notes.blobId = blobs.blobId
             JOIN attributes ON notes.noteId = attributes.noteId
             WHERE attributes.name = ? AND attributes.value = ?
             AND notes.isDeleted = 0
             ORDER BY notes.dateModified DESC`,
            ['label', ChatStorageService.CHAT_LABEL]
        );

        return chats.map(chat => {
            let messages: Message[] = [];
            let metadata: ChatMetadata = {};
            let createdAt = new Date(chat.dateCreated);
            let updatedAt = new Date(chat.dateModified);

            try {
                const content = JSON.parse(chat.content);
                messages = content.messages || [];
                metadata = content.metadata || {};

                // Use stored dates if available
                if (content.createdAt) {
                    createdAt = new Date(content.createdAt);
                }
                if (content.updatedAt) {
                    updatedAt = new Date(content.updatedAt);
                }
            } catch (e) {
                console.error('Failed to parse chat content:', e);
            }

            return {
                id: chat.noteId,
                title: chat.title,
                messages,
                noteId: chat.noteId,
                createdAt,
                updatedAt,
                metadata
            };
        });
    }

    /**
     * Get a specific chat (returns null if not found or soft-deleted)
     */
    async getChat(chatId: string): Promise<StoredChat | null> {
        const chat = await sql.getRow<{noteId: string, title: string, dateCreated: string, dateModified: string, content: string}>(
            `SELECT notes.noteId, notes.title, notes.dateCreated, notes.dateModified, blobs.content
             FROM notes
             JOIN blobs ON notes.blobId = blobs.blobId
             WHERE notes.noteId = ? AND notes.isDeleted = 0`,
            [chatId]
        );

        if (!chat) {
            return null;
        }

        let messages: Message[] = [];
        let metadata: ChatMetadata = {};
        let createdAt = new Date(chat.dateCreated);
        let updatedAt = new Date(chat.dateModified);

        try {
            const content = JSON.parse(chat.content);
            messages = content.messages || [];
            metadata = content.metadata || {};

            // Use stored dates if available
            if (content.createdAt) {
                createdAt = new Date(content.createdAt);
            }
            if (content.updatedAt) {
                updatedAt = new Date(content.updatedAt);
            }
        } catch (e) {
            console.error('Failed to parse chat content:', e);
        }

        return {
            id: chat.noteId,
            title: chat.title,
            messages,
            noteId: chat.noteId,
            createdAt,
            updatedAt,
            metadata
        };
    }

    /**
     * Update messages in a chat
     */
    async updateChat(
        chatId: string,
        messages: Message[],
        title?: string,
        metadata?: ChatMetadata
    ): Promise<StoredChat | null> {
        const chat = await this.getChat(chatId);

        if (!chat) {
            return null;
        }

        const now = new Date();
        const updatedMetadata = {...(chat.metadata || {}), ...(metadata || {})};

        // Extract and store tool calls from the messages
        const toolExecutions = this.extractToolExecutionsFromMessages(messages, updatedMetadata.toolExecutions || []);
        if (toolExecutions.length > 0) {
            updatedMetadata.toolExecutions = toolExecutions;
        }

        // Update content directly using SQL since we don't have a method for this in the notes service
        await sql.execute(
            `UPDATE blobs SET content = ? WHERE blobId = (SELECT blobId FROM notes WHERE noteId = ?)`,
            [JSON.stringify({
                messages,
                metadata: updatedMetadata,
                createdAt: chat.createdAt,
                updatedAt: now
            }, null, 2), chatId]
        );

        // Update title if provided
        if (title && title !== chat.title) {
            await sql.execute(
                `UPDATE notes SET title = ? WHERE noteId = ?`,
                [title, chatId]
            );
        }

        return {
            ...chat,
            title: title || chat.title,
            messages,
            updatedAt: now,
            metadata: updatedMetadata
        };
    }

    /**
     * Delete a chat
     */
    async deleteChat(chatId: string): Promise<boolean> {
        try {
            // Mark note as deleted using SQL since we don't have deleteNote in the exports
            await sql.execute(
                `UPDATE notes SET isDeleted = 1 WHERE noteId = ?`,
                [chatId]
            );

            return true;
        } catch (e) {
            console.error('Failed to delete chat:', e);
            return false;
        }
    }

    /**
     * Record a new tool execution
     */
    async recordToolExecution(
        chatId: string,
        toolName: string,
        toolId: string,
        args: Record<string, any> | string,
        result: string | Record<string, any>,
        error?: string
    ): Promise<boolean> {
        try {
            const chat = await this.getChat(chatId);
            if (!chat) return false;

            const toolExecution: ToolExecution = {
                id: toolId,
                name: toolName,
                arguments: args,
                result,
                error,
                timestamp: new Date(),
                executionTime: 0 // Could track this if we passed in a start time
            };

            const currentToolExecutions = chat.metadata?.toolExecutions || [];
            currentToolExecutions.push(toolExecution);

            await this.updateChat(
                chatId,
                chat.messages,
                undefined, // Don't change title
                {
                    ...chat.metadata,
                    toolExecutions: currentToolExecutions
                }
            );

            return true;
        } catch (e) {
            log.error(`Failed to record tool execution: ${e}`);
            return false;
        }
    }

    /**
     * Extract tool executions from messages
     * This helps maintain a record of all tool calls even if messages are truncated
     */
    private extractToolExecutionsFromMessages(
        messages: Message[],
        existingToolExecutions: ToolExecution[] = []
    ): ToolExecution[] {
        const toolExecutions = [...existingToolExecutions];
        const executedToolIds = new Set(existingToolExecutions.map(t => t.id));

        // Process all messages to find tool calls and their results
        const assistantMessages = messages.filter(msg => msg.role === 'assistant' && msg.tool_calls);
        const toolMessages = messages.filter(msg => msg.role === 'tool');

        // Create a map of tool responses by tool_call_id
        const toolResponseMap = new Map<string, string>();
        for (const toolMsg of toolMessages) {
            if (toolMsg.tool_call_id) {
                toolResponseMap.set(toolMsg.tool_call_id, toolMsg.content);
            }
        }

        // Extract all tool calls and pair with responses
        for (const assistantMsg of assistantMessages) {
            if (!assistantMsg.tool_calls || !Array.isArray(assistantMsg.tool_calls)) continue;

            for (const toolCall of assistantMsg.tool_calls as ToolCall[]) {
                if (!toolCall.id || executedToolIds.has(toolCall.id)) continue;

                const toolResponse = toolResponseMap.get(toolCall.id);
                if (!toolResponse) continue; // Skip if no response found

                // We found a tool call with a response, record it
                let args: Record<string, any> | string;
                if (typeof toolCall.function.arguments === 'string') {
                    try {
                        args = JSON.parse(toolCall.function.arguments);
                    } catch (e) {
                        args = toolCall.function.arguments;
                    }
                } else {
                    args = toolCall.function.arguments;
                }

                let result: string | Record<string, any> = toolResponse;
                try {
                    // Try to parse result as JSON if it starts with { or [
                    if (toolResponse.trim().startsWith('{') || toolResponse.trim().startsWith('[')) {
                        result = JSON.parse(toolResponse);
                    }
                } catch (e) {
                    // Keep as string if parsing fails
                    result = toolResponse;
                }

                const isError = toolResponse.startsWith('Error:');
                const toolExecution: ToolExecution = {
                    id: toolCall.id,
                    name: toolCall.function.name,
                    arguments: args,
                    result,
                    error: isError ? toolResponse.substring('Error:'.length).trim() : undefined,
                    timestamp: new Date()
                };

                toolExecutions.push(toolExecution);
                executedToolIds.add(toolCall.id);
            }
        }

        return toolExecutions;
    }

    /**
     * Store sources used in a chat
     */
    async recordSources(
        chatId: string,
        sources: Array<{
            noteId: string;
            title: string;
            similarity?: number;
            path?: string;
            branchId?: string;
            content?: string;
        }>
    ): Promise<boolean> {
        try {
            const chat = await this.getChat(chatId);
            if (!chat) return false;

            await this.updateChat(
                chatId,
                chat.messages,
                undefined, // Don't change title
                {
                    ...chat.metadata,
                    sources
                }
            );

            return true;
        } catch (e) {
            log.error(`Failed to record sources: ${e}`);
            return false;
        }
    }
}

// Singleton instance
const chatStorageService = new ChatStorageService();
export default chatStorageService;
