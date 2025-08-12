import { BaseAIService } from '../base_ai_service.js';
import type { Message, ChatCompletionOptions, ChatResponse, StreamChunk } from '../ai_interface.js';
import log from '../../log.js';
import type { ToolCall, Tool } from '../tools/tool_interfaces.js';
import toolRegistry from '../tools/tool_registry.js';
import type { OllamaOptions } from './provider_options.js';
import { getOllamaOptions } from './providers.js';
import { Ollama, type ChatRequest } from 'ollama';
import options from '../../options.js';
import {
    StreamProcessor,
    createStreamHandler,
    performProviderHealthCheck,
    processProviderStream,
    extractStreamStats
} from './stream_handler.js';

// Add an interface for tool execution feedback status
interface ToolExecutionStatus {
    toolCallId: string;
    name: string;
    success: boolean;
    result: string;
    error?: string;
}

// Interface for Ollama-specific messages
interface OllamaMessage {
    role: string;
    content: string;
    tool_call_id?: string;
    tool_calls?: OllamaToolCall[];
    name?: string;
}

// Interface for Ollama tool calls
interface OllamaToolCall {
    id: string;
    function: {
        name: string;
        arguments: Record<string, unknown>;
    };
}

// Interface for Ollama request options
interface OllamaRequestOptions {
    model: string;
    messages: OllamaMessage[];
    stream?: boolean;
    options?: Record<string, unknown>;
    format?: string;
    tools?: Tool[];
    [key: string]: unknown;
}

export class OllamaService extends BaseAIService {
    private client: Ollama | null = null;

    constructor() {
        super('Ollama');
    }

    override isAvailable(): boolean {
        return super.isAvailable() && !!options.getOption('ollamaBaseUrl');
    }

    private getClient(): Ollama {
        if (!this.client) {
            const baseUrl = options.getOption('ollamaBaseUrl');
            if (!baseUrl) {
                throw new Error('Ollama base URL is not configured');
            }

            log.info(`Creating new Ollama client with base URL: ${baseUrl}`);

            // Create client with debug options
            try {
                this.client = new Ollama({
                    host: baseUrl,
                    fetch: (url, init) => {
                        log.info(`Ollama API request to: ${url}`);
                        log.info(`Ollama API request method: ${init?.method || 'GET'}`);
                        log.info(`Ollama API request headers: ${JSON.stringify(init?.headers || {})}`);

                        // Call the actual fetch
                        return fetch(url, init).then(response => {
                            log.info(`Ollama API response status: ${response.status}`);
                            if (!response.ok) {
                                log.error(`Ollama API error response: ${response.statusText}`);
                            }
                            return response;
                        }).catch(error => {
                            log.error(`Ollama API fetch error: ${error.message}`);
                            throw error;
                        });
                    }
                });

                log.info(`Ollama client successfully created`);
            } catch (error) {
                log.error(`Error creating Ollama client: ${error}`);
                throw error;
            }
        }
        return this.client;
    }

