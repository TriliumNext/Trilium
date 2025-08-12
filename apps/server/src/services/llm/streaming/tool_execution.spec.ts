import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { processProviderStream, StreamProcessor } from '../providers/stream_handler.js';
import type { ProviderStreamOptions } from '../providers/stream_handler.js';
import type { StandardizedToolResponse } from '../tools/tool_interfaces.js';

// Mock log service
vi.mock('../../log.js', () => ({
    default: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn()
    }
}));

describe('Tool Execution During Streaming Tests', () => {
    let mockOptions: ProviderStreamOptions;
    let receivedCallbacks: Array<{ text: string; done: boolean; chunk: any }>;

    beforeEach(() => {
        vi.clearAllMocks();
        receivedCallbacks = [];
        mockOptions = {
            providerName: 'ToolTestProvider',
            modelName: 'tool-capable-model'
        };
    });

    const mockCallback = (text: string, done: boolean, chunk: any) => {
        receivedCallbacks.push({ text, done, chunk });
    };

    describe('Basic Tool Call Handling', () => {
        it('should extract and process tool calls with standardized responses', async () => {
            const toolChunks = [
                { message: { content: 'Let me search for that' } },
                {
                    message: {
                        tool_calls: [{
                            id: 'call_search_123',
                            type: 'function',
                            function: {
                                name: 'smart_search_tool',
                                arguments: '{"query": "weather today", "searchType": "fullText"}'
                            }
                        }]
                    }
                },
                { message: { content: 'The weather today is sunny.' } },
                { done: true }
            ];

            const mockIterator = {
                async *[Symbol.asyncIterator]() {
                    for (const chunk of toolChunks) {
                        yield chunk;
                    }
                }
            };

            const result = await processProviderStream(
                mockIterator,
                mockOptions,
                mockCallback
            );

            expect(result.toolCalls).toHaveLength(1);
            expect(result.toolCalls[0]).toEqual({
                id: 'call_search_123',
                type: 'function',
                function: {
                    name: 'smart_search_tool',
                    arguments: '{"query": "weather today", "searchType": "fullText"}'
                }
            });
            expect(result.completeText).toBe('Let me search for thatThe weather today is sunny.');
        });

        it('should handle multiple tool calls in sequence', async () => {
            const multiToolChunks = [
                { message: { content: 'I need to use multiple tools' } },
                {
                    message: {
                        tool_calls: [{
                            id: 'call_1',
                            function: { name: 'calculator', arguments: '{"expr": "2+2"}' }
                        }]
                    }
                },
                { message: { content: 'First calculation complete. Now searching...' } },
                {
                    message: {
                        tool_calls: [{
                            id: 'call_2',
                            function: { name: 'web_search', arguments: '{"query": "math"}' }
                        }]
                    }
                },
                { message: { content: 'All tasks completed.' } },
                { done: true }
            ];

            const mockIterator = {
                async *[Symbol.asyncIterator]() {
                    for (const chunk of multiToolChunks) {
                        yield chunk;
                    }
                }
            };

            const result = await processProviderStream(
                mockIterator,
                mockOptions,
                mockCallback
            );

            // Should capture the last tool calls (overwriting previous ones as per implementation)
            expect(result.toolCalls).toHaveLength(1);
            expect(result.toolCalls[0].function.name).toBe('web_search');
        });

        it('should handle tool calls with complex arguments', async () => {
            const complexToolChunk = {
                message: {
                    tool_calls: [{
                        id: 'call_complex',
                        function: {
                            name: 'data_processor',
                            arguments: JSON.stringify({
                                dataset: {
                                    source: 'database',
                                    filters: { active: true, category: 'sales' },
                                    columns: ['id', 'name', 'amount', 'date']
                                },
                                operations: [
                                    { type: 'filter', condition: 'amount > 100' },
                                    { type: 'group', by: 'category' },
                                    { type: 'aggregate', function: 'sum', column: 'amount' }
                                ],
                                output: { format: 'json', include_metadata: true }
                            })
                        }
                    }]
                }
            };

            const toolCalls = StreamProcessor.extractToolCalls(complexToolChunk);
            
            expect(toolCalls).toHaveLength(1);
            expect(toolCalls[0].function.name).toBe('data_processor');
            
            const args = JSON.parse(toolCalls[0].function.arguments);
            expect(args.dataset.source).toBe('database');
            expect(args.operations).toHaveLength(3);
            expect(args.output.format).toBe('json');
        });
    });

    describe('Tool Call Extraction Edge Cases', () => {
        it('should handle empty tool_calls array', async () => {
            const emptyToolChunk = {
                message: {
                    content: 'No tools needed',
                    tool_calls: []
                }
            };

            const toolCalls = StreamProcessor.extractToolCalls(emptyToolChunk);
            expect(toolCalls).toEqual([]);
        });

        it('should handle malformed tool_calls', async () => {
            const malformedChunk = {
                message: {
                    tool_calls: 'not an array'
                }
            };

            const toolCalls = StreamProcessor.extractToolCalls(malformedChunk);
            expect(toolCalls).toEqual([]);
        });

        it('should handle missing function field in tool call', async () => {
            const incompleteToolChunk = {
                message: {
                    tool_calls: [{
                        id: 'call_incomplete',
                        type: 'function'
                        // Missing function field
                    }]
                }
            };

            const toolCalls = StreamProcessor.extractToolCalls(incompleteToolChunk);
            expect(toolCalls).toHaveLength(1);
            expect(toolCalls[0].id).toBe('call_incomplete');
        });

        it('should handle tool calls with invalid JSON arguments', async () => {
            const invalidJsonChunk = {
                message: {
                    tool_calls: [{
                        id: 'call_invalid_json',
                        function: {
                            name: 'test_tool',
                            arguments: '{"invalid": json}'  // Invalid JSON
                        }
                    }]
                }
            };

            const toolCalls = StreamProcessor.extractToolCalls(invalidJsonChunk);
            expect(toolCalls).toHaveLength(1);
            expect(toolCalls[0].function.arguments).toBe('{"invalid": json}');
        });
    });

    describe('Real-world Tool Execution Scenarios', () => {
        it('should handle enhanced tool execution with standardized responses', async () => {
            const enhancedToolScenario = [
                { message: { content: 'Let me calculate that for you' } },
                {
                    message: {
                        tool_calls: [{
                            id: 'call_calc_456',
                            function: {
                                name: 'execute_batch_tool',
                                arguments: '{"operations": [{"tool": "calculator", "params": {"expression": "15 * 37 + 22"}}]}'
                            }
                        }]
                    }
                },
                { message: { content: 'The calculation completed successfully. Result: 577.' } },
                { done: true }
            ];

            const mockIterator = {
                async *[Symbol.asyncIterator]() {
                    for (const chunk of enhancedToolScenario) {
                        yield chunk;
                    }
                }
            };

            const result = await processProviderStream(
                mockIterator,
                mockOptions,
                mockCallback
            );

            expect(result.toolCalls[0].function.name).toBe('execute_batch_tool');
            expect(result.completeText).toBe('Let me calculate that for youThe calculation completed successfully. Result: 577.');
            
            // Verify enhanced tool arguments structure
            const args = JSON.parse(result.toolCalls[0].function.arguments);
            expect(args.operations).toHaveLength(1);
            expect(args.operations[0].tool).toBe('calculator');
        });

        it('should handle smart search tool execution with enhanced features', async () => {
            const smartSearchScenario = [
                { message: { content: 'Searching for information with smart algorithms...' } },
                {
                    message: {
                        tool_calls: [{
                            id: 'call_search_789',
                            function: {
                                name: 'smart_search_tool',
                                arguments: '{"query": "latest AI developments", "searchType": "semantic", "maxResults": 5, "includeArchived": false}'
                            }
                        }]
                    }
                },
                { message: { content: 'Based on my smart search, here are the relevant findings...' } },
                { done: true }
            ];

            const mockIterator = {
                async *[Symbol.asyncIterator]() {
                    for (const chunk of smartSearchScenario) {
                        yield chunk;
                    }
                }
            };

            const result = await processProviderStream(
                mockIterator,
                mockOptions,
                mockCallback
            );

            expect(result.toolCalls[0].function.name).toBe('smart_search_tool');
            const args = JSON.parse(result.toolCalls[0].function.arguments);
            expect(args.searchType).toBe('semantic');
            expect(args.maxResults).toBe(5);
            expect(args.includeArchived).toBe(false);
        });

        it('should handle note operations with enhanced tools', async () => {
            const noteOpScenario = [
                { message: { content: 'I\'ll help you work with that note' } },
                {
                    message: {
                        tool_calls: [{
                            id: 'call_note_read',
                            function: {
                                name: 'read_note_tool',
                                arguments: '{"noteId": "abc123def456", "includeContent": true, "includeAttributes": true}'
                            }
                        }]
                    }
                },
                { message: { content: 'Note content analyzed. Now creating updated version...' } },
                {
                    message: {
                        tool_calls: [{
                            id: 'call_note_update',
                            function: {
                                name: 'note_update_tool',
                                arguments: '{"noteId": "abc123def456", "updates": {"content": "Updated content", "title": "Updated Title"}}'
                            }
                        }]
                    }
                },
                { message: { content: 'Note updated successfully.' } },
                { done: true }
            ];

            const mockIterator = {
                async *[Symbol.asyncIterator]() {
                    for (const chunk of noteOpScenario) {
                        yield chunk;
                    }
                }
            };

            const result = await processProviderStream(
                mockIterator,
                mockOptions,
                mockCallback
            );

            // Should have the last tool call
            expect(result.toolCalls[0].function.name).toBe('note_update_tool');
            
            // Verify enhanced note operation arguments
            const args = JSON.parse(result.toolCalls[0].function.arguments);
            expect(args.noteId).toBe('abc123def456');
            expect(args.updates.content).toBe('Updated content');
            expect(args.updates.title).toBe('Updated Title');
        });
    });

    describe('Tool Execution with Content Streaming', () => {
        it('should interleave tool calls with content correctly', async () => {
            const interleavedScenario = [
                { message: { content: 'Starting analysis' } },
                {
                    message: {
                        content: ' with tools.',
                        tool_calls: [{
                            id: 'call_analyze',
                            function: { name: 'analyzer', arguments: '{}' }
                        }]
                    }
                },
                { message: { content: ' Tool executed.' } },
                { message: { content: ' Final results ready.' } },
                { done: true }
            ];

            const mockIterator = {
                async *[Symbol.asyncIterator]() {
                    for (const chunk of interleavedScenario) {
                        yield chunk;
                    }
                }
            };

            const result = await processProviderStream(
                mockIterator,
                mockOptions,
                mockCallback
            );

            expect(result.completeText).toBe('Starting analysis with tools. Tool executed. Final results ready.');
            expect(result.toolCalls).toHaveLength(1);
        });

        it('should handle tool calls without content in same chunk', async () => {
            const toolOnlyChunks = [
                { message: { content: 'Preparing to use tools' } },
                {
                    message: {
                        tool_calls: [{
                            id: 'call_tool_only',
                            function: { name: 'silent_tool', arguments: '{}' }
                        }]
                        // No content in this chunk
                    }
                },
                { message: { content: 'Tool completed silently' } },
                { done: true }
            ];

            const mockIterator = {
                async *[Symbol.asyncIterator]() {
                    for (const chunk of toolOnlyChunks) {
                        yield chunk;
                    }
                }
            };

            const result = await processProviderStream(
                mockIterator,
                mockOptions,
                mockCallback
            );

            expect(result.completeText).toBe('Preparing to use toolsTool completed silently');
            expect(result.toolCalls[0].function.name).toBe('silent_tool');
        });
    });

    describe('Provider-Specific Tool Formats', () => {
        it('should handle OpenAI tool call format', async () => {
            const openAIToolFormat = {
                choices: [{
                    delta: {
                        tool_calls: [{
                            index: 0,
                            id: 'call_openai_123',
                            type: 'function',
                            function: {
                                name: 'get_weather',
                                arguments: '{"location": "San Francisco"}'
                            }
                        }]
                    }
                }]
            };

            // Convert to our standard format for testing
            const standardFormat = {
                message: {
                    tool_calls: openAIToolFormat.choices[0].delta.tool_calls
                }
            };

            const toolCalls = StreamProcessor.extractToolCalls(standardFormat);
            expect(toolCalls).toHaveLength(1);
            expect(toolCalls[0].function.name).toBe('get_weather');
        });

        it('should handle Anthropic tool call format', async () => {
            // Anthropic uses different format - simulate conversion
            const anthropicToolData = {
                type: 'tool_use',
                id: 'call_anthropic_456',
                name: 'search_engine',
                input: { query: 'best restaurants nearby' }
            };

            // Convert to our standard format
            const standardFormat = {
                message: {
                    tool_calls: [{
                        id: anthropicToolData.id,
                        function: {
                            name: anthropicToolData.name,
                            arguments: JSON.stringify(anthropicToolData.input)
                        }
                    }]
                }
            };

            const toolCalls = StreamProcessor.extractToolCalls(standardFormat);
            expect(toolCalls).toHaveLength(1);
            expect(toolCalls[0].function.name).toBe('search_engine');
        });
    });

    describe('Enhanced Tool Execution Error Scenarios', () => {
        it('should handle standardized tool execution errors in stream', async () => {
            const toolErrorScenario = [
                { message: { content: 'Attempting tool execution with smart retry' } },
                {
                    message: {
                        tool_calls: [{
                            id: 'call_error_test',
                            function: {
                                name: 'smart_retry_tool',
                                arguments: '{"originalTool": "failing_operation", "maxAttempts": 3, "backoffStrategy": "exponential"}'
                            }
                        }]
                    }
                },
                { 
                    message: { 
                        content: 'Tool execution failed after 3 attempts. Error details: Permission denied. Suggestions: Check permissions and try again.',
                        error: 'Standardized tool execution error',
                        errorDetails: {
                            success: false,
                            error: 'Permission denied',
                            help: {
                                possibleCauses: ['Insufficient permissions', 'Invalid file path'],
                                suggestions: ['Verify user permissions', 'Check file exists']
                            }
                        }
                    } 
                },
                { done: true }
            ];

            const mockIterator = {
                async *[Symbol.asyncIterator]() {
                    for (const chunk of toolErrorScenario) {
                        yield chunk;
                    }
                }
            };

            const result = await processProviderStream(
                mockIterator,
                mockOptions,
                mockCallback
            );

            expect(result.toolCalls[0].function.name).toBe('failing_tool');
            expect(result.completeText).toContain('Tool execution failed');
        });

        it('should handle timeout in tool execution', async () => {
            const timeoutScenario = [
                { message: { content: 'Starting long-running tool' } },
                {
                    message: {
                        tool_calls: [{
                            id: 'call_timeout',
                            function: { name: 'slow_tool', arguments: '{}' }
                        }]
                    }
                },
                { message: { content: 'Tool timed out after 30 seconds' } },
                { done: true }
            ];

            const mockIterator = {
                async *[Symbol.asyncIterator]() {
                    for (const chunk of timeoutScenario) {
                        yield chunk;
                    }
                }
            };

            const result = await processProviderStream(
                mockIterator,
                mockOptions,
                mockCallback
            );

            expect(result.completeText).toContain('timed out');
        });
    });

    describe('Enhanced Compound Tool Workflows', () => {
        it('should handle compound workflow tools that reduce LLM calls', async () => {
            const compoundWorkflowScenario = [
                { message: { content: 'Starting compound workflow operation' } },
                {
                    message: {
                        tool_calls: [{
                            id: 'compound_workflow',
                            function: { 
                                name: 'find_and_update_tool', 
                                arguments: '{"searchQuery": "project status", "updates": {"status": "completed", "completedDate": "2024-01-15"}, "createIfNotFound": false}' 
                            }
                        }]
                    }
                },
                { message: { content: 'Compound operation completed: Found 3 notes matching criteria, updated all with new status and completion date.' } },
                { done: true }
            ];

            const mockIterator = {
                async *[Symbol.asyncIterator]() {
                    for (const chunk of compoundWorkflowScenario) {
                        yield chunk;
                    }
                }
            };

            const result = await processProviderStream(
                mockIterator,
                mockOptions,
                mockCallback
            );

            // Should capture the compound tool
            expect(result.toolCalls[0].function.name).toBe('find_and_update_tool');
            const args = JSON.parse(result.toolCalls[0].function.arguments);
            expect(args.searchQuery).toBe('project status');
            expect(args.updates.status).toBe('completed');
            expect(args.createIfNotFound).toBe(false);
        });

        it('should handle trilium-native tool workflows', async () => {
            const triliumWorkflowScenario = [
                { message: { content: 'Starting Trilium-specific operations' } },
                {
                    message: {
                        tool_calls: [{
                            id: 'trilium_op1',
                            function: { 
                                name: 'clone_note_tool', 
                                arguments: '{"noteId": "source123", "targetParentIds": ["parent1", "parent2"], "cloneType": "full"}' 
                            }
                        }]
                    }
                },
                { message: { content: 'Note cloned to multiple parents. Now organizing hierarchy...' } },
                {
                    message: {
                        tool_calls: [{
                            id: 'trilium_op2', 
                            function: { 
                                name: 'organize_hierarchy_tool', 
                                arguments: '{"parentNoteId": "parent1", "sortBy": "title", "groupBy": "noteType", "createSubfolders": true}' 
                            }
                        }]
                    }
                },
                { message: { content: 'Trilium-native operations completed successfully.' } },
                { done: true }
            ];

            const mockIterator = {
                async *[Symbol.asyncIterator]() {
                    for (const chunk of triliumWorkflowScenario) {
                        yield chunk;
                    }
                }
            };

            const result = await processProviderStream(
                mockIterator,
                mockOptions,
                mockCallback
            );

            // Should capture the last tool call (Trilium-specific)
            expect(result.toolCalls[0].function.name).toBe('organize_hierarchy_tool');
            const args = JSON.parse(result.toolCalls[0].function.arguments);
            expect(args.parentNoteId).toBe('parent1');
            expect(args.sortBy).toBe('title');
            expect(args.createSubfolders).toBe(true);
        });

        it('should handle parallel tool execution indication', async () => {
            const parallelToolsChunk = {
                message: {
                    tool_calls: [
                        {
                            id: 'parallel_1',
                            function: { name: 'fetch_weather', arguments: '{"city": "NYC"}' }
                        },
                        {
                            id: 'parallel_2', 
                            function: { name: 'fetch_news', arguments: '{"topic": "technology"}' }
                        },
                        {
                            id: 'parallel_3',
                            function: { name: 'fetch_stocks', arguments: '{"symbol": "AAPL"}' }
                        }
                    ]
                }
            };

            const toolCalls = StreamProcessor.extractToolCalls(parallelToolsChunk);
            expect(toolCalls).toHaveLength(3);
            expect(toolCalls.map(tc => tc.function.name)).toEqual([
                'fetch_weather', 'fetch_news', 'fetch_stocks'
            ]);
        });
    });

    describe('Tool Call Logging and Debugging', () => {
        it('should log tool call detection', async () => {
            const log = (await import('../../log.js')).default;
            
            const toolChunk = {
                message: {
                    tool_calls: [{
                        id: 'log_test',
                        function: { name: 'test_tool', arguments: '{}' }
                    }]
                }
            };

            StreamProcessor.extractToolCalls(toolChunk);
            
            expect(log.info).toHaveBeenCalledWith(
                'Detected 1 tool calls in stream chunk'
            );
        });

        it('should handle tool calls in callback correctly', async () => {
            const toolCallbackScenario = [
                {
                    message: {
                        tool_calls: [{
                            id: 'callback_test',
                            function: { name: 'callback_tool', arguments: '{"test": true}' }
                        }]
                    }
                },
                { done: true }
            ];

            const mockIterator = {
                async *[Symbol.asyncIterator]() {
                    for (const chunk of toolCallbackScenario) {
                        yield chunk;
                    }
                }
            };

            await processProviderStream(
                mockIterator,
                mockOptions,
                mockCallback
            );

            // Should have received callback for tool execution chunk
            const toolCallbacks = receivedCallbacks.filter(cb => 
                cb.chunk && cb.chunk.message && cb.chunk.message.tool_calls
            );
            expect(toolCallbacks.length).toBeGreaterThan(0);
        });
    });
});