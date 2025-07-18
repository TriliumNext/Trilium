import { Request, Response } from "express";
import ocrService from "../../services/ocr/ocr_service.js";
import log from "../../services/log.js";
import becca from "../../becca/becca.js";

/**
 * @swagger
 * /api/ocr/process-note/{noteId}:
 *   post:
 *     summary: Process OCR for a specific note
 *     operationId: ocr-process-note
 *     parameters:
 *       - name: noteId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the note to process
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               language:
 *                 type: string
 *                 description: OCR language code (e.g. 'eng', 'fra', 'deu')
 *                 default: 'eng'
 *               forceReprocess:
 *                 type: boolean
 *                 description: Force reprocessing even if OCR already exists
 *                 default: false
 *     responses:
 *       '200':
 *         description: OCR processing completed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 result:
 *                   type: object
 *                   properties:
 *                     text:
 *                       type: string
 *                     confidence:
 *                       type: number
 *                     extractedAt:
 *                       type: string
 *                     language:
 *                       type: string
 *       '400':
 *         description: Bad request - OCR disabled or unsupported file type
 *       '404':
 *         description: Note not found
 *       '500':
 *         description: Internal server error
 *     security:
 *       - session: []
 *     tags: ["ocr"]
 */
async function processNoteOCR(req: Request, res: Response) {
    try {
        const { noteId } = req.params;
        const { language = 'eng', forceReprocess = false } = req.body || {};

        if (!noteId) {
            res.status(400).json({
                success: false,
                error: 'Note ID is required'
            });
            (res as any).triliumResponseHandled = true;
            return;
        }

        // Check if OCR is enabled
        if (!ocrService.isOCREnabled()) {
            res.status(400).json({
                success: false,
                error: 'OCR is not enabled in settings'
            });
            (res as any).triliumResponseHandled = true;
            return;
        }

        // Verify note exists
        const note = becca.getNote(noteId);
        if (!note) {
            res.status(404).json({
                success: false,
                error: 'Note not found'
            });
            (res as any).triliumResponseHandled = true;
            return;
        }

        const result = await ocrService.processNoteOCR(noteId, {
            language,
            forceReprocess
        });

        if (!result) {
            res.status(400).json({
                success: false,
                error: 'Note is not an image or has unsupported format'
            });
            (res as any).triliumResponseHandled = true;
            return;
        }

        res.json({
            success: true,
            result
        });
        (res as any).triliumResponseHandled = true;

    } catch (error: unknown) {
        log.error(`Error processing OCR for note: ${error instanceof Error ? error.message : String(error)}`);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : String(error)
        });
        (res as any).triliumResponseHandled = true;
    }
}

/**
 * @swagger
 * /api/ocr/process-attachment/{attachmentId}:
 *   post:
 *     summary: Process OCR for a specific attachment
 *     operationId: ocr-process-attachment
 *     parameters:
 *       - name: attachmentId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the attachment to process
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               language:
 *                 type: string
 *                 description: OCR language code (e.g. 'eng', 'fra', 'deu')
 *                 default: 'eng'
 *               forceReprocess:
 *                 type: boolean
 *                 description: Force reprocessing even if OCR already exists
 *                 default: false
 *     responses:
 *       '200':
 *         description: OCR processing completed successfully
 *       '400':
 *         description: Bad request - OCR disabled or unsupported file type
 *       '404':
 *         description: Attachment not found
 *       '500':
 *         description: Internal server error
 *     security:
 *       - session: []
 *     tags: ["ocr"]
 */
async function processAttachmentOCR(req: Request, res: Response) {
    try {
        const { attachmentId } = req.params;
        const { language = 'eng', forceReprocess = false } = req.body || {};

        if (!attachmentId) {
            res.status(400).json({
                success: false,
                error: 'Attachment ID is required'
            });
            (res as any).triliumResponseHandled = true;
            return;
        }

        // Check if OCR is enabled
        if (!ocrService.isOCREnabled()) {
            res.status(400).json({
                success: false,
                error: 'OCR is not enabled in settings'
            });
            (res as any).triliumResponseHandled = true;
            return;
        }

        // Verify attachment exists
        const attachment = becca.getAttachment(attachmentId);
        if (!attachment) {
            res.status(404).json({
                success: false,
                error: 'Attachment not found'
            });
            (res as any).triliumResponseHandled = true;
            return;
        }

        const result = await ocrService.processAttachmentOCR(attachmentId, {
            language,
            forceReprocess
        });

        if (!result) {
            res.status(400).json({
                success: false,
                error: 'Attachment is not an image or has unsupported format'
            });
            (res as any).triliumResponseHandled = true;
            return;
        }

        res.json({
            success: true,
            result
        });
        (res as any).triliumResponseHandled = true;

    } catch (error: unknown) {
        log.error(`Error processing OCR for attachment: ${error instanceof Error ? error.message : String(error)}`);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : String(error)
        });
        (res as any).triliumResponseHandled = true;
    }
}

