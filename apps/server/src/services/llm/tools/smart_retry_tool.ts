/**
 * Smart Retry Tool
 *
 * Automatically retries failed searches with variations, similar to how Claude Code
 * handles failures by trying different approaches.
 */

import type { Tool, ToolHandler } from './tool_interfaces.js';
import log from '../../log.js';
import toolRegistry from './tool_registry.js';

/**
 * Definition of the smart retry tool
 */
export const smartRetryToolDefinition: Tool = {
    type: 'function',
    function: {
        name: 'retry_search',
        description: 'Automatically retry failed searches with variations. Example: retry_search("machine learning algorithms") → tries "ML", "algorithms", "machine learning", etc.',
        parameters: {
            type: 'object',
            properties: {
                originalQuery: {
                    type: 'string',
                    description: 'The original search query that failed or returned no results'
                },
                searchType: {
                    type: 'string',
                    description: 'Type of search to retry',
                    enum: ['auto', 'semantic', 'keyword', 'attribute'],
                    default: 'auto'
                },
                maxAttempts: {
                    type: 'number',
                    description: 'Maximum number of retry attempts (default: 5)',
                    minimum: 1,
                    maximum: 10,
                    default: 5
                },
                strategy: {
                    type: 'string',
                    description: 'Retry strategy to use',
                    enum: ['broader', 'narrower', 'synonyms', 'related', 'all'],
                    default: 'all'
                }
            },
            required: ['originalQuery']
        }
    }
};

/**
 * Smart retry tool implementation
 */
export class SmartRetryTool implements ToolHandler {
    public definition: Tool = smartRetryToolDefinition;

    /**
     * Generate broader search terms
     */
    private generateBroaderTerms(query: string): string[] {
        const terms = query.toLowerCase().split(/\s+/);
        const broader: string[] = [];

        // Single words from multi-word queries
        if (terms.length > 1) {
            broader.push(...terms.filter(term => term.length > 3));
        }

        // Category-based broader terms
        const broaderMap: Record<string, string[]> = {
            'machine learning': ['AI', 'artificial intelligence', 'ML', 'algorithms'],
            'deep learning': ['neural networks', 'machine learning', 'AI'],
            'project management': ['management', 'projects', 'planning'],
            'task management': ['tasks', 'todos', 'productivity'],
            'meeting notes': ['meetings', 'notes', 'discussions'],
            'financial report': ['finance', 'reports', 'financial'],
            'software development': ['development', 'programming', 'software'],
            'data analysis': ['data', 'analytics', 'analysis']
        };

        for (const [specific, broaderTerms] of Object.entries(broaderMap)) {
            if (query.toLowerCase().includes(specific)) {
                broader.push(...broaderTerms);
            }
        }

        return [...new Set(broader)];
    }

    /**
     * Generate synonyms and related terms
     */
    private generateSynonyms(query: string): string[] {
        const synonymMap: Record<string, string[]> = {
            'meeting': ['conference', 'discussion', 'call', 'session'],
            'task': ['todo', 'action item', 'assignment', 'work'],
            'project': ['initiative', 'program', 'effort', 'work'],
            'note': ['document', 'memo', 'record', 'entry'],
            'important': ['critical', 'priority', 'urgent', 'key'],
            'development': ['coding', 'programming', 'building', 'creation'],
            'analysis': ['review', 'study', 'examination', 'research'],
            'report': ['summary', 'document', 'findings', 'results']
        };

        const synonyms: string[] = [];
        const queryLower = query.toLowerCase();

        for (const [word, syns] of Object.entries(synonymMap)) {
            if (queryLower.includes(word)) {
                synonyms.push(...syns);
                // Replace word with synonyms in original query
                syns.forEach(syn => {
                    synonyms.push(query.replace(new RegExp(word, 'gi'), syn));
                });
            }
        }

        return [...new Set(synonyms)];
    }

    /**
     * Generate narrower, more specific terms
     */
    private generateNarrowerTerms(query: string): string[] {
        const narrowerMap: Record<string, string[]> = {
            'AI': ['machine learning', 'deep learning', 'neural networks'],
            'programming': ['javascript', 'python', 'typescript', 'react'],
            'management': ['project management', 'task management', 'team management'],
            'analysis': ['data analysis', 'financial analysis', 'performance analysis'],
            'notes': ['meeting notes', 'research notes', 'project notes']
        };

        const narrower: string[] = [];
        const queryLower = query.toLowerCase();

        for (const [broad, narrowTerms] of Object.entries(narrowerMap)) {
            if (queryLower.includes(broad.toLowerCase())) {
                narrower.push(...narrowTerms);
            }
        }

        return [...new Set(narrower)];
    }

    /**
     * Generate related concept terms
     */
    private generateRelatedTerms(query: string): string[] {
        const relatedMap: Record<string, string[]> = {
            'machine learning': ['data science', 'statistics', 'algorithms', 'models'],
            'project management': ['agile', 'scrum', 'planning', 'timeline'],
            'javascript': ['react', 'node.js', 'typescript', 'frontend'],
            'data analysis': ['visualization', 'statistics', 'metrics', 'reporting'],
            'meeting': ['agenda', 'minutes', 'action items', 'participants']
        };

        const related: string[] = [];
        const queryLower = query.toLowerCase();

        for (const [concept, relatedTerms] of Object.entries(relatedMap)) {
            if (queryLower.includes(concept)) {
                related.push(...relatedTerms);
            }
        }

        return [...new Set(related)];
    }

