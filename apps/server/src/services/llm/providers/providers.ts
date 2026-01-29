import options from "../../options.js";
import log from "../../log.js";
import type { OptionDefinitions } from "@triliumnext/commons";
import type { ChatCompletionOptions } from '../ai_interface.js';
import type { OpenAIOptions, AnthropicOptions, OllamaOptions, MiniMaxOptions, ModelMetadata } from './provider_options.js';
import {
    createOpenAIOptions,
    createAnthropicOptions,
    createOllamaOptions,
    createMiniMaxOptions
} from './provider_options.js';
import { PROVIDER_CONSTANTS } from '../constants/provider_constants.js';
import { SEARCH_CONSTANTS, MODEL_CAPABILITIES } from '../constants/search_constants.js';

/**
 * Get OpenAI provider options from chat options and configuration
 * Updated to use provider metadata approach
 */
export function getOpenAIOptions(
    opts: ChatCompletionOptions = {}
): OpenAIOptions {
    try {
        const apiKey = options.getOption('openaiApiKey');
        if (!apiKey) {
            // Log warning but don't throw - some OpenAI-compatible endpoints don't require API keys
            log.info('OpenAI API key is not configured. This may cause issues with official OpenAI endpoints.');
        }

        const baseUrl = options.getOption('openaiBaseUrl') || PROVIDER_CONSTANTS.OPENAI.BASE_URL;
        const modelName = opts.model || options.getOption('openaiDefaultModel');

        if (!modelName) {
            throw new Error('No OpenAI model configured. Please set a default model in your AI settings.');
        }

        // Create provider metadata
        const providerMetadata: ModelMetadata = {
            provider: 'openai',
            modelId: modelName,
            displayName: modelName,
            capabilities: {
                supportsTools: modelName.includes('gpt-4') || modelName.includes('gpt-3.5-turbo'),
                supportsVision: modelName.includes('vision') || modelName.includes('gpt-4-turbo') || modelName.includes('gpt-4o'),
                supportsStreaming: true
            }
        };

        // Get temperature from options or global setting
        const temperature = opts.temperature !== undefined
            ? opts.temperature
            : parseFloat(options.getOption('aiTemperature') || String(SEARCH_CONSTANTS.TEMPERATURE.DEFAULT));

        return {
            // Connection settings
            apiKey: apiKey || '', // Default to empty string if no API key
            baseUrl,

            // Provider metadata
            providerMetadata,

            // API parameters
            model: modelName,
            temperature,
            max_tokens: opts.maxTokens,
            stream: opts.stream,
            top_p: opts.topP,
            frequency_penalty: opts.frequencyPenalty,
            presence_penalty: opts.presencePenalty,
            tools: opts.tools,

            // Internal configuration
            systemPrompt: opts.systemPrompt,
            enableTools: opts.enableTools,
        };
    } catch (error) {
        log.error(`Error creating OpenAI provider options: ${error}`);
        throw error;
    }
}

/**
 * Get Anthropic provider options from chat options and configuration
 * Updated to use provider metadata approach
 */
export function getAnthropicOptions(
    opts: ChatCompletionOptions = {}
): AnthropicOptions {
    try {
        const apiKey = options.getOption('anthropicApiKey');
        if (!apiKey) {
            throw new Error('Anthropic API key is not configured');
        }

        const baseUrl = options.getOption('anthropicBaseUrl') || PROVIDER_CONSTANTS.ANTHROPIC.BASE_URL;
        const modelName = opts.model || options.getOption('anthropicDefaultModel');

        if (!modelName) {
            throw new Error('No Anthropic model configured. Please set a default model in your AI settings.');
        }

        // Create provider metadata
        const providerMetadata: ModelMetadata = {
            provider: 'anthropic',
            modelId: modelName,
            displayName: modelName,
            capabilities: {
                supportsTools: modelName.includes('claude-3') || modelName.includes('claude-3.5'),
                supportsVision: modelName.includes('claude-3') || modelName.includes('claude-3.5'),
                supportsStreaming: true,
                // Anthropic models typically have large context windows
                contextWindow: modelName.includes('claude-3-opus') ? 200000 :
                    modelName.includes('claude-3-sonnet') ? 180000 :
                        modelName.includes('claude-3.5-sonnet') ? 200000 : 100000
            }
        };

        // Get temperature from options or global setting
        const temperature = opts.temperature !== undefined
            ? opts.temperature
            : parseFloat(options.getOption('aiTemperature') || String(SEARCH_CONSTANTS.TEMPERATURE.DEFAULT));

        return {
            // Connection settings
            apiKey,
            baseUrl,
            apiVersion: PROVIDER_CONSTANTS.ANTHROPIC.API_VERSION,
            betaVersion: PROVIDER_CONSTANTS.ANTHROPIC.BETA_VERSION,

            // Provider metadata
            providerMetadata,

            // API parameters
            model: modelName,
            temperature,
            max_tokens: opts.maxTokens,
            stream: opts.stream,
            top_p: opts.topP,

            // Internal configuration
            systemPrompt: opts.systemPrompt
        };
    } catch (error) {
        log.error(`Error creating Anthropic provider options: ${error}`);
        throw error;
    }
}

/**
 * Get Ollama provider options from chat options and configuration
 * This implementation cleanly separates provider information from model names
 */
