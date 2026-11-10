import { ValidationError } from "@triliumnext/core";
import type { Request, Response } from "express";

import etapiMetrics from "../../etapi/metrics.js";

type MetricsData = ReturnType<typeof etapiMetrics.collectMetrics>;

/**
 * @swagger
 * /api/metrics:
 *   get:
 *     summary: Get Trilium instance metrics
 *     operationId: metrics
 *     parameters:
 *       - in: query
 *         name: format
 *         schema:
 *           type: string
 *           enum: [prometheus, json]
 *           default: prometheus
 *         description: Response format - 'prometheus' (default) for Prometheus text format, 'json' for JSON
 *     responses:
 *       '200':
 *         description: Instance metrics
 *         content:
 *           text/plain:
 *             schema:
 *               type: string
 *               example: |
 *                 # HELP trilium_info Trilium instance information
 *                 # TYPE trilium_info gauge
 *                 trilium_info{version="0.91.6",db_version="231",node_version="v18.17.0"} 1 1701432000
 *
 *                 # HELP trilium_notes_total Total number of notes including deleted
 *                 # TYPE trilium_notes_total gauge
 *                 trilium_notes_total 1234 1701432000
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 version:
 *                   type: object
 *                   properties:
 *                     app:
 *                       type: string
 *                       example: "0.91.6"
 *                     db:
 *                       type: integer
 *                       example: 231
 *                     node:
 *                       type: string
 *                       example: "v18.17.0"
 *                     sync:
 *                       type: integer
 *                       example: 35
 *                     buildDate:
 *                       type: string
 *                       example: "2024-09-07T18:36:34Z"
 *                     buildRevision:
 *                       type: string
 *                       example: "7c0d6930fa8f20d269dcfbcbc8f636a25f6bb9a7"
 *                 database:
 *                   type: object
 *                   properties:
 *                     totalNotes:
 *                       type: integer
 *                       example: 1234
 *                     deletedNotes:
 *                       type: integer
 *                       example: 56
 *                     activeNotes:
 *                       type: integer
 *                       example: 1178
 *                     protectedNotes:
 *                       type: integer
 *                       example: 23
 *                     totalAttachments:
 *                       type: integer
 *                       example: 89
 *                     deletedAttachments:
 *                       type: integer
 *                       example: 5
 *                     activeAttachments:
 *                       type: integer
 *                       example: 84
 *                     totalRevisions:
 *                       type: integer
 *                       example: 567
 *                     totalBranches:
 *                       type: integer
 *                       example: 1200
 *                     totalAttributes:
 *                       type: integer
 *                       example: 345
 *                     totalBlobs:
 *                       type: integer
 *                       example: 678
 *                     totalEtapiTokens:
 *                       type: integer
 *                       example: 3
 *                     totalRecentNotes:
 *                       type: integer
 *                       example: 50
 *                 noteTypes:
 *                   type: object
 *                   additionalProperties:
 *                     type: integer
 *                   example:
 *                     text: 800
 *                     code: 200
 *                     image: 100
 *                     file: 50
 *                 attachmentTypes:
 *                   type: object
 *                   additionalProperties:
 *                     type: integer
 *                   example:
 *                     "image/png": 45
 *                     "image/jpeg": 30
 *                     "application/pdf": 14
 *                 statistics:
 *                   type: object
 *                   properties:
 *                     oldestNote:
 *                       type: string
 *                       nullable: true
 *                       example: "2020-01-01T00:00:00.000Z"
 *                     newestNote:
 *                       type: string
 *                       nullable: true
 *                       example: "2024-12-01T12:00:00.000Z"
 *                     lastModified:
 *                       type: string
 *                       nullable: true
 *                       example: "2024-12-01T11:30:00.000Z"
 *                     databaseSizeBytes:
 *                       type: integer
 *                       nullable: true
 *                       example: 52428800
 *                 timestamp:
 *                   type: string
 *                   example: "2024-12-01T12:00:00.000Z"
 *       '400':
 *         description: Invalid format parameter
 *       '500':
 *         description: Error collecting metrics
 *     security:
 *       - session: []
 */
function getMetrics(req: Request, res: Response): string | MetricsData {
    const format = (req.query?.format as string)?.toLowerCase() || 'prometheus';

    if (format === 'json') {
        return etapiMetrics.collectMetrics();
    } else if (format === 'prometheus') {
        const metrics = etapiMetrics.collectMetrics();
        const prometheusText = etapiMetrics.formatPrometheusMetrics(metrics);
        res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
        return prometheusText;
    } else {
        throw new ValidationError("Supported formats: 'prometheus' (default), 'json'");
    }
}

export default {
    getMetrics
};
