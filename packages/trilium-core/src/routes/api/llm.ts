/**
 * The LLM endpoints' handlers. Where each is *registered* differs by runtime, so
 * only {@link getProviderModels} is in the shared route table.
 *
 * Streaming has no shared form. The server and the desktop app answer
 * `/api/llm-chat/stream` with Server-Sent Events (that route lives in
 * `apps/server`, and the desktop's custom-protocol bridge streams it too), which
 * delivers to the one client that asked. The browser build cannot: its request
 * bridge answers with a single buffered body and cannot hold a response open, so
 * it registers {@link startChatStream} instead — see `apps/standalone`'s
 * browser_routes.ts — and the chunks come back over the WebSocket-style channel.
 */

import type { LlmMessage } from "@triliumnext/commons";

import { ValidationError } from "../../errors.js";
import * as cls from "../../services/context.js";
import type { LlmProviderConfig } from "../../services/llm/types.js";
import { getLog } from "../../services/log.js";
import { safeExtractMessageAndStackFromError } from "../../services/utils/index.js";
import ws from "../../services/ws.js";

interface ProviderModelsRequest {
    provider: string;
    apiKey?: string;
    baseURL?: string;
}

interface ChatStreamRequest {
    streamId: string;
    messages: LlmMessage[];
    config?: LlmProviderConfig;
}

/**
 * List the live models for a provider described by raw credentials. Used by the
 * model-selection screen while adding or editing a provider — the config need
 * not be saved yet, so credentials come in the request body rather than by id.
 */
export async function getProviderModels(req: { body: ProviderModelsRequest }) {
    const { provider, apiKey, baseURL } = req.body;
    if (!provider) {
        throw new ValidationError("provider is required");
    }

    // Imported here rather than at module scope so the AI SDK lands in a lazy
    // chunk. This module is reachable from the shared route table, which the
    // standalone worker builds during startup — a static import would put
    // ~200 KB of provider SDK in that startup path for every user, whether or
    // not they have ever enabled the feature.
    const { listProviderModels } = await import("../../services/llm/index.js");

    try {
        return { models: await listProviderModels(provider, apiKey ?? "", baseURL) };
    } catch (error) {
        // A live-listing failure is almost always a bad credential or an
        // unreachable endpoint the user just entered — surface it as a 400 so
        // the model-selection screen shows the reason instead of a generic 500.
        throw new ValidationError(error instanceof Error ? error.message : String(error));
    }
}

/**
 * Start a chat completion whose chunks arrive as `llm-stream` messages rather
 * than in this response, which returns as soon as the completion is under way.
 *
 * The id is minted by the client rather than returned from here so it can start
 * listening before it asks — otherwise the opening chunks could arrive while the
 * request that announces the stream is still in flight.
 */
export function startChatStream(req: { body: ChatStreamRequest }) {
    const { streamId, messages, config } = req.body ?? {};
    if (!streamId) {
        throw new ValidationError("streamId is required");
    }
    if (!Array.isArray(messages) || messages.length === 0) {
        throw new ValidationError("messages array is required");
    }
    if (activeStreams.has(streamId)) {
        throw new ValidationError(`Stream '${streamId}' is already running`);
    }

    const abortController = new AbortController();
    activeStreams.set(streamId, abortController);
    // Deliberately not awaited: the completion outlives this request, and holding
    // it open would put a minutes-long provider call behind whatever timeout the
    // caller's transport imposes.
    void streamToClients(streamId, messages, config ?? {}, abortController.signal);

    return {};
}

/** Stop a completion started by {@link startChatStream}; unknown ids are a no-op. */
export function abortChatStream(req: { body: { streamId?: string } }) {
    activeStreams.get(req.body?.streamId ?? "")?.abort();
    return {};
}

/**
 * Streams in flight, by the id the client minted for each. An entry exists for
 * exactly as long as its completion is running, so it doubles as the abort
 * route's lookup and as the guard against reusing a live id.
 */
const activeStreams = new Map<string, AbortController>();

/**
 * Run the completion and broadcast its chunks, ending — whatever happens — with
 * the `llm-stream-end` that releases the client's wait.
 *
 * The chunks go to every connected client because the standalone build has no
 * way to address one: only the tab holding the database has a worker, and the
 * others hear it through a relay. The tab that asked recognises its own by id
 * and the rest ignore them.
 */
async function streamToClients(
    streamId: string,
    messages: LlmMessage[],
    config: LlmProviderConfig,
    signal: AbortSignal
): Promise<void> {
    try {
        // Imported here for the same reason as in getProviderModels: this module is
        // reachable from the shared route table that the standalone worker builds
        // during startup, and the AI SDK must stay out of that path.
        const { runChat } = await import("../../services/llm/chat.js");

        // The tools a completion may call write notes, which needs a context of
        // its own: the request that started this one has long since answered.
        await cls.init(async () => {
            for await (const chunk of runChat(messages, config, signal)) {
                ws.sendMessageToAllClients({ type: "llm-stream", streamId, chunk });
            }
        });
    } catch (error) {
        getLog().error(`LLM chat stream ${streamId} failed: ${safeExtractMessageAndStackFromError(error)}`);
        ws.sendMessageToAllClients({
            type: "llm-stream",
            streamId,
            chunk: { type: "error", error: error instanceof Error ? error.message : String(error) }
        });
    } finally {
        activeStreams.delete(streamId);
        ws.sendMessageToAllClients({ type: "llm-stream-end", streamId });
    }
}

export default {
    getProviderModels,
    startChatStream,
    abortChatStream
};
