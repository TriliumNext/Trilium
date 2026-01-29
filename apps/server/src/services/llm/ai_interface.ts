import type { ToolCall } from './tools/tool_interfaces.js';
import type { ModelMetadata } from './providers/provider_options.js';

/**
 * Interface for chat messages between client and LLM models
 */
export interface Message {
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    name?: string;
    tool_call_id?: string;
    tool_calls?: ToolCall[] | null;
    sessionId?: string; // Optional session ID for WebSocket communication
}

// Define additional interfaces for tool-related types
export interface ToolChoice {
    type: 'none' | 'auto' | 'function';
    function?: {
        name: string;
    };
}

export interface ToolData {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    };
}

export interface ToolExecutionInfo {
    type: 'start' | 'update' | 'complete' | 'error';
    tool: {
        name: string;
        arguments: Record<string, unknown>;
    };
    result?: string | Record<string, unknown>;
}

/**
 * Interface for streaming response chunks
 *
 * This is the standardized format for all streaming chunks across
 * different providers (OpenAI, Anthropic, Ollama, etc.).
 * The original provider-specific chunks are available through
 * the extended interface in the stream_manager.
 *
 * See STREAMING.md for complete documentation on streaming usage.
 */
export interface StreamChunk {
    /** The text content in this chunk (may be empty for status updates) */
    text: string;

    /** Whether this is the final chunk in the stream */
    done: boolean;

    /** Optional token usage statistics (rarely available in streaming mode) */
    usage?: {
        promptTokens?: number;
        completionTokens?: number;
        totalTokens?: number;
    };

    /**
     * Raw provider-specific data from the original response chunk
     * This can include thinking state, tool execution info, etc.
     */
    raw?: Record<string, unknown>;

    /**
     * Thinking/reasoning output from models that support it (e.g., MiniMax)
     */
    thinking?: string;

    /**
     * Tool calls from the LLM (if any)
     * These may be accumulated over multiple chunks during streaming
     */
    tool_calls?: ToolCall[];

    /**
     * Tool execution information during streaming
     * Includes tool name, args, and execution status
     */
    toolExecution?: ToolExecutionInfo;
}

/**
 * Tool execution status for feedback to models
 */
export interface ToolExecutionStatus {
    toolCallId: string;
    name: string;
    success: boolean;
    result: string;
    error?: string;
}

/**
 * Options for chat completion requests
 *
 * Key properties:
 * - stream: If true, the response will be streamed
 * - model: Model name to use
 * - provider: Provider to use (openai, anthropic, ollama, etc.)
 * - enableTools: If true, enables tool support
 *
 * The stream option is particularly important and should be consistently handled
 * throughout the pipeline. It should be explicitly set to true or false.
 *
 * Streaming supports two approaches:
 * 1. Callback-based: Provide a streamCallback to receive chunks directly
 * 2. API-based: Use the stream property in the response to process chunks
 *
 * See STREAMING.md for complete documentation on streaming usage.
 */
export interface ChatCompletionOptions {
    model?: string;
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    frequencyPenalty?: number;
    presencePenalty?: number;
    showThinking?: boolean;
    systemPrompt?: string;
    preserveSystemPrompt?: boolean; // Whether to preserve existing system message
    bypassFormatter?: boolean; // Whether to bypass the message formatter entirely
    expectsJsonResponse?: boolean; // Whether this request expects a JSON response

    /**
     * Whether to stream the response
     * When true, response will be delivered incrementally via either:
     * - The streamCallback if provided
     * - The stream property in the response object
     */
    stream?: boolean;

    /**
     * Optional callback function for streaming responses
     * When provided along with stream:true, this function will be called
     * for each chunk of the response.
     *
     * @param text The text content in this chunk
     * @param isDone Whether this is the final chunk
     * @param originalChunk Optional original provider-specific chunk for advanced usage
     */
    streamCallback?: (text: string, isDone: boolean, originalChunk?: Record<string, unknown>) => Promise<void> | void;

