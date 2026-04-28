import { getTesseractCode } from '@triliumnext/commons';

import becca from '../../becca/becca.js';
import blobService from '../blob.js';
import entityChangesService from '../entity_changes.js';
import log from '../log.js';
import options from '../options.js';
import sql from '../sql.js';
import { FileProcessor } from './processors/file_processor.js';
import { ImageProcessor } from './processors/image_processor.js';
import { OfficeProcessor } from './processors/office_processor.js';
import { PDFProcessor } from './processors/pdf_processor.js';

export interface OCRResult {
    text: string;
    confidence: number;
    extractedAt: string;
    language?: string;
    pageCount?: number;
    processingType?: string;
}

export interface OCRProcessingOptions {
    language?: string;
    forceReprocess?: boolean;
    confidence?: number;
    enablePDFTextExtraction?: boolean;
    mimeType?: string;
}

/**
 * OCR Service for extracting text from images and other OCR-able objects
 * Uses Tesseract.js for text recognition
 */
class OCRService {
    private processors: Map<string, FileProcessor> = new Map();

    constructor() {
        this.processors.set('image', new ImageProcessor());
        this.processors.set('pdf', new PDFProcessor());
        this.processors.set('office', new OfficeProcessor());
    }

    /**
     * Resolves the Tesseract language code(s) for OCR processing.
     *
     * Priority:
     * 1. Explicitly passed `language` option (e.g. from API call)
     * 2. The note's `language` label (mapped via {@link getTesseractCode})
     * 3. All enabled content languages joined with `+`
     * 4. The UI locale
     * 5. Fallback to `eng`
     */
    resolveOcrLanguage(noteId?: string, explicitLanguage?: string): string {
        // 1. Explicit language from caller
        if (explicitLanguage) {
            return explicitLanguage;
        }

        // 2. Note's language label
        if (noteId) {
            const note = becca.getNote(noteId);
            const noteLanguage = note?.getLabelValue("language");
            if (noteLanguage) {
                const code = getTesseractCode(noteLanguage);
                if (code) {
                    return code;
                }
            }
        }

        // 3. All enabled content languages
        try {
            const languagesJson = options.getOption("languages");
            const enabledLanguages = JSON.parse(languagesJson || "[]") as string[];
            if (enabledLanguages.length > 0) {
                const codes = enabledLanguages
                    .map((id) => getTesseractCode(id))
                    .filter((code): code is string => code !== null);
                // Deduplicate (e.g. en + en-GB both map to eng)
                const unique = [...new Set(codes)];
                if (unique.length > 0) {
                    return unique.join("+");
                }
            }
        } catch {
            // Fall through
        }

        // 4. UI locale
        try {
            const uiLocale = options.getOption("locale");
            if (uiLocale) {
                const code = getTesseractCode(uiLocale);
                if (code) {
                    return code;
                }
            }
        } catch {
            // Fall through
        }

        // 5. Fallback
        return "eng";
    }


    /**
     * Extract text from file buffer using appropriate processor
     */
    async extractTextFromFile(fileBuffer: Buffer, mimeType: string, options: OCRProcessingOptions = {}): Promise<OCRResult> {
        log.info(`Starting OCR text extraction for MIME type: ${mimeType} with language: ${options.language || "eng"}`);

        const processor = this.getProcessorForMimeType(mimeType);
        if (!processor) {
            throw new Error(`No processor found for MIME type: ${mimeType}`);
        }

        const result = await processor.extractText(fileBuffer, { ...options, mimeType });
        result.processingType = processor.getProcessingType();

        log.info(`OCR extraction completed. Confidence: ${Math.round(result.confidence * 100)}%, Text length: ${result.text.length}`);
        return result;
    }

    /**
     * Process OCR for a note (image type)
     */
    async processNoteOCR(noteId: string, options: OCRProcessingOptions = {}): Promise<OCRResult | null> {
        const note = becca.getNote(noteId);
        if (!note) {
            log.error(`Note ${noteId} not found`);
            return null;
        }

        return this.processEntityOCR({
            entityId: noteId,
            entityType: 'note',
            category: note.type,
            mime: note.mime,
            blobId: note.blobId,
            languageNoteId: noteId,
            getContent: () => note.getContent()
        }, options);
    }

    /**
     * Process OCR for an attachment
     */
    async processAttachmentOCR(attachmentId: string, options: OCRProcessingOptions = {}): Promise<OCRResult | null> {
        const attachment = becca.getAttachment(attachmentId);
        if (!attachment) {
            log.error(`Attachment ${attachmentId} not found`);
            return null;
        }

        return this.processEntityOCR({
            entityId: attachmentId,
            entityType: 'attachment',
            category: attachment.role,
            mime: attachment.mime,
            blobId: attachment.blobId,
            languageNoteId: attachment.ownerId,
            getContent: () => attachment.getContent()
        }, options);
    }

