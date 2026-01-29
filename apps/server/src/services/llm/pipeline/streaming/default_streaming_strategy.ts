import type { FollowUpStreamingContext, StreamingContext, StreamingDecision, StreamingStrategy } from './streaming_strategy.js';

export class DefaultStreamingStrategy implements StreamingStrategy {
    resolveInitialStreaming(context: StreamingContext): StreamingDecision {
        const {
            configEnableStreaming,
            format,
            optionStream,
            hasStreamCallback,
            providerName,
            toolsEnabled
        } = context;

        let clientStream = optionStream;

        if (hasStreamCallback) {
            clientStream = true;
        } else if (optionStream === true) {
            clientStream = true;
        } else if (format === 'stream') {
            clientStream = true;
        } else if (optionStream === false) {
            clientStream = false;
        } else {
            clientStream = configEnableStreaming;
        }

        const normalizedProvider = (providerName || '').toLowerCase();
        const providerStream = normalizedProvider === 'minimax' && toolsEnabled
            ? false
            : clientStream;

        return {
            clientStream,
            providerStream
        };
    }

    resolveFollowUpStreaming(context: FollowUpStreamingContext): boolean {
        return false;
    }
}
