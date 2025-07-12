import { BasePipelineStage } from '../pipeline_stage.js';
import type { ToolExecutionInput, StreamCallback } from '../interfaces.js';
import type { ChatResponse, Message } from '../../ai_interface.js';
import toolRegistry from '../../tools/tool_registry.js';
import log from '../../../log.js';

interface RetryStrategy {
    maxRetries: number;
    baseDelay: number;
    maxDelay: number;
    backoffMultiplier: number;
    jitter: boolean;
}

interface ToolRetryContext {
    toolName: string;
    attempt: number;
    lastError: string;
    alternativeApproaches: string[];
    usedApproaches: string[];
}

/**
 * Advanced Error Recovery Pipeline Stage
 * Implements sophisticated retry strategies with exponential backoff,
 * alternative tool selection, and intelligent fallback mechanisms
 */
export class ErrorRecoveryStage extends BasePipelineStage<ToolExecutionInput, { response: ChatResponse, needsFollowUp: boolean, messages: Message[] }> {
    
    private retryStrategies: Map<string, RetryStrategy> = new Map();
    private activeRetries: Map<string, ToolRetryContext> = new Map();

    constructor() {
        super('ErrorRecovery');
        this.initializeRetryStrategies();
    }

    /**
     * Initialize retry strategies for different tool types
     */
    private initializeRetryStrategies(): void {
        // Search tools - more aggressive retries since they're critical
        this.retryStrategies.set('search_notes', {
            maxRetries: 3,
            baseDelay: 1000,
            maxDelay: 8000,
            backoffMultiplier: 2,
            jitter: true
        });

        this.retryStrategies.set('keyword_search', {
            maxRetries: 3,
            baseDelay: 800,
            maxDelay: 6000,
            backoffMultiplier: 2,
            jitter: true
        });

        // Read operations - moderate retries
        this.retryStrategies.set('read_note', {
            maxRetries: 2,
            baseDelay: 500,
            maxDelay: 3000,
            backoffMultiplier: 2,
            jitter: false
        });

        // Attribute operations - conservative retries
        this.retryStrategies.set('attribute_search', {
            maxRetries: 2,
            baseDelay: 1200,
            maxDelay: 5000,
            backoffMultiplier: 1.8,
            jitter: true
        });

        // Default strategy for unknown tools
        this.retryStrategies.set('default', {
            maxRetries: 2,
            baseDelay: 1000,
            maxDelay: 4000,
            backoffMultiplier: 2,
            jitter: true
        });
    }

    /**
     * Process tool execution with advanced error recovery
     */
    protected async process(input: ToolExecutionInput): Promise<{ response: ChatResponse, needsFollowUp: boolean, messages: Message[] }> {
        const { response } = input;

        // If no tool calls, pass through
        if (!response.tool_calls || response.tool_calls.length === 0) {
            return { response, needsFollowUp: false, messages: input.messages };
        }

        log.info(`========== ERROR RECOVERY STAGE PROCESSING ==========`);
        log.info(`Processing ${response.tool_calls.length} tool calls with advanced error recovery`);

        const recoveredToolCalls: Array<{
            toolCall: any;
            message: Message;
            attempts: number;
            recovered: boolean;
        }> = [];
        const updatedMessages = [...input.messages];

        // Process each tool call with recovery
        for (let i = 0; i < response.tool_calls.length; i++) {
            const toolCall = response.tool_calls[i];
            const recoveredResult = await this.executeToolWithRecovery(toolCall, input, i);
            
            if (recoveredResult) {
                recoveredToolCalls.push(recoveredResult);
                updatedMessages.push(recoveredResult.message);
            }
        }

        // Create enhanced response with recovery information
        const enhancedResponse: ChatResponse = {
            ...response,
            tool_calls: recoveredToolCalls.map(r => r.toolCall),
            recovery_metadata: {
                total_attempts: recoveredToolCalls.reduce((sum, r) => sum + r.attempts, 0),
                successful_recoveries: recoveredToolCalls.filter(r => r.recovered).length,
                failed_permanently: recoveredToolCalls.filter(r => !r.recovered).length
            }
        };

        const needsFollowUp = recoveredToolCalls.length > 0;

        log.info(`Recovery complete: ${recoveredToolCalls.filter(r => r.recovered).length}/${recoveredToolCalls.length} tools recovered`);

        return {
            response: enhancedResponse,
            needsFollowUp,
            messages: updatedMessages
        };
    }

