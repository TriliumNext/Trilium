import utils from "../../../services/utils.js";
import options from "../../../services/options.js";
import { t } from "../../../services/i18n.js";
import { IconAlignCenter } from "@ckeditor/ckeditor5-icons";

/**
 * Whether a text note is edited with the classic toolbar — a bar standing above the note — rather
 * than the floating one, which follows the selection.
 *
 * Three things have a say, in this order. A view narrow enough to have asked for the floating
 * toolbar gets it whatever else is true (the geo map's marker pane; see `floatingToolbar` in
 * link.ts): a bar built for the width of a note fits none of them, on any device. Failing that a
 * phone always gets the classic bar, a balloon being hard to reach around a virtual keyboard. And
 * failing that it is the reader's own option.
 */
export function usesClassicToolbar({ floatingToolbarRequested, isMobile, textNoteEditorType }: {
    floatingToolbarRequested?: boolean;
    isMobile: boolean;
    textNoteEditorType: string;
}) {
    if (floatingToolbarRequested) {
        return false;
    }

    return isMobile || textNoteEditorType === "ckeditor-classic";
}

/**
 * @param aiAssistant whether the AI assistant is usable at all — the feature is switched on and a
 *                    provider is configured (see `buildAiAssistantStream`). When it isn't, its
 *                    entries are left out rather than shown permanently disabled: a button that
 *                    can never be pressed says nothing about why.
 */
export function buildToolbarConfig(isClassicToolbar: boolean, aiAssistant: boolean) {
    if (utils.isMobile()) {
        return buildMobileToolbar(aiAssistant);
    } else if (isClassicToolbar) {
        const multilineToolbar = utils.isDesktop() && options.get("textNoteEditorMultilineToolbar") === "true";
        return buildClassicToolbar(multilineToolbar, aiAssistant);
    } else {
        return buildFloatingToolbar(aiAssistant);
    }
}

export function buildMobileToolbar(aiAssistant: boolean) {
    const classicConfig = buildClassicToolbar(false, aiAssistant);
    const items: string[] = [];

    for (const item of classicConfig.toolbar.items) {
        if (typeof item === "object" && "items" in item) {
            for (const subitem of item.items) {
                items.push(subitem);
            }
        } else {
            items.push(item);
        }
    }

    return {
        ...classicConfig,
        toolbar: {
            ...classicConfig.toolbar,
            items
        }
    };
}

export function buildClassicToolbar(multilineToolbar: boolean, aiAssistant: boolean) {
    // For nested toolbars, refer to https://ckeditor.com/docs/ckeditor5/latest/getting-started/setup/toolbar.html#grouping-toolbar-items-in-dropdowns-nested-toolbars.
    return {
        toolbar: {
            items: [
                "heading",
                "fontSize",
                "|",
                "bold",
                "italic",
                {
                    ...buildTextFormattingGroup(),
                    items: ["underline", "strikethrough", "|", "superscript", "subscript", "|", "kbd"]
                },
                "formatPainter",
                "|",
                "fontColor",
                "fontBackgroundColor",
                "removeFormat",
                "|",
                "bulletedList",
                "numberedList",
                "todoList",
                "|",
                // Ahead of the overflow dropdown, which a single-line toolbar fills from the end:
                // down among the last items the assistant was grouped away at every ordinary note
                // width.
                ...(aiAssistant ? ["aiAssistant"] : []),
                "imageUpload",
                "blockQuote",
                "admonition",
                "insertTable",
                "|",
                "code",
                "codeBlock",
                "|",
                "footnote",
                {
                    ...buildInsertGroup(),
                    items: ["link", "linkEmbed", "bookmark", "internallink", "includeNote", "|", "collapsible", "math", "mermaid", "horizontalLine", "pageBreak", "|", "dateTime", "specialCharacters", "emoji"]
                },
                "|",
                buildAlignmentToolbar(),
                "outdent",
                "indent",
                "|",
                "insertTemplate",
                "markdownImport",
                "cuttonote",
                "copyBlockLink",
                "|",
                "undo",
                "redo"
            ],
            shouldNotGroupWhenFull: multilineToolbar
        }
    };
}

export function buildFloatingToolbar(aiAssistant: boolean) {
    return {
        toolbar: {
            items: [
                "fontSize",
                "bold",
                "italic",
                "underline",
                {
                    ...buildTextFormattingGroup(),
                    items: [ "strikethrough", "|", "superscript", "subscript", "|", "kbd" ]
                },
                "formatPainter",
                "|",
                "fontColor",
                "fontBackgroundColor",
                "|",
                // Heads the third group, as it does on the classic bar: the selection toolbar is
                // the assistant's own case — an instruction about the text under it — but leading
                // the bar outright puts it where the eye lands before the formatting it came for.
                // The block toolbar keeps its own entry for the other case: at a collapsed caret a
                // quick action widens to the block it sits in.
                ...(aiAssistant ? ["aiAssistant"] : []),
                "code",
                "link",
                "bookmark",
                "internallink",
                "collapsible",
                "|",
                "removeFormat",
                "cuttonote"
            ]
        },

        blockToolbar: [
            // With the separator, so dropping the assistant does not leave the bar opening on one.
            ...(aiAssistant ? ["aiAssistant", "|"] : []),
            "heading",
            "|",
            "bulletedList",
            "numberedList",
            "todoList",
            "|",
            "imageUpload",
            "blockQuote",
            "admonition",
            "codeBlock",
            "insertTable",
            "footnote",
            {
                ...buildInsertGroup(),
                items: ["link", "linkEmbed", "bookmark", "internallink", "includeNote", "|", "collapsible", "math", "mermaid", "horizontalLine", "pageBreak", "dateTime"]
            },
            "|",
            buildAlignmentToolbar(),
            "outdent",
            "indent",
            "|",
            "insertTemplate",
            "markdownImport",
            "specialCharacters",
            "emoji",
            "|",
            "copyBlockLink"
        ]
    };
}

// The labels below are resolved here rather than by the editor: CKEditor takes a nested toolbar
// dropdown's `label` verbatim (see `ToolbarView#_createNestedToolbarDropdown`), so it never reaches
// a translation function of its own. They render as the dropdown's tooltip and accessible name.

function buildTextFormattingGroup() {
    return {
        label: t("text-editor.toolbar-groups.text-formatting"),
        icon: "text"
    };
}

function buildInsertGroup() {
    return {
        label: t("text-editor.toolbar-groups.insert"),
        icon: "plus"
    };
}

function buildAlignmentToolbar() {
    return {
        label: t("text-editor.toolbar-groups.alignment"),
        icon: IconAlignCenter,
        items: ["alignment:left", "alignment:center", "alignment:right", "|", "alignment:justify"]
    };
}
