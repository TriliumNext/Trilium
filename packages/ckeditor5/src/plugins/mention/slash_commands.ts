import {
    IconAlignCenter,
    IconAlignJustify,
    IconAlignLeft,
    IconAlignRight,
    IconBulletedList,
    IconCodeBlock,
    IconHeading1,
    IconHeading2,
    IconHeading3,
    IconHeading4,
    IconHeading5,
    IconHeading6,
    IconHorizontalLine,
    IconIndent,
    IconNumberedList,
    IconOutdent,
    IconPageBreak,
    IconPaperClip,
    IconParagraph,
    IconQuote,
    IconTable,
    IconTodoList,
    IconImage
} from "@ckeditor/ckeditor5-icons";
import bxBookmark from "boxicons/svg/regular/bx-bookmark.svg?raw";
import bxBulb from "boxicons/svg/regular/bx-bulb.svg?raw";
import bxCommentError from "boxicons/svg/regular/bx-comment-error.svg?raw";
import bxError from "boxicons/svg/regular/bx-error.svg?raw";
import bxErrorCircle from "boxicons/svg/regular/bx-error-circle.svg?raw";
import bxInfoCircle from "boxicons/svg/regular/bx-info-circle.svg?raw";
import bxNetworkChart from "boxicons/svg/regular/bx-network-chart.svg?raw";
import bxPen from "boxicons/svg/regular/bx-pen.svg?raw";
import bxSticker from "boxicons/svg/regular/bx-sticker.svg?raw";
import { BookmarkUI, type Editor, type MentionFeedObjectItem, Plugin } from "ckeditor5";

import collapsibleIcon from "../../icons/collapsible.svg?raw";
import dateTimeIcon from "../../icons/date-time.svg?raw";
import insertFootnoteIcon from "../../icons/insert-footnote.svg?raw";
import importMarkdownIcon from "../../icons/markdown-mark.svg?raw";
import mathIcon from "../../icons/math.svg?raw";
import multicolumnIcon from "../../icons/multicolumn.svg?raw";
import noteIcon from "../../icons/note.svg?raw";
import tabsIcon from "../../icons/tabs.svg?raw";
import internalLinkIcon from "../../icons/trilium.svg?raw";
import { ADMONITION_TYPE_NAMES, type AdmonitionType } from "../admonition/admonition_command.js";
import { getAdmonitionTitle } from "../admonition/admonition_ui.js";
import aiIcon from "../ai_assistant/theme/icons/ai.svg?raw";
import { COMMAND_NAME as CONTENT_EMBED_COMMAND } from "../content_embed/content_embed.js";
import { insertDrawingCanvas } from "../file_upload/file_upload_ui.js";
import { INSERT_ICON_COMMAND } from "../inline_icon/inline_icon_editing.js";
import InlineIconUI from "../inline_icon/inline_icon_ui.js";
import InsertDateTimePlugin, { COMMAND_NAME as INSERT_DATE_TIME_COMMAND, getDateTimeFormatOptions } from "../insert_date_time.js";
import { COMMAND_NAME as INTERNAL_LINK_COMMAND } from "../internallink.js";
import { COMMAND_NAME as MARKDOWN_IMPORT_COMMAND } from "../markdownimport.js";
import MathUI from "../math/math_ui.js";
import { INSERT_MERMAID_COMMAND } from "../mermaid/insert_mermaid_command.js";
import type { MermaidSample } from "../mermaid/mermaid_ui.js";
import SnippetsEditing from "../snippets/snippetsediting.js";
import { registerHostedMentionFeed } from "./register_feed.js";
import type { MentionHostedList } from "./types.js";

export const SLASH_MARKER = "/";

/**
 * One entry of the `/` palette. Structurally the same shape premium `SlashCommand` accepted, so the
 * definitions in `extra_slash_commands.ts` carry over unchanged.
 */
