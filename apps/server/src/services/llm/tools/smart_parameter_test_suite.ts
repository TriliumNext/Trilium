/**
 * Smart Parameter Processing Test Suite
 *
 * This module provides comprehensive testing for smart parameter processing
 * with realistic LLM mistake patterns and edge cases.
 * 
 * Features:
 * - Common LLM mistake simulation
 * - Auto-correction validation
 * - Performance benchmarking
 * - Edge case handling
 * - Real-world scenario testing
 */

import { SmartParameterProcessor, type ProcessingContext } from './smart_parameter_processor.js';
import { SmartErrorRecovery } from './smart_error_recovery.js';
import { ToolResponseFormatter } from './tool_interfaces.js';
import log from '../../log.js';

/**
 * Test case for parameter processing
 */
interface TestCase {
    name: string;
    description: string;
    toolName: string;
    toolDefinition: any;
    inputParams: Record<string, any>;
    expectedCorrections: string[];
    shouldSucceed: boolean;
    expectedOutputParams?: Record<string, any>;
    context?: ProcessingContext;
}

/**
 * Test result for analysis
 */
interface TestResult {
    testName: string;
    passed: boolean;
    actualCorrections: string[];
    expectedCorrections: string[];
    processingTime: number;
    error?: string;
    suggestions: string[];
}

/**
 * Smart Parameter Test Suite
 */
export class SmartParameterTestSuite {
    private processor: SmartParameterProcessor;
    private errorRecovery: SmartErrorRecovery;
    private testResults: TestResult[] = [];

    constructor() {
        this.processor = new SmartParameterProcessor();
        this.errorRecovery = new SmartErrorRecovery();
    }

    /**
     * Run comprehensive test suite
     */
    async runFullTestSuite(): Promise<{
        totalTests: number;
        passedTests: number;
        failedTests: number;
        results: TestResult[];
        summary: {
            averageProcessingTime: number;
            topCorrections: Array<{ correction: string; count: number }>;
            testCategories: Record<string, { passed: number; total: number }>;
        };
    }> {
        log.info('Running Smart Parameter Processing Test Suite...');
        const startTime = Date.now();

        // Clear previous results
        this.testResults = [];
        this.processor.clearCaches();
        this.errorRecovery.clearHistory();

        // Define test cases
        const testCases = [
            ...this.getNoteIdResolutionTests(),
            ...this.getTypeCoercionTests(),
            ...this.getFuzzyMatchingTests(),
            ...this.getContextAwareTests(),
            ...this.getEdgeCaseTests(),
            ...this.getRealWorldScenarioTests()
        ];

        // Run all tests
        for (const testCase of testCases) {
            const result = await this.runSingleTest(testCase);
            this.testResults.push(result);
        }

        const totalTime = Date.now() - startTime;
        const passedTests = this.testResults.filter(r => r.passed).length;
        const failedTests = this.testResults.length - passedTests;

        // Generate summary
        const summary = this.generateTestSummary();

        log.info(`Test suite completed in ${totalTime}ms: ${passedTests}/${this.testResults.length} tests passed`);

        return {
            totalTests: this.testResults.length,
            passedTests,
            failedTests,
            results: this.testResults,
            summary
        };
    }

    /**
     * Note ID resolution test cases
     */
    private getNoteIdResolutionTests(): TestCase[] {
        return [
            {
                name: 'note_title_to_id',
                description: 'Convert note title to noteId using search',
                toolName: 'read_note',
                toolDefinition: {
                    function: {
                        parameters: {
                            properties: {
                                noteId: { type: 'string', description: 'Note ID to read' }
                            },
                            required: ['noteId']
                        }
                    }
                },
                inputParams: { noteId: 'My Project Notes' },
                expectedCorrections: ['note_resolution'],
                shouldSucceed: true,
                context: { toolName: 'read_note' }
            },
            {
                name: 'invalid_noteid_format',
                description: 'Fix obviously invalid noteId format',
                toolName: 'read_note',
                toolDefinition: {
                    function: {
                        parameters: {
                            properties: {
                                noteId: { type: 'string', description: 'Note ID to read' }
                            },
                            required: ['noteId']
                        }
                    }
                },
                inputParams: { noteId: 'note with spaces' },
                expectedCorrections: ['note_resolution'],
                shouldSucceed: true,
                context: { toolName: 'read_note' }
            },
            {
                name: 'empty_noteid',
                description: 'Handle empty noteId with context guessing',
                toolName: 'read_note',
                toolDefinition: {
                    function: {
                        parameters: {
                            properties: {
                                noteId: { type: 'string', description: 'Note ID to read' }
                            },
                            required: ['noteId']
                        }
                    }
                },
                inputParams: {},
                expectedCorrections: ['context_guess'],
                shouldSucceed: true,
                context: { 
                    toolName: 'read_note',
                    currentNoteId: 'current_note_123'
                }
            }
        ];
    }

