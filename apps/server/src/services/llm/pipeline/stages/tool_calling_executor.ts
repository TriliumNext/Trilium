import type { ChatCompletionOptions, Message, NormalizedChatResponse } from '../../ai_interface.js';
import type { StreamCallback } from '../interfaces.js';
import log from '../../../log.js';
import toolRegistry from '../../tools/tool_registry.js';
import { parseToolArguments } from '../../tools/tool_argument_parser.js';
import chatStorageService from '../../chat_storage_service.js';
import {
    generateToolGuidance,
    isEmptyToolResult,
    validateToolBeforeExecution,
    type ToolInterface
} from './tool_calling_helpers.js';

interface ToolValidationResult {
    toolCall: {
        id?: string;
        function: {
            name: string;
            arguments: string | Record<string, unknown>;
        };
    };
    valid: boolean;
    tool: ToolInterface | null;
    error: string | null;
    guidance?: string;
}

export interface ToolCallingExecutionInput {
    response: NormalizedChatResponse;
    messages: Message[];
    options: ChatCompletionOptions;
    streamCallback?: StreamCallback;
}

export interface ToolCallingExecutionOutput {
    response: NormalizedChatResponse;
    needsFollowUp: boolean;
    messages: Message[];
}

export const executeToolCalling: (input: ToolCallingExecutionInput) => Promise<ToolCallingExecutionOutput> = async (input) => {
    const { response, messages, options, streamCallback } = input;

    log.info(`========== TOOL CALLING STAGE ENTRY ==========`);
    log.info(`Response provider: ${response.provider}, model: ${response.model || 'unknown'}`);

    log.info(`LLM requested ${response.tool_calls?.length || 0} tool calls from provider: ${response.provider}`);

    if (!response.tool_calls || response.tool_calls.length === 0) {
        log.info(`No tool calls detected in response from provider: ${response.provider}`);
        log.info(`===== EXITING TOOL CALLING STAGE: No tool_calls =====`);
        return { response, needsFollowUp: false, messages };
    }

    if (response.text) {
        log.info(`Response text: "${response.text.substring(0, 200)}${response.text.length > 200 ? '...' : ''}"`);
    }

    const registryTools = toolRegistry.getAllTools();

    const availableTools: ToolInterface[] = registryTools.map(tool => {
        const toolInterface: ToolInterface = {
            execute: (args: Record<string, unknown>) => tool.execute(args),
            ...tool.definition
        };
        return toolInterface;
    });
    log.info(`Available tools in registry: ${availableTools.length}`);

    if (availableTools.length > 0) {
        const availableToolNames = availableTools.map(t => {
            if (t && typeof t === 'object' && 'definition' in t &&
                t.definition && typeof t.definition === 'object' &&
                'function' in t.definition && t.definition.function &&
                typeof t.definition.function === 'object' &&
                'name' in t.definition.function &&
                typeof t.definition.function.name === 'string') {
                return t.definition.function.name;
            }
            return 'unknown';
        }).join(', ');
        log.info(`Available tools: ${availableToolNames}`);
    }

    if (availableTools.length === 0) {
        log.error(`No tools available in registry, cannot execute tool calls`);
        try {
            log.info('Attempting to initialize tools as recovery step');
            const toolCount = toolRegistry.getAllTools().length;
            log.info(`After recovery initialization: ${toolCount} tools available`);
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            log.error(`Failed to initialize tools in recovery step: ${errorMessage}`);
        }
    }

    const updatedMessages = [...messages];

    updatedMessages.push({
        role: 'assistant',
        content: response.text || "",
        tool_calls: response.tool_calls
    });

    log.info(`========== STARTING TOOL EXECUTION ==========`);
    log.info(`Executing ${response.tool_calls?.length || 0} tool calls in parallel`);

    const executionStartTime = Date.now();

    log.info(`Validating ${response.tool_calls?.length || 0} tools before execution`);
    const validationResults: ToolValidationResult[] = await Promise.all((response.tool_calls || []).map(async (toolCall) => {
        try {
            const tool = toolRegistry.getTool(toolCall.function.name);

            if (!tool) {
                log.error(`Tool not found in registry: ${toolCall.function.name}`);
                const guidance = generateToolGuidance(toolCall.function.name, `Tool not found: ${toolCall.function.name}`);
                return {
                    toolCall,
                    valid: false,
                    tool: null,
                    error: `Tool not found: ${toolCall.function.name}`,
                    guidance
                };
            }

            const isToolValid = await validateToolBeforeExecution(tool as unknown as ToolInterface, toolCall.function.name);
            if (!isToolValid) {
                throw new Error(`Tool '${toolCall.function.name}' failed validation before execution`);
            }

            return {
                toolCall,
                valid: true,
                tool: tool as unknown as ToolInterface,
                error: null
            };
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                toolCall,
                valid: false,
                tool: null,
                error: errorMessage
            };
        }
    }));

    const toolResults = await Promise.all(validationResults.map(async (validation, index) => {
        const { toolCall, valid, tool, error } = validation;

        try {
            log.info(`========== TOOL CALL ${index + 1} OF ${response.tool_calls?.length || 0} ==========`);
            log.info(`Tool call ${index + 1} received - Name: ${toolCall.function.name}, ID: ${toolCall.id || 'unknown'}`);

            const argsStr = typeof toolCall.function.arguments === 'string'
                ? toolCall.function.arguments
                : JSON.stringify(toolCall.function.arguments);
            log.info(`Tool parameters: ${argsStr}`);

            if (!valid || !tool) {
                const toolGuidance = validation.guidance ||
                    generateToolGuidance(toolCall.function.name,
                        error || `Unknown validation error for tool '${toolCall.function.name}'`);

                throw new Error(`${error || `Unknown validation error for tool '${toolCall.function.name}'`}\n${toolGuidance}`);
            }

            log.info(`Tool validated successfully: ${toolCall.function.name}`);

            const metadata = toolRegistry.getToolMetadata(toolCall.function.name);
            const parser = metadata?.parseArguments || parseToolArguments;
            const rawArguments = (typeof toolCall.function.arguments === 'string'
                || (toolCall.function.arguments && typeof toolCall.function.arguments === 'object'))
                ? toolCall.function.arguments
                : '';

            const parsedArguments = parser(rawArguments);
            if (parsedArguments.warnings.length > 0) {
                parsedArguments.warnings.forEach(warning => {
                    log.info(`Tool argument parse warning (${toolCall.function.name}): ${warning}`);
                });
            }

            const args = parsedArguments.args;
            log.info(`Parsed tool arguments keys: ${Object.keys(args).join(', ')}`);

            log.info(`================ EXECUTING TOOL: ${toolCall.function.name} ================`);
            log.info(`Tool parameters: ${Object.keys(args).join(', ')}`);
            log.info(`Parameters values: ${Object.entries(args).map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`).join(', ')}`);

            if (streamCallback) {
                const toolExecutionData = {
                    action: 'start',
                    tool: {
                        name: toolCall.function.name,
                        arguments: args
                    },
                    type: 'start' as const
                };

                const callbackResult = streamCallback('', false, {
                    text: '',
                    done: false,
                    toolExecution: toolExecutionData
                });
                if (callbackResult instanceof Promise) {
                    callbackResult.catch((e: Error) => log.error(`Error sending tool execution start event: ${e.message}`));
                }
            }

            const executionStart = Date.now();
            let result;
            try {
                log.info(`Starting tool execution for ${toolCall.function.name}...`);
                result = await tool.execute(args);
                const executionTime = Date.now() - executionStart;
                log.info(`================ TOOL EXECUTION COMPLETED in ${executionTime}ms ================`);

                if (options?.sessionId) {
                    try {
                        await chatStorageService.recordToolExecution(
                            options.sessionId,
                            toolCall.function.name,
                            toolCall.id || `tool-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
                            args,
                            result,
                            undefined
                        );
                    } catch (storageError) {
                        log.error(`Failed to record tool execution in chat storage: ${storageError}`);
                    }
                }

                if (streamCallback) {
                    const toolExecutionData = {
                        action: 'complete',
                        tool: {
                            name: toolCall.function.name,
                            arguments: {} as Record<string, unknown>
                        },
                        result: typeof result === 'string' ? result : result as Record<string, unknown>,
                        type: 'complete' as const
                    };

                    const callbackResult = streamCallback('', false, {
                        text: '',
                        done: false,
                        toolExecution: toolExecutionData
                    });
                    if (callbackResult instanceof Promise) {
                        callbackResult.catch((e: Error) => log.error(`Error sending tool execution complete event: ${e.message}`));
                    }
                }
            } catch (execError: unknown) {
                const executionTime = Date.now() - executionStart;
                const errorMessage = execError instanceof Error ? execError.message : String(execError);
                log.error(`================ TOOL EXECUTION FAILED in ${executionTime}ms: ${errorMessage} ================`);

                const toolGuidance = generateToolGuidance(toolCall.function.name, errorMessage);
                const enhancedErrorMessage = `${errorMessage}\n${toolGuidance}`;

                if (options?.sessionId) {
                    try {
                        await chatStorageService.recordToolExecution(
                            options.sessionId,
                            toolCall.function.name,
                            toolCall.id || `tool-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
                            args,
                            "",
                            enhancedErrorMessage
                        );
                    } catch (storageError) {
                        log.error(`Failed to record tool execution error in chat storage: ${storageError}`);
                    }
                }

                if (streamCallback) {
                    const toolExecutionData = {
                        action: 'error',
                        tool: {
                            name: toolCall.function.name,
                            arguments: {} as Record<string, unknown>
                        },
                        error: enhancedErrorMessage,
                        type: 'error' as const
                    };

                    const callbackResult = streamCallback('', false, {
                        text: '',
                        done: false,
                        toolExecution: toolExecutionData
                    });
                    if (callbackResult instanceof Promise) {
                        callbackResult.catch((e: Error) => log.error(`Error sending tool execution error event: ${e.message}`));
                    }
                }

                if (execError instanceof Error) {
                    execError.message = enhancedErrorMessage;
                }
                throw execError;
            }

            const resultSummary = typeof result === 'string'
                ? `${result.substring(0, 100)}...`
                : `Object with keys: ${Object.keys(result).join(', ')}`;
            const executionTime = Date.now() - executionStart;
            log.info(`Tool execution completed in ${executionTime}ms - Result: ${resultSummary}`);

            return {
                toolCallId: toolCall.id,
                name: toolCall.function.name,
                result
            };
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            log.error(`Error executing tool ${toolCall.function.name}: ${errorMessage}`);

            const isExecutionError = typeof error === 'object' && error !== null &&
                'name' in error && (error as { name: unknown }).name === "ExecutionError";

            if (streamCallback && !isExecutionError) {
                const toolExecutionData = {
                    action: 'error',
                    tool: {
                        name: toolCall.function.name,
                        arguments: {} as Record<string, unknown>
                    },
                    error: errorMessage,
                    type: 'error' as const
                };

                const callbackResult = streamCallback('', false, {
                    text: '',
                    done: false,
                    toolExecution: toolExecutionData
                });
                if (callbackResult instanceof Promise) {
                    callbackResult.catch((e: Error) => log.error(`Error sending tool execution error event: ${e.message}`));
                }
            }

            return {
                toolCallId: toolCall.id,
                name: toolCall.function.name,
                result: `Error: ${errorMessage}`
            };
        }
    }));

    const totalExecutionTime = Date.now() - executionStartTime;
    log.info(`========== TOOL EXECUTION COMPLETE ==========`);
    log.info(`Completed execution of ${toolResults.length} tools in ${totalExecutionTime}ms`);

    const toolResultMessages: Message[] = [];
    let hasEmptyResults = false;

    for (const result of toolResults) {
        const { toolCallId, name, result: toolResult } = result;

        const resultContent = typeof toolResult === 'string'
            ? toolResult
            : JSON.stringify(toolResult, null, 2);

        const isEmptyResult = isEmptyToolResult(toolResult, name);
        if (isEmptyResult && !resultContent.startsWith('Error:')) {
            hasEmptyResults = true;
            log.info(`Empty result detected for tool ${name}. Will add suggestion to try different parameters.`);
        }

        let enhancedContent = resultContent;
        if (isEmptyResult && !resultContent.startsWith('Error:')) {
            enhancedContent = `${resultContent}\n\nNOTE: This tool returned no useful results with the provided parameters. Consider trying again with different parameters such as broader search terms, different filters, or alternative approaches.`;
        }

        const toolMessage: Message = {
            role: 'tool',
            content: enhancedContent,
            name: name,
            tool_call_id: toolCallId
        };

        log.info(`-------- Tool Result for ${name} (ID: ${toolCallId}) --------`);
        log.info(`Result type: ${typeof toolResult}`);
        log.info(`Result preview: ${resultContent.substring(0, 150)}${resultContent.length > 150 ? '...' : ''}`);
        log.info(`Tool result status: ${resultContent.startsWith('Error:') ? 'ERROR' : isEmptyResult ? 'EMPTY' : 'SUCCESS'}`);

        updatedMessages.push(toolMessage);
        toolResultMessages.push(toolMessage);
    }

    log.info(`========== FOLLOW-UP DECISION ==========`);
    const hasToolResults = toolResultMessages.length > 0;
    const hasErrors = toolResultMessages.some(msg => msg.content.startsWith('Error:'));
    const needsFollowUp = hasToolResults;

    log.info(`Follow-up needed: ${needsFollowUp}`);
    log.info(`Reasoning: ${hasToolResults ? 'Has tool results to process' : 'No tool results'} ${hasErrors ? ', contains errors' : ''} ${hasEmptyResults ? ', contains empty results' : ''}`);

    if (hasEmptyResults && needsFollowUp) {
        log.info('Adding system message requiring the LLM to run additional tools with different parameters');

        const emptyToolNames = toolResultMessages
            .filter(msg => isEmptyToolResult(msg.content, msg.name || ''))
            .map(msg => msg.name);

        let directiveMessage = `YOU MUST NOT GIVE UP AFTER A SINGLE EMPTY SEARCH RESULT. `;

        if (emptyToolNames.includes('search_notes') || emptyToolNames.includes('keyword_search_notes')) {
            directiveMessage += `IMMEDIATELY RUN ANOTHER SEARCH TOOL with broader search terms, alternative keywords, or related concepts. `;
            directiveMessage += `Try synonyms, more general terms, or related topics. `;
        }

        if (emptyToolNames.includes('keyword_search_notes')) {
            directiveMessage += `IMMEDIATELY TRY SEARCH_NOTES INSTEAD as it might find matches where keyword search failed. `;
        }

        directiveMessage += `DO NOT ask the user what to do next or if they want general information. CONTINUE SEARCHING with different parameters.`;

        updatedMessages.push({
            role: 'system',
            content: directiveMessage
        });
    }

    log.info(`Total messages to return to pipeline: ${updatedMessages.length}`);
    log.info(`Last 3 messages in conversation:`);
    const lastMessages = updatedMessages.slice(-3);
    lastMessages.forEach((msg, idx) => {
        const position = updatedMessages.length - lastMessages.length + idx;
        log.info(`Message ${position} (${msg.role}): ${msg.content?.substring(0, 100)}${msg.content?.length > 100 ? '...' : ''}`);
    });

    return {
        response,
        messages: updatedMessages,
        needsFollowUp
    };
};