/**
 * @swagger
 * /api/ocr/search:
 *   get:
 *     summary: Search for text in OCR results
 *     operationId: ocr-search
 *     parameters:
 *       - name: q
 *         in: query
 *         required: true
 *         schema:
 *           type: string
 *         description: Search query text
 *     responses:
 *       '200':
 *         description: Search results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 results:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       blobId:
 *                         type: string
 *                       text:
 *                         type: string
 *       '400':
 *         description: Bad request - missing search query
 *       '500':
 *         description: Internal server error
 *     security:
 *       - session: []
 *     tags: ["ocr"]
 */
async function searchOCR(req: Request, res: Response) {
    try {
        const { q: searchText } = req.query;

        if (!searchText || typeof searchText !== 'string') {
            res.status(400).json({
                success: false,
                error: 'Search query is required'
            });
            (res as any).triliumResponseHandled = true;
            return;
        }

        const results = ocrService.searchOCRResults(searchText);

        res.json({
            success: true,
            results
        });
        (res as any).triliumResponseHandled = true;

    } catch (error: unknown) {
        log.error(`Error searching OCR results: ${error instanceof Error ? error.message : String(error)}`);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : String(error)
        });
        (res as any).triliumResponseHandled = true;
    }
}

/**
 * @swagger
 * /api/ocr/batch-process:
 *   post:
 *     summary: Process OCR for all images without existing OCR results
 *     operationId: ocr-batch-process
 *     responses:
 *       '200':
 *         description: Batch processing initiated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *       '400':
 *         description: Bad request - OCR disabled or already processing
 *       '500':
 *         description: Internal server error
 *     security:
 *       - session: []
 *     tags: ["ocr"]
 */
async function batchProcessOCR(req: Request, res: Response) {
    try {
        const result = await ocrService.startBatchProcessing();
        
        if (result.success) {
            res.json(result);
        } else {
            res.status(400).json(result);
        }
        
        (res as any).triliumResponseHandled = true;

    } catch (error: unknown) {
        log.error(`Error initiating batch OCR processing: ${error instanceof Error ? error.message : String(error)}`);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : String(error)
        });
        (res as any).triliumResponseHandled = true;
    }
}

/**
 * @swagger
 * /api/ocr/batch-progress:
 *   get:
 *     summary: Get batch OCR processing progress
 *     operationId: ocr-batch-progress
 *     responses:
 *       '200':
 *         description: Batch processing progress information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 inProgress:
 *                   type: boolean
 *                 total:
 *                   type: number
 *                 processed:
 *                   type: number
 *                 percentage:
 *                   type: number
 *                 startTime:
 *                   type: string
 *       '500':
 *         description: Internal server error
 *     security:
 *       - session: []
 *     tags: ["ocr"]
 */
async function getBatchProgress(req: Request, res: Response) {
    try {
        const progress = ocrService.getBatchProgress();
        res.json(progress);
        (res as any).triliumResponseHandled = true;
    } catch (error: unknown) {
        log.error(`Error getting batch OCR progress: ${error instanceof Error ? error.message : String(error)}`);
        res.status(500).json({
            error: error instanceof Error ? error.message : String(error)
        });
        (res as any).triliumResponseHandled = true;
    }
}

/**
 * @swagger
 * /api/ocr/stats:
 *   get:
 *     summary: Get OCR processing statistics
 *     operationId: ocr-get-stats
 *     responses:
 *       '200':
 *         description: OCR statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 stats:
 *                   type: object
 *                   properties:
 *                     totalProcessed:
 *                       type: number
 *                     imageNotes:
 *                       type: number
 *                     imageAttachments:
 *                       type: number
 *       '500':
 *         description: Internal server error
 *     security:
 *       - session: []
 *     tags: ["ocr"]
 */
async function getOCRStats(req: Request, res: Response) {
    try {
        const stats = ocrService.getOCRStats();

        res.json({
            success: true,
            stats
        });
        (res as any).triliumResponseHandled = true;

    } catch (error: unknown) {
        log.error(`Error getting OCR stats: ${error instanceof Error ? error.message : String(error)}`);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : String(error)
        });
        (res as any).triliumResponseHandled = true;
    }
}

/**
 * @swagger
 * /api/ocr/delete/{blobId}:
 *   delete:
 *     summary: Delete OCR results for a specific blob
 *     operationId: ocr-delete-results
 *     parameters:
 *       - name: blobId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the blob
 *     responses:
 *       '200':
 *         description: OCR results deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *       '400':
 *         description: Bad request - invalid parameters
 *       '500':
 *         description: Internal server error
 *     security:
 *       - session: []
 *     tags: ["ocr"]
 */
async function deleteOCRResults(req: Request, res: Response) {
    try {
        const { blobId } = req.params;

        if (!blobId) {
            res.status(400).json({
                success: false,
                error: 'Blob ID is required'
            });
            (res as any).triliumResponseHandled = true;
            return;
        }

        ocrService.deleteOCRResult(blobId);

        res.json({
            success: true,
            message: `OCR results deleted for blob ${blobId}`
        });
        (res as any).triliumResponseHandled = true;

    } catch (error: unknown) {
        log.error(`Error deleting OCR results: ${error instanceof Error ? error.message : String(error)}`);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : String(error)
        });
        (res as any).triliumResponseHandled = true;
    }
}

export default {
    processNoteOCR,
    processAttachmentOCR,
    searchOCR,
    batchProcessOCR,
    getBatchProgress,
    getOCRStats,
    deleteOCRResults
};