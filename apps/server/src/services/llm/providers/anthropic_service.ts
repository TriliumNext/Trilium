import options from '../../options.js';
import { BaseAIService } from '../base_ai_service.js';
import type { ChatCompletionOptions, ChatResponse, Message, StreamChunk } from '../ai_interface.js';
import { PROVIDER_CONSTANTS } from '../constants/provider_constants.js';
import type { AnthropicOptions } from './provider_options.js';
import { getAnthropicOptions } from './providers.js';
import log from '../../log.js';
import Anthropic from '@anthropic-ai/sdk';
import { SEARCH_CONSTANTS } from '../constants/search_constants.js';
import type { ToolCall } from '../tools/tool_interfaces.js';

interface AnthropicMessage extends Omit<Message, "content"> {
    content: MessageContent[] | string;
}

interface MessageContent {
    type: "text" | "tool_use" | "tool_result";
    text?: string;
    id?: string;
    name?: string;
    content?: string;
    tool_use_id?: string;
    input?: string | Record<string, unknown>;
}

export class AnthropicService extends BaseAIService {
    private client: any = null;

    constructor() {
        super('Anthropic');
    }

    override isAvailable(): boolean {
        return super.isAvailable() && !!options.getOption('anthropicApiKey');
    }

    private getClient(apiKey: string, baseUrl: string, apiVersion?: string, betaVersion?: string): any {
        if (!this.client) {
            this.client = new Anthropic({
                apiKey,
                baseURL: baseUrl,
                defaultHeaders: {
                    'anthropic-version': apiVersion || PROVIDER_CONSTANTS.ANTHROPIC.API_VERSION,
                    'anthropic-beta': betaVersion || PROVIDER_CONSTANTS.ANTHROPIC.BETA_VERSION
                }
            });
        }
        return this.client;
    }