    /**
     * Type coercion test cases
     */
    private getTypeCoercionTests(): TestCase[] {
        return [
            {
                name: 'string_to_number',
                description: 'Convert string numbers to actual numbers',
                toolName: 'search_notes',
                toolDefinition: {
                    function: {
                        parameters: {
                            properties: {
                                maxResults: { type: 'number', description: 'Maximum results' }
                            }
                        }
                    }
                },
                inputParams: { maxResults: '10' },
                expectedCorrections: ['type_coercion'],
                shouldSucceed: true,
                expectedOutputParams: { maxResults: 10 },
                context: { toolName: 'search_notes' }
            },
            {
                name: 'string_to_boolean',
                description: 'Convert string booleans to actual booleans',
                toolName: 'search_notes',
                toolDefinition: {
                    function: {
                        parameters: {
                            properties: {
                                summarize: { type: 'boolean', description: 'Summarize results' }
                            }
                        }
                    }
                },
                inputParams: { summarize: 'true' },
                expectedCorrections: ['type_coercion'],
                shouldSucceed: true,
                expectedOutputParams: { summarize: true },
                context: { toolName: 'search_notes' }
            },
            {
                name: 'comma_separated_to_array',
                description: 'Convert comma-separated string to array',
                toolName: 'manage_attributes',
                toolDefinition: {
                    function: {
                        parameters: {
                            properties: {
                                tags: { type: 'array', description: 'List of tags' }
                            }
                        }
                    }
                },
                inputParams: { tags: 'important,work,project' },
                expectedCorrections: ['type_coercion'],
                shouldSucceed: true,
                expectedOutputParams: { tags: ['important', 'work', 'project'] },
                context: { toolName: 'manage_attributes' }
            },
            {
                name: 'json_string_to_object',
                description: 'Parse JSON string to object',
                toolName: 'create_note',
                toolDefinition: {
                    function: {
                        parameters: {
                            properties: {
                                metadata: { type: 'object', description: 'Note metadata' }
                            }
                        }
                    }
                },
                inputParams: { metadata: '{"priority": "high", "status": "active"}' },
                expectedCorrections: ['type_coercion'],
                shouldSucceed: true,
                expectedOutputParams: { metadata: { priority: 'high', status: 'active' } },
                context: { toolName: 'create_note' }
            }
        ];
    }

    /**
     * Fuzzy matching test cases
     */
    private getFuzzyMatchingTests(): TestCase[] {
        return [
            {
                name: 'fuzzy_enum_match',
                description: 'Fix typos in enum values',
                toolName: 'manage_attributes',
                toolDefinition: {
                    function: {
                        parameters: {
                            properties: {
                                action: { 
                                    type: 'string', 
                                    enum: ['add', 'remove', 'update'],
                                    description: 'Action to perform' 
                                }
                            }
                        }
                    }
                },
                inputParams: { action: 'upate' }, // typo: 'upate' -> 'update'
                expectedCorrections: ['fuzzy_match'],
                shouldSucceed: true,
                expectedOutputParams: { action: 'update' },
                context: { toolName: 'manage_attributes' }
            },
            {
                name: 'case_insensitive_enum',
                description: 'Fix case issues in enum values',
                toolName: 'manage_attributes',
                toolDefinition: {
                    function: {
                        parameters: {
                            properties: {
                                action: { 
                                    type: 'string', 
                                    enum: ['add', 'remove', 'update'],
                                    description: 'Action to perform' 
                                }
                            }
                        }
                    }
                },
                inputParams: { action: 'ADD' },
                expectedCorrections: ['fuzzy_match'],
                shouldSucceed: true,
                expectedOutputParams: { action: 'add' },
                context: { toolName: 'manage_attributes' }
            },
            {
                name: 'similar_parameter_name',
                description: 'Suggest similar parameter names for typos',
                toolName: 'search_notes',
                toolDefinition: {
                    function: {
                        parameters: {
                            properties: {
                                maxResults: { type: 'number', description: 'Maximum results' },
                                query: { type: 'string', description: 'Search query' }
                            }
                        }
                    }
                },
                inputParams: { 
                    query: 'test search',
                    maxResuts: 5 // typo: 'maxResuts' -> 'maxResults'
                },
                expectedCorrections: [],
                shouldSucceed: true, // Should succeed with suggestions
                context: { toolName: 'search_notes' }
            }
        ];
    }

