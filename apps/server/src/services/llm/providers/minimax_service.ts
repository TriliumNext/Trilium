import options from '../../options.js';
import { BaseAIService } from '../base_ai_service.js';
import type { ChatCompletionOptions, ChatResponse, Message } from '../ai_interface.js';
import { PROVIDER_CONSTANTS } from '../constants/provider_constants.js';
import { PROVIDER_PROMPTS } from '../constants/llm_prompt_constants.js';
import type { MiniMaxOptions } from './provider_options.js';
import { getMiniMaxOptions } from './providers.js';
import log from '../../log.js';
import { SEARCH_CONSTANTS } from '../constants/search_constants.js';
import { formatMiniMaxMessages } from './minimax/message_formatter.js';
import { createMiniMaxStreamingResponse } from './minimax/stream_handler.js';
import { parseMiniMaxResponse } from './minimax/response_normalizer.js';
import { convertToolsToMiniMaxFormat, normalizeMiniMaxToolChoice } from './minimax/tool_adapter.js';
import { MiniMaxClient } from './minimax/minimax_client.js';

/**
 * MiniMax AI Service
 * 
 * Uses MiniMax's Anthropic-compatible API endpoint.
 * Documentation: https://platform.minimax.io/docs/
 * 
 * This service extends the base functionality to support MiniMax's
 * Anthropic-compatible API format, allowing use of the official
 * Anthropic SDK with MiniMax's infrastructure.
 */
export class MiniMaxService extends BaseAIService {
    private clientFactory: MiniMaxClient;

    constructor() {
        super('MiniMax');
        this.clientFactory = new MiniMaxClient();
    }

    /**
     * Check if MiniMax service is available
     * Requirements:
     * - AI features globally enabled
     * - MiniMax API key configured
     */
    override isAvailable(): boolean {
        if (!super.isAvailable()) {
            return false;
        }
        
        const apiKey = options.getOption('minimaxApiKey');
        return !!apiKey && apiKey.trim().length > 0;
    }

