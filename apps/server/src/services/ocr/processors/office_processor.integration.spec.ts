import { readFileSync } from 'fs';
import { join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Unlike office_processor.spec.ts, this suite does NOT mock officeparser. It runs
// the real parser against committed sample documents to prove that OfficeProcessor
// actually extracts the embedded text for each supported format — catching upstream
// API/output changes that a mocked unit test cannot.

const mockLog = { info: vi.fn(), error: vi.fn() };

vi.mock('@triliumnext/core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@triliumnext/core')>();
    return {
        ...actual,
        getLog: () => mockLog
    };
});

let OfficeProcessor: typeof import('./office_processor.js').OfficeProcessor;

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const ODT = 'application/vnd.oasis.opendocument.text';
const ODS = 'application/vnd.oasis.opendocument.spreadsheet';
const ODP = 'application/vnd.oasis.opendocument.presentation';
const RTF = 'application/rtf';
const EPUB = 'application/epub+zip';

const SAMPLES_DIR = join(__dirname, 'samples');

// Phrases drawn from across the shared document samples (heading, body, URL, code
// block, ordered/unordered lists, block quote, closing line). Asserting on all of
// them proves the parser walked the whole document, not just the first paragraph.
const DOCUMENT_PHRASES = [
    'Welcome to Trilium Notes!',
    'showcase some of its features',
    'https://github.com/TriliumNext',
    'void foo()',
    'First Item',
    'Second item',
    'Ludwig Wittgenstein',
    'Checkout also other examples like tables'
];

// The spreadsheet samples hold a different document (a Romanian client-account
// sheet); these header/label cells are present verbatim in both XLSX and ODS and
// also confirm UTF-8 handling of diacritics.
const SPREADSHEET_PHRASES = [
    'Sold (RON):',
    'Fișă de cont client',
    'Descriere',
    'Plată'
];

// The EPUB sample is a different document again: Charlotte Perkins Gilman's
// public-domain short story "The Yellow Wallpaper" (Project Gutenberg #1952).
// These phrases span the front matter and the story body, proving the parser
// walked the spine's XHTML chapters, not just the cover page.
const EPUB_PHRASES = [
    'The Yellow Wallpaper',
    'Charlotte Perkins Gilman',
    'John is a physician',
    'It is a big, airy room',
    'creeping women'
];

// Each sample exercises a distinct officeparser code path: DOCX -> WordParser,
// XLSX -> ExcelParser, PPTX -> PowerPointParser, ODT/ODS/ODP -> OpenOfficeParser
// (text / spreadsheet / presentation element handling), RTF -> RtfParser and
// EPUB -> EpubParser (both routed via an explicit fileType hint to bypass the
// ambiguous ZIP/PK magic bytes shared with OOXML and ODF).
const SAMPLES = [
    { label: 'DOCX', file: 'demo.docx', mimeType: DOCX, phrases: DOCUMENT_PHRASES },
    { label: 'XLSX', file: 'demo.xlsx', mimeType: XLSX, phrases: SPREADSHEET_PHRASES },
    { label: 'PPTX', file: 'demo.pptx', mimeType: PPTX, phrases: DOCUMENT_PHRASES },
    { label: 'ODT', file: 'demo.odt', mimeType: ODT, phrases: DOCUMENT_PHRASES },
    { label: 'ODS', file: 'demo.ods', mimeType: ODS, phrases: SPREADSHEET_PHRASES },
    { label: 'ODP', file: 'demo.odp', mimeType: ODP, phrases: DOCUMENT_PHRASES },
    { label: 'RTF', file: 'demo.rtf', mimeType: RTF, phrases: DOCUMENT_PHRASES },
    { label: 'EPUB', file: 'demo.epub', mimeType: EPUB, phrases: EPUB_PHRASES }
];

beforeEach(async () => {
    vi.clearAllMocks();
    ({ OfficeProcessor } = await import('./office_processor.js'));
});

describe('OfficeProcessor (integration — real officeparser)', () => {
    describe.each(SAMPLES)('$label', ({ file, mimeType, phrases }) => {
        it('extracts the embedded text with high confidence', async () => {
            const processor = new OfficeProcessor();

            const result = await processor.extractText(readSample(file), { mimeType });

            for (const phrase of phrases) {
                expect(result.text).toContain(phrase);
            }
            // Multi-paragraph output joined by the configured newline delimiter.
            expect(result.text.split('\n').length).toBeGreaterThan(5);
            expect(result.confidence).toBe(0.99);
            expect(result.pageCount).toBe(1);
            // Language defaults to English when the caller does not specify one.
            expect(result.language).toBe('eng');
        });
    });

    it('passes the caller-supplied language through to the result', async () => {
        const processor = new OfficeProcessor();

        const result = await processor.extractText(readSample('demo.docx'), {
            mimeType: DOCX,
            language: 'deu'
        });

        expect(result.language).toBe('deu');
    });

    it('extracts identical text from the DOCX and ODT renditions of the same document', async () => {
        const processor = new OfficeProcessor();

        const docx = await processor.extractText(readSample('demo.docx'), { mimeType: DOCX });
        const odt = await processor.extractText(readSample('demo.odt'), { mimeType: ODT });

        expect(docx.text).toBe(odt.text);
        expect(docx.text.length).toBeGreaterThan(500);
    });
});

function readSample(fileName: string): Buffer {
    return readFileSync(join(SAMPLES_DIR, fileName));
}
