import type { AiCompletionUsage, AiQuickAction, AiQuickActionGroup, AiStreamFunction } from "@triliumnext/ckeditor5";
import type { LlmChatConfig, LlmMessage, LlmModelInfo, LlmUsage } from "@triliumnext/commons";

import { t } from "../../../services/i18n.js";
import { streamChatCompletion } from "../../../services/llm_chat.js";
import options from "../../../services/options.js";

/**
 * Builds the transport behind the editor's AI assistant balloon (`config.aiAssistant.stream`):
 * a completion streamed from the user's default LLM provider through the existing
 * `/api/llm-chat/stream` endpoint, accumulated into the cumulative-HTML shape the plugin expects.
 *
 * Returns `undefined` when no LLM provider is configured, which disables the feature in the
 * editor. Like the snippet list, the provider set is read when the editor is built — configuring
 * a first provider shows the button after the editor is next rebuilt.
 */
export default function buildAiAssistantStream(): AiStreamFunction | undefined {
    if (!readProviderConfigs().length) {
        return undefined;
    }

    return async (request, onData, signal): Promise<AiCompletionUsage> => {
        const messages: LlmMessage[] = [
            { role: "system", content: SYSTEM_PROMPT },
            {
                role: "user",
                content: request.context
                    ? `Content:\n${request.context}\n\nTask: ${request.query}`
                    : request.query
            }
        ];

        const config = pickDefaultModel();
        let cumulative = "";
        const usage = await new Promise<LlmUsage | null>((resolve, reject) => {
            let reported: LlmUsage | null = null;
            streamChatCompletion(messages, config, {
                onChunk: (text) => {
                    cumulative += text;
                    onData(cumulative);
                },
                onUsage: (chunk) => {
                    reported = chunk;
                },
                onError: (error) => reject(new Error(error)),
                onDone: () => resolve(reported)
            }, signal).then(
                // A stream that ends without a "done" event (connection dropped) still settles.
                () => resolve(reported),
                reject
            );
        });

        return {
            // The server reports the model's display name; fall back to the id we asked for.
            model: usage?.model ?? config.model,
            totalTokens: usage?.totalTokens,
            cost: usage?.cost
        };
    };
}

/**
 * The predefined instructions for the balloon's "Quick actions" dropdown, modelled on the premium
 * AI assistant's default command set. Labels are translated here (the plugin renders them as
 * given); prompts stay English — they are instructions to the model, not UI.
 */
export function buildAiAssistantQuickActions(): AiQuickActionGroup[] {
    return [
        {
            id: "edit",
            label: t("ai_assistant.group_edit"),
            actions: [
                action("fixTypos", t("ai_assistant.action_fix_typos"),
                    "Fix all spelling, grammar and punctuation mistakes. Do not change the meaning, tone or formatting."),
                action("improveWriting", t("ai_assistant.action_improve_writing"),
                    "Improve the writing: fix mistakes, tighten the phrasing and apply good writing practices without changing the meaning."),
                action("makeShorter", t("ai_assistant.action_make_shorter"),
                    "Shorten this content by removing repetition and non-essential details, without losing key information."),
                action("makeLonger", t("ai_assistant.action_make_longer"),
                    "Expand this content with more detail and clearer explanations, keeping the original meaning."),
                action("simplify", t("ai_assistant.action_simplify"),
                    "Rewrite this content in simpler language so that it is easier to understand.")
            ]
        },
        {
            id: "generate",
            label: t("ai_assistant.group_generate"),
            actions: [
                action("summarize", t("ai_assistant.action_summarize"),
                    "Summarize this content into one short paragraph containing only the key ideas and conclusions."),
                action("continue", t("ai_assistant.action_continue"),
                    "Continue writing from the end of the provided content, staying on topic and matching its style. Keep the continuation brief.")
            ]
        },
        {
            id: "tone",
            label: t("ai_assistant.group_tone"),
            actions: [
                action("professional", t("ai_assistant.tone_professional"),
                    "Rewrite this content in a polished, formal, professional tone without changing the meaning."),
                action("casual", t("ai_assistant.tone_casual"),
                    "Rewrite this content in a casual, conversational tone without changing the meaning."),
                action("direct", t("ai_assistant.tone_direct"),
                    "Rewrite this content in a direct tone, keeping only the essential information."),
                action("friendly", t("ai_assistant.tone_friendly"),
                    "Rewrite this content in a warm, friendly tone without changing the meaning.")
            ]
        },
        {
            id: "translate",
            label: t("ai_assistant.group_translate"),
            actions: [
                action("translateEnglish", t("ai_assistant.lang_english"), "Translate the content to English."),
                action("translateGerman", t("ai_assistant.lang_german"), "Translate the content to German."),
                action("translateSpanish", t("ai_assistant.lang_spanish"), "Translate the content to Spanish."),
                action("translateFrench", t("ai_assistant.lang_french"), "Translate the content to French."),
                action("translateRomanian", t("ai_assistant.lang_romanian"), "Translate the content to Romanian."),
                action("translateChinese", t("ai_assistant.lang_chinese"), "Translate the content to Simplified Chinese.")
            ]
        }
    ];
}

/** Shorthand for a quick-action entry; all defaults require content to work on. */
function action(id: string, label: string, prompt: string): AiQuickAction {
    return { id, label, prompt };
}

/**
 * The assistant works HTML-in/HTML-out: the context is the selection's HTML and the response is
 * committed through the editor's data pipeline, so anything but clean HTML (markdown, fences,
 * commentary) would end up as literal text in the note.
 */
const SYSTEM_PROMPT = `You are a writing assistant embedded in a rich text editor of a note-taking application.
The user gives you a task, usually together with the HTML of the content it applies to.

Rules:
- Respond ONLY with HTML. No markdown, no code fences, no explanations, no preamble.
- Use simple HTML: <p>, <strong>, <em>, <ul>, <ol>, <li>, <h2>-<h5>, <table>, <blockquote>, <code>, <a>.
- When rewriting content, preserve its structure and formatting unless the task says otherwise.
- Respond in the same language as the content, unless the task says otherwise.`;

/** The subset of a stored `llmProviders` entry this module reads. */
interface StoredProviderConfig {
    id: string;
    provider: string;
    selectedModels?: LlmModelInfo[];
}

function readProviderConfigs(): StoredProviderConfig[] {
    return (options.getJson("llmProviders") as StoredProviderConfig[] | null) ?? [];
}

/**
 * The provider/model the assistant uses: the first configured provider's default model (or its
 * first model). The same resolution the LLM chat starts out with — a per-run model picker in the
 * balloon can come later.
 */
function pickDefaultModel(): LlmChatConfig {
    for (const config of readProviderConfigs()) {
        const model = config.selectedModels?.find((m) => m.isDefault) ?? config.selectedModels?.[0];
        if (model) {
            return { model: model.id, provider: config.provider, providerId: config.id };
        }
    }
    // No selected models anywhere: let the server resolve the provider's own default.
    return {};
}
