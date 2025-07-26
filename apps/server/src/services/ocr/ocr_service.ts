import Tesseract from 'tesseract.js';
import log from '../log.js';
import sql from '../sql.js';
import becca from '../../becca/becca.js';
import options from '../options.js';
import { ImageProcessor } from './processors/image_processor.js';
import { PDFProcessor } from './processors/pdf_processor.js';
import { TIFFProcessor } from './processors/tiff_processor.js';
import { OfficeProcessor } from './processors/office_processor.js';
import { FileProcessor } from './processors/file_processor.js';

export interface OCRResult {
    text: string;
    confidence: number;
    extractedAt: string;
    language?: string;
    pageCount?: number;
}

export interface OCRProcessingOptions {
    language?: string;
    forceReprocess?: boolean;
    confidence?: number;
    enablePDFTextExtraction?: boolean;
}

interface OCRBlobRow {
    blobId: string;
    ocr_text: string;
    ocr_last_processed?: string;
}

/**
 * OCR Service for extracting text from images and other OCR-able objects
 * Uses Tesseract.js for text recognition
 */
class OCRService {
    private worker: Tesseract.Worker | null = null;
    private isProcessing = false;
    private processors: Map<string, FileProcessor> = new Map();

    constructor() {
        // Initialize file processors
        this.processors.set('image', new ImageProcessor());
        this.processors.set('pdf', new PDFProcessor());
        this.processors.set('tiff', new TIFFProcessor());
        this.processors.set('office', new OfficeProcessor());
    }

    /**
     * Check if OCR is enabled in settings
     */
    isOCREnabled(): boolean {
        try {
            return options.getOptionBool('ocrEnabled');
        } catch (error) {
            log.error(`Failed to check OCR enabled status: ${error}`);
            return false;
        }
    }

    /**
     * Check if a MIME type is supported for OCR
     */
    isSupportedMimeType(mimeType: string): boolean {
        if (!mimeType || typeof mimeType !== 'string') {
            return false;
        }

        const supportedTypes = [
            'image/jpeg',
            'image/jpg',
            'image/png',
            'image/gif',
            'image/bmp',
            'image/tiff',
            'image/webp'
        ];
        return supportedTypes.includes(mimeType.toLowerCase());
    }

