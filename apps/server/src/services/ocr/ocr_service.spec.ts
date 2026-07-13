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

vi.mock('../sql.js', () => ({
    default: mockSql
}));

// Production code now imports becca/blob/entity_changes/options/getLog from
// @triliumnext/core directly (the apps/server/src/services/* wrappers were
// removed). Partial-mock core so each piece routes back to our stub while
// the rest of core keeps its real implementation.
vi.mock('@triliumnext/core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@triliumnext/core')>();
    return {
        ...actual,
        becca: mockBecca,
        blob: mockBlobService,
        entity_changes: mockEntityChangesService,
        options: mockOptions,
        getLog: () => mockLog
    };
});

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
        processed: 0,
        failed: 0
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
            // Tesseract's 0-100 confidence is normalized to 0-1, and the processor
            // tags the result with its processing type.
            expect(result.confidence).toBeCloseTo(0.95, 2);
            expect(result.processingType).toBe('image');
        });

        it('should handle OCR recognition errors', async () => {
            const error = new Error('OCR recognition failed');
            mockWorker.recognize.mockRejectedValue(error);

            await expect(ocrService.extractTextFromFile(mockImageBuffer, 'image/jpeg')).rejects.toThrow('OCR recognition failed');
            expect(mockLog.error).toHaveBeenCalledWith('Image OCR text extraction failed: Error: OCR recognition failed');
        });

        it('should throw when no processor matches the MIME type', async () => {
            await expect(
                ocrService.extractTextFromFile(mockImageBuffer, 'text/plain')
            ).rejects.toThrow('No processor found for MIME type: text/plain');
        });
    });

    describe('resolveOcrLanguage', () => {
        it('returns the explicit language when provided', () => {
            expect(ocrService.resolveOcrLanguage('note123', 'fra')).toBe('fra');
        });

        it('uses the note language label when no explicit language', () => {
            mockBecca.getNote.mockReturnValue({
                getLabelValue: vi.fn().mockReturnValue('de')
            });
            expect(ocrService.resolveOcrLanguage('note123')).toBe('deu');
        });

        it('falls through note label when it maps to no tesseract code', () => {
            mockBecca.getNote.mockReturnValue({
                getLabelValue: vi.fn().mockReturnValue('not-a-locale')
            });
            mockOptions.getOption.mockImplementation((name: string) => {
                if (name === 'languages') return '["en","de"]';
                return '';
            });
            expect(ocrService.resolveOcrLanguage('note123')).toBe('eng+deu');
        });

        it('uses enabled content languages (deduplicated) when no note label', () => {
            mockBecca.getNote.mockReturnValue({ getLabelValue: vi.fn().mockReturnValue(null) });
            mockOptions.getOption.mockImplementation((name: string) => {
                if (name === 'languages') return '["en","en-GB","de"]';
                return '';
            });
            expect(ocrService.resolveOcrLanguage('note123')).toBe('eng+deu');
        });

        it('falls back to UI locale when the enabled languages list is empty', () => {
            mockBecca.getNote.mockReturnValue({ getLabelValue: vi.fn().mockReturnValue(null) });
            mockOptions.getOption.mockImplementation((name: string) => {
                if (name === 'languages') return '[]';
                if (name === 'locale') return 'fr';
                return '';
            });
            expect(ocrService.resolveOcrLanguage('note123')).toBe('fra');
        });

        it('defaults the languages list to empty when the option is unset', () => {
            mockBecca.getNote.mockReturnValue({ getLabelValue: vi.fn().mockReturnValue(null) });
            mockOptions.getOption.mockImplementation((name: string) => {
                if (name === 'languages') return null;
                if (name === 'locale') return 'fr';
                return '';
            });
            expect(ocrService.resolveOcrLanguage('note123')).toBe('fra');
        });

        it('falls back to UI locale when no enabled languages resolve', () => {
            mockBecca.getNote.mockReturnValue({ getLabelValue: vi.fn().mockReturnValue(null) });
            mockOptions.getOption.mockImplementation((name: string) => {
                if (name === 'languages') return '["not-a-locale"]';
                if (name === 'locale') return 'fr';
                return '';
            });
            expect(ocrService.resolveOcrLanguage('note123')).toBe('fra');
        });

        it('falls back to eng when nothing resolves and parsing throws', () => {
            mockBecca.getNote.mockReturnValue(undefined);
            mockOptions.getOption.mockImplementation((name: string) => {
                if (name === 'languages') return 'not json';
                if (name === 'locale') return 'not-a-locale';
                return '';
            });
            expect(ocrService.resolveOcrLanguage()).toBe('eng');
        });

        it('falls back to eng when the UI locale option is empty', () => {
            mockBecca.getNote.mockReturnValue(undefined);
            mockOptions.getOption.mockImplementation((name: string) => {
                if (name === 'languages') return '[]';
                if (name === 'locale') return '';
                return '';
            });
            expect(ocrService.resolveOcrLanguage()).toBe('eng');
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

        it('should skip notes that are not images or files', async () => {
            (mockNote as any).type = 'text';

            const result = await ocrService.processNoteOCR('note123');

            expect(result).toBe(null);
            expect(mockLog.info).toHaveBeenCalledWith('note note123 is not an image or file, skipping OCR');
            (mockNote as any).type = 'image';
        });

        it('should skip when OCR result already stored and not forcing', async () => {
            mockSql.getRow.mockReturnValue({ textRepresentation: 'existing' });

            const result = await ocrService.processNoteOCR('note123');

            expect(result).toBe(null);
            expect(mockLog.info).toHaveBeenCalledWith('OCR already exists for note note123, skipping');
        });

        it('should throw when content is not a Buffer', async () => {
            mockNote.getContent.mockReturnValue('not a buffer');

            await expect(ocrService.processNoteOCR('note123')).rejects.toThrow(
                'Cannot get content for note note123'
            );
            expect(mockLog.error).toHaveBeenCalledWith(
                expect.stringContaining('Failed to process OCR for note note123')
            );
        });

        it('processes a note whose blobId is undefined', async () => {
            (mockNote as any).blobId = undefined;
            mockSql.getRow.mockReturnValue(null);
            mockWorker.recognize.mockResolvedValue({
                data: { text: 'text', confidence: 90, words: [] }
            });

            const result = await ocrService.processNoteOCR('note123');

            expect(result?.text).toBe('text');
            expect(mockLog.error).toHaveBeenCalledWith('Cannot store OCR result: blobId is undefined');
            (mockNote as any).blobId = 'blob123';
        });

        it('skips storing the blob entity change when blob is missing', async () => {
            mockSql.getRow.mockReturnValue(null);
            mockBecca.getBlob.mockReturnValue(null);
            mockWorker.recognize.mockResolvedValue({
                data: { text: 'text', confidence: 90, words: [] }
            });

            const result = await ocrService.processNoteOCR('note123');

            expect(result?.text).toBe('text');
            expect(mockEntityChangesService.putEntityChange).not.toHaveBeenCalled();
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

        /**
         * `startBatchProcessing` kicks `processBlobs` off in the background and returns immediately,
         * and the real `processBlobs` parks on a 50 ms timer between items. A test that starts it and
         * walks away leaves that chain alive: it wakes up during a *later* test, and its `.finally`
         * clears `batchProcessingState.inProgress` — on whatever state object is current by then,
         * since `startBatchProcessing` replaces the object wholesale rather than mutating it. That is
         * how the `processBlobs (background)` tests below intermittently lost their second item on
         * CI, whose slower clock let the timer expire before the file was done.
         *
         * The tests using this only exercise `startBatchProcessing`'s own bookkeeping, so stub the
         * background work out and settle the chain before the test returns.
         */
        function stubBackgroundBatch() {
            let finishBatch: () => void = () => {};
            const batch = new Promise<void>((resolve) => {
                finishBatch = resolve;
            });
            vi.spyOn(ocrService as any, 'processBlobs').mockReturnValue(batch);

            return async function settleBackgroundBatch() {
                finishBatch();
                // Let the .catch()/.finally() hanging off processBlobs run before the test ends.
                await new Promise((resolve) => setImmediate(resolve));
            };
        }

        describe('startBatchProcessing', () => {
            beforeEach(() => {
                ocrService.cancelBatchProcessing();
            });

            it('should start batch processing when items are available', async () => {
                mockBlobsNeedingOCR(
                    [{ entityId: 'note1', mimeType: 'image/jpeg' }]
                );
                const settleBackgroundBatch = stubBackgroundBatch();

                const result = await ocrService.startBatchProcessing();

                expect(result).toEqual({ success: true });

                await settleBackgroundBatch();
            });

            it('should return error if batch processing already in progress', async () => {
                // First call: items for starting
                mockBlobsNeedingOCR(
                    [{ entityId: 'note1', mimeType: 'image/jpeg' }]
                );
                const settleBackgroundBatch = stubBackgroundBatch();

                void ocrService.startBatchProcessing();

                const result = await ocrService.startBatchProcessing();

                expect(result).toEqual({
                    success: false,
                    message: 'Batch processing already in progress'
                });

                await settleBackgroundBatch();
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

            it('returns failure when collecting blobs throws unexpectedly', async () => {
                vi.spyOn(ocrService, 'getBlobsNeedingOCR').mockImplementation(() => {
                    throw new Error('unexpected');
                });

                const result = await ocrService.startBatchProcessing();

                expect(result).toEqual({ success: false, message: 'unexpected' });
                expect(mockLog.error).toHaveBeenCalledWith(
                    expect.stringContaining('Failed to start batch processing: unexpected')
                );
            });

            it('stringifies non-Error failures when collecting blobs throws', async () => {
                vi.spyOn(ocrService, 'getBlobsNeedingOCR').mockImplementation(() => {
                    throw 'plain string';
                });

                const result = await ocrService.startBatchProcessing();

                expect(result).toEqual({ success: false, message: 'plain string' });
            });

            it('logs a stringified non-Error when the background batch rejects', async () => {
                vi.useFakeTimers();
                mockBlobsNeedingOCR([{ entityId: 'note1', mimeType: 'image/jpeg' }]);
                vi.spyOn(ocrService as any, 'processBlobs').mockRejectedValue('plain reject');

                await ocrService.startBatchProcessing();
                await vi.runAllTimersAsync();
                vi.useRealTimers();

                expect(mockLog.error).toHaveBeenCalledWith(
                    expect.stringContaining('Batch processing failed: plain reject')
                );
            });

            it('logs when the background batch fails', async () => {
                vi.useFakeTimers();
                mockBlobsNeedingOCR([{ entityId: 'note1', mimeType: 'image/jpeg' }]);
                vi.spyOn(ocrService as any, 'processBlobs').mockRejectedValue(
                    new Error('batch boom')
                );

                const result = await ocrService.startBatchProcessing();
                expect(result).toEqual({ success: true });

                await vi.runAllTimersAsync();
                vi.useRealTimers();

                expect(mockLog.error).toHaveBeenCalledWith(
                    expect.stringContaining('Batch processing failed: batch boom')
                );
            });
        });

        describe('getBatchProgress', () => {
            it('should return initial progress state', () => {
                const progress = ocrService.getBatchProgress();

                expect(progress.inProgress).toBe(false);
                expect(progress.total).toBe(0);
                expect(progress.processed).toBe(0);
                expect(progress.failed).toBe(0);
            });

            it('should return progress with percentage when total > 0', async () => {
                mockBlobsNeedingOCR(
                    Array.from({ length: 10 }, (_, i) => ({ entityId: `note${i}`, mimeType: 'image/jpeg' }))
                );
                const settleBackgroundBatch = stubBackgroundBatch();

                void ocrService.startBatchProcessing();

                const progress = ocrService.getBatchProgress();

                expect(progress.inProgress).toBe(true);
                expect(progress.total).toBe(10);
                expect(progress.processed).toBe(0);
                expect(progress.percentage).toBe(0);
                expect(progress.startTime).toBeInstanceOf(Date);

                await settleBackgroundBatch();
            });
        });

        describe('cancelBatchProcessing', () => {
            it('should cancel ongoing batch processing', async () => {
                mockBlobsNeedingOCR(
                    [{ entityId: 'note1', mimeType: 'image/jpeg' }]
                );
                const settleBackgroundBatch = stubBackgroundBatch();

                void ocrService.startBatchProcessing();

                expect(ocrService.getBatchProgress().inProgress).toBe(true);

                ocrService.cancelBatchProcessing();

                expect(ocrService.getBatchProgress().inProgress).toBe(false);
                expect(mockLog.info).toHaveBeenCalledWith('Batch OCR processing cancelled');

                await settleBackgroundBatch();
            });

            it('should do nothing if no batch processing is running', () => {
                ocrService.cancelBatchProcessing();

                expect(mockLog.info).not.toHaveBeenCalledWith('Batch OCR processing cancelled');
            });
        });

        describe('processBlobs (background)', () => {
            beforeEach(() => {
                vi.useFakeTimers();
                (ocrService as any).batchProcessingState = {
                    inProgress: true, total: 2, processed: 0, failed: 0
                };
            });

            afterEach(() => {
                vi.useRealTimers();
            });

            it('processes notes and attachments, counting per-item errors without aborting', async () => {
                const processNote = vi
                    .spyOn(ocrService, 'processNoteOCR')
                    .mockResolvedValue(null);
                const processAttachment = vi
                    .spyOn(ocrService, 'processAttachmentOCR')
                    .mockRejectedValue(new Error('boom'));

                const promise = (ocrService as any).processBlobs([
                    { entityType: 'note', entityId: 'n1' },
                    { entityType: 'attachment', entityId: 'a1' }
                ]);

                await vi.runAllTimersAsync();
                await promise;

                expect(processNote).toHaveBeenCalledWith('n1');
                expect(processAttachment).toHaveBeenCalledWith('a1');
                expect((ocrService as any).batchProcessingState.processed).toBe(2);
                expect((ocrService as any).batchProcessingState.failed).toBe(1);
            });

            it('stops the loop when processing is cancelled mid-way', async () => {
                vi.spyOn(ocrService, 'processNoteOCR').mockImplementation(async () => {
                    (ocrService as any).batchProcessingState.inProgress = false;
                    return null;
                });
                const processAttachment = vi.spyOn(ocrService, 'processAttachmentOCR');

                const promise = (ocrService as any).processBlobs([
                    { entityType: 'note', entityId: 'n1' },
                    { entityType: 'attachment', entityId: 'a1' }
                ]);

                await vi.runAllTimersAsync();
                await promise;

                expect(processAttachment).not.toHaveBeenCalled();
                expect((ocrService as any).batchProcessingState.processed).toBe(1);
            });
        });

        describe('getBlobsNeedingOCR', () => {
            it('returns combined note and attachment rows', () => {
                mockSql.getRows.mockReturnValueOnce([
                    { blobId: 'b1', mimeType: 'image/png', entityId: 'n1' }
                ]);
                mockSql.getRows.mockReturnValueOnce([
                    { blobId: 'b2', mimeType: 'image/jpeg', entityId: 'a1' }
                ]);

                const result = ocrService.getBlobsNeedingOCR();

                expect(result).toEqual([
                    { blobId: 'b1', mimeType: 'image/png', entityId: 'n1', entityType: 'note' },
                    { blobId: 'b2', mimeType: 'image/jpeg', entityId: 'a1', entityType: 'attachment' }
                ]);
            });

            it('selects only never-processed blobs, treating an empty result as terminal', () => {
                mockSql.getRows.mockReturnValue([]);

                ocrService.getBlobsNeedingOCR();

                // A stored empty string means "processed, found no text" and must not be
                // re-selected, otherwise a blank/text-less blob would be re-OCR'd on every
                // batch run. Both the note and attachment queries filter on NULL only.
                expect(mockSql.getRows.mock.calls).toHaveLength(2);
                for (const [sqlText] of mockSql.getRows.mock.calls) {
                    expect(sqlText).toContain('textRepresentation IS NULL');
                    expect(sqlText).not.toContain("textRepresentation = ''");
                }
            });

            it('returns empty array and logs when the query fails', () => {
                mockSql.getRows.mockImplementation(() => {
                    throw new Error('db down');
                });

                expect(ocrService.getBlobsNeedingOCR()).toEqual([]);
                expect(mockLog.error).toHaveBeenCalledWith(
                    expect.stringContaining('Failed to get blobs needing OCR')
                );
            });
        });
    });
});
