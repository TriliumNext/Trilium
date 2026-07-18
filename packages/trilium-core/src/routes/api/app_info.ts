import appInfo from "../../services/app_info.js";

/**
 * @swagger
 * /api/app-info:
 *   get:
 *     summary: Get installation info
 *     operationId: app-info
 *     externalDocs:
 *       description: Server implementation
 *       url: https://github.com/TriliumNext/Trilium/blob/v0.91.6/src/services/app_info.ts
 *     responses:
 *       '200':
 *         description: Installation info
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 appVersion:
 *                   type: string
 *                   example: "0.91.6"
 *                 dbVersion:
 *                   type: integer
 *                   example: 228
 *                 nodeVersion:
 *                   type: string
 *                   description: "value of process.version"
 *                 syncVersion:
 *                   type: integer
 *                   example: 34
 *                 buildDate:
 *                   type: string
 *                   example: "2024-09-07T18:36:34Z"
 *                 buildRevision:
 *                   type: string
 *                   example: "7c0d6930fa8f20d269dcfbcbc8f636a25f6bb9a7"
 *                 dataDirectory:
 *                   type: string
 *                   example: "/var/lib/trilium"
 *                 clipperProtocolVersion:
 *                   type: string
 *                   example: "1.0"
 *                 utcDateTime:
 *                   $ref: '#/components/schemas/UtcDateTime'
 *     security:
 *       - session: []
 */
function getAppInfo() {
    return appInfo;
}

export default {
    getAppInfo
};
