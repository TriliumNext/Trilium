import type { LlmChatConfig, LlmCitation, LlmMessage, LlmModelInfo,LlmUsage } from "@triliumnext/commons";

import server from "./server.js";

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
    onError: (error: string) => void;
    onDone: () => void;
}

/**
 * Stream a chat completion from the LLM API using Server-Sent Events.
 */
export async function streamChatCompletion(
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
                        const data = JSON.parse(line.slice(6));

                        switch (data.type) {
                            case "text":
                                callbacks.onChunk(data.content);
                                break;
                            case "thinking":
                                callbacks.onThinking?.(data.content);
                                break;
                            case "tool_input_start":
                                callbacks.onToolInputStart?.(data.toolCallId, data.toolName);
                                // Yield to force Preact to commit the pending tool call
                                // state before any deltas arrive.
                                await new Promise((r) => setTimeout(r, 1));
                                break;
                            case "tool_input_delta":
                                callbacks.onToolInputDelta?.(data.toolCallId, data.delta);
                                break;
                            case "tool_use":
                                callbacks.onToolUse?.(data.toolCallId, data.toolName, data.toolInput);
                                // Yield to force Preact to commit the pending tool call
                                // state before we process the result.
                                await new Promise((r) => setTimeout(r, 1));
                                break;
                            case "tool_result":
                                callbacks.onToolResult?.(data.toolCallId, data.toolName, data.result, data.isError);
                                await new Promise((r) => setTimeout(r, 1));
                                break;
                            case "citation":
                                if (data.citation) {
                                    callbacks.onCitation?.(data.citation);
                                }
                                break;
                            case "usage":
                                if (data.usage) {
                                    callbacks.onUsage?.(data.usage);
                                }
                                break;
                            case "error":
                                callbacks.onError(data.error);
                                break;
                            case "done":
                                callbacks.onDone();
                                break;
                        }
                    } catch (e) {
                        console.error("Failed to parse SSE data line:", line, e);
                    }
                }
            }
        }
    } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") {
            throw e;
        }
        const message = e instanceof Error ? e.message : String(e);
        callbacks.onError(`LLM stream interrupted: ${message}`);
    } finally {
        reader.releaseLock();
    }
}
