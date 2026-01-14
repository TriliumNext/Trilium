import { sanitize } from '@triliumnext/core';

import log from '../../../log.js';
import type { Message } from '../../ai_interface.js';
import { CONTEXT_PROMPTS, FORMATTING_PROMPTS } from '../../constants/llm_prompt_constants.js';
import { LLM_CONSTANTS } from '../../constants/provider_constants.js';
import type { IContextFormatter, NoteSearchResult } from '../../interfaces/context_interfaces.js';
import { calculateAvailableContextSize } from '../../interfaces/model_capabilities.js';
import modelCapabilitiesService from '../../model_capabilities_service.js';

// Use constants from the centralized file
// const CONTEXT_WINDOW = {
//     OPENAI: 16000,
//     ANTHROPIC: 100000,
//     OLLAMA: 4000,  // Reduced to avoid issues
//     DEFAULT: 4000
// };

/**
 * Formats context data for LLM consumption
 *
 * This service is responsible for formatting note data into a structured
 * format that can be efficiently processed by the LLM.
 */
export class ContextFormatter implements IContextFormatter {
    /**
     * Build formatted context from a list of note search results
     *
     * @param sources Array of note data with content and metadata
     * @param query The user's query for context
     * @param providerId Optional provider ID to customize formatting
     * @param messages Optional conversation messages to adjust context size
     * @returns Formatted context string
     */
    async buildContextFromNotes(
        sources: NoteSearchResult[],
        query: string,
        providerId: string = 'default',
        messages: Message[] = []
    ): Promise<string> {
        if (!sources || sources.length === 0) {
            log.info('No sources provided to context formatter');
            return CONTEXT_PROMPTS.NO_NOTES_CONTEXT;
        }

        try {
            // Get model name from provider
            const modelName = providerId;

            // Look up model capabilities
            const modelCapabilities = await modelCapabilitiesService.getChatModelCapabilities(modelName);

            // Calculate available context size for this conversation
            const availableContextSize = calculateAvailableContextSize(
                modelCapabilities,
                messages,
                3 // Expected additional turns
            );

            // Use the calculated size or fall back to constants
            const maxTotalLength = availableContextSize || (
                providerId === 'openai' ? LLM_CONSTANTS.CONTEXT_WINDOW.OPENAI :
                    providerId === 'anthropic' ? LLM_CONSTANTS.CONTEXT_WINDOW.ANTHROPIC :
                        providerId === 'ollama' ? LLM_CONSTANTS.CONTEXT_WINDOW.OLLAMA :
                            LLM_CONSTANTS.CONTEXT_WINDOW.DEFAULT
            );

            // DEBUG: Log context window size
            log.info(`Context window for provider ${providerId}: ${maxTotalLength} chars`);
            log.info(`Building context from notes with query: ${query}`);
            log.info(`Sources length: ${sources.length}`);

            // Use provider-specific formatting
            let formattedContext = '';

            if (providerId === 'ollama') {
                // For Ollama, use a much simpler plain text format that's less prone to encoding issues
                formattedContext = FORMATTING_PROMPTS.CONTEXT_HEADERS.SIMPLE(query);
            } else if (providerId === 'anthropic') {
                formattedContext = CONTEXT_PROMPTS.CONTEXT_HEADERS.ANTHROPIC(query);
            } else {
                formattedContext = CONTEXT_PROMPTS.CONTEXT_HEADERS.DEFAULT(query);
            }

            // Sort sources by similarity if available to prioritize most relevant
            if (sources[0] && sources[0].similarity !== undefined) {
                sources = [...sources].sort((a, b) => (b.similarity || 0) - (a.similarity || 0));
                // Log sorting information
                log.info(`Sources sorted by similarity. Top sources: ${sources.slice(0, 3).map(s => s.title || 'Untitled').join(', ')}`);
            }

            // Track total size to avoid exceeding model context window
            let totalSize = formattedContext.length;
            const formattedSources: string[] = [];

            // Track stats for logging
            let sourcesProcessed = 0;
            let sourcesIncluded = 0;
            let sourcesSkipped = 0;
            let sourcesExceededLimit = 0;

            // Process each source
            for (const source of sources) {
                sourcesProcessed++;
                let content = '';
                let title = 'Untitled Note';

                if (typeof source === 'string') {
                    content = source;
                } else if (source.content) {
                    // For Ollama, use a more aggressive sanitization to avoid encoding issues
                    if (providerId === 'ollama') {
                        content = this.sanitizeForOllama(source.content);
                    } else {
                        content = this.sanitizeNoteContent(source.content, source.type, source.mime);
                    }
                    title = source.title || title;
                } else {
                    sourcesSkipped++;
                    log.info(`Skipping note with no content: ${source.title || 'Untitled'}`);
                    continue; // Skip invalid sources
                }

                // Skip if content is empty or just whitespace/minimal
                if (!content || content.trim().length <= 10) {
                    sourcesSkipped++;
                    log.info(`Skipping note with minimal content: ${title}`);
                    continue;
                }

                // Format source with title - use simple format for Ollama
                let formattedSource = '';
                if (providerId === 'ollama') {
                    // For Ollama, use a simpler format and plain ASCII
                    formattedSource = `<note>\n${FORMATTING_PROMPTS.DIVIDERS.NOTE_START}${title}\n${content}\n</note>\n\n`;
                } else {
                    formattedSource = `<note>\n### ${title}\n${content}\n</note>\n\n`;
                }

                // Check if adding this would exceed our size limit
                if (totalSize + formattedSource.length > maxTotalLength) {
                    sourcesExceededLimit++;
                    // If this is the first source, include a truncated version
                    if (formattedSources.length === 0) {
                        const availableSpace = maxTotalLength - totalSize - 100; // Buffer for closing text
                        if (availableSpace > 200) { // Only if we have reasonable space
                            const truncatedContent = providerId === 'ollama' ?
                                `<note>\n## ${title}\n${content.substring(0, availableSpace)}...\n</note>\n\n` :
                                `<note>\n### ${title}\n${content.substring(0, availableSpace)}...\n</note>\n\n`;
                            formattedSources.push(truncatedContent);
                            totalSize += truncatedContent.length;
                            sourcesIncluded++;
                            log.info(`Truncated first source "${title}" to fit in context window`);
                        }
                    }
                    break;
                }

                formattedSources.push(formattedSource);
                totalSize += formattedSource.length;
                sourcesIncluded++;
            }

            // Log sources stats
            log.info(`Context building stats: processed ${sourcesProcessed}/${sources.length} sources, included ${sourcesIncluded}, skipped ${sourcesSkipped}, exceeded limit ${sourcesExceededLimit}`);
            log.info(`Context size so far: ${totalSize}/${maxTotalLength} chars (${(totalSize/maxTotalLength*100).toFixed(2)}% of limit)`);

            // Add the formatted sources to the context
            formattedContext += formattedSources.join('');

            // Add closing to provide instructions to the AI - use simpler version for Ollama
            let closing = '';
            if (providerId === 'ollama') {
                closing = `\n\n${FORMATTING_PROMPTS.CONTEXT_CLOSERS.SIMPLE}`;
            } else if (providerId === 'anthropic') {
                closing = CONTEXT_PROMPTS.CONTEXT_CLOSINGS.ANTHROPIC;
            } else {
                closing = CONTEXT_PROMPTS.CONTEXT_CLOSINGS.DEFAULT;
            }

            // Check if adding the closing would exceed our limit
            if (totalSize + closing.length <= maxTotalLength) {
                formattedContext += closing;
            }

            // Log final context size
            log.info(`Final context: ${formattedContext.length} chars, ${formattedSources.length} sources included`);

            // DEBUG: Log a sample of the formatted context to verify <note> tags are present
            log.info(`Context sample (first 500 chars): ${formattedContext.substring(0, 500).replace(/\n/g, '\\n')}`);
            log.info(`Context sample (last 500 chars): ${formattedContext.substring(Math.max(0, formattedContext.length - 500)).replace(/\n/g, '\\n')}`);

            return formattedContext;
        } catch (error) {
            log.error(`Error building context from notes: ${error}`);
            return CONTEXT_PROMPTS.ERROR_FALLBACK_CONTEXT;
        }
    }

