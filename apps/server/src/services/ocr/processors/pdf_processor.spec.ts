import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetDocumentProxy = vi.fn();
const mockExtractText = vi.fn();

vi.mock('unpdf', () => ({
    getDocumentProxy: mockGetDocumentProxy,
    extractText: mockExtractText
}));

const mockLog = { info: vi.fn(), error: vi.fn() };

vi.mock('@triliumnext/core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@triliumnext/core')>();
    return {
        ...actual,
        getLog: () => mockLog
    };
});

let PDFProcessor: typeof import('./pdf_processor.js').PDFProcessor;

beforeEach(async () => {
    vi.clearAllMocks();
    mockGetDocumentProxy.mockResolvedValue({ proxy: true });
    ({ PDFProcessor } = await import('./pdf_processor.js'));
});

afterEach(() => {
    vi.restoreAllMocks();
});

const buffer = Buffer.from('%PDF-1.4 fake');

describe('PDFProcessor', () => {
    it('reports the MIME types it can process', () => {
        const processor = new PDFProcessor();

        expect(processor.canProcess('application/PDF')).toBe(true);
        expect(processor.canProcess('image/png')).toBe(false);
        expect(processor.getSupportedMimeTypes()).toEqual(['application/pdf']);
        expect(processor.getProcessingType()).toBe('pdf');
    });

    it('extracts merged text and reports high confidence when text is present', async () => {
        const processor = new PDFProcessor();
        mockExtractText.mockResolvedValue({ totalPages: 3, text: '  hello pdf  ' });

        const result = await processor.extractText(buffer, { language: 'fra' });

        expect(result.text).toBe('hello pdf');
        expect(result.confidence).toBe(0.99);
        expect(result.pageCount).toBe(3);
        expect(result.language).toBe('fra');
        expect(mockExtractText).toHaveBeenCalledWith(
            { proxy: true },
            { mergePages: true }
        );
        // buffer is wrapped into a Uint8Array carrying the SAME bytes before being passed to unpdf
        const [docArg] = mockGetDocumentProxy.mock.calls[0];
        expect(docArg).toBeInstanceOf(Uint8Array);
        expect(Buffer.from(docArg as Uint8Array).toString()).toBe('%PDF-1.4 fake');
    });

    it('reports zero confidence and defaults language when no text is extracted', async () => {
        const processor = new PDFProcessor();
        mockExtractText.mockResolvedValue({ totalPages: 1, text: '   ' });

        const result = await processor.extractText(buffer);

        expect(result.text).toBe('');
        expect(result.confidence).toBe(0);
        expect(result.language).toBe('eng');
    });
});