    /**
     * Context-aware test cases
     */
    private getContextAwareTests(): TestCase[] {
        return [
            {
                name: 'context_parent_note',
                description: 'Guess parentNoteId from context',
                toolName: 'create_note',
                toolDefinition: {
                    function: {
                        parameters: {
                            properties: {
                                title: { type: 'string', description: 'Note title' },
                                content: { type: 'string', description: 'Note content' },
                                parentNoteId: { type: 'string', description: 'Parent note ID' }
                            },
                            required: ['title', 'content']
                        }
                    }
                },
                inputParams: { 
                    title: 'New Note',
                    content: 'Note content'
                },
                expectedCorrections: [],
                shouldSucceed: true,
                context: { 
                    toolName: 'create_note',
                    currentNoteId: 'current_context_note'
                }
            },
            {
                name: 'context_default_values',
                description: 'Use context defaults for missing optional parameters',
                toolName: 'search_notes',
                toolDefinition: {
                    function: {
                        parameters: {
                            properties: {
                                query: { type: 'string', description: 'Search query' },
                                maxResults: { type: 'number', description: 'Maximum results', default: 10 }
                            },
                            required: ['query']
                        }
                    }
                },
                inputParams: { query: 'search term' },
                expectedCorrections: [],
                shouldSucceed: true,
                context: { toolName: 'search_notes' }
            }
        ];
    }

    /**
     * Edge case test cases
     */
    private getEdgeCaseTests(): TestCase[] {
        return [
            {
                name: 'null_and_undefined',
                description: 'Handle null and undefined values gracefully',
                toolName: 'create_note',
                toolDefinition: {
                    function: {
                        parameters: {
                            properties: {
                                title: { type: 'string', description: 'Note title' },
                                content: { type: 'string', description: 'Note content' }
                            },
                            required: ['title']
                        }
                    }
                },
                inputParams: { 
                    title: 'Valid Title',
                    content: null
                },
                expectedCorrections: ['type_coercion'],
                shouldSucceed: true,
                context: { toolName: 'create_note' }
            },
            {
                name: 'extreme_string_lengths',
                description: 'Handle very long strings appropriately',
                toolName: 'search_notes',
                toolDefinition: {
                    function: {
                        parameters: {
                            properties: {
                                query: { type: 'string', description: 'Search query' }
                            },
                            required: ['query']
                        }
                    }
                },
                inputParams: { 
                    query: 'a'.repeat(1000) // Very long string
                },
                expectedCorrections: [],
                shouldSucceed: true,
                context: { toolName: 'search_notes' }
            },
            {
                name: 'numeric_edge_cases',
                description: 'Handle numeric edge cases (zero, negative, float)',
                toolName: 'search_notes',
                toolDefinition: {
                    function: {
                        parameters: {
                            properties: {
                                maxResults: { type: 'number', minimum: 1, maximum: 20 }
                            }
                        }
                    }
                },
                inputParams: { maxResults: '-5' },
                expectedCorrections: ['type_coercion'],
                shouldSucceed: true,
                expectedOutputParams: { maxResults: 1 }, // Should clamp to minimum
                context: { toolName: 'search_notes' }
            }
        ];
    }