    enableTools?: boolean; // Whether to enable tool calling
    tools?: ToolData[]; // Tools to provide to the LLM
    tool_choice?: ToolChoice; // Tool choice parameter for the LLM
    useAdvancedContext?: boolean; // Whether to use advanced context enrichment
    toolExecutionStatus?: ToolExecutionStatus[]; // Status information about executed tools for feedback
    providerMetadata?: ModelMetadata; // Metadata about the provider and model capabilities
    sessionId?: string; // Session ID for storing tool execution results

    /**
     * Maximum number of tool execution iterations
     * Used to prevent infinite loops in tool execution
     */
    maxToolIterations?: number;

    /**
     * Current tool execution iteration counter
     * Internal use for tracking nested tool executions
     */
    currentToolIteration?: number;
}

/**
 * Response from a chat completion request
 *
 * When streaming is used, the behavior depends on how streaming was requested:
 *
 * 1. With streamCallback: The text field contains the complete response
 *    collected from all chunks, and the stream property is not present.
 *
 * 2. Without streamCallback: The text field is initially empty, and the
 *    stream property provides a function to process chunks and collect
 *    the complete response.
 *
 * See STREAMING.md for complete documentation on streaming usage.
 */
export interface ChatResponse {
    /**
     * The complete text response.
     * If streaming was used with streamCallback, this contains the collected response.
     * If streaming was used without streamCallback, this is initially empty.
     */
    text: string;

    /** The model that generated the response */
    model: string;

    /** The provider that served the request (openai, anthropic, ollama, etc.) */
    provider: string;

    /** Token usage statistics (may not be available when streaming) */
    usage?: {
        promptTokens?: number;
        completionTokens?: number;
        totalTokens?: number;
    };

    /**
     * Stream processor function - only present when streaming is enabled
     * without a streamCallback. When called with a chunk processor function,
     * it returns a Promise that resolves to the complete response text.
     *
     * @param callback Function to process each chunk of the stream
     * @returns Promise resolving to the complete text after stream processing
     */
    stream?: (callback: (chunk: StreamChunk) => Promise<void> | void) => Promise<string>;

    /** Tool calls from the LLM (if tools were used and the model supports them) */
    tool_calls?: ToolCall[] | null;
}

/**
 * Normalized chat response used internally by the pipeline.
 * Guarantees that tool_calls is always an array.
 */
export interface NormalizedChatResponse extends ChatResponse {
    text: string;
    tool_calls: ToolCall[];
}

export interface AIService {
    /**
     * Generate a chat completion response
     */
    generateChatCompletion(messages: Message[], options?: ChatCompletionOptions): Promise<ChatResponse>;

    /**
     * Normalize provider response for pipeline processing.
     */
    toNormalizedResponse(response: ChatResponse): NormalizedChatResponse;

    /**
     * Check if the service can be used (API key is set, etc.)
     */
    isAvailable(): boolean;

    /**
     * Get the name of the service
     */
    getName(): string;
}

/**
 * Interface for the semantic context service, which provides enhanced context retrieval
 * for AI conversations based on semantic similarity.
 */
export interface SemanticContextService {
    /**
     * Initialize the semantic context service
     */
    initialize(): Promise<void>;

    /**
     * Retrieve semantic context based on relevance to user query
     */
    getSemanticContext(noteId: string, userQuery: string, maxResults?: number, messages?: Message[]): Promise<string>;

    /**
     * Get progressive context based on depth
     */
    getProgressiveContext?(noteId: string, depth?: number): Promise<string>;

    /**
     * Get smart context selection that adapts to query complexity
     */
    getSmartContext?(noteId: string, userQuery: string): Promise<string>;

    /**
     * Enhance LLM context with agent tools
     */
    getAgentToolsContext(noteId: string, query: string, showThinking?: boolean): Promise<string>;
}