export interface SlashCommandDefinition {
    /** Stable identifier, also what `slashCommand.removeCommands` matches against. */
    id: string;
    title: string;
    description?: string;
    /** Extra words the entry can be found by, beyond its title. */
    aliases?: string[];
    /** Raw SVG markup. Ignored when {@link iconClass} is set. */
    icon?: string;
    /**
     * A font-icon class list (e.g. `"tn-icon bx bx-note"`) rendered as a `<span>` instead of
     * {@link icon}'s SVG markup — the form snippet notes carry their icons in.
     */
    iconClass?: string;
    /** Optional colour class applied alongside {@link iconClass} (from the note's `#color` label). */
    iconColorClass?: string;
    /** The editor command to run. Entries naming a command that is not loaded are hidden. */
    commandName?: string;
    /** Runs instead of `commandName`, for entries that need arguments or open a UI. */
    execute?: (editor: Editor) => void;
    /**
     * Whether the entry applies to the current selection. Defaults to the `isEnabled` of
     * {@link commandName}; entries that only provide {@link execute} are always offered unless they
     * define this. Mirrors premium's `_proxyIsEnabled`.
     */
    isEnabled?: (editor: Editor) => boolean;
}

export interface SlashCommandConfig {
    removeCommands?: string[];
    /**
     * The host's list of the palette, which lists {@link TriliumSlashCommands.search} for the query
     * and commits the entry picked as a {@link SlashCommandItem}. Without it there is no palette.
     */
    list?: ( editor: Editor ) => MentionHostedList;
}

/** What a palette's list commits for the entry picked. */
export type SlashCommandItem = MentionFeedObjectItem & { definition: SlashCommandDefinition };

/**
 * The `/` command palette: its catalog, its matcher and what an entry runs, for the list the host
 * draws in `slashCommand.list`, which {@link TriliumMentionUI} runs as a hosted feed.
 *
 * This replaces premium `SlashCommand`, which was the only remaining plugin forcing the `Mention`
 * façade — and therefore upstream's `MentionUI` — into the text editor alongside ours. Two mention
 * UIs sharing `mention.feeds` fight over the same `ContextualBalloon`: whichever adds its view
 * second buries the other, and the buried one then throws `contextualballoon-add-view-exist` on its
 * next keystroke.
 *
 * CKEditor built the premium plugin on `Mention` themselves, so hosting `/` on a mention feed is
 * not a workaround but the same architecture.
 */
export default class TriliumSlashCommands extends Plugin {

    static get pluginName() {
        return "TriliumSlashCommands" as const;
    }

    constructor(editor: Editor) {
        super(editor);

        const list = editor.config.get("slashCommand.list");
        if (!list) {
            return;
        }

        registerHostedMentionFeed(editor, {
            marker: SLASH_MARKER,
            // A bare `/` opens the full palette, as the premium plugin did.
            minimumCharacters: 0,
            list,
            // The catalog gates on `isEnabled` at query time, but an entry can go stale while the
            // list is open; re-check here so a no-op commit never costs the user their `/query`.
            canCommit: (editorInstance, item) => isSlashCommandEnabled(editorInstance, (item as SlashCommandItem).definition),
            commit: (editorInstance, item) => runSlashCommand(editorInstance, (item as SlashCommandItem).definition)
        });
    }

    /** The entries for what was typed after the `/`, best match first. */
    search(query: string): SlashCommandDefinition[] {
        return matchSlashCommands(this._catalog(), query);
    }

    /**
     * The definitions available in *this* editor right now: the palette CKEditor's own features
     * contribute, Trilium's own entries, and one per text snippet — minus anything `removeCommands`
     * names and anything that does not apply to the current selection.
     */
    private _catalog(): SlashCommandDefinition[] {
        const editor = this.editor;
        const config = (editor.config.get("slashCommand") ?? {}) as SlashCommandConfig;
        const removed = new Set(config.removeCommands ?? []);

        return [
            ...buildDefaultSlashCommands(editor),
            ...buildTriliumSlashCommands(editor),
            ...buildSnippetSlashCommands(editor)
        ]
            .filter((definition) => !removed.has(definition.id))
            .filter((definition) => isSlashCommandEnabled(editor, definition));
    }
}

