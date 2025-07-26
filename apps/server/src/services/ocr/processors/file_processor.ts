import { OCRResult, OCRProcessingOptions } from '../ocr_service.js';

/**
 * Base class for file processors that extract text from different file types
 */
export abstract class FileProcessor {
    /**
     * Check if this processor can handle the given MIME type
     */
    abstract canProcess(mimeType: string): boolean;

    /**
     * Extract text from the given file buffer
     */
    abstract extractText(buffer: Buffer, options: OCRProcessingOptions): Promise<OCRResult>;

    /**
     * Get the processing type identifier
     */
    abstract getProcessingType(): string;

    /**
     * Get list of MIME types supported by this processor
     */
    abstract getSupportedMimeTypes(): string[];

    /**
     * Clean up any resources
     */
    cleanup(): Promise<void> {
        return Promise.resolve();
    }
}