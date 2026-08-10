import "../../theme/slash_commands.css";

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
    IconParagraph,
    IconQuote,
    IconTable,
    IconTodoList
} from "@ckeditor/ckeditor5-icons";
import bxBookmark from "boxicons/svg/regular/bx-bookmark.svg?raw";
import bxBulb from "boxicons/svg/regular/bx-bulb.svg?raw";
import bxCommentError from "boxicons/svg/regular/bx-comment-error.svg?raw";
import bxError from "boxicons/svg/regular/bx-error.svg?raw";
import bxErrorCircle from "boxicons/svg/regular/bx-error-circle.svg?raw";
import bxInfoCircle from "boxicons/svg/regular/bx-info-circle.svg?raw";
import bxNetworkChart from "boxicons/svg/regular/bx-network-chart.svg?raw";
import { BookmarkUI, type Editor, type MentionFeedObjectItem, Plugin } from "ckeditor5";

import collapsibleIcon from "../../icons/collapsible.svg?raw";
import dateTimeIcon from "../../icons/date-time.svg?raw";
import insertFootnoteIcon from "../../icons/insert-footnote.svg?raw";
import importMarkdownIcon from "../../icons/markdown-mark.svg?raw";
import mathIcon from "../../icons/math.svg?raw";
import noteIcon from "../../icons/note.svg?raw";
import internalLinkIcon from "../../icons/trilium.svg?raw";
import { ADMONITION_TYPE_NAMES, type AdmonitionType } from "../admonition/admonition_command.js";
import { getAdmonitionTitle } from "../admonition/admonition_ui.js";
import { COMMAND_NAME as INCLUDE_NOTE_COMMAND } from "../includenote.js";
import { COMMAND_NAME as INSERT_DATE_TIME_COMMAND } from "../insert_date_time.js";
import { COMMAND_NAME as INTERNAL_LINK_COMMAND } from "../internallink.js";
import { COMMAND_NAME as MARKDOWN_IMPORT_COMMAND } from "../markdownimport.js";
import MathUI from "../math/math_ui.js";
import { INSERT_MERMAID_COMMAND } from "../mermaid/insert_mermaid_command.js";
import type { MermaidSample } from "../mermaid/mermaid_ui.js";
import SnippetsEditing from "../snippets/snippetsediting.js";
import { registerMentionFeed } from "./register_feed.js";

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
    /** How many entries the palette shows at once. Unlimited by default, as premium's was. */
    dropdownLimit?: number;
}

/**
 * The `/` command palette, hosted on {@link TriliumMentionUI}.
 *
 * This replaces premium `SlashCommand`, which was the only remaining plugin forcing the `Mention`
 * façade — and therefore upstream's `MentionUI` — into the text editor alongside ours. Two mention
 * UIs sharing `mention.feeds` fight over the same `ContextualBalloon`: whichever adds its view
 * second buries the other, and the buried one then throws `contextualballoon-add-view-exist` on its
 * next keystroke.
 *
 * CKEditor built the premium plugin on `Mention` themselves, so hosting `/` on a mention feed is
 * not a workaround but the same architecture. What is reimplemented here is the palette: the
 * catalog, the matcher and the row rendering.
 */
export default class TriliumSlashCommands extends Plugin {

    static get pluginName() {
        return "TriliumSlashCommands" as const;
    }