// `EditorConfig.slashCommand` used to be typed by premium's `@ckeditor/ckeditor5-slash-command`
// augmentation, which reached the type graph via a premium type import. Now that Trilium owns the
// `/` palette (and no longer statically imports premium types), declare the config shape here.
declare module "ckeditor5" {
    interface EditorConfig {
        slashCommand?: SlashCommandConfig;
    }
}

/**
 * Whether an entry should be offered for the caret's current position.
 *
 * Existence of the command is not enough: a registered but disabled command (`indent` in a plain
 * paragraph, say) makes `editor.execute()` a no-op, and since committing an entry first deletes the
 * `/query` the user would lose what they typed and get nothing back. Premium evaluated the same
 * predicate on every keystroke in `getMatchingCommands()`, so entries appear and disappear as the
 * selection moves.
 */
export function isSlashCommandEnabled(editor: Editor, definition: SlashCommandDefinition): boolean {
    if (definition.isEnabled) {
        return definition.isEnabled(editor);
    }

    if (!definition.commandName) {
        return true;
    }

    return editor.commands.get(definition.commandName)?.isEnabled ?? false;
}

function runSlashCommand(editor: Editor, definition: SlashCommandDefinition) {
    if (definition.execute) {
        definition.execute(editor);
        return;
    }

    /* v8 ignore next 3 -- `_catalog()` drops every definition that has neither `execute` nor a registered `commandName`, so one or the other is always present here */
    if (definition.commandName) {
        editor.execute(definition.commandName);
    }
}

/**
 * Ranks `definitions` against what the user typed after the `/`.
 *
 * Prefix matches sort above substring matches so that `/co` offers "Code block" before "Table of
 * contents", and title matches above alias matches so an entry is found by its own name first.
 * Ordering within a tier is the catalog order, which is deliberate: the defaults come first and the
 * hand-authored Trilium entries follow.
 */
export function matchSlashCommands(definitions: SlashCommandDefinition[], query: string): SlashCommandDefinition[] {
    const needle = query.trim().toLowerCase();

    if (!needle) {
        return definitions;
    }

    const ranked: Array<{ definition: SlashCommandDefinition; rank: number }> = [];

    for (const definition of definitions) {
        const title = definition.title.toLowerCase();
        const aliases = (definition.aliases ?? []).map((alias) => alias.toLowerCase());
        let rank: number | null = null;

        if (title.startsWith(needle)) {
            rank = 0;
        } else if (aliases.some((alias) => alias.startsWith(needle))) {
            rank = 1;
        } else if (title.includes(needle)) {
            rank = 2;
        } else if (aliases.some((alias) => alias.includes(needle))) {
            rank = 3;
        }

        if (rank !== null) {
            ranked.push({ definition, rank });
        }
    }

    // `sort` is stable in every engine we target, so equal ranks keep their catalog order.
    return ranked.sort((a, b) => a.rank - b.rank).map((entry) => entry.definition);
}

/**
 * The subset of premium's built-in palette that applies to Trilium. Entries Trilium re-authors with
 * better icons or sentence-case titles (the lists, Mermaid) live in `extra_slash_commands.ts` and
 * are deliberately absent here; so are the ones for plugins Trilium never loads (CKBox, CKFinder,
 * HTML embed).
 *
 * Headings are derived from `heading.options` rather than hardcoded, so the palette automatically
 * matches the configured levels — Trilium omits `heading1`, which is reserved for the note title.
 */
