/**
 * Tool Initializer
 *
 * This module initializes all available tools for the LLM to use.
 */

import toolRegistry from './tool_registry.js';
import { SearchNotesTool } from './search_notes_tool.js';
import { KeywordSearchTool } from './keyword_search_tool.js';
import { AttributeSearchTool } from './attribute_search_tool.js';
import { SearchSuggestionTool } from './search_suggestion_tool.js';
import { ReadNoteTool } from './read_note_tool.js';
import { ListNotesTool } from './list_notes_tool.js';
import { NoteCreationTool } from './note_creation_tool.js';
import { NoteUpdateTool } from './note_update_tool.js';
import { MoveNoteTool } from './move_note_tool.js';
import { ContentExtractionTool } from './content_extraction_tool.js';
import { RelationshipTool } from './relationship_tool.js';
import { AttributeManagerTool } from './attribute_manager_tool.js';
import { CalendarIntegrationTool } from './calendar_integration_tool.js';
import { NoteSummarizationTool } from './note_summarization_tool.js';
import log from '../../log.js';

// Error type guard
function isError(error: unknown): error is Error {
    return error instanceof Error || (typeof error === 'object' &&
           error !== null && 'message' in error);
}

/**
 * Initialize all tools for the LLM
 */
export async function initializeTools(): Promise<void> {
    try {
        log.info('Initializing LLM tools...');

        // Register search and discovery tools
        toolRegistry.registerTool(new SearchNotesTool());        // Semantic search
        toolRegistry.registerTool(new KeywordSearchTool());      // Keyword-based search
        toolRegistry.registerTool(new AttributeSearchTool());    // Attribute-specific search
        toolRegistry.registerTool(new SearchSuggestionTool());   // Search syntax helper
        toolRegistry.registerTool(new ReadNoteTool());           // Read note content
        toolRegistry.registerTool(new ListNotesTool());          // List child notes

        // Register note creation and manipulation tools
        toolRegistry.registerTool(new NoteCreationTool());       // Create new notes
        toolRegistry.registerTool(new NoteUpdateTool());         // Update existing notes
        toolRegistry.registerTool(new MoveNoteTool());           // Move notes in the tree
        toolRegistry.registerTool(new NoteSummarizationTool());  // Summarize note content

        // Register attribute and relationship tools
        toolRegistry.registerTool(new AttributeManagerTool());   // Manage note attributes
        toolRegistry.registerTool(new RelationshipTool());       // Manage note relationships

        // Register content analysis tools
        toolRegistry.registerTool(new ContentExtractionTool());  // Extract info from note content
        toolRegistry.registerTool(new CalendarIntegrationTool()); // Calendar-related operations

        // Log registered tools
        const toolCount = toolRegistry.getAllTools().length;
        const toolNames = toolRegistry.getAllTools().map(tool => tool.definition.function.name).join(', ');
        log.info(`Successfully registered ${toolCount} LLM tools: ${toolNames}`);
    } catch (error: unknown) {
        const errorMessage = isError(error) ? error.message : String(error);
        log.error(`Error initializing LLM tools: ${errorMessage}`);
        // Don't throw, just log the error to prevent breaking the pipeline
    }
}

export default {
    initializeTools
};