    async generateChatCompletion(messages: Message[], opts: ChatCompletionOptions = {}): Promise<ChatResponse> {
        if (!this.isAvailable()) {
            throw new Error('Ollama service is not available. Check API URL in settings.');
        }

        // Get provider-specific options from the central provider manager
        const providerOptions = await getOllamaOptions(opts);

        // Log provider metadata if available
        if (providerOptions.providerMetadata) {
            log.info(`Using model ${providerOptions.model} from provider ${providerOptions.providerMetadata.provider}`);

            // Log capabilities if available
            const capabilities = providerOptions.providerMetadata.capabilities;
            if (capabilities) {
                log.info(`Model capabilities: ${JSON.stringify(capabilities)}`);
            }
        }

        const systemPrompt = this.getSystemPrompt(providerOptions.systemPrompt || options.getOption('aiSystemPrompt'));

        try {
            // Check if we should add tool execution feedback
            if (providerOptions.toolExecutionStatus && Array.isArray(providerOptions.toolExecutionStatus) && providerOptions.toolExecutionStatus.length > 0) {
                log.info(`Adding tool execution feedback to messages`);
                messages = this.addToolExecutionFeedback(messages, providerOptions.toolExecutionStatus as ToolExecutionStatus[]);
            }

            // Determine whether to use the formatter or send messages directly
            let messagesToSend: Message[];

            if (providerOptions.bypassFormatter) {
                // Bypass the formatter entirely - use messages as is
                messagesToSend = [...messages];
                log.info(`Bypassing formatter for Ollama request with ${messages.length} messages`);
            } else {
                // Determine if tools will be used in this request
                const willUseTools = providerOptions.enableTools !== false;
                
                // Format messages directly (Ollama uses OpenAI format)
                messagesToSend = [
                    { role: 'system', content: systemPrompt },
                    ...messages
                ];
                
                log.info(`Sending to Ollama with formatted messages: ${messagesToSend.length}${willUseTools ? ' (with tool instructions)' : ''}`);
            }

            // Get tools if enabled
            let tools: Tool[] = [];
            if (providerOptions.enableTools !== false) {
                try {
                    tools = providerOptions.tools && providerOptions.tools.length > 0
                        ? providerOptions.tools as Tool[]
                        : toolRegistry.getAllToolDefinitions();

                    // Handle empty tools array
                    if (tools.length === 0) {
                        log.info('No tools found, attempting to initialize tools...');
                        // Tools are already initialized in the AIServiceManager constructor
                        // No need to initialize them again
                        tools = toolRegistry.getAllToolDefinitions();
                        log.info(`After initialization: ${tools.length} tools available`);
                    }

                    if (tools.length > 0) {
                        log.info(`Sending ${tools.length} tool definitions to Ollama`);
                    }
                } catch (error) {
                    const errorMsg = error instanceof Error ? error.message : String(error);
                    log.error(`Error preparing tools: ${errorMsg}`);
                    tools = []; // Empty fallback
                }
            }

            // Convert our message format to Ollama's format
            const convertedMessages = messagesToSend.map(msg => {
                const converted: OllamaMessage = {
                    role: msg.role,
                    content: msg.content
                };

                if (msg.tool_calls) {
                    converted.tool_calls = msg.tool_calls.map(tc => {
                        // For Ollama, arguments must be an object, not a string
                        let processedArgs: Record<string, unknown> = {};

                        // If arguments is a string, try to parse it as JSON
                        if (typeof tc.function.arguments === 'string') {
                            try {
                                processedArgs = JSON.parse(tc.function.arguments);
                            } catch (e) {
                                // If parsing fails, create an object with a single property
                                log.info(`Could not parse tool arguments as JSON: ${e}`);
                                processedArgs = { raw: tc.function.arguments };
                            }
                        } else if (typeof tc.function.arguments === 'object') {
                            processedArgs = tc.function.arguments as Record<string, unknown>;
                        }

                        return {
                            id: tc.id ?? '',
                            function: {
                                name: tc.function.name,
                                arguments: processedArgs
                            }
                        };
                    });
                }

                if (msg.tool_call_id) {
                    converted.tool_call_id = msg.tool_call_id;
                }

                if (msg.name) {
                    converted.name = msg.name;
                }

                return converted;
            });

            // Prepare base request options
            const baseRequestOptions: OllamaRequestOptions = {
                model: providerOptions.model,
                messages: convertedMessages,
                stream: opts.stream === true
            };

            // Add tool definitions if available
            if (tools && tools.length > 0 && providerOptions.enableTools !== false) {
                baseRequestOptions.tools = tools;
            }

            // Add any model-specific parameters
            if (providerOptions.options) {
                baseRequestOptions.options = providerOptions.options;
            }

            // If JSON response is expected, set format
            if (providerOptions.expectsJsonResponse) {
                baseRequestOptions.format = 'json';
            }

            log.info(`Sending request to Ollama with model: ${providerOptions.model}`);

            // Handle streaming vs non-streaming responses
            const client = this.getClient();

            if (opts.stream === true) {
                // Use streaming API
                return this.handleStreamingResponse(client, baseRequestOptions, opts, providerOptions);
            } else {
                // Use non-streaming API
                try {
                    log.info(`Sending non-streaming request to Ollama`);
                    // Create a properly typed request with stream: false
                    const chatRequest: ChatRequest & { stream?: false } = {
                        ...baseRequestOptions,
                        stream: false
                    };

                    const response = await client.chat(chatRequest);

                    log.info(`Received response from Ollama`);

                    // Transform tool calls if present
                    const toolCalls = this.transformToolCalls(response.message.tool_calls);

                    return {
                        text: response.message.content,
                        model: providerOptions.model,
                        provider: 'ollama',
                        tool_calls: toolCalls.length > 0 ? toolCalls : undefined
                    };
                } catch (error) {
                    const errorMsg = error instanceof Error ? error.message : String(error);
                    log.error(`Error in Ollama request: ${errorMsg}`);
                    throw error;
                }
            }
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            log.error(`Error in Ollama service: ${errorMsg}`);
            throw error;
        }
    }

