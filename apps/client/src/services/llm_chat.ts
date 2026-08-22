import type { LlmChatConfig, LlmCitation, LlmErrorDetails, LlmMessage, LlmModelInfo, LlmStreamChunk, LlmUsage, WebSocketMessage } from "@triliumnext/commons";

import server from "./server.js";
import { isStandalone, randomString } from "./utils.js";
import { subscribeToMessages, unsubscribeToMessage } from "./ws.js";

/** Credentials describing a provider whose live model list should be fetched. */
export interface ProviderModelsQuery {
    provider: string;
    apiKey?: string;
    baseURL?: string;
}

/**
 * Fetch the live model list for a provider from its credentials. Used by the
 * model-selection screen while adding or editing a provider — the config need
 * not be saved yet. A server-side failure (e.g. a bad API key) rejects with a
 * clean message the screen can display.
 */
export async function fetchProviderModels(query: ProviderModelsQuery): Promise<LlmModelInfo[]> {
    try {
        const response = await server.post<{ models?: LlmModelInfo[] }>("llm-chat/provider-models", query);
        return response.models ?? [];
    } catch (error) {
        throw new Error(serverErrorMessage(error));
    }
}

/**
 * Extract a human-readable message from a rejected `server.post`, which surfaces
 * the raw response body (a `{ "message": … }` JSON string) rather than an Error.
 */
function serverErrorMessage(error: unknown): string {
    if (typeof error === "string") {
        try {
            const parsed = JSON.parse(error);
            if (parsed && typeof parsed.message === "string") {
                return parsed.message;
            }
        } catch {
            // Not JSON — the raw string is the best message we have.
        }
        return error;
    }
    return error instanceof Error ? error.message : String(error);
}

export interface StreamCallbacks {
    onChunk: (text: string) => void;
    onThinking?: (text: string) => void;
    onToolInputStart?: (toolCallId: string, toolName: string) => void;
    onToolInputDelta?: (toolCallId: string, delta: string) => void;
    onToolUse?: (toolCallId: string, toolName: string, input: Record<string, unknown>) => void;
    onToolResult?: (toolCallId: string, toolName: string, result: string, isError?: boolean) => void;
    onCitation?: (citation: LlmCitation) => void;
    onUsage?: (usage: LlmUsage) => void;
    /**
     * @param error human-readable message.
     * @param details provider-call context (status, URL, response body), present only
     *   for failures that reached a provider — never for connection/transport errors raised here.
     */
    onError: (error: string, details?: LlmErrorDetails) => void;
    onDone: () => void;
}

/**
 * Stream a chat completion from the LLM API.
 *
 * Two transports, one contract: the completion is delivered chunk by chunk to
 * {@link StreamCallbacks} and the promise settles when it is over, rejecting with
 * an `AbortError` if `abortSignal` fired. Which transport is used depends on what
 * the backend can be reached over — see {@link streamChatOverMessages}.
 */
export function streamChatCompletion(
    messages: LlmMessage[],
    config: LlmChatConfig,
    callbacks: StreamCallbacks,
    abortSignal?: AbortSignal
): Promise<void> {
    return isStandalone
        ? streamChatOverMessages(messages, config, callbacks, abortSignal)
        : streamChatOverSse(messages, config, callbacks, abortSignal);
}

/**
 * Stream a chat completion over Server-Sent Events, the response of a request
 * that stays open for the whole completion.
 */
async function streamChatOverSse(
    messages: LlmMessage[],
    config: LlmChatConfig,
    callbacks: StreamCallbacks,
    abortSignal?: AbortSignal
): Promise<void> {
    let response: Response;
    try {
        const headers = await server.getHeaders();
        response = await fetch(`${window.glob.baseApiUrl}llm-chat/stream`, {
            method: "POST",
            headers: {
                ...headers,
                "Content-Type": "application/json"
            } as HeadersInit,
            body: JSON.stringify({ messages, config }),
            signal: abortSignal
        });
    } catch (e) {
        // AbortError is the user stopping generation — let the caller handle it.
        // Everything else (network failure, custom-protocol/CORS issues, DNS, etc.)
        // is reported via onError so the chat UI shows it instead of hanging.
        if (e instanceof DOMException && e.name === "AbortError") {
            throw e;
        }
        const message = e instanceof Error ? e.message : String(e);
        callbacks.onError(`Failed to connect to LLM stream: ${message}`);
        return;
    }

    if (!response.ok) {
        callbacks.onError(`HTTP ${response.status}: ${response.statusText}`);
        return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
        callbacks.onError("No response body");
        return;
    }

    const decoder = new TextDecoder();
    let buffer = "";
    // Why (#10883): a proxy or flaky VPN can close the SSE body *cleanly*, which
    // reads as end-of-stream here even though the server never sent its terminal
    // chunk. Treating a bare body end as completion returns the chat to idle with
    // no error anywhere — output silently dropped. Only an explicit done/error
    // chunk completes the stream; anything else is an interruption.
    let terminalChunk: "done" | "error" | null = null;
    let aborted = false;

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
                if (line.startsWith("data: ")) {
                    try {
                        const terminal = await handleChunk(JSON.parse(line.slice(6)), callbacks);
                        if (terminal) {
                            terminalChunk = terminal;
                        }
                    } catch (e) {
                        console.error("Failed to parse SSE data line:", line, e);
                    }
                }
            }
        }
    } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") {
            aborted = true;
            throw e;
        }
        const message = e instanceof Error ? e.message : String(e);
        callbacks.onError(`LLM stream interrupted: ${message}`);
        // An interruption error was already reported; don't stack the
        // missing-terminal message on top of it.
        terminalChunk = "error";
    } finally {
        if (!aborted && terminalChunk === null) {
            callbacks.onError(
                "LLM stream ended without completing — the connection closed before the response finished (network or proxy interruption)."
            );
        }
        reader.releaseLock();
    }
}