    /**
     * Execute a tool call with comprehensive error recovery
     */
    private async executeToolWithRecovery(
        toolCall: any, 
        input: ToolExecutionInput, 
        index: number
    ): Promise<{ toolCall: any, message: Message, attempts: number, recovered: boolean } | null> {
        
        const toolName = toolCall.function.name;
        const strategy = this.retryStrategies.get(toolName) || this.retryStrategies.get('default')!;
        
        let lastError = '';
        let attempts = 0;
        let recovered = false;

        // Initialize retry context
        const retryContext: ToolRetryContext = {
            toolName,
            attempt: 0,
            lastError: '',
            alternativeApproaches: this.getAlternativeApproaches(toolName),
            usedApproaches: []
        };

        log.info(`Starting error recovery for tool: ${toolName} (max retries: ${strategy.maxRetries})`);

        // Primary execution attempts
        for (attempts = 1; attempts <= strategy.maxRetries + 1; attempts++) {
            try {
                retryContext.attempt = attempts;

                // Add delay for retry attempts (not first attempt)
                if (attempts > 1) {
                    const delay = this.calculateDelay(strategy, attempts - 1);
                    log.info(`Retry attempt ${attempts - 1} for ${toolName} after ${delay}ms delay`);
                    await this.sleep(delay);

                    // Send retry notification if streaming
                    if (input.streamCallback) {
                        this.sendRetryNotification(input.streamCallback, toolName, attempts - 1, strategy.maxRetries);
                    }
                }

                // Execute the tool
                const tool = toolRegistry.getTool(toolName);
                if (!tool) {
                    throw new Error(`Tool not found: ${toolName}`);
                }

                // Parse arguments
                const args = this.parseToolArguments(toolCall.function.arguments);
                
                // Modify arguments for retry if needed
                const modifiedArgs = this.modifyArgsForRetry(args, retryContext);
                
                log.info(`Executing ${toolName} (attempt ${attempts}) with args: ${JSON.stringify(modifiedArgs)}`);
                
                const result = await tool.execute(modifiedArgs);
                
                // Success!
                recovered = true;
                log.info(`✓ Tool ${toolName} succeeded on attempt ${attempts}`);

                return {
                    toolCall,
                    message: {
                        role: 'tool',
                        content: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
                        name: toolName,
                        tool_call_id: toolCall.id
                    },
                    attempts,
                    recovered: true
                };

            } catch (error) {
                lastError = error instanceof Error ? error.message : String(error);
                retryContext.lastError = lastError;
                
                log.info(`✗ Tool ${toolName} failed on attempt ${attempts}: ${lastError}`);

                // If this was the last allowed attempt, break
                if (attempts > strategy.maxRetries) {
                    break;
                }
            }
        }

        // Primary attempts failed, try alternative approaches
        log.info(`Primary attempts failed for ${toolName}, trying alternative approaches`);
        
        for (const alternative of retryContext.alternativeApproaches) {
            if (retryContext.usedApproaches.includes(alternative)) {
                continue; // Skip already used approaches
            }

            try {
                log.info(`Trying alternative approach: ${alternative} for ${toolName}`);
                retryContext.usedApproaches.push(alternative);

                const alternativeResult = await this.executeAlternativeApproach(alternative, toolCall, retryContext);
                
                if (alternativeResult) {
                    log.info(`✓ Alternative approach ${alternative} succeeded for ${toolName}`);
                    recovered = true;
                    
                    return {
                        toolCall,
                        message: {
                            role: 'tool',
                            content: `ALTERNATIVE_SUCCESS: ${alternative} succeeded where ${toolName} failed. Result: ${alternativeResult}`,
                            name: toolName,
                            tool_call_id: toolCall.id
                        },
                        attempts: attempts + 1,
                        recovered: true
                    };
                }
            } catch (error) {
                const altError = error instanceof Error ? error.message : String(error);
                log.info(`✗ Alternative approach ${alternative} failed: ${altError}`);
            }
        }

        // All attempts failed
        log.error(`All recovery attempts failed for ${toolName} after ${attempts} attempts and ${retryContext.usedApproaches.length} alternatives`);

        // Return failure message with guidance
        const failureGuidance = this.generateFailureGuidance(toolName, lastError, retryContext);
        
        return {
            toolCall,
            message: {
                role: 'tool',
                content: `RECOVERY_FAILED: Tool ${toolName} failed after ${attempts} attempts and ${retryContext.usedApproaches.length} alternative approaches. Last error: ${lastError}\n\n${failureGuidance}`,
                name: toolName,
                tool_call_id: toolCall.id
            },
            attempts,
            recovered: false
        };
    }

