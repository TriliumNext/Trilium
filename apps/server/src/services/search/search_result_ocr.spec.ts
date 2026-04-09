import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockBecca = {
    notes: {} as Record<string, any>,
    getNote: vi.fn()
};

const mockBeccaService = {
    getNoteTitleForPath: vi.fn()
};

vi.mock('../../becca/becca.js', () => ({
    default: mockBecca
}));

vi.mock('../../becca/becca_service.js', () => ({
    default: mockBeccaService
}));

let SearchResult: any;

beforeEach(async () => {
    vi.clearAllMocks();

    mockBeccaService.getNoteTitleForPath.mockReturnValue('Test Note Title');

    mockBecca.notes['test123'] = {
        noteId: 'test123',
        title: 'Test Note',
        isInHiddenSubtree: vi.fn().mockReturnValue(false)
    };

    const module = await import('./search_result.js');
    SearchResult = module.default;
});

describe('SearchResult', () => {
    describe('constructor', () => {
        it('should initialize with note path array', () => {
            const searchResult = new SearchResult(['root', 'folder', 'test123']);

            expect(searchResult.notePathArray).toEqual(['root', 'folder', 'test123']);
            expect(searchResult.noteId).toBe('test123');
            expect(searchResult.notePath).toBe('root/folder/test123');
            expect(searchResult.score).toBe(0);
            expect(mockBeccaService.getNoteTitleForPath).toHaveBeenCalledWith(['root', 'folder', 'test123']);
        });
    });

    describe('computeScore', () => {
        let searchResult: any;

        beforeEach(() => {
            searchResult = new SearchResult(['root', 'test123']);
        });

        describe('basic scoring', () => {
            it('should give highest score for exact note ID match', () => {
                searchResult.computeScore('test123', ['test123']);
                expect(searchResult.score).toBeGreaterThanOrEqual(1000);
            });

            it('should give high score for exact title match', () => {
                searchResult.computeScore('test note', ['test', 'note']);
                expect(searchResult.score).toBeGreaterThan(2000);
            });

            it('should give medium score for title prefix match', () => {
                searchResult.computeScore('test', ['test']);
                expect(searchResult.score).toBeGreaterThan(500);
            });

            it('should give lower score for title word match', () => {
                mockBecca.notes['test123'].title = 'This is a test note';
                searchResult.computeScore('test', ['test']);
                expect(searchResult.score).toBeGreaterThan(300);
            });
        });

        describe('hidden notes penalty', () => {
            it('should apply penalty for hidden notes', () => {
                mockBecca.notes['test123'].isInHiddenSubtree.mockReturnValue(true);

                searchResult.computeScore('test', ['test']);
                const hiddenScore = searchResult.score;

                mockBecca.notes['test123'].isInHiddenSubtree.mockReturnValue(false);
                searchResult.score = 0;
                searchResult.computeScore('test', ['test']);
                const normalScore = searchResult.score;

                expect(normalScore).toBeGreaterThan(hiddenScore);
                expect(hiddenScore).toBe(normalScore / 3);
            });
        });
    });

    describe('addScoreForStrings', () => {
        let searchResult: any;

        beforeEach(() => {
            searchResult = new SearchResult(['root', 'test123']);
        });

        it('should give highest score for exact token match', () => {
            searchResult.addScoreForStrings(['sample'], 'sample text', 1.0);
            const exactScore = searchResult.score;

            searchResult.score = 0;
            searchResult.addScoreForStrings(['sample'], 'sampling text', 1.0);
            const prefixScore = searchResult.score;

            searchResult.score = 0;
            searchResult.addScoreForStrings(['sample'], 'text sample text', 1.0);
            const partialScore = searchResult.score;

            expect(exactScore).toBeGreaterThan(prefixScore);
            expect(exactScore).toBeGreaterThanOrEqual(partialScore);
        });

        it('should apply factor multiplier correctly', () => {
            searchResult.addScoreForStrings(['sample'], 'sample text', 2.0);
            const doubleFactorScore = searchResult.score;

            searchResult.score = 0;
            searchResult.addScoreForStrings(['sample'], 'sample text', 1.0);
            const singleFactorScore = searchResult.score;

            expect(doubleFactorScore).toBe(singleFactorScore * 2);
        });

        it('should handle multiple tokens', () => {
            searchResult.addScoreForStrings(['hello', 'world'], 'hello world test', 1.0);
            expect(searchResult.score).toBeGreaterThan(0);
        });

        it('should be case insensitive', () => {
            searchResult.addScoreForStrings(['sample'], 'sample text', 1.0);
            const lowerCaseScore = searchResult.score;

            searchResult.score = 0;
            searchResult.addScoreForStrings(['sample'], 'SAMPLE text', 1.0);
            const upperCaseScore = searchResult.score;

            expect(upperCaseScore).toEqual(lowerCaseScore);
            expect(upperCaseScore).toBeGreaterThan(0);
        });
    });
});
