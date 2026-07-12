/**
 * Base class for LLM providers. Handles shared logic for system prompt building,
 * tool assembly, model pricing, and title generation.
 */

import { isAnchorState, type LlmMessage, type LlmMessagePart } from "@triliumnext/commons";
import { decodeUtf8 } from "@triliumnext/core/src/services/utils/binary.js";
import { type FilePart, generateText, type ImagePart, type LanguageModel, type ModelMessage, stepCountIs, streamText, type SystemModelMessage, type TextPart, type ToolSet } from "ai";
import { dump } from "js-yaml";

import { becca, getLog, task_states } from "@triliumnext/core";
import { getNoteMeta,SYSTEM_PROMPT_LIMITS } from "../tools/helpers.js";
import { allToolRegistries } from "../tools/index.js";
import type { LlmProvider, LlmProviderConfig, ModelInfo, ModelPricing, StreamResult } from "../types.js";

const DEFAULT_MAX_TOKENS = 8096;
const TITLE_MAX_TOKENS = 30;

/**
 * Calculate effective cost for comparison (weighted average: 1 input + 3 output).
 * Output is weighted more heavily as it's typically the dominant cost factor.
 */
function effectiveCost(pricing: ModelPricing): number {
    return (pricing.input + 3 * pricing.output) / 4;
}

/**
 * Build a context hint about the current note with full metadata (same as get_note / ETAPI).
 */
function buildNoteHint(noteId: string, hasAttachments: boolean): string | null {
    const note = becca.getNote(noteId);
    if (!note) {
        return null;
    }

    const metadata = dump(getNoteMeta(note, SYSTEM_PROMPT_LIMITS), { lineWidth: -1 });
    const lines = [
        "The user is currently viewing the following note.",
        "Use this metadata (including contentPreview) to answer questions about the note without calling tools when possible.",
        "Use get_note_content only if the preview is insufficient."
    ];
    if (hasAttachments) {
        // When the user has attached files alongside this turn, those are
        // almost always the actual subject of the question — the note context
        // is just ambient information about where they happen to be in the app.
        lines.push("The user has attached files in this message. Treat those attachments as the primary subject of their question; refer to this note only for background context if relevant.");
    }
    lines.push("", metadata);
    return lines.join("\n");
}

/**
 * Resolve a single LlmMessagePart to its AI SDK ModelMessage part form.
 * For image/file parts, this reads the attachment bytes out of Becca. Text
 * attachments are decoded as UTF-8 and emitted as a labelled TextPart so the
 * file's content travels inline (works across all providers). Failures are
 * logged and the part is dropped so the rest of the message still goes through.
 */
function resolveMessagePart(part: LlmMessagePart): TextPart | ImagePart | FilePart | null {
    if (part.type === "text") {
        return { type: "text", text: part.text };
    }
    try {
        const attachment = becca.getAttachment(part.attachmentId);
        if (!attachment) {
            getLog().error(`LLM message references missing attachment ${part.attachmentId}`);
            return null;
        }
        if (!attachment.isContentAvailable()) {
            getLog().error(`LLM message references protected attachment ${part.attachmentId} without an unlocked session`);
            return null;
        }
        // Read attachment bytes once — `getContent()` hits the blob store and
        // (for protected attachments) decrypts, so callers shouldn't repeat it.
        const content = attachment.getContent();
        if (part.type === "image") {
            const mime = part.mime || attachment.mime;
            // SVG isn't accepted by any major provider's vision input, but every
            // LLM is fluent in SVG markup — send the XML source as a text part so
            // the model can actually read and reason about it.
            if (mime === "image/svg+xml") {
                const filename = attachment.title || "image.svg";
                const text = decodeUtf8(content);
                return {
                    type: "text",
                    text: `<file name="${filename}">\n${text}\n</file>`
                };
            }
            return {
                type: "image",
                image: content,
                mediaType: mime
            };
        }
        if (part.type === "file") {
            return {
                type: "file",
                data: content,
                mediaType: part.mime || attachment.mime,
                filename: part.filename || attachment.title
            };
        }
        // type === "text_attachment" — decode the bytes and wrap in a labelled
        // XML-style block. Anthropic recommends this shape and other providers
        // handle it fine; the filename gives the model context about what it's
        // reading without needing provider-specific file APIs.
        const filename = part.filename || attachment.title;
        const text = decodeUtf8(content);
        return {
            type: "text",
            text: `<file name="${filename}">\n${text}\n</file>`
        };
    } catch (err) {
        // A single unreadable attachment (corrupt blob, decryption failure,
        // invalid UTF-8) shouldn't crash the whole chat turn — drop the part
        // and log so the rest of the message still reaches the model.
        getLog().error(`Failed to resolve message part for attachment ${part.attachmentId}: ${err}`);
        return null;
    }
}

