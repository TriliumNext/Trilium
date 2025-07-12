import type { ChatPipelineInput, ChatPipelineConfig, PipelineMetrics, StreamCallback } from './interfaces.js';
import type { ChatResponse, StreamChunk, Message } from '../ai_interface.js';
import { ContextExtractionStage } from './stages/context_extraction_stage.js';
import { SemanticContextExtractionStage } from './stages/semantic_context_extraction_stage.js';
import { AgentToolsContextStage } from './stages/agent_tools_context_stage.js';
import { MessagePreparationStage } from './stages/message_preparation_stage.js';
import { ModelSelectionStage } from './stages/model_selection_stage.js';
import { LLMCompletionStage } from './stages/llm_completion_stage.js';
import { ResponseProcessingStage } from './stages/response_processing_stage.js';
import { ToolCallingStage } from './stages/tool_calling_stage.js';
import { ErrorRecoveryStage } from './stages/error_recovery_stage.js';
// Traditional search is used instead of vector search
import toolRegistry from '../tools/tool_registry.js';
import toolInitializer from '../tools/tool_initializer.js';
import log from '../../log.js';
import type { LLMServiceInterface } from '../interfaces/agent_tool_interfaces.js';
import { SEARCH_CONSTANTS } from '../constants/search_constants.js';

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
        errorRecovery: ErrorRecoveryStage;
        // traditional search is used instead of vector search
    };

    config: ChatPipelineConfig;
    metrics: PipelineMetrics;

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
            errorRecovery: new ErrorRecoveryStage(),
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
        let streamCallback = input.streamCallback;
        let accumulatedText = '';

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
            const useTools = modelSelection.options.enableTools === true;
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
            const streamEnabledInConfig = this.config.enableStreaming;
            const streamFormatRequested = input.format === 'stream';
            const streamRequestedInOptions = modelSelection.options.stream === true;
            const streamCallbackAvailable = typeof streamCallback === 'function';

            log.info(`[ChatPipeline] Request type info - Format: ${input.format || 'not specified'}, Options from pipelineInput: ${JSON.stringify({stream: input.options?.stream})}`);
            log.info(`[ChatPipeline] Stream settings - config.enableStreaming: ${streamEnabledInConfig}, format parameter: ${input.format}, modelSelection.options.stream: ${modelSelection.options.stream}, streamCallback available: ${streamCallbackAvailable}`);

            // IMPORTANT: Respect the existing stream option but with special handling for callbacks:
            // 1. If a stream callback is available, streaming MUST be enabled for it to work
            // 2. Otherwise, preserve the original stream setting from input options

            // First, determine what the stream value should be based on various factors:
            let shouldEnableStream = modelSelection.options.stream;

            if (streamCallbackAvailable) {
                // If we have a stream callback, we NEED to enable streaming
                // This is critical for GET requests with EventSource
                shouldEnableStream = true;
                log.info(`[ChatPipeline] Stream callback available, enabling streaming`);
            } else if (streamRequestedInOptions) {
                // Stream was explicitly requested in options, honor that setting
                log.info(`[ChatPipeline] Stream explicitly requested in options: ${streamRequestedInOptions}`);
                shouldEnableStream = streamRequestedInOptions;
            } else if (streamFormatRequested) {
                // Format=stream parameter indicates streaming was requested
                log.info(`[ChatPipeline] Stream format requested in parameters`);
                shouldEnableStream = true;
            } else {
                // No explicit streaming indicators, use config default
                log.info(`[ChatPipeline] No explicit stream settings, using config default: ${streamEnabledInConfig}`);
                shouldEnableStream = streamEnabledInConfig;
            }

            // Set the final stream option
            modelSelection.options.stream = shouldEnableStream;

            log.info(`[ChatPipeline] Final streaming decision: stream=${shouldEnableStream}, will stream to client=${streamCallbackAvailable && shouldEnableStream}`);


            // STAGE 5 & 6: Handle LLM completion and tool execution loop
            log.info(`========== STAGE 5: LLM COMPLETION ==========`);
            const llmStartTime = Date.now();
            const completion = await this.stages.llmCompletion.execute({
                messages: preparedMessages.messages,
                options: modelSelection.options
            });
            this.updateStageMetrics('llmCompletion', llmStartTime);
            log.info(`Received LLM response from model: ${completion.response.model}, provider: ${completion.response.provider}`);

            // Track whether content has been streamed to prevent duplication
            let hasStreamedContent = false;

            // Handle streaming if enabled and available
            // Use shouldEnableStream variable which contains our streaming decision
            if (shouldEnableStream && completion.response.stream && streamCallback) {
                // Setup stream handler that passes chunks through response processing
                await completion.response.stream(async (chunk: StreamChunk) => {
                    // Process the chunk text
                    const processedChunk = await this.processStreamChunk(chunk, input.options);

                    // Accumulate text for final response
                    accumulatedText += processedChunk.text;

                    // Forward to callback with original chunk data in case it contains additional information
                    streamCallback(processedChunk.text, processedChunk.done, chunk);

                    // Mark that we have streamed content to prevent duplication
                    hasStreamedContent = true;
                });
            }

            // Process any tool calls in the response
            let currentMessages = preparedMessages.messages;
            let currentResponse = completion.response;
            let toolCallIterations = 0;
            const maxToolCallIterations = this.config.maxToolCallIterations;

            // Check if tools were enabled in the options
            const toolsEnabled = modelSelection.options.enableTools !== false;

            // Log decision points for tool execution
            log.info(`========== TOOL EXECUTION DECISION ==========`);
            log.info(`Tools enabled in options: ${toolsEnabled}`);
            log.info(`Response provider: ${currentResponse.provider || 'unknown'}`);
            log.info(`Response model: ${currentResponse.model || 'unknown'}`);

            // Enhanced tool_calls detection - check both direct property and getter
            let hasToolCalls = false;

            log.info(`[TOOL CALL DEBUG] Starting tool call detection for provider: ${currentResponse.provider}`);
            // Check response object structure
            log.info(`[TOOL CALL DEBUG] Response properties: ${Object.keys(currentResponse).join(', ')}`);

            // Try to access tool_calls as a property
            if ('tool_calls' in currentResponse) {
                log.info(`[TOOL CALL DEBUG] tool_calls exists as a direct property`);
                log.info(`[TOOL CALL DEBUG] tool_calls type: ${typeof currentResponse.tool_calls}`);

                if (currentResponse.tool_calls && Array.isArray(currentResponse.tool_calls)) {
                    log.info(`[TOOL CALL DEBUG] tool_calls is an array with length: ${currentResponse.tool_calls.length}`);
                } else {
                    log.info(`[TOOL CALL DEBUG] tool_calls is not an array or is empty: ${JSON.stringify(currentResponse.tool_calls)}`);
                }
            } else {
                log.info(`[TOOL CALL DEBUG] tool_calls does not exist as a direct property`);
            }

            // First check the direct property
            if (currentResponse.tool_calls && currentResponse.tool_calls.length > 0) {
                hasToolCalls = true;
                log.info(`Response has tool_calls property with ${currentResponse.tool_calls.length} tools`);
                log.info(`Tool calls details: ${JSON.stringify(currentResponse.tool_calls)}`);
            }
            // Check if it might be a getter (for dynamic tool_calls collection)
            else {
                log.info(`[TOOL CALL DEBUG] Direct property check failed, trying getter approach`);
                try {
                    const toolCallsDesc = Object.getOwnPropertyDescriptor(currentResponse, 'tool_calls');

                    if (toolCallsDesc) {
                        log.info(`[TOOL CALL DEBUG] Found property descriptor for tool_calls: ${JSON.stringify({
                            configurable: toolCallsDesc.configurable,
                            enumerable: toolCallsDesc.enumerable,
                            hasGetter: !!toolCallsDesc.get,
                            hasSetter: !!toolCallsDesc.set
                        })}`);
                    } else {
                        log.info(`[TOOL CALL DEBUG] No property descriptor found for tool_calls`);
                    }

                    if (toolCallsDesc && typeof toolCallsDesc.get === 'function') {
                        log.info(`[TOOL CALL DEBUG] Attempting to call the tool_calls getter`);
                        const dynamicToolCalls = toolCallsDesc.get.call(currentResponse);

                        log.info(`[TOOL CALL DEBUG] Getter returned: ${JSON.stringify(dynamicToolCalls)}`);

                        if (dynamicToolCalls && dynamicToolCalls.length > 0) {
                            hasToolCalls = true;
                            log.info(`Response has dynamic tool_calls with ${dynamicToolCalls.length} tools`);
                            log.info(`Dynamic tool calls details: ${JSON.stringify(dynamicToolCalls)}`);
                            // Ensure property is available for subsequent code
                            currentResponse.tool_calls = dynamicToolCalls;
                            log.info(`[TOOL CALL DEBUG] Updated currentResponse.tool_calls with dynamic values`);
                        } else {
                            log.info(`[TOOL CALL DEBUG] Getter returned no valid tool calls`);
                        }
                    } else {
                        log.info(`[TOOL CALL DEBUG] No getter function found for tool_calls`);
                    }
                } catch (e: any) {
                    log.error(`Error checking dynamic tool_calls: ${e}`);
                    log.error(`[TOOL CALL DEBUG] Error details: ${e.stack || 'No stack trace'}`);
                }
            }

            log.info(`Response has tool_calls: ${hasToolCalls ? 'true' : 'false'}`);
            if (hasToolCalls && currentResponse.tool_calls) {
                log.info(`[TOOL CALL DEBUG] Final tool_calls that will be used: ${JSON.stringify(currentResponse.tool_calls)}`);
            }

            // Tool execution loop
            if (toolsEnabled && hasToolCalls && currentResponse.tool_calls) {
                log.info(`========== STAGE 6: TOOL EXECUTION ==========`);
                log.info(`Response contains ${currentResponse.tool_calls.length} tool calls, processing...`);

                // Format tool calls for logging
                log.info(`========== TOOL CALL DETAILS ==========`);
                currentResponse.tool_calls.forEach((toolCall, idx) => {
                    log.info(`Tool call ${idx + 1}: name=${toolCall.function?.name || 'unknown'}, id=${toolCall.id || 'no-id'}`);
                    log.info(`Arguments: ${toolCall.function?.arguments || '{}'}`);
                });

                // Keep track of whether we're in a streaming response
                const isStreaming = shouldEnableStream && streamCallback;
                let streamingPaused = false;

                // If streaming was enabled, send an update to the user
                if (isStreaming && streamCallback) {
                    streamingPaused = true;
                    // Send a dedicated message with a specific type for tool execution
                    streamCallback('', false, {
                        text: '',
                        done: false,
                        toolExecution: {
                            type: 'start',
                            tool: {
                                name: 'tool_execution',
                                arguments: {}
                            }
                        }
                    });
                }

                while (toolCallIterations < maxToolCallIterations) {
                    toolCallIterations++;
                    log.info(`========== TOOL ITERATION ${toolCallIterations}/${maxToolCallIterations} ==========`);

                    // Create a copy of messages before tool execution
                    const previousMessages = [...currentMessages];

                    try {
                        const toolCallingStartTime = Date.now();
                        log.info(`========== PIPELINE TOOL EXECUTION FLOW ==========`);
                        log.info(`About to call toolCalling.execute with ${currentResponse.tool_calls.length} tool calls`);
                        log.info(`Tool calls being passed to stage: ${JSON.stringify(currentResponse.tool_calls)}`);

                        const toolCallingResult = await this.stages.toolCalling.execute({
                            response: currentResponse,
                            messages: currentMessages,
                            options: modelSelection.options
                        });
                        this.updateStageMetrics('toolCalling', toolCallingStartTime);

                        log.info(`ToolCalling stage execution complete, got result with needsFollowUp: ${toolCallingResult.needsFollowUp}`);

                        // Update messages with tool results
                        currentMessages = toolCallingResult.messages;

                        // Log the tool results for debugging
                        const toolResultMessages = currentMessages.filter(
                            msg => msg.role === 'tool' && !previousMessages.includes(msg)
                        );

                        log.info(`========== TOOL EXECUTION RESULTS ==========`);
                        log.info(`Received ${toolResultMessages.length} tool results`);
                        toolResultMessages.forEach((msg, idx) => {
                            log.info(`Tool result ${idx + 1}: tool_call_id=${msg.tool_call_id}, content=${msg.content}`);
                            log.info(`Tool result status: ${msg.content.startsWith('Error:') ? 'ERROR' : 'SUCCESS'}`);
                            log.info(`Tool result for: ${this.getToolNameFromToolCallId(currentMessages, msg.tool_call_id || '')}`);

                            // If streaming, show tool executions to the user
                            if (isStreaming && streamCallback) {
                                // For each tool result, format a readable message for the user
                                const toolName = this.getToolNameFromToolCallId(currentMessages, msg.tool_call_id || '');

                                // Create a structured tool result message
                                // The client will receive this structured data and can display it properly
                                try {
                                    // Parse the result content if it's JSON
                                    let parsedContent = msg.content;
                                    try {
                                        // Check if the content is JSON
                                        if (msg.content.trim().startsWith('{') || msg.content.trim().startsWith('[')) {
                                            parsedContent = JSON.parse(msg.content);
                                        }
                                    } catch (e) {
                                        // If parsing fails, keep the original content
                                        log.info(`Could not parse tool result as JSON: ${e}`);
                                    }

                                    // Send the structured tool result directly so the client has the raw data
                                    streamCallback('', false, {
                                        text: '',
                                        done: false,
                                        toolExecution: {
                                            type: 'complete',
                                            tool: {
                                                name: toolName,
                                                arguments: {}
                                            },
                                            result: parsedContent
                                        }
                                    });

                                    // No longer need to send formatted text version
                                    // The client should use the structured data instead
                                } catch (err) {
                                    log.error(`Error sending structured tool result: ${err}`);
                                    // Use structured format here too instead of falling back to text format
                                    streamCallback('', false, {
                                        text: '',
                                        done: false,
                                        toolExecution: {
                                            type: 'complete',
                                            tool: {
                                                name: toolName || 'unknown',
                                                arguments: {}
                                            },
                                            result: msg.content
                                        }
                                    });
                                }
                            }
                        });

                        // Check if we need another LLM completion for tool results
                        if (toolCallingResult.needsFollowUp) {
                            log.info(`========== TOOL FOLLOW-UP REQUIRED ==========`);
                            log.info('Tool execution complete, sending results back to LLM');

                            // Ensure messages are properly formatted
                            this.validateToolMessages(currentMessages);

                            // If streaming, show progress to the user
                            if (isStreaming && streamCallback) {
                                streamCallback('', false, {
                                    text: '',
                                    done: false,
                                    toolExecution: {
                                        type: 'update',
                                        tool: {
                                            name: 'tool_processing',
                                            arguments: {}
                                        }
                                    }
                                });
                            }

                            // Extract tool execution status information for Ollama feedback
                            let toolExecutionStatus;

                            if (currentResponse.provider === 'Ollama') {
                                // Collect tool execution status from the tool results
                                toolExecutionStatus = toolResultMessages.map(msg => {
                                    // Determine if this was a successful tool call
                                    const isError = msg.content.startsWith('Error:');
                                    return {
                                        toolCallId: msg.tool_call_id || '',
                                        name: msg.name || 'unknown',
                                        success: !isError,
                                        result: msg.content,
                                        error: isError ? msg.content.substring(7) : undefined
                                    };
                                });

                                log.info(`Created tool execution status for Ollama: ${toolExecutionStatus.length} entries`);
                                toolExecutionStatus.forEach((status, idx) => {
                                    log.info(`Tool status ${idx + 1}: ${status.name} - ${status.success ? 'success' : 'failed'}`);
                                });
                            }

                            // Generate a new completion with the updated messages
                            const followUpStartTime = Date.now();

                            // Log messages being sent to LLM for tool follow-up
                            log.info(`========== SENDING TOOL RESULTS TO LLM FOR FOLLOW-UP ==========`);
                            log.info(`Total messages being sent: ${currentMessages.length}`);
                            // Log the most recent messages (last 3) for clarity
                            const recentMessages = currentMessages.slice(-3);
                            recentMessages.forEach((msg, idx) => {
                                const position = currentMessages.length - recentMessages.length + idx;
                                log.info(`Message ${position} (${msg.role}): ${msg.content?.substring(0, 100)}${msg.content?.length > 100 ? '...' : ''}`);
                                if (msg.tool_calls) {
                                    log.info(`  Has ${msg.tool_calls.length} tool calls`);
                                }
                                if (msg.tool_call_id) {
                                    log.info(`  Tool call ID: ${msg.tool_call_id}`);
                                }
                            });

                            log.info(`LLM follow-up request options: ${JSON.stringify({
                                model: modelSelection.options.model,
                                enableTools: true,
                                stream: modelSelection.options.stream,
                                provider: currentResponse.provider
                            })}`);

                            const followUpCompletion = await this.stages.llmCompletion.execute({
                                messages: currentMessages,
                                options: {
                                    ...modelSelection.options,
                                    // Ensure tool support is still enabled for follow-up requests
                                    enableTools: true,
                                    // Preserve original streaming setting for tool execution follow-ups
                                    stream: modelSelection.options.stream,
                                    // Add tool execution status for Ollama provider
                                    ...(currentResponse.provider === 'Ollama' ? { toolExecutionStatus } : {})
                                }
                            });
                            this.updateStageMetrics('llmCompletion', followUpStartTime);

                            // Log the follow-up response from the LLM
                            log.info(`========== LLM FOLLOW-UP RESPONSE RECEIVED ==========`);
                            log.info(`Follow-up response model: ${followUpCompletion.response.model}, provider: ${followUpCompletion.response.provider}`);
                            log.info(`Follow-up response text: ${followUpCompletion.response.text?.substring(0, 150)}${followUpCompletion.response.text?.length > 150 ? '...' : ''}`);
                            log.info(`Follow-up contains tool calls: ${!!followUpCompletion.response.tool_calls && followUpCompletion.response.tool_calls.length > 0}`);
                            if (followUpCompletion.response.tool_calls && followUpCompletion.response.tool_calls.length > 0) {
                                log.info(`Follow-up has ${followUpCompletion.response.tool_calls.length} new tool calls`);
                            }

                            // Update current response for the next iteration
                            currentResponse = followUpCompletion.response;

                            // Check if we need to continue the tool calling loop
                            if (!currentResponse.tool_calls || currentResponse.tool_calls.length === 0) {
                                log.info(`========== TOOL EXECUTION COMPLETE ==========`);
                                log.info('No more tool calls, breaking tool execution loop');
                                break;
                            } else {
                                log.info(`========== ADDITIONAL TOOL CALLS DETECTED ==========`);
                                log.info(`Next iteration has ${currentResponse.tool_calls.length} more tool calls`);
                                // Log the next set of tool calls
                                currentResponse.tool_calls.forEach((toolCall, idx) => {
                                    log.info(`Next tool call ${idx + 1}: name=${toolCall.function?.name || 'unknown'}, id=${toolCall.id || 'no-id'}`);
                                    log.info(`Arguments: ${toolCall.function?.arguments || '{}'}`);
                                });
                            }
                        } else {
                            log.info(`========== TOOL EXECUTION COMPLETE ==========`);
                            log.info('No follow-up needed, breaking tool execution loop');
                            break;
                        }
                    } catch (error: any) {
                        log.info(`========== TOOL EXECUTION ERROR ==========`);
                        log.error(`Error in tool execution: ${error.message || String(error)}`);

                        // Add error message to the conversation if tool execution fails
                        currentMessages.push({
                            role: 'system',
                            content: `Error executing tool: ${error.message || String(error)}. Please try a different approach.`
                        });

                        // If streaming, show error to the user
                        if (isStreaming && streamCallback) {
                            streamCallback('', false, {
                                text: '',
                                done: false,
                                toolExecution: {
                                    type: 'error',
                                    tool: {
                                        name: 'unknown',
                                        arguments: {}
                                    },
                                    result: error.message || 'unknown error'
                                }
                            });
                        }

                        // For Ollama, create tool execution status with the error
                        let toolExecutionStatus;
                        if (currentResponse.provider === 'Ollama' && currentResponse.tool_calls) {
                            // We need to create error statuses for all tool calls that failed
                            toolExecutionStatus = currentResponse.tool_calls.map(toolCall => {
                                return {
                                    toolCallId: toolCall.id || '',
                                    name: toolCall.function?.name || 'unknown',
                                    success: false,
                                    result: `Error: ${error.message || 'unknown error'}`,
                                    error: error.message || 'unknown error'
                                };
                            });

                            log.info(`Created error tool execution status for Ollama: ${toolExecutionStatus.length} entries`);
                        }

                        // Make a follow-up request to the LLM with the error information
                        const errorFollowUpCompletion = await this.stages.llmCompletion.execute({
                            messages: currentMessages,
                            options: {
                                ...modelSelection.options,
                                // Preserve streaming for error follow-up
                                stream: modelSelection.options.stream,
                                // For Ollama, include tool execution status
                                ...(currentResponse.provider === 'Ollama' ? { toolExecutionStatus } : {})
                            }
                        });

                        // Log the error follow-up response from the LLM
                        log.info(`========== ERROR FOLLOW-UP RESPONSE RECEIVED ==========`);
                        log.info(`Error follow-up response model: ${errorFollowUpCompletion.response.model}, provider: ${errorFollowUpCompletion.response.provider}`);
                        log.info(`Error follow-up response text: ${errorFollowUpCompletion.response.text?.substring(0, 150)}${errorFollowUpCompletion.response.text?.length > 150 ? '...' : ''}`);
                        log.info(`Error follow-up contains tool calls: ${!!errorFollowUpCompletion.response.tool_calls && errorFollowUpCompletion.response.tool_calls.length > 0}`);

                        // Update current response and break the tool loop
                        currentResponse = errorFollowUpCompletion.response;
                        break;
                    }
                }

                if (toolCallIterations >= maxToolCallIterations) {
                    log.info(`========== MAXIMUM TOOL ITERATIONS REACHED ==========`);
                    log.error(`Reached maximum tool call iterations (${maxToolCallIterations}), terminating loop`);

                    // Add a message to inform the LLM that we've reached the limit
                    currentMessages.push({
                        role: 'system',
                        content: `Maximum tool call iterations (${maxToolCallIterations}) reached. Please provide your best response with the information gathered so far.`
                    });

                    // If streaming, inform the user about iteration limit
                    if (isStreaming && streamCallback) {
                        streamCallback(`[Reached maximum of ${maxToolCallIterations} tool calls. Finalizing response...]\n\n`, false);
                    }

                    // For Ollama, create a status about reaching max iterations
                    let toolExecutionStatus;
                    if (currentResponse.provider === 'Ollama' && currentResponse.tool_calls) {
                        // Create a special status message about max iterations
                        toolExecutionStatus = [
                            {
                                toolCallId: 'max-iterations',
                                name: 'system',
                                success: false,
                                result: `Maximum tool call iterations (${maxToolCallIterations}) reached.`,
                                error: `Reached the maximum number of allowed tool calls (${maxToolCallIterations}). Please provide a final response with the information gathered so far.`
                            }
                        ];

                        log.info(`Created max iterations status for Ollama`);
                    }

                    // Make a final request to get a summary response
                    const finalFollowUpCompletion = await this.stages.llmCompletion.execute({
                        messages: currentMessages,
                        options: {
                            ...modelSelection.options,
                            enableTools: false, // Disable tools for the final response
                            // Preserve streaming setting for max iterations response
                            stream: modelSelection.options.stream,
                            // For Ollama, include tool execution status
                            ...(currentResponse.provider === 'Ollama' ? { toolExecutionStatus } : {})
                        }
                    });

                    // Update the current response
                    currentResponse = finalFollowUpCompletion.response;
                }

                // If streaming was paused for tool execution, resume it now with the final response
                if (isStreaming && streamCallback && streamingPaused) {
                    // First log for debugging
                    const responseText = currentResponse.text || "";
                    log.info(`Resuming streaming with final response: ${responseText.length} chars`);

                    if (responseText.length > 0 && !hasStreamedContent) {
                        // Resume streaming with the final response text only if we haven't already streamed content
                        // This is where we send the definitive done:true signal with the complete content
                        streamCallback(responseText, true);
                        log.info(`Sent final response with done=true signal and text content`);
                    } else if (hasStreamedContent) {
                        log.info(`Content already streamed, sending done=true signal only after tool execution`);
                        // Just send the done signal without duplicating content
                        streamCallback('', true);
                    } else {
                        // For Anthropic, sometimes text is empty but response is in stream
                        if ((currentResponse.provider === 'Anthropic' || currentResponse.provider === 'OpenAI') && currentResponse.stream) {
                            log.info(`Detected empty response text for ${currentResponse.provider} provider with stream, sending stream content directly`);
                            // For Anthropic/OpenAI with stream mode, we need to stream the final response
                            if (currentResponse.stream) {
                                await currentResponse.stream(async (chunk: StreamChunk) => {
                                    // Process the chunk
                                    const processedChunk = await this.processStreamChunk(chunk, input.options);

                                    // Forward to callback
                                    streamCallback(
                                        processedChunk.text,
                                        processedChunk.done || chunk.done || false,
                                        chunk
                                    );
                                });
                                log.info(`Completed streaming final ${currentResponse.provider} response after tool execution`);
                            }
                        } else {
                            // Empty response with done=true as fallback
                            streamCallback('', true);
                            log.info(`Sent empty final response with done=true signal`);
                        }
                    }
                }
            } else if (toolsEnabled) {
                log.info(`========== NO TOOL CALLS DETECTED ==========`);
                log.info(`LLM response did not contain any tool calls, skipping tool execution`);

                // Handle streaming for responses without tool calls
                if (shouldEnableStream && streamCallback && !hasStreamedContent) {
                    log.info(`Sending final streaming response without tool calls: ${currentResponse.text.length} chars`);

                    // Send the final response with done=true to complete the streaming
                    streamCallback(currentResponse.text, true);

                    log.info(`Sent final non-tool response with done=true signal`);
                } else if (shouldEnableStream && streamCallback && hasStreamedContent) {
                    log.info(`Content already streamed, sending done=true signal only`);
                    // Just send the done signal without duplicating content
                    streamCallback('', true);
                }
            }

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
     * Process a stream chunk through the response processing stage
     */
    private async processStreamChunk(chunk: StreamChunk, options?: any): Promise<StreamChunk> {
        try {
            // Only process non-empty chunks
            if (!chunk.text) return chunk;

            // Create a minimal response object for the processor
            const miniResponse = {
                text: chunk.text,
                model: 'streaming',
                provider: 'streaming'
            };

            // Process the chunk text
            const processed = await this.stages.responseProcessing.execute({
                response: miniResponse,
                options: options
            });

            // Return processed chunk
            return {
                ...chunk,
                text: processed.text
            };
        } catch (error) {
            // On error, return original chunk
            log.error(`Error processing stream chunk: ${error}`);
            return chunk;
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

    /**
     * Find tool name from tool call ID by looking at previous assistant messages
     */
    private getToolNameFromToolCallId(messages: Message[], toolCallId: string): string {
        if (!toolCallId) return 'unknown';

        // Look for assistant messages with tool_calls
        for (let i = messages.length - 1; i >= 0; i--) {
            const message = messages[i];
            if (message.role === 'assistant' && message.tool_calls) {
                // Find the tool call with the matching ID
                const toolCall = message.tool_calls.find(tc => tc.id === toolCallId);
                if (toolCall && toolCall.function && toolCall.function.name) {
                    return toolCall.function.name;
                }
            }
        }

        return 'unknown';
    }

    /**
     * Validate tool messages to ensure they're properly formatted
     */
    private validateToolMessages(messages: Message[]): void {
        for (let i = 0; i < messages.length; i++) {
            const message = messages[i];

            // Ensure tool messages have required fields
            if (message.role === 'tool') {
                if (!message.tool_call_id) {
                    log.info(`Tool message missing tool_call_id, adding placeholder`);
                    message.tool_call_id = `tool_${i}`;
                }

                // Content should be a string
                if (typeof message.content !== 'string') {
                    log.info(`Tool message content is not a string, converting`);
                    try {
                        message.content = JSON.stringify(message.content);
                    } catch (e) {
                        message.content = String(message.content);
                    }
                }
            }
        }
    }
}
