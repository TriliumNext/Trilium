/**
 * Handler for streaming LLM responses
 */
import log from "../../../log.js";
import type { Response } from "express";
import type { StreamChunk } from "../../ai_interface.js";
import type { ChatSession } from "../../interfaces/chat_session.js";

/**
 * Handles streaming of LLM responses via WebSocket
 */
export class StreamHandler {
    /**
     * Handle streaming response via WebSocket
     *
     * This method processes LLM responses and sends them incrementally via WebSocket
     * to the client, supporting both text content and tool execution status updates.
     *
     * @param res Express response object
     * @param aiMessages Messages to send to the LLM
     * @param chatOptions Options for the chat completion
     * @param service LLM service to use
     * @param session Chat session for storing the response
     */
    static async handleStreamingResponse(
        res: Response,
        aiMessages: any[],
        chatOptions: any,
        service: any,
        session: ChatSession
    ): Promise<void> {
        // The client receives a success response for their HTTP request,
        // but the actual content will be streamed via WebSocket
        res.json({ success: true, message: 'Streaming response started' });

        // Import the WebSocket service
        const wsService = (await import('../../../ws.js')).default;

        let messageContent = '';
        const chatNoteId = session.id;

        // Immediately send an initial message to confirm WebSocket connection is working
        // This helps prevent timeouts on the client side
        wsService.sendMessageToAllClients({
            type: 'llm-stream',
            chatNoteId,
            thinking: 'Preparing response...'
        });

        try {
            // Import the tool handler
            const { ToolHandler } = await import('./tool_handler.js');

            // Generate the LLM completion with streaming enabled
            const response = await service.generateChatCompletion(aiMessages, {
                ...chatOptions,
                stream: true
            });

            // If the model doesn't support streaming via .stream() method or returns tool calls,
            // we'll handle it specially
            if (response.tool_calls && response.tool_calls.length > 0) {
                // Send thinking state notification via WebSocket
                wsService.sendMessageToAllClients({
                    type: 'llm-stream',
                    chatNoteId,
                    thinking: 'Analyzing tools needed for this request...'
                });

                try {
                    // Execute the tools
                    const toolResults = await ToolHandler.executeToolCalls(response, chatNoteId);

                    // For each tool execution, send progress update via WebSocket
                    for (const toolResult of toolResults) {
                        wsService.sendMessageToAllClients({
                            type: 'llm-stream',
                            chatNoteId,
                            toolExecution: {
                                action: 'complete',
                                tool: toolResult.name,
                                result: toolResult.content.substring(0, 100) + (toolResult.content.length > 100 ? '...' : '')
                            }
                        });
                    }

                    // Make follow-up request with tool results
                    const toolMessages = [...aiMessages, {
                        role: 'assistant',
                        content: response.text || '',
                        tool_calls: response.tool_calls
                    }, ...toolResults];

                    // Preserve streaming for follow-up if it was enabled in the original request
                    const followUpOptions = {
                        ...chatOptions,
                        // Only disable streaming if it wasn't explicitly requested
                        stream: chatOptions.stream === true,
                        // Allow tools but track iterations to prevent infinite loops
                        enableTools: true,
                        maxToolIterations: chatOptions.maxToolIterations || 5,
                        currentToolIteration: 1 // Start counting tool iterations
                    };

                    const followUpResponse = await service.generateChatCompletion(toolMessages, followUpOptions);

                    await this.processStreamedResponse(
                        followUpResponse,
                        wsService,
                        chatNoteId,
                        session,
                        toolMessages,
                        followUpOptions,
                        service
                    );
                } catch (toolError: any) {
                    log.error(`Error executing tools: ${toolError.message}`);

                    // Send error via WebSocket with done flag
                    wsService.sendMessageToAllClients({
                        type: 'llm-stream',
                        chatNoteId,
                        error: `Error executing tools: ${toolError instanceof Error ? toolError.message : 'Unknown error'}`,
                        done: true
                    });
                }
            } else if (response.stream) {
                // Handle standard streaming through the stream() method
                log.info(`Provider ${service.getName ? service.getName() : 'unknown'} supports streaming via stream() method`);

                // Store information about the model and provider in session metadata
                session.metadata.model = response.model || session.metadata.model;
                session.metadata.provider = response.provider || session.metadata.provider;
                session.metadata.lastUpdated = new Date().toISOString();

                await this.processStreamedResponse(
                    response,
                    wsService,
                    chatNoteId,
                    session
                );
            } else {
                log.info(`Provider ${service.getName ? service.getName() : 'unknown'} does not support streaming via stream() method, falling back to single response`);

                // If streaming isn't available, send the entire response at once
                messageContent = response.text || '';

                // Send via WebSocket - include both content and done flag in same message
                wsService.sendMessageToAllClients({
                    type: 'llm-stream',
                    chatNoteId,
                    content: messageContent,
                    done: true
                });

                log.info(`Complete response sent`);

                // Store the full response in the session
                session.messages.push({
                    role: 'assistant',
                    content: messageContent,
                    timestamp: new Date()
                });
            }
        } catch (streamingError: any) {
            log.error(`Streaming error: ${streamingError.message}`);

            // Import the WebSocket service directly in case it wasn't imported earlier
            const wsService = (await import('../../../ws.js')).default;

            // Send error via WebSocket
            wsService.sendMessageToAllClients({
                type: 'llm-stream',
                chatNoteId,
                error: `Error generating response: ${streamingError instanceof Error ? streamingError.message : 'Unknown error'}`
            });

            // Signal completion
            wsService.sendMessageToAllClients({
                type: 'llm-stream',
                chatNoteId,
                done: true
            });
        }
    }

