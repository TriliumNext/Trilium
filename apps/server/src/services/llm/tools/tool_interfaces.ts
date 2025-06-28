/**
 * Tool Interfaces
 *
 * This file defines the interfaces for the LLM tool calling system.
 *
 * IMPORTANT NOTE ON NOTE IDs:
 * When working with notes in Trilium, it's crucial to understand that:
 * - Each note has a unique system ID (e.g., "abc123def456") which is different from its title
 * - When tools require a noteId parameter, they need this system ID, not the title
 * - Search tools return noteIds that should be used in subsequent operations on specific notes
 * - Using a note's title instead of its ID will cause operations to fail
 */

/**
 * Interface for a tool definition to be sent to the LLM
 */
export interface Tool {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: {
            type: 'object';
            properties: Record<string, ToolParameter>;
            required: string[];
        };
    };
}

/**
 * Interface for a tool parameter
 */
export interface ToolParameter {
    type: string;
    description: string;
    enum?: string[];
    default?: any;
    minimum?: number;
    maximum?: number;
    minItems?: number;
    maxItems?: number;
    properties?: Record<string, ToolParameter>;
    items?: ToolParameter | {
        type: string;
        properties?: Record<string, ToolParameter>;
        required?: string[];
    };
}

/**
 * Interface for a tool call from the LLM
 */
export interface ToolCall {
    id?: string;
    type?: string;
    function: {
        name: string;
        arguments: Record<string, unknown> | string;
    };
}

/**
 * Interface for a tool handler that executes a tool
 */
export interface ToolHandler {
    /**
     * Tool definition to be sent to the LLM
     */
    definition: Tool;

    /**
     * Execute the tool with the given arguments
     */
    execute(args: Record<string, unknown>): Promise<string | object>;
}
