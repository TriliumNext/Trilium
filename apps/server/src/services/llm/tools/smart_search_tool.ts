/**
 * Smart Search Tool - Phase 4 Core Tool Optimization 
 *
 * THE UNIVERSAL SEARCH INTERFACE - Consolidates 4 search tools into 1 intelligent system.
 * Replaces: search_notes_tool, keyword_search_tool, attribute_search_tool, unified_search_tool
 * 
 * This tool automatically chooses optimal search methods, provides intelligent fallbacks,
 * and handles all search patterns that the replaced tools supported. It's the ONLY search
 * tool needed in the core tool set, reducing token usage while improving effectiveness.
 */

import type { Tool, ToolHandler, StandardizedToolResponse } from './tool_interfaces.js';
import { ToolResponseFormatter } from './tool_interfaces.js';
import log from '../../log.js';
import { SearchNotesTool } from './search_notes_tool.js';
import { KeywordSearchTool } from './keyword_search_tool.js';
import { AttributeSearchTool } from './attribute_search_tool.js';
import { ContextExtractor } from '../context/index.js';
import becca from '../../../becca/becca.js';

/**
 * Query analysis result structure
 */
interface QueryAnalysis {
    /** Detected search type */
    primaryMethod: 'semantic' | 'keyword' | 'attribute' | 'exact_phrase' | 'temporal';
    /** Secondary methods to try for better results */
    fallbackMethods: ('semantic' | 'keyword' | 'attribute')[];
    /** Confidence level in the detected method (0-1) */
    confidence: number;
    /** Processed query optimized for the detected method */
    processedQuery: string;
    /** Original query terms extracted */
    terms: string[];
    /** Detected attributes if any */
    attributes?: { type: 'label' | 'relation', name: string, value?: string }[];
    /** Detected date/time patterns */
    temporalPatterns?: string[];
    /** Exact phrases detected in quotes */
    exactPhrases?: string[];
    /** Suggested alternative queries */
    suggestions?: string[];
}

/**
 * Search result with method information
 */
interface SmartSearchResult {
    noteId: string;
    title: string;
    preview: string;
    score: number;
    similarity?: number;
    dateCreated: string;
    dateModified: string;
    parentId?: string;
    searchMethod: string;
    relevanceFactors: string[];
}

/**
 * Definition of the smart search tool
 */
export const smartSearchToolDefinition: Tool = {
    type: 'function',
    function: {
        name: 'smart_search',
        description: '🔍 UNIVERSAL SEARCH - The only search tool you need! Automatically detects and executes optimal search strategy. Supports semantic concepts ("machine learning"), keywords (AND/OR), exact phrases ("meeting notes"), tags (#important), relations (~linkedTo), dates ("last week"), and all search patterns from replaced tools. Provides intelligent fallbacks and result merging. Use this instead of any other search tool.',
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'Your search query in natural language. Examples: "find my project notes", "#urgent tasks", "meeting notes from last week", "machine learning concepts", "exact phrase search"'
                },
                parentNoteId: {
                    type: 'string',
                    description: 'Optional: Search only within this note folder. Use noteId from previous search results to narrow scope. Leave empty to search everywhere.'
                },
                maxResults: {
                    type: 'number',
                    description: 'Maximum number of results to return. Use 5-10 for quick overview, 15-25 for thorough search. Default is 10, maximum is 50.'
                },
                forceMethod: {
                    type: 'string',
                    description: 'Optional: Override smart detection and force a specific search method. Use "auto" (default) for intelligent selection.',
                    enum: ['auto', 'semantic', 'keyword', 'attribute', 'multi_method']
                },
                includeArchived: {
                    type: 'boolean',
                    description: 'Include archived notes in search results. Default is false for faster, more relevant results.'
                },
                enableFallback: {
                    type: 'boolean',
                    description: 'Enable automatic fallback to alternative search methods when initial search yields poor results. Default is true.'
                },
                summarize: {
                    type: 'boolean',
                    description: 'Get AI-generated summaries of each result instead of content previews. Useful for quick overviews. Default is false.'
                }
            },
            required: ['query']
        }
    }
};