export function buildDefaultSlashCommands(editor: Editor): SlashCommandDefinition[] {
    const t = editor.locale.t;

    return [
        ...buildHeadingSlashCommands(editor),
        {
            id: "blockQuote",
            title: t("Block quote"),
            description: t("Quote a passage from another source."),
            aliases: [ "quote", "citation" ],
            icon: IconQuote,
            commandName: "blockQuote"
        },
        {
            id: "codeBlock",
            title: t("Code block"),
            description: t("Insert a block of preformatted code."),
            aliases: [ "snippet", "pre" ],
            icon: IconCodeBlock,
            commandName: "codeBlock"
        },
        {
            id: "insertTable",
            title: t("Table"),
            description: t("Insert a table."),
            aliases: [ "grid" ],
            icon: IconTable,
            commandName: "insertTable"
        },
        {
            id: "horizontalLine",
            title: t("Horizontal line"),
            description: t("Insert a horizontal rule."),
            aliases: [ "divider", "separator", "rule" ],
            icon: IconHorizontalLine,
            commandName: "horizontalLine"
        },
        {
            id: "indent",
            title: t("Indent"),
            description: t("Increase the indentation of the current block."),
            icon: IconIndent,
            commandName: "indent"
        },
        {
            id: "outdent",
            title: t("Outdent"),
            description: t("Decrease the indentation of the current block."),
            icon: IconOutdent,
            commandName: "outdent"
        },
        buildImageUploadCommand(editor)
    ];
}

/**
 * The palette entries for Trilium's own features, plus the handful that replace a CKEditor built-in
 * whose title or icon Trilium re-authors (the lists, the blank Mermaid diagram).
 *
 * These used to be built by the host and injected through `slashCommand.extraCommands`, because
 * premium `SlashCommand` owned the palette and config was the only way in. Trilium owns it now, so
 * they are built here like every other group — which is also what lets them use `editor.t()`: the
 * host translator resolved only Trilium's catalog, leaving strings such as "Align left" and "Page
 * break" in English even though CKEditor ships translations for them.
 */
