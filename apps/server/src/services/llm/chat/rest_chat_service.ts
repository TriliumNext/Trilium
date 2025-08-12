/**
 * Simplified service to handle chat API interactions
 * Works directly with ChatStorageService - no complex session management
 */
import log from "../../log.js";
import type { Request, Response } from "express";
import type { Message, ChatCompletionOptions } from "../ai_interface.js";
import aiServiceManager from "../ai_service_manager.js";
import { ChatPipeline } from "../pipeline/pipeline_adapter.js";
import type { ChatPipelineInput } from "../pipeline/interfaces.js";
import options from "../../options.js";
import { ToolHandler } from "./handlers/tool_handler.js";
import type { LLMStreamMessage } from "../interfaces/chat_ws_messages.js";
import chatStorageService from '../chat_storage_service.js';
import {
    isAIEnabled,
    getSelectedModelConfig,
} from '../config/configuration_helpers.js';

/**
 * Simplified service to handle chat API interactions
 */
class RestChatService {
    /**
     * Check if the database is initialized
     */
    isDatabaseInitialized(): boolean {
        try {
            options.getOption('initialized');
            return true;
        } catch (error) {
            return false;
        }
    }


    /**
     * Handle a message sent to an LLM and get a response
     * Simplified to work directly with chat storage
     */
    async handleSendMessage(req: Request, res: Response) {
        log.info("=== Starting simplified handleSendMessage ===");
        try {
            // Extract parameters
            let content, useAdvancedContext, showThinking, chatNoteId;

            if (req.method === 'POST') {
                const requestBody = req.body || {};
                content = requestBody.content;
                useAdvancedContext = requestBody.useAdvancedContext || false;
                showThinking = requestBody.showThinking || false;
                log.info(`LLM POST message: chatNoteId=${req.params.chatNoteId}, contentLength=${content ? content.length : 0}`);
            } else if (req.method === 'GET') {
                useAdvancedContext = req.query.useAdvancedContext === 'true' || (req.body && req.body.useAdvancedContext === true);
                showThinking = req.query.showThinking === 'true' || (req.body && req.body.showThinking === true);
                content = req.body && req.body.content ? req.body.content : '';
                log.info(`LLM GET stream: chatNoteId=${req.params.chatNoteId}`);
            }

            chatNoteId = req.params.chatNoteId;

            // Validate inputs
            if (req.method === 'GET' && req.query.stream !== 'true') {
                throw new Error('Stream parameter must be set to true for GET/streaming requests');
            }

            if (req.method === 'POST' && (!content || typeof content !== 'string' || content.trim().length === 0)) {
                throw new Error('Content cannot be empty');
            }

            // Check if AI is enabled
            const aiEnabled = await options.getOptionBool('aiEnabled');
            if (!aiEnabled) {
                return { error: "AI features are disabled. Please enable them in the settings." };
            }

            // Check database initialization first
            if (!this.isDatabaseInitialized()) {
                throw new Error("Database is not initialized");
            }

            // Get or create AI service - will throw meaningful error if not possible  
            await aiServiceManager.getOrCreateAnyService();

            // Load or create chat directly from storage
            let chat = await chatStorageService.getChat(chatNoteId);

            if (!chat && req.method === 'GET') {
                throw new Error('Chat Note not found, cannot create session for streaming');
            }

            if (!chat && req.method === 'POST') {
                log.info(`Creating new chat note with ID: ${chatNoteId}`);
                chat = await chatStorageService.createChat('New Chat');
                // Update the chat ID to match the requested ID if possible
                // In practice, we'll use the generated ID
                chatNoteId = chat.id;
            }

            if (!chat) {
                throw new Error('Failed to create or retrieve chat');
            }

            // For POST requests, add the user message to the chat immediately
            // This ensures user messages are always saved
            if (req.method === 'POST' && content) {
                chat.messages.push({
                    role: 'user',
                    content
                });
                // Save immediately to ensure user message is saved
                await chatStorageService.updateChat(chat.id, chat.messages, chat.title);
                log.info(`Added and saved user message: "${content.substring(0, 50)}${content.length > 50 ? '...' : ''}"`);
            }

            // Initialize tools
            await ToolHandler.ensureToolsInitialized();

            // Create and use the chat pipeline
            const pipeline = new ChatPipeline({
                enableStreaming: req.method === 'GET',
                enableMetrics: true,
                maxToolCallIterations: 5
            });

            // Get user's preferred model
            const preferredModel = await this.getPreferredModel();

            const pipelineOptions = {
                useAdvancedContext: useAdvancedContext === true,
                systemPrompt: chat.messages.find(m => m.role === 'system')?.content,
                model: preferredModel,
                stream: !!(req.method === 'GET' || req.query.format === 'stream' || req.query.stream === 'true'),
                chatNoteId: chatNoteId
            };

            log.info(`Pipeline options: ${JSON.stringify({ useAdvancedContext: pipelineOptions.useAdvancedContext, stream: pipelineOptions.stream })}`);

            // Import WebSocket service for streaming
            const wsService = await import('../../ws.js');
            const accumulatedContentRef = { value: '' };

            const pipelineInput: ChatPipelineInput = {
                messages: chat.messages.map(msg => ({
                    role: msg.role as 'user' | 'assistant' | 'system',
                    content: msg.content
                })),
                query: content || '',
                noteId: undefined, // TODO: Add context note support if needed
                showThinking: showThinking,
                options: pipelineOptions,
                streamCallback: req.method === 'GET' ? (data, done, rawChunk) => {
                    this.handleStreamCallback(data, done, rawChunk, wsService.default, chatNoteId, res, accumulatedContentRef, chat);
                } : undefined
            };

            // Execute the pipeline
            const response = await pipeline.execute(pipelineInput);

            if (req.method === 'POST') {
                // Add assistant response to chat
                chat.messages.push({
                    role: 'assistant',
                    content: response.text || ''
                });

                // Save the updated chat back to storage (single source of truth)
                await chatStorageService.updateChat(chat.id, chat.messages, chat.title);
                log.info(`Saved non-streaming assistant response: ${(response.text || '').length} characters`);

                // Extract sources if available
                const sources = (response as any).sources || [];

                return {
                    content: response.text || '',
                    sources: sources,
                    metadata: {
                        model: response.model,
                        provider: response.provider,
                        lastUpdated: new Date().toISOString()
                    }
                };
            } else {
                // For streaming, response is already sent via WebSocket/SSE
                // The accumulatedContentRef will have been saved in handleStreamCallback when done=true
                return null;
            }
        } catch (error: any) {
            log.error(`Error processing message: ${error}`);
            return { error: `Error processing your request: ${error.message}` };
        }
    }

