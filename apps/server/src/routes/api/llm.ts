import type { Request, Response } from "express";
import log from "../../services/log.js";
import options from "../../services/options.js";

import restChatService from "../../services/llm/rest_chat_service.js";
import chatStorageService from '../../services/llm/chat_storage_service.js';
import toolRegistry from '../../services/llm/tools/tool_registry.js';
import aiServiceManager from '../../services/llm/ai_service_manager.js';

// Define basic interfaces
interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp?: Date;
}



/**
 * @swagger
 * /api/llm/sessions:
 *   post:
 *     summary: Create a new LLM chat session
 *     operationId: llm-create-session
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *                 description: Title for the chat session
 *               systemPrompt:
 *                 type: string
 *                 description: System message to set the behavior of the assistant
 *               temperature:
 *                 type: number
 *                 description: Temperature parameter for the LLM (0.0-1.0)
 *               maxTokens:
 *                 type: integer
 *                 description: Maximum tokens to generate in responses
 *               model:
 *                 type: string
 *                 description: Specific model to use (depends on provider)
 *               provider:
 *                 type: string
 *                 description: LLM provider to use (e.g., 'openai', 'anthropic', 'ollama')
 *               contextNoteId:
 *                 type: string
 *                 description: Note ID to use as context for the session
 *     responses:
 *       '200':
 *         description: Successfully created session
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 sessionId:
 *                   type: string
 *                 title:
 *                   type: string
 *                 createdAt:
 *                   type: string
 *                   format: date-time
 *     security:
 *       - session: []
 *     tags: ["llm"]
 */
async function createSession(req: Request, res: Response) {
    return restChatService.createSession(req, res);
}

/**
 * @swagger
 * /api/llm/sessions/{sessionId}:
 *   get:
 *     summary: Retrieve a specific chat session
 *     operationId: llm-get-session
 *     parameters:
 *       - name: sessionId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       '200':
 *         description: Chat session details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                 title:
 *                   type: string
 *                 messages:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       role:
 *                         type: string
 *                         enum: [user, assistant, system]
 *                       content:
 *                         type: string
 *                       timestamp:
 *                         type: string
 *                         format: date-time
 *                 createdAt:
 *                   type: string
 *                   format: date-time
 *                 lastActive:
 *                   type: string
 *                   format: date-time
 *       '404':
 *         description: Session not found
 *     security:
 *       - session: []
 *     tags: ["llm"]
 */
async function getSession(req: Request, res: Response) {
    return restChatService.getSession(req, res);
}

/**
 * @swagger
 * /api/llm/chat/{chatNoteId}:
 *   patch:
 *     summary: Update a chat's settings
 *     operationId: llm-update-chat
 *     parameters:
 *       - name: chatNoteId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the chat note (formerly sessionId)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *                 description: Updated title for the session
 *               systemPrompt:
 *                 type: string
 *                 description: Updated system prompt
 *               temperature:
 *                 type: number
 *                 description: Updated temperature setting
 *               maxTokens:
 *                 type: integer
 *                 description: Updated maximum tokens setting
 *               model:
 *                 type: string
 *                 description: Updated model selection
 *               provider:
 *                 type: string
 *                 description: Updated provider selection
 *               contextNoteId:
 *                 type: string
 *                 description: Updated note ID for context
 *     responses:
 *       '200':
 *         description: Session successfully updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                 title:
 *                   type: string
 *                 updatedAt:
 *                   type: string
 *                   format: date-time
 *       '404':
 *         description: Session not found
 *     security:
 *       - session: []
 *     tags: ["llm"]
 */
async function updateSession(req: Request, res: Response) {
    // Get the chat using chatStorageService directly
    const chatNoteId = req.params.sessionId;
    const updates = req.body;

    try {
        // Get the chat
        const chat = await chatStorageService.getChat(chatNoteId);
        if (!chat) {
            return [404, { error: `Chat with ID ${chatNoteId} not found` }];
        }

        // Update title if provided
        if (updates.title) {
            await chatStorageService.updateChat(chatNoteId, chat.messages, updates.title);
        }

        // Return the updated chat
        return {
            id: chatNoteId,
            title: updates.title || chat.title,
            updatedAt: new Date()
        };
    } catch (error) {
        log.error(`Error updating chat: ${error}`);
        return [500, { error: `Failed to update chat: ${error}` }];
    }
}

