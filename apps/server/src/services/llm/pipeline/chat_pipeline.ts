import type { ChatPipelineInput, ChatPipelineConfig, PipelineMetrics, StreamCallback } from './interfaces.js';
import type { ChatResponse } from '../ai_interface.js';
import { ContextExtractionStage } from './stages/context_extraction_stage.js';
import { SemanticContextExtractionStage } from './stages/semantic_context_extraction_stage.js';
import { AgentToolsContextStage } from './stages/agent_tools_context_stage.js';
import { MessagePreparationStage } from './stages/message_preparation_stage.js';
import { ModelSelectionStage } from './stages/model_selection_stage.js';
import { LLMCompletionStage } from './stages/llm_completion_stage.js';
import { ResponseProcessingStage } from './stages/response_processing_stage.js';
import { ToolCallingStage } from './stages/tool_calling_stage.js';
// Traditional search is used instead of vector search
import toolRegistry from '../tools/tool_registry.js';
import log from '../../log.js';
import type { LLMServiceInterface } from '../interfaces/agent_tool_interfaces.js';
import { SEARCH_CONSTANTS } from '../constants/search_constants.js';
import { DefaultStreamingStrategy } from './streaming/default_streaming_strategy.js';
import type { StreamingStrategy } from './streaming/streaming_strategy.js';
import { ChatPipelineToolLoop } from './chat_pipeline_tool_loop.js';

/**
 * Pipeline for managing the entire chat flow
 * Implements a modular, composable architecture where each stage is a separate component
 */
export class ChatPipeline {
    stages: {
        contextExtraction: ContextExtractionStage;
        semanticContextExtraction: SemanticContextExtractionStage;
        agentToolsContext: AgentToolsContextStage;
        messagePreparation: MessagePreparationStage;
        modelSelection: ModelSelectionStage;
        llmCompletion: LLMCompletionStage;
        responseProcessing: ResponseProcessingStage;
        toolCalling: ToolCallingStage;
        // traditional search is used instead of vector search
    };

    config: ChatPipelineConfig;
    metrics: PipelineMetrics;
    streamingStrategy: StreamingStrategy;

    /**
     * Create a new chat pipeline
     * @param config Optional pipeline configuration
     */
    constructor(config?: Partial<ChatPipelineConfig>) {
        // Initialize all pipeline stages
        this.stages = {
            contextExtraction: new ContextExtractionStage(),
            semanticContextExtraction: new SemanticContextExtractionStage(),
            agentToolsContext: new AgentToolsContextStage(),
            messagePreparation: new MessagePreparationStage(),
            modelSelection: new ModelSelectionStage(),
            llmCompletion: new LLMCompletionStage(),
            responseProcessing: new ResponseProcessingStage(),
            toolCalling: new ToolCallingStage(),
            // traditional search is used instead of vector search
        };

        // Set default configuration values
        this.config = {
            enableStreaming: true,
            enableMetrics: true,
            maxToolCallIterations: SEARCH_CONSTANTS.TOOL_EXECUTION.MAX_TOOL_CALL_ITERATIONS,
            ...config
        };

        // Initialize metrics
        this.metrics = {
            totalExecutions: 0,
            averageExecutionTime: 0,
            stageMetrics: {}
        };

        this.streamingStrategy = new DefaultStreamingStrategy();

        // Initialize stage metrics
        Object.keys(this.stages).forEach(stageName => {
            this.metrics.stageMetrics[stageName] = {
                totalExecutions: 0,
                averageExecutionTime: 0
            };
        });
    }

