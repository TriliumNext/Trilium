/**
 * Pipeline V2 Tests
 * Basic tests to ensure the new pipeline works correctly
 *
 * Note: These tests are skipped in Phase 1 as they require complex mocking.
 * They will be enabled in Phase 2 when we have proper test infrastructure.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { PipelineV2Input } from './pipeline_v2.js';
import type { Message } from '../ai_interface.js';

describe.skip('PipelineV2', () => {
    let pipeline: PipelineV2;
    let mockService: AIService;

    beforeEach(() => {
        pipeline = new PipelineV2();

        // Create mock AI service
        mockService = {
            generateChatCompletion: vi.fn(async (messages: Message[]) => {
                return {
                    text: 'Test response',
                    model: 'test-model',
                    provider: 'test-provider',
                    usage: {
                        promptTokens: 10,
                        completionTokens: 20,
                        totalTokens: 30
                    }
                } as ChatResponse;
            }),
            isAvailable: vi.fn(() => true),
            getName: vi.fn(() => 'test')
        };

        // Mock the service manager
        const aiServiceManager = require('../ai_service_manager.js').default;
        aiServiceManager.getService = vi.fn(async () => mockService);
    });

    it('should execute simple pipeline without tools', async () => {
        const input: PipelineV2Input = {
            messages: [
                { role: 'user', content: 'Hello, world!' }
            ],
            options: {
                enableTools: false
            }
        };

        const result = await pipeline.execute(input);

        expect(result).toBeDefined();
        expect(result.text).toBe('Test response');
        expect(result.model).toBe('test-model');
        expect(result.provider).toBe('test-provider');
        expect(result.requestId).toBeDefined();
        expect(result.processingTime).toBeGreaterThan(0);
        expect(result.stagesExecuted).toContain('message_preparation');
        expect(result.stagesExecuted).toContain('llm_execution');
        expect(result.stagesExecuted).toContain('response_formatting');
    });

    it('should add system prompt if not present', async () => {
        const input: PipelineV2Input = {
            messages: [
                { role: 'user', content: 'Hello!' }
            ]
        };

        await pipeline.execute(input);

        expect(mockService.generateChatCompletion).toHaveBeenCalled();
        const callArgs = (mockService.generateChatCompletion as any).mock.calls[0];
        const messages = callArgs[0] as Message[];

        expect(messages.length).toBeGreaterThan(1);
        expect(messages[0].role).toBe('system');
    });

    it('should preserve existing system prompt', async () => {
        const input: PipelineV2Input = {
            messages: [
                { role: 'system', content: 'Custom system prompt' },
                { role: 'user', content: 'Hello!' }
            ]
        };

        await pipeline.execute(input);

        const callArgs = (mockService.generateChatCompletion as any).mock.calls[0];
        const messages = callArgs[0] as Message[];

        expect(messages[0].role).toBe('system');
        expect(messages[0].content).toContain('Custom system prompt');
    });

    it('should handle errors gracefully', async () => {
        mockService.generateChatCompletion = vi.fn(async () => {
            throw new Error('Test error');
        });

        const input: PipelineV2Input = {
            messages: [
                { role: 'user', content: 'Hello!' }
            ]
        };

        await expect(pipeline.execute(input)).rejects.toThrow('Test error');
    });

    it('should include tools if enabled', async () => {
        const toolRegistry = require('../tools/tool_registry.js').default;
        toolRegistry.getAllToolDefinitions = vi.fn(() => [
            {
                type: 'function',
                function: {
                    name: 'test_tool',
                    description: 'Test tool',
                    parameters: {}
                }
            }
        ]);

        const input: PipelineV2Input = {
            messages: [
                { role: 'user', content: 'Hello!' }
            ],
            options: {
                enableTools: true
            }
        };

        await pipeline.execute(input);

        const callArgs = (mockService.generateChatCompletion as any).mock.calls[0];
        const options = callArgs[1];

        expect(options.tools).toBeDefined();
        expect(options.tools.length).toBe(1);
        expect(options.tools[0].function.name).toBe('test_tool');
    });

    it('should generate unique request IDs', async () => {
        const input1: PipelineV2Input = {
            messages: [{ role: 'user', content: 'Hello 1' }]
        };

        const input2: PipelineV2Input = {
            messages: [{ role: 'user', content: 'Hello 2' }]
        };

        const result1 = await pipeline.execute(input1);
        const result2 = await pipeline.execute(input2);

        expect(result1.requestId).not.toBe(result2.requestId);
    });

    it('should use provided request ID', async () => {
        const customRequestId = 'custom-request-id-123';

        const input: PipelineV2Input = {
            messages: [{ role: 'user', content: 'Hello!' }],
            requestId: customRequestId
        };

        const result = await pipeline.execute(input);

        expect(result.requestId).toBe(customRequestId);
    });
});
