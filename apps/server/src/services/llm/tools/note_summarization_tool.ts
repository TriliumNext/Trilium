/**
 * Note Summarization Tool
 *
 * This tool allows the LLM to generate concise summaries of longer notes.
 */

import type { Tool, ToolHandler } from './tool_interfaces.js';
import log from '../../log.js';
import becca from '../../../becca/becca.js';
import aiServiceManager from '../ai_service_manager.js';
import { SEARCH_CONSTANTS } from '../constants/search_constants.js';

/**
 * Definition of the note summarization tool
 */
export const noteSummarizationToolDefinition: Tool = {
    type: 'function',
    function: {
        name: 'summarize_note',
        description: 'Create a short summary of a long note. Examples: summarize_note(noteId) → creates paragraph summary, summarize_note(noteId, format="bullets") → creates bullet points, summarize_note(noteId, focus="key decisions") → focuses on decisions.',
        parameters: {
            type: 'object',
            properties: {
                noteId: {
                    type: 'string',
                    description: 'Which note to summarize. Use noteId from search results. Example: "abc123def456"'
                },
                maxLength: {
                    type: 'number',
                    description: 'How long the summary should be in characters. Use 200-300 for brief, 500-800 for detailed. Default is 500.'
                },
                format: {
                    type: 'string',
                    description: 'How to format the summary: "paragraph" for flowing text, "bullets" for key points, "executive" for business-style summary',
                    enum: ['paragraph', 'bullets', 'executive']
                },
                focus: {
                    type: 'string',
                    description: 'What to emphasize in the summary. Examples: "key decisions", "technical details", "action items", "main conclusions", "important dates"'
                }
            },
            required: ['noteId']
        }
    }
};

/**
 * Note summarization tool implementation
 */
export class NoteSummarizationTool implements ToolHandler {
    public definition: Tool = noteSummarizationToolDefinition;

    /**
     * Execute the note summarization tool
     */
    public async execute(args: {
        noteId: string,
        maxLength?: number,
        format?: 'paragraph' | 'bullets' | 'executive',
        focus?: string
    }): Promise<string | object> {
        try {
            const { noteId, maxLength = SEARCH_CONSTANTS.LIMITS.DEFAULT_NOTE_SUMMARY_LENGTH, format = 'paragraph', focus } = args;

            log.info(`Executing summarize_note tool - NoteID: "${noteId}", MaxLength: ${maxLength}, Format: ${format}`);

            // Get the note from becca
            const note = becca.notes[noteId];

            if (!note) {
                log.info(`Note with ID ${noteId} not found - returning error`);
                return `Error: Note with ID ${noteId} not found`;
            }

            log.info(`Found note: "${note.title}" (Type: ${note.type})`);

            // Get the note content
            const content = await note.getContent();

            if (!content || typeof content !== 'string' || content.trim().length === 0) {
                return {
                    success: false,
                    message: 'Note content is empty or invalid'
                };
            }

            log.info(`Retrieved note content, length: ${content.length} chars`);

            // Check if content needs summarization (if it's short enough, just return it)
            if (content.length <= maxLength && !focus) {
                log.info(`Note content is already shorter than maxLength, returning as is`);
                return {
                    success: true,
                    noteId: note.noteId,
                    title: note.title,
                    summary: this.cleanHtml(content),
                    wasAlreadyShort: true
                };
            }

            // Remove HTML tags for summarization
            const cleanContent = this.cleanHtml(content);

            // Generate the summary using the AI service
            const aiService = await aiServiceManager.getService();

            log.info(`Using ${aiService.getName()} to generate summary`);

            // Create a prompt based on format and focus
            let prompt = `Summarize the following text`;

            if (focus) {
                prompt += ` with a focus on ${focus}`;
            }

            if (format === 'bullets') {
                prompt += ` in a bullet point format`;
            } else if (format === 'executive') {
                prompt += ` as a brief executive summary`;
            } else {
                prompt += ` in a concise paragraph`;
            }

            prompt += `. Keep the summary under ${maxLength} characters:\n\n${cleanContent}`;

            // Generate the summary
            const summaryStartTime = Date.now();

            const completion = await aiService.generateChatCompletion([
                { role: 'system', content: 'You are a skilled summarizer. Create concise, accurate summaries while preserving the key information.' },
                { role: 'user', content: prompt }
            ], {
                temperature: SEARCH_CONSTANTS.TEMPERATURE.QUERY_PROCESSOR, // Lower temperature for more focused summaries
                maxTokens: SEARCH_CONSTANTS.LIMITS.DEFAULT_MAX_TOKENS // Enough tokens for the summary
            });

            const summaryDuration = Date.now() - summaryStartTime;

            log.info(`Generated summary in ${summaryDuration}ms, length: ${completion.text.length} chars`);

            return {
                success: true,
                noteId: note.noteId,
                title: note.title,
                originalLength: content.length,
                summary: completion.text,
                format: format,
                focus: focus || 'general content'
            };
        } catch (error: any) {
            log.error(`Error executing summarize_note tool: ${error.message || String(error)}`);
            return `Error: ${error.message || String(error)}`;
        }
    }

    /**
     * Clean HTML content for summarization
     */
    private cleanHtml(html: string): string {
        if (typeof html !== 'string') {
            return '';
        }

        // Remove HTML tags
        let text = html.replace(/<[^>]*>/g, '');

        // Decode common HTML entities
        text = text
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&');

        // Normalize whitespace
        text = text.replace(/\s+/g, ' ').trim();

        return text;
    }
}