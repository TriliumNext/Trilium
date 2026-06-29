import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockParseOffice = vi.fn();

vi.mock('officeparser', () => ({
    OfficeParser: {
        parseOffice: mockParseOffice
    }
}));

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
const ODT = 'application/vnd.oasis.opendocument.text';
const RTF = 'application/rtf';

beforeEach(async () => {
    vi.clearAllMocks();
    ({ OfficeProcessor } = await import('./office_processor.js'));
});

afterEach(() => {
    vi.restoreAllMocks();
});

const buffer = Buffer.from('PK fake office');

describe('OfficeProcessor', () => {
    it('reports the MIME types it can process', () => {
        const processor = new OfficeProcessor();

        expect(processor.canProcess(DOCX)).toBe(true);
        expect(processor.canProcess(ODT)).toBe(true);
        expect(processor.canProcess(RTF)).toBe(true);
        expect(processor.canProcess('text/rtf')).toBe(true);
        expect(processor.canProcess('application/pdf')).toBe(false);
        expect(processor.getSupportedMimeTypes()).toContain(DOCX);
        expect(processor.getProcessingType()).toBe('office');
    });

    it('extracts text and reports high confidence when text is present', async () => {
        const processor = new OfficeProcessor();
        mockParseOffice.mockResolvedValue({ toText: () => '  document body  ' });

        const result = await processor.extractText(buffer, { mimeType: DOCX, language: 'deu' });

        expect(result.text).toBe('document body');
        expect(result.confidence).toBe(0.99);
        expect(result.pageCount).toBe(1);
        expect(result.language).toBe('deu');
        expect(mockParseOffice).toHaveBeenCalledWith(buffer, {
            outputErrorToConsole: false,
            newlineDelimiter: '\n',
            ignoreNotes: false
        });
    });

    it('passes an explicit fileType hint for RTF, whose buffer auto-detection is unreliable', async () => {
        const processor = new OfficeProcessor();
        mockParseOffice.mockResolvedValue({ toText: () => 'rtf body' });

        const result = await processor.extractText(buffer, { mimeType: RTF });

        expect(result.text).toBe('rtf body');
        expect(mockParseOffice).toHaveBeenCalledWith(buffer, {
            outputErrorToConsole: false,
            newlineDelimiter: '\n',
            ignoreNotes: false,
            fileType: 'rtf'
        });
    });

    it('reports zero confidence and defaults language when no text is extracted', async () => {
        const processor = new OfficeProcessor();
        mockParseOffice.mockResolvedValue({ toText: () => '   ' });

        const result = await processor.extractText(buffer, { mimeType: ODT });

        expect(result.text).toBe('');
        expect(result.confidence).toBe(0);
        expect(result.language).toBe('eng');
    });

    it('throws when the MIME type is missing', async () => {
        const processor = new OfficeProcessor();

        await expect(processor.extractText(buffer, {})).rejects.toThrow(
            'Unsupported MIME type for Office processor: undefined'
        );
        expect(mockParseOffice).not.toHaveBeenCalled();
    });

    it('throws when the MIME type is not supported', async () => {
        const processor = new OfficeProcessor();

        await expect(
            processor.extractText(buffer, { mimeType: 'application/pdf' })
        ).rejects.toThrow('Unsupported MIME type for Office processor: application/pdf');
    });
});