    /**
     * Simplified stream callback handler
     */
    private async handleStreamCallback(
        data: string | null,
        done: boolean,
        rawChunk: any,
        wsService: any,
        chatNoteId: string,
        res: Response,
        accumulatedContentRef: { value: string },
        chat: { id: string; messages: Message[]; title: string }
    ) {
        const message: LLMStreamMessage = {
            type: 'llm-stream',
            chatNoteId: chatNoteId,
            done: done
        };

        if (data) {
            message.content = data;
            // Simple accumulation - just append the new data
            accumulatedContentRef.value += data;
        }

        // Only include thinking if explicitly present in rawChunk
        if (rawChunk && 'thinking' in rawChunk && rawChunk.thinking) {
            message.thinking = rawChunk.thinking as string;
        }

        // Only include tool execution if explicitly present in rawChunk
        if (rawChunk && 'toolExecution' in rawChunk && rawChunk.toolExecution) {
            const toolExec = rawChunk.toolExecution;
            message.toolExecution = {
                tool: typeof toolExec.tool === 'string' ? toolExec.tool : toolExec.tool?.name,
                result: toolExec.result,
                args: 'arguments' in toolExec ?
                    (typeof toolExec.arguments === 'object' ? toolExec.arguments as Record<string, unknown> : {}) : {},
                action: 'action' in toolExec ? toolExec.action as string : undefined,
                toolCallId: 'toolCallId' in toolExec ? toolExec.toolCallId as string : undefined,
                error: 'error' in toolExec ? toolExec.error as string : undefined
            };
        }

        // Send WebSocket message
        wsService.sendMessageToAllClients(message);
        
        // When streaming is complete, save the accumulated content to the chat note
        if (done) {
            try {
                // Only save if we have accumulated content
                if (accumulatedContentRef.value) {
                    // Add assistant response to chat
                    chat.messages.push({
                        role: 'assistant',
                        content: accumulatedContentRef.value
                    });
                    
                    // Save the updated chat back to storage
                    await chatStorageService.updateChat(chat.id, chat.messages, chat.title);
                    log.info(`Saved streaming assistant response: ${accumulatedContentRef.value.length} characters`);
                }
            } catch (error) {
                // Log error but don't break the response flow
                log.error(`Error saving streaming response: ${error}`);
            }
            
            // Note: For WebSocket-only streaming, we don't end the HTTP response here
            // since it was already handled by the calling endpoint
        }
    }