    /**
     * Shared OCR processing logic for both notes and attachments.
     */
    private async processEntityOCR(entity: {
        entityId: string;
        entityType: string;
        category: string;
        mime: string;
        blobId: string | undefined;
        languageNoteId: string;
        getContent: () => string | Buffer;
    }, options: OCRProcessingOptions = {}): Promise<OCRResult | null> {
        const { entityId, entityType, category, mime, blobId, languageNoteId } = entity;

        if (!['image', 'file'].includes(category)) {
            log.info(`${entityType} ${entityId} is not an image or file, skipping OCR`);
            return null;
        }

        if (!this.getProcessorForMimeType(mime)) {
            log.info(`${entityType} ${entityId} has unsupported MIME type ${mime} for text extraction, skipping`);
            return null;
        }

        if (!options.forceReprocess && this.hasStoredOCRResult(blobId)) {
            log.info(`OCR already exists for ${entityType} ${entityId}, skipping`);
            return null;
        }

        try {
            const content = entity.getContent();
            if (!content || !(content instanceof Buffer)) {
                throw new Error(`Cannot get content for ${entityType} ${entityId}`);
            }

            const language = this.resolveOcrLanguage(languageNoteId, options.language);
            const ocrResult = await this.extractTextFromFile(content, mime, { ...options, language });

            this.storeOCRResult(blobId, ocrResult);

            return ocrResult;
        } catch (error) {
            log.error(`Failed to process OCR for ${entityType} ${entityId}: ${error}`);
            throw error;
        }
    }

    /**
     * Store OCR result in blob
     */
    storeOCRResult(blobId: string | undefined, ocrResult: OCRResult): void {
        if (!blobId) {
            log.error('Cannot store OCR result: blobId is undefined');
            return;
        }

        try {
            sql.execute(`
                UPDATE blobs SET textRepresentation = ?
                WHERE blobId = ?
            `, [ocrResult.text, blobId]);

            this.putBlobEntityChange(blobId);

            log.info(`Stored OCR result for blob ${blobId}`);
        } catch (error) {
            log.error(`Failed to store OCR result for blob ${blobId}: ${error}`);
            throw error;
        }
    }

    /**
     * Check whether a blob already has a stored text representation.
     */
    private hasStoredOCRResult(blobId: string | undefined): boolean {
        if (!blobId) {
            return false;
        }

        const row = sql.getRow<{ textRepresentation: string | null }>(
            `SELECT textRepresentation FROM blobs WHERE blobId = ?`,
            [blobId]
        );

        return !!row?.textRepresentation;
    }

    // Batch processing state
    private batchProcessingState: {
        inProgress: boolean;
        total: number;
        processed: number;
        startTime?: Date;
    } = {
        inProgress: false,
        total: 0,
        processed: 0
    };

    /**
     * Start batch OCR processing with progress tracking
     */
    async startBatchProcessing(): Promise<{ success: boolean; message?: string }> {
        if (this.batchProcessingState.inProgress) {
            return { success: false, message: 'Batch processing already in progress' };
        }

        try {
            const blobsNeedingOCR = this.getBlobsNeedingOCR();

            if (blobsNeedingOCR.length === 0) {
                return { success: false, message: 'No images found that need OCR processing' };
            }

            this.batchProcessingState = {
                inProgress: true,
                total: blobsNeedingOCR.length,
                processed: 0,
                startTime: new Date()
            };

            // Start processing in background
            this.processBlobs(blobsNeedingOCR).catch(error => {
                log.error(`Batch processing failed: ${error instanceof Error ? error.message : String(error)}`);
            }).finally(() => {
                this.batchProcessingState.inProgress = false;
            });

            return { success: true };
        } catch (error) {
            log.error(`Failed to start batch processing: ${error instanceof Error ? error.message : String(error)}`);
            return { success: false, message: error instanceof Error ? error.message : String(error) };
        }
    }

    /**
     * Get batch processing progress
     */
    getBatchProgress(): { inProgress: boolean; total: number; processed: number; percentage?: number; startTime?: Date } {
        const result: { inProgress: boolean; total: number; processed: number; percentage?: number; startTime?: Date } = { ...this.batchProcessingState };
        if (result.total > 0) {
            result.percentage = (result.processed / result.total) * 100;
        }
        return result;
    }

