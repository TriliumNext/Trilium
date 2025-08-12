/**
 * Smart Parameter Processor
 *
 * This module provides intelligent parameter handling that helps LLMs use tools more effectively
 * by automatically fixing common parameter issues, providing smart suggestions, and using fuzzy
 * matching to understand what LLMs actually meant.
 *
 * Key Features:
 * - Fuzzy note ID matching (converts titles to noteIds)
 * - Smart parameter type coercion (strings to numbers, booleans, etc.)
 * - Intent-based parameter guessing (missing parameters from context)
 * - Typo and similarity matching for enums and constants
 * - Context-aware parameter suggestions
 * - Parameter validation with auto-fix capabilities
 */

import type { ToolErrorResponse, StandardizedToolResponse } from './tool_interfaces.js';
import { ToolResponseFormatter } from './tool_interfaces.js';
import searchService from '../../search/services/search.js';
import becca from '../../../becca/becca.js';
import log from '../../log.js';

/**
 * Result of smart parameter processing
 */
export interface SmartProcessingResult {
    success: boolean;
    processedParams: Record<string, any>;
    corrections: ParameterCorrection[];
    suggestions: string[];
    error?: ToolErrorResponse;
}

/**
 * Information about a parameter correction made
 */
export interface ParameterCorrection {
    parameter: string;
    originalValue: any;
    correctedValue: any;
    correctionType: 'type_coercion' | 'fuzzy_match' | 'note_resolution' | 'auto_fix' | 'context_guess';
    confidence: number;
    reasoning: string;
}

/**
 * Context information for parameter processing
 */
export interface ProcessingContext {
    toolName: string;
    recentNoteIds?: string[];
    currentNoteId?: string;
    userPreferences?: Record<string, any>;
}

/**
 * Smart Parameter Processor class
 */
export class SmartParameterProcessor {
    private noteResolutionCache = new Map<string, string | null>();
    private fuzzyMatchCache = new Map<string, string | null>();
    private cacheExpiry = 5 * 60 * 1000; // 5 minutes

    /**
     * Process parameters with smart corrections and suggestions
     */
    async processParameters(
        params: Record<string, any>,
        toolDefinition: any,
        context: ProcessingContext
    ): Promise<SmartProcessingResult> {
        const startTime = Date.now();
        const corrections: ParameterCorrection[] = [];
        const suggestions: string[] = [];
        const processedParams = { ...params };

        try {
            log.info(`Smart processing parameters for tool: ${context.toolName}`);

            // Get parameter schema from tool definition
            const parameterSchema = toolDefinition.function?.parameters?.properties || {};
            const requiredParams = toolDefinition.function?.parameters?.required || [];

            // Process each parameter
            for (const [paramName, paramValue] of Object.entries(params)) {
                const paramSchema = parameterSchema[paramName];
                if (!paramSchema) {
                    // Unknown parameter - suggest similar ones
                    const suggestion = this.findSimilarParameterName(paramName, Object.keys(parameterSchema));
                    if (suggestion) {
                        suggestions.push(`Did you mean "${suggestion}" instead of "${paramName}"?`);
                    }
                    continue;
                }

                const processingResult = await this.processIndividualParameter(
                    paramName,
                    paramValue,
                    paramSchema,
                    context
                );

                if (processingResult.corrected) {
                    processedParams[paramName] = processingResult.value;
                    corrections.push({
                        parameter: paramName,
                        originalValue: paramValue,
                        correctedValue: processingResult.value,
                        correctionType: processingResult.correctionType!,
                        confidence: processingResult.confidence,
                        reasoning: processingResult.reasoning!
                    });
                }

                if (processingResult.suggestions) {
                    suggestions.push(...processingResult.suggestions);
                }
            }

            // Check for missing required parameters and try to guess them
            for (const requiredParam of requiredParams) {
                if (!(requiredParam in processedParams)) {
                    const guessedValue = await this.guessParameterFromContext(
                        requiredParam,
                        parameterSchema[requiredParam],
                        context
                    );

                    if (guessedValue.value !== undefined) {
                        processedParams[requiredParam] = guessedValue.value;
                        corrections.push({
                            parameter: requiredParam,
                            originalValue: undefined,
                            correctedValue: guessedValue.value,
                            correctionType: 'context_guess',
                            confidence: guessedValue.confidence,
                            reasoning: guessedValue.reasoning
                        });
                    } else {
                        suggestions.push(`Missing required parameter "${requiredParam}": ${guessedValue.suggestion}`);
                    }
                }
            }

            const processingTime = Date.now() - startTime;
            log.info(`Smart parameter processing completed in ${processingTime}ms with ${corrections.length} corrections`);

            return {
                success: true,
                processedParams,
                corrections,
                suggestions
            };

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            log.error(`Smart parameter processing failed: ${errorMessage}`);

            return {
                success: false,
                processedParams: params,
                corrections,
                suggestions,
                error: ToolResponseFormatter.error(
                    `Parameter processing failed: ${errorMessage}`,
                    {
                        possibleCauses: [
                            'Invalid parameter structure',
                            'Processing system error',
                            'Tool definition malformed'
                        ],
                        suggestions: [
                            'Try using simpler parameter values',
                            'Check parameter names and types',
                            'Contact system administrator if error persists'
                        ]
                    }
                )
            };
        }
    }