    /**
     * Calculate retry delay with exponential backoff and optional jitter
     */
    private calculateDelay(strategy: RetryStrategy, retryNumber: number): number {
        let delay = strategy.baseDelay * Math.pow(strategy.backoffMultiplier, retryNumber - 1);
        
        // Apply maximum delay limit
        delay = Math.min(delay, strategy.maxDelay);
        
        // Add jitter if enabled (±25% random variation)
        if (strategy.jitter) {
            const jitterRange = delay * 0.25;
            const jitter = (Math.random() - 0.5) * 2 * jitterRange;
            delay += jitter;
        }
        
        return Math.round(Math.max(delay, 100)); // Minimum 100ms delay
    }

    /**
     * Sleep for specified milliseconds
     */
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Get alternative approaches for a tool
     */
    private getAlternativeApproaches(toolName: string): string[] {
        const alternatives: Record<string, string[]> = {
            'search_notes': ['keyword_search', 'broader_search_terms', 'attribute_search'],
            'keyword_search': ['search_notes', 'simplified_query', 'attribute_search'],
            'attribute_search': ['search_notes', 'keyword_search', 'different_attribute_type'],
            'read_note': ['note_by_path', 'search_and_read', 'template_search'],
            'note_by_path': ['read_note', 'search_notes', 'keyword_search']
        };

        return alternatives[toolName] || ['search_notes', 'keyword_search'];
    }