    /**
     * Sanitize note content for inclusion in context
     *
     * @param content - Raw note content
     * @param type - Note type (text, code, etc.)
     * @param mime - Note mime type
     * @returns Sanitized content
     */
    sanitizeNoteContent(content: string, type?: string, mime?: string): string {
        if (!content) {
            return '';
        }

        try {
            // If it's HTML content, sanitize it
            if (mime === 'text/html' || type === 'text') {
                // First, try to preserve some structure by converting to markdown-like format
                const contentWithMarkdown = content
                    // Convert headers
                    .replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n')
                    .replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n')
                    .replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n')
                    .replace(/<h4[^>]*>(.*?)<\/h4>/gi, '#### $1\n')
                    .replace(/<h5[^>]*>(.*?)<\/h5>/gi, '##### $1\n')
                    // Convert lists
                    .replace(/<\/?ul[^>]*>/g, '\n')
                    .replace(/<\/?ol[^>]*>/g, '\n')
                    .replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n')
                    // Convert links
                    .replace(/<a[^>]*href=["'](.*?)["'][^>]*>(.*?)<\/a>/gi, '[$2]($1)')
                    // Convert code blocks
                    .replace(/<pre[^>]*><code[^>]*>(.*?)<\/code><\/pre>/gis, '```\n$1\n```')
                    .replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`')
                    // Convert emphasis
                    .replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**')
                    .replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**')
                    .replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*')
                    .replace(/<i[^>]*>(.*?)<\/i>/gi, '*$1*')
                    // Handle paragraphs better
                    .replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n')
                    // Handle line breaks
                    .replace(/<br\s*\/?>/gi, '\n');

                // Then sanitize to remove remaining HTML
                const sanitized = sanitize.sanitizeHtmlCustom(contentWithMarkdown, {
                    allowedTags: [], // No tags allowed (strip all HTML)
                    allowedAttributes: {}, // No attributes allowed
                    textFilter(text) {
                        return text
                            .replace(/&nbsp;/g, ' ')
                            .replace(/&lt;/g, '<')
                            .replace(/&gt;/g, '>')
                            .replace(/&quot;/g, '"')
                            .replace(/&amp;/g, '&')
                            .replace(/\n\s*\n\s*\n/g, '\n\n'); // Replace multiple blank lines with just one
                    }
                });

                // Remove unnecessary whitespace while preserving meaningful structure
                return sanitized
                    .replace(/\n{3,}/g, '\n\n')  // no more than 2 consecutive newlines
                    .trim();
            }

            // If it's code, keep formatting but limit size
            if (type === 'code' || mime?.includes('application/')) {
                // For code, limit to a reasonable size
                if (content.length > 2000) {
                    return `${content.substring(0, 2000)  }...\n\n[Content truncated for brevity]`;
                }
                return content;
            }

            // For all other types, just return as is
            return content;
        } catch (error) {
            log.error(`Error sanitizing note content: ${error}`);
            return content; // Return original content if sanitization fails
        }
    }

    /**
     * Special sanitization for Ollama that removes all non-ASCII characters
     * and simplifies formatting to avoid encoding issues
     */
    sanitizeForOllama(content: string): string {
        if (!content) {
            return '';
        }

        try {
            // First remove any HTML
            let plaintext = sanitize.sanitizeHtmlCustom(content, {
                allowedTags: [],
                allowedAttributes: {},
                textFilter: (text) => text
            });

            // Then aggressively sanitize to plain ASCII and simple formatting
            plaintext = plaintext
                // Replace common problematic quotes with simple ASCII quotes
                .replace(/[""]/g, '"')
                .replace(/['']/g, "'")
                // Replace other common Unicode characters
                .replace(/[–—]/g, '-')
                .replace(/[•]/g, '*')
                .replace(/[…]/g, '...')
                // Strip all non-ASCII characters
                .replace(/[^\x00-\x7F]/g, '')
                // Normalize whitespace
                .replace(/\s+/g, ' ')
                .replace(/\n\s+/g, '\n')
                .trim();

            return plaintext;
        } catch (error) {
            log.error(`Error sanitizing note content for Ollama: ${error}`);
            return ''; // Return empty if sanitization fails
        }
    }
}

// Export singleton instance
export default new ContextFormatter();
