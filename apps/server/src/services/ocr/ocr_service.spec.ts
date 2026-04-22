import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
    getRows: vi.fn(),
    getColumn: vi.fn()
};

const mockBecca = {
    getNote: vi.fn(),
    getAttachment: vi.fn(),
    getBlob: vi.fn()
};

const mockBlobService = {
    calculateContentHash: vi.fn().mockReturnValue('hash123')
};

const mockEntityChangesService = {
    putEntityChange: vi.fn()
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

vi.mock('../blob.js', () => ({
    default: mockBlobService
}));

vi.mock('../entity_changes.js', () => ({
    default: mockEntityChangesService
}));

// Import the service after mocking
let ocrService: typeof import('./ocr_service.js').default;

beforeEach(async () => {
    vi.clearAllMocks();

    // Reset mock implementations
    mockOptions.getOptionBool.mockReturnValue(true);
    mockOptions.getOption.mockImplementation((name: string) => {
        if (name === 'ocrMinConfidence') return '0';
        return 'eng';
    });
    mockSql.execute.mockImplementation(() => ({ lastInsertRowid: 1 }));
    mockSql.getRow.mockReturnValue(null);
    mockSql.getRows.mockReturnValue([]);
    mockSql.getColumn.mockReturnValue([]);

    // Mock getBlob for putBlobEntityChange
    mockBecca.getBlob.mockReturnValue({
        blobId: 'blob123',
        content: Buffer.from('data'),
        textRepresentation: null,
        utcDateModified: '2025-01-01'
    });

    mockTesseract.createWorker.mockImplementation(async () => {
        return mockWorker;
    });

    // Dynamically import the service to ensure mocks are applied
    const module = await import('./ocr_service.js');
    ocrService = module.default;

    // Reset the OCR service state
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
    describe('extractTextFromFile', () => {
        const mockImageBuffer = Buffer.from('fake-image-data');

        it('should extract text successfully with default options', async () => {
            const mockResult = {
                data: {
                    text: 'Extracted text from image',
                    confidence: 95,
                    words: [{ text: 'Extracted', confidence: 95 }, { text: 'text', confidence: 95 }, { text: 'from', confidence: 95 }, { text: 'image', confidence: 95 }]
                }
            };
            mockWorker.recognize.mockResolvedValue(mockResult);

            const result = await ocrService.extractTextFromFile(mockImageBuffer, 'image/jpeg');

            expect(result).toBeDefined();
            expect(result.text).toBe('Extracted text from image');
            expect(result.extractedAt).toEqual(expect.any(String));
        });

        it('should handle OCR recognition errors', async () => {
            const error = new Error('OCR recognition failed');
            mockWorker.recognize.mockRejectedValue(error);

            await expect(ocrService.extractTextFromFile(mockImageBuffer, 'image/jpeg')).rejects.toThrow('OCR recognition failed');
            expect(mockLog.error).toHaveBeenCalledWith('Image OCR text extraction failed: Error: OCR recognition failed');
        });
    });

    describe('storeOCRResult', () => {
        it('should store OCR result in blob successfully', () => {
            const ocrResult = {
                text: 'Sample text',
                confidence: 0.95,
                extractedAt: '2025-06-10T10:00:00.000Z',
                language: 'eng'
            };

            ocrService.storeOCRResult('blob123', ocrResult);

            expect(mockSql.execute).toHaveBeenCalledWith(
                expect.stringContaining('UPDATE blobs SET textRepresentation = ?'),
                ['Sample text', 'blob123']
            );
        });

        it('should handle undefined blobId gracefully', () => {
            const ocrResult = {
                text: 'Sample text',
                confidence: 0.95,
                extractedAt: '2025-06-10T10:00:00.000Z',
                language: 'eng'
            };

            ocrService.storeOCRResult(undefined, ocrResult);

            expect(mockSql.execute).not.toHaveBeenCalled();
            expect(mockLog.error).toHaveBeenCalledWith('Cannot store OCR result: blobId is undefined');
        });

        it('should handle database update errors', () => {
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

            expect(() => ocrService.storeOCRResult('blob123', ocrResult)).toThrow('Database error');
            expect(mockLog.error).toHaveBeenCalledWith('Failed to store OCR result for blob blob123: Error: Database error');
        });
    });

    describe('processNoteOCR', () => {
        const mockNote = {
            noteId: 'note123',
            type: 'image',
            mime: 'image/jpeg',
            blobId: 'blob123',
            getContent: vi.fn(),
            getLabelValue: vi.fn().mockReturnValue(null)
        };

        beforeEach(() => {
            mockBecca.getNote.mockReturnValue(mockNote);
            mockNote.getContent.mockReturnValue(Buffer.from('fake-image-data'));
            mockNote.mime = 'image/jpeg';
        });

        it('should process note OCR successfully', async () => {
            mockSql.getRow.mockReturnValue(null);

            const mockOCRResult = {
                data: {
                    text: 'Note image text',
                    confidence: 90,
                    words: [{ text: 'Note', confidence: 90 }, { text: 'image', confidence: 90 }, { text: 'text', confidence: 90 }]
                }
            };
            mockWorker.recognize.mockResolvedValue(mockOCRResult);

            const result = await ocrService.processNoteOCR('note123');

            expect(result).toBeDefined();
            expect(result!.text).toBe('Note image text');
            expect(mockBecca.getNote).toHaveBeenCalledWith('note123');
            expect(mockNote.getContent).toHaveBeenCalled();
        });

        it('should skip processing if OCR already exists and forceReprocess is false', async () => {
            mockSql.getRow.mockReturnValue({ textRepresentation: 'Existing text' });

            const result = await ocrService.processNoteOCR('note123');

            expect(result).toBeNull();
            expect(mockNote.getContent).not.toHaveBeenCalled();
        });

        it('should reprocess if forceReprocess is true', async () => {
            mockSql.getRow.mockReturnValue({ textRepresentation: 'Existing text' });

            const mockOCRResult = {
                data: {
                    text: 'New processed text',
                    confidence: 95,
                    words: [{ text: 'New', confidence: 95 }, { text: 'processed', confidence: 95 }, { text: 'text', confidence: 95 }]
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
            expect(mockLog.info).toHaveBeenCalledWith('note note123 has unsupported MIME type text/plain for text extraction, skipping');
        });
    });

    describe('processAttachmentOCR', () => {
        const mockAttachment = {
            attachmentId: 'attach123',
            ownerId: 'note123',
            role: 'image',
            mime: 'image/png',
            blobId: 'blob456',
            getContent: vi.fn()
        };

        beforeEach(() => {
            mockBecca.getAttachment.mockReturnValue(mockAttachment);
            mockBecca.getNote.mockReturnValue({ getLabelValue: vi.fn().mockReturnValue(null) });
            mockAttachment.getContent.mockReturnValue(Buffer.from('fake-image-data'));
        });

        it('should process attachment OCR successfully', async () => {
            mockSql.getRow.mockReturnValue(null);

            const mockOCRResult = {
                data: {
                    text: 'Attachment image text',
                    confidence: 92,
                    words: [{ text: 'Attachment', confidence: 92 }, { text: 'image', confidence: 92 }, { text: 'text', confidence: 92 }]
                }
            };
            mockWorker.recognize.mockResolvedValue(mockOCRResult);

            const result = await ocrService.processAttachmentOCR('attach123');

            expect(result).toBeDefined();
            expect(result!.text).toBe('Attachment image text');
            expect(mockBecca.getAttachment).toHaveBeenCalledWith('attach123');
        });

        it('should return null for non-existent attachment', async () => {
            mockBecca.getAttachment.mockReturnValue(null);

            const result = await ocrService.processAttachmentOCR('nonexistent');

            expect(result).toBe(null);
            expect(mockLog.error).toHaveBeenCalledWith('Attachment nonexistent not found');
        });
    });

    describe('Batch Processing', () => {
        // Helper to mock getBlobsNeedingOCR to return entities
        function mockBlobsNeedingOCR(notes: Array<{ entityId: string; mimeType: string }>, attachments: Array<{ entityId: string; mimeType: string }> = []) {
            const noteRows = notes.map(n => ({ blobId: `blob_${n.entityId}`, mimeType: n.mimeType, entityId: n.entityId }));
            const attachmentRows = attachments.map(a => ({ blobId: `blob_${a.entityId}`, mimeType: a.mimeType, entityId: a.entityId }));
            mockSql.getRows.mockReturnValueOnce(noteRows);
            mockSql.getRows.mockReturnValueOnce(attachmentRows);
        }

        describe('startBatchProcessing', () => {
            beforeEach(() => {
                ocrService.cancelBatchProcessing();
            });

            it('should start batch processing when items are available', async () => {
                mockBlobsNeedingOCR(
                    [{ entityId: 'note1', mimeType: 'image/jpeg' }]
                );

                const result = await ocrService.startBatchProcessing();

                expect(result).toEqual({ success: true });
            });

            it('should return error if batch processing already in progress', async () => {
                // First call: items for starting
                mockBlobsNeedingOCR(
                    [{ entityId: 'note1', mimeType: 'image/jpeg' }]
                );
                // Mock note for background processing
                mockBecca.getNote.mockReturnValue({
                    noteId: 'note1', type: 'image', mime: 'image/jpeg', blobId: 'blob1',
                    getContent: vi.fn().mockReturnValue(Buffer.from('data')),
                    getLabelValue: vi.fn().mockReturnValue(null)
                });
                mockWorker.recognize.mockResolvedValue({ data: { text: 'text', confidence: 90, words: [] } });

                ocrService.startBatchProcessing();

                const result = await ocrService.startBatchProcessing();

                expect(result).toEqual({
                    success: false,
                    message: 'Batch processing already in progress'
                });
            });

            it('should return error if no items need processing', async () => {
                mockBlobsNeedingOCR([], []);

                const result = await ocrService.startBatchProcessing();

                expect(result).toEqual({
                    success: false,
                    message: 'No images found that need OCR processing'
                });
            });

            it('should handle database errors gracefully', async () => {
                mockSql.getRows.mockImplementation(() => {
                    throw new Error('Database connection failed');
                });

                const result = await ocrService.startBatchProcessing();

                // getBlobsNeedingOCR catches DB errors and returns [], so startBatchProcessing sees no items
                expect(result).toEqual({
                    success: false,
                    message: 'No images found that need OCR processing'
                });
                expect(mockLog.error).toHaveBeenCalledWith(
                    expect.stringContaining('Failed to get blobs needing OCR')
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
                mockBlobsNeedingOCR(
                    Array.from({ length: 10 }, (_, i) => ({ entityId: `note${i}`, mimeType: 'image/jpeg' }))
                );

                ocrService.startBatchProcessing();

                const progress = ocrService.getBatchProgress();

                expect(progress.inProgress).toBe(true);
                expect(progress.total).toBe(10);
                expect(progress.processed).toBe(0);
                expect(progress.percentage).toBe(0);
                expect(progress.startTime).toBeInstanceOf(Date);
            });
        });

        describe('cancelBatchProcessing', () => {
            it('should cancel ongoing batch processing', async () => {
                mockBlobsNeedingOCR(
                    [{ entityId: 'note1', mimeType: 'image/jpeg' }]
                );

                ocrService.startBatchProcessing();

                expect(ocrService.getBatchProgress().inProgress).toBe(true);

                ocrService.cancelBatchProcessing();

                expect(ocrService.getBatchProgress().inProgress).toBe(false);
                expect(mockLog.info).toHaveBeenCalledWith('Batch OCR processing cancelled');
            });

            it('should do nothing if no batch processing is running', () => {
                ocrService.cancelBatchProcessing();

                expect(mockLog.info).not.toHaveBeenCalledWith('Batch OCR processing cancelled');
            });
        });
    });
});