    /**
     * Process an individual parameter with smart corrections
     */
    private async processIndividualParameter(
        paramName: string,
        paramValue: any,
        paramSchema: any,
        context: ProcessingContext
    ): Promise<{
        value: any;
        corrected: boolean;
        correctionType?: 'type_coercion' | 'fuzzy_match' | 'note_resolution' | 'auto_fix';
        confidence: number;
        reasoning?: string;
        suggestions?: string[];
    }> {
        const suggestions: string[] = [];

        // Handle noteId parameters with special processing
        if (paramName.toLowerCase().includes('noteid') || paramName === 'noteId' || paramName === 'parentNoteId') {
            const noteResult = await this.resolveNoteReference(paramValue, paramName);
            if (noteResult.corrected) {
                return {
                    value: noteResult.value,
                    corrected: true,
                    correctionType: 'note_resolution',
                    confidence: noteResult.confidence,
                    reasoning: noteResult.reasoning,
                    suggestions: noteResult.suggestions
                };
            }
        }

        // Type coercion based on schema
        const coercionResult = this.coerceParameterType(paramValue, paramSchema);
        if (coercionResult.corrected) {
            return {
                value: coercionResult.value,
                corrected: true,
                correctionType: 'type_coercion',
                confidence: coercionResult.confidence,
                reasoning: coercionResult.reasoning
            };
        }

        // Fuzzy matching for enum values
        if (paramSchema.enum && typeof paramValue === 'string') {
            const fuzzyResult = this.fuzzyMatchEnum(paramValue, paramSchema.enum);
            if (fuzzyResult.match) {
                return {
                    value: fuzzyResult.match,
                    corrected: true,
                    correctionType: 'fuzzy_match',
                    confidence: fuzzyResult.confidence,
                    reasoning: `Matched "${paramValue}" to "${fuzzyResult.match}" from valid options`
                };
            }
        }

        // No corrections needed
        return {
            value: paramValue,
            corrected: false,
            confidence: 1.0,
            suggestions
        };
    }