    /**
     * Real-world scenario test cases
     */
    private getRealWorldScenarioTests(): TestCase[] {
        return [
            {
                name: 'realistic_llm_mistake_1',
                description: 'LLM uses note title instead of ID and provides string numbers',
                toolName: 'read_note',
                toolDefinition: {
                    function: {
                        parameters: {
                            properties: {
                                noteId: { type: 'string', description: 'Note ID' },
                                maxLength: { type: 'number', description: 'Max content length' }
                            },
                            required: ['noteId']
                        }
                    }
                },
                inputParams: { 
                    noteId: 'Project Planning Document',
                    maxLength: '500'
                },
                expectedCorrections: ['note_resolution', 'type_coercion'],
                shouldSucceed: true,
                context: { toolName: 'read_note' }
            },
            {
                name: 'realistic_llm_mistake_2',
                description: 'LLM provides array as comma-separated string with boolean as string',
                toolName: 'manage_attributes',
                toolDefinition: {
                    function: {
                        parameters: {
                            properties: {
                                noteId: { type: 'string', description: 'Note ID' },
                                tags: { type: 'array', description: 'Tags to add' },
                                overwrite: { type: 'boolean', description: 'Overwrite existing' }
                            },
                            required: ['noteId']
                        }
                    }
                },
                inputParams: { 
                    noteId: 'valid_note_id_123',
                    tags: 'important,urgent,work',
                    overwrite: 'false'
                },
                expectedCorrections: ['type_coercion', 'type_coercion'],
                shouldSucceed: true,
                expectedOutputParams: { 
                    noteId: 'valid_note_id_123',
                    tags: ['important', 'urgent', 'work'],
                    overwrite: false
                },
                context: { toolName: 'manage_attributes' }
            },
            {
                name: 'realistic_llm_mistake_3',
                description: 'Multiple typos and format issues in single request',
                toolName: 'create_note',
                toolDefinition: {
                    function: {
                        parameters: {
                            properties: {
                                title: { type: 'string', description: 'Note title' },
                                content: { type: 'string', description: 'Note content' },
                                parentNoteId: { type: 'string', description: 'Parent note ID' },
                                isTemplate: { type: 'boolean', description: 'Is template' },
                                priority: { type: 'string', enum: ['low', 'medium', 'high'] }
                            },
                            required: ['title', 'content']
                        }
                    }
                },
                inputParams: { 
                    title: 'New Task Note',
                    content: 'Task description content',
                    parentNoteId: 'Tasks Folder', // Should be resolved to noteId
                    isTemplate: 'no', // Should be coerced to false
                    priority: 'hgh' // Typo: should be 'high'
                },
                expectedCorrections: ['note_resolution', 'type_coercion', 'fuzzy_match'],
                shouldSucceed: true,
                expectedOutputParams: {
                    title: 'New Task Note',
                    content: 'Task description content',
                    isTemplate: false,
                    priority: 'high'
                },
                context: { toolName: 'create_note' }
            }
        ];
    }

