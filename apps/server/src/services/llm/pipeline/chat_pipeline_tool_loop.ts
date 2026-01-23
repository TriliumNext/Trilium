import type { ChatCompletionOptions, Message, NormalizedChatResponse, StreamChunk } from '../ai_interface.js';
import type { LLMCompletionInput, ResponseProcessingInput, StreamCallback, ToolExecutionInput } from './interfaces.js';
import type { StreamingStrategy } from './streaming/streaming_strategy.js';
import log from '../../log.js';
import {
    buildForcedToolCallInstruction,
    buildSyntheticToolCalls,
    getFallbackToolForQuery
} from './chat_pipeline_tool_helpers.js';
import { executeToolExecutionLoop } from './chat_pipeline_tool_execution.js';

export interface ToolLoopStages {
    llmCompletion: {
        execute: (input: LLMCompletionInput) => Promise<{ response: NormalizedChatResponse }>;
    };
    toolCalling: {
        execute: (input: ToolExecutionInput) => Promise<{ response: NormalizedChatResponse; needsFollowUp: boolean; messages: Message[] }>;
    };
    responseProcessing: {
        execute: (input: ResponseProcessingInput) => Promise<{ text: string }>;
    };
}

export interface ToolLoopDependencies {
    stages: ToolLoopStages;
    streamingStrategy: StreamingStrategy;
    updateStageMetrics: (stageName: string, startTime: number) => void;
}

export interface ToolLoopInput {
    messages: Message[];
    userQuery: string;
    providerName?: string;
    options: ChatCompletionOptions;
    chunkOptions?: ChatCompletionOptions;
    streamCallback?: StreamCallback;
    shouldEnableStream: boolean;
    providerStream: boolean;
    toolsEnabled: boolean;
    maxToolCallIterations: number;
    accumulatedText: string;
}

export interface ToolLoopResult {
    response: NormalizedChatResponse;
    messages: Message[];
    accumulatedText: string;
    hasStreamedContent: boolean;
}

export class ChatPipelineToolLoop {
    private readonly stages: ToolLoopStages;
    private readonly streamingStrategy: StreamingStrategy;
    private readonly updateStageMetrics: (stageName: string, startTime: number) => void;

    constructor(dependencies: ToolLoopDependencies) {
        this.stages = dependencies.stages;
        this.streamingStrategy = dependencies.streamingStrategy;
        this.updateStageMetrics = dependencies.updateStageMetrics;
    }

    async run(input: ToolLoopInput): Promise<ToolLoopResult> {
        const {
            messages,
            userQuery,
            providerName,
            options,
            chunkOptions,
            streamCallback,
            shouldEnableStream,
            providerStream,
            toolsEnabled,
            maxToolCallIterations
        } = input;

        let accumulatedText = input.accumulatedText;

        log.info(`========== STAGE 5: LLM COMPLETION ==========`);
        const llmStartTime = Date.now();
        const completion = await this.stages.llmCompletion.execute({
            messages,
            options: {
                ...options,
                stream: providerStream
            }
        });
        this.updateStageMetrics('llmCompletion', llmStartTime);
        log.info(`Received LLM response from model: ${completion.response.model}, provider: ${completion.response.provider}`);

        let hasStreamedContent = false;

        if (shouldEnableStream && completion.response.stream && streamCallback) {
            await completion.response.stream(async (chunk: StreamChunk) => {
                const processedChunk = await this.processStreamChunk(chunk, chunkOptions ?? options);
                accumulatedText += processedChunk.text;
                streamCallback(processedChunk.text, processedChunk.done, chunk);
                hasStreamedContent = true;
            });
        }

        let currentMessages = messages;
        let currentResponse = completion.response;

        log.info(`========== TOOL EXECUTION DECISION ==========`);
        log.info(`Tools enabled in options: ${toolsEnabled}`);
        log.info(`Response provider: ${currentResponse.provider || 'unknown'}`);
        log.info(`Response model: ${currentResponse.model || 'unknown'}`);

        const toolCallResolution = this.resolveToolCalls(currentResponse);
        currentResponse = toolCallResolution.response;
        let hasToolCalls = toolCallResolution.hasToolCalls;

        if (toolsEnabled && !hasToolCalls) {
            const fallbackTool = getFallbackToolForQuery(userQuery);
            const normalizedProvider = (providerName || currentResponse.provider || '').toLowerCase();
            if (fallbackTool && normalizedProvider === 'minimax') {
                log.info(`No tool calls detected. Forcing MiniMax tool call: ${fallbackTool.name} (${fallbackTool.reason})`);
                const forcedMessages: Message[] = [
                    ...currentMessages,
                    {
                        role: 'system' as const,
                        content: buildForcedToolCallInstruction(fallbackTool.name, userQuery)
                    }
                ];

                const forcedToolStream = this.streamingStrategy.resolveFollowUpStreaming({
                    kind: 'tool',
                    hasStreamCallback: !!streamCallback,
                    providerName,
                    toolsEnabled: true
                });

                const forcedCompletion = await this.stages.llmCompletion.execute({
                    messages: forcedMessages,
                    options: {
                        ...options,
                        enableTools: true,
                        stream: forcedToolStream,
                        tool_choice: {
                            type: 'function',
                            function: {
                                name: fallbackTool.name
                            }
                        }
                    }
                });

                currentResponse = forcedCompletion.response;
                if (currentResponse.tool_calls && currentResponse.tool_calls.length > 0) {
                    hasToolCalls = true;
                    log.info(`Forced tool call produced ${currentResponse.tool_calls.length} tool(s).`);
                } else {
                    log.info(`Forced tool call did not produce tool_calls. Injecting synthetic tool call.`);
                    currentResponse.tool_calls = buildSyntheticToolCalls(fallbackTool.name, userQuery);
                    hasToolCalls = currentResponse.tool_calls.length > 0;
                }
            }
        }

        const executionResult = await executeToolExecutionLoop(
            {
                stages: this.stages,
                streamingStrategy: this.streamingStrategy,
                updateStageMetrics: this.updateStageMetrics
            },
            {
                response: currentResponse,
                messages: currentMessages,
                options,
                chunkOptions,
                streamCallback,
                shouldEnableStream,
                toolsEnabled,
                hasToolCalls,
                maxToolCallIterations,
                accumulatedText,
                hasStreamedContent
            }
        );

        currentResponse = executionResult.response;
        currentMessages = executionResult.messages;

        return {
            response: currentResponse,
            messages: currentMessages,
            accumulatedText,
            hasStreamedContent
        };
    }

