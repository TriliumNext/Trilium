import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ToolRegistry } from './tool_registry.js';
import type { ToolHandler, StandardizedToolResponse } from './tool_interfaces.js';
import { ToolResponseFormatter } from './tool_interfaces.js';

// Mock dependencies
vi.mock('../../log.js', () => ({
    default: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn()
    }
}));

describe('ToolRegistry', () => {
    let registry: ToolRegistry;

    beforeEach(() => {
        // Reset singleton instance before each test
        (ToolRegistry as any).instance = undefined;
        registry = ToolRegistry.getInstance();
        
        // Clear any existing tools
        (registry as any).tools.clear();
        
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('singleton pattern', () => {
        it('should return the same instance', () => {
            const instance1 = ToolRegistry.getInstance();
            const instance2 = ToolRegistry.getInstance();
            
            expect(instance1).toBe(instance2);
        });

        it('should create instance only once', () => {
            const instance1 = ToolRegistry.getInstance();
            const instance2 = ToolRegistry.getInstance();
            const instance3 = ToolRegistry.getInstance();
            
            expect(instance1).toBe(instance2);
            expect(instance2).toBe(instance3);
        });
    });

    describe('registerTool', () => {
        it('should register a valid tool handler with standardized response', async () => {
            const validHandler: ToolHandler = {
                definition: {
                    type: 'function',
                    function: {
                        name: 'test_tool',
                        description: 'A test tool',
                        parameters: {
                            type: 'object' as const,
                            properties: {
                                input: { type: 'string', description: 'Input parameter' }
                            },
                            required: ['input']
                        }
                    }
                },
                execute: vi.fn().mockResolvedValue('result'),
                executeStandardized: vi.fn().mockResolvedValue(
                    ToolResponseFormatter.success(
                        'test result',
                        { suggested: 'Next action available' },
                        { executionTime: 10, resourcesUsed: ['test'] }
                    )
                )
            };

            registry.registerTool(validHandler);
            
            expect(registry.getTool('test_tool')).toBe(validHandler);
            
            // Test standardized execution
            if (validHandler.executeStandardized) {
                const result = await validHandler.executeStandardized({ input: 'test' });
                expect(result.success).toBe(true);
                if (result.success) {
                    expect(result.result).toBe('test result');
                    expect(result.metadata.resourcesUsed).toContain('test');
                }
            }
        });

        it('should handle registration of multiple tools', () => {
            const tool1: ToolHandler = {
                definition: {
                    type: 'function',
                    function: {
                        name: 'tool1',
                        description: 'First tool',
                        parameters: {
                            type: 'object' as const,
                            properties: {},
                            required: []
                        }
                    }
                },
                execute: vi.fn()
            };

            const tool2: ToolHandler = {
                definition: {
                    type: 'function',
                    function: {
                        name: 'tool2', 
                        description: 'Second tool',
                        parameters: {
                            type: 'object' as const,
                            properties: {},
                            required: []
                        }
                    }
                },
                execute: vi.fn()
            };

            registry.registerTool(tool1);
            registry.registerTool(tool2);
            
            expect(registry.getTool('tool1')).toBe(tool1);
            expect(registry.getTool('tool2')).toBe(tool2);
            expect(registry.getAllTools()).toHaveLength(2);
        });

        it('should handle duplicate tool registration (overwrites)', () => {
            const handler1: ToolHandler = {
                definition: {
                    type: 'function',
                    function: {
                        name: 'duplicate_tool',
                        description: 'First version',
                        parameters: {
                            type: 'object' as const,
                            properties: {},
                            required: []
                        }
                    }
                },
                execute: vi.fn()
            };

            const handler2: ToolHandler = {
                definition: {
                    type: 'function',
                    function: {
                        name: 'duplicate_tool',
                        description: 'Second version',
                        parameters: {
                            type: 'object' as const,
                            properties: {},
                            required: []
                        }
                    }
                },
                execute: vi.fn()
            };

            registry.registerTool(handler1);
            registry.registerTool(handler2);
            
            // Should have the second handler (overwrites)
            expect(registry.getTool('duplicate_tool')).toBe(handler2);
            expect(registry.getAllTools()).toHaveLength(1);
        });
    });

    describe('getTool', () => {
        beforeEach(() => {
            const tools = [
                {
                    name: 'tool1',
                    description: 'First tool',
                    parameters: {
                        type: 'object' as const,
                        properties: {},
                        required: []
                    }
                },
                {
                    name: 'tool2',
                    description: 'Second tool',
                    parameters: {
                        type: 'object' as const,
                        properties: {},
                        required: []
                    }
                },
                {
                    name: 'tool3',
                    description: 'Third tool',
                    parameters: {
                        type: 'object' as const,
                        properties: {},
                        required: []
                    }
                }
            ];

            tools.forEach(tool => {
                const handler: ToolHandler = {
                    definition: {
                        type: 'function',
                        function: tool
                    },
                    execute: vi.fn()
                };
                registry.registerTool(handler);
            });
        });

        it('should return registered tool by name', () => {
            const tool = registry.getTool('tool1');
            expect(tool).toBeDefined();
            expect(tool?.definition.function.name).toBe('tool1');
        });

        it('should return undefined for non-existent tool', () => {
            const tool = registry.getTool('non_existent');
            expect(tool).toBeUndefined();
        });

        it('should handle case-sensitive tool names', () => {
            const tool = registry.getTool('Tool1'); // Different case
            expect(tool).toBeUndefined();
        });
    });

    describe('getAllTools', () => {
        beforeEach(() => {
            const tools = [
                {
                    name: 'tool1',
                    description: 'First tool',
                    parameters: {
                        type: 'object' as const,
                        properties: {},
                        required: []
                    }
                },
                {
                    name: 'tool2',
                    description: 'Second tool',
                    parameters: {
                        type: 'object' as const,
                        properties: {},
                        required: []
                    }
                },
                {
                    name: 'tool3',
                    description: 'Third tool',
                    parameters: {
                        type: 'object' as const,
                        properties: {},
                        required: []
                    }
                }
            ];

            tools.forEach(tool => {
                const handler: ToolHandler = {
                    definition: {
                        type: 'function',
                        function: tool
                    },
                    execute: vi.fn()
                };
                registry.registerTool(handler);
            });
        });

        it('should return all registered tools', () => {
            const tools = registry.getAllTools();
            
            expect(tools).toHaveLength(3);
            expect(tools.map(t => t.definition.function.name)).toEqual(['tool1', 'tool2', 'tool3']);
        });

        it('should return empty array when no tools registered', () => {
            (registry as any).tools.clear();
            
            const tools = registry.getAllTools();
            expect(tools).toHaveLength(0);
        });
    });

    describe('getAllToolDefinitions', () => {
        beforeEach(() => {
            const tools = [
                {
                    name: 'tool1',
                    description: 'First tool',
                    parameters: {
                        type: 'object' as const,
                        properties: {},
                        required: []
                    }
                },
                {
                    name: 'tool2',
                    description: 'Second tool',
                    parameters: {
                        type: 'object' as const,
                        properties: {},
                        required: []
                    }
                },
                {
                    name: 'tool3',
                    description: 'Third tool',
                    parameters: {
                        type: 'object' as const,
                        properties: {},
                        required: []
                    }
                }
            ];

            tools.forEach(tool => {
                const handler: ToolHandler = {
                    definition: {
                        type: 'function',
                        function: tool
                    },
                    execute: vi.fn()
                };
                registry.registerTool(handler);
            });
        });

        it('should return all tool definitions', () => {
            const definitions = registry.getAllToolDefinitions();
            
            expect(definitions).toHaveLength(3);
            expect(definitions[0]).toEqual({
                type: 'function',
                function: {
                    name: 'tool1',
                    description: 'First tool',
                    parameters: {
                        type: 'object' as const,
                        properties: {},
                        required: []
                    }
                }
            });
        });

        it('should return empty array when no tools registered', () => {
            (registry as any).tools.clear();
            
            const definitions = registry.getAllToolDefinitions();
            expect(definitions).toHaveLength(0);
        });
    });

    describe('enhanced tool registry features', () => {
        it('should handle legacy tools with standardized wrapper', async () => {
            const legacyHandler: ToolHandler = {
                definition: {
                    type: 'function',
                    function: {
                        name: 'legacy_tool',
                        description: 'Legacy tool without standardized response',
                        parameters: {
                            type: 'object' as const,
                            properties: {},
                            required: []
                        }
                    }
                },
                execute: vi.fn().mockResolvedValue('legacy result')
                // No executeStandardized method
            };

            registry.registerTool(legacyHandler);
            
            expect(registry.getTool('legacy_tool')).toBe(legacyHandler);
            
            // Test that legacy tools can still work
            const result = await legacyHandler.execute({});
            expect(result).toBe('legacy result');
        });

        it('should support tools with smart parameter processing capabilities', () => {
            const smartToolHandler: ToolHandler = {
                definition: {
                    type: 'function',
                    function: {
                        name: 'smart_search_tool',
                        description: 'Smart search tool with parameter processing',
                        parameters: {
                            type: 'object' as const,
                            properties: {
                                query: { type: 'string', description: 'Search query' },
                                noteIds: { 
                                    type: 'array', 
                                    description: 'Note IDs or titles (fuzzy matched)',
                                    items: { type: 'string' }
                                },
                                includeArchived: { 
                                    type: 'boolean', 
                                    description: 'Include archived notes',
                                    default: false
                                }
                            },
                            required: ['query']
                        }
                    }
                },
                execute: vi.fn(),
                executeStandardized: vi.fn().mockResolvedValue(
                    ToolResponseFormatter.success(
                        { notes: [], total: 0 },
                        { suggested: 'Search completed' },
                        { executionTime: 25, resourcesUsed: ['search_index', 'smart_processor'] }
                    )
                )
            };

            registry.registerTool(smartToolHandler);
            
            expect(registry.getTool('smart_search_tool')).toBe(smartToolHandler);
            
            // Verify the tool definition includes smart processing hints
            const toolDef = smartToolHandler.definition.function;
            expect(toolDef.parameters.properties.noteIds?.description).toContain('fuzzy matched');
        });

        it('should maintain backward compatibility while supporting new features', () => {
            // Register mix of old and new style tools
            const oldTool: ToolHandler = {
                definition: {
                    type: 'function',
                    function: {
                        name: 'old_tool',
                        description: 'Old style tool',
                        parameters: { type: 'object' as const, properties: {}, required: [] }
                    }
                },
                execute: vi.fn()
            };

            const newTool: ToolHandler = {
                definition: {
                    type: 'function',
                    function: {
                        name: 'new_tool',
                        description: 'New style tool',
                        parameters: { type: 'object' as const, properties: {}, required: [] }
                    }
                },
                execute: vi.fn(),
                executeStandardized: vi.fn()
            };

            registry.registerTool(oldTool);
            registry.registerTool(newTool);

            expect(registry.getAllTools()).toHaveLength(2);
            expect(registry.getTool('old_tool')?.executeStandardized).toBeUndefined();
            expect(registry.getTool('new_tool')?.executeStandardized).toBeDefined();
        });
    });

    describe('error handling', () => {
        it('should handle null/undefined tool handler gracefully', () => {
            // These should not crash the registry
            expect(() => registry.registerTool(null as any)).not.toThrow();
            expect(() => registry.registerTool(undefined as any)).not.toThrow();
            
            // Registry should still work normally
            expect(registry.getAllTools()).toHaveLength(0);
        });

        it('should handle malformed tool handler gracefully', () => {
            const malformedHandler = {
                // Missing definition
                execute: vi.fn()
            } as any;

            expect(() => registry.registerTool(malformedHandler)).not.toThrow();
            
            // Should not be registered
            expect(registry.getAllTools()).toHaveLength(0);
        });
    });

    describe('tool validation', () => {
        it('should accept tool with proper structure and enhanced execution', async () => {
            const validHandler: ToolHandler = {
                definition: {
                    type: 'function',
                    function: {
                        name: 'calculator',
                        description: 'Performs calculations with enhanced error handling',
                        parameters: {
                            type: 'object' as const,
                            properties: {
                                expression: { 
                                    type: 'string', 
                                    description: 'The mathematical expression to evaluate' 
                                }
                            },
                            required: ['expression']
                        }
                    }
                },
                execute: vi.fn().mockResolvedValue('42'),
                executeStandardized: vi.fn().mockImplementation(async (args) => {
                    if (!args.expression) {
                        return ToolResponseFormatter.error(
                            'Missing required parameter: expression',
                            {
                                possibleCauses: ['Parameter not provided'],
                                suggestions: ['Provide expression parameter']
                            }
                        );
                    }
                    return ToolResponseFormatter.success(
                        '42',
                        { suggested: 'Calculation completed successfully' },
                        { executionTime: 5, resourcesUsed: ['calculator'] }
                    );
                })
            };

            registry.registerTool(validHandler);
            
            expect(registry.getTool('calculator')).toBe(validHandler);
            expect(registry.getAllTools()).toHaveLength(1);
            
            // Test enhanced execution with missing parameter
            if (validHandler.executeStandardized) {
                const errorResult = await validHandler.executeStandardized({});
                expect(errorResult.success).toBe(false);
                if (!errorResult.success) {
                    expect(errorResult.error).toContain('Missing required parameter');
                    expect(errorResult.help.suggestions).toContain('Provide expression parameter');
                }
                
                // Test successful execution
                const successResult = await validHandler.executeStandardized({ expression: '2+2' });
                expect(successResult.success).toBe(true);
                if (successResult.success) {
                    expect(successResult.result).toBe('42');
                    expect(successResult.metadata.executionTime).toBe(5);
                }
            }
        });
    });
});