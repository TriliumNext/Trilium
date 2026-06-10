import type { Editor } from 'ckeditor5';
import type { SlashCommandEditorConfig  } from 'ckeditor5-premium-features';
import { icons as footnoteIcons } from '@triliumnext/ckeditor5-footnotes';
import { IconPageBreak, IconAlignLeft, IconAlignCenter, IconAlignRight, IconAlignJustify, IconBulletedList, IconNumberedList, IconTodoList } from "@ckeditor/ckeditor5-icons";
import bxInfoCircle from "boxicons/svg/regular/bx-info-circle.svg?raw";
import bxBulb from "boxicons/svg/regular/bx-bulb.svg?raw";
import bxCommentError from "boxicons/svg/regular/bx-comment-error.svg?raw";
import bxErrorCircle from "boxicons/svg/regular/bx-error-circle.svg?raw";
import bxError from "boxicons/svg/regular/bx-error.svg?raw";
import { COMMAND_NAME as INSERT_DATE_TIME_COMMAND } from './plugins/insert_date_time.js';
import { COMMAND_NAME as INTERNAL_LINK_COMMAND } from './plugins/internallink.js';
import { COMMAND_NAME as INCLUDE_NOTE_COMMAND } from './plugins/includenote.js';
import { COMMAND_NAME as MARKDOWN_IMPORT_COMMAND } from './plugins/markdownimport.js';
import { ADMONITION_TYPES, type AdmonitionType } from '@triliumnext/ckeditor5-admonition';
import { icons as collapsibleIcons } from '@triliumnext/ckeditor5-collapsible';
import dateTimeIcon from './icons/date-time.svg?raw';
import internalLinkIcon from './icons/trilium.svg?raw';
import noteIcon from './icons/note.svg?raw';
import importMarkdownIcon from './icons/markdown-mark.svg?raw';
import { icons as mathIcons, MathUI } from '@triliumnext/ckeditor5-math';
import { INSERT_MERMAID_COMMAND, type MermaidSample } from '@triliumnext/ckeditor5-mermaid';
import { BookmarkUI } from "ckeditor5";
import bxBookmark from "boxicons/svg/regular/bx-bookmark.svg?raw";
import bxNetworkChart from "boxicons/svg/regular/bx-network-chart.svg?raw";

type SlashCommandDefinition = SlashCommandEditorConfig["extraCommands"][number];

/**
 * Translation function supplied by the client (which owns i18n). Resolves the
 * `slash_commands.*` (and `mermaid.*`) keys used for the command descriptions.
 * Command titles are intentionally kept hardcoded in English.
 */
export type SlashTranslateFn = (key: string, params?: Record<string, unknown>) => string;

export default function buildExtraCommands(
    t: SlashTranslateFn,
    mermaidSamples: MermaidSample[] = []
): SlashCommandDefinition[] {
    return [
        ...buildListExtraCommands(t),
        ...buildAlignmentExtraCommands(t),
        ...buildAdmonitionExtraCommands(t),
        ...buildMermaidCommands(t, mermaidSamples),
        {
            id: "collapsible",
            title: "Collapsible block",
            description: t("slash_commands.collapsible_description"),
            aliases: [ "details", "fold", "toggle" ],
            icon: collapsibleIcons.collapsibleIcon,
            commandName: "collapsible"
        },
        {
            id: 'footnote',
            title: 'Footnote',
            description: t("slash_commands.footnote_description"),
            icon: footnoteIcons.insertFootnoteIcon,
            commandName: "InsertFootnote"
        },
        {
            id: "datetime",
            title: "Insert date/time",
            description: t("slash_commands.datetime_description"),
            icon: dateTimeIcon,
            commandName: INSERT_DATE_TIME_COMMAND
        },
        {
            id: "internal-link",
            title: "Internal Trilium link",
            description: t("slash_commands.internal_link_description"),
            aliases: [ "internal link", "trilium link", "reference link" ],
            icon: internalLinkIcon,
            commandName: INTERNAL_LINK_COMMAND
        },
        {
            id: "math",
            title: "Math equation",
            description: t("slash_commands.math_description"),
            aliases: [ "latex", "equation" ],
            icon: mathIcons.ckeditor,
            execute: (editor: Editor) => editor.plugins.get(MathUI)._showUI()
        },
        {
            id: "include-note",
            title: "Include note",
            description: t("slash_commands.include_note_description"),
            icon: noteIcon,
            commandName: INCLUDE_NOTE_COMMAND
        },
        {
            id: "page-break",
            title: "Page break",
            description: t("slash_commands.page_break_description"),
            icon: IconPageBreak,
            commandName: "pageBreak"
        },
        {
            id: "markdown-import",
            title: "Markdown import",
            description: t("slash_commands.markdown_import_description"),
            icon: importMarkdownIcon,
            commandName: MARKDOWN_IMPORT_COMMAND
        },
        {
            id: "anchor",
            title: "Anchor",
            description: t("slash_commands.anchor_description"),
            aliases: [ "bookmark" ],
            icon: bxBookmark,
            execute: (editor: Editor) => {
                // Defer to the next event loop tick so the slash command fully finishes
                // its DOM/selection cleanup; _showFormView needs the view and mapper to
                // be in a settled state for balloon positioning.
                setTimeout(() => (editor.plugins.get(BookmarkUI) as any)._showFormView(), 0);
            }
        }
    ];
}