export function buildTriliumSlashCommands(editor: Editor): SlashCommandDefinition[] {
    const t = editor.locale.t;

    return [
        ...buildListSlashCommands(editor),
        ...buildAlignmentSlashCommands(editor),
        ...buildAdmonitionSlashCommands(editor),
        {
            id: "drawing-canvas",
            title: t("Drawing canvas"),
            description: t("Insert a canvas to draw on."),
            aliases: [ "excalidraw", "sketch", "whiteboard" ],
            icon: bxPen,
            commandName: "fileUpload",
            isEnabled: canEmbedFiles,
            execute: insertDrawingCanvas
        },
        ...buildMermaidSlashCommands(editor),
        {
            id: "ai-assistant",
            title: t("AI assistant"),
            description: t("Ask AI to rewrite the selection or generate new content."),
            aliases: [ "ask ai", "assistant" ],
            icon: aiIcon,
            commandName: "aiAssistant"
        },
        {
            id: "collapsible",
            title: t("Collapsible block"),
            description: t("Insert a toggleable section that hides/shows content on click."),
            aliases: [
                "details", "fold", "toggle", "collapse", "expand", "accordion", "spoiler",
                "summary", "disclosure", "hide"
            ],
            icon: collapsibleIcon,
            commandName: "collapsible"
        },
        {
            id: "tabs",
            title: t("Tabs"),
            description: t("Insert titled tabs that show one panel at a time."),
            aliases: [ "tab", "tabbed", "tab group", "panels", "variants" ],
            icon: tabsIcon,
            commandName: "tabs"
        },
        {
            id: "multicolumn-layout",
            title: t("Multicolumn layout"),
            description: t("Arrange content in two to four columns side by side."),
            aliases: [ "columns", "column", "layout", "side by side" ],
            icon: multicolumnIcon,
            commandName: "multicolumnLayout"
        },
        {
            id: "footnote",
            title: t("Footnote"),
            description: t("Create a new footnote and reference it here"),
            icon: insertFootnoteIcon,
            commandName: "InsertFootnote"
        },
        ...buildDateTimeSlashCommands(editor),
        {
            id: "internal-link",
            title: t("Internal link"),
            description: t("Insert a link to another Trilium note"),
            aliases: [ "internal link", "trilium link", "reference link" ],
            icon: internalLinkIcon,
            commandName: INTERNAL_LINK_COMMAND
        },
        {
            id: "attach-file",
            title: t("Attach file as a link"),
            description: t("Upload files as attachments and insert links."),
            aliases: [ "attachment", "upload" ],
            icon: IconPaperClip,
            commandName: "fileUpload",
            execute: (target: Editor) => pickFiles("", (files) => {
                target.execute("fileUpload", { file: files });
                target.editing.view.focus();
            })
        },
        {
            id: "attach-and-embed-file",
            title: t("Attach and embed file"),
            description: t("Upload files as attachments and insert embeds."),
            aliases: [ "attachment", "upload", "embed" ],
            icon: IconPaperClip,
            commandName: "fileUpload",
            isEnabled: canEmbedFiles,
            execute: (target: Editor) => pickFiles("", (files) => {
                target.execute("fileUpload", { file: files, asEmbed: true });
                target.editing.view.focus();
            })
        },
        {
            id: "math",
            title: t("Math equation"),
            description: t("Insert a math equation"),
            aliases: [ "latex", "equation" ],
            icon: mathIcon,
            execute: (target: Editor) => target.plugins.get(MathUI)._showUI()
        },
        {
            id: "content-embed",
            title: t("Include note"),
            description: t("Display the content of another note in this note"),
            icon: noteIcon,
            commandName: CONTENT_EMBED_COMMAND
        },
        {
            id: "page-break",
            title: t("Page break"),
            description: t("Insert a page break (for printing)"),
            icon: IconPageBreak,
            commandName: "pageBreak"
        },
        {
            id: "markdown-import",
            title: t("Markdown import"),
            description: t("Import Markdown from the clipboard"),
            icon: importMarkdownIcon,
            commandName: MARKDOWN_IMPORT_COMMAND
        },
        {
            id: "icon",
            title: t("Icon"),
            description: t("Insert an icon from an installed icon pack"),
            aliases: [ "symbol", "glyph" ],
            icon: bxSticker,
            commandName: INSERT_ICON_COMMAND,
            // Deferred for the reason the anchor entry below is: the picker opens in a balloon
            // placed at the caret, and the palette has not finished putting the selection back
            // where it belongs until the tick is over.
            execute: (target: Editor) => {
                setTimeout(() => target.plugins.get(InlineIconUI).showPicker(), 0);
            }
        },
        {
            id: "anchor",
            title: t("Anchor"),
            description: t("Insert an anchor for internal linking"),
            aliases: [ "bookmark" ],
            icon: bxBookmark,
            execute: (target: Editor) => {
                // Defer to the next event loop tick so the slash command fully finishes its
                // DOM/selection cleanup; _showFormView needs the view and mapper to be in a settled
                // state for balloon positioning.
                setTimeout(() => (target.plugins.get(BookmarkUI) as unknown as { _showFormView(): void })._showFormView(), 0);
            }
        },
        ...buildAiQuickActionSlashCommands(editor)
    ];
}

/**
 * One entry per AI quick action the host configured ("Fix typos", "Translate to Romanian", …) —
 * the same presets the toolbar's AI entry hangs off its arrow, reachable by name instead of by
 * hunting through a menu.
 *
 * The `AI:` prefix keeps a palette full of insert-a-thing entries readable: without it "Summarize"
 * sits among "Summary" and "Table" as if it inserted something, and there is no other cue that a
 * dozen of these hand the paragraph to a language model. It doubles as the query that reaches the
 * whole set, since `/ai` then matches every one of them by title.
 *
 * Only that prefix goes through `editor.t()`. The action's own wording arrives from the host
 * already translated — it is the host that composes "Translate to Romanian" out of a group and a
 * language, so it is the host that has to word it.
 *
 * The palette is typed at a collapsed caret, which is why a quick action run this way falls back
 * to the caret's block — see `AiAssistantUI#runQuickAction`, and the description saying so.
 * Enablement therefore only asks whether the feature is available at all: the pending `/query` is
 * itself text in that block, so a content check here would answer "yes" no matter what.
 */
