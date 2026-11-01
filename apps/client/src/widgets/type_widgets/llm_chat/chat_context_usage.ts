/**
 * How full the model's context window is, and whether that is worth showing yet.
 *
 * The figure providers report (`promptTokens`) is the size of the *whole* request —
 * system prompt, every prior turn, note context, tool definitions, and only then the
 * newest message — so it climbs monotonically through a conversation and is flat and
 * uninteresting for most of one. The composer therefore shows nothing at all until it
 * approaches the point where it can affect the next reply, rather than displaying a
 * single-digit percentage for the entire life of a chat.
 */

/** Below this, the window is not close enough to matter and nothing is rendered. */
export const CONTEXT_VISIBLE_THRESHOLD = 50;
/** Above this, the indicator changes colour. */
export const CONTEXT_WARNING_THRESHOLD = 75;
/**
 * Above this, the composer says so in words instead of leaving it to a 2px bar. Overflow is a
 * hard failure rather than graceful degradation: nothing in the send path trims the
 * conversation, so the provider simply rejects the request.
 */
export const CONTEXT_CRITICAL_THRESHOLD = 90;

export type ContextUsageLevel = "neutral" | "warning" | "critical";

export interface ContextUsage {
    level: ContextUsageLevel;
    /** Share of the context window in use, 0-100, clamped at 100. */
    percentage: number;
    /** Estimated tokens the next request will carry. */
    usedTokens: number;
    contextWindow: number;
}

export interface ContextUsageInput {
    /** Prompt tokens the provider reported for the last completed request. */
    promptTokens: number;
    /** Completion tokens for that request — part of the next prompt, so they count too. */
    completionTokens: number;
    /** Estimated tokens for the unsent draft (see {@link estimateTokens}). */
    draftTokens: number;
    /** The model's advertised window. Optional: plenty of providers don't report one. */
    contextWindow?: number;
}

/**
 * Decide what, if anything, the context indicator should show.
 *
 * Returns `null` both when there is nothing worth saying and when there is no honest way
 * to say it: without a `contextWindow` there is no denominator, and inventing one (the
 * previous behaviour assumed 200k) produces a confident percentage derived from a guess.
 * Local and OpenAI-compatible providers frequently omit it, so this is a common case,
 * not an edge one.
 */
export function computeContextUsage({ promptTokens, completionTokens, draftTokens, contextWindow }: ContextUsageInput): ContextUsage | null {
    if (!contextWindow || contextWindow <= 0) {
        return null;
    }

    // What the *next* request will carry: the last prompt already covers the conversation
    // up to and including the last user message, so only the reply that followed it and
    // the current draft are still unaccounted for. Reporting `promptTokens` alone — as the
    // old indicator did — is retrospective, and understates by a whole reply.
    const usedTokens = Math.max(0, promptTokens) + Math.max(0, completionTokens) + Math.max(0, draftTokens);
    // Thresholds read the raw ratio; only the reported figure is rounded. Rounding first
    // would let a value sitting just under a threshold be nudged across it.
    const rawPercentage = Math.min((usedTokens / contextWindow) * 100, 100);

    if (rawPercentage < CONTEXT_VISIBLE_THRESHOLD) {
        return null;
    }

    const level: ContextUsageLevel = rawPercentage >= CONTEXT_CRITICAL_THRESHOLD
        ? "critical"
        : rawPercentage >= CONTEXT_WARNING_THRESHOLD
            ? "warning"
            : "neutral";

    // One decimal: enough to move a bar smoothly, and free of the float noise that makes
    // an exact 55% arrive as 55.00000000000001.
    const percentage = Math.round(rawPercentage * 10) / 10;

    return { level, percentage, usedTokens, contextWindow };
}

/**
 * Rough token count for text that hasn't been sent yet, at the usual ~4-characters-per-token
 * approximation. Deliberately crude: the real count depends on the model's tokenizer, and the
 * result drives a 2px bar and a threshold, not a billing figure.
 */
export function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

/**
 * Round a draft estimate to a coarse step.
 *
 * The draft lives in a ref precisely so typing doesn't re-render the chat tree, but the
 * indicator has to move as you type or the bar can go from hidden to critical inside a single
 * send. Quantizing means the state only actually changes about once per {@link DRAFT_TOKEN_STEP}
 * tokens typed — same-value `setState` calls bail out — which is far finer than a 2px bar can
 * show while costing a re-render roughly every hundred characters instead of every keystroke.
 */
export function quantizeDraftTokens(tokens: number): number {
    return Math.round(tokens / DRAFT_TOKEN_STEP) * DRAFT_TOKEN_STEP;
}

const DRAFT_TOKEN_STEP = 25;
