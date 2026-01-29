import { BasePipelineStage } from '../pipeline_stage.js';
import type { ResponseProcessingInput } from '../interfaces.js';
import log from '../../../log.js';

/**
 * Pipeline stage for processing LLM responses
 */
export class ResponseProcessingStage extends BasePipelineStage<ResponseProcessingInput, { text: string }> {
    constructor() {
        super('ResponseProcessing');
    }

    /**
     * Process the LLM response
     */
    protected async process(input: ResponseProcessingInput): Promise<{ text: string }> {
        const { response, options } = input;
        log.info(`Processing LLM response from model: ${response.model}`);

        // Perform any necessary post-processing on the response text
        let text = response.text;

        // For Markdown formatting, ensure code blocks are properly formatted
        if (options?.showThinking && text.includes('thinking:')) {
            // Extract and format thinking section
            const thinkingMatch = text.match(/thinking:(.*?)(?=answer:|$)/s);
            if (thinkingMatch) {
                const thinking = thinkingMatch[1].trim();
                text = text.replace(/thinking:.*?(?=answer:|$)/s, `**Thinking:** \n\n\`\`\`\n${thinking}\n\`\`\`\n\n`);
            }
        }

        // Clean up response text
        text = text.replace(/^\s*assistant:\s*/i, ''); // Remove leading "Assistant:" if present

        // Log tokens if available for monitoring
        if (response.usage) {
            log.info(`Token usage - prompt: ${response.usage.promptTokens}, completion: ${response.usage.completionTokens}, total: ${response.usage.totalTokens}`);
        }

        return { text };
    }
}
