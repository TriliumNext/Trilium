/**
 * Running one chat completion, independent of how its chunks reach the client.
 *
 * The server writes them to a Server-Sent Events response; the standalone build
 * cannot (its request bridge answers with one buffered body) and posts them over
 * the WebSocket-style channel instead. Both drive this generator, so provider
 * resolution, pricing lookup, error logging and title generation happen once.
 */

import type { LlmMessage, LlmStreamChunk } from "@triliumnext/commons";

import { getLog } from "../log.js";
import { safeExtractMessageAndStackFromError } from "../utils/index.js";
import { generateChatTitle } from "./chat_title.js";
import { getProvider, getProviderByType, getSelectedModel, hasConfiguredProviders, type LlmProviderConfig } from "./index.js";
import { formatStreamError, streamToChunks } from "./stream.js";
import { resolveToolRegistries } from "./tools/index.js";

/**
 * Stream one assistant turn, yielding the chunks as the provider produces them.
 *
 * Never throws: a failure is yielded as an `error` chunk, because the caller has
 * usually already committed to a response by the time one happens. The sequence
 * ends with a `done` chunk only when the turn completed — an errored one stops
 * after its `error` chunk, so a caller that needs a terminator must add its own.
 *
 * @param abortSignal stops the turn early; for a chunk-native provider it aborts
 *     the agent loop itself, otherwise the stream is simply left at the next chunk.
 */
export async function* runChat(
    messages: LlmMessage[],
    config: LlmProviderConfig = {},
    abortSignal?: AbortSignal
): AsyncGenerator<LlmStreamChunk> {
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
        const pricing = selectedModel?.pricing ?? provider.getModelPricing(modelId);
        const modelDisplayName = selectedModel?.name
            ?? provider.getAvailableModels().find(m => m.id === modelId)?.name
            ?? modelId;

        // Chunk-native provider (e.g. Claude Agent): it owns its own agentic loop
        // and produces LlmStreamChunks directly, including honouring the abort.
        const chunks = provider.chatChunks
            ? provider.chatChunks(messages, config, abortSignal)
            : streamToChunks(provider.chat(messages, config), { model: modelDisplayName, provider: provider.name, pricing });

        for await (const chunk of chunks) {
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

        await generateTitleForFirstTurn(messages, config);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        getLog().error(`LLM chat stream failed: ${safeExtractMessageAndStackFromError(error)}`);
        yield { type: "error", error: errorMessage };
    }
}

/**
 * Name the chat note after the user's opening message, once the first turn is
 * answered. Best-effort: a failure here must not fail a completed chat.
 */
async function generateTitleForFirstTurn(messages: LlmMessage[], config: LlmProviderConfig): Promise<void> {
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
        await generateChatTitle(config.chatNoteId, firstText);
    } catch (err) {
        getLog().error(`Failed to generate chat title: ${safeExtractMessageAndStackFromError(err)}`);
    }
}