/**
 * Smart search tool implementation
 */
export class SmartSearchTool implements ToolHandler {
    public definition: Tool = smartSearchToolDefinition;
    private semanticSearchTool: SearchNotesTool;
    private keywordSearchTool: KeywordSearchTool;
    private attributeSearchTool: AttributeSearchTool;
    private contextExtractor: ContextExtractor;

    constructor() {
        this.semanticSearchTool = new SearchNotesTool();
        this.keywordSearchTool = new KeywordSearchTool();
        this.attributeSearchTool = new AttributeSearchTool();
        this.contextExtractor = new ContextExtractor();
    }

    /**
     * Analyze query to determine optimal search strategy
     */
    private analyzeQuery(query: string): QueryAnalysis {
        const analysis: QueryAnalysis = {
            primaryMethod: 'semantic',
            fallbackMethods: [],
            confidence: 0.5,
            processedQuery: query.trim(),
            terms: [],
            suggestions: []
        };

        const lowerQuery = query.toLowerCase().trim();

        // Extract exact phrases in quotes
        const phraseMatches = query.match(/"([^"]+)"/g);
        if (phraseMatches) {
            analysis.exactPhrases = phraseMatches.map(match => match.slice(1, -1));
            analysis.primaryMethod = 'exact_phrase';
            analysis.confidence = 0.9;
            analysis.processedQuery = query;
            analysis.fallbackMethods = ['keyword', 'semantic'];
            analysis.suggestions!.push('Remove quotes for broader semantic search');
        }