// Replaces CKEditor's built-in `bulletedList`/`numberedList`/`todoList` slash
// commands (removed via `removeCommands`), whose titles are Title Case, with
// sentence-case equivalents that run the same commands.
function buildListExtraCommands(t: SlashTranslateFn): SlashCommandDefinition[] {
    return [
        {
            id: "bulletedList",
            title: "Bulleted list",
            description: t("slash_commands.bulleted_list_description"),
            icon: IconBulletedList,
            commandName: "bulletedList"
        },
        {
            id: "numberedList",
            title: "Numbered list",
            description: t("slash_commands.numbered_list_description"),
            icon: IconNumberedList,
            commandName: "numberedList"
        },
        {
            id: "todoList",
            title: "To-do list",
            description: t("slash_commands.todo_list_description"),
            icon: IconTodoList,
            commandName: "todoList"
        }
    ];
}

function buildMermaidCommands(t: SlashTranslateFn, samples: MermaidSample[]): SlashCommandDefinition[] {
    // The blank diagram. Replaces CKEditor's built-in `insertMermaidCommand`
    // slash command (removed via `removeCommands`), which uses a generic icon.
    const blank: SlashCommandDefinition = {
        id: "mermaid",
        title: "Mermaid diagram",
        description: t("mermaid.slash_command_blank_description"),
        aliases: [ "mermaid", "diagram", "flowchart" ],
        icon: bxNetworkChart,
        commandName: INSERT_MERMAID_COMMAND
    };

    const templates = samples.map((sample, index) => ({
        id: `mermaid-sample-${index}`,
        title: `Mermaid diagram: ${sample.name}`,
        description: t("mermaid.slash_command_description", { name: sample.name }),
        aliases: [ "mermaid", "diagram", sample.name ],
        icon: bxNetworkChart,
        // Inserts a mermaid block pre-filled with the sample source (see insertMermaidCommand).
        execute: (editor: Editor) => editor.execute(INSERT_MERMAID_COMMAND, { source: sample.content })
    }));

    return [ blank, ...templates ];
}

function buildAlignmentExtraCommands(t: SlashTranslateFn): SlashCommandDefinition[] {
    return [
        {
            id: "align-left",
            title: "Align left",
            description: t("slash_commands.align_left_description"),
            icon: IconAlignLeft,
            execute: (editor: Editor) => editor.execute("alignment", { value: "left" }),
        },
        {
            id: "align-center",
            title: "Align center",
            description: t("slash_commands.align_center_description"),
            icon: IconAlignCenter,
            execute: (editor: Editor) => editor.execute("alignment", { value: "center" }),
        },
        {
            id: "align-right",
            title: "Align right",
            description: t("slash_commands.align_right_description"),
            icon: IconAlignRight,
            execute: (editor: Editor) => editor.execute("alignment", { value: "right" }),
        },
        {
            id: "align-justify",
            title: "Justify",
            description: t("slash_commands.justify_description"),
            icon: IconAlignJustify,
            execute: (editor: Editor) => editor.execute("alignment", { value: "justify" }),
        }
    ];
}

function buildAdmonitionExtraCommands(t: SlashTranslateFn): SlashCommandDefinition[] {
    const commands: SlashCommandDefinition[] = [];
    const admonitionIcons: Record<AdmonitionType, string> = {
        note: bxInfoCircle,
        tip: bxBulb,
        important: bxCommentError,
        caution: bxErrorCircle,
        warning: bxError,
    };

    for (const [ keyword, definition ] of Object.entries(ADMONITION_TYPES)) {
        commands.push({
            id: keyword,
            title: definition.title,
            description: t("slash_commands.admonition_description"),
            icon: admonitionIcons[keyword as AdmonitionType],
            execute: (editor: Editor) => editor.execute("admonition", { forceValue: keyword as AdmonitionType }),
            aliases: [ "box" ]
        });
    }
    return commands;
}
