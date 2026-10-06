import type { LlmMessage } from "@triliumnext/commons";
import type { LlmProviderConfig } from "@triliumnext/core/src/services/llm/types.js";
import type { Request, Response } from "express";

interface ChatRequest {
    messages: LlmMessage[];
    config?: LlmProviderConfig;
}

/** Silence after which `streamChat` writes an SSE comment so idle proxies keep the socket. */
export const SSE_HEARTBEAT_MS = 30_000;

/** SSE comment frame. EventSource and the client's `data:` parser ignore it. */
export const SSE_HEARTBEAT_FRAME = ":\n\n";

/**
 * SSE endpoint for streaming chat completions.
 *
 * Response format (Server-Sent Events):
 * data: {"type":"text","content":"Hello"}
 * data: {"type":"text","content":" world"}
 * data: {"type":"done"}
 *
 * On error:
 * data: {"type":"error","error":"Error message"}
 *
 * nginx/ALB drop an idle response at 60s. After 30s without a chunk the handler
 * writes an SSE comment (`:\n\n`) that the client ignores.
 */
async function streamChat(req: Request, res: Response) {
    const { messages, config = {} } = req.body as ChatRequest;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
        res.status(400).json({ error: "messages array is required" });
        return;
    }

    // Set up SSE headers - disable compression and buffering for real-time streaming
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // Disable nginx buffering
    res.flushHeaders();

    // Mark response as handled to prevent double-handling by apiResultHandler
    res.triliumResponseHandled = true;

    // Type assertion for flush method (available when compression is used)
    const flushableRes = res as Response & { flush?: () => void };

    // Abort the provider turn when the client disconnects, so a closed tab
    // does not leave an agent loop running. Aborting `runChat` does not always
    // settle at once, so the heartbeat stops here rather than in `finally`.
    const abortController = new AbortController();

    let stopped = false;
    const writeFrame = (frame: string) => {
        if (stopped) {
            return;
        }
        res.write(frame);
        if (typeof flushableRes.flush === "function") {
            flushableRes.flush();
        }
    };

    const heartbeat = startSseHeartbeat(() => writeFrame(SSE_HEARTBEAT_FRAME));
    res.on("close", () => {
        stopped = true;
        heartbeat.stop();
        abortController.abort();
    });

    try {
        // Imported here rather than at module scope so the chat pipeline and
        // the provider SDKs land in lazy chunks (the same convention as
        // getProviderModels in core's routes/api/llm.ts).
        const { runChat } = await import("@triliumnext/core/src/services/llm/chat.js");
        for await (const chunk of runChat(messages, config, abortController.signal)) {
            writeFrame(`data: ${JSON.stringify(chunk)}\n\n`);
            heartbeat.reset();
        }
    } finally {
        stopped = true;
        heartbeat.stop();
        res.end();
    }
}

function startSseHeartbeat(send: () => void) {
    let timer: ReturnType<typeof setInterval> | undefined;
    const arm = () => {
        if (timer !== undefined) {
            clearInterval(timer);
        }
        timer = setInterval(send, SSE_HEARTBEAT_MS);
    };
    arm();
    return {
        reset: arm,
        stop() {
            if (timer !== undefined) {
                clearInterval(timer);
                timer = undefined;
            }
        }
    };
}

export default {
    streamChat
};