/**
 * @swagger
 * /api/llm/sessions:
 *   get:
 *     summary: List all chat sessions
 *     operationId: llm-list-sessions
 *     responses:
 *       '200':
 *         description: List of chat sessions
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                   title:
 *                     type: string
 *                   createdAt:
 *                     type: string
 *                     format: date-time
 *                   lastActive:
 *                     type: string
 *                     format: date-time
 *                   messageCount:
 *                     type: integer
 *     security:
 *       - session: []
 *     tags: ["llm"]
 */
async function listSessions(req: Request, res: Response) {
    // Get all sessions using chatStorageService directly
    try {
        const chats = await chatStorageService.getAllChats();

        // Format the response
        return {
            sessions: chats.map(chat => ({
                id: chat.id,
                title: chat.title,
                createdAt: chat.createdAt || new Date(),
                lastActive: chat.updatedAt || new Date(),
                messageCount: chat.messages.length
            }))
        };
    } catch (error) {
        log.error(`Error listing sessions: ${error}`);
        return [500, { error: `Failed to list sessions: ${error}` }];
    }
}

/**
 * @swagger
 * /api/llm/sessions/{sessionId}:
 *   delete:
 *     summary: Delete a chat session
 *     operationId: llm-delete-session
 *     parameters:
 *       - name: sessionId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       '200':
 *         description: Session successfully deleted
 *       '404':
 *         description: Session not found
 *     security:
 *       - session: []
 *     tags: ["llm"]
 */
async function deleteSession(req: Request, res: Response) {
    return restChatService.deleteSession(req, res);
}

/**
 * @swagger
 * /api/llm/chat/{chatNoteId}/messages:
 *   post:
 *     summary: Send a message to an LLM and get a response
 *     operationId: llm-send-message
 *     parameters:
 *       - name: chatNoteId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the chat note (formerly sessionId)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               message:
 *                 type: string
 *                 description: The user message to send to the LLM
 *               options:
 *                 type: object
 *                 description: Optional parameters for this specific message
 *                 properties:
 *                   temperature:
 *                     type: number
 *                   maxTokens:
 *                     type: integer
 *                   model:
 *                     type: string
 *                   provider:
 *                     type: string
 *               includeContext:
 *                 type: boolean
 *                 description: Whether to include relevant notes as context
 *               useNoteContext:
 *                 type: boolean
 *                 description: Whether to use the session's context note
 *     responses:
 *       '200':
 *         description: LLM response
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 response:
 *                   type: string
 *                 sources:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       noteId:
 *                         type: string
 *                       title:
 *                         type: string
 *                       similarity:
 *                         type: number
 *                 sessionId:
 *                   type: string
 *       '404':
 *         description: Session not found
 *       '500':
 *         description: Error processing request
 *     security:
 *       - session: []
 *     tags: ["llm"]
 */
async function sendMessage(req: Request, res: Response) {
    return restChatService.handleSendMessage(req, res);
}









/**
 * @swagger
 * /api/llm/chat/{chatNoteId}/messages/stream:
 *   post:
 *     summary: Stream a message to an LLM via WebSocket
 *     operationId: llm-stream-message
 *     parameters:
 *       - name: chatNoteId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the chat note to stream messages to (formerly sessionId)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               content:
 *                 type: string
 *                 description: The user message to send to the LLM
 *               useAdvancedContext:
 *                 type: boolean
 *                 description: Whether to use advanced context extraction
 *               showThinking:
 *                 type: boolean
 *                 description: Whether to show thinking process in the response
 *     responses:
 *       '200':
 *         description: Streaming started successfully
 *       '404':
 *         description: Session not found
 *       '500':
 *         description: Error processing request
 *     security:
 *       - session: []
 *     tags: ["llm"]
 */
