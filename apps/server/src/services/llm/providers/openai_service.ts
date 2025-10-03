import options from '../../options.js';
import { BaseAIService } from '../base_ai_service.js';
import type { ChatCompletionOptions, ChatResponse, Message, StreamChunk } from '../ai_interface.js';
import { getOpenAIOptions } from './providers.js';
import OpenAI from 'openai';
import { PROVIDER_PROMPTS } from '../constants/llm_prompt_constants.js';
import log from '../../log.js';
import { ChatCompletionMessageFunctionToolCall } from 'openai/resources/index.mjs';

export class OpenAIService extends BaseAIService {
    private openai: OpenAI | null = null;

    constructor() {
        super('OpenAI');
    }

    override isAvailable(): boolean {
        // Make API key optional to support OpenAI-compatible endpoints that don't require authentication
        // The provider is considered available as long as the parent checks pass
        return super.isAvailable();
    }

    private getClient(apiKey: string, baseUrl?: string): OpenAI {
        if (!this.openai) {
            this.openai = new OpenAI({
                apiKey,
                baseURL: baseUrl
            });
        }
        return this.openai;
    }

    async generateChatCompletion(messages: Message[], opts: ChatCompletionOptions = {}): Promise<ChatResponse> {
        if (!this.isAvailable()) {
            throw new Error('OpenAI service is not available. Check AI settings.');
        }

        // Get provider-specific options from the central provider manager
        const providerOptions = getOpenAIOptions(opts);

        // Initialize the OpenAI client
        const client = this.getClient(providerOptions.apiKey, providerOptions.baseUrl);

        // Get base system prompt
        let systemPrompt = this.getSystemPrompt(providerOptions.systemPrompt || options.getOption('aiSystemPrompt'));

        // Check if tools are enabled for this request
        const willUseTools = providerOptions.enableTools && providerOptions.tools && providerOptions.tools.length > 0;

        // Add tool instructions to system prompt if tools are enabled
        if (willUseTools && PROVIDER_PROMPTS.OPENAI.TOOL_INSTRUCTIONS) {
            log.info('Adding tool instructions to system prompt for OpenAI');
            systemPrompt = `${systemPrompt}\n\n${PROVIDER_PROMPTS.OPENAI.TOOL_INSTRUCTIONS}`;
        }

        // Ensure we have a system message
        const systemMessageExists = messages.some(m => m.role === 'system');
        const messagesWithSystem = systemMessageExists
            ? messages
            : [{ role: 'system', content: systemPrompt }, ...messages];

        try {
            // Create params object for the OpenAI SDK
            const params: OpenAI.Chat.ChatCompletionCreateParams = {
                model: providerOptions.model,
                messages: messagesWithSystem as OpenAI.Chat.ChatCompletionMessageParam[],
                temperature: providerOptions.temperature,
                max_tokens: providerOptions.max_tokens,
                stream: providerOptions.stream,
                top_p: providerOptions.top_p,
                frequency_penalty: providerOptions.frequency_penalty,
                presence_penalty: providerOptions.presence_penalty
            };

            // Add tools if enabled
            if (providerOptions.enableTools && providerOptions.tools && providerOptions.tools.length > 0) {
                params.tools = providerOptions.tools as OpenAI.Chat.ChatCompletionTool[];
            }

            if (providerOptions.tool_choice) {
                params.tool_choice = providerOptions.tool_choice as OpenAI.Chat.ChatCompletionToolChoiceOption;
            }

            // Log the request parameters
            log.info(`OpenAI API Request: ${JSON.stringify({
                endpoint: 'chat.completions.create',
                model: params.model,
                messages: params.messages,
                temperature: params.temperature,
                max_tokens: params.max_tokens,
                stream: params.stream,
                tools: params.tools,
                tool_choice: params.tool_choice
            }, null, 2)}`);

            // If streaming is requested
            if (providerOptions.stream) {
                params.stream = true;

                // Get stream from OpenAI SDK
                const stream = await client.chat.completions.create(params);
                log.info('OpenAI API Stream Started');

                // Create a closure to hold accumulated tool calls
                const accumulatedToolCalls: OpenAI.Chat.ChatCompletionMessageFunctionToolCall[] = [];

                // Return a response with the stream handler
                const response: ChatResponse = {
                    text: '', // Initial empty text, will be populated during streaming
                    model: params.model,
                    provider: this.getName(),
                    // Add tool_calls property that will be populated during streaming
                    tool_calls: [],
                    stream: async (callback) => {
                        let completeText = '';

                        try {
                            // Process the stream
                            if (Symbol.asyncIterator in stream) {
                                for await (const chunk of stream as AsyncIterable<OpenAI.Chat.ChatCompletionChunk>) {
                                    // Log each chunk received from OpenAI
                                    // Use info level as debug is not available
                                    log.info(`OpenAI API Stream Chunk: ${JSON.stringify(chunk, null, 2)}`);

                                    const content = chunk.choices[0]?.delta?.content || '';
                                    const isDone = !!chunk.choices[0]?.finish_reason;

                                    // Check for tool calls in the delta
                                    const deltaToolCalls = chunk.choices[0]?.delta?.tool_calls;

                                    if (deltaToolCalls) {
                                        // Process and accumulate tool calls from this chunk
                                        for (const deltaToolCall of deltaToolCalls) {
                                            const toolCallId = deltaToolCall.index;

                                            // Initialize or update the accumulated tool call
                                            if (!accumulatedToolCalls[toolCallId]) {
                                                accumulatedToolCalls[toolCallId] = {
                                                    id: deltaToolCall.id || `call_${toolCallId}`,
                                                    type: deltaToolCall.type || 'function',
                                                    function: {
                                                        name: '',
                                                        arguments: ''
                                                    }
                                                };
                                            }

                                            // Update function name if present
                                            if (deltaToolCall.function?.name) {
                                                accumulatedToolCalls[toolCallId].function.name =
                                                    deltaToolCall.function.name;
                                            }

                                            // Append to function arguments if present
                                            if (deltaToolCall.function?.arguments) {
                                                accumulatedToolCalls[toolCallId].function.arguments +=
                                                    deltaToolCall.function.arguments;
                                            }
                                        }

                                        // Important: Update the response's tool_calls with accumulated tool calls
                                        response.tool_calls = accumulatedToolCalls.filter(Boolean);
                                    }

                                    if (content) {
                                        completeText += content;
                                    }

                                    // Send the chunk to the caller with raw data and any accumulated tool calls
                                    const streamChunk: StreamChunk = {
                                        text: content,
                                        done: isDone,
                                        raw: chunk as unknown as Record<string, unknown>
                                    };

                                    // Add accumulated tool calls to raw data for compatibility with tool execution display
                                    if (accumulatedToolCalls.length > 0) {
                                        // Add tool calls to raw data for proper display
                                        streamChunk.raw = {
                                            ...streamChunk.raw as object,
                                            tool_calls: accumulatedToolCalls.filter(Boolean)
                                        } as Record<string, unknown>;
                                    }

                                    await callback(streamChunk);

                                    if (isDone) {
                                        console.log('OpenAI API Stream Complete. Final text length:', completeText.length);
                                        if (accumulatedToolCalls.length > 0) {
                                            console.log('OpenAI API Tool Calls:', JSON.stringify(accumulatedToolCalls, null, 2));
                                        }
                                        break;
                                    }
                                }
                            } else {
                                // Fallback for non-iterable response
                                console.warn('Stream is not iterable, falling back to non-streaming response');
                                console.log('OpenAI API Non-iterable Stream Response:', JSON.stringify(stream, null, 2));

                                if ('choices' in stream) {
                                    const content = stream.choices[0]?.message?.content || '';
                                    completeText = content;

                                    // Check if there are tool calls in the non-stream response
                                    const toolCalls = stream.choices[0]?.message?.tool_calls as ChatCompletionMessageFunctionToolCall[];
                                    if (toolCalls) {
                                        response.tool_calls = toolCalls;
                                        console.log('OpenAI API Tool Calls in Non-iterable Response:', JSON.stringify(toolCalls, null, 2));
                                    }

                                    await callback({
                                        text: content,
                                        done: true,
                                        raw: stream as unknown as Record<string, unknown>,
                                        tool_calls: toolCalls
                                    });
                                }
                            }
                        } catch (error) {
                            console.error('Error processing stream:', error);
                            throw error;
                        }

                        // Update the response's text with the complete text
                        response.text = completeText;

                        // Return the complete text
                        return completeText;
                    }
                };

                return response;
            } else {
                // Non-streaming response
                params.stream = false;

                const completion = await client.chat.completions.create(params);

                // Log the full response from OpenAI
                console.log('OpenAI API Response:', JSON.stringify(completion, null, 2));

                if (!('choices' in completion)) {
                    throw new Error('Unexpected response format from OpenAI API');
                }

                return {
                    text: completion.choices[0].message.content || '',
                    model: completion.model,
                    provider: this.getName(),
                    usage: {
                        promptTokens: completion.usage?.prompt_tokens,
                        completionTokens: completion.usage?.completion_tokens,
                        totalTokens: completion.usage?.total_tokens
                    },
                    tool_calls: completion.choices[0].message.tool_calls as ChatCompletionMessageFunctionToolCall[]
                };
            }
        } catch (error) {
            console.error('OpenAI service error:', error);
            throw error;
        }
    }

    /**
     * Clear cached OpenAI client to force recreation with new settings
     */
    clearCache(): void {
        this.openai = null;
        log.info('OpenAI client cache cleared');
    }
}