function buildAiQuickActionSlashCommands(editor: Editor): SlashCommandDefinition[] {
    if (!editor.plugins.has("AiAssistantUI")) {
        return [];
    }

    const t = editor.locale.t;

    // The plugin's list rather than the config's: the config only seeded it, and the content
    // languages behind Translate can be changed from inside the editor.
    return editor.plugins.get("AiAssistantUI").quickActions.flatMap((group) =>
        group.actions.map((action) => ({
            id: `ai-${action.id}`,
            title: t("AI: %0", action.commandLabel ?? action.label),
            description: t("Applies to the current paragraph."),
            aliases: [ group.label ],
            icon: aiIcon,
            isEnabled: (target: Editor) => target.commands.get("aiAssistant")?.isEnabled ?? false,
            execute: (target: Editor) => target.plugins.get("AiAssistantUI").runQuickAction(action)
        }))
    );
}

// Replaces CKEditor's built-in `bulletedList`/`numberedList`/`todoList` slash commands (removed via
// `removeCommands`), whose titles are Title Case, with sentence-case equivalents that run the same
// commands.
function buildListSlashCommands(editor: Editor): SlashCommandDefinition[] {
    const t = editor.locale.t;

    return [
        {
            id: "bulletedList",
            title: t("Bulleted list"),
            description: t("Create a bulleted list"),
            icon: IconBulletedList,
            commandName: "bulletedList"
        },
        {
            id: "numberedList",
            title: t("Numbered list"),
            description: t("Create a numbered list"),
            icon: IconNumberedList,
            commandName: "numberedList"
        },
        {
            id: "todoList",
            title: t("To-do list"),
            description: t("Create a to-do list"),
            aliases: [ "todo", "task", "checklist", "checkbox" ],
            icon: IconTodoList,
            commandName: "todoList"
        }
    ];
}

function buildMermaidSlashCommands(editor: Editor): SlashCommandDefinition[] {
    const t = editor.locale.t;
    const samples = (editor.config.get("mermaid.samples") ?? []) as MermaidSample[];

    // The blank diagram. Replaces CKEditor's built-in `insertMermaidCommand` slash command (removed
    // via `removeCommands`), which uses a generic icon.
    const blank: SlashCommandDefinition = {
        id: "mermaid",
        title: t("Mermaid diagram"),
        description: t("Insert an empty Mermaid diagram"),
        aliases: [ "mermaid", "diagram", "flowchart" ],
        icon: bxNetworkChart,
        commandName: INSERT_MERMAID_COMMAND
    };

    const templates = samples.map((sample, index) => ({
        id: `mermaid-sample-${index}`,
        // The sample name is a placeholder rather than an appended string, so a locale can put the
        // name where its grammar wants it. It arrives already localized, from `mermaid.samples`.
        title: t("Mermaid diagram: %0", sample.name),
        description: t("Insert a \"%0\" Mermaid diagram template", sample.name),
        aliases: [ "mermaid", "diagram", sample.name ],
        icon: bxNetworkChart,
        // Inserts a mermaid block pre-filled with the sample source (see insertMermaidCommand).
        execute: (target: Editor) => target.execute(INSERT_MERMAID_COMMAND, { source: sample.content })
    }));

    return [ blank, ...templates ];
}

/**
 * One entry per format `getDateTimeFormatOptions()` offers. The entry for the user's default format
 * shows its output as the description; each preset carries it in the title, so the rows differ at a
 * glance. `_catalog()` runs on every query, so the previews show the current time.
 */