async function streamMessage(req: Request, res: Response) {
    log.info("=== Starting streamMessage ===");
    
    try {
        const chatNoteId = req.params.chatNoteId;
        const { content, useAdvancedContext, showThinking, mentions } = req.body;

        // Input validation
        if (!content || typeof content !== 'string' || content.trim().length === 0) {
            res.status(400).json({
                success: false,
                error: 'Content cannot be empty'
            });
            // Mark response as handled to prevent further processing
            (res as any).triliumResponseHandled = true;
            return;
        }
        
        // Send immediate success response
        res.status(200).json({
            success: true,
            message: 'Streaming initiated successfully'
        });
        // Mark response as handled to prevent further processing
        (res as any).triliumResponseHandled = true;
        
        // Start background streaming process after sending response
        handleStreamingProcess(chatNoteId, content, useAdvancedContext, showThinking, mentions)
            .catch(error => {
                log.error(`Background streaming error: ${error.message}`);
                
                // Send error via WebSocket since HTTP response was already sent
                import('../../services/ws.js').then(wsModule => {
                    wsModule.default.sendMessageToAllClients({
                        type: 'llm-stream',
                        chatNoteId: chatNoteId,
                        error: `Error during streaming: ${error.message}`,
                        done: true
                    });
                }).catch(wsError => {
                    log.error(`Could not send WebSocket error: ${wsError}`);
                });
            });
            
    } catch (error) {
        // Handle any synchronous errors
        log.error(`Synchronous error in streamMessage: ${error}`);
        
        if (!res.headersSent) {
            res.status(500).json({
                success: false,
                error: 'Internal server error'
            });
        }
        // Mark response as handled to prevent further processing
        (res as any).triliumResponseHandled = true;
    }
}

/**
 * Handle the streaming process in the background
 * This is separate from the HTTP request/response cycle
 */