    /**
     * Extract text from file buffer using appropriate processor
     */
    async extractTextFromFile(fileBuffer: Buffer, mimeType: string, options: OCRProcessingOptions = {}): Promise<OCRResult> {
        try {
            log.info(`Starting OCR text extraction for MIME type: ${mimeType}`);
            this.isProcessing = true;

            // Find appropriate processor
            const processor = this.getProcessorForMimeType(mimeType);
            if (!processor) {
                throw new Error(`No processor found for MIME type: ${mimeType}`);
            }

            const result = await processor.extractText(fileBuffer, options);

            log.info(`OCR extraction completed. Confidence: ${result.confidence}%, Text length: ${result.text.length}`);
            return result;

        } catch (error) {
            log.error(`OCR text extraction failed: ${error}`);
            throw error;
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * Process OCR for a note (image type)
     */
    async processNoteOCR(noteId: string, options: OCRProcessingOptions = {}): Promise<OCRResult | null> {
        if (!this.isOCREnabled()) {
            log.info('OCR is disabled in settings');
            return null;
        }

        const note = becca.getNote(noteId);
        if (!note) {
            log.error(`Note ${noteId} not found`);
            return null;
        }

        // Check if note type and MIME type are supported for OCR
        if (note.type === 'image') {
            if (!this.isSupportedMimeType(note.mime)) {
                log.info(`Image note ${noteId} has unsupported MIME type ${note.mime}, skipping OCR`);
                return null;
            }
        } else if (note.type === 'file') {
            // Check if file MIME type is supported by any processor
            const processor = this.getProcessorForMimeType(note.mime);
            if (!processor) {
                log.info(`File note ${noteId} has unsupported MIME type ${note.mime} for OCR, skipping`);
                return null;
            }
        } else {
            log.info(`Note ${noteId} is not an image or file note, skipping OCR`);
            return null;
        }

        // Check if OCR already exists and is up-to-date
        const existingOCR = this.getStoredOCRResult(note.blobId);
        if (existingOCR && !options.forceReprocess && note.blobId && !this.needsReprocessing(note.blobId)) {
            log.info(`OCR already exists and is up-to-date for note ${noteId}, returning cached result`);
            return existingOCR;
        }

        try {
            const content = note.getContent();
            if (!content || !(content instanceof Buffer)) {
                throw new Error(`Cannot get image content for note ${noteId}`);
            }

            const ocrResult = await this.extractTextFromFile(content, note.mime, options);

            // Store OCR result in blob
            await this.storeOCRResult(note.blobId, ocrResult);

            return ocrResult;
        } catch (error) {
            log.error(`Failed to process OCR for note ${noteId}: ${error}`);
            throw error;
        }
    }

    /**
     * Process OCR for an attachment
     */
    async processAttachmentOCR(attachmentId: string, options: OCRProcessingOptions = {}): Promise<OCRResult | null> {
        if (!this.isOCREnabled()) {
            log.info('OCR is disabled in settings');
            return null;
        }

        const attachment = becca.getAttachment(attachmentId);
        if (!attachment) {
            log.error(`Attachment ${attachmentId} not found`);
            return null;
        }

        // Check if attachment role and MIME type are supported for OCR
        if (attachment.role === 'image') {
            if (!this.isSupportedMimeType(attachment.mime)) {
                log.info(`Image attachment ${attachmentId} has unsupported MIME type ${attachment.mime}, skipping OCR`);
                return null;
            }
        } else if (attachment.role === 'file') {
            // Check if file MIME type is supported by any processor
            const processor = this.getProcessorForMimeType(attachment.mime);
            if (!processor) {
                log.info(`File attachment ${attachmentId} has unsupported MIME type ${attachment.mime} for OCR, skipping`);
                return null;
            }
        } else {
            log.info(`Attachment ${attachmentId} is not an image or file, skipping OCR`);
            return null;
        }

        // Check if OCR already exists and is up-to-date
        const existingOCR = this.getStoredOCRResult(attachment.blobId);
        if (existingOCR && !options.forceReprocess && attachment.blobId && !this.needsReprocessing(attachment.blobId)) {
            log.info(`OCR already exists and is up-to-date for attachment ${attachmentId}, returning cached result`);
            return existingOCR;
        }

        try {
            const content = attachment.getContent();
            if (!content || !(content instanceof Buffer)) {
                throw new Error(`Cannot get image content for attachment ${attachmentId}`);
            }

            const ocrResult = await this.extractTextFromFile(content, attachment.mime, options);

            // Store OCR result in blob
            await this.storeOCRResult(attachment.blobId, ocrResult);

            return ocrResult;
        } catch (error) {
            log.error(`Failed to process OCR for attachment ${attachmentId}: ${error}`);
            throw error;
        }
    }

    /**
     * Store OCR result in blob
     */
    async storeOCRResult(blobId: string | undefined, ocrResult: OCRResult): Promise<void> {
        if (!blobId) {
            log.error('Cannot store OCR result: blobId is undefined');
            return;
        }

        try {
            // Store OCR text and timestamp in blobs table
            sql.execute(`
                UPDATE blobs SET
                    ocr_text = ?,
                    ocr_last_processed = ?
                WHERE blobId = ?
            `, [
                ocrResult.text,
                new Date().toISOString(),
                blobId
            ]);

            log.info(`Stored OCR result for blob ${blobId}`);
        } catch (error) {
            log.error(`Failed to store OCR result for blob ${blobId}: ${error}`);
            throw error;
        }
    }

    /**
     * Get stored OCR result from blob
     */
    private getStoredOCRResult(blobId: string | undefined): OCRResult | null {
        if (!blobId) {
            return null;
        }

        try {
            const row = sql.getRow<{
                ocr_text: string | null;
            }>(`
                SELECT ocr_text
                FROM blobs
                WHERE blobId = ?
            `, [blobId]);

            if (!row || !row.ocr_text) {
                return null;
            }

            // Return basic OCR result from stored text
            // Note: we lose confidence, language, and extractedAt metadata
            // but gain simplicity by storing directly in blob
            return {
                text: row.ocr_text,
                confidence: 0.95, // Default high confidence for existing OCR
                extractedAt: new Date().toISOString(),
                language: 'eng'
            };
        } catch (error) {
            log.error(`Failed to get OCR result for blob ${blobId}: ${error}`);
            return null;
        }
    }

    /**
     * Search for text in OCR results
     */
    searchOCRResults(searchText: string): Array<{ blobId: string; text: string }> {
        try {
            const query = `
                SELECT blobId, ocr_text
                FROM blobs
                WHERE ocr_text LIKE ?
                AND ocr_text IS NOT NULL
            `;
            const params = [`%${searchText}%`];

            const rows = sql.getRows<OCRBlobRow>(query, params);

            return rows.map(row => ({
                blobId: row.blobId,
                text: row.ocr_text
            }));
        } catch (error) {
            log.error(`Failed to search OCR results: ${error}`);
            return [];
        }
    }

    /**
     * Delete OCR results for a blob
     */
    deleteOCRResult(blobId: string): void {
        try {
            sql.execute(`
                UPDATE blobs SET ocr_text = NULL
                WHERE blobId = ?
            `, [blobId]);

            log.info(`Deleted OCR result for blob ${blobId}`);
        } catch (error) {
            log.error(`Failed to delete OCR result for blob ${blobId}: ${error}`);
            throw error;
        }
    }

    /**
     * Process OCR for all files that don't have OCR results yet or need reprocessing
     */
    async processAllImages(): Promise<void> {
        return this.processAllBlobsNeedingOCR();
    }

    /**
     * Get OCR statistics
     */
    getOCRStats(): { totalProcessed: number; imageNotes: number; imageAttachments: number } {
        try {
            const stats = sql.getRow<{
                total_processed: number;
            }>(`
                SELECT COUNT(*) as total_processed
                FROM blobs
                WHERE ocr_text IS NOT NULL AND ocr_text != ''
            `);

            // Count image notes with OCR
            const noteStats = sql.getRow<{
                count: number;
            }>(`
                SELECT COUNT(*) as count
                FROM notes n
                JOIN blobs b ON n.blobId = b.blobId
                WHERE n.type = 'image'
                AND n.isDeleted = 0
                AND b.ocr_text IS NOT NULL AND b.ocr_text != ''
            `);

            // Count image attachments with OCR
            const attachmentStats = sql.getRow<{
                count: number;
            }>(`
                SELECT COUNT(*) as count
                FROM attachments a
                JOIN blobs b ON a.blobId = b.blobId
                WHERE a.role = 'image'
                AND a.isDeleted = 0
                AND b.ocr_text IS NOT NULL AND b.ocr_text != ''
            `);

            return {
                totalProcessed: stats?.total_processed || 0,
                imageNotes: noteStats?.count || 0,
                imageAttachments: attachmentStats?.count || 0
            };
        } catch (error) {
            log.error(`Failed to get OCR stats: ${error}`);
            return { totalProcessed: 0, imageNotes: 0, imageAttachments: 0 };
        }
    }

    /**
     * Clean up OCR service
     */
    async cleanup(): Promise<void> {
        if (this.worker) {
            await this.worker.terminate();
            this.worker = null;
        }
        log.info('OCR service cleaned up');
    }

    /**
     * Check if currently processing
     */
    isCurrentlyProcessing(): boolean {
        return this.isProcessing;
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

        if (!this.isOCREnabled()) {
            return { success: false, message: 'OCR is disabled' };
        }

        try {
            // Count total blobs needing OCR processing
            const blobsNeedingOCR = this.getBlobsNeedingOCR();
            const totalCount = blobsNeedingOCR.length;

            if (totalCount === 0) {
                return { success: false, message: 'No images found that need OCR processing' };
            }

            // Initialize batch processing state
            this.batchProcessingState = {
                inProgress: true,
                total: totalCount,
                processed: 0,
                startTime: new Date()
            };

            // Start processing in background
            this.processBatchInBackground(blobsNeedingOCR).catch(error => {
                log.error(`Batch processing failed: ${error instanceof Error ? error.message : String(error)}`);
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
     * Process batch OCR in background with progress tracking
     */
    private async processBatchInBackground(blobsToProcess: Array<{ blobId: string; mimeType: string; entityType: 'note' | 'attachment'; entityId: string }>): Promise<void> {
        try {
            log.info('Starting batch OCR processing...');

            for (const blobInfo of blobsToProcess) {
                if (!this.batchProcessingState.inProgress) {
                    break; // Stop if processing was cancelled
                }

                try {
                    if (blobInfo.entityType === 'note') {
                        await this.processNoteOCR(blobInfo.entityId);
                    } else {
                        await this.processAttachmentOCR(blobInfo.entityId);
                    }
                    this.batchProcessingState.processed++;
                    // Add small delay to prevent overwhelming the system
                    await new Promise(resolve => setTimeout(resolve, 500));
                } catch (error) {
                    log.error(`Failed to process OCR for ${blobInfo.entityType} ${blobInfo.entityId}: ${error}`);
                    this.batchProcessingState.processed++; // Count as processed even if failed
                }
            }

            // Mark as completed
            this.batchProcessingState.inProgress = false;
            log.info(`Batch OCR processing completed. Processed ${this.batchProcessingState.processed} files.`);
        } catch (error) {
            log.error(`Batch OCR processing failed: ${error}`);
            this.batchProcessingState.inProgress = false;
            throw error;
        }
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
     * Get processor for a given MIME type
     */
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
     * Check if a MIME type is supported by any processor
     */
    isSupportedByAnyProcessor(mimeType: string): boolean {
        if (!mimeType) return false;

        // Check if any processor can handle this MIME type
        const processor = this.getProcessorForMimeType(mimeType);
        return processor !== null;
    }

    /**
     * Check if blob needs OCR re-processing due to content changes
     */
    needsReprocessing(blobId: string): boolean {
        if (!blobId) {
            return false;
        }

        try {
            const blobInfo = sql.getRow<{
                utcDateModified: string;
                ocr_last_processed: string | null;
            }>(`
                SELECT utcDateModified, ocr_last_processed
                FROM blobs
                WHERE blobId = ?
            `, [blobId]);

            if (!blobInfo) {
                return false;
            }

            // If OCR was never processed, it needs processing
            if (!blobInfo.ocr_last_processed) {
                return true;
            }

            // If blob was modified after last OCR processing, it needs re-processing
            const blobModified = new Date(blobInfo.utcDateModified);
            const lastOcrProcessed = new Date(blobInfo.ocr_last_processed);

            return blobModified > lastOcrProcessed;
        } catch (error) {
            log.error(`Failed to check if blob ${blobId} needs reprocessing: ${error}`);
            return false;
        }
    }

    /**
     * Invalidate OCR results for a blob (clear ocr_text and ocr_last_processed)
     */
    invalidateOCRResult(blobId: string): void {
        if (!blobId) {
            return;
        }

        try {
            sql.execute(`
                UPDATE blobs SET
                    ocr_text = NULL,
                    ocr_last_processed = NULL
                WHERE blobId = ?
            `, [blobId]);

            log.info(`Invalidated OCR result for blob ${blobId}`);
        } catch (error) {
            log.error(`Failed to invalidate OCR result for blob ${blobId}: ${error}`);
            throw error;
        }
    }

    /**
     * Get blobs that need OCR processing (modified after last OCR or never processed)
     */
    getBlobsNeedingOCR(): Array<{ blobId: string; mimeType: string; entityType: 'note' | 'attachment'; entityId: string }> {
        try {
            // Get notes with blobs that need OCR (both image notes and file notes with supported MIME types)
            const noteBlobs = sql.getRows<{
                blobId: string;
                mimeType: string;
                entityId: string;
            }>(`
                SELECT n.blobId, n.mime as mimeType, n.noteId as entityId
                FROM notes n
                JOIN blobs b ON n.blobId = b.blobId
                WHERE (
                    n.type = 'image'
                    OR (
                        n.type = 'file'
                        AND n.mime IN (
                            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                            'application/msword',
                            'application/vnd.ms-excel',
                            'application/vnd.ms-powerpoint',
                            'application/rtf',
                            'application/pdf',
                            'image/jpeg',
                            'image/jpg',
                            'image/png',
                            'image/gif',
                            'image/bmp',
                            'image/tiff',
                            'image/webp'
                        )
                    )
                )
                AND n.isDeleted = 0
                AND n.blobId IS NOT NULL
                AND (
                    b.ocr_last_processed IS NULL
                    OR b.utcDateModified > b.ocr_last_processed
                )
            `);

            // Get attachments with blobs that need OCR (both image and file attachments with supported MIME types)
            const attachmentBlobs = sql.getRows<{
                blobId: string;
                mimeType: string;
                entityId: string;
            }>(`
                SELECT a.blobId, a.mime as mimeType, a.attachmentId as entityId
                FROM attachments a
                JOIN blobs b ON a.blobId = b.blobId
                WHERE (
                    a.role = 'image'
                    OR (
                        a.role = 'file'
                        AND a.mime IN (
                            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                            'application/msword',
                            'application/vnd.ms-excel',
                            'application/vnd.ms-powerpoint',
                            'application/rtf',
                            'application/pdf',
                            'image/jpeg',
                            'image/jpg',
                            'image/png',
                            'image/gif',
                            'image/bmp',
                            'image/tiff',
                            'image/webp'
                        )
                    )
                )
                AND a.isDeleted = 0
                AND a.blobId IS NOT NULL
                AND (
                    b.ocr_last_processed IS NULL
                    OR b.utcDateModified > b.ocr_last_processed
                )
            `);

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

    /**
     * Process OCR for all blobs that need it (auto-processing)
     */
    async processAllBlobsNeedingOCR(): Promise<void> {
        if (!this.isOCREnabled()) {
            log.info('OCR is disabled, skipping auto-processing');
            return;
        }

        const blobsNeedingOCR = this.getBlobsNeedingOCR();
        if (blobsNeedingOCR.length === 0) {
            log.info('No blobs need OCR processing');
            return;
        }

        log.info(`Auto-processing OCR for ${blobsNeedingOCR.length} blobs...`);

        for (const blobInfo of blobsNeedingOCR) {
            try {
                if (blobInfo.entityType === 'note') {
                    await this.processNoteOCR(blobInfo.entityId);
                } else {
                    await this.processAttachmentOCR(blobInfo.entityId);
                }

                // Add small delay to prevent overwhelming the system
                await new Promise(resolve => setTimeout(resolve, 100));
            } catch (error) {
                log.error(`Failed to auto-process OCR for ${blobInfo.entityType} ${blobInfo.entityId}: ${error}`);
                // Continue with other blobs
            }
        }

        log.info('Auto-processing OCR completed');
    }
}

export default new OCRService();