function buildDateTimeSlashCommands(editor: Editor): SlashCommandDefinition[] {
    if (!editor.plugins.has(InsertDateTimePlugin)) {
        return [];
    }

    const t = editor.locale.t;
    const [ defaultOption, ...presets ] = getDateTimeFormatOptions(editor);
    const aliases = [ "date", "time", "now", "today", "timestamp" ];

    const defaultEntry: SlashCommandDefinition = {
        id: "datetime",
        title: t("Insert date/time"),
        description: defaultOption.preview,
        aliases,
        icon: dateTimeIcon,
        commandName: INSERT_DATE_TIME_COMMAND
    };

    const presetEntries = presets.map(({ format, kind, preview }) => ({
        id: `datetime-${format}`,
        title: kind === "time" ? t("Insert time: %0", preview) : t("Insert date/time: %0", preview),
        aliases,
        icon: dateTimeIcon,
        // `commandName` supplies the enabled state; `execute` passes the format along.
        commandName: INSERT_DATE_TIME_COMMAND,
        execute: (target: Editor) => target.execute(INSERT_DATE_TIME_COMMAND, { format })
    }));

    return [ defaultEntry, ...presetEntries ];
}

function buildAlignmentSlashCommands(editor: Editor): SlashCommandDefinition[] {
    const t = editor.locale.t;

    return [
        {
            id: "align-left",
            title: t("Align left"),
            description: t("Align text to the left"),
            icon: IconAlignLeft,
            execute: (target: Editor) => target.execute("alignment", { value: "left" })
        },
        {
            id: "align-center",
            title: t("Align center"),
            description: t("Align text to the center"),
            icon: IconAlignCenter,
            execute: (target: Editor) => target.execute("alignment", { value: "center" })
        },
        {
            id: "align-right",
            title: t("Align right"),
            description: t("Align text to the right"),
            icon: IconAlignRight,
            execute: (target: Editor) => target.execute("alignment", { value: "right" })
        },
        {
            id: "align-justify",
            title: t("Justify"),
            description: t("Justify text alignment"),
            icon: IconAlignJustify,
            execute: (target: Editor) => target.execute("alignment", { value: "justify" })
        }
    ];
}

function buildAdmonitionSlashCommands(editor: Editor): SlashCommandDefinition[] {
    const t = editor.locale.t;
    const icons: Record<AdmonitionType, string> = {
        note: bxInfoCircle,
        tip: bxBulb,
        important: bxCommentError,
        caution: bxErrorCircle,
        warning: bxError
    };

    return ADMONITION_TYPE_NAMES.map((type) => ({
        id: type,
        title: getAdmonitionTitle(t, type),
        description: t("Insert a new admonition"),
        icon: icons[type],
        execute: (target: Editor) => target.execute("admonition", { forceValue: type }),
        aliases: [ "box" ]
    }));
}

/**
 * One palette entry per text snippet, restoring premium behaviour: premium `SlashCommand` listed the
 * premium `Template` plugin's definitions alongside the built-ins. Since `_catalog()` runs on every
 * query, the definitions are read live from {@link SnippetsEditing} — snippet changes pushed via
 * `TriliumSnippets.updateDefinitions()` appear in the palette without any re-registration.
 */
function buildSnippetSlashCommands(editor: Editor): SlashCommandDefinition[] {
    if (!editor.plugins.has(SnippetsEditing)) {
        return [];
    }

    return Array.from(editor.plugins.get(SnippetsEditing).definitions, (snippet, index) => ({
        id: `snippet-${index}`,
        title: snippet.title,
        description: snippet.description,
        // Beyond its own title, every snippet is findable under the feature's generic names.
        aliases: [ "snippet", "template" ],
        iconClass: snippet.iconClass,
        iconColorClass: snippet.iconColorClass,
        // Gates the entry on `insertTemplate` (read-only mode disables it); `execute` still wins at
        // commit time, since the command needs the snippet's content as its argument.
        commandName: "insertTemplate",
        execute: (target: Editor) => target.execute("insertTemplate", snippet.data)
    }));
}

