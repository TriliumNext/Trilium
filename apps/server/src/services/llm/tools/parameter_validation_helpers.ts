/**
 * Parameter Validation Helpers
 *
 * This file provides utilities for validating tool parameters with LLM-friendly error messages
 * and suggestions for common parameter patterns.
 */

import { ToolResponseFormatter, ToolErrorResponse } from './tool_interfaces.js';

export class ParameterValidationHelpers {
    /**
     * Validate noteId parameter with helpful error messages
     */
    static validateNoteId(noteId: string | undefined, parameterName: string = 'noteId'): ToolErrorResponse | null {
        if (!noteId) {
            return ToolResponseFormatter.invalidParameterError(
                parameterName,
                'noteId from search results',
                'missing'
            );
        }

        if (typeof noteId !== 'string') {
            return ToolResponseFormatter.invalidParameterError(
                parameterName,
                'string value like "abc123def456"',
                typeof noteId
            );
        }

        // Check basic noteId format (should be alphanumeric and at least 10 chars)
        if (noteId.length < 10 || !/^[a-zA-Z0-9_-]+$/.test(noteId)) {
            return ToolResponseFormatter.error(
                `Invalid noteId format: "${noteId}"`,
                {
                    possibleCauses: [
                        'Using note title instead of noteId',
                        'Malformed noteId string',
                        'Copy-paste error in noteId'
                    ],
                    suggestions: [
                        'Use search_notes to get the correct noteId',
                        'noteIds look like "abc123def456" (letters and numbers)',
                        'Make sure to use the noteId field from search results, not the title'
                    ],
                    examples: [
                        'search_notes("note title") to find the noteId',
                        'read_note("abc123def456") using the noteId',
                        'Valid noteId: "x5k2j8m9p4q1" (random letters and numbers)'
                    ]
                }
            );
        }

        return null; // Valid
    }

    /**
     * Validate action parameter for tools that use action-based operations
     */
    static validateAction(action: string | undefined, validActions: string[], examples: Record<string, string> = {}): ToolErrorResponse | null {
        if (!action) {
            return ToolResponseFormatter.invalidParameterError(
                'action',
                `one of: ${validActions.join(', ')}`,
                'missing'
            );
        }

        if (typeof action !== 'string') {
            return ToolResponseFormatter.invalidParameterError(
                'action',
                `string - one of: ${validActions.join(', ')}`,
                typeof action
            );
        }

        if (!validActions.includes(action)) {
            const exampleList = validActions.map(a => examples[a] || `"${a}"`);
            return ToolResponseFormatter.error(
                `Invalid action: "${action}"`,
                {
                    possibleCauses: [
                        'Typo in action name',
                        'Unsupported action for this tool',
                        'Case sensitivity issue'
                    ],
                    suggestions: [
                        `Use one of these valid actions: ${validActions.join(', ')}`,
                        'Check spelling and capitalization',
                        'Refer to tool documentation for supported actions'
                    ],
                    examples: exampleList
                }
            );
        }

        return null; // Valid
    }

    /**
     * Validate query parameter for search operations
     */
    static validateSearchQuery(query: string | undefined): ToolErrorResponse | null {
        if (!query) {
            return ToolResponseFormatter.invalidParameterError(
                'query',
                'search terms or phrases',
                'missing'
            );
        }

        if (typeof query !== 'string') {
            return ToolResponseFormatter.invalidParameterError(
                'query',
                'string with search terms',
                typeof query
            );
        }

        if (query.trim().length === 0) {
            return ToolResponseFormatter.error(
                'Query cannot be empty',
                {
                    possibleCauses: [
                        'Empty query string provided',
                        'Query contains only whitespace'
                    ],
                    suggestions: [
                        'Provide meaningful search terms',
                        'Use descriptive words or phrases',
                        'Try searching for note titles or content keywords'
                    ],
                    examples: [
                        'search_notes("meeting notes")',
                        'search_notes("project planning")',
                        'search_notes("#important")'
                    ]
                }
            );
        }

        return null; // Valid
    }

    /**
     * Validate numeric parameters with range checking
     */
    static validateNumericRange(
        value: number | undefined, 
        parameterName: string, 
        min: number, 
        max: number, 
        defaultValue?: number
    ): { value: number; error: ToolErrorResponse | null } {
        
        if (value === undefined) {
            return { value: defaultValue || min, error: null };
        }

        if (typeof value !== 'number' || isNaN(value)) {
            return {
                value: defaultValue || min,
                error: ToolResponseFormatter.invalidParameterError(
                    parameterName,
                    `number between ${min} and ${max}`,
                    String(value)
                )
            };
        }

        if (value < min || value > max) {
            return {
                value: Math.max(min, Math.min(max, value)), // Clamp to valid range
                error: ToolResponseFormatter.error(
                    `${parameterName} must be between ${min} and ${max}, got ${value}`,
                    {
                        possibleCauses: [
                            'Value outside allowed range',
                            'Typo in numeric value'
                        ],
                        suggestions: [
                            `Use a value between ${min} and ${max}`,
                            `Try ${min} for minimum, ${max} for maximum`,
                            defaultValue ? `Omit parameter to use default (${defaultValue})` : ''
                        ].filter(Boolean),
                        examples: [
                            `${parameterName}: ${min} (minimum)`,
                            `${parameterName}: ${Math.floor((min + max) / 2)} (middle)`,
                            `${parameterName}: ${max} (maximum)`
                        ]
                    }
                )
            };
        }

        return { value, error: null };
    }

