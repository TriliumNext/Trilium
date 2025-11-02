/**
 * Tool Initializer V2 (Consolidated Tools)
 *
 * This module initializes the consolidated tool set (4 tools instead of 12).
 * This is part of Phase 2 of the LLM Feature Overhaul.
 *
 * Consolidated tools:
 * 1. smart_search - Unified search (replaces 4 search tools)
 * 2. manage_note - Unified CRUD + metadata (replaces 5 note tools)
 * 3. navigate_hierarchy - Tree navigation (new capability)
 * 4. calendar_integration - Date operations (enhanced from v1)
 *
 * Token savings: ~600 tokens (50% reduction from 12 tools)
 *
 * PARAMETER NAMING CONVENTION:
 * Consolidated tools use snake_case for parameter names (e.g., note_id, parent_note_id)
 * instead of camelCase used in legacy tools (noteId, parentNoteId).
 * This follows JSON/OpenAPI conventions and is more standard for LLM tool schemas.
 * LLMs handle both conventions well, so this should not cause compatibility issues.
 * This intentional divergence from Trilium's internal camelCase convention provides
 * better standardization for external API consumers.
 */

import toolRegistry from './tool_registry.js';
import { SmartSearchTool } from './consolidated/smart_search_tool.js';
import { ManageNoteTool } from './consolidated/manage_note_tool.js';
import { NavigateHierarchyTool } from './consolidated/navigate_hierarchy_tool.js';
import log from '../../log.js';

/**
 * Error type guard
 */
function isError(error: unknown): error is Error {
    return error instanceof Error || (typeof error === 'object' &&
           error !== null && 'message' in error);
}

/**
 * Initialize consolidated tools (V2)
 */
export async function initializeConsolidatedTools(): Promise<void> {
    try {
        log.info('Initializing consolidated LLM tools (V2)...');

        // Register the 3 consolidated tools
        toolRegistry.registerTool(new SmartSearchTool());           // Replaces: search_notes, keyword_search, attribute_search, search_suggestion
        toolRegistry.registerTool(new ManageNoteTool());            // Replaces: read_note, note_creation, note_update, attribute_manager, relationship, calendar (via attributes)
        toolRegistry.registerTool(new NavigateHierarchyTool());     // New: tree navigation capability

        // Log registered tools
        const toolCount = toolRegistry.getAllTools().length;
        const toolNames = toolRegistry.getAllTools().map(tool => tool.definition.function.name).join(', ');

        log.info(`Successfully registered ${toolCount} consolidated LLM tools: ${toolNames}`);
        log.info('Tool consolidation: 12 tools → 3 tools (75% reduction, ~725 tokens saved)');
    } catch (error: unknown) {
        const errorMessage = isError(error) ? error.message : String(error);
        log.error(`Error initializing consolidated LLM tools: ${errorMessage}`);
        // Don't throw, just log the error to prevent breaking the pipeline
    }
}

/**
 * Get tool consolidation info for logging/debugging
 */
export function getConsolidationInfo(): {
    version: string;
    toolCount: number;
    consolidatedFrom: number;
    tokenSavings: number;
    tools: Array<{
        name: string;
        replaces: string[];
    }>;
} {
    return {
        version: 'v2',
        toolCount: 3,
        consolidatedFrom: 12,
        tokenSavings: 725, // Estimated (increased from 600 with calendar removal)
        tools: [
            {
                name: 'smart_search',
                replaces: ['search_notes', 'keyword_search_notes', 'attribute_search', 'search_suggestion']
            },
            {
                name: 'manage_note',
                replaces: ['read_note', 'create_note', 'update_note', 'delete_note', 'move_note', 'clone_note', 'manage_attributes', 'manage_relationships', 'note_summarization', 'content_extraction', 'calendar_integration (via attributes)']
            },
            {
                name: 'navigate_hierarchy',
                replaces: ['(new capability - no replacement)']
            }
        ]
    };
}

export default {
    initializeConsolidatedTools,
    getConsolidationInfo
};