    /**
     * Process a streamed response from an LLM
     */
    private static async processStreamedResponse(
        response: any,
        wsService: any,
        chatNoteId: string,
        session: ChatSession,
        toolMessages?: any[],
        followUpOptions?: any,
        service?: any
    ): Promise<void> {
        // Import tool handler lazily to avoid circular dependencies
        const { ToolHandler } = await import('./tool_handler.js');

        let messageContent = '';

        try {
            await response.stream(async (chunk: StreamChunk) => {
                if (chunk.text) {
                    messageContent += chunk.text;

                    // Enhanced logging for each chunk
                    log.info(`Received stream chunk with ${chunk.text.length} chars of text, done=${!!chunk.done}`);

                    // Send each individual chunk via WebSocket as it arrives
                    wsService.sendMessageToAllClients({
                        type: 'llm-stream',
                        chatNoteId,
                        content: chunk.text,
                        done: !!chunk.done, // Include done flag with each chunk
                        // Include any raw data from the provider that might contain thinking/tool info
                        ...(chunk.raw ? { raw: chunk.raw } : {})
                    });

                    // Log the first chunk (useful for debugging)
                    if (messageContent.length === chunk.text.length) {
                        log.info(`First stream chunk received: "${chunk.text.substring(0, 50)}${chunk.text.length > 50 ? '...' : ''}"`);
                    }
                }

                // If the provider indicates this is "thinking" state, relay that
                if (chunk.raw?.thinking) {
                    wsService.sendMessageToAllClients({
                        type: 'llm-stream',
                        chatNoteId,
                        thinking: chunk.raw.thinking
                    });
                }

                // If the provider indicates tool execution, relay that
                if (chunk.raw?.toolExecution) {
                    wsService.sendMessageToAllClients({
                        type: 'llm-stream',
                        chatNoteId,
                        toolExecution: chunk.raw.toolExecution
                    });
                }

                // Handle direct tool_calls in the response (for OpenAI)
                if (chunk.tool_calls && chunk.tool_calls.length > 0) {
                    log.info(`Detected direct tool_calls in stream chunk: ${chunk.tool_calls.length} tools`);

                    // Send tool execution notification
                    wsService.sendMessageToAllClients({
                        type: 'tool_execution_start',
                        chatNoteId
                    });

                    // Process each tool call
                    for (const toolCall of chunk.tool_calls) {
                        // Process arguments
                        let args = toolCall.function?.arguments;
                        if (typeof args === 'string') {
                            try {
                                args = JSON.parse(args);
                            } catch (e) {
                                log.info(`Could not parse tool arguments as JSON: ${e}`);
                                args = { raw: args };
                            }
                        }

                        // Format into a standardized tool execution message
                        wsService.sendMessageToAllClients({
                            type: 'tool_result',
                            chatNoteId,
                            toolExecution: {
                                action: 'executing',
                                tool: toolCall.function?.name || 'unknown',
                                toolCallId: toolCall.id,
                                args: args
                            }
                        });
                    }
                }

                // Signal completion when done
                if (chunk.done) {
                    log.info(`Stream completed, total content: ${messageContent.length} chars`);

                    // Check if there are more tool calls to execute (recursive tool calling)
                    if (service && toolMessages && followUpOptions &&
                        response.tool_calls && response.tool_calls.length > 0 &&
                        followUpOptions.currentToolIteration < followUpOptions.maxToolIterations) {

                        log.info(`Found ${response.tool_calls.length} more tool calls in iteration ${followUpOptions.currentToolIteration}`);

                        // Execute these tool calls in another iteration
                        const assistantMessage = {
                            role: 'assistant' as const,
                            content: messageContent,
                            tool_calls: response.tool_calls
                        };

                        // Execute the next round of tools
                        const nextToolResults = await ToolHandler.executeToolCalls(response, chatNoteId);

                        // Create a new messages array with the latest tool results
                        const nextToolMessages = [...toolMessages, assistantMessage, ...nextToolResults];

                        // Increment the tool iteration counter for the next call
                        const nextFollowUpOptions = {
                            ...followUpOptions,
                            currentToolIteration: followUpOptions.currentToolIteration + 1
                        };

                        log.info(`Making another follow-up request (iteration ${nextFollowUpOptions.currentToolIteration}/${nextFollowUpOptions.maxToolIterations})`);

                        // Make another follow-up request
                        const nextResponse = await service.generateChatCompletion(nextToolMessages, nextFollowUpOptions);

                        // Process the next response recursively
                        await this.processStreamedResponse(
                            nextResponse,
                            wsService,
                            chatNoteId,
                            session,
                            nextToolMessages,
                            nextFollowUpOptions,
                            service
                        );
                    } else {
                        // Only send final done message if it wasn't already sent with content
                        // This ensures we don't duplicate the content but still mark completion
                        if (!chunk.text) {
                            log.info(`No content in final chunk, sending explicit completion message`);

                            // Send final message with done flag only (no content)
                            wsService.sendMessageToAllClients({
                                type: 'llm-stream',
                                chatNoteId,
                                done: true
                            });
                        }

                        // Store the full response in the session
                        session.messages.push({
                            role: 'assistant',
                            content: messageContent,
                            timestamp: new Date()
                        });
                    }
                }
            });

            log.info(`Streaming completed successfully`);
        } catch (streamError: any) {
            log.error(`Error during streaming: ${streamError.message}`);

            // Report the error to the client
            wsService.sendMessageToAllClients({
                type: 'llm-stream',
                chatNoteId,
                error: `Error during streaming: ${streamError instanceof Error ? streamError.message : 'Unknown error'}`,
                done: true
            });

            throw streamError;
        }
    }
}
