/**
 * Smart Error Recovery System
 *
 * This module provides comprehensive error handling with automatic recovery suggestions
 * and common LLM mistake patterns detection and correction.
 * 
 * Features:
 * - Pattern-based error detection and recovery
 * - Auto-fix suggestions for common mistakes
 * - LLM-friendly error messages with examples
 * - Contextual help based on tool usage patterns
 * - Progressive suggestion refinement
 */

import type { ToolErrorResponse } from './tool_interfaces.js';
import { ToolResponseFormatter } from './tool_interfaces.js';
import log from '../../log.js';

/**
 * Common LLM mistake patterns and their fixes
 */
interface MistakePattern {
    pattern: RegExp;
    errorType: string;
    description: string;
    autoFix?: (match: string) => string;
    suggestions: string[];
    examples: string[];
}

/**
 * Recovery suggestion with confidence and reasoning
 */
export interface RecoverySuggestion {
    suggestion: string;
    confidence: number;
    reasoning: string;
    autoFix?: string;
    example?: string;
}

/**
 * Smart Error Recovery class
 */
export class SmartErrorRecovery {
    private mistakePatterns: MistakePattern[] = [];
    private errorHistory: Map<string, number> = new Map();

    constructor() {
        this.initializeMistakePatterns();
    }

    /**
     * Initialize common LLM mistake patterns
     */
    private initializeMistakePatterns(): void {
        this.mistakePatterns = [
            // Note ID mistakes
            {
                pattern: /note.*not found.*"([^"]+)".*title/i,
                errorType: 'note_title_as_id',
                description: 'Using note title instead of noteId',
                autoFix: (match) => match.replace(/noteId.*?"/g, 'search_notes("'),
                suggestions: [
                    'Use search_notes to find the correct noteId first',
                    'Note IDs look like "abc123def456", not human-readable titles',
                    'Never use note titles directly as noteIds'
                ],
                examples: [
                    'search_notes("My Project Notes") // Find the note first',
                    'read_note("abc123def456") // Use the noteId from search results'
                ]
            },
            
            // Parameter type mistakes
            {
                pattern: /expected.*number.*received.*"(\d+)"/i,
                errorType: 'string_number',
                description: 'Providing number as string',
                autoFix: (match) => match.replace(/"(\d+)"/g, '$1'),
                suggestions: [
                    'Remove quotes from numeric values',
                    'Use actual numbers, not string representations',
                    'Check parameter types in tool documentation'
                ],
                examples: [
                    'maxResults: 10 // Correct - number without quotes',
                    'maxResults: "10" // Wrong - string that should be number'
                ]
            },

            // Boolean mistakes
            {
                pattern: /expected.*boolean.*received.*"(true|false)"/i,
                errorType: 'string_boolean',
                description: 'Providing boolean as string',
                autoFix: (match) => match.replace(/"(true|false)"/g, '$1'),
                suggestions: [
                    'Remove quotes from boolean values',
                    'Use true/false without quotes',
                    'Booleans should not be strings'
                ],
                examples: [
                    'summarize: true // Correct - boolean without quotes',
                    'summarize: "true" // Wrong - string that should be boolean'
                ]
            },

            // Missing required parameters
            {
                pattern: /missing.*required.*parameter.*"([^"]+)"/i,
                errorType: 'missing_parameter',
                description: 'Missing required parameter',
                suggestions: [
                    'Provide all required parameters for the tool',
                    'Check tool documentation for required fields',
                    'Use tool examples as a reference'
                ],
                examples: [
                    'Always include required parameters in your tool calls',
                    'Optional parameters can be omitted, required ones cannot'
                ]
            },

            // Invalid enum values
            {
                pattern: /invalid.*action.*"([^"]+)".*valid.*:(.*)/i,
                errorType: 'invalid_enum',
                description: 'Invalid enum or action value',
                suggestions: [
                    'Use one of the valid values listed in the error',
                    'Check spelling and capitalization',
                    'Refer to tool documentation for valid options'
                ],
                examples: [
                    'Use exact spelling for enum values',
                    'Check capitalization - enums are usually case-sensitive'
                ]
            },

            // Search query mistakes
            {
                pattern: /query.*cannot.*be.*empty/i,
                errorType: 'empty_query',
                description: 'Empty or whitespace-only search query',
                suggestions: [
                    'Provide meaningful search terms',
                    'Use descriptive keywords or phrases',
                    'Try searching for concepts rather than exact matches'
                ],
                examples: [
                    'search_notes("project planning")',
                    'search_notes("meeting notes 2024")',
                    'search_notes("#important tasks")'
                ]
            },

            // Content mistakes
            {
                pattern: /content.*cannot.*be.*empty/i,
                errorType: 'empty_content',
                description: 'Empty content provided',
                suggestions: [
                    'Provide meaningful content for the note',
                    'Content can be as simple as a single sentence',
                    'Use placeholders if you need to create structure first'
                ],
                examples: [
                    'content: "This is my note content"',
                    'content: "# TODO: Add content later"',
                    'content: "Meeting notes placeholder"'
                ]
            },

            // Array format mistakes
            {
                pattern: /expected.*array.*received.*"([^"]*,[^"]*)"/i,
                errorType: 'string_array',
                description: 'Providing array as comma-separated string',
                autoFix: (match) => {
                    const arrayContent = match.match(/"([^"]*,[^"]*)"/)?.[1];
                    if (arrayContent) {
                        const items = arrayContent.split(',').map(item => `"${item.trim()}"`);
                        return `[${items.join(', ')}]`;
                    }
                    return match;
                },
                suggestions: [
                    'Use proper array format with square brackets',
                    'Separate array items with commas inside brackets',
                    'Quote string items in the array'
                ],
                examples: [
                    'tags: ["important", "work", "project"] // Correct array format',
                    'tags: "important,work,project" // Wrong - comma-separated string'
                ]
            }
        ];
    }

    /**
     * Analyze error and provide smart recovery suggestions
     */
    analyzeError(
        error: string,
        toolName: string,
        parameters: Record<string, any>,
        context?: Record<string, any>
    ): {
        suggestions: RecoverySuggestion[];
        errorType: string;
        severity: 'low' | 'medium' | 'high';
        fixable: boolean;
    } {
        const suggestions: RecoverySuggestion[] = [];
        let errorType = 'unknown';
        let severity: 'low' | 'medium' | 'high' = 'medium';
        let fixable = false;

        // Track error frequency
        const errorKey = `${toolName}:${error.slice(0, 50)}`;
        const frequency = (this.errorHistory.get(errorKey) || 0) + 1;
        this.errorHistory.set(errorKey, frequency);

        // Analyze against known patterns
        for (const pattern of this.mistakePatterns) {
            const match = error.match(pattern.pattern);
            if (match) {
                errorType = pattern.errorType;
                fixable = !!pattern.autoFix;
                
                // Determine severity based on pattern type
                severity = this.determineSeverity(pattern.errorType);

                // Create recovery suggestion
                const suggestion: RecoverySuggestion = {
                    suggestion: pattern.description,
                    confidence: 0.9,
                    reasoning: `Detected common LLM mistake: ${pattern.description}`,
                    autoFix: pattern.autoFix ? pattern.autoFix(match[0]) : undefined,
                    example: pattern.examples[0]
                };

                suggestions.push(suggestion);

                // Add pattern-specific suggestions
                for (const patternSuggestion of pattern.suggestions) {
                    suggestions.push({
                        suggestion: patternSuggestion,
                        confidence: 0.8,
                        reasoning: `Based on ${pattern.errorType} pattern`,
                        example: pattern.examples[Math.floor(Math.random() * pattern.examples.length)]
                    });
                }

                break; // Use first matching pattern
            }
        }

        // Add context-specific suggestions
        if (suggestions.length === 0) {
            suggestions.push(...this.generateContextualSuggestions(error, toolName, parameters, context));
        }

        // Add frequency-based suggestions for repeated errors
        if (frequency > 1) {
            suggestions.unshift({
                suggestion: `This error has occurred ${frequency} times - consider reviewing the parameter format`,
                confidence: 0.7,
                reasoning: 'Repeated error pattern detected',
                example: 'Double-check parameter types and format requirements'
            });
        }

        log.info(`Error analysis for ${toolName}: type=${errorType}, severity=${severity}, fixable=${fixable}, suggestions=${suggestions.length}`);

        return { suggestions, errorType, severity, fixable };
    }

    /**
     * Generate contextual suggestions when no patterns match
     */
    private generateContextualSuggestions(
        error: string,
        toolName: string,
        parameters: Record<string, any>,
        context?: Record<string, any>
    ): RecoverySuggestion[] {
        const suggestions: RecoverySuggestion[] = [];

        // Tool-specific suggestions
        const toolSuggestions = this.getToolSpecificSuggestions(toolName, error);
        suggestions.push(...toolSuggestions);

        // Parameter analysis suggestions
        const paramSuggestions = this.analyzeParameterIssues(parameters, error);
        suggestions.push(...paramSuggestions);

        // Generic fallback suggestions
        if (suggestions.length === 0) {
            suggestions.push({
                suggestion: 'Check parameter names, types, and formats',
                confidence: 0.5,
                reasoning: 'Generic error recovery guidance',
                example: 'Verify all required parameters are provided correctly'
            });
        }

        return suggestions;
    }

    /**
     * Get tool-specific error suggestions
     */
    private getToolSpecificSuggestions(toolName: string, error: string): RecoverySuggestion[] {
        const suggestions: RecoverySuggestion[] = [];

        const toolMap: Record<string, RecoverySuggestion[]> = {
            'search_notes': [
                {
                    suggestion: 'Ensure query is not empty and contains meaningful search terms',
                    confidence: 0.8,
                    reasoning: 'Search tools require non-empty queries',
                    example: 'search_notes("project documentation")'
                }
            ],
            'read_note': [
                {
                    suggestion: 'Use noteId from search results, not note titles',
                    confidence: 0.9,
                    reasoning: 'read_note requires valid noteId format',
                    example: 'read_note("abc123def456")'
                }
            ],
            'create_note': [
                {
                    suggestion: 'Provide both title and content for note creation',
                    confidence: 0.8,
                    reasoning: 'Note creation requires title and content',
                    example: 'create_note with title: "My Note" and content: "Note text"'
                }
            ],
            'note_update': [
                {
                    suggestion: 'Ensure noteId exists and content is not empty',
                    confidence: 0.8,
                    reasoning: 'Note update requires existing note and valid content',
                    example: 'note_update("abc123def456", "Updated content")'
                }
            ],
            'manage_attributes': [
                {
                    suggestion: 'Use proper attribute name format (#tag, property, ~relation)',
                    confidence: 0.8,
                    reasoning: 'Attribute names have specific format requirements',
                    example: 'attributeName: "#important" for tags'
                }
            ]
        };

        const toolSuggestions = toolMap[toolName];
        if (toolSuggestions) {
            suggestions.push(...toolSuggestions);
        }

        return suggestions;
    }

    /**
     * Analyze parameter issues and suggest fixes
     */
    private analyzeParameterIssues(
        parameters: Record<string, any>,
        error: string
    ): RecoverySuggestion[] {
        const suggestions: RecoverySuggestion[] = [];

        // Check for common parameter type issues
        for (const [key, value] of Object.entries(parameters)) {
            if (typeof value === 'string' && /^\d+$/.test(value)) {
                suggestions.push({
                    suggestion: `Parameter "${key}" appears to be a number but is provided as string`,
                    confidence: 0.7,
                    reasoning: 'Detected potential type mismatch',
                    autoFix: `${key}: ${value}`,
                    example: `Use ${key}: ${value} instead of ${key}: "${value}"`
                });
            }

            if (typeof value === 'string' && (value === 'true' || value === 'false')) {
                suggestions.push({
                    suggestion: `Parameter "${key}" appears to be a boolean but is provided as string`,
                    confidence: 0.7,
                    reasoning: 'Detected potential type mismatch',
                    autoFix: `${key}: ${value}`,
                    example: `Use ${key}: ${value} instead of ${key}: "${value}"`
                });
            }

            if (typeof value === 'string' && value.includes(',') && !value.includes(' ')) {
                suggestions.push({
                    suggestion: `Parameter "${key}" looks like it should be an array`,
                    confidence: 0.6,
                    reasoning: 'Detected comma-separated string that might be array',
                    autoFix: `${key}: [${value.split(',').map(v => `"${v.trim()}"`).join(', ')}]`,
                    example: `Use array format: [${value.split(',').map(v => `"${v.trim()}"`).join(', ')}]`
                });
            }
        }

        return suggestions;
    }

    /**
     * Determine error severity
     */
    private determineSeverity(errorType: string): 'low' | 'medium' | 'high' {
        const severityMap: Record<string, 'low' | 'medium' | 'high'> = {
            'note_title_as_id': 'high',
            'missing_parameter': 'high',
            'string_number': 'medium',
            'string_boolean': 'medium',
            'string_array': 'medium',
            'invalid_enum': 'medium',
            'empty_query': 'low',
            'empty_content': 'low'
        };

        return severityMap[errorType] || 'medium';
    }

    /**
     * Create enhanced error response with smart recovery
     */
    createEnhancedErrorResponse(
        originalError: string,
        toolName: string,
        parameters: Record<string, any>,
        context?: Record<string, any>
    ): ToolErrorResponse {
        const analysis = this.analyzeError(originalError, toolName, parameters, context);

        // Build enhanced suggestions
        const suggestions = analysis.suggestions.map(s => {
            if (s.autoFix) {
                return `${s.suggestion} (Auto-fix: ${s.autoFix})`;
            }
            return s.suggestion;
        });

        // Build examples from suggestions
        const examples = analysis.suggestions
            .filter(s => s.example)
            .map(s => s.example!)
            .slice(0, 3);

        return ToolResponseFormatter.error(
            originalError,
            {
                possibleCauses: [
                    `Error type: ${analysis.errorType}`,
                    `Severity: ${analysis.severity}`,
                    analysis.fixable ? 'This error can be automatically fixed' : 'Manual correction required'
                ],
                suggestions,
                examples
            }
        );
    }

    /**
     * Get error statistics
     */
    getErrorStats(): {
        totalErrors: number;
        frequentErrors: Array<{ error: string; count: number }>;
        topErrorTypes: Array<{ type: string; count: number }>;
    } {
        const totalErrors = Array.from(this.errorHistory.values())
            .reduce((sum, count) => sum + count, 0);

        const frequentErrors = Array.from(this.errorHistory.entries())
            .map(([error, count]) => ({ error, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);

        // Count error types from patterns
        const errorTypeCounts = new Map<string, number>();
        this.mistakePatterns.forEach(pattern => {
            errorTypeCounts.set(pattern.errorType, 0);
        });

        // This is a simplified version - in practice you'd track by type
        const topErrorTypes = Array.from(errorTypeCounts.entries())
            .map(([type, count]) => ({ type, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);

        return {
            totalErrors,
            frequentErrors,
            topErrorTypes
        };
    }

    /**
     * Clear error history (useful for testing or maintenance)
     */
    clearHistory(): void {
        this.errorHistory.clear();
    }
}

/**
 * Global instance of smart error recovery
 */
export const smartErrorRecovery = new SmartErrorRecovery();