import type { Editor } from 'ckeditor5';
import type { SlashCommandEditorConfig  } from 'ckeditor5-premium-features';
import { icons as footnoteIcons } from '@triliumnext/ckeditor5-footnotes';
import IconPageBreak from "@ckeditor/ckeditor5-icons/theme/icons/page-break.svg?raw";
import IconAlignLeft from "@ckeditor/ckeditor5-icons/theme/icons/align-left.svg?raw";
import IconAlignCenter from "@ckeditor/ckeditor5-icons/theme/icons/align-center.svg?raw";
import IconAlignRight from "@ckeditor/ckeditor5-icons/theme/icons/align-right.svg?raw";
import IconAlignJustify from "@ckeditor/ckeditor5-icons/theme/icons/align-justify.svg?raw";
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
import dateTimeIcon from './icons/date-time.svg?raw';
import internalLinkIcon from './icons/trilium.svg?raw';
import noteIcon from './icons/note.svg?raw';
import importMarkdownIcon from './icons/markdown-mark.svg?raw';
import { icons as mathIcons, MathUI } from '@triliumnext/ckeditor5-math';

type SlashCommandDefinition = SlashCommandEditorConfig["extraCommands"][number];

export default function buildExtraCommands(): SlashCommandDefinition[] {
    return [
        ...buildAlignmentExtraCommands(),
        ...buildAdmonitionExtraCommands(),
        {
            id: 'footnote',
            title: 'Footnote',
            description: 'Create a new footnote and reference it here',
            icon: footnoteIcons.insertFootnoteIcon,
            commandName: "InsertFootnote"
        },
        {
            id: "datetime",
            title: "Insert Date/Time",
            description: "Insert the current date and time",
            icon: dateTimeIcon,
            commandName: INSERT_DATE_TIME_COMMAND
        },
        {
            id: "internal-link",
            title: "Internal Trilium link",
            description: "Insert a link to another Trilium note",
            aliases: [ "internal link", "trilium link", "reference link" ],
            icon: internalLinkIcon,
            commandName: INTERNAL_LINK_COMMAND
        },
        {
            id: "math",
            title: "Math equation",
            description: "Insert a math equation",
            aliases: [ "latex", "equation" ],
            icon: mathIcons.ckeditor,
            execute: (editor: Editor) => editor.plugins.get(MathUI)._showUI()
        },
        {
            id: "include-note",
            title: "Include note",
            description: "Display the content of another note in this note",
            icon: noteIcon,
            commandName: INCLUDE_NOTE_COMMAND
        },
        {
            id: "page-break",
            title: "Page break",
            description: "Insert a page break (for printing)",
            icon: IconPageBreak,
            commandName: "pageBreak"
        },
        {
            id: "markdown-import",
            title: "Markdown import",
            description: "Import a markdown file into this note",
            icon: importMarkdownIcon,
            commandName: MARKDOWN_IMPORT_COMMAND
        }
    ];
}

function buildAlignmentExtraCommands(): SlashCommandDefinition[] {
    return [
        {
            id: "align-left",
            title: "Align Left",
            description: "Align text to the left",
            icon: IconAlignLeft,
            execute: (editor: Editor) => editor.execute("alignment", { value: "left" }),
        },
        {
            id: "align-center",
            title: "Align Center",
            description: "Align text to the center",
            icon: IconAlignCenter,
            execute: (editor: Editor) => editor.execute("alignment", { value: "center" }),
        },
        {
            id: "align-right",
            title: "Align Right",
            description: "Align text to the right",
            icon: IconAlignRight,
            execute: (editor: Editor) => editor.execute("alignment", { value: "right" }),
        },
        {
            id: "align-justify",
            title: "Justify",
            description: "Justify text alignment",
            icon: IconAlignJustify,
            execute: (editor: Editor) => editor.execute("alignment", { value: "justify" }),
        }
    ];
}

function buildAdmonitionExtraCommands(): SlashCommandDefinition[] {
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
            description: "Inserts a new admonition",
            icon: admonitionIcons[keyword as AdmonitionType],
            execute: (editor: Editor) => editor.execute("admonition", { forceValue: keyword as AdmonitionType }),
            aliases: [ "box" ]
        });
    }
    return commands;
}