async function handleStreamingProcess(
    chatNoteId: string, 
    content: string, 
    useAdvancedContext: boolean, 
    showThinking: boolean, 
    mentions: any[]
) {
    log.info("=== Starting background streaming process ===");
    
    // Get or create chat directly from storage
    let chat = await chatStorageService.getChat(chatNoteId);
    if (!chat) {
        chat = await chatStorageService.createChat('New Chat');
        log.info(`Created new chat with ID: ${chat.id} for stream request`);
    }
    
    // Add the user message to the chat immediately
    chat.messages.push({
        role: 'user',
        content
    });
    await chatStorageService.updateChat(chat.id, chat.messages, chat.title);

    // Process mentions if provided
    let enhancedContent = content;
    if (mentions && Array.isArray(mentions) && mentions.length > 0) {
        log.info(`Processing ${mentions.length} note mentions`);

        const becca = (await import('../../becca/becca.js')).default;
        const mentionContexts: string[] = [];

        for (const mention of mentions) {
            try {
                const note = becca.getNote(mention.noteId);
                if (note && !note.isDeleted) {
                    const noteContent = note.getContent();
                    if (noteContent && typeof noteContent === 'string' && noteContent.trim()) {
                        mentionContexts.push(`\n\n--- Content from "${mention.title}" (${mention.noteId}) ---\n${noteContent}\n--- End of "${mention.title}" ---`);
                        log.info(`Added content from note "${mention.title}" (${mention.noteId})`);
                    }
                } else {
                    log.info(`Referenced note not found or deleted: ${mention.noteId}`);
                }
            } catch (error) {
                log.error(`Error retrieving content for note ${mention.noteId}: ${error}`);
            }
        }

        if (mentionContexts.length > 0) {
            enhancedContent = `${content}\n\n=== Referenced Notes ===\n${mentionContexts.join('\n')}`;
            log.info(`Enhanced content with ${mentionContexts.length} note references`);
        }
    }

    // Import WebSocket service for streaming
    const wsService = (await import('../../services/ws.js')).default;

    // Let the client know streaming has started
    wsService.sendMessageToAllClients({
        type: 'llm-stream',
        chatNoteId: chatNoteId,
        thinking: showThinking ? 'Initializing streaming LLM response...' : undefined
    });

    // Instead of calling the complex handleSendMessage service, 
    // let's implement streaming directly to avoid response conflicts
    
    try {
        // Check if AI is enabled
        const optionsModule = await import('../../services/options.js');
        const aiEnabled = optionsModule.default.getOptionBool('aiEnabled');
        if (!aiEnabled) {
            throw new Error("AI features are disabled. Please enable them in the settings.");
        }

        // Get AI service
        const aiServiceManager = await import('../../services/llm/ai_service_manager.js');
        await aiServiceManager.default.getOrCreateAnyService();

        // Use the simplified chat pipeline directly for streaming
        const simplifiedPipeline = await import('../../services/llm/pipeline/simplified_pipeline.js');
        const pipeline = simplifiedPipeline.default;

        // Get selected model
        const { getSelectedModelConfig } = await import('../../services/llm/config/configuration_helpers.js');
        const modelConfig = await getSelectedModelConfig();
        
        if (!modelConfig) {
            throw new Error("No valid AI model configuration found");
        }

        const pipelineInput = {
            messages: chat.messages.map(msg => ({
                role: msg.role as 'user' | 'assistant' | 'system',
                content: msg.content
            })),
            query: enhancedContent,
            noteId: undefined,
            showThinking: showThinking,
            options: {
                useAdvancedContext: useAdvancedContext === true,
                model: modelConfig.model,
                stream: true,
                chatNoteId: chatNoteId
            },
            streamCallback: (data, done, rawChunk) => {
                const message = {
                    type: 'llm-stream' as const,
                    chatNoteId: chatNoteId,
                    done: done
                };

                if (data) {
                    (message as any).content = data;
                }

                if (rawChunk && 'thinking' in rawChunk && rawChunk.thinking) {
                    (message as any).thinking = rawChunk.thinking as string;
                }

                if (rawChunk && 'toolExecution' in rawChunk && rawChunk.toolExecution) {
                    const toolExec = rawChunk.toolExecution;
                    (message as any).toolExecution = {
                        tool: typeof toolExec.tool === 'string' ? toolExec.tool : toolExec.tool?.name,
                        result: toolExec.result,
                        args: 'arguments' in toolExec ?
                            (typeof toolExec.arguments === 'object' ? toolExec.arguments as Record<string, unknown> : {}) : {},
                        action: 'action' in toolExec ? toolExec.action as string : undefined,
                        toolCallId: 'toolCallId' in toolExec ? toolExec.toolCallId as string : undefined,
                        error: 'error' in toolExec ? toolExec.error as string : undefined
                    };
                }

                wsService.sendMessageToAllClients(message);

                // Save final response when done
                if (done && data) {
                    chat.messages.push({
                        role: 'assistant',
                        content: data
                    });
                    chatStorageService.updateChat(chat.id, chat.messages, chat.title).catch(err => {
                        log.error(`Error saving streamed response: ${err}`);
                    });
                }
            }
        };

        // Execute the pipeline
        await pipeline.execute(pipelineInput);
        
    } catch (error: any) {
        log.error(`Error in direct streaming: ${error.message}`);
        wsService.sendMessageToAllClients({
            type: 'llm-stream',
            chatNoteId: chatNoteId,
            error: `Error during streaming: ${error.message}`,
            done: true
        });
    }
}

/**
 * @swagger
 * /api/llm/interactions/{interactionId}/respond:
 *   post:
 *     summary: Respond to a user interaction request (confirm/cancel tool execution)
 *     operationId: llm-interaction-respond
 *     parameters:
 *       - name: interactionId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the interaction to respond to
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               response:
 *                 type: string
 *                 enum: [confirm, cancel]
 *                 description: User's response to the interaction
 *     responses:
 *       '200':
 *         description: Response processed successfully
 *       '404':
 *         description: Interaction not found
 *       '400':
 *         description: Invalid response
 *     security:
 *       - session: []
 *     tags: ["llm"]
 */
