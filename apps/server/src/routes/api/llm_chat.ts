import type { LlmMessage, LlmStreamChunk } from "@triliumnext/commons";
import { getLog } from "@triliumnext/core";
import type { Request, Response } from "express";

import { generateChatTitle } from "../../services/llm/chat_title.js";
import { getAllModels, getProviderByType, hasConfiguredProviders, type LlmProviderConfig } from "../../services/llm/index.js";
import { resolveKnowledgeBaseSources } from "../../services/llm/knowledge_base.js";
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

        const provider = getProviderByType(config.provider || "anthropic");

        // Get pricing and display name for the model
        const modelId = config.model || provider.getAvailableModels().find(m => m.isDefault)?.id;
        if (!modelId) {
            res.write(`data: ${JSON.stringify({ type: "error", error: "No model specified and no default model available for the provider." })}\n\n`);
            return;
        }

        const pricing = provider.getModelPricing(modelId);
        const modelDisplayName = provider.getAvailableModels().find(m => m.id === modelId)?.name || modelId;

        let chunks: AsyncIterable<LlmStreamChunk>;
        if (provider.chatChunks) {
            // Chunk-native provider (e.g. Claude Agent): it owns its own agentic
            // loop and produces LlmStreamChunks directly. Abort the underlying
            // agent turn when the client disconnects mid-stream.
            const abortController = new AbortController();
            res.on("close", () => abortController.abort());
            chunks = provider.chatChunks(messages, config, abortController.signal);
        } else {
            const knowledgeBaseSources = config.sourceNoteIds?.length
                ? resolveKnowledgeBaseSources(config.sourceNoteIds)
                : undefined;
            chunks = streamToChunks(provider.chat(messages, config), { model: modelDisplayName, pricing, knowledgeBaseSources });
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

/**
 * Get available models from all configured providers.
 */
function getModels(_req: Request, _res: Response) {
    if (!hasConfiguredProviders()) {
        return { models: [] };
    }

    return { models: getAllModels() };
}

export default {
    streamChat,
    getModels
};