    /**
     * Resolve note references (convert titles to noteIds)
     */
    async resolveNoteReference(reference: string | undefined, parameterName: string): Promise<{
        value: string | null;
        corrected: boolean;
        confidence: number;
        reasoning: string;
        suggestions?: string[];
    }> {
        if (!reference || typeof reference !== 'string') {
            return {
                value: null,
                corrected: false,
                confidence: 0,
                reasoning: 'No reference provided'
            };
        }

        // If it already looks like a noteId, validate and return
        if (this.looksLikeNoteId(reference)) {
            const note = becca.getNote(reference);
            if (note) {
                return {
                    value: reference,
                    corrected: false,
                    confidence: 1.0,
                    reasoning: 'Valid noteId provided'
                };
            } else {
                // Invalid noteId - try to find by title search
                const searchResult = await this.searchNoteByTitle(reference);
                if (searchResult) {
                    return {
                        value: searchResult.noteId,
                        corrected: true,
                        confidence: 0.8,
                        reasoning: `Converted invalid noteId "${reference}" to valid noteId "${searchResult.noteId}" by searching for title`
                    };
                }
            }
        }

        // Try to find note by title
        const cacheKey = `title:${reference.toLowerCase()}`;
        if (this.noteResolutionCache.has(cacheKey)) {
            const cached = this.noteResolutionCache.get(cacheKey);
            if (cached) {
                return {
                    value: cached,
                    corrected: true,
                    confidence: 0.9,
                    reasoning: `Resolved note title "${reference}" to noteId "${cached}"`
                };
            }
        }

        const searchResult = await this.searchNoteByTitle(reference);
        if (searchResult) {
            this.noteResolutionCache.set(cacheKey, searchResult.noteId);
            // Clean cache after expiry
            setTimeout(() => this.noteResolutionCache.delete(cacheKey), this.cacheExpiry);

            return {
                value: searchResult.noteId,
                corrected: true,
                confidence: searchResult.confidence,
                reasoning: `Resolved note title "${reference}" to noteId "${searchResult.noteId}"`
            };
        }

        return {
            value: null,
            corrected: false,
            confidence: 0,
            reasoning: `Could not resolve "${reference}" to a valid noteId`,
            suggestions: [
                'Use search_notes to find the correct noteId',
                'Make sure the note exists and the title is correct',
                'Use exact note titles for better matching'
            ]
        };
    }

    /**
     * Search for a note by title with fuzzy matching
     */
    private async searchNoteByTitle(title: string): Promise<{
        noteId: string;
        confidence: number;
    } | null> {
        try {
            // Try exact title match first
            const searchResults = searchService.searchNotes(`note.title = "${title}"`, {
                includeArchivedNotes: false,
                fuzzyAttributeSearch: false
            });

            if (searchResults.length > 0) {
                return {
                    noteId: searchResults[0].noteId,
                    confidence: 1.0
                };
            }

            // Try fuzzy title search
            const fuzzyResults = searchService.searchNotes(title, {
                includeArchivedNotes: false,
                fuzzyAttributeSearch: true
            });

            if (fuzzyResults.length > 0) {
                // Find the best title match
                let bestMatch = fuzzyResults[0];
                let bestSimilarity = this.calculateStringSimilarity(title.toLowerCase(), bestMatch.title.toLowerCase());

                for (const result of fuzzyResults) {
                    const similarity = this.calculateStringSimilarity(title.toLowerCase(), result.title.toLowerCase());
                    if (similarity > bestSimilarity) {
                        bestMatch = result;
                        bestSimilarity = similarity;
                    }
                }

                // Only accept matches with decent similarity
                if (bestSimilarity >= 0.6) {
                    return {
                        noteId: bestMatch.noteId,
                        confidence: Math.max(0.5, bestSimilarity)
                    };
                }
            }

            return null;
        } catch (error) {
            log.error(`Error searching for note by title "${title}": ${error}`);
            return null;
        }
    }

    /**
     * Check if a string looks like a noteId
     */
    private looksLikeNoteId(value: string): boolean {
        return /^[a-zA-Z0-9_-]{10,}$/.test(value) && !/\s/.test(value);
    }

