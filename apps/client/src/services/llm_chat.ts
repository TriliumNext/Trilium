import type { LlmChatConfig, LlmCitation, LlmMessage, LlmModelInfo,LlmUsage } from "@triliumnext/commons";

import server from "./server.js";

/**
 * Fetch available models from all configured providers.
 */
export async function getAvailableModels(): Promise<LlmModelInfo[]> {
    const response = await server.get<{ models?: LlmModelInfo[] }>("llm-chat/models");
    return response.models ?? [];
}

export interface StreamCallbacks {
    onChunk: (text: string) => void;
    onThinking?: (text: string) => void;
    onToolInputStart?: (toolCallId: string, toolName: string) => void;
    onToolInputDelta?: (toolCallId: string, delta: string) => void;
    onToolUse?: (toolCallId: string, toolName: string, input: Record<string, unknown>, requiresApproval?: boolean) => void;
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
                                callbacks.onToolUse?.(data.toolCallId, data.toolName, data.toolInput, data.requiresApproval);
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

/**
 * Execute a mutating tool call after user approval.
 */
export async function executeToolCall(toolName: string, toolInput: Record<string, unknown>): Promise<{ result: string; isError?: boolean }> {
    const response = await server.post<{ result?: object; error?: string }>("llm-chat/execute-tool", { toolName, toolInput });

    if (response.error) {
        return { result: response.error, isError: true };
    }

    return {
        result: typeof response.result === "string" ? response.result : JSON.stringify(response.result)
    };
}
