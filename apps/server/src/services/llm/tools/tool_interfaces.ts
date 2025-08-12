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
 * Standardized success response structure for all tools
 */
export interface ToolSuccessResponse<T = any> {
    success: true;
    result: T;
    nextSteps: {
        suggested: string;
        alternatives?: string[];
        examples?: string[];
    };
    metadata: {
        executionTime: number;
        resourcesUsed: string[];
        [key: string]: any;
    };
}

/**
 * Standardized error response structure for all tools
 */
export interface ToolErrorResponse {
    success: false;
    error: string;
    help: {
        possibleCauses: string[];
        suggestions: string[];
        examples?: string[];
    };
}

/**
 * Union type for all tool responses
 */
export type StandardizedToolResponse<T = any> = ToolSuccessResponse<T> | ToolErrorResponse;

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
     * @deprecated Use executeStandardized for new implementations
     */
    execute(args: Record<string, unknown>): Promise<string | object>;

    /**
     * Execute the tool with standardized response format
     * Tools should implement this method for consistent responses
     */
    executeStandardized?(args: Record<string, unknown>): Promise<StandardizedToolResponse>;
}

/**
 * Response formatting utilities for consistent tool responses
 */
export class ToolResponseFormatter {
    /**
     * Create a success response with consistent structure
     */
    static success<T>(
        result: T,
        nextSteps: {
            suggested: string;
            alternatives?: string[];
            examples?: string[];
        },
        metadata: {
            executionTime: number;
            resourcesUsed: string[];
            [key: string]: any;
        }
    ): ToolSuccessResponse<T> {
        return {
            success: true,
            result,
            nextSteps,
            metadata
        };
    }

    /**
     * Create an error response with consistent structure and helpful guidance
     */
    static error(
        error: string,
        help: {
            possibleCauses: string[];
            suggestions: string[];
            examples?: string[];
        }
    ): ToolErrorResponse {
        return {
            success: false,
            error,
            help
        };
    }

    /**
     * Create error response for note not found scenarios
     */
    static noteNotFoundError(noteId: string): ToolErrorResponse {
        return this.error(
            `Note not found: "${noteId}"`,
            {
                possibleCauses: [
                    'Invalid noteId format (should be like "abc123def456")',
                    'Note may have been deleted or moved',
                    'Using note title instead of noteId'
                ],
                suggestions: [
                    'Use search_notes to find the note by content or title',
                    'Use keyword_search_notes to find notes with specific text',
                    'Ensure you are using noteId from search results, not the note title'
                ],
                examples: [
                    'search_notes("project planning") to find by title',
                    'keyword_search_notes("specific content") to find by content'
                ]
            }
        );
    }

    /**
     * Create error response for invalid parameters
     */
    static invalidParameterError(parameter: string, expectedFormat: string, providedValue?: string): ToolErrorResponse {
        return this.error(
            `Invalid parameter "${parameter}": expected ${expectedFormat}${providedValue ? `, received "${providedValue}"` : ''}`,
            {
                possibleCauses: [
                    `Parameter "${parameter}" is missing or malformed`,
                    'Incorrect parameter type provided',
                    'Parameter validation failed'
                ],
                suggestions: [
                    `Provide ${parameter} in the format: ${expectedFormat}`,
                    'Check parameter requirements in tool documentation',
                    'Verify parameter values match expected constraints'
                ],
                examples: [
                    `${parameter}: "${expectedFormat}"`
                ]
            }
        );
    }

    /**
     * Wrap legacy tool responses to maintain backward compatibility
     */
    static wrapLegacyResponse(
        legacyResponse: string | object,
        executionTime: number,
        resourcesUsed: string[]
    ): StandardizedToolResponse {
        // If it's already a standardized response, return as-is
        if (typeof legacyResponse === 'object' && 'success' in legacyResponse) {
            return legacyResponse as StandardizedToolResponse;
        }

        // Handle string error responses
        if (typeof legacyResponse === 'string' && legacyResponse.toLowerCase().startsWith('error')) {
            return this.error(
                legacyResponse.replace(/^error:\s*/i, ''),
                {
                    possibleCauses: ['Tool execution failed'],
                    suggestions: ['Check input parameters and try again']
                }
            );
        }

        // Handle successful responses
        return this.success(
            legacyResponse,
            {
                suggested: 'Tool completed successfully. Check result for next actions.'
            },
            {
                executionTime,
                resourcesUsed,
                legacy: true
            }
        );
    }
}
