import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// Mock Tesseract.js
const mockWorker = {
    recognize: vi.fn(),
    terminate: vi.fn(),
    reinitialize: vi.fn()
};

const mockTesseract = {
    createWorker: vi.fn().mockResolvedValue(mockWorker)
};

vi.mock('tesseract.js', () => ({
    default: mockTesseract
}));

// Mock dependencies
const mockOptions = {
    getOptionBool: vi.fn(),
    getOption: vi.fn()
};

const mockLog = {
    info: vi.fn(),
    error: vi.fn()
};

const mockSql = {
    execute: vi.fn(),
    getRow: vi.fn(),
    getRows: vi.fn()
};

const mockBecca = {
    getNote: vi.fn(),
    getAttachment: vi.fn()
};

vi.mock('../options.js', () => ({
    default: mockOptions
}));

vi.mock('../log.js', () => ({
    default: mockLog
}));

vi.mock('../sql.js', () => ({
    default: mockSql
}));

vi.mock('../../becca/becca.js', () => ({
    default: mockBecca
}));

// Import the service after mocking
let ocrService: typeof import('./ocr_service.js').default;

beforeEach(async () => {
    // Clear all mocks
    vi.clearAllMocks();
    
    // Reset mock implementations
    mockOptions.getOptionBool.mockReturnValue(true);
    mockOptions.getOption.mockReturnValue('eng');
    mockSql.execute.mockImplementation(() => ({ lastInsertRowid: 1 }));
    mockSql.getRow.mockReturnValue(null);
    mockSql.getRows.mockReturnValue([]);
    
    // Set up createWorker to properly set the worker on the service
    mockTesseract.createWorker.mockImplementation(async () => {
        return mockWorker;
    });
    
    // Dynamically import the service to ensure mocks are applied
    const module = await import('./ocr_service.js');
    ocrService = module.default; // It's an instance, not a class
    
    // Reset the OCR service state
    (ocrService as any).isInitialized = false;
    (ocrService as any).worker = null;
    (ocrService as any).isProcessing = false;
    (ocrService as any).batchProcessingState = {
        inProgress: false,
        total: 0,
        processed: 0
    };
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('OCRService', () => {
    describe('isOCREnabled', () => {
        it('should return true when OCR is enabled in options', () => {
            mockOptions.getOptionBool.mockReturnValue(true);
            
            expect(ocrService.isOCREnabled()).toBe(true);
            expect(mockOptions.getOptionBool).toHaveBeenCalledWith('ocrEnabled');
        });

        it('should return false when OCR is disabled in options', () => {
            mockOptions.getOptionBool.mockReturnValue(false);
            
            expect(ocrService.isOCREnabled()).toBe(false);
            expect(mockOptions.getOptionBool).toHaveBeenCalledWith('ocrEnabled');
        });

        it('should return false when options throws an error', () => {
            mockOptions.getOptionBool.mockImplementation(() => {
                throw new Error('Options not available');
            });
            
            expect(ocrService.isOCREnabled()).toBe(false);
        });
    });

    describe('isSupportedMimeType', () => {
        it('should return true for supported image MIME types', () => {
            expect(ocrService.isSupportedMimeType('image/jpeg')).toBe(true);
            expect(ocrService.isSupportedMimeType('image/jpg')).toBe(true);
            expect(ocrService.isSupportedMimeType('image/png')).toBe(true);
            expect(ocrService.isSupportedMimeType('image/gif')).toBe(true);
            expect(ocrService.isSupportedMimeType('image/bmp')).toBe(true);
            expect(ocrService.isSupportedMimeType('image/tiff')).toBe(true);
        });

        it('should return false for unsupported MIME types', () => {
            expect(ocrService.isSupportedMimeType('text/plain')).toBe(false);
            expect(ocrService.isSupportedMimeType('application/pdf')).toBe(false);
            expect(ocrService.isSupportedMimeType('video/mp4')).toBe(false);
            expect(ocrService.isSupportedMimeType('audio/mp3')).toBe(false);
        });

        it('should handle null/undefined MIME types', () => {
            expect(ocrService.isSupportedMimeType(null as any)).toBe(false);
            expect(ocrService.isSupportedMimeType(undefined as any)).toBe(false);
            expect(ocrService.isSupportedMimeType('')).toBe(false);
        });
    });

    describe('initialize', () => {
        it('should initialize Tesseract worker successfully', async () => {
            await ocrService.initialize();
            
            expect(mockTesseract.createWorker).toHaveBeenCalledWith('eng', 1, {
                workerPath: expect.any(String),
                corePath: expect.any(String),
                logger: expect.any(Function)
            });
            expect(mockLog.info).toHaveBeenCalledWith('Initializing OCR service with Tesseract.js...');
            expect(mockLog.info).toHaveBeenCalledWith('OCR service initialized successfully');
        });

        it('should not reinitialize if already initialized', async () => {
            await ocrService.initialize();
            mockTesseract.createWorker.mockClear();
            
            await ocrService.initialize();
            
            expect(mockTesseract.createWorker).not.toHaveBeenCalled();
        });

        it('should handle initialization errors', async () => {
            const error = new Error('Tesseract initialization failed');
            mockTesseract.createWorker.mockRejectedValue(error);
            
            await expect(ocrService.initialize()).rejects.toThrow('Tesseract initialization failed');
            expect(mockLog.error).toHaveBeenCalledWith('Failed to initialize OCR service: Error: Tesseract initialization failed');
        });
    });

    describe('extractTextFromImage', () => {
        const mockImageBuffer = Buffer.from('fake-image-data');
        
        beforeEach(async () => {
            await ocrService.initialize();
            // Manually set the worker since mocking might not do it properly
            (ocrService as any).worker = mockWorker;
        });

        it('should extract text successfully with default options', async () => {
            const mockResult = {
                data: {
                    text: 'Extracted text from image',
                    confidence: 95
                }
            };
            mockWorker.recognize.mockResolvedValue(mockResult);

            const result = await ocrService.extractTextFromImage(mockImageBuffer);

            expect(result).toEqual({
                text: 'Extracted text from image',
                confidence: 0.95,
                extractedAt: expect.any(String),
                language: 'eng'
            });
            expect(mockWorker.recognize).toHaveBeenCalledWith(mockImageBuffer);
        });

        it('should extract text with custom language', async () => {
            const mockResult = {
                data: {
                    text: 'French text',
                    confidence: 88
                }
            };
            mockWorker.recognize.mockResolvedValue(mockResult);

            const result = await ocrService.extractTextFromImage(mockImageBuffer, { language: 'fra' });

            expect(result.language).toBe('fra');
            expect(mockWorker.terminate).toHaveBeenCalled();
            expect(mockTesseract.createWorker).toHaveBeenCalledWith('fra', 1, expect.any(Object));
        });

        it('should handle OCR recognition errors', async () => {
            const error = new Error('OCR recognition failed');
            mockWorker.recognize.mockRejectedValue(error);

            await expect(ocrService.extractTextFromImage(mockImageBuffer)).rejects.toThrow('OCR recognition failed');
            expect(mockLog.error).toHaveBeenCalledWith('OCR text extraction failed: Error: OCR recognition failed');
        });

        it('should handle empty or low-confidence results', async () => {
            const mockResult = {
                data: {
                    text: '   ',
                    confidence: 15
                }
            };
            mockWorker.recognize.mockResolvedValue(mockResult);

            const result = await ocrService.extractTextFromImage(mockImageBuffer);

            expect(result.text).toBe('');
            expect(result.confidence).toBe(0.15);
        });
    });

    describe('storeOCRResult', () => {
        it('should store OCR result in blob successfully', async () => {
            const ocrResult = {
                text: 'Sample text',
                confidence: 0.95,
                extractedAt: '2025-06-10T10:00:00.000Z',
                language: 'eng'
            };

            await ocrService.storeOCRResult('blob123', ocrResult);

            expect(mockSql.execute).toHaveBeenCalledWith(
                expect.stringContaining('UPDATE blobs SET ocr_text = ?'),
                ['Sample text', 'blob123']
            );
        });

        it('should handle undefined blobId gracefully', async () => {
            const ocrResult = {
                text: 'Sample text',
                confidence: 0.95,
                extractedAt: '2025-06-10T10:00:00.000Z',
                language: 'eng'
            };

            await ocrService.storeOCRResult(undefined, ocrResult);

            expect(mockSql.execute).not.toHaveBeenCalled();
            expect(mockLog.error).toHaveBeenCalledWith('Cannot store OCR result: blobId is undefined');
        });

        it('should handle database update errors', async () => {
            const error = new Error('Database error');
            mockSql.execute.mockImplementation(() => {
                throw error;
            });

            const ocrResult = {
                text: 'Sample text',
                confidence: 0.95,
                extractedAt: '2025-06-10T10:00:00.000Z',
                language: 'eng'
            };

            await expect(ocrService.storeOCRResult('blob123', ocrResult)).rejects.toThrow('Database error');
            expect(mockLog.error).toHaveBeenCalledWith('Failed to store OCR result for blob blob123: Error: Database error');
        });
    });

    describe('processNoteOCR', () => {
        const mockNote = {
            noteId: 'note123',
            type: 'image',
            mime: 'image/jpeg',
            blobId: 'blob123',
            getContent: vi.fn()
        };

        beforeEach(() => {
            mockBecca.getNote.mockReturnValue(mockNote);
            mockNote.getContent.mockReturnValue(Buffer.from('fake-image-data'));
        });

        it('should process note OCR successfully', async () => {
            // Ensure getRow returns null for all calls in this test
            mockSql.getRow.mockImplementation(() => null);
            
            const mockOCRResult = {
                data: {
                    text: 'Note image text',
                    confidence: 90
                }
            };
            await ocrService.initialize();
            // Manually set the worker since mocking might not do it properly
            (ocrService as any).worker = mockWorker;
            mockWorker.recognize.mockResolvedValue(mockOCRResult);

            const result = await ocrService.processNoteOCR('note123');

            expect(result).toEqual({
                text: 'Note image text',
                confidence: 0.9,
                extractedAt: expect.any(String),
                language: 'eng'
            });
            expect(mockBecca.getNote).toHaveBeenCalledWith('note123');
            expect(mockNote.getContent).toHaveBeenCalled();
        });

        it('should return existing OCR result if forceReprocess is false', async () => {
            const existingResult = {
                ocr_text: 'Existing text'
            };
            mockSql.getRow.mockReturnValue(existingResult);

            const result = await ocrService.processNoteOCR('note123');

            expect(result).toEqual({
                text: 'Existing text',
                confidence: 0.95,
                language: 'eng',
                extractedAt: expect.any(String)
            });
            expect(mockNote.getContent).not.toHaveBeenCalled();
        });

        it('should reprocess if forceReprocess is true', async () => {
            const existingResult = {
                ocr_text: 'Existing text'
            };
            mockSql.getRow.mockResolvedValue(existingResult);
            
            await ocrService.initialize();
            // Manually set the worker since mocking might not do it properly
            (ocrService as any).worker = mockWorker;
            
            const mockOCRResult = {
                data: {
                    text: 'New processed text',
                    confidence: 95
                }
            };
            mockWorker.recognize.mockResolvedValue(mockOCRResult);

            const result = await ocrService.processNoteOCR('note123', { forceReprocess: true });

            expect(result?.text).toBe('New processed text');
            expect(mockNote.getContent).toHaveBeenCalled();
        });

        it('should return null for non-existent note', async () => {
            mockBecca.getNote.mockReturnValue(null);

            const result = await ocrService.processNoteOCR('nonexistent');

            expect(result).toBe(null);
            expect(mockLog.error).toHaveBeenCalledWith('Note nonexistent not found');
        });

        it('should return null for unsupported MIME type', async () => {
            mockNote.mime = 'text/plain';

            const result = await ocrService.processNoteOCR('note123');

            expect(result).toBe(null);
            expect(mockLog.info).toHaveBeenCalledWith('Note note123 has unsupported MIME type text/plain, skipping OCR');
        });
    });

    describe('processAttachmentOCR', () => {
        const mockAttachment = {
            attachmentId: 'attach123',
            role: 'image',
            mime: 'image/png',
            blobId: 'blob456',
            getContent: vi.fn()
        };

        beforeEach(() => {
            mockBecca.getAttachment.mockReturnValue(mockAttachment);
            mockAttachment.getContent.mockReturnValue(Buffer.from('fake-image-data'));
        });

        it('should process attachment OCR successfully', async () => {
            // Ensure getRow returns null for all calls in this test
            mockSql.getRow.mockImplementation(() => null);
            
            await ocrService.initialize();
            // Manually set the worker since mocking might not do it properly
            (ocrService as any).worker = mockWorker;
            
            const mockOCRResult = {
                data: {
                    text: 'Attachment image text',
                    confidence: 92
                }
            };
            mockWorker.recognize.mockResolvedValue(mockOCRResult);

            const result = await ocrService.processAttachmentOCR('attach123');

            expect(result).toEqual({
                text: 'Attachment image text',
                confidence: 0.92,
                extractedAt: expect.any(String),
                language: 'eng'
            });
            expect(mockBecca.getAttachment).toHaveBeenCalledWith('attach123');
        });

        it('should return null for non-existent attachment', async () => {
            mockBecca.getAttachment.mockReturnValue(null);

            const result = await ocrService.processAttachmentOCR('nonexistent');

            expect(result).toBe(null);
            expect(mockLog.error).toHaveBeenCalledWith('Attachment nonexistent not found');
        });
    });

    describe('searchOCRResults', () => {
        it('should search OCR results successfully', () => {
            const mockResults = [
                {
                    blobId: 'blob1',
                    ocr_text: 'Sample search text'
                }
            ];
            mockSql.getRows.mockReturnValue(mockResults);

            const results = ocrService.searchOCRResults('search');

            expect(results).toEqual([{
                blobId: 'blob1',
                text: 'Sample search text'
            }]);
            expect(mockSql.getRows).toHaveBeenCalledWith(
                expect.stringContaining('WHERE ocr_text LIKE ?'),
                ['%search%']
            );
        });

        it('should handle search errors gracefully', () => {
            mockSql.getRows.mockImplementation(() => {
                throw new Error('Database error');
            });

            const results = ocrService.searchOCRResults('search');

            expect(results).toEqual([]);
            expect(mockLog.error).toHaveBeenCalledWith('Failed to search OCR results: Error: Database error');
        });
    });

    describe('getOCRStats', () => {
        it('should return OCR statistics successfully', () => {
            const mockStats = {
                total_processed: 150
            };
            const mockNoteStats = {
                count: 100
            };
            const mockAttachmentStats = {
                count: 50
            };
            
            mockSql.getRow.mockReturnValueOnce(mockStats);
            mockSql.getRow.mockReturnValueOnce(mockNoteStats);
            mockSql.getRow.mockReturnValueOnce(mockAttachmentStats);

            const stats = ocrService.getOCRStats();

            expect(stats).toEqual({
                totalProcessed: 150,
                imageNotes: 100,
                imageAttachments: 50
            });
        });

        it('should handle missing statistics gracefully', () => {
            mockSql.getRow.mockReturnValue(null);

            const stats = ocrService.getOCRStats();

            expect(stats).toEqual({
                totalProcessed: 0,
                imageNotes: 0,
                imageAttachments: 0
            });
        });
    });

    describe('Batch Processing', () => {
        describe('startBatchProcessing', () => {
            beforeEach(() => {
                // Reset batch processing state
                ocrService.cancelBatchProcessing();
            });

            it('should start batch processing when images are available', async () => {
                mockSql.getRow.mockReturnValueOnce({ count: 5 }); // image notes
                mockSql.getRow.mockReturnValueOnce({ count: 3 }); // image attachments

                const result = await ocrService.startBatchProcessing();

                expect(result).toEqual({ success: true });
                expect(mockSql.getRow).toHaveBeenCalledTimes(2);
            });

            it('should return error if batch processing already in progress', async () => {
                // Start first batch
                mockSql.getRow.mockReturnValueOnce({ count: 5 });
                mockSql.getRow.mockReturnValueOnce({ count: 3 });
                
                // Mock background processing queries
                const mockImageNotes = Array.from({length: 5}, (_, i) => ({
                    noteId: `note${i}`,
                    mime: 'image/jpeg'
                }));
                mockSql.getRows.mockReturnValueOnce(mockImageNotes);
                mockSql.getRows.mockReturnValueOnce([]);
                
                // Start without awaiting to keep it in progress
                const firstStart = ocrService.startBatchProcessing();

                // Try to start second batch immediately
                const result = await ocrService.startBatchProcessing();
                
                // Clean up by awaiting the first one
                await firstStart;

                expect(result).toEqual({
                    success: false,
                    message: 'Batch processing already in progress'
                });
            });

            it('should return error if OCR is disabled', async () => {
                mockOptions.getOptionBool.mockReturnValue(false);

                const result = await ocrService.startBatchProcessing();

                expect(result).toEqual({
                    success: false,
                    message: 'OCR is disabled'
                });
            });

            it('should return error if no images need processing', async () => {
                mockSql.getRow.mockReturnValueOnce({ count: 0 }); // image notes
                mockSql.getRow.mockReturnValueOnce({ count: 0 }); // image attachments

                const result = await ocrService.startBatchProcessing();

                expect(result).toEqual({
                    success: false,
                    message: 'No images found that need OCR processing'
                });
            });

            it('should handle database errors gracefully', async () => {
                const error = new Error('Database connection failed');
                mockSql.getRow.mockImplementation(() => {
                    throw error;
                });

                const result = await ocrService.startBatchProcessing();

                expect(result).toEqual({
                    success: false,
                    message: 'Database connection failed'
                });
                expect(mockLog.error).toHaveBeenCalledWith(
                    'Failed to start batch processing: Database connection failed'
                );
            });
        });

        describe('getBatchProgress', () => {
            it('should return initial progress state', () => {
                const progress = ocrService.getBatchProgress();

                expect(progress.inProgress).toBe(false);
                expect(progress.total).toBe(0);
                expect(progress.processed).toBe(0);
            });

            it('should return progress with percentage when total > 0', async () => {
                // Start batch processing
                mockSql.getRow.mockReturnValueOnce({ count: 10 });
                mockSql.getRow.mockReturnValueOnce({ count: 0 });
                
                // Mock the background processing queries to return items that will take time to process
                const mockImageNotes = Array.from({length: 10}, (_, i) => ({
                    noteId: `note${i}`,
                    mime: 'image/jpeg'
                }));
                mockSql.getRows.mockReturnValueOnce(mockImageNotes); // image notes query
                mockSql.getRows.mockReturnValueOnce([]); // image attachments query
                
                const startPromise = ocrService.startBatchProcessing();
                
                // Check progress immediately after starting (before awaiting)
                const progress = ocrService.getBatchProgress();
                
                await startPromise;

                expect(progress.inProgress).toBe(true);
                expect(progress.total).toBe(10);
                expect(progress.processed).toBe(0);
                expect(progress.percentage).toBe(0);
                expect(progress.startTime).toBeInstanceOf(Date);
            });
        });

        describe('cancelBatchProcessing', () => {
            it('should cancel ongoing batch processing', async () => {
                // Start batch processing
                mockSql.getRow.mockReturnValueOnce({ count: 5 });
                mockSql.getRow.mockReturnValueOnce({ count: 0 });
                
                // Mock background processing queries
                const mockImageNotes = Array.from({length: 5}, (_, i) => ({
                    noteId: `note${i}`,
                    mime: 'image/jpeg'
                }));
                mockSql.getRows.mockReturnValueOnce(mockImageNotes);
                mockSql.getRows.mockReturnValueOnce([]);
                
                const startPromise = ocrService.startBatchProcessing();
                
                expect(ocrService.getBatchProgress().inProgress).toBe(true);
                
                await startPromise;

                ocrService.cancelBatchProcessing();

                expect(ocrService.getBatchProgress().inProgress).toBe(false);
                expect(mockLog.info).toHaveBeenCalledWith('Batch OCR processing cancelled');
            });

            it('should do nothing if no batch processing is running', () => {
                ocrService.cancelBatchProcessing();

                expect(mockLog.info).not.toHaveBeenCalledWith('Batch OCR processing cancelled');
            });
        });

        describe('processBatchInBackground', () => {
            beforeEach(async () => {
                await ocrService.initialize();
            });

            it('should process image notes and attachments in sequence', async () => {
                // Clear all mocks at the start of this test to ensure clean state
                vi.clearAllMocks();
                
                // Reinitialize OCR service after clearing mocks
                await ocrService.initialize();
                (ocrService as any).worker = mockWorker;
                
                // Mock data for batch processing
                const imageNotes = [
                    { noteId: 'note1', mime: 'image/jpeg', blobId: 'blob1' },
                    { noteId: 'note2', mime: 'image/png', blobId: 'blob2' }
                ];
                const imageAttachments = [
                    { attachmentId: 'attach1', mime: 'image/gif', blobId: 'blob3' }
                ];

                // Setup mocks for startBatchProcessing
                mockSql.getRow.mockReturnValueOnce({ count: 2 }); // image notes count
                mockSql.getRow.mockReturnValueOnce({ count: 1 }); // image attachments count

                // Setup mocks for background processing
                mockSql.getRows.mockReturnValueOnce(imageNotes); // image notes query
                mockSql.getRows.mockReturnValueOnce(imageAttachments); // image attachments query

                // Mock successful OCR processing
                mockWorker.recognize.mockResolvedValue({
                    data: { text: 'Test text', confidence: 95 }
                });

                // Mock notes and attachments
                const mockNote1 = {
                    noteId: 'note1',
                    type: 'image',
                    mime: 'image/jpeg',
                    blobId: 'blob1',
                    getContent: vi.fn().mockReturnValue(Buffer.from('fake-image-data'))
                };
                const mockNote2 = {
                    noteId: 'note2',
                    type: 'image',
                    mime: 'image/png',
                    blobId: 'blob2',
                    getContent: vi.fn().mockReturnValue(Buffer.from('fake-image-data'))
                };
                const mockAttachment = {
                    attachmentId: 'attach1',
                    role: 'image',
                    mime: 'image/gif',
                    blobId: 'blob3',
                    getContent: vi.fn().mockReturnValue(Buffer.from('fake-image-data'))
                };

                mockBecca.getNote.mockImplementation((noteId) => {
                    if (noteId === 'note1') return mockNote1;
                    if (noteId === 'note2') return mockNote2;
                    return null;
                });
                mockBecca.getAttachment.mockReturnValue(mockAttachment);
                mockSql.getRow.mockReturnValue(null); // No existing OCR results

                // Start batch processing
                await ocrService.startBatchProcessing();

                // Wait for background processing to complete
                // Need to wait longer since there's a 500ms delay between each item in batch processing
                await new Promise(resolve => setTimeout(resolve, 2000));

                // Verify notes and attachments were processed
                expect(mockBecca.getNote).toHaveBeenCalledWith('note1');
                expect(mockBecca.getNote).toHaveBeenCalledWith('note2');
                expect(mockBecca.getAttachment).toHaveBeenCalledWith('attach1');
            });

            it('should handle processing errors gracefully', async () => {
                const imageNotes = [
                    { noteId: 'note1', mime: 'image/jpeg', blobId: 'blob1' }
                ];

                // Setup mocks for startBatchProcessing
                mockSql.getRow.mockReturnValueOnce({ count: 1 });
                mockSql.getRow.mockReturnValueOnce({ count: 0 });

                // Setup mocks for background processing
                mockSql.getRows.mockReturnValueOnce(imageNotes);
                mockSql.getRows.mockReturnValueOnce([]);

                // Mock note that will cause an error
                const mockNote = {
                    noteId: 'note1',
                    type: 'image',
                    mime: 'image/jpeg',
                    blobId: 'blob1',
                    getContent: vi.fn().mockImplementation(() => { throw new Error('Failed to get content'); })
                };
                mockBecca.getNote.mockReturnValue(mockNote);
                mockSql.getRow.mockReturnValue(null);

                // Start batch processing
                await ocrService.startBatchProcessing();

                // Wait for background processing to complete
                await new Promise(resolve => setTimeout(resolve, 100));

                // Verify error was logged but processing continued
                expect(mockLog.error).toHaveBeenCalledWith(
                    expect.stringContaining('Failed to process OCR for note note1')
                );
            });

            it('should stop processing when cancelled', async () => {
                const imageNotes = [
                    { noteId: 'note1', mime: 'image/jpeg', blobId: 'blob1' },
                    { noteId: 'note2', mime: 'image/png', blobId: 'blob2' }
                ];

                // Setup mocks
                mockSql.getRow.mockReturnValueOnce({ count: 2 });
                mockSql.getRow.mockReturnValueOnce({ count: 0 });
                mockSql.getRows.mockReturnValueOnce(imageNotes);
                mockSql.getRows.mockReturnValueOnce([]);

                // Start batch processing
                await ocrService.startBatchProcessing();

                // Cancel immediately
                ocrService.cancelBatchProcessing();

                // Wait for background processing to complete
                await new Promise(resolve => setTimeout(resolve, 100));

                // Verify processing was stopped early
                expect(ocrService.getBatchProgress().inProgress).toBe(false);
            });

            it('should skip unsupported MIME types', async () => {
                const imageNotes = [
                    { noteId: 'note1', mime: 'text/plain', blobId: 'blob1' }, // unsupported
                    { noteId: 'note2', mime: 'image/jpeg', blobId: 'blob2' }  // supported
                ];

                // Setup mocks
                mockSql.getRow.mockReturnValueOnce({ count: 2 });
                mockSql.getRow.mockReturnValueOnce({ count: 0 });
                mockSql.getRows.mockReturnValueOnce(imageNotes);
                mockSql.getRows.mockReturnValueOnce([]);

                const mockNote = {
                    noteId: 'note2',
                    type: 'image',
                    mime: 'image/jpeg',
                    blobId: 'blob2',
                    getContent: vi.fn().mockReturnValue(Buffer.from('fake-image-data'))
                };
                mockBecca.getNote.mockReturnValue(mockNote);
                mockSql.getRow.mockReturnValue(null);
                mockWorker.recognize.mockResolvedValue({
                    data: { text: 'Test text', confidence: 95 }
                });

                // Start batch processing
                await ocrService.startBatchProcessing();

                // Wait for background processing to complete
                await new Promise(resolve => setTimeout(resolve, 100));

                // Verify only supported MIME type was processed
                expect(mockBecca.getNote).toHaveBeenCalledWith('note2');
                expect(mockBecca.getNote).not.toHaveBeenCalledWith('note1');
            });
        });
    });

    describe('deleteOCRResult', () => {
        it('should delete OCR result successfully', () => {
            ocrService.deleteOCRResult('blob123');

            expect(mockSql.execute).toHaveBeenCalledWith(
                expect.stringContaining('UPDATE blobs SET ocr_text = NULL'),
                ['blob123']
            );
            expect(mockLog.info).toHaveBeenCalledWith('Deleted OCR result for blob blob123');
        });

        it('should handle deletion errors', () => {
            mockSql.execute.mockImplementation(() => {
                throw new Error('Database error');
            });

            expect(() => ocrService.deleteOCRResult('blob123')).toThrow('Database error');
            expect(mockLog.error).toHaveBeenCalledWith('Failed to delete OCR result for blob blob123: Error: Database error');
        });
    });

    describe('isCurrentlyProcessing', () => {
        it('should return false initially', () => {
            expect(ocrService.isCurrentlyProcessing()).toBe(false);
        });

        it('should return true during processing', async () => {
            mockBecca.getNote.mockReturnValue({
                noteId: 'note123',
                mime: 'image/jpeg',
                blobId: 'blob123',
                getContent: vi.fn().mockReturnValue(Buffer.from('fake-image-data'))
            });
            mockSql.getRow.mockResolvedValue(null);
            
            await ocrService.initialize();
            mockWorker.recognize.mockImplementation(() => {
                expect(ocrService.isCurrentlyProcessing()).toBe(true);
                return Promise.resolve({
                    data: { text: 'test', confidence: 90 }
                });
            });

            await ocrService.processNoteOCR('note123');
            expect(ocrService.isCurrentlyProcessing()).toBe(false);
        });
    });

    describe('cleanup', () => {
        it('should terminate worker on cleanup', async () => {
            await ocrService.initialize();
            // Manually set the worker since mocking might not do it properly
            (ocrService as any).worker = mockWorker;
            
            await ocrService.cleanup();
            
            expect(mockWorker.terminate).toHaveBeenCalled();
            expect(mockLog.info).toHaveBeenCalledWith('OCR service cleaned up');
        });

        it('should handle cleanup when worker is not initialized', async () => {
            await ocrService.cleanup();
            
            expect(mockWorker.terminate).not.toHaveBeenCalled();
            expect(mockLog.info).toHaveBeenCalledWith('OCR service cleaned up');
        });
    });
});