    /**
     * Intelligent parameter type coercion
     */
    coerceParameterType(value: any, paramSchema: any): {
        value: any;
        corrected: boolean;
        confidence: number;
        reasoning: string;
    } {
        const expectedType = paramSchema.type;

        // No coercion needed if types match
        if (typeof value === expectedType) {
            return {
                value,
                corrected: false,
                confidence: 1.0,
                reasoning: 'Type already correct'
            };
        }

        switch (expectedType) {
            case 'number':
                return this.coerceToNumber(value);
            
            case 'boolean':
                return this.coerceToBoolean(value);
            
            case 'string':
                return this.coerceToString(value);
            
            case 'array':
                return this.coerceToArray(value);
            
            case 'object':
                return this.coerceToObject(value);
            
            default:
                return {
                    value,
                    corrected: false,
                    confidence: 0.5,
                    reasoning: `Unknown expected type: ${expectedType}`
                };
        }
    }

    /**
     * Coerce value to number
     */
    private coerceToNumber(value: any): {
        value: any;
        corrected: boolean;
        confidence: number;
        reasoning: string;
    } {
        if (typeof value === 'number' && !isNaN(value)) {
            return { value, corrected: false, confidence: 1.0, reasoning: 'Already a number' };
        }

        if (typeof value === 'string') {
            const trimmed = value.trim();
            
            // Try parsing as integer
            const intValue = parseInt(trimmed, 10);
            if (!isNaN(intValue) && String(intValue) === trimmed) {
                return {
                    value: intValue,
                    corrected: true,
                    confidence: 0.9,
                    reasoning: `Converted string "${value}" to integer ${intValue}`
                };
            }

            // Try parsing as float
            const floatValue = parseFloat(trimmed);
            if (!isNaN(floatValue)) {
                return {
                    value: floatValue,
                    corrected: true,
                    confidence: 0.9,
                    reasoning: `Converted string "${value}" to number ${floatValue}`
                };
            }
        }

        if (typeof value === 'boolean') {
            return {
                value: value ? 1 : 0,
                corrected: true,
                confidence: 0.7,
                reasoning: `Converted boolean ${value} to number ${value ? 1 : 0}`
            };
        }

        return {
            value,
            corrected: false,
            confidence: 0,
            reasoning: `Cannot convert ${typeof value} to number`
        };
    }

    /**
     * Coerce value to boolean
     */
    private coerceToBoolean(value: any): {
        value: any;
        corrected: boolean;
        confidence: number;
        reasoning: string;
    } {
        if (typeof value === 'boolean') {
            return { value, corrected: false, confidence: 1.0, reasoning: 'Already a boolean' };
        }

        if (typeof value === 'string') {
            const lower = value.toLowerCase().trim();
            
            if (['true', 'yes', '1', 'on', 'enabled'].includes(lower)) {
                return {
                    value: true,
                    corrected: true,
                    confidence: 0.9,
                    reasoning: `Converted string "${value}" to boolean true`
                };
            }

            if (['false', 'no', '0', 'off', 'disabled'].includes(lower)) {
                return {
                    value: false,
                    corrected: true,
                    confidence: 0.9,
                    reasoning: `Converted string "${value}" to boolean false`
                };
            }
        }

        if (typeof value === 'number') {
            const boolValue = value !== 0;
            return {
                value: boolValue,
                corrected: true,
                confidence: 0.8,
                reasoning: `Converted number ${value} to boolean ${boolValue}`
            };
        }

        return {
            value,
            corrected: false,
            confidence: 0,
            reasoning: `Cannot convert ${typeof value} to boolean`
        };
    }

    /**
     * Coerce value to string
     */
    private coerceToString(value: any): {
        value: any;
        corrected: boolean;
        confidence: number;
        reasoning: string;
    } {
        if (typeof value === 'string') {
            return { value, corrected: false, confidence: 1.0, reasoning: 'Already a string' };
        }

        if (value === null || value === undefined) {
            return {
                value: '',
                corrected: true,
                confidence: 0.6,
                reasoning: `Converted ${value} to empty string`
            };
        }

        const stringValue = String(value);
        return {
            value: stringValue,
            corrected: true,
            confidence: 0.8,
            reasoning: `Converted ${typeof value} to string "${stringValue}"`
        };
    }