    /**
     * Execute smart retry with various strategies
     */
    public async execute(args: {
        originalQuery: string,
        searchType?: string,
        maxAttempts?: number,
        strategy?: string
    }): Promise<string | object> {
        try {
            const { 
                originalQuery, 
                searchType = 'auto', 
                maxAttempts = 5, 
                strategy = 'all' 
            } = args;

            log.info(`Smart retry for query: "${originalQuery}" with strategy: ${strategy}`);

            // Generate alternative queries based on strategy
            let alternatives: string[] = [];

            switch (strategy) {
                case 'broader':
                    alternatives = this.generateBroaderTerms(originalQuery);
                    break;
                case 'narrower':
                    alternatives = this.generateNarrowerTerms(originalQuery);
                    break;
                case 'synonyms':
                    alternatives = this.generateSynonyms(originalQuery);
                    break;
                case 'related':
                    alternatives = this.generateRelatedTerms(originalQuery);
                    break;
                case 'all':
                default:
                    alternatives = [
                        ...this.generateBroaderTerms(originalQuery),
                        ...this.generateSynonyms(originalQuery),
                        ...this.generateRelatedTerms(originalQuery),
                        ...this.generateNarrowerTerms(originalQuery)
                    ];
                    break;
            }

            // Remove duplicates and limit attempts
            alternatives = [...new Set(alternatives)].slice(0, maxAttempts);

            if (alternatives.length === 0) {
                return {
                    success: false,
                    message: 'No alternative search terms could be generated',
                    suggestion: 'Try a completely different approach or search for broader concepts'
                };
            }

            log.info(`Generated ${alternatives.length} alternative search terms: ${alternatives.join(', ')}`);

            // Get the search tool
            const searchTool = toolRegistry.getTool('search') || toolRegistry.getTool('search_notes');
            if (!searchTool) {
                return {
                    success: false,
                    error: 'Search tool not available',
                    alternatives: alternatives
                };
            }

            // Try each alternative
            const results: Array<{
                query: string;
                success: boolean;
                count?: number;
                result?: any;
                message?: string;
                error?: string;
            }> = [];
            let successfulSearches = 0;
            let totalResults = 0;

            for (let i = 0; i < alternatives.length; i++) {
                const alternative = alternatives[i];
                
                try {
                    log.info(`Retry attempt ${i + 1}/${alternatives.length}: "${alternative}"`);
                    
                    const result = await searchTool.execute({
                        query: alternative,
                        maxResults: 5
                    });

                    // Check if this search was successful
                    let hasResults = false;
                    let resultCount = 0;

                    if (typeof result === 'object' && result !== null) {
                        if ('results' in result && Array.isArray(result.results)) {
                            resultCount = result.results.length;
                            hasResults = resultCount > 0;
                        } else if ('count' in result && typeof result.count === 'number') {
                            resultCount = result.count;
                            hasResults = resultCount > 0;
                        }
                    }

                    if (hasResults) {
                        successfulSearches++;
                        totalResults += resultCount;
                        
                        results.push({
                            query: alternative,
                            success: true,
                            count: resultCount,
                            result: result
                        });

                        log.info(`Success with "${alternative}": found ${resultCount} results`);
                    } else {
                        results.push({
                            query: alternative,
                            success: false,
                            count: 0,
                            message: 'No results found'
                        });
                    }

                } catch (error) {
                    log.error(`Error with alternative "${alternative}": ${error}`);
                    results.push({
                        query: alternative,
                        success: false,
                        error: error instanceof Error ? error.message : String(error)
                    });
                }
            }

            // Summarize results
            const summary = {
                originalQuery,
                strategy,
                attemptsMade: alternatives.length,
                successfulSearches,
                totalResultsFound: totalResults,
                alternatives: results.filter(r => r.success),
                failures: results.filter(r => !r.success),
                recommendation: this.generateRecommendation(successfulSearches, totalResults, strategy)
            };

            if (successfulSearches > 0) {
                summary['next_action'] = `Found results! Use read tool on noteIds from successful searches.`;
            }

            return summary;

        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            log.error(`Error in smart retry: ${errorMessage}`);
            return {
                success: false,
                error: errorMessage,
                suggestion: 'Try manual search with simpler terms'
            };
        }
    }

    /**
     * Generate recommendations based on retry results
     */
    private generateRecommendation(successful: number, totalResults: number, strategy: string): string {
        if (successful === 0) {
            if (strategy === 'broader') {
                return 'Try with synonyms or related terms instead';
            } else if (strategy === 'narrower') {
                return 'Try broader terms or check spelling';
            } else {
                return 'Consider searching for completely different concepts or check if notes exist on this topic';
            }
        } else if (totalResults < 3) {
            return 'Found few results. Try additional related terms or create notes on this topic';
        } else {
            return 'Good results found! Read the notes and search for more specific aspects';
        }
    }
}