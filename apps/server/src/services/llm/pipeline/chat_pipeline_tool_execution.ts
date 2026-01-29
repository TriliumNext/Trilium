import type { ChatCompletionOptions, Message, NormalizedChatResponse, StreamChunk } from '../ai_interface.js';
import type { StreamCallback } from './interfaces.js';
import type { StreamingStrategy } from './streaming/streaming_strategy.js';
import type { ToolLoopStages } from './chat_pipeline_tool_loop.js';
import log from '../../log.js';
import {
    buildFallbackResponseFromToolResults,
    getToolNameFromToolCallId,
    validateToolMessages
} from './chat_pipeline_tool_helpers.js';
import { processStreamChunk } from './chat_pipeline_stream_helpers.js';

export interface ToolExecutionLoopDependencies {
    stages: ToolLoopStages;
    streamingStrategy: StreamingStrategy;
    updateStageMetrics: (stageName: string, startTime: number) => void;
}

export interface ToolExecutionLoopInput {
    response: NormalizedChatResponse;
    messages: Message[];
    options: ChatCompletionOptions;
    chunkOptions?: ChatCompletionOptions;
    streamCallback?: StreamCallback;
    shouldEnableStream: boolean;
    toolsEnabled: boolean;
    hasToolCalls: boolean;
    maxToolCallIterations: number;
    accumulatedText: string;
    hasStreamedContent: boolean;
}

export interface ToolExecutionLoopResult {
    response: NormalizedChatResponse;
    messages: Message[];
}