async function respondToInteraction(req: Request, res: Response): Promise<void> {
    try {
        const interactionId = req.params.interactionId;
        const { response } = req.body;

        if (!interactionId || !response) {
            res.status(400).json({
                success: false,
                error: 'Missing interactionId or response'
            });
            return;
        }

        if (response !== 'confirm' && response !== 'cancel') {
            res.status(400).json({
                success: false,
                error: 'Response must be either "confirm" or "cancel"'
            });
            return;
        }

        // Import the pipeline to access user interaction stage
        // Note: In a real implementation, you'd maintain a registry of active pipelines
        // For now, we'll send this via WebSocket to be handled by the active pipeline
        
        const wsService = (await import('../../services/ws.js')).default;
        
        // Send the user response via WebSocket to be picked up by the active pipeline
        wsService.sendMessageToAllClients({
            type: 'user-interaction-response',
            interactionId,
            response,
            timestamp: Date.now()
        });

        res.status(200).json({
            success: true,
            message: `User response "${response}" recorded for interaction ${interactionId}`
        });

    } catch (error) {
        log.error(`Error handling user interaction response: ${error}`);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
}

/**
 * Debug endpoint to check tool recognition and registry status
 */
async function debugTools(req: Request, res: Response): Promise<void> {
    try {
        log.info("========== DEBUG TOOLS ENDPOINT CALLED ==========");
        
        // Get detailed tool registry info
        const registryDebugInfo = toolRegistry.getDebugInfo();
        
        // Get AI service manager status
        const availableProviders = aiServiceManager.getAvailableProviders();
        const providerStatus: Record<string, any> = {};
        
        for (const provider of availableProviders) {
            try {
                const service = await aiServiceManager.getService(provider);
                providerStatus[provider] = {
                    available: true,
                    type: service.constructor.name,
                    supportsTools: 'generateChatCompletion' in service
                };
            } catch (error) {
                providerStatus[provider] = {
                    available: false,
                    error: error instanceof Error ? error.message : String(error)
                };
            }
        }
        
        // Get current tool definitions being sent to LLM
        const currentToolDefinitions = toolRegistry.getAllToolDefinitions();
        
        // Format tool definitions for debugging
        const toolDefinitionSummary = currentToolDefinitions.map(def => ({
            name: def.function.name,
            description: def.function.description || 'No description',
            parameterCount: Object.keys(def.function.parameters?.properties || {}).length,
            requiredParams: def.function.parameters?.required || [],
            type: def.type || 'function'
        }));
        
        const debugData = {
            timestamp: new Date().toISOString(),
            summary: {
                registrySize: registryDebugInfo.registrySize,
                validToolCount: registryDebugInfo.validToolCount,
                definitionsForLLM: currentToolDefinitions.length,
                availableProviders: availableProviders.length,
                initializationAttempted: registryDebugInfo.initializationAttempted
            },
            toolRegistry: {
                ...registryDebugInfo,
                toolDefinitionSummary
            },
            aiServiceManager: {
                availableProviders,
                providerStatus
            },
            fullToolDefinitions: currentToolDefinitions,
            troubleshooting: {
                commonIssues: [
                    "No tools in registry - check tool initialization in AIServiceManager",
                    "Tools failing validation - check execute methods and definitions",
                    "Provider not supporting function calling - verify model capabilities",
                    "Tool definitions not being sent to LLM - check enableTools option"
                ],
                checkpoints: [
                    `Tools registered: ${registryDebugInfo.registrySize > 0 ? '✓' : '✗'}`,
                    `Tools valid: ${registryDebugInfo.validToolCount > 0 ? '✓' : '✗'}`,
                    `Definitions available: ${currentToolDefinitions.length > 0 ? '✓' : '✗'}`,
                    `Providers available: ${availableProviders.length > 0 ? '✓' : '✗'}`
                ]
            }
        };
        
        log.info(`Debug tools response: ${JSON.stringify(debugData.summary, null, 2)}`);
        
        res.status(200).json(debugData);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log.error(`Error in debug tools endpoint: ${errorMessage}`);
        res.status(500).json({
            error: 'Failed to retrieve debug information',
            message: errorMessage,
            timestamp: new Date().toISOString()
        });
    }
}

export default {
    // Chat session management
    createSession,
    getSession,
    updateSession,
    listSessions,
    deleteSession,
    sendMessage,
    streamMessage,
    
    // User interaction
    respondToInteraction,
    
    // Debug endpoints
    debugTools
};
