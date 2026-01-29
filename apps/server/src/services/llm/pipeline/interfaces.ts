import type { Message, ChatCompletionOptions, NormalizedChatResponse, StreamChunk } from '../ai_interface.js';
import type { LLMServiceInterface } from '../interfaces/agent_tool_interfaces.js';

/**
 * Base interface for pipeline input
 */
export interface PipelineInput {
    [key: string]: unknown;
}

/**
 * Pipeline configuration options
 */
export interface ChatPipelineConfig {
    /**
     * Whether to enable streaming support
     */
    enableStreaming: boolean;

    /**
     * Whether to enable performance metrics
     */
    enableMetrics: boolean;

    /**
     * Maximum number of tool call iterations
     */
    maxToolCallIterations: number;
}

/**
 * Pipeline metrics for monitoring performance
 */
export interface PipelineMetrics {
    totalExecutions: number;
    averageExecutionTime: number;
    stageMetrics: Record<string, StageMetrics>;
}

/**
 * Metrics for an individual pipeline stage
 */
export interface StageMetrics {
    totalExecutions: number;
    averageExecutionTime: number;
}

/**
 * Callback for handling stream chunks
 * @param text The text chunk to append to the UI
 * @param isDone Whether this is the final chunk
 * @param originalChunk The original chunk with all metadata for custom handling
 */
export type StreamCallback = (text: string, isDone: boolean, originalChunk?: StreamChunk) => Promise<void> | void;

/**
 * Common input for all chat-related pipeline stages
 */
export interface ChatPipelineInput extends PipelineInput {
    messages: Message[];
    options: ChatCompletionOptions;
    noteId?: string;
    query?: string;
    showThinking?: boolean;
    streamCallback?: StreamCallback;
}

/**
 * Options for vector search operations
 */
export interface VectorSearchOptions {
    maxResults?: number;
    useEnhancedQueries?: boolean;
    threshold?: number;
    llmService?: LLMServiceInterface;
}

/**
 * Input for vector search pipeline stage
 */
export interface VectorSearchInput extends PipelineInput {
    query: string;
    noteId?: string | null;
    options?: VectorSearchOptions;
}

/**
 * Base interface for pipeline stage output
 */
export interface PipelineOutput {
    [key: string]: unknown;
}

/**
 * Interface for the pipeline stage that performs context extraction
 */
export interface ContextExtractionInput extends PipelineInput {
    noteId: string;
    query: string;
    useSmartContext?: boolean;
}

/**
 * Interface for the pipeline stage that performs semantic context extraction
 */
export interface SemanticContextExtractionInput extends PipelineInput {
    noteId: string;
    query: string;
    maxResults?: number;
    messages?: Message[];
}

/**
 * Interface for the pipeline stage that performs message preparation
 */
export interface MessagePreparationInput extends PipelineInput {
    messages: Message[];
    context?: string;
    systemPrompt?: string;
    options: ChatCompletionOptions;
}

/**
 * Interface for the pipeline stage that performs model selection
 */
export interface ModelSelectionInput extends PipelineInput {
    options: ChatCompletionOptions;
    query?: string;
    contentLength?: number;
}

/**
 * Interface for the pipeline stage that performs LLM completion
 */
export interface LLMCompletionInput extends PipelineInput {
    messages: Message[];
    options: ChatCompletionOptions;
    provider?: string;
}

/**
 * Interface for the pipeline stage that performs response processing
 */
export interface ResponseProcessingInput extends PipelineInput {
    response: NormalizedChatResponse;
    options: ChatCompletionOptions;
}

/**
 * Interface for the pipeline stage that handles tool execution
 */
export interface ToolExecutionInput extends PipelineInput {
    response: NormalizedChatResponse;
    messages: Message[];
    options: ChatCompletionOptions;
    maxIterations?: number;
    streamCallback?: StreamCallback;
}

/**
 * Base interface for a pipeline stage
 */
export interface PipelineStage<TInput extends PipelineInput, TOutput extends PipelineOutput> {
    name: string;
    execute(input: TInput): Promise<TOutput>;
}
