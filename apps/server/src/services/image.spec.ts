import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockImageService = {
    saveImage: vi.fn(),
    saveImageToAttachment: vi.fn(),
    updateImage: vi.fn()
};

const mockOptions = {
    getOptionBool: vi.fn()
};

const mockLog = { info: vi.fn(), error: vi.fn() };

vi.mock('@triliumnext/core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@triliumnext/core')>();
    return {
        ...actual,
        imageService: mockImageService,
        options: mockOptions,
        getLog: () => mockLog
    };
});

const mockOcrService = {
    processNoteOCR: vi.fn().mockResolvedValue(null),
    processAttachmentOCR: vi.fn().mockResolvedValue(null)
};

vi.mock('./ocr/ocr_service.js', () => ({
    default: mockOcrService
}));

let image: typeof import('./image.js').default;

/** Resolves once any pending setImmediate-scheduled callbacks have run. */
function flushImmediate(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
}

beforeEach(async () => {
    vi.clearAllMocks();
    mockOptions.getOptionBool.mockReturnValue(true);
    mockOcrService.processNoteOCR.mockResolvedValue(null);
    mockOcrService.processAttachmentOCR.mockResolvedValue(null);
    ({ default: image } = await import('./image.js'));
});

afterEach(() => {
    vi.restoreAllMocks();
});

const data = new Uint8Array([1, 2, 3]);

describe('server image service', () => {
    describe('saveImage', () => {
        it('delegates to the core service and schedules note OCR', async () => {
            mockImageService.saveImage.mockReturnValue({ noteId: 'note1', branch: {} });

            const result = image.saveImage('parent1', data, 'pic.png', true, false);

            expect(result).toEqual({ noteId: 'note1', branch: {} });
            expect(mockImageService.saveImage).toHaveBeenCalledWith(
                'parent1', data, 'pic.png', true, false
            );
            await flushImmediate();
            expect(mockOcrService.processNoteOCR).toHaveBeenCalledWith('note1');
        });

        it('does not schedule OCR when auto-processing is disabled', async () => {
            mockOptions.getOptionBool.mockReturnValue(false);
            mockImageService.saveImage.mockReturnValue({ noteId: 'note1' });

            image.saveImage('parent1', data, 'pic.png', true);

            await flushImmediate();
            expect(mockOcrService.processNoteOCR).not.toHaveBeenCalled();
        });

        it('logs when scheduled note OCR fails', async () => {
            mockImageService.saveImage.mockReturnValue({ noteId: 'note1' });
            mockOcrService.processNoteOCR.mockRejectedValue(new Error('ocr fail'));

            image.saveImage('parent1', data, 'pic.png', true);

            await flushImmediate();
            await flushImmediate();
            expect(mockLog.error).toHaveBeenCalledWith(
                expect.stringContaining('Failed to process OCR for note note1')
            );
        });
    });

    describe('saveImageToAttachment', () => {
        it('delegates to the core service and schedules attachment OCR', async () => {
            mockImageService.saveImageToAttachment.mockReturnValue({ attachmentId: 'att1' });

            const result = image.saveImageToAttachment('note1', data, 'pic.png', true, false);

            expect(result).toEqual({ attachmentId: 'att1' });
            await flushImmediate();
            expect(mockOcrService.processAttachmentOCR).toHaveBeenCalledWith('att1');
        });

        it('does not schedule OCR when there is no attachment id', async () => {
            mockImageService.saveImageToAttachment.mockReturnValue({ attachmentId: undefined });

            image.saveImageToAttachment('note1', data, 'pic.png');

            await flushImmediate();
            expect(mockOcrService.processAttachmentOCR).not.toHaveBeenCalled();
        });

        it('logs when scheduled attachment OCR fails', async () => {
            mockImageService.saveImageToAttachment.mockReturnValue({ attachmentId: 'att1' });
            mockOcrService.processAttachmentOCR.mockRejectedValue(new Error('ocr fail'));

            image.saveImageToAttachment('note1', data, 'pic.png', true);

            await flushImmediate();
            await flushImmediate();
            expect(mockLog.error).toHaveBeenCalledWith(
                expect.stringContaining('Failed to process OCR for attachment att1')
            );
        });
    });

    describe('updateImage', () => {
        it('delegates to the core service and schedules note OCR', async () => {
            image.updateImage('note1', data, 'pic.png');

            expect(mockImageService.updateImage).toHaveBeenCalledWith('note1', data, 'pic.png');
            await flushImmediate();
            expect(mockOcrService.processNoteOCR).toHaveBeenCalledWith('note1');
        });
    });
});
