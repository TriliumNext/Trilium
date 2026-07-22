import { readFileSync } from 'fs';
import { join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Unlike pdf_processor.spec.ts, this suite mocks NOTHING in the OCR chain: it runs
// the real unpdf page/image extraction, the real Jimp PNG encoding and a real
// Tesseract worker against a committed multi-page scanned (image-only) PDF. It
// proves the whole scanned-PDF pipeline actually recognizes text — catching
// upstream API/output changes and channel/rasterization bugs a mocked unit test
// cannot. Only Trilium's option/log accessors are stubbed, since they would
// otherwise need a live database.

const mockOptions = { getOption: vi.fn().mockReturnValue('0') };
const mockLog = { info: vi.fn(), error: vi.fn() };

vi.mock('@triliumnext/core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@triliumnext/core')>();
    return {
        ...actual,
        options: mockOptions,
        getLog: () => mockLog
    };
});

let PDFProcessor: typeof import('./pdf_processor.js').PDFProcessor;

const SAMPLE = join(__dirname, 'samples', 'scanned.pdf');

// The fixture (samples/scanned.pdf) is a two-page image-only PDF: each page is a
// full-page raster with no embedded text layer, so the only way to reach this text
// is through OCR. The phrases below are drawn from BOTH pages — matching phrases
// from page 1 and page 2 proves OCR ran across the whole document, not just page 1.
// Kept lowercase and short because Tesseract output is imperfect.
const EXPECTED_PHRASES = [
    'welcome to trilium notes',      // page 1
    'showcase some of its features', // page 1
    'ludwig wittgenstein',           // page 2
    'organize your thoughts'         // page 2
];

beforeEach(async () => {
    vi.clearAllMocks();
    mockOptions.getOption.mockReturnValue('0');
    ({ PDFProcessor } = await import('./pdf_processor.js'));
});

describe('PDFProcessor (integration — real OCR on a scanned multi-page PDF)', () => {
    it('recognizes text from the scanned pages via OCR', async () => {
        const processor = new PDFProcessor();

        const result = await processor.extractText(readFileSync(SAMPLE), { language: 'eng' });

        // A multi-page document was read...
        expect(result.pageCount).toBeGreaterThanOrEqual(2);
        // ...and OCR produced real, confident text (the embedded-text path would have
        // yielded nothing for an image-only PDF).
        expect(result.confidence).toBeGreaterThan(0);
        expect(result.text.length).toBeGreaterThan(0);

        const haystack = result.text.toLowerCase();
        for (const phrase of EXPECTED_PHRASES) {
            expect(haystack).toContain(phrase.toLowerCase());
        }
    }, 180_000);
});