/**
 * Build a single ModelMessage from an LlmMessage. Plain string content stays
 * as-is; multimodal content is resolved into AI SDK text/image/file parts.
 */
export function buildModelMessage(m: LlmMessage): ModelMessage {
    const role = m.role as "user" | "assistant";
    if (typeof m.content === "string") {
        return { role, content: m.content };
    }
    const resolved = m.content
        .map(resolveMessagePart)
        .filter((p): p is TextPart | ImagePart | FilePart => p !== null);
    // Assistant turns can only carry TextParts (per the AI SDK type), so
    // strip any stray attachments — they only make sense on user turns anyway.
    if (role === "assistant") {
        const textOnly: TextPart[] = resolved.filter((p): p is TextPart => p.type === "text");
        return { role: "assistant", content: textOnly };
    }
    return { role: "user", content: resolved };
}

/**
 * Build the model list with cost multipliers from a base model definition array.
 */
export function buildModelList(baseModels: Omit<ModelInfo, "costMultiplier">[]): {
    models: ModelInfo[];
    pricing: Record<string, ModelPricing>;
} {
    const baselineModel = baseModels.find(m => m.isDefault) || baseModels[0];
    const baselineCost = effectiveCost(baselineModel.pricing);

    const models = baseModels.map(m => ({
        ...m,
        costMultiplier: Math.round((effectiveCost(m.pricing) / baselineCost) * 10) / 10
    }));

    const pricing = Object.fromEntries(
        models.map(m => [m.id, m.pricing])
    );

    return { models, pricing };
}

/**
 * The task-list formatting hint, extended with the workspace's user-defined multi-state checkboxes so
 * the model recognizes their markers (e.g. `- [/]` = "Doing") in the user's notes and can produce them.
 * Falls back to just the native open/completed states when no custom states are configured.
 */
function buildTaskListHint(): string {
    const base = "**Task lists** — use `- [ ]` for an open task and `- [x]` for a completed one.";
    const custom = task_states.getTaskStates().filter(s => !isAnchorState(s.name) && !s.isHidden && s.markdownSymbol);
    if (custom.length === 0) {
        return base;
    }
    const lines = custom.map(s => `- \`- [${s.markdownSymbol}]\` — ${s.title}${s.isCompleted ? " (completed)" : ""}`);
    return `${base} This workspace also defines extra task states — recognize these markers in the user's notes, and use them when a task fits:\n${lines.join("\n")}`;
}

export abstract class BaseProvider implements LlmProvider {
    abstract name: string;

    protected abstract defaultModel: string;
    protected abstract titleModel: string;
    protected abstract availableModels: ModelInfo[];
    protected abstract modelPricing: Record<string, ModelPricing>;

    /** Create a language model instance for the given model ID. */
    protected abstract createModel(modelId: string): LanguageModel;