    private resolveToolCalls(response: NormalizedChatResponse): { response: NormalizedChatResponse; hasToolCalls: boolean } {
        let hasToolCalls = false;

        log.info(`[TOOL CALL DEBUG] Starting tool call detection for provider: ${response.provider}`);
        log.info(`[TOOL CALL DEBUG] Response properties: ${Object.keys(response).join(', ')}`);

        if ('tool_calls' in response) {
            log.info(`[TOOL CALL DEBUG] tool_calls exists as a direct property`);
            log.info(`[TOOL CALL DEBUG] tool_calls type: ${typeof response.tool_calls}`);

            if (response.tool_calls && Array.isArray(response.tool_calls)) {
                log.info(`[TOOL CALL DEBUG] tool_calls is an array with length: ${response.tool_calls.length}`);
            } else {
                log.info(`[TOOL CALL DEBUG] tool_calls is not an array or is empty: ${JSON.stringify(response.tool_calls)}`);
            }
        } else {
            log.info(`[TOOL CALL DEBUG] tool_calls does not exist as a direct property`);
        }

        if (response.tool_calls && response.tool_calls.length > 0) {
            hasToolCalls = true;
            log.info(`Response has tool_calls property with ${response.tool_calls.length} tools`);
            log.info(`Tool calls details: ${JSON.stringify(response.tool_calls)}`);
        } else {
            log.info(`[TOOL CALL DEBUG] Direct property check failed, trying getter approach`);
            try {
                const toolCallsDesc = Object.getOwnPropertyDescriptor(response, 'tool_calls');

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
                    const dynamicToolCalls = toolCallsDesc.get.call(response) as NormalizedChatResponse['tool_calls'];

                    log.info(`[TOOL CALL DEBUG] Getter returned: ${JSON.stringify(dynamicToolCalls)}`);

                    if (dynamicToolCalls && dynamicToolCalls.length > 0) {
                        hasToolCalls = true;
                        log.info(`Response has dynamic tool_calls with ${dynamicToolCalls.length} tools`);
                        log.info(`Dynamic tool calls details: ${JSON.stringify(dynamicToolCalls)}`);
                        response.tool_calls = dynamicToolCalls;
                        log.info(`[TOOL CALL DEBUG] Updated response.tool_calls with dynamic values`);
                    } else {
                        log.info(`[TOOL CALL DEBUG] Getter returned no valid tool calls`);
                    }
                } else {
                    log.info(`[TOOL CALL DEBUG] No getter function found for tool_calls`);
                }
            } catch (error: unknown) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                log.error(`Error checking dynamic tool_calls: ${errorMessage}`);
            }
        }

        log.info(`Response has tool_calls: ${hasToolCalls ? 'true' : 'false'}`);
        if (hasToolCalls && response.tool_calls) {
            log.info(`[TOOL CALL DEBUG] Final tool_calls that will be used: ${JSON.stringify(response.tool_calls)}`);
        }

        return { response, hasToolCalls };
    }

    private async processStreamChunk(chunk: StreamChunk, options?: ChatCompletionOptions): Promise<StreamChunk> {
        try {
            if (!chunk.text) {
                return chunk;
            }

            const miniResponse: NormalizedChatResponse = {
                text: chunk.text,
                model: 'streaming',
                provider: 'streaming',
                tool_calls: []
            };

            const processed = await this.stages.responseProcessing.execute({
                response: miniResponse,
                options: options ?? { enableTools: false }
            });

            return {
                ...chunk,
                text: processed.text
            };
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            log.error(`Error processing stream chunk: ${errorMessage}`);
            return chunk;
        }
    }
}