    /**
     * Coerce value to array
     */
    private coerceToArray(value: any): {
        value: any;
        corrected: boolean;
        confidence: number;
        reasoning: string;
    } {
        if (Array.isArray(value)) {
            return { value, corrected: false, confidence: 1.0, reasoning: 'Already an array' };
        }

        if (typeof value === 'string') {
            // Try parsing JSON array
            try {
                const parsed = JSON.parse(value);
                if (Array.isArray(parsed)) {
                    return {
                        value: parsed,
                        corrected: true,
                        confidence: 0.9,
                        reasoning: `Parsed JSON string to array`
                    };
                }
            } catch {
                // Try splitting by common delimiters
                if (value.includes(',')) {
                    const array = value.split(',').map(item => item.trim());
                    return {
                        value: array,
                        corrected: true,
                        confidence: 0.8,
                        reasoning: `Split comma-separated string to array`
                    };
                }

                if (value.includes(';')) {
                    const array = value.split(';').map(item => item.trim());
                    return {
                        value: array,
                        corrected: true,
                        confidence: 0.7,
                        reasoning: `Split semicolon-separated string to array`
                    };
                }

                // Single item array
                return {
                    value: [value],
                    corrected: true,
                    confidence: 0.6,
                    reasoning: `Wrapped single string in array`
                };
            }
        }

        // Wrap single values in array
        return {
            value: [value],
            corrected: true,
            confidence: 0.6,
            reasoning: `Wrapped single ${typeof value} value in array`
        };
    }

    /**
     * Coerce value to object
     */
    private coerceToObject(value: any): {
        value: any;
        corrected: boolean;
        confidence: number;
        reasoning: string;
    } {
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            return { value, corrected: false, confidence: 1.0, reasoning: 'Already an object' };
        }

