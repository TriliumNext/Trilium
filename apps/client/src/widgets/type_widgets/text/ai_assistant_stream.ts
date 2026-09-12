import type { AiCompletionRequest, AiCompletionUsage, AiConversationTurn, AiQuickAction, AiQuickActionGroup, AiStreamFunction } from "@triliumnext/ckeditor5";
import { getEnglishName, type LlmMessage, type LlmUsage, type Locale, type ToMarkdownResponse } from "@triliumnext/commons";

import appContext from "../../../components/app_context.js";
import { getAvailableLocales, t } from "../../../services/i18n.js";
import { readSelectedModels } from "../../../services/llm_providers.js";
import { streamChatCompletion } from "../../../services/llm_chat.js";
import options from "../../../services/options.js";
import { sanitizeNoteContentHtml } from "../../../services/sanitize_content.js";
import server from "../../../services/server.js";
import { getTaskStateDefinitions } from "../../../services/task_states.js";
import treeService from "../../../services/tree.js";
import { pickModel } from "./ai_model_picker.js";

/** The note an editor is open on, as much of it as placing a run in the tree needs. */
export interface AiNoteLocation {
    title: string;
    /** Where it sits, for the ancestor titles a bare title cannot give. */
    notePath?: string | null;
}

/** Names the note an editor is open on, at the moment a run asks — see `buildAiAssistantStream`. */
export type AiNoteLocationProvider = () => AiNoteLocation | null;

/**
 * Builds the transport behind the editor's AI assistant (`config.aiAssistant.stream`): a
 * completion streamed from the user's default LLM provider through the existing
 * `/api/llm-chat/stream` endpoint, accumulated into the cumulative-HTML shape the plugin expects.
 *
 * **The model works in Markdown, not HTML.** The editor speaks HTML on both ends, so the context
 * is converted on the way in and every streamed chunk is rendered on the way out. That buys more
 * than cheaper tokens and a format the model is fluent in: admonitions, mermaid diagrams and task
 * lists come out of Trilium's own Markdown renderer, from syntax the model already knows, instead
 * of markup we would have to dictate in the system prompt and hope it reproduces byte for byte.
 *
 * Returns `undefined` when the AI features are switched off or no LLM provider is configured,
 * which disables the feature in the editor and drops its toolbar entry (see `buildToolbarConfig`).
 * The master switch is checked as well as the provider set, because turning it off leaves the
 * configured providers stored — they are what the switch turns back on.
 *
 * @param getNoteLocation names the note being edited, so a run can say where in Trilium it is
 *                        writing. Read per request rather than captured: switching notes reuses
 *                        the editor rather than rebuilding it.
 */
