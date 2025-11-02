import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SmartSearchTool } from './smart_search_tool.js';

// Mock dependencies
vi.mock('../../../log.js', () => ({
    default: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn()
    }
}));

vi.mock('../../ai_service_manager.js', () => ({
    default: {
        getVectorSearchTool: vi.fn(),
        getAgentTools: vi.fn()
    }
}));

vi.mock('../../../../becca/becca.js', () => ({
    default: {
        getNote: vi.fn(),
        notes: {}
    }
}));

vi.mock('../../../search/services/search.js', () => ({
    default: {
        searchNotes: vi.fn()
    }
}));

vi.mock('../../../attributes.js', () => ({
    default: {
        getNotesWithLabel: vi.fn()
    }
}));

vi.mock('../../../attribute_formatter.js', () => ({
    default: {
        formatAttrForSearch: vi.fn()
    }
}));

vi.mock('../../context/index.js', () => ({
    ContextExtractor: vi.fn().mockImplementation(() => ({
        getNoteContent: vi.fn().mockResolvedValue('Sample note content')
    }))
}));

describe('SmartSearchTool', () => {
    let tool: SmartSearchTool;

    beforeEach(() => {
        tool = new SmartSearchTool();
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('tool definition', () => {
        it('should have correct tool definition structure', () => {
            expect(tool.definition).toBeDefined();
            expect(tool.definition.type).toBe('function');
            expect(tool.definition.function.name).toBe('smart_search');
            expect(tool.definition.function.description).toBeTruthy();
            expect(tool.definition.function.parameters).toBeDefined();
        });

        it('should have required query parameter', () => {
            expect(tool.definition.function.parameters.required).toContain('query');
        });

        it('should have optional search_method parameter with enum', () => {
            const searchMethod = tool.definition.function.parameters.properties.search_method;
            expect(searchMethod).toBeDefined();
            expect(searchMethod.enum).toEqual(['auto', 'semantic', 'keyword', 'attribute']);
        });

        it('should have sensible parameter defaults documented', () => {
            const maxResults = tool.definition.function.parameters.properties.max_results;
            expect(maxResults.description).toContain('10');
        });
    });

    describe('search method detection', () => {
        it('should detect attribute syntax with #', async () => {
            const attributes = await import('../../../attributes.js');
            vi.mocked(attributes.default.getNotesWithLabel).mockReturnValue([]);

            const result = await tool.execute({
                query: '#important',
                search_method: 'auto'
            }) as any;

            expect(result.search_method).toBe('attribute');
        });

        it('should detect attribute syntax with ~', async () => {
            const searchService = await import('../../../search/services/search.js');
            const attributeFormatter = await import('../../../attribute_formatter.js');
            vi.mocked(attributeFormatter.default.formatAttrForSearch).mockReturnValue('~related');
            vi.mocked(searchService.default.searchNotes).mockReturnValue([]);

            const result = await tool.execute({
                query: '~related',
                search_method: 'auto'
            }) as any;

            expect(result.search_method).toBe('attribute');
        });

        it('should detect Trilium operators for keyword search', async () => {
            const searchService = await import('../../../search/services/search.js');
            vi.mocked(searchService.default.searchNotes).mockReturnValue([]);

            const result = await tool.execute({
                query: 'note.title *=* test',
                search_method: 'auto'
            }) as any;

            expect(result.search_method).toBe('keyword');
        });

        it('should use semantic for natural language queries', async () => {
            // Mock vector search
            const mockVectorSearch = {
                searchNotes: vi.fn().mockResolvedValue({ matches: [] })
            };
            const aiServiceManager = await import('../../ai_service_manager.js');
            vi.mocked(aiServiceManager.default.getVectorSearchTool).mockReturnValue(mockVectorSearch);

            const result = await tool.execute({
                query: 'how do I configure my database settings',
                search_method: 'auto'
            }) as any;

            expect(result.search_method).toBe('semantic');
        });

        it('should use keyword for short queries', async () => {
            const searchService = await import('../../../search/services/search.js');
            vi.mocked(searchService.default.searchNotes).mockReturnValue([]);

            const result = await tool.execute({
                query: 'test note',
                search_method: 'auto'
            }) as any;

            expect(result.search_method).toBe('keyword');
        });
    });

    describe('parameter validation', () => {
        it('should require query parameter', async () => {
            const result = await tool.execute({} as any);

            expect(typeof result).toBe('string');
            expect(result).toContain('Error');
        });

        it('should use default max_results of 10', async () => {
            const searchService = await import('../../../search/services/search.js');
            vi.mocked(searchService.default.searchNotes).mockReturnValue([]);

            await tool.execute({ query: 'test' });

            // Tool should work without specifying max_results
            expect(searchService.default.searchNotes).toHaveBeenCalled();
        });

        it('should accept override for search_method', async () => {
            const searchService = await import('../../../search/services/search.js');
            vi.mocked(searchService.default.searchNotes).mockReturnValue([]);

            const result = await tool.execute({
                query: 'test',
                search_method: 'keyword'
            }) as any;

            expect(result.search_method).toBe('keyword');
        });
    });

    describe('error handling', () => {
        it('should handle search errors gracefully', async () => {
            const searchService = await import('../../../search/services/search.js');
            vi.mocked(searchService.default.searchNotes).mockImplementation(() => {
                throw new Error('Search failed');
            });

            const result = await tool.execute({ query: 'test' });

            expect(typeof result).toBe('string');
            expect(result).toContain('Error');
        });

        it('should return structured error on invalid parameters', async () => {
            const result = await tool.execute({ query: '' });

            expect(result).toBeDefined();
        });
    });

    describe('result formatting', () => {
        it('should return consistent result structure', async () => {
            const searchService = await import('../../../search/services/search.js');
            const mockNote = {
                noteId: 'test123',
                title: 'Test Note',
                type: 'text',
                getContent: vi.fn().mockReturnValue('Test content'),
                getOwnedAttributes: vi.fn().mockReturnValue([])
            };
            vi.mocked(searchService.default.searchNotes).mockReturnValue([mockNote as any]);

            const result = await tool.execute({ query: 'test' }) as any;

            expect(result).toHaveProperty('count');
            expect(result).toHaveProperty('search_method');
            expect(result).toHaveProperty('query');
            expect(result).toHaveProperty('results');
            expect(result).toHaveProperty('message');
        });

        it('should format search results with required fields', async () => {
            const searchService = await import('../../../search/services/search.js');
            const mockNote = {
                noteId: 'test123',
                title: 'Test Note',
                type: 'text',
                getContent: vi.fn().mockReturnValue('Test content'),
                getOwnedAttributes: vi.fn().mockReturnValue([])
            };
            vi.mocked(searchService.default.searchNotes).mockReturnValue([mockNote as any]);

            const result = await tool.execute({ query: 'test' }) as any;

            expect(result.results).toHaveLength(1);
            expect(result.results[0]).toHaveProperty('noteId');
            expect(result.results[0]).toHaveProperty('title');
            expect(result.results[0]).toHaveProperty('preview');
            expect(result.results[0]).toHaveProperty('type');
        });
    });
});
