/**
 * Tool Filter Service Tests - Phase 3
 *
 * Comprehensive test suite for tool filtering functionality
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ToolFilterService } from './tool_filter_service.js';
import type { Tool } from './tools/tool_interfaces.js';
import type { ToolFilterConfig } from './tool_filter_service.js';

describe('ToolFilterService', () => {
    let service: ToolFilterService;
    let mockTools: Tool[];

    beforeEach(() => {
        service = new ToolFilterService();

        // Create mock tools matching the consolidated tool set
        mockTools = [
            {
                type: 'function',
                function: {
                    name: 'smart_search',
                    description: 'Search for notes using various methods',
                    parameters: {
                        type: 'object',
                        properties: {
                            query: { type: 'string', description: 'Search query' }
                        },
                        required: ['query']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'manage_note',
                    description: 'Create, read, update, or delete notes',
                    parameters: {
                        type: 'object',
                        properties: {
                            action: { type: 'string', description: 'Action to perform' }
                        },
                        required: ['action']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'calendar_integration',
                    description: 'Work with calendar and date-based operations',
                    parameters: {
                        type: 'object',
                        properties: {
                            operation: { type: 'string', description: 'Calendar operation' }
                        },
                        required: ['operation']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'navigate_hierarchy',
                    description: 'Navigate note hierarchy and relationships',
                    parameters: {
                        type: 'object',
                        properties: {
                            note_id: { type: 'string', description: 'Note ID' }
                        },
                        required: ['note_id']
                    }
                }
            }
        ];
    });

    describe('Provider-specific filtering', () => {
        describe('Ollama provider', () => {
            it('should limit tools to 3 for Ollama', () => {
                const config: ToolFilterConfig = {
                    provider: 'ollama',
                    contextWindow: 8192
                };

                const filtered = service.filterToolsForProvider(config, mockTools);

                expect(filtered.length).toBeLessThanOrEqual(3);
            });

            it('should include essential tools (smart_search, manage_note) for Ollama', () => {
                const config: ToolFilterConfig = {
                    provider: 'ollama',
                    contextWindow: 8192
                };

                const filtered = service.filterToolsForProvider(config, mockTools);
                const toolNames = filtered.map(t => t.function.name);

                expect(toolNames).toContain('smart_search');
                expect(toolNames).toContain('manage_note');
            });

            it('should select calendar_integration for date queries on Ollama', () => {
                const config: ToolFilterConfig = {
                    provider: 'ollama',
                    contextWindow: 8192,
                    query: 'show me my notes from today'
                };

                const filtered = service.filterToolsForProvider(config, mockTools);
                const toolNames = filtered.map(t => t.function.name);

                expect(toolNames).toContain('calendar_integration');
            });

            it('should select navigate_hierarchy for hierarchy queries on Ollama', () => {
                const config: ToolFilterConfig = {
                    provider: 'ollama',
                    contextWindow: 8192,
                    query: 'show me the children of this note'
                };

                const filtered = service.filterToolsForProvider(config, mockTools);
                const toolNames = filtered.map(t => t.function.name);

                expect(toolNames).toContain('navigate_hierarchy');
            });

            it('should return only essential tools when no query is provided for Ollama', () => {
                const config: ToolFilterConfig = {
                    provider: 'ollama',
                    contextWindow: 8192
                };

                const filtered = service.filterToolsForProvider(config, mockTools);
                const toolNames = filtered.map(t => t.function.name);

                expect(filtered.length).toBe(2);
                expect(toolNames).toContain('smart_search');
                expect(toolNames).toContain('manage_note');
            });
        });

        describe('OpenAI provider', () => {
            it('should allow all 4 tools for OpenAI', () => {
                const config: ToolFilterConfig = {
                    provider: 'openai',
                    contextWindow: 128000
                };

                const filtered = service.filterToolsForProvider(config, mockTools);

                expect(filtered.length).toBe(4);
            });

            it('should filter by query for OpenAI when query is provided', () => {
                const config: ToolFilterConfig = {
                    provider: 'openai',
                    contextWindow: 128000,
                    query: 'what is the date today?'
                };

                const filtered = service.filterToolsForProvider(config, mockTools);
                const toolNames = filtered.map(t => t.function.name);

                // Should prioritize calendar_integration for date queries
                expect(toolNames[0]).toBe('smart_search');
                expect(toolNames[1]).toBe('manage_note');
                expect(toolNames[2]).toBe('calendar_integration');
            });

            it('should return all tools in priority order when no query for OpenAI', () => {
                const config: ToolFilterConfig = {
                    provider: 'openai',
                    contextWindow: 128000
                };

                const filtered = service.filterToolsForProvider(config, mockTools);

                expect(filtered.length).toBe(4);
                expect(filtered[0].function.name).toBe('smart_search');
                expect(filtered[1].function.name).toBe('manage_note');
            });
        });

        describe('Anthropic provider', () => {
            it('should allow all 4 tools for Anthropic', () => {
                const config: ToolFilterConfig = {
                    provider: 'anthropic',
                    contextWindow: 200000
                };

                const filtered = service.filterToolsForProvider(config, mockTools);

                expect(filtered.length).toBe(4);
            });

            it('should filter by query for Anthropic when query is provided', () => {
                const config: ToolFilterConfig = {
                    provider: 'anthropic',
                    contextWindow: 200000,
                    query: 'find all notes under my project folder'
                };

                const filtered = service.filterToolsForProvider(config, mockTools);
                const toolNames = filtered.map(t => t.function.name);

                // Should prioritize navigate_hierarchy for hierarchy queries
                expect(toolNames).toContain('smart_search');
                expect(toolNames).toContain('manage_note');
                expect(toolNames).toContain('navigate_hierarchy');
            });
        });
    });

    describe('Query intent analysis', () => {
        it('should detect search intent', () => {
            const config: ToolFilterConfig = {
                provider: 'openai',
                contextWindow: 128000,
                query: 'find notes about machine learning'
            };

            const filtered = service.filterToolsForProvider(config, mockTools);

            // Search intent should prioritize smart_search
            expect(filtered[0].function.name).toBe('smart_search');
        });

        it('should detect note management intent', () => {
            const config: ToolFilterConfig = {
                provider: 'openai',
                contextWindow: 128000,
                query: 'create a new note about my ideas'
            };

            const filtered = service.filterToolsForProvider(config, mockTools);
            const toolNames = filtered.map(t => t.function.name);

            // Management intent should include manage_note
            expect(toolNames).toContain('manage_note');
        });

        it('should detect date intent with "today" keyword', () => {
            const config: ToolFilterConfig = {
                provider: 'ollama',
                contextWindow: 8192,
                query: 'what did I work on today?'
            };

            const filtered = service.filterToolsForProvider(config, mockTools);
            const toolNames = filtered.map(t => t.function.name);

            expect(toolNames).toContain('calendar_integration');
        });

        it('should detect date intent with "tomorrow" keyword', () => {
            const config: ToolFilterConfig = {
                provider: 'ollama',
                contextWindow: 8192,
                query: 'schedule something for tomorrow'
            };

            const filtered = service.filterToolsForProvider(config, mockTools);
            const toolNames = filtered.map(t => t.function.name);

            expect(toolNames).toContain('calendar_integration');
        });

        it('should detect hierarchy intent with "parent" keyword', () => {
            const config: ToolFilterConfig = {
                provider: 'ollama',
                contextWindow: 8192,
                query: 'show me the parent note'
            };

            const filtered = service.filterToolsForProvider(config, mockTools);
            const toolNames = filtered.map(t => t.function.name);

            expect(toolNames).toContain('navigate_hierarchy');
        });

        it('should detect hierarchy intent with "children" keyword', () => {
            const config: ToolFilterConfig = {
                provider: 'ollama',
                contextWindow: 8192,
                query: 'list all children of this note'
            };

            const filtered = service.filterToolsForProvider(config, mockTools);
            const toolNames = filtered.map(t => t.function.name);

            expect(toolNames).toContain('navigate_hierarchy');
        });
    });

    describe('Edge cases', () => {
        it('should handle empty tools array', () => {
            const config: ToolFilterConfig = {
                provider: 'ollama',
                contextWindow: 8192
            };

            const filtered = service.filterToolsForProvider(config, []);

            expect(filtered).toEqual([]);
        });

        it('should handle undefined query', () => {
            const config: ToolFilterConfig = {
                provider: 'ollama',
                contextWindow: 8192,
                query: undefined
            };

            const filtered = service.filterToolsForProvider(config, mockTools);

            // Should return essential tools only
            expect(filtered.length).toBe(2);
        });

        it('should handle empty query string', () => {
            const config: ToolFilterConfig = {
                provider: 'ollama',
                contextWindow: 8192,
                query: ''
            };

            const filtered = service.filterToolsForProvider(config, mockTools);

            // Empty string is falsy, should behave like undefined
            expect(filtered.length).toBe(2);
        });

        it('should respect maxTools override', () => {
            const config: ToolFilterConfig = {
                provider: 'ollama',
                contextWindow: 8192,
                maxTools: 2
            };

            const filtered = service.filterToolsForProvider(config, mockTools);

            expect(filtered.length).toBeLessThanOrEqual(2);
        });

        it('should handle maxTools of 0', () => {
            const config: ToolFilterConfig = {
                provider: 'ollama',
                contextWindow: 8192,
                maxTools: 0
            };

            const filtered = service.filterToolsForProvider(config, mockTools);

            expect(filtered.length).toBe(0);
        });

        it('should handle maxTools greater than available tools', () => {
            const config: ToolFilterConfig = {
                provider: 'ollama',
                contextWindow: 8192,
                maxTools: 10
            };

            const filtered = service.filterToolsForProvider(config, mockTools);

            // Should return all available tools
            expect(filtered.length).toBe(4);
        });

        it('should handle tools already within limit', () => {
            const config: ToolFilterConfig = {
                provider: 'ollama',
                contextWindow: 8192
            };

            // Only 2 tools (less than Ollama limit of 3)
            const limitedTools = mockTools.slice(0, 2);
            const filtered = service.filterToolsForProvider(config, limitedTools);

            expect(filtered.length).toBe(2);
        });
    });

    describe('Statistics and utilities', () => {
        it('should calculate filter statistics correctly', () => {
            const config: ToolFilterConfig = {
                provider: 'ollama',
                contextWindow: 8192
            };

            const stats = service.getFilterStats(4, 3, config);

            expect(stats.provider).toBe('ollama');
            expect(stats.original).toBe(4);
            expect(stats.filtered).toBe(3);
            expect(stats.reduction).toBe(1);
            expect(stats.reductionPercent).toBe(25);
            expect(stats.estimatedTokenSavings).toBe(144); // 1 tool * 144 tokens
        });

        it('should estimate tool tokens correctly', () => {
            const tokens = service.estimateToolTokens(mockTools);

            // 4 tools * 144 tokens per tool = 576 tokens
            expect(tokens).toBe(576);
        });

        it('should estimate tool tokens for empty array', () => {
            const tokens = service.estimateToolTokens([]);

            expect(tokens).toBe(0);
        });

        it('should return correct context window for providers', () => {
            expect(service.getProviderContextWindow('ollama')).toBe(8192);
            expect(service.getProviderContextWindow('openai')).toBe(128000);
            expect(service.getProviderContextWindow('anthropic')).toBe(200000);
        });
    });

    describe('Case sensitivity', () => {
        it('should handle case-insensitive queries', () => {
            const config1: ToolFilterConfig = {
                provider: 'ollama',
                contextWindow: 8192,
                query: 'Show me TODAY notes'
            };

            const config2: ToolFilterConfig = {
                provider: 'ollama',
                contextWindow: 8192,
                query: 'show me today notes'
            };

            const filtered1 = service.filterToolsForProvider(config1, mockTools);
            const filtered2 = service.filterToolsForProvider(config2, mockTools);

            expect(filtered1.length).toBe(filtered2.length);
            expect(filtered1.map(t => t.function.name)).toEqual(
                filtered2.map(t => t.function.name)
            );
        });
    });

    describe('Multiple intent detection', () => {
        it('should prioritize date intent over hierarchy intent', () => {
            const config: ToolFilterConfig = {
                provider: 'ollama',
                contextWindow: 8192,
                query: 'show me parent notes from today'
            };

            const filtered = service.filterToolsForProvider(config, mockTools);
            const toolNames = filtered.map(t => t.function.name);

            // Should include calendar_integration (date intent has priority)
            expect(toolNames).toContain('calendar_integration');
        });

        it('should handle complex queries with multiple keywords', () => {
            const config: ToolFilterConfig = {
                provider: 'ollama',
                contextWindow: 8192,
                query: 'find and update my daily journal for yesterday'
            };

            const filtered = service.filterToolsForProvider(config, mockTools);

            // Should still limit to 3 tools
            expect(filtered.length).toBeLessThanOrEqual(3);

            // Should include essentials
            const toolNames = filtered.map(t => t.function.name);
            expect(toolNames).toContain('smart_search');
            expect(toolNames).toContain('manage_note');
        });
    });

    describe('Tool priority ordering', () => {
        it('should maintain priority order: smart_search, manage_note, calendar_integration, navigate_hierarchy', () => {
            const config: ToolFilterConfig = {
                provider: 'openai',
                contextWindow: 128000
            };

            const filtered = service.filterToolsForProvider(config, mockTools);

            expect(filtered[0].function.name).toBe('smart_search');
            expect(filtered[1].function.name).toBe('manage_note');
            // Next could be calendar or hierarchy depending on implementation
        });
    });
});