export default function buildAiAssistantStream(getNoteLocation?: AiNoteLocationProvider): AiStreamFunction | undefined {
    if (!options.is("aiEnabled") || !readSelectedModels().hasProvider) {
        return undefined;
    }

    return async (request, onData, signal): Promise<AiCompletionUsage> => {
        // All three are needed before the first token and none depends on the others.
        const [context, renderMarkdown, note] = await Promise.all([
            toMarkdown(request.context),
            loadMarkdownRenderer(),
            describeNote(getNoteLocation?.() ?? null)
        ]);

        const messages = buildMessages(request, context, note);
        const config = pickModel();
        let cumulative = "";
        const usage = await new Promise<LlmUsage | null>((resolve, reject) => {
            let reported: LlmUsage | null = null;
            streamChatCompletion(messages, config, {
                onChunk: (text) => {
                    cumulative += text;
                    // The wrapper fence comes off here rather than inside the renderer: the
                    // stripped Markdown is both what the preview shows and what the assistant
                    // hands back as this turn when the user follows up on it.
                    const markdown = stripMarkdownFences(cumulative);
                    onData(renderMarkdown(markdown), markdown);
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
    return decorate([
        {
            id: "edit",
            label: t("ai_assistant.group_edit"),
            actions: [
                action("fixTypos", t("ai_assistant.action_fix_typos"),
                    "Fix all spelling, grammar and punctuation mistakes. Do not change the meaning, tone or formatting."),
                // Deliberately not "fix mistakes and tighten the phrasing": that made this the same
                // instruction as Fix typos and Make shorter, which are one click away either side.
                action("improveWriting", t("ai_assistant.action_improve_writing"),
                    "Improve the clarity, flow and word choice of this content, keeping its meaning and roughly its length.")
            ]
        },
        {
            id: "generate",
            label: t("ai_assistant.group_generate"),
            actions: [
                action("summarize", t("ai_assistant.action_summarize"),
                    "Summarize this content into one short paragraph containing only the key ideas and conclusions."),
                action("explain", t("ai_assistant.action_explain"),
                    "Explain this content in plain language: what it says, and what it means for someone unfamiliar with it. Keep the explanation brief."),
                action("continue", t("ai_assistant.action_continue"),
                    "Continue writing from the end of the provided content, staying on topic and matching its style. Keep the continuation brief.")
            ]
        },
        {
            // The three ways of saying the same thing differently, as against improving it
            // (Improve writing), replacing it (Summarize, Explain) or correcting it (Fix typos).
            id: "adjust",
            label: t("ai_assistant.group_adjust"),
            submenu: true,
            actions: [
                spelledOutAction("makeShorter", t("ai_assistant.adjust_shorter"), t("ai_assistant.command_make_shorter"),
                    "Shorten this content by removing repetition and non-essential details, without losing key information."),
                spelledOutAction("makeLonger", t("ai_assistant.adjust_longer"), t("ai_assistant.command_make_longer"),
                    "Expand this content with more detail and clearer explanations, keeping the original meaning."),
                spelledOutAction("simplify", t("ai_assistant.adjust_simpler"), t("ai_assistant.command_simplify"),
                    "Rewrite this content in simpler language so that it is easier to understand.")
            ]
        },
        {
            id: "tone",
            label: t("ai_assistant.group_tone"),
            submenu: true,
            actions: [
                toneAction("professional", t("ai_assistant.tone_professional"),
                    "Rewrite this content in a polished, formal, professional tone without changing the meaning."),
                toneAction("casual", t("ai_assistant.tone_casual"),
                    "Rewrite this content in a casual, conversational tone without changing the meaning."),
                // A tone, not a length: "keeping only the essential information" made this Make
                // shorter under another name.
                toneAction("direct", t("ai_assistant.tone_direct"),
                    "Rewrite this content in a direct tone: active voice, no hedging and no throat-clearing. Keep all of the information."),
                toneAction("friendly", t("ai_assistant.tone_friendly"),
                    "Rewrite this content in a warm, friendly tone without changing the meaning."),
                toneAction("confident", t("ai_assistant.tone_confident"),
                    "Rewrite this content in a confident, assertive tone without changing the meaning.")
            ]
        },
        {
            id: "reformat",
            label: t("ai_assistant.group_reformat"),
            submenu: true,
            actions: [
                spelledOutAction("bulletList", t("ai_assistant.reformat_bullet_list"), t("ai_assistant.command_bullet_list"),
                    "Rewrite this content as a bulleted list, one point per item, without losing information."),
                spelledOutAction("table", t("ai_assistant.reformat_table"), t("ai_assistant.command_table"),
                    "Reorganize this content into a table with a header row, choosing columns that fit what the content describes."),
                spelledOutAction("diagram", t("ai_assistant.reformat_diagram"), t("ai_assistant.command_diagram"),
                    "Express this content as a Mermaid diagram inside a `mermaid` code block — a flowchart unless another Mermaid diagram type fits the content better. Respond with the code block only."),
                spelledOutAction("callout", t("ai_assistant.reformat_callout"), t("ai_assistant.command_callout"),
                    "Turn this content into a single callout, opening with the marker that fits it best — `> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`, `> [!CAUTION]` or `> [!WARNING]` — and keeping the wording."),
                // The blank lines are not cosmetic: without them the content sits inside one HTML
                // block and its Markdown is never processed (verified against the renderer).
                spelledOutAction("collapsible", t("ai_assistant.reformat_collapsible"), t("ai_assistant.command_collapsible"),
                    "Wrap this content in a collapsible section: a line with <details>, then a <summary> line saying in a few words what it hides, then a blank line, then the content unchanged, then a blank line and </details>."),
                // A real task list rather than a plain one: `- [ ]` is Markdown the model already
                // writes, and the renderer turns it into the editor's `todo-list` markup.
                spelledOutAction("actionItems", t("ai_assistant.reformat_action_items"), t("ai_assistant.command_action_items"),
                    "Extract the action items from this content as an unchecked task list (`- [ ] …`), each one short and starting with a verb. Leave out anything that is not an action.")
            ]
        },
        {
            id: "translate",
            label: t("ai_assistant.group_translate"),
            submenu: true,
            actions: buildTranslateActions(),
            // The one group whose contents are the user's to choose, so the way to choose them
            // closes it — as it closes the note's own language picker in the status bar and the
            // ribbon, and for the same reason: nobody looking at the list would think to go
            // hunting through the settings for what fills it.
            footer: {
                label: t("note_language.configure-languages"),
                iconClass: "bx bx-cog",
                run: () => appContext.triggerCommand("showContentLanguagesDialog")
            }
        }
    ]);
}

/**
 * The Boxicon each action and submenu shows in the menu — the icon pack the rest of the app draws
 * from, so no SVG is involved (the editor plugin renders the classes on a `<span>`, the same way
 * the template list renders a note's icon).
 *
 * Kept as one table keyed by id rather than threaded through the label helpers: those are about how
 * a label reads as a command, and one list is easier to keep complete than twenty-odd call sites.
 * The inlined groups are absent on purpose — without a heading there is nothing to put an icon on.
 */
const ICONS: Record<string, string> = {
    // Submenus.
    adjust: "bx bx-ruler",
    tone: "bx bx-palette",
    reformat: "bx bx-shape-square",
    translate: "bx bx-globe",

    // Edit or review.
    fixTypos: "bx bx-check-double",
    improveWriting: "bx bx-brush",

    // Generate.
    summarize: "bx bx-align-left",
    explain: "bx bx-bulb",
    continue: "bx bx-fast-forward",

    // Adjust.
    makeShorter: "bx bx-collapse-vertical",
    makeLonger: "bx bx-expand-vertical",
    simplify: "bx bx-leaf",

    // Change tone.
    professional: "bx bx-briefcase",
    casual: "bx bx-coffee",
    direct: "bx bx-target-lock",
    friendly: "bx bx-smile",
    confident: "bx bx-medal",

    // Reformat.
    bulletList: "bx bx-list-ul",
    table: "bx bx-table",
    diagram: "bx bx-network-chart",
    callout: "bx bx-info-circle",
    collapsible: "bx bx-chevrons-down",
    actionItems: "bx bx-task"

    // The languages are deliberately absent. The pack has no flags and nothing else tells German
    // from French, so the choice was one repeated glyph or none. `bx-empty` — Trilium's slot
    // reserver — is for an item sitting next to items that *do* have icons; the Translate submenu
    // is its own panel holding nothing but languages, so there is nothing to line up against.
};

/**
 * The actions whose answer replaces what it was given instead of editing it: a translation, a
 * summary, a diagram. Their review opens on the result — an inline diff of two texts with nothing
 * in common says nothing, however well it is rendered, and the answer is what wants reading.
 *
 * Only the outright replacements are listed. Everything else lets the run decide for itself, from
 * how much of the response the differ could align (see `diffAiResponse`) — which is also what
 * answers for a prompt the user typed, where there is no definition to go on.
 */
const REPLACEMENT_GROUPS = new Set(["translate"]);
const REPLACEMENT_ACTIONS = new Set(["summarize", "explain", "continue", "table", "diagram", "actionItems"]);

/**
 * Hangs {@link ICONS} and the review view on the definitions by id, leaving the ids that have
 * neither untouched. Kept out of the definitions themselves so that each stays about what it asks
 * the model for, and so that one list per concern can be read for completeness.
 */
function decorate(groups: AiQuickActionGroup[]): AiQuickActionGroup[] {
    return groups.map((group) => ({
        ...group,
        iconClass: ICONS[group.id],
        actions: group.actions.map((action) => ({
            ...action,
            iconClass: ICONS[action.id],
            reviewView: REPLACEMENT_GROUPS.has(group.id) || REPLACEMENT_ACTIONS.has(action.id)
                ? "result" as const
                : undefined
        }))
    }));
}

/** Shorthand for a quick-action entry; all defaults require content to work on. */
function action(id: string, label: string, prompt: string): AiQuickAction {
    return { id, label, prompt };
}

/**
 * A tone or a language reads as a command only together with what its group heading says: the menu
 * lists a bare "Direct" under "Change tone", while the `/` palette has to spell out "Change tone to
 * Direct". Composed here rather than in the editor so that a locale can reorder the two halves —
 * and pick the right preposition and case for the language name.
 */
function toneAction(id: string, tone: string, prompt: string): AiQuickAction {
    return { id, label: tone, commandLabel: t("ai_assistant.command_tone", { tone }), prompt };
}

/**
 * The languages the Translate submenu offers: the ones enabled as content languages, which is the
 * list a note's own language is picked from and the closest thing Trilium has to a record of the
 * languages this user works in. macOS reads the system's preferred languages for its own Translate
 * for the same reason, and Word offers a shortlist with the full picker behind it — a fixed six is
 * the one shape nobody ships, because no six are right for everybody.
 *
 * Read when the editor is built, like the provider list: enabling a language in Options →
 * Localization shows it after the editor is next rebuilt.
 *
 * A fresh install has none enabled, so the original six stand in — enough to show what the submenu
 * is for, and the settings are where it is made the user's own.
 */
function buildTranslateActions(): AiQuickAction[] {
    const available = getAvailableLocales();
    const enabled = (options.getJson("languages") as string[] | null) ?? [];

    const selected = available.filter((locale) => enabled.includes(locale.id));
    const locales = selected.length
        ? selected
        : available.filter((locale) => FALLBACK_TRANSLATE_LOCALES.has(locale.id));

    return locales.map((locale) => translateAction(locale));
}

const FALLBACK_TRANSLATE_LOCALES = new Set(["en", "de", "es", "fr", "ro", "cn"]);

/**
 * The label is the language's own name, as everywhere else a language is picked in Trilium — a
 * speaker looking for their own language expects to find it written in it.
 *
 * The prompt is not: it addresses the model, and a model told to translate "to 简体中文" has to read
 * the target out of the very script it is written in first. `Intl` has no English name for the
 * English entries (their own name is already one) or for a tag it does not know, which is what the
 * fallback covers.
 */
function translateAction(locale: Locale): AiQuickAction {
    const language = locale.name;
    return {
        id: `translate:${locale.id}`,
        label: language,
        commandLabel: t("ai_assistant.command_translate", { language }),
        prompt: `Translate the content to ${getEnglishName(locale.id) ?? locale.name}.`
    };
}

/**
 * An action that needs the two labels spelled out rather than composed. Adjust and Reformat both
 * read as a bare word under their heading ("Shorter", "Table") and so need the standalone wording
 * the `/` palette shows, but neither composes from a single phrase the way a tone or a language
 * does — "Make shorter" against "Simplify language", "Turn into a table" against "Extract action
 * items". So the pair is translated as a pair.
 */
function spelledOutAction(id: string, label: string, commandLabel: string, prompt: string): AiQuickAction {
    return { id, label, commandLabel, prompt };
}

/**
 * The assistant works Markdown-in/Markdown-out. Anything but the bare result — commentary, a
 * preamble, a fence around the whole answer — is committed into the note verbatim, so the prompt
 * is blunt about it.
 *
 * The syntaxes listed are the ones {@link loadMarkdownRenderer} turns into Trilium constructs, so
 * naming them is what makes callouts, diagrams and task lists reachable without describing any
 * markup: the model writes the Markdown it already knows and the renderer produces our HTML.
 */
const SYSTEM_PROMPT = `You are a writing assistant embedded in a rich text editor of a note-taking application.
The user gives you a task, usually together with the Markdown of the content it applies to.

Rules:
- Respond ONLY with the resulting Markdown. No explanations, no preamble, no code fence around the answer.
- The task may come with the note it was given in: its title, and the text before and after the content. Those are there to place the content — write so that the answer fits in with them, but never rewrite, repeat or answer them. Only the content under "Content" is yours to work on.
- GitHub-flavoured Markdown is supported: headings, tables, footnotes and task lists (\`- [ ]\`).
- \`> [!NOTE]\`, \`> [!TIP]\`, \`> [!IMPORTANT]\`, \`> [!CAUTION]\` and \`> [!WARNING]\` render as coloured callouts.
- A \`mermaid\` code block renders as a diagram.
- When rewriting content, preserve its structure and formatting unless the task says otherwise.
- Respond in the same language as the content, unless the task says otherwise.`;

/**
 * The conversation as the provider takes it: the system prompt, the exchanges so far, and the new
 * instruction last.
 *
 * Only the opening turn carries the content and its surroundings, because they are the same for
 * the whole conversation and the answers to them are in the transcript. That is what makes a
 * follow-up a follow-up: "now make it shorter" after "translate this to German" reaches a model
 * that can still see German was asked for, instead of one handed German text and a bare request
 * to shorten it.
 */
function buildMessages(request: AiCompletionRequest, context: string, note: string): LlmMessage[] {
    const turns: AiConversationTurn[] = [...request.history, { role: "user", content: request.query }];
    return [
        { role: "system", content: SYSTEM_PROMPT },
        ...turns.map((turn, index) => ({
            role: turn.role,
            content: index === 0
                ? buildOpeningTurn(request, context, note, turn.content)
                : turn.content
        }))
    ];
}

/**
 * The turn a conversation opens with: where in Trilium the note sits, what surrounds the content
 * there, the content itself and the instruction — each section named, and only the ones with
 * anything in them.
 *
 * The point of the first three is that a selection says nothing about where it is: asked to
 * continue a paragraph or to summarize under a heading, a model shown the selection alone is
 * writing into a document it cannot see. The instruction goes last, where it is not read as a
 * remark about the background above it.
 */
function buildOpeningTurn(request: AiCompletionRequest, context: string, note: string, query: string): string {
    const { before, after } = request.surroundings;
    // What the surroundings surround: a run with no content generates at the caret, and "before
    // the content" would be naming something the model was never shown.
    const anchor = context ? "the content" : "the cursor";
    const sections: string[] = [];

    if (note) {
        sections.push(`Note: ${note}`);
    }
    if (before) {
        sections.push(`Text before ${anchor} (context only):\n${before}`);
    }
    if (after) {
        sections.push(`Text after ${anchor} (context only):\n${after}`);
    }
    if (context) {
        sections.push(`Content:\n${context}`);
    }

    // Nothing to place it against — an instruction into an empty note — so it is sent as it was
    // typed, rather than as the sole entry of a form.
    return sections.length ? [...sections, `Task: ${query}`].join("\n\n") : query;
}

/**
 * Where the note being edited sits, as one line: its ancestors and its own title, joined the way
 * every other breadcrumb in Trilium is. Reuses the tree service's own resolver rather than walking
 * Froca here, so a hoisted or cloned note reads the same as it does in the title bar.
 *
 * A note whose path cannot be resolved is named by its title alone, which is the part that matters;
 * a caller that names no note at all leaves the section out.
 */
async function describeNote(location: AiNoteLocation | null): Promise<string> {
    if (!location?.notePath) {
        return location?.title ?? "";
    }
    try {
        return await treeService.getNotePathTitle(location.notePath);
    } catch (error) {
        console.warn("AI assistant: could not resolve the note path", error);
        return location.title;
    }
}

/**
 * The selection, as Markdown for the model. The conversion is the server's: turndown and the rules
 * that keep admonitions, `<details>`, math and reference links intact live in `trilium-core`, which
 * the client cannot import — and unlike the response, the context is one string sent once, so a
 * round-trip before the stream costs a fraction of the completion that follows.
 *
 * A failed conversion falls back to the HTML. The model reads HTML perfectly well; losing the
 * conversion is worth far less than losing the run.
 */
async function toMarkdown(html: string): Promise<string> {
    if (!html.trim()) {
        return "";
    }
    try {
        const { markdownContent } = await server.post<ToMarkdownResponse>("other/to-markdown", { htmlContent: html });
        return markdownContent;
    } catch (error) {
        console.warn("AI assistant: could not convert the context to Markdown, sending HTML", error);
        return html;
    }
}

/**
 * The Markdown → HTML pass applied to the cumulative response on every chunk — the same shape the
 * LLM chat renders streamed replies with, re-rendering the whole buffer rather than appending to
 * it, which is what keeps a half-written table or fence from rendering as garbage.
 *
 * `marked` is a heavy import, so it is pulled in only once the assistant actually runs.
 */
async function loadMarkdownRenderer(): Promise<(markdown: string) => string> {
    const [{ renderToHtml }, taskStates] = await Promise.all([
        import("@triliumnext/commons/src/lib/markdown_renderer"),
        getTaskStateDefinitions()
    ]);

    return (markdown) => renderToHtml(markdown, "", {
        sanitize: sanitizeNoteContentHtml,
        taskStates,
        wikiLink: { formatHref: (id) => `#root/${id}` }
    });
}

/**
 * Info strings that mean "here is my answer" rather than naming content. A fence carrying any
 * other language is part of the response: a `mermaid` block is the whole point of the Diagram
 * action, and unwrapping it leaves the diagram source rendering as a paragraph of text.
 */
const WRAPPER_FENCE_LANGUAGES = new Set(["", "markdown", "md", "html"]);

/**
 * Removes the code fence a model wrapped its whole answer in, closing half included when it has
 * arrived. Models add these despite instructions not to; the stripper runs against the cumulative
 * stream, so it also has to handle a fence whose closing half has not streamed in yet.
 *
 * A bare ``` is treated as a wrapper, which is what it almost always is. The cost is that an
 * answer that is nothing but an unlabelled code block loses its fence — cheap next to leaving
 * every wrapped answer rendering as source.
 */
export function stripMarkdownFences(cumulative: string): string {
    const opening = /^\s*```([a-z]*)\s*\n?/i.exec(cumulative);
    if (!opening || !WRAPPER_FENCE_LANGUAGES.has(opening[1].toLowerCase())) {
        return cumulative;
    }

    let body = cumulative.slice(opening[0].length);
    const closingIndex = body.lastIndexOf("```");
    if (closingIndex !== -1 && body.slice(closingIndex + 3).trim() === "") {
        body = body.slice(0, closingIndex);
    }
    return body;
}