    /**
      * Generate chat completion using MiniMax API
      * Fully compatible with Anthropic SDK's message format
      */
    async generateChatCompletion(
        messages: Message[],
        opts: ChatCompletionOptions = {}
    ): Promise<ChatResponse> {
        if (!this.isAvailable()) {
            throw new Error(
                'MiniMax service is not available. ' +
                'Please configure your MiniMax API key in AI settings.'
            );
        }

        // Get provider-specific options from the central provider manager
        const providerOptions = getMiniMaxOptions(opts);

        // Log provider metadata if available
        if (providerOptions.providerMetadata) {
            log.info(`Using model ${providerOptions.model} from provider ${providerOptions.providerMetadata.provider}`);
        }

        // Get system prompt
        const systemPrompt = this.getSystemPrompt(providerOptions.systemPrompt || options.getOption('aiSystemPrompt'));

        // Add tool instructions to system prompt if tools are enabled
        const willUseTools = opts.tools && opts.tools.length > 0;
        if (willUseTools && PROVIDER_PROMPTS.MINIMAX.TOOL_INSTRUCTIONS) {
            log.info('Adding tool instructions to system prompt for MiniMax');
            var finalSystemPrompt = `${systemPrompt}\n\n${PROVIDER_PROMPTS.MINIMAX.TOOL_INSTRUCTIONS}`;
        } else {
            var finalSystemPrompt = systemPrompt;
        }

        // Format messages for MiniMax API (Anthropic-compatible format)
        const formattedMessages = formatMiniMaxMessages(messages);

        try {
            // Initialize the MiniMax client
            const client = this.clientFactory.getClient(
                providerOptions.apiKey,
                providerOptions.baseUrl
            );

            log.info(`Using MiniMax API with model: ${providerOptions.model}`);

            const normalizedTemperature = typeof providerOptions.temperature === 'number'
                && providerOptions.temperature > 0
                && providerOptions.temperature <= 1
                ? providerOptions.temperature
                : SEARCH_CONSTANTS.TEMPERATURE.DEFAULT;

            // Configure request parameters
            const requestParams: any = {
                model: providerOptions.model,
                messages: formattedMessages,
                system: finalSystemPrompt,
                max_tokens: providerOptions.max_tokens || SEARCH_CONSTANTS.LIMITS.DEFAULT_MAX_TOKENS,
                temperature: normalizedTemperature,
                top_p: providerOptions.top_p,
                stream: !!providerOptions.stream
            };

            // Add tools support if provided (MiniMax uses Anthropic-compatible format)
            if (opts.tools && opts.tools.length > 0) {
                log.info(`Adding ${opts.tools.length} tools to MiniMax request`);

                // Convert OpenAI-style function tools to Anthropic/MiniMax format
                const minimaxTools = convertToolsToMiniMaxFormat(opts.tools);

                requestParams.tools = minimaxTools;

                const normalizedToolChoice = normalizeMiniMaxToolChoice(opts.tool_choice);
                if (normalizedToolChoice) {
                    requestParams.tool_choice = normalizedToolChoice;
                    log.info(`[MINIMAX] Using normalized tool_choice: ${JSON.stringify(requestParams.tool_choice)}`);
                } else {
                    // Default to any to force at least one tool use when tools are present
                    requestParams.tool_choice = { type: 'any' };
                    log.info(`[MINIMAX] Setting default tool_choice to ${JSON.stringify(requestParams.tool_choice)}`);
                }

                log.info(`Converted ${opts.tools.length} tools to MiniMax format, tool_choice: ${JSON.stringify(requestParams.tool_choice)}`);
            }

            // Log request summary
            log.info(`Making ${providerOptions.stream ? 'streaming' : 'non-streaming'} request to MiniMax API with model: ${providerOptions.model}`);

            // Handle streaming responses
            if (providerOptions.stream) {
                const streamingResponse = createMiniMaxStreamingResponse({
                    client,
                    requestParams,
                    providerOptions,
                    providerName: this.getName()
                });
                log.info(`[MINIMAX DEBUG] After handleStreamingResponse: ${JSON.stringify({
                    model: streamingResponse.model,
                    provider: streamingResponse.provider,
                    textLength: streamingResponse.text?.length || 0,
                    hasToolCalls: !!streamingResponse.tool_calls,
                    toolCallsCount: streamingResponse.tool_calls?.length,
                    hasStream: typeof streamingResponse.stream === 'function'
                })}`);
                if (streamingResponse.tool_calls) {
                    log.info(`[MINIMAX DEBUG] Tool calls details: ${JSON.stringify(streamingResponse.tool_calls)}`);
                }
                return streamingResponse;
            } else {
                // Non-streaming request
                const response = await client.messages.create(requestParams);

                // Log response metadata only (avoid logging full response which may contain note content)
                const contentBlockCount = response.content?.length || 0;
                const hasToolCalls = response.content?.some((block: any) => block.type === 'tool_use') || false;
                log.info(`MiniMax API response: model=${response.model}, content_blocks=${contentBlockCount}, has_tool_calls=${hasToolCalls}`);

                // Process the response
                const result = parseMiniMaxResponse(response, this.getName());
                return result;
            }
        } catch (error: any) {
            log.error(`MiniMax service error: ${error.message || String(error)}`);
            throw error;
        }
    }

    // Clear cached client to force recreation after configuration changes.
    clearCache(): void {
        this.clientFactory.clear();
        log.info('MiniMax client cache cleared');
    }
    // Get service info for debugging.
    getServiceInfo(): object {
        const baseUrl = options.getOption('minimaxBaseUrl') 
            || PROVIDER_CONSTANTS.MINIMAX.BASE_URL;
        const model = options.getOption('minimaxDefaultModel') 
            || PROVIDER_CONSTANTS.MINIMAX.DEFAULT_MODEL;

        return {
            provider: 'MiniMax',
            baseUrl: baseUrl,
            defaultModel: model,
            isAvailable: this.isAvailable()
        };
    }

}
