/**
 * Tool Initializer
 *
 * This module initializes all available tools for the LLM to use.
 * Uses consolidated (v2) tool set for optimal performance.
 */

import { initializeConsolidatedTools } from './tool_initializer_v2.js';
import log from '../../log.js';

// Error type guard
function isError(error: unknown): error is Error {
    return error instanceof Error || (typeof error === 'object' &&
           error !== null && 'message' in error);
}

/**
 * Initialize all tools for the LLM
 * Uses consolidated (v2) tools with 4 tools, ~600 tokens saved vs legacy
 */
export async function initializeTools(): Promise<void> {
    try {
        log.info('Initializing LLM tools (consolidated v2) - 4 tools, ~600 tokens saved');
        await initializeConsolidatedTools();
    } catch (error: unknown) {
        const errorMessage = isError(error) ? error.message : String(error);
        log.error(`Error initializing LLM tools: ${errorMessage}`);
        // Don't throw, just log the error to prevent breaking the pipeline
    }
}

export default {
    initializeTools
};