export const executeToolExecutionLoop: (
    dependencies: ToolExecutionLoopDependencies,
    input: ToolExecutionLoopInput
) => Promise<ToolExecutionLoopResult> = async (dependencies, input) => {
    const {
        response,
        messages,
        options,
        chunkOptions,
        streamCallback,
        shouldEnableStream,
        toolsEnabled,
        hasToolCalls,
        maxToolCallIterations,
        accumulatedText,
        hasStreamedContent
    } = input;

    const { stages, streamingStrategy, updateStageMetrics } = dependencies;

    let currentResponse = response;
    let currentMessages = messages;
    let toolCallIterations = 0;

    if (toolsEnabled && hasToolCalls && currentResponse.tool_calls) {
        log.info(`========== STAGE 6: TOOL EXECUTION ==========`);
        log.info(`Response contains ${currentResponse.tool_calls.length} tool calls, processing...`);

        log.info(`========== TOOL CALL DETAILS ==========`);
        currentResponse.tool_calls.forEach((toolCall, idx) => {
            log.info(`Tool call ${idx + 1}: name=${toolCall.function?.name || 'unknown'}, id=${toolCall.id || 'no-id'}`);
            log.info(`Arguments: ${toolCall.function?.arguments || '{}'}`);
        });

        const isStreaming = shouldEnableStream && streamCallback;
        let streamingPaused = false;

        if (isStreaming && streamCallback) {
            streamingPaused = true;
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

            const previousMessages = [...currentMessages];

            try {
                const toolCallingStartTime = Date.now();
                log.info(`========== PIPELINE TOOL EXECUTION FLOW ==========`);
                log.info(`About to call toolCalling.execute with ${currentResponse.tool_calls.length} tool calls`);
                log.info(`Tool calls being passed to stage: ${JSON.stringify(currentResponse.tool_calls)}`);

                const toolCallingResult = await stages.toolCalling.execute({
                    response: currentResponse,
                    messages: currentMessages,
                    options
                });
                updateStageMetrics('toolCalling', toolCallingStartTime);

                log.info(`ToolCalling stage execution complete, got result with needsFollowUp: ${toolCallingResult.needsFollowUp}`);

                currentMessages = toolCallingResult.messages;

                const toolResultMessages = currentMessages.filter(
                    msg => msg.role === 'tool' && !previousMessages.includes(msg)
                );

                log.info(`========== TOOL EXECUTION RESULTS ==========`);
                log.info(`Received ${toolResultMessages.length} tool results`);
                toolResultMessages.forEach((msg, idx) => {
                    log.info(`Tool result ${idx + 1}: tool_call_id=${msg.tool_call_id}, content=${msg.content}`);
                    log.info(`Tool result status: ${msg.content.startsWith('Error:') ? 'ERROR' : 'SUCCESS'}`);
                    log.info(`Tool result for: ${getToolNameFromToolCallId(currentMessages, msg.tool_call_id || '')}`);

                    if (isStreaming && streamCallback) {
                        const toolName = getToolNameFromToolCallId(currentMessages, msg.tool_call_id || '');

                        try {
                            let parsedContent = msg.content;
                            try {
                                if (msg.content.trim().startsWith('{') || msg.content.trim().startsWith('[')) {
                                    parsedContent = JSON.parse(msg.content);
                                }
                            } catch (error) {
                                log.info(`Could not parse tool result as JSON: ${error}`);
                            }

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
                        } catch (err) {
                            log.error(`Error sending structured tool result: ${err}`);
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

                if (toolCallingResult.needsFollowUp) {
                    log.info(`========== TOOL FOLLOW-UP REQUIRED ==========`);
                    log.info('Tool execution complete, sending results back to LLM');

                    validateToolMessages(currentMessages);

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

                    let toolExecutionStatus;
                    if (currentResponse.provider === 'Ollama') {
                        toolExecutionStatus = toolResultMessages.map(msg => {
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

                    const followUpStartTime = Date.now();

                    log.info(`========== SENDING TOOL RESULTS TO LLM FOR FOLLOW-UP ==========`);
                    log.info(`Total messages being sent: ${currentMessages.length}`);
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

                    const followUpStream = streamingStrategy.resolveFollowUpStreaming({
                        kind: 'tool',
                        hasStreamCallback: !!streamCallback,
                        providerName: currentResponse.provider,
                        toolsEnabled: true
                    });

                    log.info(`LLM follow-up request options: ${JSON.stringify({
                        model: options.model,
                        enableTools: true,
                        stream: followUpStream,
                        provider: currentResponse.provider
                    })}`);

                    const followUpCompletion = await stages.llmCompletion.execute({
                        messages: currentMessages,
                        options: {
                            ...options,
                            enableTools: true,
                            stream: followUpStream,
                            ...(currentResponse.provider === 'Ollama' ? { toolExecutionStatus } : {})
                        }
                    });
                    updateStageMetrics('llmCompletion', followUpStartTime);

                    log.info(`========== LLM FOLLOW-UP RESPONSE RECEIVED ==========`);
                    log.info(`Follow-up response model: ${followUpCompletion.response.model}, provider: ${followUpCompletion.response.provider}`);
                    log.info(`Follow-up response text: ${followUpCompletion.response.text?.substring(0, 150)}${followUpCompletion.response.text?.length > 150 ? '...' : ''}`);
                    log.info(`Follow-up contains tool calls: ${followUpCompletion.response.tool_calls.length > 0}`);
                    if (followUpCompletion.response.tool_calls.length > 0) {
                        log.info(`Follow-up has ${followUpCompletion.response.tool_calls.length} new tool calls`);
                    }

                    currentResponse = followUpCompletion.response;

                    if (currentResponse.tool_calls.length === 0) {
                        log.info(`========== TOOL EXECUTION COMPLETE ==========`);
                        log.info('No more tool calls, breaking tool execution loop');
                        break;
                    } else {
                        log.info(`========== ADDITIONAL TOOL CALLS DETECTED ==========`);
                        log.info(`Next iteration has ${currentResponse.tool_calls.length} more tool calls`);
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
            } catch (error: unknown) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                log.info(`========== TOOL EXECUTION ERROR ==========`);
                log.error(`Error in tool execution: ${errorMessage}`);

                currentMessages.push({
                    role: 'system',
                    content: `Error executing tool: ${errorMessage}. Please try a different approach.`
                });

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
                            result: errorMessage || 'unknown error'
                        }
                    });
                }

                let toolExecutionStatus;
                if (currentResponse.provider === 'Ollama' && currentResponse.tool_calls) {
                    toolExecutionStatus = currentResponse.tool_calls.map(toolCall => {
                        return {
                            toolCallId: toolCall.id || '',
                            name: toolCall.function?.name || 'unknown',
                            success: false,
                            result: `Error: ${errorMessage || 'unknown error'}`,
                            error: errorMessage || 'unknown error'
                        };
                    });

                    log.info(`Created error tool execution status for Ollama: ${toolExecutionStatus.length} entries`);
                }

                const errorFollowUpStream = streamingStrategy.resolveFollowUpStreaming({
                    kind: 'error',
                    hasStreamCallback: !!streamCallback,
                    providerName: currentResponse.provider,
                    toolsEnabled: false
                });

                const errorFollowUpCompletion = await stages.llmCompletion.execute({
                    messages: currentMessages,
                    options: {
                        ...options,
                        enableTools: false,
                        stream: errorFollowUpStream,
                        ...(currentResponse.provider === 'Ollama' ? { toolExecutionStatus } : {})
                    }
                });

                log.info(`========== ERROR FOLLOW-UP RESPONSE RECEIVED ==========`);
                log.info(`Error follow-up response model: ${errorFollowUpCompletion.response.model}, provider: ${errorFollowUpCompletion.response.provider}`);
                log.info(`Error follow-up response text: ${errorFollowUpCompletion.response.text?.substring(0, 150)}${errorFollowUpCompletion.response.text?.length > 150 ? '...' : ''}`);
                log.info(`Error follow-up contains tool calls: ${errorFollowUpCompletion.response.tool_calls.length > 0}`);

                currentResponse = errorFollowUpCompletion.response;
                break;
            }
        }

        if (toolCallIterations >= maxToolCallIterations) {
            log.info(`========== MAXIMUM TOOL ITERATIONS REACHED ==========`);
            log.error(`Reached maximum tool call iterations (${maxToolCallIterations}), terminating loop`);

            currentMessages.push({
                role: 'system',
                content: `Maximum tool call iterations (${maxToolCallIterations}) reached. Please provide your best response with the information gathered so far.`
            });

            if (isStreaming && streamCallback) {
                streamCallback(`[Reached maximum of ${maxToolCallIterations} tool calls. Finalizing response...]\n\n`, false);
            }

            let toolExecutionStatus;
            if (currentResponse.provider === 'Ollama' && currentResponse.tool_calls) {
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

            const maxIterationsStream = streamingStrategy.resolveFollowUpStreaming({
                kind: 'max_iterations',
                hasStreamCallback: !!streamCallback,
                providerName: currentResponse.provider,
                toolsEnabled: false
            });

            const finalFollowUpCompletion = await stages.llmCompletion.execute({
                messages: currentMessages,
                options: {
                    ...options,
                    enableTools: false,
                    stream: maxIterationsStream,
                    ...(currentResponse.provider === 'Ollama' ? { toolExecutionStatus } : {})
                }
            });

            currentResponse = finalFollowUpCompletion.response;
        }

        if (!currentResponse.text || currentResponse.text.trim().length === 0) {
            log.info(`Final response text empty after tool execution. Requesting non-streaming summary.`);
            try {
                const finalTextStream = streamingStrategy.resolveFollowUpStreaming({
                    kind: 'final_text',
                    hasStreamCallback: !!streamCallback,
                    providerName: currentResponse.provider,
                    toolsEnabled: false
                });

                const finalTextCompletion = await stages.llmCompletion.execute({
                    messages: currentMessages,
                    options: {
                        ...options,
                        enableTools: false,
                        stream: finalTextStream
                    }
                });

                currentResponse = finalTextCompletion.response;
            } catch (error: unknown) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                log.error(`Error generating final response text: ${errorMessage}`);
            }

            if (!currentResponse.text || currentResponse.text.trim().length === 0) {
                currentResponse.text = buildFallbackResponseFromToolResults(currentMessages);
            }
        }

        if (isStreaming && streamCallback && streamingPaused) {
            const responseText = currentResponse.text || "";
            log.info(`Resuming streaming with final response: ${responseText.length} chars`);

            const finalText = accumulatedText && responseText.startsWith(accumulatedText)
                ? responseText.slice(accumulatedText.length)
                : responseText;

            if (finalText.length > 0) {
                streamCallback(finalText, true);
                log.info(`Sent final response with done=true signal and ${finalText.length} chars`);
            } else {
                if ((currentResponse.provider === 'Anthropic' || currentResponse.provider === 'OpenAI') && currentResponse.stream) {
                    log.info(`Detected empty response text for ${currentResponse.provider} provider with stream, sending stream content directly`);
                    await currentResponse.stream(async (chunk: StreamChunk) => {
                        const processedChunk = await processStreamChunk(stages, chunk, chunkOptions ?? options);
                        streamCallback(
                            processedChunk.text,
                            processedChunk.done || chunk.done || false,
                            chunk
                        );
                    });
                    log.info(`Completed streaming final ${currentResponse.provider} response after tool execution`);
                } else if (currentResponse.stream) {
                    log.info(`Streaming final response content for provider ${currentResponse.provider || 'unknown'}`);
                    await currentResponse.stream(async (chunk: StreamChunk) => {
                        const processedChunk = await processStreamChunk(stages, chunk, chunkOptions ?? options);
                        streamCallback(
                            processedChunk.text,
                            processedChunk.done || chunk.done || false,
                            chunk
                        );
                    });
                    log.info(`Completed streaming final response after tool execution`);
                } else {
                    streamCallback('', true);
                    log.info(`Sent empty final response with done=true signal`);
                }
            }
        }
    } else if (toolsEnabled) {
        log.info(`========== NO TOOL CALLS DETECTED ==========`);
        log.info(`LLM response did not contain any tool calls, skipping tool execution`);

        if (shouldEnableStream && streamCallback && !hasStreamedContent) {
            log.info(`Sending final streaming response without tool calls: ${currentResponse.text.length} chars`);
            streamCallback(currentResponse.text, true);
            log.info(`Sent final non-tool response with done=true signal`);
        } else if (shouldEnableStream && streamCallback && hasStreamedContent) {
            log.info(`Content already streamed, sending done=true signal only`);
            streamCallback('', true);
        }
    }

    return {
        response: currentResponse,
        messages: currentMessages
    };
};