    /**
     * Modify arguments for retry attempts
     */
    private modifyArgsForRetry(args: Record<string, unknown>, context: ToolRetryContext): Record<string, unknown> {
        const modified = { ...args };

        // For search tools, broaden the query on retries
        if (context.toolName.includes('search') && context.attempt > 1) {
            if (modified.query && typeof modified.query === 'string') {
                // Remove quotes and qualifiers to broaden the search
                modified.query = (modified.query as string)
                    .replace(/['"]/g, '') // Remove quotes
                    .replace(/\b(exactly|specific|precise)\b/gi, '') // Remove limiting words
                    .trim();
                
                log.info(`Modified query for retry: "${modified.query}"`);
            }
        }

        // For attribute search, try different attribute types
        if (context.toolName === 'attribute_search' && context.attempt > 1) {
            if (modified.attributeType === 'label') {
                modified.attributeType = 'relation';
            } else if (modified.attributeType === 'relation') {
                modified.attributeType = 'label';
            }
            
            log.info(`Modified attributeType for retry: ${modified.attributeType}`);
        }

        return modified;
    }

    /**
     * Execute alternative approach
     */
    private async executeAlternativeApproach(
        approach: string, 
        originalToolCall: any, 
        context: ToolRetryContext
    ): Promise<string | null> {
        
        switch (approach) {
            case 'broader_search_terms':
                return await this.executeBroaderSearch(originalToolCall);
                
            case 'simplified_query':
                return await this.executeSimplifiedSearch(originalToolCall);
                
            case 'different_attribute_type':
                return await this.executeDifferentAttributeSearch(originalToolCall);
                
            case 'search_and_read':
                return await this.executeSearchAndRead(originalToolCall);
                
            default:
                // Try to execute the alternative tool directly
                return await this.executeAlternativeTool(approach, originalToolCall);
        }
    }

    /**
     * Execute broader search approach
     */
    private async executeBroaderSearch(toolCall: any): Promise<string | null> {
        const args = this.parseToolArguments(toolCall.function.arguments);
        
        if (args.query && typeof args.query === 'string') {
            // Extract the main keywords and search more broadly
            const keywords = (args.query as string)
                .split(' ')
                .filter(word => word.length > 3)
                .slice(0, 3) // Take only first 3 main keywords
                .join(' ');
            
            const broadArgs = { ...args, query: keywords };
            
            const tool = toolRegistry.getTool('search_notes');
            if (tool) {
                const result = await tool.execute(broadArgs);
                return typeof result === 'string' ? result : JSON.stringify(result);
            }
        }
        
        return null;
    }

    /**
     * Execute simplified search approach
     */
    private async executeSimplifiedSearch(toolCall: any): Promise<string | null> {
        const args = this.parseToolArguments(toolCall.function.arguments);
        
        if (args.query && typeof args.query === 'string') {
            // Use only the first word as a very simple search
            const firstWord = (args.query as string).split(' ')[0];
            const simpleArgs = { ...args, query: firstWord };
            
            const tool = toolRegistry.getTool('keyword_search');
            if (tool) {
                const result = await tool.execute(simpleArgs);
                return typeof result === 'string' ? result : JSON.stringify(result);
            }
        }
        
        return null;
    }

    /**
     * Execute different attribute search
     */
    private async executeDifferentAttributeSearch(toolCall: any): Promise<string | null> {
        const args = this.parseToolArguments(toolCall.function.arguments);
        
        if (args.attributeType) {
            const newType = args.attributeType === 'label' ? 'relation' : 'label';
            const newArgs = { ...args, attributeType: newType };
            
            const tool = toolRegistry.getTool('attribute_search');
            if (tool) {
                const result = await tool.execute(newArgs);
                return typeof result === 'string' ? result : JSON.stringify(result);
            }
        }
        
        return null;
    }

    /**
     * Execute search and read approach
     */
    private async executeSearchAndRead(toolCall: any): Promise<string | null> {
        const args = this.parseToolArguments(toolCall.function.arguments);
        
        // First search for notes
        const searchTool = toolRegistry.getTool('search_notes');
        if (searchTool && args.query) {
            try {
                const searchResult = await searchTool.execute({ query: args.query });
                
                // Try to extract note IDs and read the first one
                const searchText = typeof searchResult === 'string' ? searchResult : JSON.stringify(searchResult);
                const noteIdMatch = searchText.match(/note[:\s]+([a-zA-Z0-9]+)/i);
                
                if (noteIdMatch && noteIdMatch[1]) {
                    const readTool = toolRegistry.getTool('read_note');
                    if (readTool) {
                        const readResult = await readTool.execute({ noteId: noteIdMatch[1] });
                        return `SEARCH_AND_READ: Found and read note ${noteIdMatch[1]}. Content: ${readResult}`;
                    }
                }
                
                return `SEARCH_ONLY: ${searchText}`;
            } catch (error) {
                return null;
            }
        }
        
        return null;
    }

    /**
     * Execute alternative tool
     */
    private async executeAlternativeTool(toolName: string, originalToolCall: any): Promise<string | null> {
        const tool = toolRegistry.getTool(toolName);
        if (!tool) {
            return null;
        }
        
        const args = this.parseToolArguments(originalToolCall.function.arguments);
        
        try {
            const result = await tool.execute(args);
            return typeof result === 'string' ? result : JSON.stringify(result);
        } catch (error) {
            return null;
        }
    }

    /**
     * Parse tool arguments safely
     */
    private parseToolArguments(args: string | Record<string, unknown>): Record<string, unknown> {
        if (typeof args === 'string') {
            try {
                return JSON.parse(args);
            } catch {
                return { query: args };
            }
        }
        return args;
    }

    /**
     * Send retry notification via streaming
     */
    private sendRetryNotification(
        streamCallback: StreamCallback, 
        toolName: string, 
        retryNumber: number, 
        maxRetries: number
    ): void {
        streamCallback('', false, {
            text: '',
            done: false,
            toolExecution: {
                type: 'retry',
                action: 'retry',
                tool: { name: toolName, arguments: {} },
                progress: {
                    current: retryNumber,
                    total: maxRetries,
                    status: 'retrying',
                    message: `Retrying ${toolName} (attempt ${retryNumber}/${maxRetries})...`
                }
            }
        });
    }

    /**
     * Generate failure guidance
     */
    private generateFailureGuidance(toolName: string, lastError: string, context: ToolRetryContext): string {
        const guidance = [
            `RECOVERY ANALYSIS for ${toolName}:`,
            `- Primary attempts: ${context.attempt}`,
            `- Alternative approaches tried: ${context.usedApproaches.join(', ') || 'none'}`,
            `- Last error: ${lastError}`,
            '',
            'SUGGESTED NEXT STEPS:',
            '- Try manual search with broader terms',
            '- Check if the requested information exists',
            '- Use discover_tools to find alternative tools',
            '- Reformulate the query with different keywords'
        ];

        return guidance.join('\n');
    }
}