    /**
     * Build the system prompt with note hints and skills summary.
     */
    protected buildSystemPrompt(messages: LlmMessage[], config: LlmProviderConfig): string | undefined {
        const parts: string[] = [];

        // Base system prompt from config or messages. System messages only ever
        // carry string content — multimodal parts apply to user/assistant turns.
        const systemMessage = messages.find(m => m.role === "system");
        const messageSystemPrompt = typeof systemMessage?.content === "string" ? systemMessage.content : undefined;
        const basePrompt = config.systemPrompt || messageSystemPrompt;
        if (basePrompt) {
            parts.push(basePrompt);
        }

        // Note tools hint
        if (config.enableNoteTools) {
            parts.push(
                [
                    `Before calling create_note (or any write tool) for Trilium-specific code or queries, you MUST call load_skill first — guessing the API produces broken code that doesn't run:`,
                    `- Frontend code notes (mime "text/jsx" or "application/javascript;env=frontend") or render notes (type "render") → load_skill with name "frontend_scripting". Trilium uses Preact, NOT React, with imports from "trilium:preact".`,
                    `- Backend code notes (mime "application/javascript;env=backend") → load_skill with name "backend_scripting".`,
                    `- Search queries using boolean logic, attribute filters, relations, ordering, or regex → load_skill with name "search_syntax".`,
                    `Loading is one cheap tool call. Skipping it wastes the user's time.`
                ].join("\n")
            );
            parts.push(
                `When referring to notes in your responses, use the wiki-link format [[noteId]] to create clickable internal links. Use the note ID (not the title) from tool results. The link will automatically display the note's title and icon, so don't repeat the title in your text. For example: "You can find more details in [[ZjSfLhzlqNY6]]" instead of "You can find more details in the Meeting Notes note ([[ZjSfLhzlqNY6]])".`
            );
            parts.push(
                `Do not create, modify, or delete notes unless the user explicitly asks you to (e.g. "create a note", "save this to a note"). The chat supports rich Markdown rendering including code blocks, math equations, mermaid diagrams, and tables — so always present content directly in your response rather than creating a note for it. For example, if asked to "visualize an algorithm", render a mermaid diagram in the chat, don't create a note.`
            );
            parts.push(
                `After a successful write tool call (set_note_content, append_to_note, edit_note_content, create_note), the tool's result already contains the resulting content of the note. Do not call get_note_content to verify the write — trust the returned content.`
            );
            parts.push(
                `Never prepend emojis or other decorative characters to note titles. To give a note a visual marker, find a fitting icon with search_icons and assign it via set_attribute as the note's 'iconClass' label (e.g. value 'bx bx-rocket').`
            );
        } else if (config.contextNoteId) {
            parts.push(
                `You can see the current note's metadata above, but you cannot search or access other notes. If the user asks about other notes, inform them that "Note access" is disabled and they need to enable it in the chat settings (click on the model name dropdown and toggle "Note access").`
            );
        } else {
            parts.push(
                `You do not have access to the user's notes. If the user asks about their notes, inform them that "Note access" is disabled and they need to enable it in the chat settings (click on the model name dropdown and toggle "Note access").`
            );
        }

        // Web search hint
        if (!config.enableWebSearch) {
            parts.push(
                `You do not have access to web search. If the user asks for current/real-time information, news, or anything that requires searching the web, inform them that "Web search" is disabled and they need to enable it in the chat settings (click on the model name dropdown and toggle "Web search").`
            );
        }

        // Parallel tool-call hint
        if (config.enableNoteTools || config.enableWebSearch) {
            parts.push(
                `When you need several independent pieces of information, issue the tool calls in parallel within the same turn instead of waiting for each result before requesting the next. Only chain calls sequentially when a later call genuinely depends on the output of an earlier one.`
            );
        }

        // Markdown formatting hints
        parts.push(
            `Your responses are rendered as Markdown with extended features. Use them when appropriate:\n\n`
                + `**Admonitions** — GitHub-style callout blocks. Use sparingly, only when a plain paragraph would under-sell the point:\n`
                + `- \`> [!NOTE]\` — neutral side information worth highlighting\n`
                + `- \`> [!TIP]\` — an optional improvement or shortcut\n`
                + `- \`> [!IMPORTANT]\` — information the user should not miss\n`
                + `- \`> [!WARNING]\` — something that may cause problems or surprise\n`
                + `- \`> [!CAUTION]\` — a destructive or irreversible action\n`
                + `Syntax: the marker must be on its own line, and every content line must start with \`>\`.\n\n`
                + `**Blockquotes** — prefix lines with \`>\` (without a \`[!TYPE]\` marker) to quote text.\n\n`
                + `**Math equations** — KaTeX (LaTeX subset). Use \`$...$\` for inline math and \`$$...$$\` for display (block) math. Example: \`$E = mc^2$\` or:\n`
                + `$$\n\\int_0^\\infty e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}\n$$\n\n`
                + `**Mermaid diagrams** — use a fenced code block with the \`mermaid\` language tag. Example:\n`
                + "```mermaid\ngraph LR\n    A --> B\n```\n\n"
                + `**Code blocks** — use fenced code blocks with a language tag for syntax highlighting (e.g. \`\`\`js, \`\`\`python).\n\n`
                + `**Tables** — GitHub-style pipe tables: a header row, a \`---\` separator row, then the data rows.\n\n`
                + `**Collapsible blocks** — use the standard HTML \`<details>\`/\`<summary>\` form; the \`<summary>\` is the always-visible title. Placed back-to-back with nothing between them, consecutive collapsible blocks are grouped into an accordion — handy when presenting several options or alternatives the user can expand one at a time. Example:\n`
                + `<details><summary>Option A</summary>\nDetails about the first option.\n</details>\n<details><summary>Option B</summary>\nDetails about the second option.\n</details>\n\n`
                + `**Footnotes** — use \`[^1]\` in text and \`[^1]: explanation\` at the bottom.\n\n`
                + `**Keyboard keys** — wrap each key in a \`<kbd>\` tag when documenting shortcuts, e.g. \`<kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>Del</kbd>\`.\n\n`
                + buildTaskListHint()
        );

        // The markdown formatting hints above are pushed unconditionally, so
        // `parts` is never empty — the `: undefined` arm is unreachable defence.
        /* v8 ignore next */
        return parts.length > 0 ? parts.join("\n\n") : undefined;
    }