export async function getOllamaOptions(
    opts: ChatCompletionOptions = {},
    contextWindow?: number
): Promise<OllamaOptions> {
    try {
        const baseUrl = options.getOption('ollamaBaseUrl');
        if (!baseUrl) {
            throw new Error('Ollama API URL is not configured');
        }

        // Get the model name - no defaults, must be configured by user
        let modelName = opts.model || options.getOption('ollamaDefaultModel');

        if (!modelName) {
            throw new Error('No Ollama model configured. Please set a default model in your AI settings.');
        }

        // Create provider metadata
        const providerMetadata: ModelMetadata = {
            provider: 'ollama',
            modelId: modelName,
            capabilities: {
                supportsTools: true,
                supportsStreaming: true
            }
        };

        // Get temperature from options or global setting
        const temperature = opts.temperature !== undefined
            ? opts.temperature
            : parseFloat(options.getOption('aiTemperature') || String(SEARCH_CONSTANTS.TEMPERATURE.DEFAULT));

        // Use provided context window or get from model if not specified
        const modelContextWindow = contextWindow || await getOllamaModelContextWindow(modelName);

        // Update capabilities with context window information
        providerMetadata.capabilities!.contextWindow = modelContextWindow;

        return {
            // Connection settings
            baseUrl,

            // Provider metadata
            providerMetadata,

            // API parameters
            model: modelName,  // Clean model name without provider prefix
            stream: opts.stream !== undefined ? opts.stream : true, // Default to true if not specified
            options: {
                temperature: opts.temperature,
                num_ctx: modelContextWindow,
                num_predict: opts.maxTokens,
                response_format: opts.expectsJsonResponse ? { type: "json_object" } : undefined
            },
            tools: opts.tools,

            // Internal configuration
            systemPrompt: opts.systemPrompt,
            enableTools: opts.enableTools,
            bypassFormatter: opts.bypassFormatter,
            preserveSystemPrompt: opts.preserveSystemPrompt,
            expectsJsonResponse: opts.expectsJsonResponse,
            toolExecutionStatus: opts.toolExecutionStatus,
        };
    } catch (error) {
        log.error(`Error creating Ollama provider options: ${error}`);
        throw error;
    }
}

/**
 * Get context window size for Ollama model using the official client
 */
async function getOllamaModelContextWindow(modelName: string): Promise<number> {
    try {
        const baseUrl = options.getOption('ollamaBaseUrl');

        if (!baseUrl) {
            throw new Error('Ollama base URL is not configured');
        }

        // Use the official Ollama client
        const { Ollama } = await import('ollama');
        const client = new Ollama({ host: baseUrl });

        // Try to get model information from Ollama API
        const modelData = await client.show({ model: modelName });

        // Get context window from model parameters
        if (modelData && modelData.parameters) {
            const params = modelData.parameters as any;
            if (params.num_ctx) {
                return params.num_ctx;
            }
        }

        // Default context sizes by model family if we couldn't get specific info
        if (modelName.includes('llama3')) {
            return MODEL_CAPABILITIES['gpt-4'].contextWindowTokens;
        } else if (modelName.includes('llama2')) {
            return MODEL_CAPABILITIES['default'].contextWindowTokens;
        } else if (modelName.includes('mistral') || modelName.includes('mixtral')) {
            return MODEL_CAPABILITIES['gpt-4'].contextWindowTokens;
        } else if (modelName.includes('gemma')) {
            return MODEL_CAPABILITIES['gpt-4'].contextWindowTokens;
        }

        // Return a reasonable default
        return MODEL_CAPABILITIES['default'].contextWindowTokens;
    } catch (error) {
        log.info(`Error getting context window for model ${modelName}: ${error}`);
        return MODEL_CAPABILITIES['default'].contextWindowTokens; // Default fallback
    }
}

/**
 * Get MiniMax provider options from chat options and configuration
 * MiniMax uses Anthropic-compatible API format
 * Documentation: https://platform.minimax.io/docs/
 */
export function getMiniMaxOptions(
    opts: ChatCompletionOptions = {}
): MiniMaxOptions {
    try {
        const apiKey = options.getOption('minimaxApiKey');
        
        if (!apiKey) {
            // Log warning but don't throw - allow checking availability
            log.info('MiniMax API key is not configured');
        }

        const baseUrl = options.getOption('minimaxBaseUrl') 
            || PROVIDER_CONSTANTS.MINIMAX.BASE_URL;
        
        const modelName = opts.model || options.getOption('minimaxDefaultModel') 
            || PROVIDER_CONSTANTS.MINIMAX.DEFAULT_MODEL;

        if (!modelName) {
            throw new Error(
                'No MiniMax model configured. ' +
                'Please set a default model in your AI settings.'
            );
        }

        // Create provider metadata
        const providerMetadata: ModelMetadata = {
            provider: 'minimax',
            modelId: modelName,
            displayName: modelName,
            capabilities: {
                supportsTools: true,
                supportsStreaming: true,
                supportsVision: false,
                contextWindow: PROVIDER_CONSTANTS.MINIMAX.CONTEXT_WINDOW
            }
        };

        // Get temperature from options or global setting
        const temperature = opts.temperature !== undefined
            ? opts.temperature
            : parseFloat(options.getOption('aiTemperature') || String(SEARCH_CONSTANTS.TEMPERATURE.DEFAULT));

        // Create options and pass through provider metadata
        const optionsResult = createMiniMaxOptions(
            opts,
            apiKey || '',
            baseUrl,
            modelName,
            PROVIDER_CONSTANTS.MINIMAX.API_VERSION
        );

        // Pass through provider metadata
        optionsResult.providerMetadata = providerMetadata;

        return optionsResult;
    } catch (error) {
        log.error(`Error creating MiniMax provider options: ${error}`);
        throw error;
    }
}
