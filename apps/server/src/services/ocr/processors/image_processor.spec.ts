import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock Tesseract.js so no real OCR model is ever loaded.
const mockWorker = {
    recognize: vi.fn(),
    terminate: vi.fn().mockResolvedValue(undefined)
};

const mockTesseract = {
    createWorker: vi.fn()
};

vi.mock('tesseract.js', () => ({
    default: mockTesseract
}));

// Avoid touching the real filesystem for the worker cache directory.
vi.mock('fs', () => ({
    default: {
        mkdirSync: vi.fn()
    }
}));

vi.mock('../../data_dir.js', () => ({
    default: {
        OCR_CACHE_DIR: '/tmp/trilium-ocr-test-cache'
    }
}));

const mockOptions = {
    getOption: vi.fn()
};

const mockLog = {
    info: vi.fn(),
    error: vi.fn()
};

vi.mock('@triliumnext/core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@triliumnext/core')>();
    return {
        ...actual,
        options: mockOptions,
        getLog: () => mockLog
    };
});

let ImageProcessor: typeof import('./image_processor.js').ImageProcessor;

beforeEach(async () => {
    vi.clearAllMocks();
    mockOptions.getOption.mockReturnValue('0');
    mockTesseract.createWorker.mockResolvedValue(mockWorker);
    ({ ImageProcessor } = await import('./image_processor.js'));
});

afterEach(() => {
    vi.restoreAllMocks();
});

const buffer = Buffer.from('fake-image');