    /**
     * Handle streaming response from Ollama
     *
     * Uses reusable stream handling utilities for processing
     */
    private async handleStreamingResponse(
        client: Ollama,
        requestOptions: OllamaRequestOptions,
        opts: ChatCompletionOptions,
        providerOptions: OllamaOptions
    ): Promise<ChatResponse> {
        log.info(`Using streaming mode with Ollama client`);

        // Log detailed information about the streaming setup
        log.info(`Ollama streaming details: model=${providerOptions.model}, streamCallback=${opts.streamCallback ? 'provided' : 'not provided'}`);

        // Create streaming request
        const streamingRequest = {
            ...requestOptions,
            stream: true as const
        };

        // Handle direct streamCallback if provided
        if (opts.streamCallback) {
            try {
                // Perform health check before streaming
                await performProviderHealthCheck(
                    async () => await client.list(),
                    this.getName()
                );

                log.info(`Making Ollama streaming request after successful health check`);
                // Get the stream iterator
                const streamIterator = await client.chat(streamingRequest);

                // Process the stream with our reusable utility
                const streamResult = await processProviderStream(
                    streamIterator,
                    {
                        providerName: this.getName(),
                        modelName: providerOptions.model
                    },
                    opts.streamCallback
                );

                // Create the final response after streaming is complete
                return {
                    text: streamResult.completeText,
                    model: providerOptions.model,
                    provider: this.getName(),
                    tool_calls: this.transformToolCalls(streamResult.toolCalls),
                    usage: extractStreamStats(streamResult.finalChunk, this.getName())
                };
            } catch (error) {
                log.error(`Error in Ollama streaming with callback: ${error}`);
                log.error(`Error details: ${error instanceof Error ? error.stack : 'No stack trace available'}`);
                throw error;
            }
        } else {
            // Create a stream handler using our reusable StreamProcessor
            const streamHandler = createStreamHandler(
                {
                    providerName: this.getName(),
                    modelName: providerOptions.model,
                    streamCallback: opts.streamCallback
                },
                async (callback) => {
                    let completeText = '';
                    let chunkCount = 0;
                    
                    // Create a response object that will be updated during streaming
                    const response: ChatResponse = {
                        text: '',
                        model: providerOptions.model,
                        provider: this.getName(),
                        tool_calls: []
                    };

                    try {
                        // Perform health check
                        await performProviderHealthCheck(
                            async () => await client.list(),
                            this.getName()
                        );

                        // Get the stream iterator
                        log.info(`Getting stream iterator from Ollama`);
                        const streamIterator = await client.chat(streamingRequest);

                        if (!streamIterator || typeof streamIterator[Symbol.asyncIterator] !== 'function') {
                            throw new Error('Invalid stream iterator returned');
                        }

                        // Process each chunk using our stream processor
                        for await (const chunk of streamIterator) {
                            chunkCount++;

                            // Process the chunk and update our accumulated text
                            const result = await StreamProcessor.processChunk(
                                chunk,
                                completeText,
                                chunkCount,
                                { providerName: this.getName(), modelName: providerOptions.model }
                            );

                            completeText = result.completeText;

                            // Extract any tool calls
                            const toolCalls = StreamProcessor.extractToolCalls(chunk);
                            // Update response tool calls if any are found
                            if (toolCalls.length > 0) {
                                // Update the response object's tool_calls for final return
                                response.tool_calls = toolCalls;
                            }

                            // Send to callback - directly pass the content without accumulating
                            await callback({
                                text: chunk.message?.content || '',
                                done: false,  // Add done property to satisfy StreamChunk
                                raw: chunk as unknown as Record<string, unknown>
                            });

                            // Log completion
                            if (chunk.done && !result.logged) {
                                log.info(`Reached final chunk after ${chunkCount} chunks, content length: ${completeText.length} chars`);
                            }
                        }

                        return completeText;
                    } catch (error) {
                        log.error(`Error in Ollama streaming: ${error}`);
                        log.error(`Error details: ${error instanceof Error ? error.stack : 'No stack trace available'}`);
                        throw error;
                    }
                }
            );

            // Return a response object with the stream handler
            return {
                text: '', // Initial text is empty, will be populated during streaming
                model: providerOptions.model,
                provider: this.getName(),
                stream: streamHandler as (callback: (chunk: StreamChunk) => Promise<void> | void) => Promise<string>
            };
        }
    }

