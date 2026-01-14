import { sanitize } from '@triliumnext/core';

import log from '../../log.js';
import type { Message } from '../ai_interface.js';
import {
    FORMATTER_LOGS,
    HTML_ALLOWED_ATTRIBUTES,
    HTML_ALLOWED_TAGS,
    OLLAMA_CLEANING} from '../constants/formatter_constants.js';
import { PROVIDER_PROMPTS } from '../constants/llm_prompt_constants.js';
import { LLM_CONSTANTS } from '../constants/provider_constants.js';
import { BaseMessageFormatter } from './base_formatter.js';

/**
 * Ollama-specific message formatter
 * Handles the unique requirements of the Ollama API
 */
export class OllamaMessageFormatter extends BaseMessageFormatter {
    /**
     * Maximum recommended context length for Ollama
     * Smaller than other providers due to Ollama's handling of context
     */
    private static MAX_CONTEXT_LENGTH = LLM_CONSTANTS.CONTEXT_WINDOW.OLLAMA;

    /**
     * Format messages for the Ollama API
     * @param messages Messages to format
     * @param systemPrompt Optional system prompt to use
     * @param context Optional context to include
     * @param preserveSystemPrompt When true, preserves existing system messages rather than replacing them
     */
    formatMessages(messages: Message[], systemPrompt?: string, context?: string, preserveSystemPrompt?: boolean, useTools?: boolean): Message[] {
        const formattedMessages: Message[] = [];

        // Log the input messages with all their properties
        log.info(`Ollama formatter received ${messages.length} messages`);
        messages.forEach((msg, index) => {
            const msgKeys = Object.keys(msg);
            log.info(`Message ${index} - role: ${msg.role}, keys: ${msgKeys.join(', ')}, content length: ${msg.content.length}`);

            // Log special properties if present
            if (msg.tool_calls) {
                log.info(`Message ${index} has ${msg.tool_calls.length} tool_calls`);
            }
            if (msg.tool_call_id) {
                log.info(`Message ${index} has tool_call_id: ${msg.tool_call_id}`);
            }
            if (msg.name) {
                log.info(`Message ${index} has name: ${msg.name}`);
            }
        });

        // First identify user, system, and tool messages
        const systemMessages = messages.filter(msg => msg.role === 'system');
        const nonSystemMessages = messages.filter(msg => msg.role !== 'system');

        // Determine if we should preserve the existing system message
        if (preserveSystemPrompt && systemMessages.length > 0) {
            // Preserve the existing system message
            formattedMessages.push(systemMessages[0]);
            log.info(`Preserving existing system message: ${systemMessages[0].content.substring(0, 50)}...`);
        } else {
            // Use provided systemPrompt or default
            let basePrompt = systemPrompt || PROVIDER_PROMPTS.COMMON.DEFAULT_ASSISTANT_INTRO;

            // Check if any message has tool_calls or if useTools flag is set, indicating this is a tool-using conversation
            const hasPreviousToolCalls = messages.some(msg => msg.tool_calls && msg.tool_calls.length > 0);
            const hasToolResults = messages.some(msg => msg.role === 'tool');
            const isToolUsingConversation = useTools || hasPreviousToolCalls || hasToolResults;

            // Add tool instructions for Ollama when tools are being used
            if (isToolUsingConversation && PROVIDER_PROMPTS.OLLAMA.TOOL_INSTRUCTIONS) {
                log.info('Adding tool instructions to system prompt for Ollama');
                basePrompt = `${basePrompt}\n\n${PROVIDER_PROMPTS.OLLAMA.TOOL_INSTRUCTIONS}`;
            }

            formattedMessages.push({
                role: 'system',
                content: basePrompt
            });
            log.info(`Using new system message: ${basePrompt.substring(0, 50)}...`);
        }

        // If we have context, inject it into the first user message
        if (context && nonSystemMessages.length > 0) {
            let injectedContext = false;

            for (let i = 0; i < nonSystemMessages.length; i++) {
                const msg = nonSystemMessages[i];

                if (msg.role === 'user' && !injectedContext) {
                    // Simple context injection directly in the user's message
                    const cleanedContext = this.cleanContextContent(context);
                    log.info(`Injecting context (${cleanedContext.length} chars) into user message`);

                    const formattedContext = PROVIDER_PROMPTS.OLLAMA.CONTEXT_INJECTION(
                        cleanedContext,
                        msg.content
                    );

                    // Log what properties we're preserving
                    const msgKeys = Object.keys(msg);
                    const preservedKeys = msgKeys.filter(key => key !== 'role' && key !== 'content');
                    log.info(`Preserving additional properties in user message: ${preservedKeys.join(', ')}`);

                    // Create a new message with all original properties, but updated content
                    const newMessage = {
                        ...msg, // Copy all properties
                        content: formattedContext // Override content with injected context
                    };

                    formattedMessages.push(newMessage);
                    log.info(`Created user message with context, final keys: ${Object.keys(newMessage).join(', ')}`);

                    injectedContext = true;
                } else {
                    // For other messages, preserve all properties including any tool-related ones
                    log.info(`Preserving message with role ${msg.role}, keys: ${Object.keys(msg).join(', ')}`);

                    formattedMessages.push({
                        ...msg // Copy all properties
                    });
                }
            }
        } else {
            // No context, just add all messages as-is
            // Make sure to preserve all properties including tool_calls, tool_call_id, etc.
            for (const msg of nonSystemMessages) {
                log.info(`Adding message with role ${msg.role} without context injection, keys: ${Object.keys(msg).join(', ')}`);
                formattedMessages.push({
                    ...msg // Copy all properties
                });
            }
        }

        // Log the final formatted messages
        log.info(`Ollama formatter produced ${formattedMessages.length} formatted messages`);
        formattedMessages.forEach((msg, index) => {
            const msgKeys = Object.keys(msg);
            log.info(`Formatted message ${index} - role: ${msg.role}, keys: ${msgKeys.join(', ')}, content length: ${msg.content.length}`);

            // Log special properties if present
            if (msg.tool_calls) {
                log.info(`Formatted message ${index} has ${msg.tool_calls.length} tool_calls`);
            }
            if (msg.tool_call_id) {
                log.info(`Formatted message ${index} has tool_call_id: ${msg.tool_call_id}`);
            }
            if (msg.name) {
                log.info(`Formatted message ${index} has name: ${msg.name}`);
            }
        });

        return formattedMessages;
    }

