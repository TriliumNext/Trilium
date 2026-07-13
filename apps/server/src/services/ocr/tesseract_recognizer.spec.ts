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

vi.mock('../data_dir.js', () => ({
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

// A fresh singleton is imported per test so worker state never leaks between them.
let recognizer: typeof import('./tesseract_recognizer.js').default;

beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mockOptions.getOption.mockReturnValue('0');
    mockTesseract.createWorker.mockResolvedValue(mockWorker);
    recognizer = (await import('./tesseract_recognizer.js')).default;
});

afterEach(() => {
    vi.restoreAllMocks();
});

const image = Buffer.from('fake-image');

describe('TesseractRecognizer', () => {
    it('recognizes text and reports overall confidence when no threshold is set', async () => {
        mockWorker.recognize.mockResolvedValue({
            data: { text: '  hello world  ', confidence: 88, words: [] }
        });

        const result = await recognizer.recognize(image, 'eng');

        expect(result.text).toBe('hello world');
        expect(result.confidence).toBeCloseTo(0.88);
        expect(mockTesseract.createWorker).toHaveBeenCalledWith(
            'eng',
            1,
            expect.objectContaining({ cachePath: '/tmp/trilium-ocr-test-cache' })
        );
    });

    it('reuses the worker for the same language and recreates it when the language changes', async () => {
        mockWorker.recognize.mockResolvedValue({
            data: { text: 'a', confidence: 50, words: [] }
        });

        await recognizer.recognize(image, 'eng');
        await recognizer.recognize(image, 'eng');
        expect(mockTesseract.createWorker).toHaveBeenCalledTimes(1);
        expect(mockWorker.terminate).not.toHaveBeenCalled();

        await recognizer.recognize(image, 'deu');
        expect(mockWorker.terminate).toHaveBeenCalledTimes(1);
        expect(mockTesseract.createWorker).toHaveBeenCalledTimes(2);
    });

    it('invokes the recognizing-text logger callback', async () => {
        mockWorker.recognize.mockResolvedValue({
            data: { text: 'a', confidence: 50, words: [] }
        });

        await recognizer.recognize(image, 'eng');

        const config = mockTesseract.createWorker.mock.calls[0][2];
        config.logger({ status: 'recognizing text', progress: 0.5 });
        config.logger({ status: 'loading', progress: 0.1 });

        expect(mockLog.info).toHaveBeenCalledWith(
            expect.stringContaining('OCR progress')
        );
    });

    it('passes an errorHandler that logs worker errors instead of rethrowing them', async () => {
        mockWorker.recognize.mockResolvedValue({
            data: { text: 'a', confidence: 50, words: [] }
        });

        await recognizer.recognize(image, 'eng');

        // Without an errorHandler, tesseract.js turns job failures into uncaught
        // exceptions, which surface as Electron's "JavaScript error" dialog (#9754).
        const config = mockTesseract.createWorker.mock.calls[0][2];
        expect(() => config.errorHandler('Error attempting to read image.')).not.toThrow();
        expect(mockLog.error).toHaveBeenCalledWith(
            'Tesseract worker error: Error attempting to read image.'
        );
    });

    it('propagates recognition errors to the caller', async () => {
        mockWorker.recognize.mockRejectedValue(new Error('recognize failed'));

        await expect(recognizer.recognize(image, 'eng')).rejects.toThrow('recognize failed');
    });

    describe('confidence filtering', () => {
        it('keeps only words above the configured threshold', async () => {
            mockOptions.getOption.mockReturnValue('0.8');
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

            const result = await recognizer.recognize(image, 'eng');

            expect(result.text).toBe('good good');
            expect(result.confidence).toBeCloseTo((0.9 + 0.95) / 2);
        });

        it('returns empty confidence when no words pass the threshold', async () => {
            mockOptions.getOption.mockReturnValue('0.99');
            mockWorker.recognize.mockResolvedValue({
                data: {
                    text: 'low',
                    confidence: 10,
                    words: [{ text: 'low', confidence: 10 }]
                }
            });

            const result = await recognizer.recognize(image, 'eng');

            expect(result.text).toBe('');
            expect(result.confidence).toBe(0);
        });

        it('handles an empty word array with a threshold set', async () => {
            mockOptions.getOption.mockReturnValue('0.5');
            mockWorker.recognize.mockResolvedValue({
                data: { text: 'ignored', confidence: 80, words: [] }
            });

            const result = await recognizer.recognize(image, 'eng');

            expect(result.text).toBe('');
            expect(result.confidence).toBe(0);
        });

        it('falls back to overall confidence when there is no word-level data', async () => {
            mockOptions.getOption.mockReturnValue('0.5');
            mockWorker.recognize.mockResolvedValue({
                data: { text: '  whole text  ', confidence: 80, words: undefined }
            });

            const result = await recognizer.recognize(image, 'eng');

            expect(result.text).toBe('whole text');
            expect(result.confidence).toBeCloseTo(0.8);
        });

        it('drops all text via the fallback when overall confidence is too low', async () => {
            mockOptions.getOption.mockReturnValue('0.9');
            mockWorker.recognize.mockResolvedValue({
                data: { text: 'whole text', confidence: 40, words: undefined }
            });

            const result = await recognizer.recognize(image, 'eng');

            expect(result.text).toBe('');
            expect(result.confidence).toBeCloseTo(0.4);
            expect(mockLog.info).toHaveBeenCalledWith(
                expect.stringContaining('Entire text filtered out')
            );
        });

        it('defaults the threshold to 0 when the option is null', async () => {
            mockOptions.getOption.mockReturnValue(null);
            mockWorker.recognize.mockResolvedValue({
                data: { text: 'kept', confidence: 30, words: [{ text: 'kept', confidence: 30 }] }
            });

            const result = await recognizer.recognize(image, 'eng');

            expect(result.text).toBe('kept');
        });
    });
});