    constructor(editor: Editor) {
        super(editor);

        registerMentionFeed(editor, {
            marker: SLASH_MARKER,
            // A bare `/` opens the full palette, as the premium plugin did.
            minimumCharacters: 0,
            // Premium defaulted this to `Infinity` and let the panel scroll. Capping it would hide
            // entries the user cannot then reach, since the query only narrows the list.
            dropdownLimit: (editor.config.get("slashCommand.dropdownLimit") as number | undefined) ?? Infinity,
            feed: (query: string) => matchSlashCommands(this._catalog(), query).map(toFeedItem),
            itemRenderer: (item) => renderRow(item as SlashCommandItem),
            // The catalog gates on `isEnabled` at query time, but an entry can go stale while the
            // panel is open; re-check here so a no-op commit never costs the user their `/query`.
            canCommit: (editorInstance, item) => isSlashCommandEnabled(editorInstance, (item as SlashCommandItem).definition),
            commit: (editorInstance, item) => runSlashCommand(editorInstance, (item as SlashCommandItem).definition)
        });
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

        return [ ...buildDefaultSlashCommands(editor), ...buildTriliumSlashCommands(editor), ...buildSnippetSlashCommands(editor) ]
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

type SlashCommandItem = MentionFeedObjectItem & { definition: SlashCommandDefinition };

function toFeedItem(definition: SlashCommandDefinition): SlashCommandItem {
    // Upstream requires a feed item's `id` to start with the marker.
    return { id: `${SLASH_MARKER}${definition.id}`, text: definition.title, definition };
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
        }
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
        ...buildMermaidSlashCommands(editor),
        {
            id: "collapsible",
            title: t("Collapsible block"),
            description: t("Insert a toggleable section that hides/shows content on click."),
            aliases: [ "details", "fold", "toggle" ],
            icon: collapsibleIcon,
            commandName: "collapsible"
        },
        {
            id: "footnote",
            title: t("Footnote"),
            description: t("Create a new footnote and reference it here"),
            icon: insertFootnoteIcon,
            commandName: "InsertFootnote"
        },
        {
            id: "datetime",
            title: t("Insert date/time"),
            description: t("Insert the current date and time"),
            icon: dateTimeIcon,
            commandName: INSERT_DATE_TIME_COMMAND
        },
        {
            id: "internal-link",
            title: t("Internal link"),
            description: t("Insert a link to another Trilium note"),
            aliases: [ "internal link", "trilium link", "reference link" ],
            icon: internalLinkIcon,
            commandName: INTERNAL_LINK_COMMAND
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
            id: "include-note",
            title: t("Include note"),
            description: t("Display the content of another note in this note"),
            icon: noteIcon,
            commandName: INCLUDE_NOTE_COMMAND
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
        }
    ];
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

/**
 * Renders one palette row: icon, title and description. The class names match premium's, so the
 * overrides Trilium already carries in `style.css` and the Next theme keep applying unchanged.
 */
function renderRow(item: SlashCommandItem): HTMLElement {
    const { definition } = item;

    const button = document.createElement("button");
    button.type = "button";
    button.tabIndex = -1;
    // `ck-button_with-text` is load-bearing, not cosmetic: the base button styles hide
    // `.ck-button__label` outright without it, which leaves the row showing its description and no
    // title at all.
    button.classList.add("ck", "ck-button", "ck-button_with-text", "ck-slash-command-button");

    const icon = document.createElement("span");
    icon.classList.add("ck", "ck-icon");

    if (definition.iconClass) {
        // A snippet note's font icon: the same chip, painted by icon-font classes instead of SVG.
        // The glyph lives on an inner span: core sizes the chip box in em against the chip's own
    // font-size, so enlarging the glyph's font on the chip itself would inflate the chip too.
        icon.classList.add("ck-slash-command-button__note-icon");
        const glyph = document.createElement("span");
        for (const classList of [ definition.iconClass, definition.iconColorClass ]) {
            if (classList) {
                glyph.classList.add(...classList.split(/\s+/).filter(Boolean));
            }
        }
        icon.append(glyph);
    } else if (definition.icon) {
        // `ck-icon_inherit-color` opts into core's `*:not([fill]) { fill: currentColor }` rule, as
        // `IconView` does — without it the glyphs keep SVG's default black fill on dark themes.
        icon.classList.add("ck-icon_inherit-color");
        icon.innerHTML = definition.icon;
    }

    button.append(icon);

    const textPart = document.createElement("span");
    textPart.classList.add("ck", "ck-slash-command-button__text-part");

    const label = document.createElement("span");
    label.classList.add("ck", "ck-button__label");
    label.textContent = definition.title;
    textPart.append(label);

    if (definition.description) {
        const description = document.createElement("span");
        description.classList.add("ck", "ck-slash-command-button__description");
        description.textContent = definition.description;
        textPart.append(description);
    }

    button.append(textPart);
    return button;
}
