import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
const mockSql = {
    getRows: vi.fn()
};

const mockOptions = {
    getOptionBool: vi.fn()
};

const mockBecca = {
    notes: {},
    getNote: vi.fn()
};

const mockBeccaService = {
    getNoteTitleForPath: vi.fn()
};

vi.mock('../sql.js', () => ({
    default: mockSql
}));

vi.mock('../options.js', () => ({
    default: mockOptions
}));

// The SearchResult now uses proper ES imports which are mocked above

vi.mock('../../becca/becca.js', () => ({
    default: mockBecca
}));

vi.mock('../../becca/becca_service.js', () => ({
    default: mockBeccaService
}));

// Import SearchResult after mocking
let SearchResult: any;

beforeEach(async () => {
    vi.clearAllMocks();
    
    // Reset mock implementations
    mockOptions.getOptionBool.mockReturnValue(true);
    mockSql.getRows.mockReturnValue([]);
    mockBeccaService.getNoteTitleForPath.mockReturnValue('Test Note Title');
    
    // Setup mock note
    const mockNote = {
        noteId: 'test123',
        title: 'Test Note',
        isInHiddenSubtree: vi.fn().mockReturnValue(false)
    };
    mockBecca.notes['test123'] = mockNote;
    
    // Dynamically import SearchResult
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

        describe('OCR scoring integration', () => {
            beforeEach(() => {
                // Mock OCR-enabled
                mockOptions.getOptionBool.mockReturnValue(true);
            });

            it('should add OCR score when OCR results exist', () => {
                const mockOCRResults = [
                    {
                        extracted_text: 'sample text from image',
                        confidence: 0.95
                    }
                ];
                mockSql.getRows.mockReturnValue(mockOCRResults);

                searchResult.computeScore('sample', ['sample']);

                expect(mockSql.getRows).toHaveBeenCalledWith(
                    expect.stringContaining('FROM ocr_results'),
                    ['test123', 'test123']
                );
                expect(searchResult.score).toBeGreaterThan(0);
            });

            it('should apply confidence weighting to OCR scores', () => {
                const highConfidenceResult = [
                    {
                        extracted_text: 'sample text',
                        confidence: 0.95
                    }
                ];
                const lowConfidenceResult = [
                    {
                        extracted_text: 'sample text',
                        confidence: 0.30
                    }
                ];

                // Test high confidence
                mockSql.getRows.mockReturnValue(highConfidenceResult);
                searchResult.computeScore('sample', ['sample']);
                const highConfidenceScore = searchResult.score;

                // Reset and test low confidence
                searchResult.score = 0;
                mockSql.getRows.mockReturnValue(lowConfidenceResult);
                searchResult.computeScore('sample', ['sample']);
                const lowConfidenceScore = searchResult.score;

                expect(highConfidenceScore).toBeGreaterThan(lowConfidenceScore);
            });

            it('should handle multiple OCR results', () => {
                const multipleResults = [
                    {
                        extracted_text: 'first sample text',
                        confidence: 0.90
                    },
                    {
                        extracted_text: 'second sample document',
                        confidence: 0.85
                    }
                ];
                mockSql.getRows.mockReturnValue(multipleResults);

                searchResult.computeScore('sample', ['sample']);

                expect(searchResult.score).toBeGreaterThan(0);
                // Score should account for multiple matches
            });

            it('should skip OCR scoring when OCR is disabled', () => {
                mockOptions.getOptionBool.mockReturnValue(false);
                
                searchResult.computeScore('sample', ['sample']);
                
                expect(mockSql.getRows).not.toHaveBeenCalled();
            });

            it('should handle OCR scoring errors gracefully', () => {
                mockSql.getRows.mockImplementation(() => {
                    throw new Error('Database error');
                });

                expect(() => {
                    searchResult.computeScore('sample', ['sample']);
                }).not.toThrow();
                
                // Score should still be calculated from other factors
                expect(searchResult.score).toBeGreaterThanOrEqual(0);
            });
        });

        describe('hidden notes penalty', () => {
            it('should apply penalty for hidden notes', () => {
                mockBecca.notes['test123'].isInHiddenSubtree.mockReturnValue(true);
                
                searchResult.computeScore('test', ['test']);
                const hiddenScore = searchResult.score;
                
                // Reset and test non-hidden
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

    describe('addOCRScore', () => {
        let searchResult: any;
        
        beforeEach(() => {
            searchResult = new SearchResult(['root', 'test123']);
        });

        it('should query for both note and attachment OCR results', () => {
            mockOptions.getOptionBool.mockReturnValue(true);
            mockSql.getRows.mockReturnValue([]);
            
            searchResult.addOCRScore(['sample'], 1.5);
            
            expect(mockSql.getRows).toHaveBeenCalledWith(
                expect.stringContaining('FROM ocr_results'),
                ['test123', 'test123']
            );
        });

        it('should apply minimum confidence multiplier', () => {
            mockOptions.getOptionBool.mockReturnValue(true);
            const lowConfidenceResult = [
                {
                    extracted_text: 'sample text',
                    confidence: 0.1 // Very low confidence
                }
            ];
            mockSql.getRows.mockReturnValue(lowConfidenceResult);
            
            searchResult.addOCRScore(['sample'], 1.0);
            
            // Should still get some score due to minimum 0.5x multiplier
            expect(searchResult.score).toBeGreaterThan(0);
        });

        it('should handle database query errors', () => {
            mockOptions.getOptionBool.mockReturnValue(true);
            mockSql.getRows.mockImplementation(() => {
                throw new Error('Database connection failed');
            });
            
            // Should not throw error
            expect(() => {
                searchResult.addOCRScore(['sample'], 1.5);
            }).not.toThrow();
        });

        it('should skip when OCR is disabled', () => {
            mockOptions.getOptionBool.mockReturnValue(false);
            
            searchResult.addOCRScore(['sample'], 1.5);
            
            expect(mockSql.getRows).not.toHaveBeenCalled();
        });

        it('should handle options service errors', () => {
            mockOptions.getOptionBool.mockImplementation(() => {
                throw new Error('Options service unavailable');
            });
            
            expect(() => {
                searchResult.addOCRScore(['sample'], 1.5);
            }).not.toThrow();
            
            expect(mockSql.getRows).not.toHaveBeenCalled();
        });
    });
});