    /**
     * Cancel batch processing
     */
    cancelBatchProcessing(): void {
        if (this.batchProcessingState.inProgress) {
            this.batchProcessingState.inProgress = false;
            log.info('Batch OCR processing cancelled');
        }
    }

    /**
     * Process a list of blobs sequentially, updating batch progress.
     */
    private async processBlobs(blobs: Array<{ entityType: 'note' | 'attachment'; entityId: string }>): Promise<void> {
        log.info(`Starting batch OCR processing of ${blobs.length} items...`);

        for (const blob of blobs) {
            if (!this.batchProcessingState.inProgress) {
                break;
            }

            try {
                await this.processOcrEntity(blob);
            } catch (error) {
                log.error(`Failed to process OCR for ${blob.entityType} ${blob.entityId}: ${error}`);
            }

            this.batchProcessingState.processed++;

            // Small delay to prevent overwhelming the system
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        log.info(`Batch OCR processing completed. Processed ${this.batchProcessingState.processed} files.`);
    }

    /**
     * Process OCR for a single entity (note or attachment) by type.
     */
    private async processOcrEntity(entity: { entityType: 'note' | 'attachment'; entityId: string }): Promise<void> {
        if (entity.entityType === 'note') {
            await this.processNoteOCR(entity.entityId);
        } else {
            await this.processAttachmentOCR(entity.entityId);
        }
    }

    /**
     * Get processor for a given MIME type
     */
    /**
     * Notifies the sync system that a blob has changed, without modifying the blob's identity.
     */
    private putBlobEntityChange(blobId: string): void {
        const blob = becca.getBlob({ blobId });
        if (!blob || !blob.blobId) return;

        const hash = blobService.calculateContentHash({
            blobId: blob.blobId,
            content: blob.content,
            textRepresentation: blob.textRepresentation,
            utcDateModified: blob.utcDateModified!
        });
        entityChangesService.putEntityChange({
            entityName: "blobs",
            entityId: blobId,
            hash,
            isErased: false,
            utcDateChanged: blob.utcDateModified,
            isSynced: true
        });
    }

    private getProcessorForMimeType(mimeType: string): FileProcessor | null {
        for (const processor of this.processors.values()) {
            if (processor.canProcess(mimeType)) {
                return processor;
            }
        }
        return null;
    }

    /**
     * Get all MIME types supported by all registered processors
     */
    getAllSupportedMimeTypes(): string[] {
        const supportedTypes = new Set<string>();

        // Gather MIME types from all registered processors
        for (const processor of this.processors.values()) {
            const processorTypes = processor.getSupportedMimeTypes();
            processorTypes.forEach(type => supportedTypes.add(type));
        }

        return Array.from(supportedTypes);
    }


    /**
     * Get blobs that need OCR processing (those without text representation)
     */
    getBlobsNeedingOCR(): Array<{ blobId: string; mimeType: string; entityType: 'note' | 'attachment'; entityId: string }> {
        try {
            const supportedMimes = this.getAllSupportedMimeTypes();
            const placeholders = supportedMimes.map(() => '?').join(', ');

            const noteBlobs = sql.getRows<{
                blobId: string;
                mimeType: string;
                entityId: string;
            }>(`
                SELECT n.blobId, n.mime as mimeType, n.noteId as entityId
                FROM notes n
                JOIN blobs b ON n.blobId = b.blobId
                WHERE (n.type = 'image' OR (n.type = 'file' AND n.mime IN (${placeholders})))
                AND n.isDeleted = 0
                AND n.blobId IS NOT NULL
                AND b.textRepresentation IS NULL
            `, supportedMimes);

            const attachmentBlobs = sql.getRows<{
                blobId: string;
                mimeType: string;
                entityId: string;
            }>(`
                SELECT a.blobId, a.mime as mimeType, a.attachmentId as entityId
                FROM attachments a
                JOIN blobs b ON a.blobId = b.blobId
                WHERE (a.role = 'image' OR (a.role = 'file' AND a.mime IN (${placeholders})))
                AND a.isDeleted = 0
                AND a.blobId IS NOT NULL
                AND b.textRepresentation IS NULL
            `, supportedMimes);

            // Combine results
            const result = [
                ...noteBlobs.map(blob => ({ ...blob, entityType: 'note' as const })),
                ...attachmentBlobs.map(blob => ({ ...blob, entityType: 'attachment' as const }))
            ];

            // Return all results (no need to filter by MIME type as we already did in the query)
            return result;
        } catch (error) {
            log.error(`Failed to get blobs needing OCR: ${error}`);
            return [];
        }
    }

}

export default new OCRService();
