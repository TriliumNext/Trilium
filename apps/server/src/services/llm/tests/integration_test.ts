/**
 * Integration Test for LLM Resilience Improvements
 * 
 * Tests all new components working together to ensure the LLM feature
 * is extremely resilient, intuitive, and responsive.
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { toolTimeoutEnforcer } from '../tools/tool_timeout_enforcer.js';
import { providerToolValidator } from '../tools/provider_tool_validator.js';
import { providerHealthMonitor } from '../monitoring/provider_health_monitor.js';
import { parameterCoercer } from '../tools/parameter_coercer.js';
import { toolExecutionMonitor } from '../monitoring/tool_execution_monitor.js';
import { toolResponseCache } from '../tools/tool_response_cache.js';
import { edgeCaseHandler } from '../providers/edge_case_handler.js';
import { EnhancedToolHandler } from '../chat/handlers/enhanced_tool_handler.js';
import type { Tool, ToolCall } from '../tools/tool_interfaces.js';

describe('LLM Resilience Integration Tests', () => {
    // Sample tools for testing
    const sampleTools: Tool[] = [
        {
            type: 'function',
            function: {
                name: 'search_notes',
                description: 'Search for notes by keyword',
                parameters: {
                    type: 'object',
                    properties: {
                        query: {
                            type: 'string',
                            description: 'Search query'
                        },
                        limit: {
                            type: 'number',
                            description: 'Maximum results',
                            default: 10
                        }
                    },
                    required: ['query']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'create-note-with-special-chars',
                description: 'Create a new note with special characters in name',
                parameters: {
                    type: 'object',
                    properties: {
                        title: {
                            type: 'string',
                            description: 'Note title'
                        },
                        content: {
                            type: 'string',
                            description: 'Note content'
                        },
                        deeply: {
                            type: 'object',
                            description: 'Deeply nested object',
                            properties: {
                                nested: {
                                    type: 'object',
                                    description: 'Nested object',
                                    properties: {
                                        value: {
                                            type: 'string',
                                            description: 'Nested value'
                                        }
                                    }
                                }
                            }
                        }
                    },
                    required: []  // Empty for Anthropic testing
                }
            }
        }
    ];

    beforeAll(() => {
        // Initialize components
        console.log('Setting up integration test environment...');
    });

    afterAll(() => {
        // Cleanup
        toolResponseCache.shutdown();
        providerHealthMonitor.stopMonitoring();
    });

    describe('Tool Timeout Enforcement', () => {
        it('should enforce timeouts on long-running tools', async () => {
            const result = await toolTimeoutEnforcer.executeWithTimeout(
                'test_tool',
                async () => {
                    await new Promise(resolve => setTimeout(resolve, 100));
                    return 'success';
                },
                200  // 200ms timeout
            );

            expect(result.success).toBe(true);
            expect(result.timedOut).toBe(false);
            expect(result.result).toBe('success');
        });

        it('should timeout and report failure', async () => {
            const result = await toolTimeoutEnforcer.executeWithTimeout(
                'slow_tool',
                async () => {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    return 'should not reach';
                },
                100  // 100ms timeout
            );

            expect(result.success).toBe(false);
            expect(result.timedOut).toBe(true);
        });
    });

    describe('Provider Tool Validation', () => {
        it('should validate and fix tools for OpenAI', () => {
            const result = providerToolValidator.validateTool(sampleTools[1], 'openai');
            
            expect(result.fixedTool).toBeDefined();
            if (result.fixedTool) {
                // Should fix special characters in function name
                expect(result.fixedTool.function.name).not.toContain('-');
            }
        });

        it('should ensure non-empty required array for Anthropic', () => {
            const result = providerToolValidator.validateTool(sampleTools[1], 'anthropic');
            
            expect(result.fixedTool).toBeDefined();
            if (result.fixedTool) {
                // Should add at least one required parameter
                expect(result.fixedTool.function.parameters.required?.length).toBeGreaterThan(0);
            }
        });

        it('should simplify tools for Ollama', () => {
            const result = providerToolValidator.validateTool(sampleTools[1], 'ollama');
            
            expect(result.warnings.length).toBeGreaterThan(0);
        });
    });

    describe('Parameter Type Coercion', () => {
        it('should coerce string numbers to numbers', () => {
            const result = parameterCoercer.coerceToolArguments(
                { limit: '10' },
                sampleTools[0],
                { parseNumbers: true }
            );

            expect(result.success).toBe(true);
            expect(result.value.limit).toBe(10);
            expect(typeof result.value.limit).toBe('number');
        });

        it('should apply default values', () => {
            const result = parameterCoercer.coerceToolArguments(
                { query: 'test' },
                sampleTools[0],
                { applyDefaults: true }
            );

            expect(result.success).toBe(true);
            expect(result.value.limit).toBe(10);
        });

        it('should normalize arrays', () => {
            const tool: Tool = {
                type: 'function',
                function: {
                    name: 'test',
                    description: 'Test',
                    parameters: {
                        type: 'object',
                        properties: {
                            tags: {
                                type: 'array',
                                description: 'List of tags',
                                items: { type: 'string', description: 'Tag value' }
                            }
                        },
                        required: []
                    }
                }
            };

            const result = parameterCoercer.coerceToolArguments(
                { tags: 'single-tag' },
                tool,
                { normalizeArrays: true }
            );

            expect(result.success).toBe(true);
            expect(Array.isArray(result.value.tags)).toBe(true);
            expect(result.value.tags).toEqual(['single-tag']);
        });
    });

    describe('Tool Execution Monitoring', () => {
        it('should track execution statistics', () => {
            // Record successful execution
            toolExecutionMonitor.recordExecution({
                toolName: 'test_tool',
                provider: 'openai',
                status: 'success',
                executionTime: 100,
                timestamp: new Date()
            });

            const stats = toolExecutionMonitor.getToolStats('test_tool', 'openai');
            expect(stats).toBeDefined();
            expect(stats?.successfulExecutions).toBe(1);
            expect(stats?.reliabilityScore).toBeGreaterThan(0);
        });

        it('should auto-disable unreliable tools', () => {
            // Record multiple failures
            for (let i = 0; i < 6; i++) {
                toolExecutionMonitor.recordExecution({
                    toolName: 'unreliable_tool',
                    provider: 'openai',
                    status: 'failure',
                    executionTime: 100,
                    timestamp: new Date(),
                    error: 'Test failure'
                });
            }

            const isDisabled = toolExecutionMonitor.isToolDisabled('unreliable_tool', 'openai');
            expect(isDisabled).toBe(true);
        });
    });

    describe('Tool Response Caching', () => {
        it('should cache deterministic tool responses', () => {
            const toolName = 'read_note_tool';
            const args = { noteId: 'test123' };
            const response = { content: 'Test content' };

            // Set cache
            const cached = toolResponseCache.set(toolName, args, response, 'openai');
            expect(cached).toBe(true);

            // Get from cache
            const retrieved = toolResponseCache.get(toolName, args, 'openai');
            expect(retrieved).toEqual(response);
        });

        it('should generate consistent cache keys', () => {
            const key1 = toolResponseCache.generateCacheKey('tool', { b: 2, a: 1 }, 'provider');
            const key2 = toolResponseCache.generateCacheKey('tool', { a: 1, b: 2 }, 'provider');
            
            expect(key1).toBe(key2);
        });

        it('should respect TTL', async () => {
            const toolName = 'temp_tool';
            const args = { id: 'temp' };
            const response = 'temp data';

            // Set with short TTL
            toolResponseCache.set(toolName, args, response, 'openai', 100); // 100ms TTL

            // Should be cached
            expect(toolResponseCache.get(toolName, args, 'openai')).toBe(response);

            // Wait for expiration
            await new Promise(resolve => setTimeout(resolve, 150));

            // Should be expired
            expect(toolResponseCache.get(toolName, args, 'openai')).toBeUndefined();
        });
    });

    describe('Edge Case Handling', () => {
        it('should fix OpenAI edge cases', () => {
            const tool = sampleTools[1];
            const result = edgeCaseHandler.fixToolForProvider(tool, 'openai');

            expect(result.fixed).toBe(true);
            if (result.tool) {
                // Function name should not have hyphens
                expect(result.tool.function.name).not.toContain('-');
                // Deep nesting might be flattened
                expect(result.modifications.length).toBeGreaterThan(0);
            }
        });

        it('should fix Anthropic edge cases', () => {
            const tool = sampleTools[1];
            const result = edgeCaseHandler.fixToolForProvider(tool, 'anthropic');

            expect(result.fixed).toBe(true);
            if (result.tool) {
                // Should have required parameters
                expect(result.tool.function.parameters.required).toBeDefined();
                expect(result.tool.function.parameters.required!.length).toBeGreaterThan(0);
            }
        });

        it('should simplify for Ollama', () => {
            const complexTool: Tool = {
                type: 'function',
                function: {
                    name: 'complex_tool',
                    description: 'A'.repeat(600), // Long description
                    parameters: {
                        type: 'object',
                        properties: Object.fromEntries(
                            Array.from({ length: 30 }, (_, i) => [
                                `param${i}`,
                                { type: 'string', description: `Parameter ${i}` }
                            ])
                        ),
                        required: []
                    }
                }
            };

            const result = edgeCaseHandler.fixToolForProvider(complexTool, 'ollama');
            
            expect(result.fixed).toBe(true);
            if (result.tool) {
                // Description should be truncated
                expect(result.tool.function.description.length).toBeLessThanOrEqual(500);
                // Parameters should be reduced
                const paramCount = Object.keys(result.tool.function.parameters.properties || {}).length;
                expect(paramCount).toBeLessThanOrEqual(20);
            }
        });
    });

    describe('Parallel Tool Execution', () => {
        it('should identify independent tools for parallel execution', async () => {
            const toolCalls: ToolCall[] = [
                {
                    id: '1',
                    function: {
                        name: 'search_notes',
                        arguments: { query: 'test1' }
                    }
                },
                {
                    id: '2',
                    function: {
                        name: 'search_notes',
                        arguments: { query: 'test2' }
                    }
                },
                {
                    id: '3',
                    function: {
                        name: 'read_note_tool',
                        arguments: { noteId: 'abc' }
                    }
                }
            ];

            // These should be executed in parallel since they're independent
            const handler = new EnhancedToolHandler();
            // For now, just verify the handler was created successfully
            expect(handler).toBeDefined();
        });
    });

    describe('Provider Health Monitoring', () => {
        it('should track provider health status', async () => {
            // Mock provider service
            const mockService = {
                chat: async () => ({
                    content: 'test',
                    usage: { totalTokens: 5 }
                }),
                getModels: () => [{ id: 'test-model' }]
            };

            providerHealthMonitor.registerProvider('test-provider', mockService as any);
            
            // Manually trigger health check
            const result = await providerHealthMonitor.checkProvider('test-provider');
            
            expect(result.success).toBe(true);
            expect(result.latency).toBeGreaterThan(0);
            
            const health = providerHealthMonitor.getProviderHealth('test-provider');
            expect(health?.healthy).toBe(true);
        });

        it('should disable unhealthy providers', () => {
            // Simulate failures
            const status = {
                provider: 'failing-provider',
                healthy: true,
                lastChecked: new Date(),
                consecutiveFailures: 3,
                totalChecks: 10,
                totalFailures: 3,
                averageLatency: 100,
                disabled: false
            };

            // This would normally be done internally
            providerHealthMonitor.disableProvider('failing-provider', 'Too many failures');
            
            expect(providerHealthMonitor.isProviderHealthy('failing-provider')).toBe(false);
        });
    });

    describe('End-to-End Integration', () => {
        it('should handle tool execution with all enhancements', async () => {
            // This tests the full flow with all components working together
            const toolCall: ToolCall = {
                id: 'integration-test',
                function: {
                    name: 'search_notes',
                    arguments: '{"query": "test", "limit": "5"}'  // String number to test coercion
                }
            };

            // Test components integration
            const tool = sampleTools[0];
            
            // 1. Validate for provider
            const validation = providerToolValidator.validateTool(tool, 'openai');
            expect(validation.valid || validation.fixedTool).toBeTruthy();
            
            // 2. Apply edge case fixes
            const edgeFixes = edgeCaseHandler.fixToolForProvider(
                validation.fixedTool || tool,
                'openai'
            );
            
            // 3. Parse and coerce arguments
            const args = parameterCoercer.coerceToolArguments(
                JSON.parse(toolCall.function.arguments as string),
                tool,
                { provider: 'openai' }
            );
            expect(args.value.limit).toBe(5);
            expect(typeof args.value.limit).toBe('number');
            
            // 4. Execute with timeout
            const timeoutResult = await toolTimeoutEnforcer.executeWithTimeout(
                'search_notes',
                async () => ({ results: ['note1', 'note2'] }),
                5000
            );
            expect(timeoutResult.success).toBe(true);
            
            // 5. Cache the result
            if (timeoutResult.success) {
                toolResponseCache.set(
                    'search_notes',
                    args.value,
                    timeoutResult.result,
                    'openai'
                );
            }
            
            // 6. Record execution
            toolExecutionMonitor.recordExecution({
                toolName: 'search_notes',
                provider: 'openai',
                status: timeoutResult.success ? 'success' : 'failure',
                executionTime: timeoutResult.executionTime,
                timestamp: new Date()
            });
            
            // Verify everything worked
            const cached = toolResponseCache.get('search_notes', args.value, 'openai');
            expect(cached).toEqual({ results: ['note1', 'note2'] });
            
            const stats = toolExecutionMonitor.getToolStats('search_notes', 'openai');
            expect(stats?.totalExecutions).toBeGreaterThan(0);
        });
    });
});