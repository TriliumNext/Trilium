/**
 * Provider Performance Benchmarks
 * 
 * Performance benchmark suite for AI service providers
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { performance } from 'perf_hooks';
import { ProviderFactory, ProviderType } from '../provider_factory.js';
import { 
    MockProviderFactory,
    createMockProvider 
} from './mock_providers.js';
import {
    StreamAggregator,
    createStreamHandler
} from '../unified_stream_handler.js';
import type { AIService, Message } from '../../ai_interface.js';

// Mock providers
vi.mock('../openai_service.js');
vi.mock('../anthropic_service.js');
vi.mock('../ollama_service.js');

import { OpenAIService } from '../openai_service.js';
import { AnthropicService } from '../anthropic_service.js';
import { OllamaService } from '../ollama_service.js';

/**
 * Performance metrics interface
 */
interface PerformanceMetrics {
    operation: string;
    provider: string;
    duration: number;
    throughput?: number;
    latency?: number;
    memoryUsed?: number;
}

/**
 * Benchmark runner class
 */
class BenchmarkRunner {
    private metrics: PerformanceMetrics[] = [];

    async runBenchmark(
        name: string,
        provider: string,
        fn: () => Promise<void>,
        iterations: number = 100
    ): Promise<PerformanceMetrics> {
        const startMemory = process.memoryUsage().heapUsed;
        const startTime = performance.now();

        for (let i = 0; i < iterations; i++) {
            await fn();
        }

        const endTime = performance.now();
        const endMemory = process.memoryUsage().heapUsed;

        const metrics: PerformanceMetrics = {
            operation: name,
            provider,
            duration: endTime - startTime,
            throughput: iterations / ((endTime - startTime) / 1000),
            latency: (endTime - startTime) / iterations,
            memoryUsed: endMemory - startMemory
        };

        this.metrics.push(metrics);
        return metrics;
    }

    getMetrics(): PerformanceMetrics[] {
        return [...this.metrics];
    }

    printSummary(): void {
        console.table(this.metrics.map(m => ({
            Operation: m.operation,
            Provider: m.provider,
            'Avg Latency (ms)': m.latency?.toFixed(2),
            'Throughput (ops/s)': m.throughput?.toFixed(2),
            'Memory (MB)': ((m.memoryUsed || 0) / 1024 / 1024).toFixed(2)
        })));
    }

    reset(): void {
        this.metrics = [];
    }
}

