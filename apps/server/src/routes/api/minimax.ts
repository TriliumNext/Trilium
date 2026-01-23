import options from "../../services/options.js";
import log from "../../services/log.js";
import type { Request, Response } from "express";
import { PROVIDER_CONSTANTS } from '../../services/llm/constants/provider_constants.js';

/**
 * @swagger
 * /api/llm/providers/minimax/models:
 *   get:
 *     summary: List available models from MiniMax
 *     operationId: minimax-list-models
 *     responses:
 *       '200':
 *         description: List of available MiniMax models
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 chatModels:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       name:
 *                         type: string
 *                       type:
 *                         type: string
 *       '500':
 *         description: Error listing models
 *     security:
 *       - session: []
 *     tags: ["llm"]
 */
async function listModels(req: Request, res: Response) {
    try {
        const apiKey = await options.getOption('minimaxApiKey');

        if (!apiKey) {
            throw new Error('MiniMax API key is not configured');
        }

        log.info(`Using predefined MiniMax models list (avoiding direct API call)`);

        const chatModels = PROVIDER_CONSTANTS.MINIMAX.AVAILABLE_MODELS.map(model => ({
            id: model.id,
            name: model.name,
            type: 'chat'
        }));

        // Return the models list
        return {
            success: true,
            chatModels
        };
    } catch (error: any) {
        log.error(`Error listing MiniMax models: ${error.message || 'Unknown error'}`);

        // Properly throw the error to be handled by the global error handler
        throw new Error(`Failed to list MiniMax models: ${error.message || 'Unknown error'}`);
    }
}

export default {
    listModels
};