    /**
     * Run a single test case
     */
    private async runSingleTest(testCase: TestCase): Promise<TestResult> {
        const startTime = Date.now();
        log.info(`Running test: ${testCase.name}`);

        try {
            const result = await this.processor.processParameters(
                testCase.inputParams,
                testCase.toolDefinition,
                testCase.context || { toolName: testCase.toolName }
            );

            const processingTime = Date.now() - startTime;
            const actualCorrections = result.corrections.map(c => c.correctionType);
            
            // Check if test passed
            const correctionsMatch = this.arraysMatch(actualCorrections, testCase.expectedCorrections);
            const outputMatches = !testCase.expectedOutputParams || 
                this.objectsMatch(result.processedParams, testCase.expectedOutputParams);
            
            const passed = result.success === testCase.shouldSucceed && 
                          (testCase.expectedCorrections.length === 0 || correctionsMatch) &&
                          outputMatches;

            return {
                testName: testCase.name,
                passed,
                actualCorrections,
                expectedCorrections: testCase.expectedCorrections,
                processingTime,
                suggestions: result.suggestions
            };

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                testName: testCase.name,
                passed: false,
                actualCorrections: [],
                expectedCorrections: testCase.expectedCorrections,
                processingTime: Date.now() - startTime,
                error: errorMessage,
                suggestions: []
            };
        }
    }

    /**
     * Check if arrays contain the same elements (order doesn't matter)
     */
    private arraysMatch(actual: string[], expected: string[]): boolean {
        if (actual.length !== expected.length) return false;
        
        const expectedSet = new Set(expected);
        return actual.every(item => expectedSet.has(item));
    }

    /**
     * Check if objects match (deep comparison for expected properties)
     */
    private objectsMatch(actual: any, expected: any): boolean {
        for (const key in expected) {
            if (actual[key] !== expected[key]) {
                // Handle array comparison
                if (Array.isArray(expected[key]) && Array.isArray(actual[key])) {
                    if (!this.arraysMatch(actual[key], expected[key])) {
                        return false;
                    }
                } else if (typeof expected[key] === 'object' && typeof actual[key] === 'object') {
                    if (!this.objectsMatch(actual[key], expected[key])) {
                        return false;
                    }
                } else {
                    return false;
                }
            }
        }
        return true;
    }

    /**
     * Generate test summary with statistics
     */
    private generateTestSummary(): {
        averageProcessingTime: number;
        topCorrections: Array<{ correction: string; count: number }>;
        testCategories: Record<string, { passed: number; total: number }>;
    } {
        const totalTime = this.testResults.reduce((sum, r) => sum + r.processingTime, 0);
        const averageProcessingTime = totalTime / this.testResults.length;

        // Count corrections
        const correctionCounts = new Map<string, number>();
        this.testResults.forEach(result => {
            result.actualCorrections.forEach(correction => {
                correctionCounts.set(correction, (correctionCounts.get(correction) || 0) + 1);
            });
        });

        const topCorrections = Array.from(correctionCounts.entries())
            .map(([correction, count]) => ({ correction, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);

        // Categorize tests
        const testCategories: Record<string, { passed: number; total: number }> = {};
        this.testResults.forEach(result => {
            const category = result.testName.split('_')[0]; // First part of test name
            if (!testCategories[category]) {
                testCategories[category] = { passed: 0, total: 0 };
            }
            testCategories[category].total++;
            if (result.passed) {
                testCategories[category].passed++;
            }
        });

        return {
            averageProcessingTime: Math.round(averageProcessingTime * 100) / 100,
            topCorrections,
            testCategories
        };
    }

    /**
     * Get detailed test report
     */
    getDetailedReport(): string {
        const summary = this.generateTestSummary();
        const passedTests = this.testResults.filter(r => r.passed).length;
        const failedTests = this.testResults.length - passedTests;

        let report = `
# Smart Parameter Processing Test Report

## Summary
- Total Tests: ${this.testResults.length}
- Passed: ${passedTests}
- Failed: ${failedTests}
- Success Rate: ${Math.round((passedTests / this.testResults.length) * 100)}%
- Average Processing Time: ${summary.averageProcessingTime}ms

## Top Corrections Applied
${summary.topCorrections.map(c => `- ${c.correction}: ${c.count} times`).join('\n')}

## Test Categories
${Object.entries(summary.testCategories)
  .map(([category, stats]) => 
    `- ${category}: ${stats.passed}/${stats.total} passed (${Math.round((stats.passed / stats.total) * 100)}%)`
  ).join('\n')}

## Failed Tests
${this.testResults
  .filter(r => !r.passed)
  .map(r => `- ${r.testName}: ${r.error || 'Assertion failed'}`)
  .join('\n')}

## Detailed Results
${this.testResults.map(r => `
### ${r.testName}
- Status: ${r.passed ? '✅ PASSED' : '❌ FAILED'}
- Processing Time: ${r.processingTime}ms
- Corrections: ${r.actualCorrections.join(', ') || 'None'}
- Expected: ${r.expectedCorrections.join(', ') || 'None'}
${r.error ? `- Error: ${r.error}` : ''}
${r.suggestions.length > 0 ? `- Suggestions: ${r.suggestions.slice(0, 3).join('; ')}` : ''}
`).join('')}
`;

        return report;
    }

    /**
     * Clear all test results
     */
    clearResults(): void {
        this.testResults = [];
        this.processor.clearCaches();
        this.errorRecovery.clearHistory();
    }
}

/**
 * Global test suite instance
 */
export const smartParameterTestSuite = new SmartParameterTestSuite();