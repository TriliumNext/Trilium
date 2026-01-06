import { sanitize } from '@triliumnext/core';

import type { Message } from '../ai_interface.js';
import {
    ENCODING_FIXES,
    FORMATTER_LOGS,
    HTML_ALLOWED_ATTRIBUTES,
    HTML_ALLOWED_TAGS,
    HTML_ENTITY_REPLACEMENTS,
    HTML_TO_MARKDOWN_PATTERNS,
    HTML_TRANSFORMS} from '../constants/formatter_constants.js';
import { DEFAULT_SYSTEM_PROMPT, PROVIDER_PROMPTS } from '../constants/llm_prompt_constants.js';
import type { MessageFormatter } from '../interfaces/message_formatter.js';

/**
 * Base formatter with common functionality for all providers
 * Provider-specific formatters should extend this class
 */
export abstract class BaseMessageFormatter implements MessageFormatter {
    /**
     * Format messages for the LLM API
     * Each provider should override this method with its specific formatting logic
     */
    abstract formatMessages(messages: Message[], systemPrompt?: string, context?: string): Message[];

    /**
     * Get the maximum recommended context length for this provider
     * Each provider should override this with appropriate value
     */
    abstract getMaxContextLength(): number;

    /**
     * Get the default system prompt
     * Uses the default prompt from constants
     */
    protected getDefaultSystemPrompt(systemPrompt?: string): string {
        return systemPrompt || DEFAULT_SYSTEM_PROMPT || PROVIDER_PROMPTS.COMMON.DEFAULT_ASSISTANT_INTRO;
    }

    /**
     * Clean context content - common method with standard HTML cleaning
     * Provider-specific formatters can override for custom behavior
     */
    cleanContextContent(content: string): string {
        if (!content) return '';

        try {
            // First fix any encoding issues
            const fixedContent = this.fixEncodingIssues(content);

            // Convert HTML to markdown for better readability
            const cleaned = sanitize.sanitizeHtmlCustom(fixedContent, {
                allowedTags: HTML_ALLOWED_TAGS.STANDARD,
                allowedAttributes: HTML_ALLOWED_ATTRIBUTES.STANDARD,
                transformTags: HTML_TRANSFORMS.STANDARD
            });

            // Process inline elements to markdown
            let markdown = cleaned;

            // Apply all HTML to Markdown patterns
            const patterns = HTML_TO_MARKDOWN_PATTERNS;
            for (const pattern of Object.values(patterns)) {
                markdown = markdown.replace(pattern.pattern, pattern.replacement);
            }

            // Process list items
            markdown = this.processListItems(markdown);

            // Fix common HTML entities
            const entityPatterns = HTML_ENTITY_REPLACEMENTS;
            for (const pattern of Object.values(entityPatterns)) {
                markdown = markdown.replace(pattern.pattern, pattern.replacement);
            }

            return markdown.trim();
        } catch (error) {
            console.error(FORMATTER_LOGS.ERROR.CONTEXT_CLEANING("Base"), error);
            return content; // Return original if cleaning fails
        }
    }

    /**
     * Process HTML list items in markdown conversion
     * This is a helper method that safely processes HTML list items
     */
    protected processListItems(content: string): string {
        // Process unordered lists
        let result = content.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (match: string, listContent: string) => {
            return listContent.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n');
        });

        // Process ordered lists
        result = result.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (match: string, listContent: string) => {
            let index = 1;
            return listContent.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (itemMatch: string, item: string) => {
                return `${index++}. ${item}\n`;
            });
        });

        return result;
    }

    /**
     * Fix common encoding issues in content
     * This fixes issues like broken quote characters and other encoding problems
     *
     * @param content The content to fix encoding issues in
     * @returns Content with encoding issues fixed
     */
    protected fixEncodingIssues(content: string): string {
        if (!content) return '';

        try {
            // Fix common encoding issues
            let fixed = content.replace(ENCODING_FIXES.BROKEN_QUOTES.pattern, ENCODING_FIXES.BROKEN_QUOTES.replacement);

            // Fix other common broken unicode
            fixed = fixed.replace(/[\u{0080}-\u{FFFF}]/gu, (match) => {
                // Use replacements from constants
                const replacements = ENCODING_FIXES.UNICODE_REPLACEMENTS;
                return replacements[match as keyof typeof replacements] || match;
            });

            return fixed;
        } catch (error) {
            console.error(FORMATTER_LOGS.ERROR.ENCODING, error);
            return content; // Return original if fixing fails
        }
    }
}
