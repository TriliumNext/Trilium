import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ContextService } from './context_service.js';
import type { ContextOptions } from './context_service.js';
import type { NoteSearchResult } from '../../interfaces/context_interfaces.js';
import type { LLMServiceInterface } from '../../interfaces/agent_tool_interfaces.js';

// Mock dependencies
vi.mock('../../../log.js', () => ({
    default: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn()
    }
}));

vi.mock('../modules/cache_manager.js', () => ({
    default: {
        get: vi.fn(),
        set: vi.fn(),
        clear: vi.fn()
    }
}));

vi.mock('./query_processor.js', () => ({
    default: {
        generateSearchQueries: vi.fn().mockResolvedValue(['search query 1', 'search query 2']),
        decomposeQuery: vi.fn().mockResolvedValue({
            subQueries: ['sub query 1', 'sub query 2'],
            thinking: 'decomposition thinking'
        })
    }
}));

vi.mock('../modules/context_formatter.js', () => ({
    default: {
        buildContextFromNotes: vi.fn().mockResolvedValue('formatted context'),
        sanitizeNoteContent: vi.fn().mockReturnValue('sanitized content')
    }
}));

vi.mock('../../ai_service_manager.js', () => ({
    default: {
        getContextExtractor: vi.fn().mockReturnValue({
            findRelevantNotes: vi.fn().mockResolvedValue([])
        })
    }
}));

vi.mock('../index.js', () => {
    class ContextExtractor {
        findRelevantNotes = vi.fn().mockResolvedValue([])
    }
    return { ContextExtractor };
});

describe('ContextService', () => {
    let service: ContextService;
    let mockLLMService: LLMServiceInterface;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new ContextService();

        mockLLMService = {
            generateChatCompletion: vi.fn().mockResolvedValue({
                content: 'Mock LLM response',
                role: 'assistant'
            })
        };
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('constructor', () => {
        it('should initialize with default state', () => {
            expect(service).toBeDefined();
            expect((service as any).initialized).toBe(false);
            expect((service as any).initPromise).toBeNull();
            expect((service as any).contextExtractor).toBeDefined();
        });
    });

    describe('initialize', () => {
        it('should initialize successfully', async () => {
            const result = await service.initialize();

            expect(result).toBeUndefined(); // initialize returns void
            expect((service as any).initialized).toBe(true);
        });

        it('should not initialize twice', async () => {
            await service.initialize();
            await service.initialize(); // Second call should be a no-op

            expect((service as any).initialized).toBe(true);
        });

        it('should handle concurrent initialization calls', async () => {
            const promises = [
                service.initialize(),
                service.initialize(),
                service.initialize()
            ];

            await Promise.all(promises);

            expect((service as any).initialized).toBe(true);
        });
    });

    describe('processQuery', () => {
        beforeEach(async () => {
            await service.initialize();
        });

        const userQuestion = 'What are the main features of the application?';

        it('should process query and return a result', async () => {
            const result = await service.processQuery(userQuestion, mockLLMService);

            expect(result).toBeDefined();
            expect(result).toHaveProperty('context');
            expect(result).toHaveProperty('sources');
            expect(result).toHaveProperty('thinking');
            expect(result).toHaveProperty('decomposedQuery');
        });

        it('should handle query with options', async () => {
            const options: ContextOptions = {
                summarizeContent: true,
                maxResults: 5
            };

            const result = await service.processQuery(userQuestion, mockLLMService, options);

            expect(result).toBeDefined();
            expect(result).toHaveProperty('context');
            expect(result).toHaveProperty('sources');
        });

        it('should handle query decomposition option', async () => {
            const options: ContextOptions = {
                useQueryDecomposition: true,
                showThinking: true
            };

            const result = await service.processQuery(userQuestion, mockLLMService, options);

            expect(result).toBeDefined();
            expect(result).toHaveProperty('thinking');
            expect(result).toHaveProperty('decomposedQuery');
        });
    });

    describe('findRelevantNotes', () => {
        beforeEach(async () => {
            await service.initialize();
        });

        it('should find relevant notes', async () => {
            const result = await service.findRelevantNotes(
                'test query',
                'context-note-123',
                {}
            );

            expect(result).toBeDefined();
            expect(Array.isArray(result)).toBe(true);
        });

        it('should handle options', async () => {
            const options = {
                maxResults: 15,
                summarize: true,
                llmService: mockLLMService
            };

            const result = await service.findRelevantNotes('test query', null, options);

            expect(result).toBeDefined();
            expect(Array.isArray(result)).toBe(true);
        });
    });

    describe('error handling', () => {
        it('should handle service operations', async () => {
            await service.initialize();

            // These operations should not throw
            const result1 = await service.processQuery('test', mockLLMService);
            const result2 = await service.findRelevantNotes('test', null, {});

            expect(result1).toBeDefined();
            expect(result2).toBeDefined();
        });
    });

    describe('performance', () => {
        beforeEach(async () => {
            await service.initialize();
        });

        it('should handle queries efficiently', async () => {
            const startTime = Date.now();
            await service.processQuery('test query', mockLLMService);
            const endTime = Date.now();

            expect(endTime - startTime).toBeLessThan(1000);
        });

        it('should handle concurrent queries', async () => {
            const queries = ['First query', 'Second query', 'Third query'];

            const promises = queries.map(query =>
                service.processQuery(query, mockLLMService)
            );

            const results = await Promise.all(promises);

            expect(results).toHaveLength(3);
            results.forEach(result => {
                expect(result).toBeDefined();
            });
        });
    });
});
