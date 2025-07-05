import { BasePipelineStage } from '../pipeline_stage.js';
import type { LLMCompletionInput } from '../interfaces.js';
import type { ChatCompletionOptions, ChatResponse, StreamChunk } from '../../ai_interface.js';
import aiServiceManager from '../../ai_service_manager.js';
import toolRegistry from '../../tools/tool_registry.js';
import log from '../../../log.js';

/**
 * Pipeline stage for LLM completion with enhanced streaming support
 */
export class LLMCompletionStage extends BasePipelineStage<LLMCompletionInput, { response: ChatResponse }> {
    constructor() {
        super('LLMCompletion');
    }

    /**
     * Generate LLM completion using the AI service
     *
     * This enhanced version supports better streaming by forwarding raw provider data
     * and ensuring consistent handling of stream options.
     */
    protected async process(input: LLMCompletionInput): Promise<{ response: ChatResponse }> {
        const { messages, options } = input;

        // Add detailed logging about the input messages, particularly useful for tool follow-ups
        log.info(`========== LLM COMPLETION STAGE - INPUT MESSAGES ==========`);
        log.info(`Total input messages: ${messages.length}`);

        // Log if tool messages are present (used for follow-ups)
        const toolMessages = messages.filter(m => m.role === 'tool');
        if (toolMessages.length > 0) {
            log.info(`Contains ${toolMessages.length} tool result messages - likely a tool follow-up request`);
        }

        // Log the last few messages to understand conversation context
        const lastMessages = messages.slice(-3);
        lastMessages.forEach((msg, idx) => {
            const msgPosition = messages.length - lastMessages.length + idx;
            log.info(`Message ${msgPosition} (${msg.role}): ${msg.content?.substring(0, 150)}${msg.content?.length > 150 ? '...' : ''}`);
            if (msg.tool_calls) {
                log.info(`  Contains ${msg.tool_calls.length} tool calls`);
            }
            if (msg.tool_call_id) {
                log.info(`  Tool call ID: ${msg.tool_call_id}`);
            }
        });

        // Log completion options
        log.info(`LLM completion options: ${JSON.stringify({
            model: options.model || 'default',
            temperature: options.temperature,
            enableTools: options.enableTools,
            stream: options.stream,
            hasToolExecutionStatus: !!options.toolExecutionStatus
        })}`);

        // Create a deep copy of options to avoid modifying the original
        const updatedOptions: ChatCompletionOptions = JSON.parse(JSON.stringify(options));

        // Handle stream option explicitly
        if (options.stream !== undefined) {
            updatedOptions.stream = options.stream === true;
            log.info(`[LLMCompletionStage] Stream explicitly set to: ${updatedOptions.stream}`);
        }

        // Add capture of raw provider data for streaming
        if (updatedOptions.stream) {
            // Add a function to capture raw provider data in stream chunks
            const originalStreamCallback = updatedOptions.streamCallback;
            updatedOptions.streamCallback = async (text, done, rawProviderData) => {
                // Create an enhanced chunk with the raw provider data
                const enhancedChunk = {
                    text,
                    done,
                    // Include raw provider data if available
                    raw: rawProviderData
                };

                // Call the original callback if provided
                if (originalStreamCallback) {
                    return originalStreamCallback(text, done, enhancedChunk);
                }
            };
        }

        // Check if tools should be enabled
        if (updatedOptions.enableTools !== false) {
            const toolDefinitions = toolRegistry.getAllToolDefinitions();
            if (toolDefinitions.length > 0) {
                updatedOptions.enableTools = true;
                updatedOptions.tools = toolDefinitions;
                log.info(`========== ADDING TOOLS TO LLM REQUEST ==========`);
                log.info(`Tool count: ${toolDefinitions.length}`);
                log.info(`Tool names: ${toolDefinitions.map(t => t.function.name).join(', ')}`);
                log.info(`enableTools option: ${updatedOptions.enableTools}`);
                log.info(`===============================================`);
            } else {
                log.error(`========== NO TOOLS AVAILABLE FOR LLM ==========`);
                log.error(`Tool registry returned 0 definitions`);
                log.error(`This means the LLM will NOT have access to tools`);
                log.error(`Check tool initialization and registration`);
                log.error(`==============================================`);
            }
        } else {
            log.info(`Tools explicitly disabled (enableTools: ${updatedOptions.enableTools})`);
        }

        // Determine which provider to use
        let selectedProvider = '';
        if (updatedOptions.providerMetadata?.provider) {
            selectedProvider = updatedOptions.providerMetadata.provider;
            log.info(`Using provider ${selectedProvider} from metadata for model ${updatedOptions.model}`);
        }

        log.info(`Generating LLM completion, provider: ${selectedProvider || 'auto'}, model: ${updatedOptions?.model || 'default'}`);

        // Use specific provider if available
        if (selectedProvider && aiServiceManager.isProviderAvailable(selectedProvider)) {
            const service = await aiServiceManager.getService(selectedProvider);
            log.info(`[LLMCompletionStage] Using specific service for ${selectedProvider}`);

            // Generate completion and wrap with enhanced stream handling
            const response = await service.generateChatCompletion(messages, updatedOptions);

            // If streaming is enabled, enhance the stream method
            if (response.stream && typeof response.stream === 'function' && updatedOptions.stream) {
                const originalStream = response.stream;

                // Replace the stream method with an enhanced version that captures and forwards raw data
                response.stream = async (callback) => {
                    return originalStream(async (chunk) => {
                        // Forward the chunk with any additional provider-specific data
                        // Create an enhanced chunk with provider info
                        const enhancedChunk: StreamChunk = {
                            ...chunk,
                            // If the provider didn't include raw data, add minimal info
                            raw: chunk.raw || {
                                provider: selectedProvider,
                                model: response.model
                            }
                        };
                        return callback(enhancedChunk);
                    });
                };
            }

            // Add enhanced logging for debugging tool execution follow-ups
            if (toolMessages.length > 0) {
                if (response.tool_calls && response.tool_calls.length > 0) {
                    log.info(`Response contains ${response.tool_calls.length} tool calls`);
                    response.tool_calls.forEach((toolCall: any, idx: number) => {
                        log.info(`Tool call ${idx + 1}: ${toolCall.function?.name || 'unnamed'}`);
                        const args = typeof toolCall.function?.arguments === 'string'
                            ? toolCall.function?.arguments
                            : JSON.stringify(toolCall.function?.arguments);
                        log.info(`Arguments: ${args?.substring(0, 100) || '{}'}`);
                    });
                } else {
                    log.info(`Response contains no tool calls - plain text response`);
                }

                if (toolMessages.length > 0 && !response.tool_calls) {
                    log.info(`This appears to be a final response after tool execution (no new tool calls)`);
                } else if (toolMessages.length > 0 && response.tool_calls && response.tool_calls.length > 0) {
                    log.info(`This appears to be a continued tool execution flow (tools followed by more tools)`);
                }
            }

            return { response };
        }

        // Use auto-selection if no specific provider
        log.info(`[LLMCompletionStage] Using auto-selected service`);
        const response = await aiServiceManager.generateChatCompletion(messages, updatedOptions);

        // Add similar stream enhancement for auto-selected provider
        if (response.stream && typeof response.stream === 'function' && updatedOptions.stream) {
            const originalStream = response.stream;
            response.stream = async (callback) => {
                return originalStream(async (chunk) => {
                    // Create an enhanced chunk with provider info
                    const enhancedChunk: StreamChunk = {
                        ...chunk,
                        raw: chunk.raw || {
                            provider: response.provider,
                            model: response.model
                        }
                    };
                    return callback(enhancedChunk);
                });
            };
        }

        // Add enhanced logging for debugging tool execution follow-ups
        if (toolMessages.length > 0) {
            if (response.tool_calls && response.tool_calls.length > 0) {
                log.info(`Response contains ${response.tool_calls.length} tool calls`);
                response.tool_calls.forEach((toolCall: any, idx: number) => {
                    log.info(`Tool call ${idx + 1}: ${toolCall.function?.name || 'unnamed'}`);
                    const args = typeof toolCall.function?.arguments === 'string'
                        ? toolCall.function?.arguments
                        : JSON.stringify(toolCall.function?.arguments);
                    log.info(`Arguments: ${args?.substring(0, 100) || '{}'}`);
                });
            } else {
                log.info(`Response contains no tool calls - plain text response`);
            }

            if (toolMessages.length > 0 && !response.tool_calls) {
                log.info(`This appears to be a final response after tool execution (no new tool calls)`);
            } else if (toolMessages.length > 0 && response.tool_calls && response.tool_calls.length > 0) {
                log.info(`This appears to be a continued tool execution flow (tools followed by more tools)`);
            }
        }

        return { response };
    }
}
