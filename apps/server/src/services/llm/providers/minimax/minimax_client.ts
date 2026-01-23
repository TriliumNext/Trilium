import options from '../../../options.js';
import { PROVIDER_CONSTANTS } from '../../constants/provider_constants.js';
import log from '../../../log.js';

export class MiniMaxClient {
    private client: any = null;
    private anthropicSDK: any = null;

    getClient(apiKey: string, baseUrl: string): any {
        if (!this.client) {
            const resolvedApiKey = apiKey || options.getOption('minimaxApiKey');
            const resolvedBaseUrl = baseUrl
                || options.getOption('minimaxBaseUrl')
                || PROVIDER_CONSTANTS.MINIMAX.BASE_URL;

            if (!this.anthropicSDK) {
                try {
                    this.anthropicSDK = require('@anthropic-ai/sdk');
                } catch (error) {
                    log.error(`Failed to import Anthropic SDK for MiniMax: ${error}`);
                    throw new Error(
                        'Anthropic SDK is required for MiniMax. ' +
                        'Please install it: npm install @anthropic-ai/sdk'
                    );
                }
            }

            this.client = new this.anthropicSDK.Anthropic({
                apiKey: resolvedApiKey,
                baseURL: resolvedBaseUrl,
                defaultHeaders: {
                    'anthropic-version': PROVIDER_CONSTANTS.MINIMAX.API_VERSION,
                    'Authorization': `Bearer ${resolvedApiKey}`
                }
            });

            log.info(`MiniMax client initialized with base URL: ${resolvedBaseUrl}`);
        }

        return this.client;
    }

    clear(): void {
        this.client = null;
    }
}