describe('Provider Performance Benchmarks', () => {
    let factory: ProviderFactory;
    let mockFactory: MockProviderFactory;
    let runner: BenchmarkRunner;

    beforeEach(() => {
        // Clear singleton
        const existing = ProviderFactory.getInstance();
        if (existing) {
            existing.dispose();
        }

        factory = new ProviderFactory({
            enableHealthChecks: false,
            enableMetrics: false,
            enableCaching: true,
            cacheTimeout: 60000
        });

        mockFactory = new MockProviderFactory();
        runner = new BenchmarkRunner();
    });

    afterEach(() => {
        factory.dispose();
        mockFactory.disposeAll();
        vi.clearAllMocks();
    });

    describe('Provider Creation Performance', () => {
        it('should benchmark provider creation speed', async () => {
            const providers = ['openai', 'anthropic', 'ollama'] as const;
            
            for (const providerName of providers) {
                const mock = createMockProvider('success');
                mock.setResponseDelay(0); // No delay for creation benchmarks
                
                switch (providerName) {
                    case 'openai':
                        (OpenAIService as any).mockImplementation(() => mock);
                        break;
                    case 'anthropic':
                        (AnthropicService as any).mockImplementation(() => mock);
                        break;
                    case 'ollama':
                        (OllamaService as any).mockImplementation(() => mock);
                        break;
                }

                const metrics = await runner.runBenchmark(
                    'Provider Creation',
                    providerName,
                    async () => {
                        const provider = await factory.createProvider(
                            ProviderType[providerName.toUpperCase() as keyof typeof ProviderType]
                        );
                    },
                    100
                );

                expect(metrics.latency).toBeLessThan(10); // Should be fast (< 10ms per creation)
                expect(metrics.throughput).toBeGreaterThan(100); // > 100 ops/sec
            }

            if (process.env.SHOW_BENCHMARKS) {
                runner.printSummary();
            }
        });

        it('should benchmark cached vs uncached provider creation', async () => {
            const mock = createMockProvider('success');
            (OpenAIService as any).mockImplementation(() => mock);

            // Benchmark uncached (first creation)
            const uncachedFactory = new ProviderFactory({
                enableCaching: false,
                enableHealthChecks: false
            });

            const uncachedMetrics = await runner.runBenchmark(
                'Uncached Creation',
                'openai',
                async () => {
                    await uncachedFactory.createProvider(ProviderType.OPENAI);
                },
                50
            );

            // Benchmark cached
            runner.reset();
            const cachedMetrics = await runner.runBenchmark(
                'Cached Creation',
                'openai',
                async () => {
                    await factory.createProvider(ProviderType.OPENAI);
                },
                50
            );

            // Cached should be significantly faster
            expect(cachedMetrics.latency).toBeLessThan(uncachedMetrics.latency! * 0.5);
            
            uncachedFactory.dispose();
        });
    });

    describe('Chat Completion Performance', () => {
        it('should benchmark chat completion latency', async () => {
            const messages: Message[] = [
                { role: 'user', content: 'Hello, how are you?' }
            ];

            const providers = ['openai', 'anthropic', 'ollama'] as const;
            
            for (const providerName of providers) {
                const mock = createMockProvider('success');
                mock.setResponseDelay(10); // Simulate 10ms response time
                
                switch (providerName) {
                    case 'openai':
                        (OpenAIService as any).mockImplementation(() => mock);
                        break;
                    case 'anthropic':
                        (AnthropicService as any).mockImplementation(() => mock);
                        break;
                    case 'ollama':
                        (OllamaService as any).mockImplementation(() => mock);
                        break;
                }

                const provider = await factory.createProvider(
                    ProviderType[providerName.toUpperCase() as keyof typeof ProviderType]
                );

                const metrics = await runner.runBenchmark(
                    'Chat Completion',
                    providerName,
                    async () => {
                        await provider.generateChatCompletion(messages);
                    },
                    20
                );

                expect(metrics.latency).toBeGreaterThan(10); // At least the mock delay
                expect(metrics.latency).toBeLessThan(50); // But not too slow
            }

            if (process.env.SHOW_BENCHMARKS) {
                runner.printSummary();
            }
        });

        it('should benchmark streaming vs non-streaming performance', async () => {
            const mock = mockFactory.createProvider('openai');
            mock.setResponseDelay(50);
            (OpenAIService as any).mockImplementation(() => mock);

            const provider = await factory.createProvider(ProviderType.OPENAI);
            const messages: Message[] = [
                { role: 'user', content: 'Tell me a story' }
            ];

            // Benchmark non-streaming
            const nonStreamMetrics = await runner.runBenchmark(
                'Non-Streaming',
                'openai',
                async () => {
                    await provider.generateChatCompletion(messages, {
                        stream: false
                    });
                },
                10
            );

            // Benchmark streaming
            runner.reset();
            const streamMetrics = await runner.runBenchmark(
                'Streaming',
                'openai',
                async () => {
                    const chunks: string[] = [];
                    await provider.generateChatCompletion(messages, {
                        stream: true,
                        streamCallback: async (chunk) => {
                            chunks.push(chunk);
                        }
                    });
                },
                10
            );

            // Streaming might have different characteristics
            expect(streamMetrics.latency).toBeDefined();
            expect(nonStreamMetrics.latency).toBeDefined();
        });
    });

    describe('Concurrent Operations Performance', () => {
        it('should benchmark concurrent provider operations', async () => {
            const mock = createMockProvider('success');
            mock.setResponseDelay(5);
            (OpenAIService as any).mockImplementation(() => mock);

            const provider = await factory.createProvider(ProviderType.OPENAI);
            const messages: Message[] = [
                { role: 'user', content: 'Test' }
            ];

            // Sequential benchmark
            const sequentialStart = performance.now();
            for (let i = 0; i < 10; i++) {
                await provider.generateChatCompletion(messages);
            }
            const sequentialDuration = performance.now() - sequentialStart;

            // Concurrent benchmark
            const concurrentStart = performance.now();
            await Promise.all(
                Array(10).fill(null).map(() => 
                    provider.generateChatCompletion(messages)
                )
            );
            const concurrentDuration = performance.now() - concurrentStart;

            // Concurrent should be faster
            expect(concurrentDuration).toBeLessThan(sequentialDuration);
            
            const speedup = sequentialDuration / concurrentDuration;
            expect(speedup).toBeGreaterThan(1.5); // At least 1.5x speedup
        });
    });

    describe('Memory Performance', () => {
        it('should benchmark memory usage with cache management', async () => {
            const mock = createMockProvider('success');
            (OpenAIService as any).mockImplementation(() => mock);
            (AnthropicService as any).mockImplementation(() => mock);
            (OllamaService as any).mockImplementation(() => mock);

            const startMemory = process.memoryUsage().heapUsed;

            // Create many providers
            for (let i = 0; i < 100; i++) {
                await factory.createProvider(ProviderType.OPENAI);
                await factory.createProvider(ProviderType.ANTHROPIC);
                await factory.createProvider(ProviderType.OLLAMA);
            }

            const midMemory = process.memoryUsage().heapUsed;
            const memoryGrowth = midMemory - startMemory;

            // Clear cache
            factory.clearCache();

            const endMemory = process.memoryUsage().heapUsed;
            const memoryReclaimed = midMemory - endMemory;

            // Should reclaim some memory
            expect(memoryReclaimed).toBeGreaterThan(0);
            
            // Memory growth should be reasonable (< 50MB for 300 operations)
            expect(memoryGrowth).toBeLessThan(50 * 1024 * 1024);
        });
    });

    describe('Stream Processing Performance', () => {
        it('should benchmark stream chunk processing speed', async () => {
            const aggregator = new StreamAggregator();
            const handler = createStreamHandler({
                provider: 'openai',
                onChunk: (chunk) => aggregator.addChunk(chunk)
            });

            const chunks = Array(100).fill(null).map((_, i) => ({
                choices: [{
                    delta: { content: `Chunk ${i}` },
                    index: 0
                }]
            }));

            const metrics = await runner.runBenchmark(
                'Stream Processing',
                'openai',
                async () => {
                    aggregator.reset();
                    for (const chunk of chunks) {
                        await handler.processChunk(chunk);
                    }
                },
                10
            );

            // Should process chunks quickly
            const chunksPerSecond = (chunks.length * 10) / (metrics.duration / 1000);
            expect(chunksPerSecond).toBeGreaterThan(1000); // > 1000 chunks/sec
        });
    });

    describe('Health Check Performance', () => {
        it('should benchmark health check operations', async () => {
            const providers = [ProviderType.OPENAI, ProviderType.ANTHROPIC, ProviderType.OLLAMA];
            
            for (const providerType of providers) {
                const mock = createMockProvider('success');
                mock.setResponseDelay(20); // Simulate network latency
                
                switch (providerType) {
                    case ProviderType.OPENAI:
                        (OpenAIService as any).mockImplementation(() => mock);
                        break;
                    case ProviderType.ANTHROPIC:
                        (AnthropicService as any).mockImplementation(() => mock);
                        break;
                    case ProviderType.OLLAMA:
                        (OllamaService as any).mockImplementation(() => mock);
                        break;
                }

                const metrics = await runner.runBenchmark(
                    'Health Check',
                    providerType,
                    async () => {
                        await factory.checkProviderHealth(providerType);
                    },
                    10
                );

                // Health checks should complete reasonably quickly
                expect(metrics.latency).toBeLessThan(100); // < 100ms per check
            }
        });
    });

    describe('Fallback Performance', () => {
        it('should benchmark fallback provider switching', async () => {
            const fallbackFactory = new ProviderFactory({
                enableHealthChecks: false,
                enableFallback: true,
                fallbackProviders: [ProviderType.ANTHROPIC, ProviderType.OLLAMA],
                enableCaching: false
            });

            let attemptCount = 0;
            
            // OpenAI fails first 2 times
            (OpenAIService as any).mockImplementation(() => {
                attemptCount++;
                if (attemptCount <= 2) {
                    throw new Error('OpenAI unavailable');
                }
                return createMockProvider('success');
            });

            // Anthropic always fails
            (AnthropicService as any).mockImplementation(() => {
                throw new Error('Anthropic unavailable');
            });

            // Ollama succeeds
            const ollamaMock = createMockProvider('success');
            (OllamaService as any).mockImplementation(() => ollamaMock);

            const metrics = await runner.runBenchmark(
                'Fallback Switch',
                'multi',
                async () => {
                    attemptCount = 0;
                    await fallbackFactory.createProvider(ProviderType.OPENAI);
                },
                10
            );

            // Fallback should add some overhead but still be reasonable
            expect(metrics.latency).toBeLessThan(50); // < 50ms including fallback

            fallbackFactory.dispose();
        });
    });

    // Only run this in CI or when explicitly requested
    if (process.env.RUN_FULL_BENCHMARKS) {
        describe('Load Testing', () => {
            it('should handle high load scenarios', async () => {
                const mock = createMockProvider('success');
                mock.setResponseDelay(1);
                (OpenAIService as any).mockImplementation(() => mock);

                const provider = await factory.createProvider(ProviderType.OPENAI);
                const messages: Message[] = [{ role: 'user', content: 'Load test' }];

                const loadTestStart = performance.now();
                const promises = Array(1000).fill(null).map(() => 
                    provider.generateChatCompletion(messages)
                );

                await Promise.all(promises);
                const loadTestDuration = performance.now() - loadTestStart;

                const requestsPerSecond = 1000 / (loadTestDuration / 1000);
                
                // Should handle at least 100 requests per second
                expect(requestsPerSecond).toBeGreaterThan(100);
                
                console.log(`Load test: ${requestsPerSecond.toFixed(2)} requests/second`);
            });
        });
    }
});