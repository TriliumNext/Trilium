export interface StreamingContext {
    configEnableStreaming: boolean;
    format?: string;
    optionStream?: boolean;
    hasStreamCallback: boolean;
    providerName?: string;
    toolsEnabled: boolean;
}

export interface StreamingDecision {
    clientStream: boolean;
    providerStream: boolean;
}

export type FollowUpStreamingKind = 'tool' | 'error' | 'max_iterations' | 'final_text';

export interface FollowUpStreamingContext {
    kind: FollowUpStreamingKind;
    hasStreamCallback: boolean;
    providerName?: string;
    toolsEnabled: boolean;
}

export interface StreamingStrategy {
    resolveInitialStreaming(context: StreamingContext): StreamingDecision;
    resolveFollowUpStreaming(context: FollowUpStreamingContext): boolean;
}