    /**
     * Validate content parameter for note operations
     */
    static validateContent(content: string | undefined, parameterName: string = 'content', allowEmpty: boolean = false): ToolErrorResponse | null {
        if (!content) {
            if (allowEmpty) return null;
            
            return ToolResponseFormatter.invalidParameterError(
                parameterName,
                'text content for the note',
                'missing'
            );
        }

        if (typeof content !== 'string') {
            return ToolResponseFormatter.invalidParameterError(
                parameterName,
                'string with note content',
                typeof content
            );
        }

        if (!allowEmpty && content.trim().length === 0) {
            return ToolResponseFormatter.error(
                'Content cannot be empty',
                {
                    possibleCauses: [
                        'Empty content string provided',
                        'Content contains only whitespace'
                    ],
                    suggestions: [
                        'Provide meaningful content for the note',
                        'Use plain text, markdown, or HTML',
                        'Content can be as simple as a single sentence'
                    ],
                    examples: [
                        'content: "This is my note content"',
                        'content: "# Heading\\n\\nSome text here"',
                        'content: "<p>HTML content</p>"'
                    ]
                }
            );
        }

        return null; // Valid
    }

    /**
     * Validate title parameter for note operations
     */
    static validateTitle(title: string | undefined, required: boolean = true): ToolErrorResponse | null {
        if (!title) {
            if (required) {
                return ToolResponseFormatter.invalidParameterError(
                    'title',
                    'name for the note',
                    'missing'
                );
            }
            return null;
        }

        if (typeof title !== 'string') {
            return ToolResponseFormatter.invalidParameterError(
                'title',
                'string with note title',
                typeof title
            );
        }

        if (title.trim().length === 0) {
            return ToolResponseFormatter.error(
                'Title cannot be empty',
                {
                    possibleCauses: [
                        'Empty title string provided',
                        'Title contains only whitespace'
                    ],
                    suggestions: [
                        'Provide a descriptive title',
                        'Use clear, concise names',
                        'Avoid special characters that might cause issues'
                    ],
                    examples: [
                        'title: "Meeting Notes"',
                        'title: "Project Plan - Phase 1"',
                        'title: "Daily Tasks"'
                    ]
                }
            );
        }

        return null; // Valid
    }

    /**
     * Provide helpful suggestions for common parameter mistakes
     */
    static createParameterSuggestions(toolName: string, parameterName: string): string[] {
        const suggestions: Record<string, Record<string, string[]>> = {
            'search_notes': {
                'query': [
                    'Use descriptive terms like "meeting notes" or "project planning"',
                    'Try searching for concepts rather than exact phrases',
                    'Use tags like "#important" to find tagged notes'
                ],
                'parentNoteId': [
                    'Use noteId from previous search results',
                    'Leave empty to search all notes',
                    'Make sure to use the noteId, not the note title'
                ]
            },
            'create_note': {
                'title': [
                    'Choose a clear, descriptive name',
                    'Keep titles concise but informative',
                    'Avoid special characters that might cause issues'
                ],
                'content': [
                    'Can be plain text, markdown, or HTML',
                    'Start with a simple description',
                    'Content can be updated later with note_update'
                ],
                'parentNoteId': [
                    'Use noteId from search results to place in specific folder',
                    'Leave empty to create in root folder',
                    'Search for the parent note first to get its noteId'
                ]
            },
            'read_note': {
                'noteId': [
                    'Use the noteId from search_notes results',
                    'noteIds look like "abc123def456"',
                    'Don\'t use the note title - use the actual noteId'
                ]
            },
            'manage_attributes': {
                'noteId': [
                    'Use noteId from search results',
                    'Make sure the note exists before managing attributes',
                    'Use search_notes to find the correct noteId first'
                ],
                'attributeName': [
                    'Use "#tagname" for tags (like #important)',
                    'Use plain names for properties (like priority, status)',
                    'Use "~relationname" for relations'
                ]
            }
        };

        return suggestions[toolName]?.[parameterName] || [
            'Check the parameter format and requirements',
            'Refer to tool documentation for examples',
            'Try using simpler values first'
        ];
    }

    /**
     * Create examples for common parameter usage patterns
     */
    static getParameterExamples(toolName: string, parameterName: string): string[] {
        const examples: Record<string, Record<string, string[]>> = {
            'search_notes': {
                'query': [
                    'search_notes("meeting notes")',
                    'search_notes("project planning documents")',
                    'search_notes("#important")'
                ]
            },
            'create_note': {
                'title': [
                    'title: "Weekly Meeting Notes"',
                    'title: "Project Tasks"',
                    'title: "Research Ideas"'
                ],
                'content': [
                    'content: "This is my note content"',
                    'content: "# Heading\\n\\nContent here"',
                    'content: "- Item 1\\n- Item 2"'
                ]
            },
            'manage_attributes': {
                'attributeName': [
                    'attributeName: "#important"',
                    'attributeName: "priority"',
                    'attributeName: "~related-to"'
                ]
            }
        };

        return examples[toolName]?.[parameterName] || [
            `${parameterName}: "example_value"`
        ];
    }
}