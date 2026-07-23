import type { LlmMessage, LlmStreamChunk } from "@triliumnext/commons";
import { getLog, ValidationError } from "@triliumnext/core";
import type { Request, Response } from "express";

import { generateChatTitle } from "../../services/llm/chat_title.js";
import { getProvider, getProviderByType, getSelectedModel, hasConfiguredProviders, listProviderModels, type LlmProviderConfig } from "../../services/llm/index.js";
import { streamToChunks } from "../../services/llm/stream.js";
import { safeExtractMessageAndStackFromError } from "../../services/utils.js";

interface ChatRequest {
    messages: LlmMessage[];
    config?: LlmProviderConfig;
}

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

    try {
        if (!hasConfiguredProviders()) {
            res.write(`data: ${JSON.stringify({ type: "error", error: "No LLM providers configured. Please add a provider in Options → AI / LLM." })}\n\n`);
            return;
        }

        // Prefer routing by the provider config id — it disambiguates multiple
        // configs of the same type (e.g. OpenAI + a self-hosted Ollama). Chats
        // saved before providerId existed fall back to type-based resolution.
        const provider = config.providerId
            ? getProvider(config.providerId)
            : getProviderByType(config.provider || "anthropic");

        // Get pricing and display name for the model
        const modelId = config.model || provider.getAvailableModels().find(m => m.isDefault)?.id;
        if (!modelId) {
            res.write(`data: ${JSON.stringify({ type: "error", error: "No model specified and no default model available for the provider." })}\n\n`);
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

        let chunks: AsyncIterable<LlmStreamChunk>;
        if (provider.chatChunks) {
            // Chunk-native provider (e.g. Claude Agent): it owns its own agentic
            // loop and produces LlmStreamChunks directly. Abort the underlying
            // agent turn when the client disconnects mid-stream.
            const abortController = new AbortController();
            res.on("close", () => abortController.abort());
            chunks = provider.chatChunks(messages, config, abortController.signal);
        } else {
            chunks = streamToChunks(provider.chat(messages, config), { model: modelDisplayName, pricing });
        }

        for await (const chunk of chunks) {
            if (chunk.type === "error") {
                getLog().error(`LLM chat stream error (model ${modelDisplayName}): ${chunk.error}`);
            }
            res.write(`data: ${JSON.stringify(chunk)}\n\n`);
            // Flush immediately to ensure real-time streaming
            if (typeof flushableRes.flush === "function") {
                flushableRes.flush();
            }
        }
        // Auto-generate a title for the chat note on the first user message
        const userMessages = messages.filter(m => m.role === "user");
        if (userMessages.length === 1 && config.chatNoteId) {
            try {
                const firstContent = userMessages[0].content;
                // Multimodal content: title from the text parts only — image
                // bytes are useless to the title model.
                const firstText = typeof firstContent === "string"
                    ? firstContent
                    : firstContent.filter(p => p.type === "text").map(p => p.text).join("\n").trim();
                if (firstText) {
                    await generateChatTitle(config.chatNoteId, firstText);
                }
            } catch (err) {
                // Title generation is best-effort; don't fail the chat
                getLog().error(`Failed to generate chat title: ${safeExtractMessageAndStackFromError(err)}`);
            }
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        getLog().error(`LLM chat stream failed: ${safeExtractMessageAndStackFromError(error)}`);
        res.write(`data: ${JSON.stringify({ type: "error", error: errorMessage })}\n\n`);
    } finally {
        res.end();
    }
}

interface ProviderModelsRequest {
    provider: string;
    apiKey?: string;
    baseURL?: string;
}

/**
 * List the live models for a provider described by raw credentials. Used by the
 * model-selection screen while adding or editing a provider — the config need
 * not be saved yet, so credentials come in the request body rather than by id.
 */
async function getProviderModels(req: Request, _res: Response) {
    const { provider, apiKey, baseURL } = req.body as ProviderModelsRequest;
    if (!provider) {
        throw new ValidationError("provider is required");
    }
    try {
        return { models: await listProviderModels(provider, apiKey ?? "", baseURL) };
    } catch (error) {
        // A live-listing failure is almost always a bad credential or an
        // unreachable endpoint the user just entered — surface it as a 400 so
        // the model-selection screen shows the reason instead of a generic 500.
        throw new ValidationError(error instanceof Error ? error.message : String(error));
    }
}

export default {
    streamChat,
    getProviderModels
};
