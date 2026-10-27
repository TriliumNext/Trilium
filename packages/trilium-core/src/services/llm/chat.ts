/**
 * Running one chat completion, independent of how its chunks reach the client.
 *
 * The server writes them to a Server-Sent Events response; the standalone build
 * cannot (its request bridge answers with one buffered body) and posts them over
 * the WebSocket-style channel instead. Both drive this generator, so provider
 * resolution, pricing lookup, error logging and title generation happen once.
 */

import { LLM_PERMISSION_MODES, type LlmMessage, type LlmStreamChunk } from "@triliumnext/commons";

import { getLog } from "../log.js";
import { safeExtractMessageAndStackFromError } from "../utils/index.js";
import { generateChatTitle } from "./chat_title.js";
import { getProvider, getProviderByType, getSearchProviderSetup, getSelectedModel, hasConfiguredProviders, type LlmProvider, type LlmProviderConfig } from "./index.js";
import { formatStreamError, streamToChunks } from "./stream.js";
import { closeToolApprovals, openToolApprovals, type ToolApprovals } from "./tool_approval.js";
import { resolveToolRegistries, toolKind } from "./tools/index.js";

/**
 * Stream one assistant turn, yielding the chunks as the provider produces them.
 *
 * Never throws: a failure is yielded as an `error` chunk, because the caller has
 * usually already committed to a response by the time one happens. The sequence
 * ends with a `done` chunk only when the turn completed — an errored one stops
 * after its `error` chunk, so a caller that needs a terminator must add its own.
 *
 * Every tool call waits for the user, unless the chat's `permissionMode` lets it through or the
 * chat allowed its tool (`allowedTools`): it is announced as a `tool_approval_request` chunk and
 * answered through `answerToolApproval()`, keyed by `streamId`.
 *
 * @param streamId the id the client gave the turn, unique among the turns running.
 * @param abortSignal stops the turn early: the provider aborts its completion and any tool
 *     call in progress, and the stream is left at the next chunk.
 */
export async function* runChat(
    streamId: string,
    messages: LlmMessage[],
    requestConfig: LlmProviderConfig = {},
    abortSignal?: AbortSignal
): AsyncGenerator<LlmStreamChunk> {
    const allowedTools = Array.isArray(requestConfig.allowedTools)
        ? requestConfig.allowedTools.filter((name): name is string => typeof name === "string")
        : [];
    const mode = LLM_PERMISSION_MODES.find(candidate => candidate === requestConfig.permissionMode);
    const toolApprovals = openToolApprovals(streamId, abortSignal, {
        allowedTools,
        mode,
        kindOf: toolKind
    });
    if (!toolApprovals) {
        yield { type: "error", error: `Stream '${streamId}' is already running.` };
        return;
    }

    // `webSearch`, `toolApprovals` and `attachmentKinds` come from here only, never from the request.
    const config: LlmProviderConfig = {
        ...requestConfig,
        webSearch: getSearchProviderSetup(requestConfig.webSearchProviderId),
        toolApprovals,
        attachmentKinds: undefined
    };
    try {
        if (!hasConfiguredProviders()) {
            yield { type: "error", error: "No LLM providers configured. Please add a provider in Options → AI / LLM." };
            return;
        }

        // Prefer routing by the provider config id — it disambiguates multiple
        // configs of the same type (e.g. OpenAI + a self-hosted Ollama). Chats
        // saved before providerId existed fall back to type-based resolution.
        // Host-provided tool registries load lazily; the providers' synchronous
        // buildTools() reads the registry array, so it must be complete first.
        await resolveToolRegistries();

        const provider = config.providerId
            ? await getProvider(config.providerId)
            : await getProviderByType(config.provider || "anthropic");

        const modelId = config.model || provider.getAvailableModels().find(m => m.isDefault)?.id;
        if (!modelId) {
            yield { type: "error", error: "No model specified and no default model available for the provider." };
            return;
        }

        // Prefer the config's stored selection for name/pricing — it carries the
        // denormalized metadata even for dynamically discovered models the curated
        // list doesn't know. Fall back to the provider's curated list, then the id.
        const selectedModel = getSelectedModel(config.providerId, modelId);
        config.attachmentKinds = selectedModel?.attachmentKinds;
        const pricing = selectedModel?.pricing ?? provider.getModelPricing(modelId);
        const modelDisplayName = selectedModel?.name
            ?? provider.getAvailableModels().find(m => m.id === modelId)?.name
            ?? modelId;

        const describeTurn = provider.describeTurn?.bind(provider);
        const storedName = (id: string) => getSelectedModel(config.providerId, id)?.name;

        // Chunk-native provider (e.g. Claude Agent): it owns its own agentic loop
        // and produces LlmStreamChunks directly, including honouring the abort.
        const chunks = provider.chatChunks
            ? provider.chatChunks(messages, config, abortSignal)
            : streamToChunks(provider.chat(messages, config, abortSignal), {
                model: modelDisplayName,
                provider: provider.name,
                pricing,
                describeTurn: describeTurn && (steps => describeTurn(steps, modelId, storedName))
            });

        for await (const chunk of withApprovalRequests(chunks, toolApprovals)) {
            if (abortSignal?.aborted) {
                // Naming the chat is downstream of this loop, so a stopped turn
                // leaves the note on its timestamp. Said out loud, since from the
                // outside it is indistinguishable from naming having failed.
                getLog().info("Chat turn stopped by the user; leaving the chat note unnamed.");
                return;
            }
            if (chunk.type === "error") {
                // The status/URL/response body travel beside the message for the UI's
                // benefit; the log gets them rejoined onto the one line it can show.
                const described = formatStreamError({ message: chunk.error, details: chunk.errorDetails });
                getLog().error(`LLM chat stream error (model ${modelDisplayName}): ${described}`);
            }
            yield chunk;
        }

        await generateTitleForFirstTurn(messages, config, provider);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        getLog().error(`LLM chat stream failed: ${safeExtractMessageAndStackFromError(error)}`);
        yield { type: "error", error: errorMessage };
    } finally {
        closeToolApprovals(streamId);
    }
}

