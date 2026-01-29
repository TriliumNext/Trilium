import type { ChatResponse } from '../../ai_interface.js';
import type { MiniMaxOptions } from '../provider_options.js';
import log from '../../../log.js';

interface StreamingHandlerParams {
    client: any;
    requestParams: Record<string, unknown>;
    providerOptions: MiniMaxOptions;
    providerName: string;
}

export function createMiniMaxStreamingResponse(params: StreamingHandlerParams): ChatResponse {
    const { client, requestParams, providerOptions, providerName } = params;

    const response: ChatResponse = {
        text: '',
        model: providerOptions.model,
        provider: providerName,
        stream: async (callback) => {
            let fullText = '';
            let toolCalls: any[] = [];

            try {
                log.info(`Creating MiniMax streaming request for model: ${providerOptions.model}`);

                const stream = client.messages.stream({
                    ...requestParams,
                    stream: true
                });

                const activeToolCalls = new Map<string, any>();

                stream.on('text', (textDelta: string) => {
                    fullText += textDelta;

                    callback({
                        text: textDelta,
                        done: false,
                        raw: { type: 'text', text: textDelta }
                    });
                });

                stream.on('contentBlock', async (block: any) => {
                    if (block.type === 'tool_use') {
                        const toolCall = {
                            id: block.id,
                            type: 'function',
                            function: {
                                name: block.name,
                                arguments: JSON.stringify(block.input || {})
                            }
                        };

                        activeToolCalls.set(block.id, toolCall);

                        await callback({
                            text: '',
                            done: false,
                            toolExecution: {
                                type: 'start',
                                tool: {
                                    name: toolCall.function.name,
                                    arguments: JSON.parse(toolCall.function.arguments || '{}')
                                }
                            },
                            raw: { ...block } as Record<string, unknown>
                        });
                    }
                });

                stream.on('inputJson', async (jsonFragment: string) => {
                    if (activeToolCalls.size > 0) {
                        const lastToolId = Array.from(activeToolCalls.keys()).pop();
                        if (lastToolId) {
                            const toolCall = activeToolCalls.get(lastToolId);

                            if (toolCall.function.arguments === '{}') {
                                toolCall.function.arguments = jsonFragment;
                            } else {
                                toolCall.function.arguments += jsonFragment;
                            }

                            await callback({
                                text: '',
                                done: false,
                                toolExecution: {
                                    type: 'update',
                                    tool: toolCall
                                },
                                raw: { type: 'json_fragment', data: jsonFragment } as Record<string, unknown>
                            });
                        }
                    }
                });

                stream.on('message', async (message: any) => {
                    if (message.content) {
                        const toolUseBlocks = message.content.filter(
                            (block: any) => block.type === 'tool_use'
                        );

                        if (toolUseBlocks.length > 0) {
                            toolCalls = toolUseBlocks.map((block: any) => ({
                                id: block.id,
                                type: 'function',
                                function: {
                                    name: block.name,
                                    arguments: JSON.stringify(block.input || {})
                                }
                            })).filter(Boolean);

                            log.info(`[MINIMAX] Found ${toolCalls.length} tool_use blocks in message.content`);
                        }

                        if (toolCalls.length === 0 && activeToolCalls.size > 0) {
                            log.info(`[MINIMAX] Fallback: Converting ${activeToolCalls.size} activeToolCalls to toolCalls`);
                            toolCalls = Array.from(activeToolCalls.values());
                        }

                        const toolCallsToComplete = toolCalls.length > 0 ? toolCalls : Array.from(activeToolCalls.values());
                        for (const toolCall of toolCallsToComplete) {
                            const completeTool = toolCalls.find(candidate => candidate.id === toolCall.id) || toolCall;
                            await callback({
                                text: '',
                                done: false,
                                toolExecution: {
                                    type: 'complete',
                                    tool: completeTool
                                },
                                raw: { type: 'tool_complete', toolId: toolCall.id }
                            });
                        }

                        const textBlocks = message.content.filter(
                            (block: any) => block.type === 'text'
                        ) as Array<{ type: 'text', text: string }>;

                        if (textBlocks.length > 0) {
                            const allText = textBlocks.map(block => block.text).join('');
                            if (allText !== fullText) {
                                fullText = allText;
                            }
                        }
                    }

                    if (toolCalls.length === 0 && activeToolCalls.size > 0) {
                        toolCalls = Array.from(activeToolCalls.values());
                        log.info(`[MINIMAX] Final fallback: Using ${toolCalls.length} toolCalls from activeToolCalls`);
                    }

                    response.text = fullText;
                    if (toolCalls.length > 0) {
                        response.tool_calls = toolCalls;
                        log.info(`[MINIMAX] Set response.tool_calls with ${toolCalls.length} tools`);
                    }
                });

                stream.on('error', (error: any) => {
                    log.error(`MiniMax streaming error: ${error}`);
                    throw error;
                });

                await stream.done();

                log.info(`MiniMax streaming completed with ${toolCalls.length} tool calls`);

                return fullText;
            } catch (error: any) {
                log.error(`MiniMax streaming error: ${error.message || String(error)}`);
                throw error;
            }
        }
    };

    return response;
}