    /**
     * Execute the chat pipeline
     * This is the main entry point that orchestrates all pipeline stages
     */
    async execute(input: ChatPipelineInput): Promise<ChatResponse> {
        log.info(`========== STARTING CHAT PIPELINE ==========`);
        log.info(`Executing chat pipeline with ${input.messages.length} messages`);
        const startTime = Date.now();
        this.metrics.totalExecutions++;

        // Initialize streaming handler if requested
        const streamCallback = input.streamCallback;
        const accumulatedText = '';

        try {
            // Extract content length for model selection
            let contentLength = 0;
            for (const message of input.messages) {
                contentLength += message.content.length;
            }

            // Initialize tools if needed
            try {
                const toolCount = toolRegistry.getAllTools().length;

                // If there are no tools registered, initialize them
                if (toolCount === 0) {
                    log.info('No tools found in registry, initializing tools...');
                    // Tools are already initialized in the AIServiceManager constructor
                    // No need to initialize them again
                    log.info(`Tools initialized, now have ${toolRegistry.getAllTools().length} tools`);
                } else {
                    log.info(`Found ${toolCount} tools already registered`);
                }
            } catch (error: any) {
                log.error(`Error checking/initializing tools: ${error.message || String(error)}`);
            }

            // First, select the appropriate model based on query complexity and content length
            const modelSelectionStartTime = Date.now();
            log.info(`========== MODEL SELECTION ==========`);
            const modelSelection = await this.stages.modelSelection.execute({
                options: input.options,
                query: input.query,
                contentLength
            });
            this.updateStageMetrics('modelSelection', modelSelectionStartTime);
            log.info(`Selected model: ${modelSelection.options.model || 'default'}, enableTools: ${modelSelection.options.enableTools}`);

            // Determine if we should use tools or semantic context
            const useTools = modelSelection.options.enableTools !== false;
            const useEnhancedContext = input.options?.useAdvancedContext === true;

            // Log details about the advanced context parameter
            log.info(`Enhanced context option check: input.options=${JSON.stringify(input.options || {})}`);
            log.info(`Enhanced context decision: useEnhancedContext=${useEnhancedContext}, hasQuery=${!!input.query}`);

            // Early return if we don't have a query or enhanced context is disabled
            if (!input.query || !useEnhancedContext) {
                log.info(`========== SIMPLE QUERY MODE ==========`);
                log.info('Enhanced context disabled or no query provided, skipping context enrichment');

                // Prepare messages without additional context
                const messagePreparationStartTime = Date.now();
                const preparedMessages = await this.stages.messagePreparation.execute({
                    messages: input.messages,
                    systemPrompt: input.options?.systemPrompt,
                    options: modelSelection.options
                });
                this.updateStageMetrics('messagePreparation', messagePreparationStartTime);

                // Generate completion using the LLM
                const llmStartTime = Date.now();
                const completion = await this.stages.llmCompletion.execute({
                    messages: preparedMessages.messages,
                    options: modelSelection.options
                });
                this.updateStageMetrics('llmCompletion', llmStartTime);

                return completion.response;
            }

            // STAGE 1: Start with the user's query
            const userQuery = input.query || '';
            log.info(`========== STAGE 1: USER QUERY ==========`);
            log.info(`Processing query with: question="${userQuery.substring(0, 50)}...", noteId=${input.noteId}, showThinking=${input.showThinking}`);

            // STAGE 2: Perform query decomposition using the LLM
            log.info(`========== STAGE 2: QUERY DECOMPOSITION ==========`);
            log.info('Performing query decomposition to generate effective search queries');
            const llmService = await this.getLLMService();
            let searchQueries = [userQuery];

            if (llmService) {
                try {
                    // Import the query processor and use its decomposeQuery method
                    const queryProcessor = (await import('../context/services/query_processor.js')).default;

                    // Use the enhanced query processor with the LLM service
                    const decomposedQuery = await queryProcessor.decomposeQuery(userQuery, undefined, llmService);

                    if (decomposedQuery && decomposedQuery.subQueries && decomposedQuery.subQueries.length > 0) {
                        // Extract search queries from the decomposed query
                        searchQueries = decomposedQuery.subQueries.map(sq => sq.text);

                        // Always include the original query if it's not already included
                        if (!searchQueries.includes(userQuery)) {
                            searchQueries.unshift(userQuery);
                        }

                        log.info(`Query decomposed with complexity ${decomposedQuery.complexity}/10 into ${searchQueries.length} search queries`);
                    } else {
                        log.info('Query decomposition returned no sub-queries, using original query');
                    }
                } catch (error: any) {
                    log.error(`Error in query decomposition: ${error.message || String(error)}`);
                }
            } else {
                log.info('No LLM service available for query decomposition, using original query');
            }

            // STAGE 3: Vector search has been removed - skip semantic search
            const vectorSearchStartTime = Date.now();
            log.info(`========== STAGE 3: VECTOR SEARCH (DISABLED) ==========`);
            log.info('Vector search has been removed - LLM will rely on tool calls for context');

            // Create empty vector search result since vector search is disabled
            const vectorSearchResult = {
                searchResults: [],
                totalResults: 0,
                executionTime: Date.now() - vectorSearchStartTime
            };

            // Skip metrics update for disabled vector search functionality
            log.info(`Vector search disabled - using tool-based context extraction instead`);

            // Extract context from search results
            log.info(`========== SEMANTIC CONTEXT EXTRACTION ==========`);
            const semanticContextStartTime = Date.now();
            const semanticContext = await this.stages.semanticContextExtraction.execute({
                noteId: input.noteId || 'global',
                query: userQuery,
                messages: input.messages,
                searchResults: vectorSearchResult.searchResults
            });

            const context = semanticContext.context;
            this.updateStageMetrics('semanticContextExtraction', semanticContextStartTime);
            log.info(`Extracted semantic context (${context.length} chars)`);

            // STAGE 4: Prepare messages with context and tool definitions for the LLM
            log.info(`========== STAGE 4: MESSAGE PREPARATION ==========`);
            const messagePreparationStartTime = Date.now();
            const preparedMessages = await this.stages.messagePreparation.execute({
                messages: input.messages,
                context,
                systemPrompt: input.options?.systemPrompt,
                options: modelSelection.options
            });
            this.updateStageMetrics('messagePreparation', messagePreparationStartTime);
            log.info(`Prepared ${preparedMessages.messages.length} messages for LLM, tools enabled: ${useTools}`);

            // Setup streaming handler if streaming is enabled and callback provided
            // Check if streaming should be enabled based on several conditions
            const streamCallbackAvailable = typeof streamCallback === 'function';
            const providerName = modelSelection.options.providerMetadata?.provider;

            log.info(`[ChatPipeline] Request type info - Format: ${input.format || 'not specified'}, Options from pipelineInput: ${JSON.stringify({stream: input.options?.stream})}`);
            log.info(`[ChatPipeline] Stream settings - config.enableStreaming: ${this.config.enableStreaming}, format parameter: ${input.format}, modelSelection.options.stream: ${modelSelection.options.stream}, streamCallback available: ${streamCallbackAvailable}`);

            const streamingDecision = this.streamingStrategy.resolveInitialStreaming({
                configEnableStreaming: this.config.enableStreaming,
                format: typeof input.format === 'string' ? input.format : undefined,
                optionStream: modelSelection.options.stream,
                hasStreamCallback: streamCallbackAvailable,
                providerName,
                toolsEnabled: useTools
            });

            const shouldEnableStream = streamingDecision.clientStream;
            const providerStream = streamingDecision.providerStream;

            modelSelection.options.stream = shouldEnableStream;

            log.info(`[ChatPipeline] Final streaming decision: stream=${shouldEnableStream}, will stream to client=${streamCallbackAvailable && shouldEnableStream}`);
            if (shouldEnableStream !== providerStream) {
                log.info(`[ChatPipeline] Provider streaming adjusted: providerStream=${providerStream}`);
            }


            const toolLoop = new ChatPipelineToolLoop({
                stages: {
                    llmCompletion: this.stages.llmCompletion,
                    toolCalling: this.stages.toolCalling,
                    responseProcessing: this.stages.responseProcessing
                },
                streamingStrategy: this.streamingStrategy,
                updateStageMetrics: this.updateStageMetrics.bind(this)
            });

            const toolLoopResult = await toolLoop.run({
                messages: preparedMessages.messages,
                userQuery,
                providerName,
                options: modelSelection.options,
                chunkOptions: input.options,
                streamCallback,
                shouldEnableStream,
                providerStream,
                toolsEnabled: modelSelection.options.enableTools !== false,
                maxToolCallIterations: this.config.maxToolCallIterations,
                accumulatedText
            });

            let currentResponse = toolLoopResult.response;

            // Process the final response
            log.info(`========== FINAL RESPONSE PROCESSING ==========`);
            const responseProcessingStartTime = Date.now();
            const processedResponse = await this.stages.responseProcessing.execute({
                response: currentResponse,
                options: modelSelection.options
            });
            this.updateStageMetrics('responseProcessing', responseProcessingStartTime);
            log.info(`Final response processed, returning to user (${processedResponse.text.length} chars)`);

            // Return the final response to the user
            // The ResponseProcessingStage returns {text}, not {response}
            // So we update our currentResponse with the processed text
            currentResponse.text = processedResponse.text;

            log.info(`========== PIPELINE COMPLETE ==========`);
            return currentResponse;
        } catch (error: any) {
            log.info(`========== PIPELINE ERROR ==========`);
            log.error(`Error in chat pipeline: ${error.message || String(error)}`);
            throw error;
        }
    }

