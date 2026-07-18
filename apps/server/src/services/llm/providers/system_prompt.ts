/**
 * Builds the Trilium-specific system prompt shared by every LLM provider:
 * the note-tools guidance (when to load_skill, the [[noteId]] wiki-link
 * convention, write-safety rules), the note/web-access notices, and the
 * Markdown-rendering capabilities of the chat surface.
 *
 * Kept provider-agnostic (no `ai` SDK, no becca beyond task states) so it can
 * be reused by both the AI-SDK providers and the Claude Agent provider, which
 * runs its own loop and needs the same prompt to reach behavioural parity.
 */

import { isAnchorState, type LlmMessage } from "@triliumnext/commons";
import { task_states } from "@triliumnext/core";

import type { LlmProviderConfig } from "../types.js";

/**
 * Build the system prompt from the conversation's system message / config plus
 * the note-tools, web-search, and Markdown-formatting guidance.
 *
 * Returns `undefined` only in the (unreachable) case of no parts — the
 * Markdown hints are always appended.
 */
export function buildSystemPrompt(messages: LlmMessage[], config: LlmProviderConfig): string | undefined {
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
        parts.push(
            `For questions about how to use Trilium itself (features, settings, keyboard shortcuts, "how do I…?"), consult the built-in User Guide instead of relying on your own knowledge — it matches the installed version. Use search_help to find pages by keyword; if that misses, use get_help_toc to browse the table of contents (the guide may name a concept differently than the user, e.g. placing a note in two locations is "cloning"). Base your answer on those pages and link them with [[noteId]] so the user can open the full documentation.`
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