    /**
     * Create a new chat
     */
    async createSession(req: Request, res: Response) {
        try {
            const options: any = req.body || {};
            const title = options.title || 'Chat Session';

            let noteId = options.noteId || options.chatNoteId;

            // Check if currentNoteId is already an AI Chat note
            if (!noteId && options.currentNoteId) {
                const becca = (await import('../../../becca/becca.js')).default;
                const note = becca.notes[options.currentNoteId];

                if (note) {
                    try {
                        const content = note.getContent();
                        if (content) {
                            const contentStr = typeof content === 'string' ? content : content.toString();
                            const parsedContent = JSON.parse(contentStr);
                            if (parsedContent.messages && Array.isArray(parsedContent.messages)) {
                                noteId = options.currentNoteId;
                                log.info(`Using existing AI Chat note ${noteId} as session`);
                            }
                        }
                    } catch (_) {
                        // Not JSON content, so not an AI Chat note
                    }
                }
            }

            // Create new chat if needed
            if (!noteId) {
                const newChat = await chatStorageService.createChat(title);
                noteId = newChat.id;
                log.info(`Created new Chat Note with ID: ${noteId}`);
            } else {
                log.info(`Using existing Chat Note with ID: ${noteId}`);
            }

            return {
                id: noteId,
                title: title,
                createdAt: new Date(),
                noteId: noteId
            };
        } catch (error: any) {
            log.error(`Error creating chat session: ${error.message || 'Unknown error'}`);
            throw new Error(`Failed to create chat session: ${error.message || 'Unknown error'}`);
        }
    }

    /**
     * Get a chat by ID
     */
    async getSession(req: Request, res: Response): Promise<any> {
        try {
            const { sessionId } = req.params;

            const chat = await chatStorageService.getChat(sessionId);
            if (!chat) {
                // Return error in Express route format [statusCode, response]
                return [404, {
                    error: true,
                    message: `Session with ID ${sessionId} not found`,
                    code: 'session_not_found',
                    sessionId
                }];
            }

            return {
                id: chat.id,
                title: chat.title,
                createdAt: chat.createdAt,
                lastActive: chat.updatedAt,
                messages: chat.messages,
                metadata: chat.metadata || {}
            };
        } catch (error: any) {
            log.error(`Error getting chat session: ${error.message || 'Unknown error'}`);
            return [500, { error: `Failed to get session: ${error.message || 'Unknown error'}` }];
        }
    }

    /**
     * Delete a chat
     */
    async deleteSession(req: Request, res: Response) {
        try {
            const { sessionId } = req.params;

            const success = await chatStorageService.deleteChat(sessionId);
            if (!success) {
                throw new Error(`Session with ID ${sessionId} not found`);
            }

            return {
                success: true,
                message: `Session ${sessionId} deleted successfully`
            };
        } catch (error: any) {
            log.error(`Error deleting chat session: ${error.message || 'Unknown error'}`);
            throw new Error(`Failed to delete session: ${error.message || 'Unknown error'}`);
        }
    }

    /**
     * Get all chats
     */
    async getAllSessions() {
        try {
            const chats = await chatStorageService.getAllChats();
            return {
                sessions: chats.map(chat => ({
                    id: chat.id,
                    title: chat.title,
                    createdAt: chat.createdAt,
                    lastActive: chat.updatedAt,
                    messageCount: chat.messages.length
                }))
            };
        } catch (error: any) {
            log.error(`Error listing sessions: ${error}`);
            throw new Error(`Failed to list sessions: ${error}`);
        }
    }

    /**
     * Get the user's preferred model
     */
    async getPreferredModel(): Promise<string | undefined> {
        try {
            const validConfig = await getSelectedModelConfig();
            if (!validConfig) {
                log.error('No valid AI model configuration found');
                return undefined;
            }
            return validConfig.model;
        } catch (error) {
            log.error(`Error getting preferred model: ${error}`);
            return undefined;
        }
    }
}

// Create singleton instance
const restChatService = new RestChatService();
export default restChatService;
