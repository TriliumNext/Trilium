import { sanitize } from '@triliumnext/core';

import log from '../../log.js';
import type { Message } from '../ai_interface.js';
import {
    FORMATTER_LOGS,
    HTML_ALLOWED_ATTRIBUTES,
    HTML_ALLOWED_TAGS,
    HTML_ENTITY_REPLACEMENTS,
    HTML_TO_MARKDOWN_PATTERNS} from '../constants/formatter_constants.js';
import { PROVIDER_PROMPTS } from '../constants/llm_prompt_constants.js';
import { LLM_CONSTANTS } from '../constants/provider_constants.js';
import { BaseMessageFormatter } from './base_formatter.js';

/**
 * OpenAI-specific message formatter
 * Optimized for OpenAI's API requirements and preferences
 */
export class OpenAIMessageFormatter extends BaseMessageFormatter {
    /**
     * Maximum recommended context length for OpenAI
     * Based on GPT-4 context window size
     */
    private static MAX_CONTEXT_LENGTH = LLM_CONSTANTS.CONTEXT_WINDOW.OPENAI;

    /**
     * Format messages for the OpenAI API
     * @param messages The messages to format
     * @param systemPrompt Optional system prompt to use
     * @param context Optional context to include
     * @param preserveSystemPrompt When true, preserves existing system messages
     * @param useTools Flag indicating if tools will be used in this request
     */
    formatMessages(messages: Message[], systemPrompt?: string, context?: string, preserveSystemPrompt?: boolean, useTools?: boolean): Message[] {
        const formattedMessages: Message[] = [];

        // Check if we already have a system message
        const hasSystemMessage = messages.some(msg => msg.role === 'system');
        const userAssistantMessages = messages.filter(msg => msg.role === 'user' || msg.role === 'assistant');

        // If we have explicit context, format it properly
        if (context) {
            // For OpenAI, it's best to put context in the system message
            const formattedContext = PROVIDER_PROMPTS.OPENAI.SYSTEM_WITH_CONTEXT(
                this.cleanContextContent(context)
            );

            // Add as system message
            formattedMessages.push({
                role: 'system',
                content: formattedContext
            });
        }
        // If we don't have explicit context but have a system prompt
        else if (!hasSystemMessage && systemPrompt) {
            let baseSystemPrompt = systemPrompt || PROVIDER_PROMPTS.COMMON.DEFAULT_ASSISTANT_INTRO;

            // Check if this is a tool-using conversation
            const hasPreviousToolCalls = messages.some(msg => msg.tool_calls && msg.tool_calls.length > 0);
            const hasToolResults = messages.some(msg => msg.role === 'tool');
            const isToolUsingConversation = useTools || hasPreviousToolCalls || hasToolResults;

            // Add tool instructions for OpenAI when tools are being used
            if (isToolUsingConversation && PROVIDER_PROMPTS.OPENAI.TOOL_INSTRUCTIONS) {
                log.info('Adding tool instructions to system prompt for OpenAI');
                baseSystemPrompt = `${baseSystemPrompt}\n\n${PROVIDER_PROMPTS.OPENAI.TOOL_INSTRUCTIONS}`;
            }

            formattedMessages.push({
                role: 'system',
                content: baseSystemPrompt
            });
        }
        // If neither context nor system prompt is provided, use default system prompt
        else if (!hasSystemMessage) {
            formattedMessages.push({
                role: 'system',
                content: this.getDefaultSystemPrompt(systemPrompt)
            });
        }
        // Otherwise if there are existing system messages, keep them
        else if (hasSystemMessage) {
            // Keep any existing system messages
            const systemMessages = messages.filter(msg => msg.role === 'system');
            for (const msg of systemMessages) {
                formattedMessages.push({
                    role: 'system',
                    content: this.cleanContextContent(msg.content)
                });
            }
        }

        // Add all user and assistant messages
        for (const msg of userAssistantMessages) {
            formattedMessages.push({
                role: msg.role,
                content: msg.content
            });
        }

        console.log(FORMATTER_LOGS.OPENAI.PROCESSED(messages.length, formattedMessages.length));
        return formattedMessages;
    }

    /**
     * Clean context content for OpenAI
     * OpenAI handles HTML better than Ollama but still benefits from some cleaning
     */
    override cleanContextContent(content: string): string {
        if (!content) return '';

        try {
            // Convert HTML to Markdown for better readability
            const cleaned = sanitize.sanitizeHtmlCustom(content, {
                allowedTags: HTML_ALLOWED_TAGS.STANDARD,
                allowedAttributes: HTML_ALLOWED_ATTRIBUTES.STANDARD
            });

            // Apply all HTML to Markdown patterns
            let markdown = cleaned;
            for (const pattern of Object.values(HTML_TO_MARKDOWN_PATTERNS)) {
                markdown = markdown.replace(pattern.pattern, pattern.replacement);
            }

            // Fix common HTML entities
            for (const pattern of Object.values(HTML_ENTITY_REPLACEMENTS)) {
                markdown = markdown.replace(pattern.pattern, pattern.replacement);
            }

            return markdown.trim();
        } catch (error) {
            console.error(FORMATTER_LOGS.ERROR.CONTEXT_CLEANING("OpenAI"), error);
            return content; // Return original if cleaning fails
        }
    }

    /**
     * Get the maximum recommended context length for OpenAI
     */
    getMaxContextLength(): number {
        return OpenAIMessageFormatter.MAX_CONTEXT_LENGTH;
    }
}