    /**
     * Build the ModelMessage array from LlmMessages (no provider-specific options).
     *
     * Only user/assistant turns are included here — the system prompt is passed
     * separately via the `system` option of `streamText` (see `buildSystemMessage`),
     * which is resilient against prompt injection.
     */
    protected buildMessages(chatMessages: LlmMessage[]): ModelMessage[] {
        return chatMessages.map(m => buildModelMessage(m));
    }

    /**
     * Attach the current-note metadata hint to the last user message.
     *
     * The hint is deliberately kept OUT of the system prompt: it changes whenever
     * the context note changes, and the system prompt carries the provider's
     * prompt-cache breakpoint — embedding volatile content there would invalidate
     * the cached system+tools prefix on every note edit. The last user message is
     * regenerated every turn and never cached, so it is the right home for it.
     */
    protected applyNoteHint(chatMessages: LlmMessage[], config: LlmProviderConfig): LlmMessage[] {
        if (!config.contextNoteId) {
            return chatMessages;
        }

        const lastUserIndex = chatMessages.map(m => m.role).lastIndexOf("user");
        if (lastUserIndex === -1) {
            return chatMessages;
        }

        const lastUserContent = chatMessages[lastUserIndex].content;
        const hasAttachments = Array.isArray(lastUserContent)
            && lastUserContent.some(p => p.type !== "text");

        const noteHint = buildNoteHint(config.contextNoteId, hasAttachments);
        if (!noteHint) {
            return chatMessages;
        }

        return chatMessages.map((m, i) => {
            if (i !== lastUserIndex) return m;
            if (typeof m.content === "string") {
                return { ...m, content: `${noteHint}\n\n${m.content}` };
            }
            // For multimodal content, prepend the hint as a leading text part so
            // any attached images still travel with the message.
            return {
                ...m,
                content: [{ type: "text" as const, text: noteHint }, ...m.content]
            };
        });
    }

    /**
     * Build the value for the `system` option of `streamText`. Subclasses can
     * override to attach provider-specific metadata (e.g. cache control).
     */
    protected buildSystemMessage(systemPrompt: string | undefined): string | SystemModelMessage | undefined {
        return systemPrompt;
    }

    /**
     * Add provider-specific web search tool. Override in subclasses that support it.
     */
    protected addWebSearchTool(_tools: ToolSet): void {}

    /**
     * Build the tool set based on config.
     */
    protected buildTools(config: LlmProviderConfig): ToolSet {
        const tools: ToolSet = {};

        if (config.enableWebSearch) {
            this.addWebSearchTool(tools);
        }

        if (config.enableNoteTools) {
            for (const registry of allToolRegistries) {
                Object.assign(tools, registry.toToolSet());
            }
        }

        return tools;
    }

    chat(messages: LlmMessage[], config: LlmProviderConfig): StreamResult {
        const systemPrompt = this.buildSystemPrompt(messages, config);
        const chatMessages = this.applyNoteHint(messages.filter(m => m.role !== "system"), config);
        const coreMessages = this.buildMessages(chatMessages);

        const streamOptions: Parameters<typeof streamText>[0] = {
            model: this.createModel(config.model || this.defaultModel),
            system: this.buildSystemMessage(systemPrompt),
            messages: coreMessages,
            maxOutputTokens: config.maxTokens || DEFAULT_MAX_TOKENS,
            // Reject any system message smuggled into `messages` (prompt injection guard).
            allowSystemInMessages: false,
            // The AI SDK's default onError handler dumps the raw error object straight
            // to stdout, bypassing Trilium's logger. The error is still delivered through
            // `fullStream`, where `streamToChunks` turns it into a detailed message that
            // the chat route logs — so suppress the unstructured stdout dump here.
            onError: () => {}
        };

        const tools = this.buildTools(config);
        if (Object.keys(tools).length > 0) {
            streamOptions.tools = tools;
            streamOptions.stopWhen = stepCountIs(15);
            streamOptions.toolChoice = "auto";
        }

        return streamText(streamOptions);
    }

    getModelPricing(model: string): ModelPricing | undefined {
        return this.modelPricing[model];
    }

    getAvailableModels(): ModelInfo[] {
        return this.availableModels;
    }

    async generateTitle(firstMessage: string): Promise<string> {
        const { text } = await generateText({
            model: this.createModel(this.titleModel),
            maxOutputTokens: TITLE_MAX_TOKENS,
            messages: [
                {
                    role: "user",
                    content: `Summarize the following message as a very short chat title (max 6 words). Reply with ONLY the title, no quotes or punctuation at the end.\n\nMessage: ${firstMessage}`
                }
            ]
        });

        return text.trim();
    }
}
