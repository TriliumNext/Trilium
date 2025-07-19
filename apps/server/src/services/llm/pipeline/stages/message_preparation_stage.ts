import { BasePipelineStage } from '../pipeline_stage.js';
import type { MessagePreparationInput } from '../interfaces.js';
import type { Message } from '../../ai_interface.js';
import { SYSTEM_PROMPTS } from '../../constants/llm_prompt_constants.js';
import { MessageFormatterFactory } from '../interfaces/message_formatter.js';
import toolRegistry from '../../tools/tool_registry.js';
import log from '../../../log.js';

/**
 * Pipeline stage for preparing messages for LLM completion
 */
export class MessagePreparationStage extends BasePipelineStage<MessagePreparationInput, { messages: Message[] }> {
    constructor() {
        super('MessagePreparation');
    }

    /**
     * Prepare messages for LLM completion, including system prompt and context
     * This uses provider-specific formatters to optimize the message structure
     */
    protected async process(input: MessagePreparationInput): Promise<{ messages: Message[] }> {
        const { messages, context, systemPrompt, options } = input;

        // Determine provider from model string if available (format: "provider:model")
        let provider = 'default';
        if (options?.model && options.model.includes(':')) {
            const [providerName] = options.model.split(':');
            provider = providerName;
        }

        // Check if tools are enabled
        const toolsEnabled = options?.enableTools === true;

        log.info(`Preparing messages for provider: ${provider}, context: ${!!context}, system prompt: ${!!systemPrompt}, tools: ${toolsEnabled}`);
        log.info(`Input message count: ${messages.length}`);

        // Apply intelligent context management for long conversations
        const managedMessages = await this.applyContextManagement(messages, provider, options);
        log.info(`After context management: ${managedMessages.length} messages (reduced by ${messages.length - managedMessages.length})`);

        // Get appropriate formatter for this provider
        const formatter = MessageFormatterFactory.getFormatter(provider);

        // Determine the system prompt to use
        let finalSystemPrompt = systemPrompt || SYSTEM_PROMPTS.DEFAULT_SYSTEM_PROMPT;

        // If tools are enabled, enhance system prompt with tools guidance
        if (toolsEnabled) {
            const toolCount = toolRegistry.getAllTools().length;
            const toolsPrompt = `You have access to ${toolCount} tools to help you respond. 

CRITICAL: You are designed for CONTINUOUS TOOL USAGE and ITERATIVE INVESTIGATION. When you receive tool results, this is NOT the end of your analysis - it's the beginning of deeper investigation.

MANDATORY APPROACH:
- After ANY tool execution, immediately analyze the results and plan follow-up actions
- Use multiple tools in sequence to build comprehensive responses
- Chain tools together systematically - use results from one tool to inform the next
- When you find partial information, immediately search for additional details
- Cross-reference findings with alternative search approaches
- Never stop after a single tool unless you have completely fulfilled the request

TOOL CHAINING EXAMPLES:
- If search_notes finds relevant note IDs → immediately use read_note to get full content
- If initial search returns partial results → try broader terms or alternative keywords
- If one search tool fails → immediately try a different search tool
- Use the information from each tool to inform better parameters for subsequent tools

Remember: Tool usage should be continuous and iterative until you have thoroughly investigated the user's request.`;

            // Add tools guidance to system prompt
            finalSystemPrompt = finalSystemPrompt + '\n\n' + toolsPrompt;
            log.info(`Enhanced system prompt with aggressive tool chaining guidance: ${toolCount} tools available`);
        }

        // Format messages using provider-specific approach
        const formattedMessages = formatter.formatMessages(
            managedMessages,
            finalSystemPrompt,
            context
        );

        log.info(`Formatted ${managedMessages.length} messages into ${formattedMessages.length} messages for provider: ${provider}`);

        return { messages: formattedMessages };
    }

    /**
     * Apply intelligent context management to handle long conversations
     * Implements various strategies like sliding window, summarization, and importance-based pruning
     */
    private async applyContextManagement(messages: Message[], provider: string, options?: any): Promise<Message[]> {
        const maxMessages = this.getMaxMessagesForProvider(provider);
        
        // If we're under the limit, return as-is
        if (messages.length <= maxMessages) {
            log.info(`Message count (${messages.length}) within limit (${maxMessages}), no context management needed`);
            return messages;
        }

        log.info(`Message count (${messages.length}) exceeds limit (${maxMessages}), applying context management`);

        // Strategy 1: Preserve recent messages and important system/tool messages
        const managedMessages = await this.applySlidingWindowWithImportanceFiltering(messages, maxMessages);
        
        // Strategy 2: If still too many, apply summarization to older messages
        if (managedMessages.length > maxMessages) {
            return await this.applySummarizationToOlderMessages(managedMessages, maxMessages);
        }

        return managedMessages;
    }