    async generateChatCompletion(messages: Message[], opts: ChatCompletionOptions = {}): Promise<ChatResponse> {
        if (!this.isAvailable()) {
            throw new Error('Anthropic service is not available. Check API key and AI settings.');
        }

        // Get provider-specific options from the central provider manager
        const providerOptions = getAnthropicOptions(opts);

        // Log provider metadata if available
        if (providerOptions.providerMetadata) {
            log.info(`Using model ${providerOptions.model} from provider ${providerOptions.providerMetadata.provider}`);

            // Log capabilities if available
            const capabilities = providerOptions.providerMetadata.capabilities;
            if (capabilities) {
                log.info(`Model capabilities: ${JSON.stringify(capabilities)}`);
            }
        }

        // Get system prompt
        const systemPrompt = this.getSystemPrompt(providerOptions.systemPrompt || options.getOption('aiSystemPrompt'));

        // Format messages for Anthropic's API
        const anthropicMessages = this.formatMessages(messages);

        try {
            // Initialize the Anthropic client
            const client = this.getClient(
                providerOptions.apiKey,
                providerOptions.baseUrl,
                providerOptions.apiVersion,
                providerOptions.betaVersion
            );

            // Confirm API key is configured without logging any part of the key
            log.info(`[DEBUG] Anthropic API key is ${providerOptions.apiKey ? 'configured' : 'not configured'}`);

            log.info(`Using Anthropic API with model: ${providerOptions.model}`);

            // Configure request parameters
            const requestParams: any = {
                model: providerOptions.model,
                messages: anthropicMessages,
                system: systemPrompt,
                max_tokens: providerOptions.max_tokens || SEARCH_CONSTANTS.LIMITS.DEFAULT_MAX_TOKENS,
                temperature: providerOptions.temperature,
                top_p: providerOptions.top_p,
                stream: !!providerOptions.stream
            };

            // Add tools support if provided
            if (opts.tools && opts.tools.length > 0) {
                log.info(`Adding ${opts.tools.length} tools to Anthropic request`);

                // Convert OpenAI-style function tools to Anthropic format
                const anthropicTools = this.convertToolsToAnthropicFormat(opts.tools);

                requestParams.tools = anthropicTools;

                // Add tool_choice parameter if specified
                if (opts.tool_choice) {
                    if (typeof opts.tool_choice === 'string' && opts.tool_choice === 'auto') {
                        requestParams.tool_choice = 'auto';
                    } else if (typeof opts.tool_choice === 'string' && opts.tool_choice === 'none') {
                        requestParams.tool_choice = 'none';
                    } else if (typeof opts.tool_choice === 'object' && opts.tool_choice.function) {
                        // Map from OpenAI format to Anthropic format
                        requestParams.tool_choice = opts.tool_choice.function.name;
                    } else {
                        requestParams.tool_choice = opts.tool_choice;
                    }
                }
            }

            // Log request summary
            log.info(`Making ${providerOptions.stream ? 'streaming' : 'non-streaming'} request to Anthropic API with model: ${providerOptions.model}`);


            // Handle streaming responses
            if (providerOptions.stream) {
                return this.handleStreamingResponse(client, requestParams, opts, providerOptions);
            } else {
                // Non-streaming request
                const response = await client.messages.create(requestParams);

                // Log the complete response for debugging
                log.info(`[DEBUG] Complete Anthropic API response: ${JSON.stringify(response, null, 2)}`);

                // Get the assistant's response text from the content blocks
                const textContent = response.content
                    .filter((block: any) => block.type === 'text')
                    .map((block: any) => block.text)
                    .join('');

                // Process tool calls if any are present in the response
                let toolCalls: ToolCall[] | null = null;
                if (response.content) {
                    const toolBlocks = response.content.filter((block: any) =>
                        block.type === 'tool_use' ||
                        (block.type === 'tool_result' && block.tool_use_id)
                    );

                    if (toolBlocks.length > 0) {
                        log.info(`[DEBUG] Found ${toolBlocks.length} tool-related blocks in response`);

                        toolCalls = toolBlocks.map((block: any) => {
                            if (block.type === 'tool_use') {
                                log.info(`[DEBUG] Processing tool_use block: ${JSON.stringify(block, null, 2)}`);

                                // Convert Anthropic tool_use format to standard format expected by our app
                                return {
                                    id: block.id,
                                    type: 'function', // Convert back to function type for internal use
                                    function: {
                                        name: block.name,
                                        arguments: JSON.stringify(block.input || {})
                                    }
                                };
                            }
                            return null;
                        }).filter(Boolean);

                        log.info(`Extracted ${toolCalls?.length} tool calls from Anthropic response`);
                    }
                }

                return {
                    text: textContent,
                    model: response.model,
                    provider: this.getName(),
                    tool_calls: toolCalls,
                    usage: {
                        // Anthropic provides token counts in the response
                        promptTokens: response.usage?.input_tokens,
                        completionTokens: response.usage?.output_tokens,
                        totalTokens: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0)
                    }
                };
            }
        } catch (error) {
            log.error(`Anthropic service error: ${error}`);
            throw error;
        }
    }

    /**
     * Handle streaming response from Anthropic
     *
     * Uses the MessageStream class from the Anthropic SDK
     */
    private async handleStreamingResponse(
        client: Anthropic,
        params: any,
        opts: ChatCompletionOptions,
        providerOptions: AnthropicOptions
    ): Promise<ChatResponse> {
        // Create a ChatResponse object that follows our interface requirements
        const response: ChatResponse = {
            text: '',
            model: providerOptions.model,
            provider: this.getName(),

            // Define the stream function that will be used by consumers
            stream: async (callback) => {
                // Accumulated response
                let fullText = '';
                let toolCalls: any[] = [];

                try {
                    log.info(`Creating Anthropic streaming request for model: ${providerOptions.model}`);

                    // Request options to pass to the Anthropic SDK
                    const requestOptions = {};

                    // Create a message stream using the SDK's stream method
                    // This properly types the streaming response
                    const stream = client.messages.stream({
                        ...params,
                    }, requestOptions);

                    // Track active tool calls by ID
                    const activeToolCalls = new Map<string, any>();

                    // Listen for text deltas
                    stream.on('text', (textDelta) => {
                        fullText += textDelta;

                        // Pass the text chunk to the caller
                        callback({
                            text: textDelta,
                            done: false,
                            raw: { type: 'text', text: textDelta }
                        });
                    });

                    // Listen for content blocks starting - used for tool calls
                    stream.on('contentBlock', async (block) => {
                        if (block.type === 'tool_use') {
                            // Create a structured tool call in our expected format
                            const toolCall = {
                                id: block.id,
                                type: 'function',
                                function: {
                                    name: block.name,
                                    arguments: JSON.stringify(block.input || {})
                                }
                            };

                            // Store in our active tools map
                            activeToolCalls.set(block.id, toolCall);

                            // Notify about tool execution start
                            await callback({
                                text: '',
                                done: false,
                                toolExecution: {
                                    type: 'start',
                                    tool: {
                                        name: toolCall.function.name,
                                        arguments: JSON.parse(toolCall.function.arguments || '{}')
                                    }
                                },
                                raw: { ...block } as unknown as Record<string, unknown>
                            });
                        }
                    });

                    // Listen for input JSON updates (tool arguments)
                    stream.on('inputJson', async (jsonFragment) => {
                        // Find the most recent tool call
                        if (activeToolCalls.size > 0) {
                            const lastToolId = Array.from(activeToolCalls.keys()).pop();
                            if (lastToolId) {
                                const toolCall = activeToolCalls.get(lastToolId);

                                // Update the arguments
                                if (toolCall.function.arguments === '{}') {
                                    toolCall.function.arguments = jsonFragment;
                                } else {
                                    toolCall.function.arguments += jsonFragment;
                                }

                                // Notify about the update
                                await callback({
                                    text: '',
                                    done: false,
                                    toolExecution: {
                                        type: 'update',
                                        tool: toolCall
                                    },
                                    raw: { type: 'json_fragment', data: jsonFragment } as Record<string, unknown>
                                });
                            }
                        }
                    });

                    // Listen for message completion
                    stream.on('message', async (message) => {
                        // Process any tool calls from the message
                        if (message.content) {
                            // Find tool use blocks in the content
                            const toolUseBlocks = message.content.filter(
                                block => block.type === 'tool_use'
                            );

                            // Convert tool use blocks to our expected format
                            if (toolUseBlocks.length > 0) {
                                toolCalls = toolUseBlocks.map(block => {
                                    if (block.type === 'tool_use') {
                                        return {
                                            id: block.id,
                                            type: 'function',
                                            function: {
                                                name: block.name,
                                                arguments: JSON.stringify(block.input || {})
                                            }
                                        };
                                    }
                                    return null;
                                }).filter(Boolean);

                                // For any active tool calls, mark them as complete
                                for (const [toolId, toolCall] of activeToolCalls.entries()) {
                                    await callback({
                                        text: '',
                                        done: false,
                                        toolExecution: {
                                            type: 'complete',
                                            tool: toolCall
                                        },
                                        raw: { type: 'tool_complete', toolId }
                                    });
                                }
                            }

                            // Extract text from text blocks
                            const textBlocks = message.content.filter(
                                block => block.type === 'text'
                            ) as Array<{ type: 'text', text: string }>;

                            // Update fullText if needed
                            if (textBlocks.length > 0) {
                                const allText = textBlocks.map(block => block.text).join('');
                                // Only update if different from what we've accumulated
                                if (allText !== fullText) {
                                    fullText = allText;
                                }
                            }
                        }
                    });

                    // Listen for the final message
                    stream.on('finalMessage', async (message) => {
                        // Set the response text and tool calls
                        response.text = fullText;
                        if (toolCalls.length > 0) {
                            response.tool_calls = toolCalls;
                        }

                        // Send final completion with full text and all tool calls
                        await callback({
                            text: typeof message.content === 'string' ?
                                message.content :
                                message.content
                                  .filter((block: any) => block.type === 'text')
                                  .map((block: any) => block.text)
                                  .join(''),
                            done: message.role === 'assistant',
                            raw: { ...message } as unknown as Record<string, unknown>
                        });
                    });

                    // Listen for errors
                    stream.on('error', (error) => {
                        log.error(`Anthropic streaming error: ${error}`);
                        throw error;
                    });

                    // Wait for the stream to complete
                    await stream.done();

                    return fullText;
                } catch (error) {
                    log.error(`Anthropic streaming error: ${error}`);

                    // Enhanced error diagnostic for Anthropic SDK errors
                    if (error instanceof Error) {
                        log.error(`Error name: ${error.name}`);
                        log.error(`Error message: ${error.message}`);

                        // Type cast to access potential Anthropic API error properties
                        const apiError = error as any;
                        if (apiError.status) {
                            log.error(`API status: ${apiError.status}`);
                        }
                        if (apiError.error) {
                            log.error(`API error details: ${JSON.stringify(apiError.error)}`);
                        }
                    }

                    throw error;
                }
            }
        };

        return response;
    }

    /**
     * Format messages for the Anthropic API
     */
    private formatMessages(messages: Message[]): AnthropicMessage[] {
        const anthropicMessages: AnthropicMessage[] = [];

        // Process each message
        for (const msg of messages) {
            if (msg.role === 'system') {
                // System messages are handled separately in the API call
                continue;
            } else if (msg.role === 'user') {
                // Convert user message to Anthropic format
                anthropicMessages.push({
                    role: msg.role,
                    content: msg.content
                });
            } else if (msg.role === 'assistant') {
                // Assistant messages need special handling for tool_calls
                if (msg.tool_calls && msg.tool_calls.length > 0) {
                    // Create content blocks array for tool calls
                    const content: MessageContent[] = [];

                    // Add text content if present
                    if (msg.content) {
                        content.push({
                            type: 'text',
                            text: msg.content
                        });
                    }

                    // Add tool_use blocks for each tool call
                    for (const toolCall of msg.tool_calls) {
                        if (toolCall.function && toolCall.function.name) {
                            try {
                                // Parse arguments if they're a string
                                let parsedArgs = toolCall.function.arguments;
                                if (typeof parsedArgs === 'string') {
                                    try {
                                        parsedArgs = JSON.parse(parsedArgs);
                                    } catch (e) {
                                        // Keep as string if parsing fails
                                        log.info(`Could not parse tool arguments as JSON: ${e}`);
                                    }
                                }

                                // Add tool_use block
                                content.push({
                                    type: 'tool_use',
                                    id: toolCall.id || `tool_${Date.now()}`,
                                    name: toolCall.function.name,
                                    input: parsedArgs
                                });
                            } catch (e) {
                                log.error(`Error processing tool call: ${e}`);
                            }
                        }
                    }

                    // Add the assistant message with content blocks
                    anthropicMessages.push({
                        role: 'assistant',
                        content
                    });
                } else {
                    // Regular assistant message without tool calls
                    anthropicMessages.push({
                        role: 'assistant',
                        content: msg.content
                    });
                }
            } else if (msg.role === 'tool') {
                // Tool response messages need to be properly formatted as tool_result
                if (msg.tool_call_id) {
                    // Format as a tool_result message
                    anthropicMessages.push({
                        role: 'user',
                        content: [
                            {
                                type: 'tool_result',
                                tool_use_id: msg.tool_call_id,
                                content: msg.content
                            }
                        ]
                    });
                } else {
                    // Fallback if no tool_call_id is present
                    anthropicMessages.push({
                        role: 'user',
                        content: msg.content
                    });
                }
            }
        }

        return anthropicMessages;
    }

    /**
     * Convert OpenAI-style function tools to Anthropic format
     * OpenAI uses: { type: "function", function: { name, description, parameters } }
     * Anthropic uses: { name, description, input_schema }
     */
    private convertToolsToAnthropicFormat(tools: any[]): any[] {
        if (!tools || tools.length === 0) {
            return [];
        }

        log.info(`[TOOL DEBUG] Converting ${tools.length} tools to Anthropic format`);

        // Filter out invalid tools
        const validTools = tools.filter(tool => {
            if (!tool || typeof tool !== 'object') {
                log.error(`Invalid tool format (not an object)`);
                return false;
            }

            // For function tools, validate required fields
            if (tool.type === 'function') {
                if (!tool.function || !tool.function.name) {
                    log.error(`Function tool missing required fields`);
                    return false;
                }
            }

            return true;
        });

        if (validTools.length < tools.length) {
            log.info(`Filtered out ${tools.length - validTools.length} invalid tools`);
        }

        // Convert tools to Anthropic format
        const convertedTools = validTools.map((tool: any) => {
            // Convert from OpenAI format to Anthropic format
            if (tool.type === 'function' && tool.function) {
                log.info(`[TOOL DEBUG] Converting function tool: ${tool.function.name}`);

                // Check the parameters structure
                if (tool.function.parameters) {
                    log.info(`[TOOL DEBUG] Parameters for ${tool.function.name}:`);
                    log.info(`[TOOL DEBUG] - Type: ${tool.function.parameters.type}`);
                    log.info(`[TOOL DEBUG] - Properties: ${JSON.stringify(tool.function.parameters.properties || {})}`);
                    log.info(`[TOOL DEBUG] - Required: ${JSON.stringify(tool.function.parameters.required || [])}`);

                    // Check if the required array is present and properly populated
                    if (!tool.function.parameters.required || !Array.isArray(tool.function.parameters.required)) {
                        log.error(`[TOOL DEBUG] WARNING: Tool ${tool.function.name} missing required array in parameters`);
                    } else if (tool.function.parameters.required.length === 0) {
                        log.error(`[TOOL DEBUG] WARNING: Tool ${tool.function.name} has empty required array - Anthropic may send empty inputs`);
                    }
                } else {
                    log.error(`[TOOL DEBUG] WARNING: Tool ${tool.function.name} has no parameters defined`);
                }

                return {
                    name: tool.function.name,
                    description: tool.function.description || '',
                    input_schema: tool.function.parameters || {}
                };
            }

            // Handle already converted Anthropic format (from our temporary fix)
            if (tool.type === 'custom' && tool.custom) {
                log.info(`[TOOL DEBUG] Converting custom tool: ${tool.custom.name}`);
                return {
                    name: tool.custom.name,
                    description: tool.custom.description || '',
                    input_schema: tool.custom.parameters || {}
                };
            }

            // If the tool is already in the correct Anthropic format
            if (tool.name && (tool.input_schema || tool.parameters)) {
                log.info(`[TOOL DEBUG] Tool already in Anthropic format: ${tool.name}`);
                return {
                    name: tool.name,
                    description: tool.description || '',
                    input_schema: tool.input_schema || tool.parameters
                };
            }

            log.error(`Unhandled tool format encountered`);
            return null;
        }).filter(Boolean); // Filter out any null values

        return convertedTools;
    }

    /**
     * Clear cached Anthropic client to force recreation with new settings
     */
    clearCache(): void {
        this.client = null;
        log.info('Anthropic client cache cleared');
    }
}
