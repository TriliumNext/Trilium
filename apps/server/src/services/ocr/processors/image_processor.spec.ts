import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockRecognize = vi.fn();

vi.mock('../tesseract_recognizer.js', () => ({
    default: { recognize: mockRecognize }
}));

const mockLog = {
    info: vi.fn(),
    error: vi.fn()
};

vi.mock('@triliumnext/core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@triliumnext/core')>();
    return {
        ...actual,
        getLog: () => mockLog
    };
});

let ImageProcessor: typeof import('./image_processor.js').ImageProcessor;

beforeEach(async () => {
    vi.clearAllMocks();
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
        // tesseract.js cannot decode TIFF (Leptonica built without libtiff)
        expect(processor.canProcess('image/tiff')).toBe(false);
        expect(processor.getSupportedMimeTypes()).toContain('image/png');
        expect(processor.getProcessingType()).toBe('image');
    });

    it('delegates recognition to the shared recognizer and wraps the result', async () => {
        const processor = new ImageProcessor();
        mockRecognize.mockResolvedValue({ text: 'hello world', confidence: 0.88 });

        const result = await processor.extractText(buffer, { language: 'eng' });

        expect(mockRecognize).toHaveBeenCalledWith(buffer, 'eng');
        expect(result.text).toBe('hello world');
        expect(result.confidence).toBeCloseTo(0.88);
        expect(result.language).toBe('eng');
        expect(result.pageCount).toBe(1);
    });

    it('defaults the language to eng when none is supplied', async () => {
        const processor = new ImageProcessor();
        mockRecognize.mockResolvedValue({ text: 'x', confidence: 0.5 });

        await processor.extractText(buffer);

        expect(mockRecognize).toHaveBeenCalledWith(buffer, 'eng');
    });

    it('propagates and logs recognition errors', async () => {
        const processor = new ImageProcessor();
        mockRecognize.mockRejectedValue(new Error('recognize failed'));

        await expect(processor.extractText(buffer, { language: 'eng' })).rejects.toThrow(
            'recognize failed'
        );
        expect(mockLog.error).toHaveBeenCalledWith(
            expect.stringContaining('Image OCR text extraction failed')
        );
    });
});