    /**
     * Helper method to get an LLM service for query processing
     */
    private async getLLMService(): Promise<LLMServiceInterface | null> {
        try {
            const aiServiceManager = await import('../ai_service_manager.js').then(module => module.default);
            return aiServiceManager.getService();
        } catch (error: any) {
            log.error(`Error getting LLM service: ${error.message || String(error)}`);
            return null;
        }
    }

    /**
     * Update metrics for a pipeline stage
     */
    private updateStageMetrics(stageName: string, startTime: number) {
        if (!this.config.enableMetrics) return;

        const executionTime = Date.now() - startTime;
        const metrics = this.metrics.stageMetrics[stageName];

        // Guard against undefined metrics (e.g., for removed stages)
        if (!metrics) {
            log.info(`WARNING: Attempted to update metrics for unknown stage: ${stageName}`);
            return;
        }

        metrics.totalExecutions++;
        metrics.averageExecutionTime =
            (metrics.averageExecutionTime * (metrics.totalExecutions - 1) + executionTime) /
            metrics.totalExecutions;
    }

    /**
     * Get the current pipeline metrics
     */
    getMetrics(): PipelineMetrics {
        return this.metrics;
    }

    /**
     * Reset pipeline metrics
     */
    resetMetrics(): void {
        this.metrics.totalExecutions = 0;
        this.metrics.averageExecutionTime = 0;

        Object.keys(this.metrics.stageMetrics).forEach(stageName => {
            this.metrics.stageMetrics[stageName] = {
                totalExecutions: 0,
                averageExecutionTime: 0
            };
        });
    }

}
