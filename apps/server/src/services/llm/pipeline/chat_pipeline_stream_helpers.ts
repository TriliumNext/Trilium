import type { ChatCompletionOptions, NormalizedChatResponse, StreamChunk } from '../ai_interface.js';
import type { ToolLoopStages } from './chat_pipeline_tool_loop.js';
import log from '../../log.js';

export const processStreamChunk: (
    stages: ToolLoopStages,
    chunk: StreamChunk,
    options?: ChatCompletionOptions
) => Promise<StreamChunk> = async (stages, chunk, options) => {
    try {
        if (!chunk.text) {
            return chunk;
        }

        const miniResponse: NormalizedChatResponse = {
            text: chunk.text,
            model: 'streaming',
            provider: 'streaming',
            tool_calls: []
        };

        const processed = await stages.responseProcessing.execute({
            response: miniResponse,
            options: options ?? { enableTools: false }
        });

        return {
            ...chunk,
            text: processed.text
        };
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log.error(`Error processing stream chunk: ${errorMessage}`);
        return chunk;
    }
};