describe('ImageProcessor', () => {
    it('reports the MIME types it can process', () => {
        const processor = new ImageProcessor();

        expect(processor.canProcess('image/PNG')).toBe(true);
        expect(processor.canProcess('image/jpeg')).toBe(true);
        expect(processor.canProcess('application/pdf')).toBe(false);
        expect(processor.getSupportedMimeTypes()).toContain('image/png');
        expect(processor.getProcessingType()).toBe('image');
    });

    it('extracts text and returns it untrimmed-confidence when no threshold is set', async () => {
        const processor = new ImageProcessor();
        mockWorker.recognize.mockResolvedValue({
            data: { text: '  hello world  ', confidence: 88, words: [] }
        });

        const result = await processor.extractText(buffer, { language: 'eng' });

        expect(result.text).toBe('hello world');
        expect(result.confidence).toBeCloseTo(0.88);
        expect(result.language).toBe('eng');
        expect(result.pageCount).toBe(1);
        expect(mockTesseract.createWorker).toHaveBeenCalledWith(
            'eng',
            1,
            expect.objectContaining({ cachePath: '/tmp/trilium-ocr-test-cache' })
        );
    });

    it('defaults the language to eng when none is supplied', async () => {
        const processor = new ImageProcessor();
        mockWorker.recognize.mockResolvedValue({
            data: { text: 'x', confidence: 50, words: [] }
        });

        await processor.extractText(buffer);

        expect(mockTesseract.createWorker).toHaveBeenCalledWith('eng', 1, expect.anything());
    });

    it('reuses the worker for the same language and recreates it when the language changes', async () => {
        const processor = new ImageProcessor();
        mockWorker.recognize.mockResolvedValue({
            data: { text: 'a', confidence: 50, words: [] }
        });

        await processor.extractText(buffer, { language: 'eng' });
        await processor.extractText(buffer, { language: 'eng' });
        expect(mockTesseract.createWorker).toHaveBeenCalledTimes(1);
        expect(mockWorker.terminate).not.toHaveBeenCalled();

        await processor.extractText(buffer, { language: 'deu' });
        expect(mockWorker.terminate).toHaveBeenCalledTimes(1);
        expect(mockTesseract.createWorker).toHaveBeenCalledTimes(2);
    });

    it('invokes the recognizing-text logger callback', async () => {
        const processor = new ImageProcessor();
        mockWorker.recognize.mockResolvedValue({
            data: { text: 'a', confidence: 50, words: [] }
        });

        await processor.extractText(buffer, { language: 'eng' });

        const config = mockTesseract.createWorker.mock.calls[0][2];
        config.logger({ status: 'recognizing text', progress: 0.5 });
        config.logger({ status: 'loading', progress: 0.1 });

        expect(mockLog.info).toHaveBeenCalledWith(
            expect.stringContaining('Image OCR progress')
        );
    });

    it('propagates and logs recognition errors', async () => {
        const processor = new ImageProcessor();
        mockWorker.recognize.mockRejectedValue(new Error('recognize failed'));

        await expect(processor.extractText(buffer, { language: 'eng' })).rejects.toThrow(
            'recognize failed'
        );
        expect(mockLog.error).toHaveBeenCalledWith(
            expect.stringContaining('Image OCR text extraction failed')
        );
    });

    describe('confidence filtering', () => {
        it('keeps only words above the configured threshold', async () => {
            mockOptions.getOption.mockReturnValue('0.8');
            const processor = new ImageProcessor();
            mockWorker.recognize.mockResolvedValue({
                data: {
                    text: 'good bad good',
                    confidence: 70,
                    words: [
                        { text: 'good', confidence: 90 },
                        { text: 'bad', confidence: 50 },
                        { text: 'good', confidence: 95 }
                    ]
                }
            });

            const result = await processor.extractText(buffer, { language: 'eng' });

            expect(result.text).toBe('good good');
            expect(result.confidence).toBeCloseTo((0.9 + 0.95) / 2);
        });

        it('returns empty confidence when no words pass the threshold', async () => {
            mockOptions.getOption.mockReturnValue('0.99');
            const processor = new ImageProcessor();
            mockWorker.recognize.mockResolvedValue({
                data: {
                    text: 'low',
                    confidence: 10,
                    words: [{ text: 'low', confidence: 10 }]
                }
            });

            const result = await processor.extractText(buffer, { language: 'eng' });

            expect(result.text).toBe('');
            expect(result.confidence).toBe(0);
        });

        it('handles an empty word array with a threshold set', async () => {
            mockOptions.getOption.mockReturnValue('0.5');
            const processor = new ImageProcessor();
            mockWorker.recognize.mockResolvedValue({
                data: { text: 'ignored', confidence: 80, words: [] }
            });

            const result = await processor.extractText(buffer, { language: 'eng' });

            expect(result.text).toBe('');
            expect(result.confidence).toBe(0);
        });

        it('falls back to overall confidence when there is no word-level data', async () => {
            mockOptions.getOption.mockReturnValue('0.5');
            const processor = new ImageProcessor();
            mockWorker.recognize.mockResolvedValue({
                data: { text: '  whole text  ', confidence: 80, words: undefined }
            });

            const result = await processor.extractText(buffer, { language: 'eng' });

            expect(result.text).toBe('whole text');
            expect(result.confidence).toBeCloseTo(0.8);
        });

        it('drops all text via the fallback when overall confidence is too low', async () => {
            mockOptions.getOption.mockReturnValue('0.9');
            const processor = new ImageProcessor();
            mockWorker.recognize.mockResolvedValue({
                data: { text: 'whole text', confidence: 40, words: undefined }
            });

            const result = await processor.extractText(buffer, { language: 'eng' });

            expect(result.text).toBe('');
            expect(result.confidence).toBeCloseTo(0.4);
            expect(mockLog.info).toHaveBeenCalledWith(
                expect.stringContaining('Entire text filtered out')
            );
        });

        it('defaults the threshold to 0 when the option is null', async () => {
            mockOptions.getOption.mockReturnValue(null);
            const processor = new ImageProcessor();
            mockWorker.recognize.mockResolvedValue({
                data: { text: 'kept', confidence: 30, words: [{ text: 'kept', confidence: 30 }] }
            });

            const result = await processor.extractText(buffer, { language: 'eng' });

            expect(result.text).toBe('kept');
        });
    });
});