/**
 * Yield the provider's chunks with a `tool_approval_request` for each call that starts
 * waiting. A waiting call holds the provider's stream, so its request cannot come
 * through it.
 */
async function* withApprovalRequests(
    chunks: AsyncIterable<LlmStreamChunk>,
    toolApprovals: ToolApprovals
): AsyncGenerator<LlmStreamChunk> {
    const requests: LlmStreamChunk[] = [];
    let wake: (() => void) | undefined;
    toolApprovals.onRequest = (request) => {
        requests.push({ type: "tool_approval_request", ...request });
        wake?.();
    };

    const iterator = chunks[Symbol.asyncIterator]();
    let next = iterator.next();
    try {
        while (true) {
            const request = requests.shift();
            if (request) {
                yield request;
                continue;
            }

            const woken = new Promise<"woken">((resolve) => {
                wake = () => resolve("woken");
            });
            const result = await Promise.race([ next, woken ]);
            wake = undefined;
            if (result === "woken") {
                continue;
            }
            if (result.done) {
                return;
            }
            next = iterator.next();
            yield result.value;
        }
    } finally {
        toolApprovals.onRequest = undefined;
        // A consumer that stops early leaves `next` pending, and nothing waits on it any more.
        next.catch(() => undefined);
        void iterator.return?.()?.catch(() => undefined);
    }
}

/**
 * Name the chat note after the user's opening message, once the first turn is
 * answered. Best-effort: a failure here must not fail a completed chat.
 */
async function generateTitleForFirstTurn(messages: LlmMessage[], config: LlmProviderConfig, provider: LlmProvider): Promise<void> {
    const userMessages = messages.filter(m => m.role === "user");
    // Later turns are not a naming opportunity at all, so they pass without a word.
    if (userMessages.length !== 1) {
        return;
    }
    // Whereas a first turn that names no chat note is one: the chat is somewhere
    // the caller never told us about, and it will keep its timestamp forever.
    if (!config.chatNoteId) {
        getLog().info("Not naming this chat: the request carried no chatNoteId.");
        return;
    }

    try {
        const firstContent = userMessages[0].content;
        // Multimodal content: title from the text parts only — image bytes are
        // useless to the title model.
        const firstText = typeof firstContent === "string"
            ? firstContent
            : firstContent.filter(p => p.type === "text").map(p => p.text).join("\n").trim();
        if (!firstText) {
            getLog().info(`Not naming chat note ${config.chatNoteId}: the opening message carries no text.`);
            return;
        }
        await generateChatTitle(config.chatNoteId, firstText, provider);
    } catch (err) {
        getLog().error(`Failed to generate chat title: ${safeExtractMessageAndStackFromError(err)}`);
    }
}