        // Detect attribute searches
        const attributePatterns = [
            { regex: /#(\w+)(?:=([^"\s]+|"[^"]*"))?/g, type: 'label' as const },
            { regex: /~(\w+)(?:=([^"\s]+|"[^"]*"))?/g, type: 'relation' as const },
            { regex: /(label|relation):(\w+)(?:=([^"\s]+|"[^"]*"))?/gi, type: 'dynamic' as const }
        ];

        const attributes: { type: 'label' | 'relation', name: string, value?: string }[] = [];
        let hasAttributes = false;

        attributePatterns.forEach(pattern => {
            let match;
            while ((match = pattern.regex.exec(query)) !== null) {
                hasAttributes = true;
                const type = pattern.type === 'dynamic' 
                    ? match[1].toLowerCase() as 'label' | 'relation'
                    : pattern.type;
                
                const name = pattern.type === 'dynamic' ? match[2] : match[1];
                const value = pattern.type === 'dynamic' 
                    ? match[3]?.replace(/"/g, '') 
                    : match[2]?.replace(/"/g, '');

                attributes.push({ type, name, value });
            }
        });

        if (hasAttributes) {
            analysis.attributes = attributes;
            analysis.primaryMethod = 'attribute';
            analysis.confidence = 0.95;
            analysis.fallbackMethods = ['semantic', 'keyword'];
            analysis.suggestions!.push('Try without attribute prefixes for content search');
        }

        // Detect temporal patterns
        const temporalPatterns = [
            /\b(?:last|past|previous)\s+(?:week|month|year|day)\b/gi,
            /\b(?:this|current)\s+(?:week|month|year|day)\b/gi,
            /\b(?:yesterday|today|tomorrow)\b/gi,
            /\b(?:recent|recently|latest)\b/gi,
            /\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/g,
            /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+\d{1,2},?\s+\d{4}\b/gi
        ];

        const temporalMatches: string[] = [];
        temporalPatterns.forEach(pattern => {
            const matches = query.match(pattern);
            if (matches) temporalMatches.push(...matches);
        });

        if (temporalMatches.length > 0) {
            analysis.temporalPatterns = temporalMatches;
            if (!hasAttributes && !phraseMatches) {
                analysis.primaryMethod = 'temporal';
                analysis.confidence = 0.8;
                analysis.fallbackMethods = ['semantic', 'keyword'];
            }
        }

        // Detect boolean operators suggesting keyword search
        const booleanOperators = /\b(AND|OR|NOT)\b/gi;
        if (booleanOperators.test(query)) {
            analysis.primaryMethod = 'keyword';
            analysis.confidence = 0.85;
            analysis.fallbackMethods = ['semantic'];
            analysis.suggestions!.push('Remove operators for natural language search');
        }

        // Detect specific search operators
        const operatorPatterns = [
            /note\.(title|content|type)/i,
            /\*=/,
            /\^=/,
            /\$=/
        ];

        if (operatorPatterns.some(pattern => pattern.test(query))) {
            analysis.primaryMethod = 'keyword';
            analysis.confidence = 0.9;
            analysis.fallbackMethods = ['semantic'];
            analysis.suggestions!.push('Use natural language for semantic search');
        }

        // Extract meaningful terms for fallback
        analysis.terms = query
            .replace(/["#~]/g, '')
            .replace(/\b(and|or|not|the|a|an|is|are|was|were|in|on|at|to|for|of|with)\b/gi, '')
            .split(/\s+/)
            .filter(term => term.length > 2)
            .slice(0, 5);

        // Default semantic search for natural language queries
        if (!hasAttributes && !phraseMatches && !booleanOperators.test(query) && 
            !operatorPatterns.some(p => p.test(query))) {
            analysis.primaryMethod = 'semantic';
            analysis.confidence = 0.7;
            analysis.fallbackMethods = ['keyword'];
            analysis.suggestions!.push(
                'Use quotes for exact phrases',
                'Add #tag or ~relation for attribute search'
            );
        }

        return analysis;
    }

    /**
     * Preprocess query to optimize it for the detected search method
     */
    private preprocessQuery(query: string, method: string): string {
        let processed = query.trim();

        switch (method) {
            case 'semantic':
                // Remove quotes and operators for better semantic understanding
                processed = processed
                    .replace(/"/g, '')
                    .replace(/\b(AND|OR|NOT)\b/gi, ' ')
                    .replace(/\s+/g, ' ')
                    .trim();
                break;

            case 'keyword':
                // Keep operators and structure for precise matching
                break;

            case 'attribute':
                // Keep attribute syntax intact
                break;

            case 'exact_phrase':
                // Ensure phrases are properly quoted
                if (!processed.includes('"')) {
                    processed = `"${processed}"`;
                }
                break;

            case 'temporal':
                // Add date-related search context
                processed = `${processed} note.dateModified note.dateCreated`;
                break;
        }

        return processed;
    }

    /**
     * Execute search using the specified method
     */
    private async executeSearchMethod(
        method: string,
        query: string,
        options: any
    ): Promise<{ results: SmartSearchResult[], method: string, success: boolean, error?: string }> {
        try {
            let results: any[] = [];
            let success = true;
            let error: string | undefined;

            switch (method) {
                case 'semantic': {
                    const response = await this.semanticSearchTool.executeStandardized({
                        query,
                        parentNoteId: options.parentNoteId,
                        maxResults: options.maxResults,
                        summarize: options.summarize
                    });

                    if (response.success) {
                        results = (response.result as any).results || [];
                    } else {
                        success = false;
                        error = response.error;
                    }
                    break;
                }

                case 'keyword': {
                    const response = await this.keywordSearchTool.execute({
                        query,
                        maxResults: options.maxResults,
                        includeArchived: options.includeArchived
                    });

                    if (typeof response === 'object' && 'results' in response) {
                        results = (response as any).results || [];
                    } else if (typeof response === 'string') {
                        success = false;
                        error = response;
                    }
                    break;
                }

                case 'attribute': {
                    const analysis = this.analyzeQuery(query);
                    if (analysis.attributes && analysis.attributes.length > 0) {
                        const attr = analysis.attributes[0];
                        const response = await this.attributeSearchTool.execute({
                            attributeType: attr.type,
                            attributeName: attr.name,
                            attributeValue: attr.value,
                            maxResults: options.maxResults
                        });

                        if (typeof response === 'object' && 'results' in response) {
                            results = (response as any).results || [];
                        } else if (typeof response === 'string') {
                            success = false;
                            error = response;
                        }
                    }
                    break;
                }
            }

            // Normalize results to SmartSearchResult format
            const smartResults: SmartSearchResult[] = results.map((result: any) => ({
                noteId: result.noteId,
                title: result.title || '[Unknown title]',
                preview: result.preview || result.contentPreview || '[No preview]',
                score: result.score || result.similarity || 1.0,
                similarity: result.similarity,
                dateCreated: result.dateCreated,
                dateModified: result.dateModified,
                parentId: result.parentId,
                searchMethod: method,
                relevanceFactors: this.calculateRelevanceFactors(result, query, method)
            }));

            return { results: smartResults, method, success, error };

        } catch (error: any) {
            return { 
                results: [], 
                method, 
                success: false, 
                error: error.message || String(error) 
            };
        }
    }

    /**
     * Calculate relevance factors for a search result
     */
    private calculateRelevanceFactors(result: any, query: string, method: string): string[] {
        const factors: string[] = [];
        
        factors.push(`Found via ${method} search`);
        
        if (result.score > 0.8) factors.push('High relevance score');
        if (result.similarity && result.similarity > 0.8) factors.push('High similarity');
        
        const queryWords = query.toLowerCase().split(/\s+/);
        const titleWords = (result.title || '').toLowerCase().split(/\s+/);
        const titleMatches = queryWords.filter(word => titleWords.some(tw => tw.includes(word)));
        
        if (titleMatches.length > 0) {
            factors.push(`Title matches: ${titleMatches.join(', ')}`);
        }

        const recentThreshold = Date.now() - (7 * 24 * 60 * 60 * 1000); // 7 days
        const modifiedDate = new Date(result.dateModified || 0).getTime();
        if (modifiedDate > recentThreshold) {
            factors.push('Recently modified');
        }

        return factors;
    }

    /**
     * Merge and deduplicate results from multiple search methods
     */
    private mergeResults(searchResults: SmartSearchResult[][]): SmartSearchResult[] {
        const seenNoteIds = new Set<string>();
        const mergedResults: SmartSearchResult[] = [];
        const noteIdToResults = new Map<string, SmartSearchResult[]>();

        // Group results by noteId
        searchResults.forEach(results => {
            results.forEach(result => {
                if (!noteIdToResults.has(result.noteId)) {
                    noteIdToResults.set(result.noteId, []);
                }
                noteIdToResults.get(result.noteId)!.push(result);
            });
        });

        // Merge duplicates and combine relevance factors
        noteIdToResults.forEach((duplicates, noteId) => {
            if (duplicates.length === 1) {
                mergedResults.push(duplicates[0]);
            } else {
                // Merge multiple results for same note
                const best = duplicates.reduce((prev, current) => 
                    current.score > prev.score ? current : prev
                );

                const allMethods = [...new Set(duplicates.map(d => d.searchMethod))];
                const allFactors = [...new Set(duplicates.flatMap(d => d.relevanceFactors))];

                mergedResults.push({
                    ...best,
                    searchMethod: allMethods.join(' + '),
                    relevanceFactors: allFactors,
                    score: Math.max(...duplicates.map(d => d.score))
                });
            }
        });

        // Sort by score descending
        return mergedResults.sort((a, b) => b.score - a.score);
    }

    /**
     * Generate fallback suggestions when search fails
     */
    private generateFallbackSuggestions(query: string, analysis: QueryAnalysis): string[] {
        const suggestions: string[] = [];

        // Broader term suggestions
        const keywords = analysis.terms.slice(0, 3);
        if (keywords.length > 1) {
            suggestions.push(`Try individual keywords: ${keywords.join(' OR ')}`);
            suggestions.push(`Try broader search: ${keywords[0]} concepts`);
        }

        // Method-specific suggestions
        if (analysis.primaryMethod === 'attribute' && analysis.attributes) {
            suggestions.push(`Search content instead: ${analysis.attributes[0].name}`);
        }

        if (analysis.exactPhrases) {
            suggestions.push(`Try without quotes: ${analysis.exactPhrases[0]}`);
        }

        // Generic suggestions
        suggestions.push('Check spelling of search terms');
        suggestions.push('Try simpler or more general terms');
        suggestions.push('Use different keywords for the same concept');

        return suggestions;
    }

    /**
     * Execute the smart search tool with standardized response format
     */
    public async executeStandardized(args: {
        query: string,
        parentNoteId?: string,
        maxResults?: number,
        forceMethod?: string,
        includeArchived?: boolean,
        enableFallback?: boolean,
        summarize?: boolean
    }): Promise<StandardizedToolResponse> {
        const startTime = Date.now();

        try {
            const {
                query,
                parentNoteId,
                maxResults = 10,
                forceMethod = 'auto',
                includeArchived = false,
                enableFallback = true,
                summarize = false
            } = args;

            log.info(`Executing smart_search tool - Query: "${query}", Method: ${forceMethod}, MaxResults: ${maxResults}`);

            // Validate input
            if (!query || query.trim().length === 0) {
                return ToolResponseFormatter.invalidParameterError(
                    'query',
                    'non-empty string',
                    query
                );
            }

            if (maxResults < 1 || maxResults > 50) {
                return ToolResponseFormatter.invalidParameterError(
                    'maxResults',
                    'number between 1 and 50',
                    String(maxResults)
                );
            }

            // Analyze query to determine search strategy
            const analysis = this.analyzeQuery(query);
            const primaryMethod = forceMethod === 'auto' ? analysis.primaryMethod : forceMethod;
            
            log.info(`Query analysis: method=${primaryMethod}, confidence=${analysis.confidence}, fallbacks=${analysis.fallbackMethods.join(', ')}`);

            const searchOptions = {
                parentNoteId,
                maxResults,
                includeArchived,
                summarize
            };

            let allResults: SmartSearchResult[] = [];
            let usedMethods: string[] = [];
            let errors: string[] = [];

            // Execute primary search method
            const primaryQuery = this.preprocessQuery(query, primaryMethod);
            const primaryResult = await this.executeSearchMethod(primaryMethod, primaryQuery, searchOptions);
            
            if (primaryResult.success) {
                allResults.push(...primaryResult.results);
                usedMethods.push(primaryMethod);
                log.info(`Primary search (${primaryMethod}) found ${primaryResult.results.length} results`);
            } else {
                errors.push(`${primaryMethod}: ${primaryResult.error}`);
                log.info(`Primary search (${primaryMethod}) failed: ${primaryResult.error}`);
            }

            // Execute fallback methods if enabled and needed
            if (enableFallback && (allResults.length < maxResults * 0.3 || !primaryResult.success)) {
                log.info(`Executing fallback searches: ${analysis.fallbackMethods.join(', ')}`);
                
                for (const fallbackMethod of analysis.fallbackMethods) {
                    if (usedMethods.includes(fallbackMethod)) continue;

                    const fallbackQuery = this.preprocessQuery(query, fallbackMethod);
                    const fallbackResult = await this.executeSearchMethod(
                        fallbackMethod, 
                        fallbackQuery, 
                        { ...searchOptions, maxResults: Math.max(5, maxResults - allResults.length) }
                    );

                    if (fallbackResult.success) {
                        allResults.push(...fallbackResult.results);
                        usedMethods.push(fallbackMethod);
                        log.info(`Fallback search (${fallbackMethod}) found ${fallbackResult.results.length} additional results`);
                    } else {
                        errors.push(`${fallbackMethod}: ${fallbackResult.error}`);
                        log.info(`Fallback search (${fallbackMethod}) failed: ${fallbackResult.error}`);
                    }

                    if (allResults.length >= maxResults) break;
                }
            }

            // Merge and deduplicate results
            const finalResults = this.mergeResults([allResults]).slice(0, maxResults);
            const executionTime = Date.now() - startTime;

            log.info(`Smart search completed in ${executionTime}ms: ${finalResults.length} unique results from ${usedMethods.join(' + ')} methods`);

            // Handle no results case
            if (finalResults.length === 0) {
                const suggestions = this.generateFallbackSuggestions(query, analysis);
                
                return ToolResponseFormatter.error(
                    `No results found for query: "${query}"`,
                    {
                        possibleCauses: [
                            `Primary method (${primaryMethod}) found no matches`,
                            'Search terms may be too specific',
                            'Content may not exist in the knowledge base',
                            ...errors.map(e => `Search error: ${e}`)
                        ],
                        suggestions: [
                            ...suggestions,
                            'Try the suggested alternative queries below'
                        ],
                        examples: [
                            ...(analysis.suggestions || []),
                            `smart_search("${analysis.terms.slice(0, 2).join(' ')}")`,
                            'smart_search("general topic") for broader results'
                        ]
                    }
                );
            }

            // Success response with comprehensive metadata
            const nextSteps = {
                suggested: `Use read_note with noteId to get full content: read_note("${finalResults[0].noteId}")`,
                alternatives: [
                    'Use note_update to modify any of these notes',
                    'Use attribute_manager to add tags or relations to results',
                    'Refine search with different keywords or methods'
                ],
                examples: [
                    `read_note("${finalResults[0].noteId}")`,
                    `smart_search("${query} related concepts")`,
                    `smart_search("${analysis.terms.join(' ')}", {"forceMethod": "keyword"})`
                ]
            };

            return ToolResponseFormatter.success(
                {
                    count: finalResults.length,
                    results: finalResults,
                    query: query,
                    analysis: {
                        detectedMethod: analysis.primaryMethod,
                        confidence: analysis.confidence,
                        usedMethods: usedMethods,
                        attributes: analysis.attributes,
                        temporalPatterns: analysis.temporalPatterns,
                        exactPhrases: analysis.exactPhrases
                    }
                },
                nextSteps,
                {
                    executionTime,
                    resourcesUsed: ['search', 'content', 'analysis'],
                    searchMethods: usedMethods,
                    primaryMethod: primaryMethod,
                    fallbackEnabled: enableFallback,
                    maxResultsRequested: maxResults,
                    queryAnalysisConfidence: analysis.confidence,
                    errors: errors.length > 0 ? errors : undefined
                }
            );

        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            log.error(`Error executing smart_search tool: ${errorMessage}`);

            return ToolResponseFormatter.error(
                `Smart search execution failed: ${errorMessage}`,
                {
                    possibleCauses: [
                        'Search service connectivity issue',
                        'Query analysis failed',
                        'Multiple search methods failed',
                        'Invalid search parameters'
                    ],
                    suggestions: [
                        'Try a simpler search query',
                        'Check if Trilium service is running properly',
                        'Use forceMethod="semantic" to bypass query analysis',
                        'Verify search parameters are valid'
                    ],
                    examples: [
                        'smart_search("simple keywords")',
                        'smart_search("test", {"forceMethod": "keyword"})'
                    ]
                }
            );
        }
    }

    /**
     * Execute the smart search tool (legacy method for backward compatibility)
     */
    public async execute(args: {
        query: string,
        parentNoteId?: string,
        maxResults?: number,
        forceMethod?: string,
        includeArchived?: boolean,
        enableFallback?: boolean,
        summarize?: boolean
    }): Promise<string | object> {
        const standardizedResponse = await this.executeStandardized(args);

        // For backward compatibility, return the legacy format
        if (standardizedResponse.success) {
            const result = standardizedResponse.result as any;
            return {
                count: result.count,
                results: result.results,
                query: result.query,
                analysis: result.analysis,
                message: `Smart search found ${result.count} results using ${result.analysis.usedMethods.join(' + ')} method(s). Use read_note with noteId for full content.`
            };
        } else {
            return `Error: ${standardizedResponse.error}`;
        }
    }
}