    /**
     * Transform Ollama tool calls to the standard format expected by the pipeline
     * @param toolCalls Array of tool calls from Ollama response or undefined
     * @returns Standardized ToolCall array for consistent handling in the pipeline
     */
    private transformToolCalls(toolCalls: unknown[] | undefined): ToolCall[] {
        if (!toolCalls || !Array.isArray(toolCalls) || toolCalls.length === 0) {
            return [];
        }

        return toolCalls.map((toolCall, index) => {
            // Use type guards to safely access properties
            const toolCallObj = toolCall as { id?: string; function?: { name?: string; arguments?: string } };
            
            // Generate a unique ID if none is provided
            const id = typeof toolCallObj.id === 'string' ? toolCallObj.id : `tool-call-${Date.now()}-${index}`;
            
            // Safely extract function name and arguments with defaults
            const functionName = toolCallObj.function && typeof toolCallObj.function.name === 'string' 
                ? toolCallObj.function.name 
                : 'unknown_function';
                
            const functionArgs = toolCallObj.function && typeof toolCallObj.function.arguments === 'string'
                ? toolCallObj.function.arguments
                : '{}';

            // Return a properly typed ToolCall object

            return {
                id,
                type: 'function',
                function: {
                    name: functionName,
                    arguments: functionArgs
                }
            };
        });
    }

    /**
     * Adds a system message with feedback about tool execution status
     * @param messages The current message array
     * @param toolExecutionStatus Array of tool execution status objects
     * @returns Updated message array with feedback
     */
    private addToolExecutionFeedback(messages: Message[], toolExecutionStatus: ToolExecutionStatus[]): Message[] {
        if (!toolExecutionStatus || toolExecutionStatus.length === 0) {
            return messages;
        }

        // Create a copy of the messages
        const updatedMessages = [...messages];

        // Create a feedback message that explains what happened with each tool call
        let feedbackContent = `Tool execution feedback:\n\n`;

        toolExecutionStatus.forEach((status, index) => {
            // Add status for each tool
            const statusText = status.success ? 'successfully executed' : 'failed to execute';
            const toolName = status.name || 'unknown tool';

            feedbackContent += `Tool call ${index + 1} (${toolName}): ${statusText}\n`;

            // Add error information if available and tool failed
            if (!status.success && status.error) {
                feedbackContent += `Error: ${status.error}\n`;
                feedbackContent += `Please fix this issue in your next response or try a different approach.\n`;
            }

            feedbackContent += `\n`;
        });

        // Add feedback message to the conversation
        updatedMessages.push({
            role: 'system',
            content: feedbackContent
        });

        log.info(`Added tool execution feedback: ${toolExecutionStatus.length} statuses`);
        return updatedMessages;
    }

    /**
     * Clear cached Ollama client to force recreation with new settings
     */
    clearCache(): void {
        // Ollama service doesn't maintain a persistent client like OpenAI/Anthropic
        // but we can clear any future cached state here if needed
        log.info('Ollama client cache cleared (no persistent client to clear)');
    }
}
