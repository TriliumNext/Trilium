import type { ChatResponse, Message } from '../../ai_interface.js';
import log from '../../../log.js';
import type { StreamCallback, ToolExecutionInput } from '../interfaces.js';
import { BasePipelineStage } from '../pipeline_stage.js';
import toolRegistry from '../../tools/tool_registry.js';
import chatStorageService from '../../chat_storage_service.js';
import aiServiceManager from '../../ai_service_manager.js';

// Type definitions for tools and validation results
interface ToolInterface {
    execute: (args: Record<string, unknown>) => Promise<unknown>;
    [key: string]: unknown;
}

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
    guidance?: string; // Guidance to help the LLM select better tools/parameters
}

/**
 * Pipeline stage for handling LLM tool calling
 * This stage is responsible for:
 * 1. Detecting tool calls in LLM responses
 * 2. Executing the appropriate tools
 * 3. Adding tool results back to the conversation
 * 4. Determining if we need to make another call to the LLM
 */
export class ToolCallingStage extends BasePipelineStage<ToolExecutionInput, { response: ChatResponse, needsFollowUp: boolean, messages: Message[] }> {
    constructor() {
        super('ToolCalling');
        // Vector search tool has been removed - no preloading needed
    }

    /**
     * Process the LLM response and execute any tool calls
     */
    protected async process(input: ToolExecutionInput): Promise<{ response: ChatResponse, needsFollowUp: boolean, messages: Message[] }> {
        const { response, messages } = input;
        const streamCallback = input.streamCallback as StreamCallback;

        log.info(`========== TOOL CALLING STAGE ENTRY ==========`);
        log.info(`Response provider: ${response.provider}, model: ${response.model || 'unknown'}`);

        log.info(`LLM requested ${response.tool_calls?.length || 0} tool calls from provider: ${response.provider}`);

        // Check if the response has tool calls
        if (!response.tool_calls || response.tool_calls.length === 0) {
            // No tool calls, return original response and messages
            log.info(`No tool calls detected in response from provider: ${response.provider}`);
            log.info(`===== EXITING TOOL CALLING STAGE: No tool_calls =====`);
            return { response, needsFollowUp: false, messages };
        }

        // Log response details for debugging
        if (response.text) {
            log.info(`Response text: "${response.text.substring(0, 200)}${response.text.length > 200 ? '...' : ''}"`);
        }

        // Check if the registry has any tools
        const registryTools = toolRegistry.getAllTools();

        // Convert ToolHandler[] to ToolInterface[] with proper type safety
        const availableTools: ToolInterface[] = registryTools.map(tool => {
            // Create a proper ToolInterface from the ToolHandler
            const toolInterface: ToolInterface = {
                // Pass through the execute method
                execute: (args: Record<string, unknown>) => tool.execute(args),
                // Include other properties from the tool definition
                ...tool.definition
            };
            return toolInterface;
        });
        log.info(`Available tools in registry: ${availableTools.length}`);

        // Log available tools for debugging
        if (availableTools.length > 0) {
            const availableToolNames = availableTools.map(t => {
                // Safely access the name property using type narrowing
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
            // Try to initialize tools as a recovery step
            try {
                log.info('Attempting to initialize tools as recovery step');
                // Tools are already initialized in the AIServiceManager constructor
                // No need to initialize them again
                const toolCount = toolRegistry.getAllTools().length;
                log.info(`After recovery initialization: ${toolCount} tools available`);
            } catch (error: unknown) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                log.error(`Failed to initialize tools in recovery step: ${errorMessage}`);
            }
        }

        // Create a copy of messages to add the assistant message with tool calls
        const updatedMessages = [...messages];

        // Add the assistant message with the tool calls
        updatedMessages.push({
            role: 'assistant',
            content: response.text || "",
            tool_calls: response.tool_calls
        });

        // Execute each tool call and add results to messages
        log.info(`========== STARTING TOOL EXECUTION ==========`);
        log.info(`Executing ${response.tool_calls?.length || 0} tool calls in parallel`);

        const executionStartTime = Date.now();

        // First validate all tools before execution
        log.info(`Validating ${response.tool_calls?.length || 0} tools before execution`);
        const validationResults: ToolValidationResult[] = await Promise.all((response.tool_calls || []).map(async (toolCall) => {
            try {
                // Get the tool from registry
                const tool = toolRegistry.getTool(toolCall.function.name);

                if (!tool) {
                    log.error(`Tool not found in registry: ${toolCall.function.name}`);
                    // Generate guidance for the LLM when a tool is not found
                    const guidance = this.generateToolGuidance(toolCall.function.name, `Tool not found: ${toolCall.function.name}`);
                    return {
                        toolCall,
                        valid: false,
                        tool: null,
                        error: `Tool not found: ${toolCall.function.name}`,
                        guidance // Add guidance for the LLM
                    };
                }

                // Validate the tool before execution
                // Use unknown as an intermediate step for type conversion
                const isToolValid = await this.validateToolBeforeExecution(tool as unknown as ToolInterface, toolCall.function.name);
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

        // Execute the validated tools
        const toolResults = await Promise.all(validationResults.map(async (validation, index) => {
            const { toolCall, valid, tool, error } = validation;

            try {
                log.info(`========== TOOL CALL ${index + 1} OF ${response.tool_calls?.length || 0} ==========`);
                log.info(`Tool call ${index + 1} received - Name: ${toolCall.function.name}, ID: ${toolCall.id || 'unknown'}`);

                // Log parameters
                const argsStr = typeof toolCall.function.arguments === 'string'
                    ? toolCall.function.arguments
                    : JSON.stringify(toolCall.function.arguments);
                log.info(`Tool parameters: ${argsStr}`);

                // If validation failed, generate guidance and throw the error
                if (!valid || !tool) {
                    // If we already have guidance from validation, use it, otherwise generate it
                    const toolGuidance = validation.guidance ||
                        this.generateToolGuidance(toolCall.function.name,
                            error || `Unknown validation error for tool '${toolCall.function.name}'`);

                    // Include the guidance in the error message
                    throw new Error(`${error || `Unknown validation error for tool '${toolCall.function.name}'`}\n${toolGuidance}`);
                }

                log.info(`Tool validated successfully: ${toolCall.function.name}`);

                // Parse arguments (handle both string and object formats)
                let args: Record<string, unknown>;
                // At this stage, arguments should already be processed by the provider-specific service
                // But we still need to handle different formats just in case
                if (typeof toolCall.function.arguments === 'string') {
                    log.info(`Received string arguments in tool calling stage: ${toolCall.function.arguments.substring(0, 50)}...`);

                    try {
                        // Try to parse as JSON first
                        args = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
                        log.info(`Parsed JSON arguments: ${Object.keys(args).join(', ')}`);
                    } catch (e: unknown) {
                        // If it's not valid JSON, try to check if it's a stringified object with quotes
                        const errorMessage = e instanceof Error ? e.message : String(e);
                        log.info(`Failed to parse arguments as JSON, trying alternative parsing: ${errorMessage}`);

                        // Sometimes LLMs return stringified JSON with escaped quotes or incorrect quotes
                        // Try to clean it up
                        try {
                            const cleaned = toolCall.function.arguments
                                .replace(/^['"]/g, '') // Remove surrounding quotes
                                .replace(/['"]$/g, '') // Remove surrounding quotes
                                .replace(/\\"/g, '"')        // Replace escaped quotes
                                .replace(/([{,])\s*'([^']+)'\s*:/g, '$1"$2":') // Replace single quotes around property names
                                .replace(/([{,])\s*(\w+)\s*:/g, '$1"$2":');    // Add quotes around unquoted property names

                            log.info(`Cleaned argument string: ${cleaned}`);
                            args = JSON.parse(cleaned) as Record<string, unknown>;
                            log.info(`Successfully parsed cleaned arguments: ${Object.keys(args).join(', ')}`);
                        } catch (cleanError: unknown) {
                            // If all parsing fails, treat it as a text argument
                            const cleanErrorMessage = cleanError instanceof Error ? cleanError.message : String(cleanError);
                            log.info(`Failed to parse cleaned arguments: ${cleanErrorMessage}`);
                            args = { text: toolCall.function.arguments };
                            log.info(`Using text argument: ${(args.text as string).substring(0, 50)}...`);
                        }
                    }
                } else {
                    // Arguments are already an object
                    args = toolCall.function.arguments as Record<string, unknown>;
                    log.info(`Using object arguments with keys: ${Object.keys(args).join(', ')}`);
                }

                // Execute the tool
                log.info(`================ EXECUTING TOOL: ${toolCall.function.name} ================`);
                log.info(`Tool parameters: ${Object.keys(args).join(', ')}`);
                log.info(`Parameters values: ${Object.entries(args).map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`).join(', ')}`);

                // Emit tool start event if streaming is enabled
                if (streamCallback) {
                    const toolExecutionData = {
                        action: 'start',
                        tool: {
                            name: toolCall.function.name,
                            arguments: args
                        },
                        type: 'start' as const,
                        progress: {
                            current: index + 1,
                            total: response.tool_calls?.length || 1,
                            status: 'initializing',
                            message: `Starting ${toolCall.function.name} execution...`,
                            estimatedDuration: this.getEstimatedDuration(toolCall.function.name)
                        }
                    };

                    // Don't wait for this to complete, but log any errors
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
                    
                    // Send progress update during execution
                    if (streamCallback) {
                        const progressData = {
                            action: 'progress',
                            tool: {
                                name: toolCall.function.name,
                                arguments: args
                            },
                            type: 'progress' as const,
                            progress: {
                                current: index + 1,
                                total: response.tool_calls?.length || 1,
                                status: 'executing',
                                message: `Executing ${toolCall.function.name}...`,
                                startTime: executionStart
                            }
                        };

                        const progressResult = streamCallback('', false, {
                            text: '',
                            done: false,
                            toolExecution: progressData
                        });
                        if (progressResult instanceof Promise) {
                            progressResult.catch((e: Error) => log.error(`Error sending tool execution progress event: ${e.message}`));
                        }
                    }

                    result = await tool.execute(args);
                    const executionTime = Date.now() - executionStart;
                    log.info(`================ TOOL EXECUTION COMPLETED in ${executionTime}ms ================`);

                    // Record this successful tool execution if there's a sessionId available
                    if (input.options?.sessionId) {
                        try {
                            await chatStorageService.recordToolExecution(
                                input.options.sessionId,
                                toolCall.function.name,
                                toolCall.id || `tool-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
                                args,
                                result,
                                undefined // No error for successful execution
                            );
                        } catch (storageError) {
                            log.error(`Failed to record tool execution in chat storage: ${storageError}`);
                        }
                    }

                    // Emit tool completion event if streaming is enabled
                    if (streamCallback) {
                        const resultSummary = typeof result === 'string' 
                            ? result.substring(0, 200) + (result.length > 200 ? '...' : '')
                            : `Object with ${Object.keys(result).length} properties`;

                        const toolExecutionData = {
                            action: 'complete',
                            tool: {
                                name: toolCall.function.name,
                                arguments: {} as Record<string, unknown>
                            },
                            result: typeof result === 'string' ? result : result as Record<string, unknown>,
                            type: 'complete' as const,
                            progress: {
                                current: index + 1,
                                total: response.tool_calls?.length || 1,
                                status: 'completed',
                                message: `${toolCall.function.name} completed successfully`,
                                executionTime: executionTime,
                                resultSummary: resultSummary
                            }
                        };

                        // Don't wait for this to complete, but log any errors
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

                    // Generate guidance for the failed tool execution
                    const toolGuidance = this.generateToolGuidance(toolCall.function.name, errorMessage);

                    // Add the guidance to the error message for the LLM
                    const enhancedErrorMessage = `${errorMessage}\n${toolGuidance}`;

                    // Record this failed tool execution if there's a sessionId available
                    if (input.options?.sessionId) {
                        try {
                            await chatStorageService.recordToolExecution(
                                input.options.sessionId,
                                toolCall.function.name,
                                toolCall.id || `tool-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
                                args,
                                "", // No result for failed execution
                                enhancedErrorMessage // Use enhanced error message with guidance
                            );
                        } catch (storageError) {
                            log.error(`Failed to record tool execution error in chat storage: ${storageError}`);
                        }
                    }

                    // Emit tool error event if streaming is enabled
                    if (streamCallback) {
                        const toolExecutionData = {
                            action: 'error',
                            tool: {
                                name: toolCall.function.name,
                                arguments: {} as Record<string, unknown>
                            },
                            error: enhancedErrorMessage, // Include guidance in the error message
                            type: 'error' as const,
                            progress: {
                                current: index + 1,
                                total: response.tool_calls?.length || 1,
                                status: 'failed',
                                message: `${toolCall.function.name} failed: ${errorMessage.substring(0, 100)}...`,
                                executionTime: executionTime,
                                errorType: execError instanceof Error ? execError.constructor.name : 'UnknownError'
                            }
                        };

                        // Don't wait for this to complete, but log any errors
                        const callbackResult = streamCallback('', false, {
                            text: '',
                            done: false,
                            toolExecution: toolExecutionData
                        });
                        if (callbackResult instanceof Promise) {
                            callbackResult.catch((e: Error) => log.error(`Error sending tool execution error event: ${e.message}`));
                        }
                    }

                    // Modify the error to include our guidance
                    if (execError instanceof Error) {
                        execError.message = enhancedErrorMessage;
                    }
                    throw execError;
                }

                // Log execution result
                const resultSummary = typeof result === 'string'
                    ? `${result.substring(0, 100)}...`
                    : `Object with keys: ${Object.keys(result).join(', ')}`;
                const executionTime = Date.now() - executionStart;
                log.info(`Tool execution completed in ${executionTime}ms - Result: ${resultSummary}`);

                // Return result with tool call ID
                return {
                    toolCallId: toolCall.id,
                    name: toolCall.function.name,
                    result
                };
            } catch (error: unknown) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                log.error(`Error executing tool ${toolCall.function.name}: ${errorMessage}`);

                // Emit tool error event if not already handled in the try/catch above
                // and if streaming is enabled
                // Need to check if error is an object with a name property of type string
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

                    // Don't wait for this to complete, but log any errors
                    const callbackResult = streamCallback('', false, {
                        text: '',
                        done: false,
                        toolExecution: toolExecutionData
                    });
                    if (callbackResult instanceof Promise) {
                        callbackResult.catch((e: Error) => log.error(`Error sending tool execution error event: ${e.message}`));
                    }
                }

                // Return error message as result
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

        // Add each tool result to the messages array
        const toolResultMessages: Message[] = [];
        let hasEmptyResults = false;

        for (const result of toolResults) {
            const { toolCallId, name, result: toolResult } = result;

            // Format result for message
            const resultContent = typeof toolResult === 'string'
                ? toolResult
                : JSON.stringify(toolResult, null, 2);

            // Check if result is empty or unhelpful
            const isEmptyResult = this.isEmptyToolResult(toolResult, name);
            if (isEmptyResult && !resultContent.startsWith('Error:')) {
                hasEmptyResults = true;
                log.info(`Empty result detected for tool ${name}. Will add suggestion to try different parameters.`);
            }

            // Add enhancement for empty results and continuation signals
            let enhancedContent = resultContent;
            if (isEmptyResult && !resultContent.startsWith('Error:')) {
                enhancedContent = `${resultContent}\n\nCONTINUATION REQUIRED: This tool returned no useful results with the provided parameters. You MUST immediately try additional searches with broader terms, alternative keywords, or different tools. Do not stop here - continue your investigation.`;
            } else if (!resultContent.startsWith('Error:')) {
                // Add continuation signal for successful results too
                enhancedContent = `${resultContent}\n\nCONTINUATION: Analyze these results and determine if additional tools are needed to provide a comprehensive response. Consider follow-up searches, reading specific notes, or cross-referencing with other tools.`;
            }

            // Add a new message for the tool result
            const toolMessage: Message = {
                role: 'tool',
                content: enhancedContent,
                name: name,
                tool_call_id: toolCallId
            };

            // Log detailed info about each tool result
            log.info(`-------- Tool Result for ${name} (ID: ${toolCallId}) --------`);
            log.info(`Result type: ${typeof toolResult}`);
            log.info(`Result preview: ${resultContent.substring(0, 150)}${resultContent.length > 150 ? '...' : ''}`);
            log.info(`Tool result status: ${resultContent.startsWith('Error:') ? 'ERROR' : isEmptyResult ? 'EMPTY' : 'SUCCESS'}`);

            updatedMessages.push(toolMessage);
            toolResultMessages.push(toolMessage);
        }

        // Log the decision about follow-up
        log.info(`========== FOLLOW-UP DECISION ==========`);
        const hasToolResults = toolResultMessages.length > 0;
        const hasErrors = toolResultMessages.some(msg => msg.content.startsWith('Error:'));
        const needsFollowUp = hasToolResults;

        log.info(`Follow-up needed: ${needsFollowUp}`);
        log.info(`Reasoning: ${hasToolResults ? 'Has tool results to process' : 'No tool results'} ${hasErrors ? ', contains errors' : ''} ${hasEmptyResults ? ', contains empty results' : ''}`);

        // Add system message to ensure continuation - always add this for any tool results
        if (needsFollowUp) {
            log.info('Adding system message to ensure LLM continues with additional tools');

            let directiveMessage = '';

            // Handle empty results with aggressive re-search instructions
            if (hasEmptyResults) {
                directiveMessage = `CRITICAL: Empty results detected. YOU MUST NOT GIVE UP. IMMEDIATELY try alternative approaches:
- Use broader search terms (remove specific qualifiers)
- Try synonyms and related concepts
- Use different search tools (if keyword_search failed, try search_notes)
- Remove date/time constraints and try general terms
DO NOT respond to the user until you've tried at least 2-3 additional search variations.`;
            } else {
                // For successful results, provide comprehensive follow-up instructions
                directiveMessage = `TOOL ANALYSIS CONTINUATION: You have received tool results above. This is NOT the end of your investigation. You must:

1. Analyze the results thoroughly
2. Determine if additional information is needed
3. Use follow-up tools to gather comprehensive information
4. If search results included note IDs, use read_note to get full content
5. Cross-reference findings with alternative search approaches
6. Continue investigation until you can provide a complete, well-researched response

REMEMBER: Execute multiple tools in sequence to build comprehensive answers. The user expects thorough investigation with systematic tool usage.

Continue your systematic investigation now.`;
            }

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
    }


    /**
     * Validate a tool before execution
     * @param tool The tool to validate
     * @param toolName The name of the tool
     */
    private async validateToolBeforeExecution(tool: ToolInterface, toolName: string): Promise<boolean> {
        try {
            if (!tool) {
                log.error(`Tool '${toolName}' not found or failed validation`);
                return false;
            }

            // Validate execute method
            if (!tool.execute || typeof tool.execute !== 'function') {
                log.error(`Tool '${toolName}' is missing execute method`);
                return false;
            }

            // search_notes tool now uses context handler instead of vector search
            if (toolName === 'search_notes') {
                log.info(`Tool '${toolName}' validated - uses context handler instead of vector search`);
            }

            // Add additional tool-specific validations here
            return true;
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            log.error(`Error validating tool before execution: ${errorMessage}`);
            return false;
        }
    }

    /**
     * Generate guidance for the LLM when a tool fails or is not found
     * @param toolName The name of the tool that failed
     * @param errorMessage The error message from the failed tool
     * @returns A guidance message for the LLM with suggestions of what to try next
     */
    private generateToolGuidance(toolName: string, errorMessage: string): string {
        // Get all available tool names for recommendations
        const availableTools = toolRegistry.getAllTools();
        const availableToolNames = availableTools
            .map(t => {
                if (t && typeof t === 'object' && 'definition' in t &&
                    t.definition && typeof t.definition === 'object' &&
                    'function' in t.definition && t.definition.function &&
                    typeof t.definition.function === 'object' &&
                    'name' in t.definition.function &&
                    typeof t.definition.function.name === 'string') {
                    return t.definition.function.name;
                }
                return '';
            })
            .filter(name => name !== '');

        // Create specific guidance based on the error and tool
        let guidance = `TOOL GUIDANCE: The tool '${toolName}' failed with error: ${errorMessage}.\n`;

        // Add suggestions based on the specific tool and error
        if (toolName === 'attribute_search' && errorMessage.includes('Invalid attribute type')) {
            guidance += "CRITICAL REQUIREMENT: The 'attribute_search' tool requires 'attributeType' parameter that must be EXACTLY 'label' or 'relation' (lowercase, no other values).\n";
            guidance += "CORRECT EXAMPLE: { \"attributeType\": \"label\", \"attributeName\": \"important\", \"attributeValue\": \"yes\" }\n";
            guidance += "INCORRECT EXAMPLE: { \"attributeType\": \"Label\", ... } - Case matters! Must be lowercase.\n";
        }
        else if (errorMessage.includes('Tool not found')) {
            // Provide guidance on available search tools if a tool wasn't found
            const searchTools = availableToolNames.filter(name => name.includes('search'));
            guidance += `AVAILABLE SEARCH TOOLS: ${searchTools.join(', ')}\n`;
            guidance += "TRY SEARCH NOTES: For semantic matches, use 'search_notes' with a query parameter.\n";
            guidance += "EXAMPLE: { \"query\": \"your search terms here\" }\n";
        }
        else if (errorMessage.includes('missing required parameter')) {
            // Provide parameter guidance based on the tool name
            if (toolName === 'search_notes') {
                guidance += "REQUIRED PARAMETERS: The 'search_notes' tool requires a 'query' parameter.\n";
                guidance += "EXAMPLE: { \"query\": \"your search terms here\" }\n";
            } else if (toolName === 'keyword_search') {
                guidance += "REQUIRED PARAMETERS: The 'keyword_search' tool requires a 'query' parameter.\n";
                guidance += "EXAMPLE: { \"query\": \"your search terms here\" }\n";
            }
        }

        // Add general recommendations including new helper tools
        if (!toolName.includes('search_notes')) {
            guidance += "RECOMMENDATION: If specific searches fail, try the 'search_notes' tool which performs semantic searches.\n";
        }
        
        // Encourage continued tool usage
        guidance += "\nTry alternative tools immediately. Use discover_tools if unsure which tool to use next.";

        return guidance;
    }

    /**
     * Get estimated duration for a tool execution (in milliseconds)
     * @param toolName The name of the tool
     * @returns Estimated duration in milliseconds
     */
    private getEstimatedDuration(toolName: string): number {
        // Tool-specific duration estimates based on typical execution times
        const estimations = {
            'search_notes': 2000,
            'read_note': 1000,
            'keyword_search': 1500,
            'attribute_search': 1200,
            'discover_tools': 500,
            'note_by_path': 800,
            'template_search': 1000
        };

        return estimations[toolName as keyof typeof estimations] || 1500; // Default 1.5 seconds
    }

    /**
     * Determines if a tool result is effectively empty or unhelpful
     * @param result The result from the tool execution
     * @param toolName The name of the tool that was executed
     * @returns true if the result is considered empty or unhelpful
     */
    private isEmptyToolResult(result: unknown, toolName: string): boolean {
        // Handle string results
        if (typeof result === 'string') {
            const trimmed = result.trim();
            if (trimmed === '' || trimmed === '[]' || trimmed === '{}') {
                return true;
            }

            // Tool-specific empty results (for string responses)
            if (toolName === 'search_notes' &&
                (trimmed === 'No matching notes found.' ||
                 trimmed.includes('No results found') ||
                 trimmed.includes('No matches found') ||
                 trimmed.includes('No notes found'))) {
                // This is a valid result (empty, but valid), don't mark as empty so LLM can see feedback
                return false;
            }


            if (toolName === 'keyword_search' &&
                (trimmed.includes('No matches found') ||
                 trimmed.includes('No results for'))) {
                return true;
            }
        }
        // Handle object/array results
        else if (result !== null && typeof result === 'object') {
            // Check if it's an empty array
            if (Array.isArray(result) && result.length === 0) {
                return true;
            }

            // Check if it's an object with no meaningful properties
            // or with properties indicating empty results
            if (!Array.isArray(result)) {
                if (Object.keys(result).length === 0) {
                    return true;
                }

                // Tool-specific object empty checks
                const resultObj = result as Record<string, unknown>;

                if (toolName === 'search_notes' &&
                    'results' in resultObj &&
                    Array.isArray(resultObj.results) &&
                    resultObj.results.length === 0) {
                    return true;
                }

            }
        }

        return false;
    }

}
