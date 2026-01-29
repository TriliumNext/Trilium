import type { Message, ChatCompletionOptions } from '../ai_interface.js';
import type { ToolCall } from '../tools/tool_interfaces.js';

/**
 * Model metadata interface to track provider information
 */
export interface ModelMetadata {
    // The provider that supports this model
    provider: 'openai' | 'anthropic' | 'ollama' | 'local' | 'minimax';
    // The actual model identifier used by the provider's API
    modelId: string;
    // Display name for UI (optional)
    displayName?: string;
    // Model capabilities
    capabilities?: {
        contextWindow?: number;
        supportsTools?: boolean;
        supportsVision?: boolean;
        supportsStreaming?: boolean;
    };
}

/**
 * Base provider configuration that's common to all providers
 * but not necessarily sent directly to APIs
 */
export interface ProviderConfig {
    // Internal configuration
    systemPrompt?: string;
    // Provider metadata for model routing
    providerMetadata?: ModelMetadata;
}

/**
 * OpenAI-specific options, structured to match the OpenAI API
 */
export interface OpenAIOptions extends ProviderConfig {
    // Connection settings (not sent to API)
    apiKey: string;
    baseUrl: string;

    // Direct API parameters as they appear in requests
    model: string;
    messages?: Message[];
    temperature?: number;
    max_tokens?: number;
    stream?: boolean;
    top_p?: number;
    frequency_penalty?: number;
    presence_penalty?: number;
    tools?: any[];
    tool_choice?: string | object;

    // Internal control flags (not sent directly to API)
    enableTools?: boolean;
    // Streaming callback handler
    streamCallback?: (text: string, isDone: boolean, originalChunk?: any) => Promise<void> | void;
}

/**
 * Anthropic-specific options, structured to match the Anthropic API
 */
export interface AnthropicOptions extends ProviderConfig {
    // Connection settings (not sent to API)
    apiKey: string;
    baseUrl: string;
    apiVersion?: string;
    betaVersion?: string;

    // Direct API parameters as they appear in requests
    model: string;
    messages?: any[];
    system?: string;
    temperature?: number;
    max_tokens?: number;
    stream?: boolean;
    top_p?: number;

    // Internal parameters (not sent directly to API)
    formattedMessages?: { messages: any[], system: string };
    // Streaming callback handler
    streamCallback?: (text: string, isDone: boolean, originalChunk?: any) => Promise<void> | void;
}

/**
 * Ollama-specific options, structured to match the Ollama API
 */
export interface OllamaOptions extends ProviderConfig {
    // Connection settings (not sent to API)
    baseUrl: string;

    // Direct API parameters as they appear in requests
    model: string;
    messages?: Message[];
    stream?: boolean;
    options?: {
        temperature?: number;
        num_ctx?: number;
        top_p?: number;
        top_k?: number;
        num_predict?: number; // equivalent to max_tokens
        response_format?: { type: string };
    };
    tools?: any[];

    // Internal control flags (not sent directly to API)
    enableTools?: boolean;
    bypassFormatter?: boolean;
    preserveSystemPrompt?: boolean;
    expectsJsonResponse?: boolean;
    toolExecutionStatus?: any[];
    // Streaming callback handler
    streamCallback?: (text: string, isDone: boolean, originalChunk?: any) => Promise<void> | void;
}

/**
 * Create OpenAI options from generic options and config
 */
export function createOpenAIOptions(
    opts: ChatCompletionOptions = {},
    apiKey: string,
    baseUrl: string,
    defaultModel: string
): OpenAIOptions {
    return {
        // Connection settings
        apiKey,
        baseUrl,

        // API parameters
        model: opts.model || defaultModel,
        temperature: opts.temperature,
        max_tokens: opts.maxTokens,
        stream: opts.stream,
        top_p: opts.topP,
        frequency_penalty: opts.frequencyPenalty,
        presence_penalty: opts.presencePenalty,
        tools: opts.tools,

        // Internal configuration
        systemPrompt: opts.systemPrompt,
        enableTools: opts.enableTools,
        // Pass through streaming callback
        streamCallback: opts.streamCallback,
        // Include provider metadata
        providerMetadata: opts.providerMetadata,
    };
}

/**
 * Create Anthropic options from generic options and config
 */
export function createAnthropicOptions(
    opts: ChatCompletionOptions = {},
    apiKey: string,
    baseUrl: string,
    defaultModel: string,
    apiVersion: string,
    betaVersion: string
): AnthropicOptions {
    return {
        // Connection settings
        apiKey,
        baseUrl,
        apiVersion,
        betaVersion,

        // API parameters
        model: opts.model || defaultModel,
        temperature: opts.temperature,
        max_tokens: opts.maxTokens,
        stream: opts.stream,
        top_p: opts.topP,

        // Internal configuration
        systemPrompt: opts.systemPrompt,
        // Pass through streaming callback
        streamCallback: opts.streamCallback,
        // Include provider metadata
        providerMetadata: opts.providerMetadata,
    };
}

/**
 * Create Ollama options from generic options and config
 */
export function createOllamaOptions(
    opts: ChatCompletionOptions = {},
    baseUrl: string,
    defaultModel: string,
    contextWindow: number
): OllamaOptions {
    return {
        // Connection settings
        baseUrl,

        // API parameters
        model: opts.model || defaultModel,
        stream: opts.stream,
        options: {
            temperature: opts.temperature,
            num_ctx: contextWindow,
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
        // Pass through streaming callback
        streamCallback: opts.streamCallback,
        // Include provider metadata
        providerMetadata: opts.providerMetadata,
    };
}

/**
 * MiniMax-specific options, structured to match the Anthropic-compatible API
 * MiniMax uses the same API format as Anthropic
 * Documentation: https://platform.minimax.io/docs/
 */
export interface MiniMaxOptions extends ProviderConfig {
    // Connection settings (not sent to API)
    apiKey: string;
    baseUrl: string;
    apiVersion?: string;

    // Direct API parameters as they appear in requests
    model: string;
    messages?: any[];
    system?: string;
    temperature?: number;
    max_tokens?: number;
    stream?: boolean;
    top_p?: number;

    // Internal parameters (not sent directly to API)
    formattedMessages?: { messages: any[], system: string };
    // Streaming callback handler
    streamCallback?: (text: string, isDone: boolean, originalChunk?: any) => Promise<void> | void;
}

/**
 * Create MiniMax options from generic options and config
 * MiniMax uses Anthropic-compatible API format
 */
export function createMiniMaxOptions(
    opts: ChatCompletionOptions = {},
    apiKey: string,
    baseUrl: string,
    defaultModel: string,
    apiVersion: string = '2023-06-01'
): MiniMaxOptions {
    return {
        // Connection settings
        apiKey,
        baseUrl,
        apiVersion,

        // API parameters
        model: opts.model || defaultModel,
        temperature: opts.temperature,
        max_tokens: opts.maxTokens,
        stream: opts.stream,
        top_p: opts.topP,

        // Internal configuration
        systemPrompt: opts.systemPrompt,
        // Pass through streaming callback
        streamCallback: opts.streamCallback,
        // Include provider metadata
        providerMetadata: opts.providerMetadata,
    };
}