    /**
     * Get maximum message count for different providers based on their context windows
     */
    private getMaxMessagesForProvider(provider: string): number {
        const limits = {
            'anthropic': 50, // Conservative for Claude's context window management
            'openai': 40,    // Conservative for GPT models
            'ollama': 30,    // More conservative for local models
            'default': 35    // Safe default
        };

        return limits[provider as keyof typeof limits] || limits.default;
    }

    /**
     * Apply sliding window with importance filtering
     * Keeps recent messages and important system/tool messages
     */
    private async applySlidingWindowWithImportanceFiltering(messages: Message[], maxMessages: number): Promise<Message[]> {
        if (messages.length <= maxMessages) {
            return messages;
        }

        // Always preserve the first system message if it exists
        const systemMessages = messages.filter(msg => msg.role === 'system').slice(0, 1);
        
        // Find tool-related messages that are important to preserve
        const toolMessages = messages.filter(msg => 
            msg.role === 'tool' || 
            (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0)
        );

        // Calculate how many recent messages we can keep
        const preservedCount = systemMessages.length;
        const recentMessageCount = Math.min(maxMessages - preservedCount, messages.length);
        
        // Get the most recent messages
        const recentMessages = messages.slice(-recentMessageCount);
        
        // Combine system messages + recent messages, avoiding duplicates
        const result: Message[] = [];
        
        // Add system messages first
        systemMessages.forEach(msg => {
            if (!result.some(existing => existing === msg)) {
                result.push(msg);
            }
        });
        
        // Add recent messages
        recentMessages.forEach(msg => {
            if (!result.some(existing => existing === msg)) {
                result.push(msg);
            }
        });

        log.info(`Sliding window filtering: preserved ${preservedCount} system messages, kept ${recentMessages.length} recent messages`);
        
        return result.slice(0, maxMessages); // Ensure we don't exceed the limit
    }

    /**
     * Apply summarization to older messages when needed
     * Summarizes conversation segments to reduce token count while preserving context
     */
    private async applySummarizationToOlderMessages(messages: Message[], maxMessages: number): Promise<Message[]> {
        if (messages.length <= maxMessages) {
            return messages;
        }

        // Keep recent messages (last 60% of limit)
        const recentCount = Math.floor(maxMessages * 0.6);
        const recentMessages = messages.slice(-recentCount);
        
        // Get older messages to summarize
        const olderMessages = messages.slice(0, messages.length - recentCount);
        
        // Create a summary of older messages
        const summary = this.createConversationSummary(olderMessages);
        
        // Create a summary message
        const summaryMessage: Message = {
            role: 'system',
            content: `CONVERSATION SUMMARY: Previous conversation included ${olderMessages.length} messages. Key points: ${summary}`
        };

        log.info(`Applied summarization: summarized ${olderMessages.length} older messages, kept ${recentMessages.length} recent messages`);
        
        return [summaryMessage, ...recentMessages];
    }

    /**
     * Create a concise summary of conversation messages
     */
    private createConversationSummary(messages: Message[]): string {
        const userQueries: string[] = [];
        const assistantActions: string[] = [];
        const toolUsage: string[] = [];

        messages.forEach(msg => {
            if (msg.role === 'user') {
                // Extract key topics from user messages
                const content = msg.content?.substring(0, 100) || '';
                if (content.trim()) {
                    userQueries.push(content.trim());
                }
            } else if (msg.role === 'assistant') {
                // Track tool usage
                if (msg.tool_calls && msg.tool_calls.length > 0) {
                    msg.tool_calls.forEach(tool => {
                        if (tool.function?.name) {
                            toolUsage.push(tool.function.name);
                        }
                    });
                }
            }
        });

        const summary: string[] = [];
        
        if (userQueries.length > 0) {
            summary.push(`User asked about: ${userQueries.slice(0, 3).join(', ')}`);
        }
        
        if (toolUsage.length > 0) {
            const uniqueTools = [...new Set(toolUsage)];
            summary.push(`Tools used: ${uniqueTools.slice(0, 5).join(', ')}`);
        }

        return summary.join('. ') || 'General conversation about notes and information retrieval';
    }
}