function buildHeadingSlashCommands(editor: Editor): SlashCommandDefinition[] {
    const options = (editor.config.get("heading.options") ?? []) as Array<{ model: string; title: string }>;
    const icons: Record<string, string> = {
        heading1: IconHeading1,
        heading2: IconHeading2,
        heading3: IconHeading3,
        heading4: IconHeading4,
        heading5: IconHeading5,
        heading6: IconHeading6
    };

    // The configured titles are English message ids ("Paragraph", "Heading 2"), which CKEditor's own
    // catalogs translate — its heading dropdown runs them through `t()` for exactly this reason. The
    // palette has to do the same, or it shows English titles beside translated descriptions.
    const t = editor.locale.t;

    return options.map((option) => {
        if (option.model === "paragraph") {
            return {
                id: "paragraph",
                title: t(option.title),
                description: t("Turn the current block into a paragraph."),
                aliases: [ "text", "body" ],
                icon: IconParagraph,
                commandName: "paragraph"
            };
        }

        return {
            id: option.model,
            title: t(option.title),
            description: editor.locale.t("Turn the current block into a heading."),
            aliases: [ "title", option.model.replace("heading", "h") ],
            icon: icons[option.model] ?? IconHeading2,
            // `heading` takes the level as an argument, so it cannot use `commandName`.
            execute: (target: Editor) => target.execute("heading", { value: option.model })
        };
    });
}

function buildImageUploadCommand(editor: Editor): SlashCommandDefinition {
    const t = editor.locale.t;

    return {
        id: "uploadImage",
        title: t("Upload image"),
        description: t("Upload an image from your device."),
        aliases: [ "picture", "photo" ],
        icon: IconImage,
        // The entry opens a file picker instead of naming `uploadImage`, so `commandName` cannot
        // gate it; without this it would be offered in an editor that has no `ImageUpload`.
        isEnabled: (target) => target.commands.get("uploadImage")?.isEnabled ?? false,
        execute(target) {
            const imageTypes = target.config.get("image.upload.types") ?? [];
            const imageTypesRegExp = createImageTypeRegExp(imageTypes);
            const accept = imageTypes.map((type) => `image/${type}`).join(",");

            pickFiles(accept, (files) => {
                const imagesToUpload = files.filter((file) => imageTypesRegExp.test(file.type));

                if (imagesToUpload.length) {
                    target.execute("uploadImage", { file: imagesToUpload });
                    target.editing.view.focus();
                }
            });
        }
    };
}

/** Whether files can be embedded at the selection: wherever "Include note" can insert an embed. */
function canEmbedFiles(target: Editor) {
    return !!target.commands.get("fileUpload")?.isEnabled
        && !!target.commands.get(CONTENT_EMBED_COMMAND)?.isEnabled;
}

/**
 * Opens the browser's file picker and passes the picked files to `onPick`.
 *
 * @param accept the `accept` attribute of the file input, empty for any type.
 */
function pickFiles(accept: string, onPick: (files: File[]) => void) {
    const input = document.createElement("input");

    input.type = "file";
    input.accept = accept;
    input.multiple = true;
    input.style.display = "none";

    input.addEventListener("change", () => {
        /* v8 ignore next -- `files` is only null on an input that is not of type `file` */
        onPick(Array.from(input.files ?? []));
        input.remove();
    }, { once: true });

    document.body.appendChild(input);
    input.click();
}

// Source: https://github.com/ckeditor/ckeditor5/blob/master/packages/ckeditor5-image/src/imageupload/utils.ts
function createImageTypeRegExp(types: string[]): RegExp {
    // Sanitize the MIME type name which can include: "+", "-" or ".".
    const regExpSafeNames = types.map((type) => type.replace("+", "\\+"));

    return new RegExp(`^image\\/(${regExpSafeNames.join("|")})$`);
}