    /**
     * Clean up HTML and other problematic content before sending to Ollama
     * Ollama needs a more aggressive cleaning than other models,
     * but we want to preserve our XML tags for context
     */
    override cleanContextContent(content: string): string {
        if (!content) return '';

        try {
            // Define regexes for identifying and preserving tagged content
            const notesTagsRegex = /<\/?notes>/g;
            // const queryTagsRegex = /<\/?query>/g; // Commenting out unused variable

            // Capture tags to restore later
            const noteTagPositions: number[] = [];
            let match;
            const regex = /<\/?note>/g;
            while ((match = regex.exec(content)) !== null) {
                noteTagPositions.push(match.index);
            }

            // Remember the notes tags
            const notesTagPositions: number[] = [];
            while ((match = notesTagsRegex.exec(content)) !== null) {
                notesTagPositions.push(match.index);
            }

            // Remember the query tag

            // Temporarily replace XML tags with markers that won't be affected by sanitization
            const modified = content
                .replace(/<note>/g, '[NOTE_START]')
                .replace(/<\/note>/g, '[NOTE_END]')
                .replace(/<notes>/g, '[NOTES_START]')
                .replace(/<\/notes>/g, '[NOTES_END]')
                .replace(/<query>(.*?)<\/query>/g, '[QUERY]$1[/QUERY]');

            // First use the parent class to do standard cleaning
            const sanitized = super.cleanContextContent(modified);

            // Then apply Ollama-specific aggressive cleaning
            // Remove any remaining HTML using sanitizeHtml while keeping our markers
            let plaintext = sanitize.sanitizeHtmlCustom(sanitized, {
                allowedTags: HTML_ALLOWED_TAGS.NONE,
                allowedAttributes: HTML_ALLOWED_ATTRIBUTES.NONE,
                textFilter: (text) => text
            });

            // Apply all Ollama-specific cleaning patterns
            const ollamaPatterns = OLLAMA_CLEANING;
            for (const pattern of Object.values(ollamaPatterns)) {
                plaintext = plaintext.replace(pattern.pattern, pattern.replacement);
            }

            // Restore our XML tags
            plaintext = plaintext
                .replace(/\[NOTE_START\]/g, '<note>')
                .replace(/\[NOTE_END\]/g, '</note>')
                .replace(/\[NOTES_START\]/g, '<notes>')
                .replace(/\[NOTES_END\]/g, '</notes>')
                .replace(/\[QUERY\](.*?)\[\/QUERY\]/g, '<query>$1</query>');

            return plaintext.trim();
        } catch (error) {
            console.error(FORMATTER_LOGS.ERROR.CONTEXT_CLEANING("Ollama"), error);
            return content; // Return original if cleaning fails
        }
    }

    /**
     * Get the maximum recommended context length for Ollama
     */
    getMaxContextLength(): number {
        return OllamaMessageFormatter.MAX_CONTEXT_LENGTH;
    }
}