        if (typeof value === 'string') {
            // Try parsing JSON object
            try {
                const parsed = JSON.parse(value);
                if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
                    return {
                        value: parsed,
                        corrected: true,
                        confidence: 0.9,
                        reasoning: `Parsed JSON string to object`
                    };
                }
            } catch {
                // Create object from string
                return {
                    value: { value: value },
                    corrected: true,
                    confidence: 0.5,
                    reasoning: `Wrapped string in object with 'value' property`
                };
            }
        }

        return {
            value,
            corrected: false,
            confidence: 0,
            reasoning: `Cannot convert ${typeof value} to object`
        };
    }

    /**
     * Fuzzy match a value against enum options
     */
    fuzzyMatchEnum(value: string, validValues: string[]): {
        match: string | null;
        confidence: number;
    } {
        const cacheKey = `enum:${value}:${validValues.join(',')}`;
        
        if (this.fuzzyMatchCache.has(cacheKey)) {
            const cached = this.fuzzyMatchCache.get(cacheKey);
            return {
                match: cached || null,
                confidence: cached ? 0.8 : 0
            };
        }

        const lowerValue = value.toLowerCase();
        let bestMatch: string | null = null;
        let bestSimilarity = 0;

        // Check exact match (case insensitive)
        for (const validValue of validValues) {
            if (validValue.toLowerCase() === lowerValue) {
                bestMatch = validValue;
                bestSimilarity = 1.0;
                break;
            }
        }

        // Check fuzzy matches if no exact match
        if (!bestMatch) {
            for (const validValue of validValues) {
                const similarity = this.calculateStringSimilarity(lowerValue, validValue.toLowerCase());
                if (similarity > bestSimilarity && similarity >= 0.6) {
                    bestMatch = validValue;
                    bestSimilarity = similarity;
                }
            }
        }

        // Cache result
        this.fuzzyMatchCache.set(cacheKey, bestMatch);
        setTimeout(() => this.fuzzyMatchCache.delete(cacheKey), this.cacheExpiry);

        return {
            match: bestMatch,
            confidence: bestSimilarity
        };
    }

    /**
     * Find similar parameter name for typo correction
     */
    private findSimilarParameterName(typo: string, validNames: string[]): string | null {
        let bestMatch: string | null = null;
        let bestSimilarity = 0;

        const lowerTypo = typo.toLowerCase();

        for (const validName of validNames) {
            const similarity = this.calculateStringSimilarity(lowerTypo, validName.toLowerCase());
            if (similarity > bestSimilarity && similarity >= 0.6) {
                bestMatch = validName;
                bestSimilarity = similarity;
            }
        }

        return bestMatch;
    }

    /**
     * Guess missing parameters from context
     */
    private async guessParameterFromContext(
        paramName: string,
        paramSchema: any,
        context: ProcessingContext
    ): Promise<{
        value: any;
        confidence: number;
        reasoning: string;
        suggestion: string;
    }> {
        // Guess noteId parameters from context
        if (paramName.toLowerCase().includes('noteid') || paramName === 'parentNoteId') {
            if (context.currentNoteId) {
                return {
                    value: context.currentNoteId,
                    confidence: 0.7,
                    reasoning: `Using current note context for ${paramName}`,
                    suggestion: `Use current note ID: ${context.currentNoteId}`
                };
            }

            if (context.recentNoteIds && context.recentNoteIds.length > 0) {
                return {
                    value: context.recentNoteIds[0],
                    confidence: 0.6,
                    reasoning: `Using most recent note for ${paramName}`,
                    suggestion: `Use recent note ID: ${context.recentNoteIds[0]}`
                };
            }
        }

        // Guess maxResults parameter
        if (paramName === 'maxResults' && paramSchema.type === 'number') {
            return {
                value: 10,
                confidence: 0.8,
                reasoning: 'Using default maxResults of 10',
                suggestion: 'Consider specifying maxResults (1-20)'
            };
        }

        // Guess boolean parameters
        if (paramSchema.type === 'boolean') {
            const defaultValue = paramSchema.default !== undefined ? paramSchema.default : false;
            return {
                value: defaultValue,
                confidence: 0.7,
                reasoning: `Using default boolean value: ${defaultValue}`,
                suggestion: `Specify ${paramName} as true or false`
            };
        }

        return {
            value: undefined,
            confidence: 0,
            reasoning: `Cannot guess value for ${paramName}`,
            suggestion: `Please provide a value for required parameter "${paramName}"`
        };
    }

    /**
     * Calculate string similarity using Levenshtein distance
     */
    private calculateStringSimilarity(str1: string, str2: string): number {
        const matrix: number[][] = [];
        const len1 = str1.length;
        const len2 = str2.length;

        // Initialize matrix
        for (let i = 0; i <= len1; i++) {
            matrix[i] = [i];
        }
        for (let j = 0; j <= len2; j++) {
            matrix[0][j] = j;
        }

        // Fill matrix
        for (let i = 1; i <= len1; i++) {
            for (let j = 1; j <= len2; j++) {
                const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
                matrix[i][j] = Math.min(
                    matrix[i - 1][j] + 1,      // deletion
                    matrix[i][j - 1] + 1,      // insertion
                    matrix[i - 1][j - 1] + cost // substitution
                );
            }
        }

        const distance = matrix[len1][len2];
        const maxLen = Math.max(len1, len2);
        
        return maxLen === 0 ? 1 : (maxLen - distance) / maxLen;
    }

    /**
     * Clear caches (useful for testing or memory management)
     */
    clearCaches(): void {
        this.noteResolutionCache.clear();
        this.fuzzyMatchCache.clear();
    }

    /**
     * Get cache statistics
     */
    getCacheStats(): {
        noteResolutionCacheSize: number;
        fuzzyMatchCacheSize: number;
    } {
        return {
            noteResolutionCacheSize: this.noteResolutionCache.size,
            fuzzyMatchCacheSize: this.fuzzyMatchCache.size
        };
    }
}

/**
 * Global instance of the smart parameter processor
 */
export const smartParameterProcessor = new SmartParameterProcessor();