/**
 * Stream a chat completion over the WebSocket-style message channel, for the
 * standalone build: its backend runs in a worker reached through a request bridge
 * that answers with one buffered body, so a response cannot stay open. The
 * request here only starts the completion; the chunks arrive as `llm-stream`
 * messages and an `llm-stream-end` says when there are no more.
 *
 * The stream id is minted here, before the completion is asked for, so the
 * subscription is already in place when the first chunk lands. Every tab receives
 * the messages — only the leader holds the worker, and the rest hear it through a
 * relay — so the id is also what makes a tab keep just its own.
 */
async function streamChatOverMessages(
    messages: LlmMessage[],
    config: LlmChatConfig,
    callbacks: StreamCallbacks,
    abortSignal?: AbortSignal
): Promise<void> {
    const streamId = randomString(12);
    let resolveEnd: () => void = () => undefined;
    const ended = new Promise<void>((resolve) => { resolveEnd = resolve; });
    // Handlers are dispatched without being awaited, so nothing else keeps the
    // chunks in order: each is chained onto the one before it.
    let handled: Promise<void> = Promise.resolve();

    const onMessage = (message: WebSocketMessage) => {
        if (message.type === "llm-stream" && message.streamId === streamId) {
            handled = handled.then(() => handleChunk(message.chunk, callbacks));
            // Marks the link handled the moment it is made. `await handled` below
            // still rethrows, but without this a chunk handler that threw would sit
            // as an unhandled rejection until the stream ends — and in the
            // standalone build a stray rejection is reported, not ignored.
            handled.catch(() => undefined);
        } else if (message.type === "llm-stream-end" && message.streamId === streamId) {
            resolveEnd();
        }
    };
    subscribeToMessages(onMessage);

    try {
        try {
            await server.post("llm-chat/stream-start", { streamId, messages, config });
        } catch (e) {
            callbacks.onError(`Failed to start the LLM stream: ${serverErrorMessage(e)}`);
            return;
        }

        try {
            await Promise.race([ended, rejectWhenAborted(abortSignal)]);
        } catch (e) {
            // Tell the backend to stop the completion; it has no disconnect to notice.
            void server.post("llm-chat/stream-abort", { streamId }).catch(() => undefined);
            throw e;
        }

        // Chunks delivered right before the end marker may still be in the chain.
        await handled;
    } finally {
        unsubscribeToMessage(onMessage);
    }
}

/**
 * A promise that rejects the way an aborted `fetch` does, so both transports fail
 * a stopped generation identically. Never settles when there is no signal.
 */
function rejectWhenAborted(signal?: AbortSignal): Promise<never> {
    return new Promise((_resolve, reject) => {
        if (!signal) {
            return;
        }
        const fail = () => reject(new DOMException("The LLM stream was aborted.", "AbortError"));
        if (signal.aborted) {
            fail();
        } else {
            signal.addEventListener("abort", fail, { once: true });
        }
    });
}

/**
 * Dispatch one chunk to the callbacks. Shared by both transports, so a chunk means
 * the same thing however it arrived.
 */
/** Returns the stream's terminal chunk type when this chunk ends it, else null. */
async function handleChunk(chunk: LlmStreamChunk, callbacks: StreamCallbacks): Promise<"done" | "error" | null> {
    switch (chunk.type) {
        case "text":
            callbacks.onChunk(chunk.content);
            break;
        case "thinking":
            callbacks.onThinking?.(chunk.content);
            break;
        case "tool_input_start":
            callbacks.onToolInputStart?.(chunk.toolCallId, chunk.toolName);
            // Yield to force Preact to commit the pending tool call
            // state before any deltas arrive.
            await new Promise((r) => setTimeout(r, 1));
            break;
        case "tool_input_delta":
            callbacks.onToolInputDelta?.(chunk.toolCallId, chunk.delta);
            break;
        case "tool_use":
            callbacks.onToolUse?.(chunk.toolCallId, chunk.toolName, chunk.toolInput);
            // Yield to force Preact to commit the pending tool call
            // state before we process the result.
            await new Promise((r) => setTimeout(r, 1));
            break;
        case "tool_result":
            callbacks.onToolResult?.(chunk.toolCallId, chunk.toolName, chunk.result, chunk.isError);
            await new Promise((r) => setTimeout(r, 1));
            break;
        case "citation":
            if (chunk.citation) {
                callbacks.onCitation?.(chunk.citation);
            }
            break;
        case "usage":
            if (chunk.usage) {
                callbacks.onUsage?.(chunk.usage);
            }
            break;
        case "error":
            callbacks.onError(chunk.error, chunk.errorDetails);
            return "error";
        case "done":
            callbacks.onDone();
            return "done";
    }
    return null;
}
