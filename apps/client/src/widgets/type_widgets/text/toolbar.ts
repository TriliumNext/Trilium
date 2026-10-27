import utils, { isShareEditing } from "../../../services/utils.js";
import options from "../../../services/options.js";
import { t } from "../../../services/i18n.js";
import { IconAlignCenter } from "@ckeditor/ckeditor5-icons";

/**
 * The toolbar items a shared page's guest does without: those of `SHARE_EDIT_DISABLED_PLUGINS`,
 * the link preview, which fetches through the app, and the canvas, saved as an attachment.
 */
const SHARE_EDIT_HIDDEN_ITEMS = new Set([
    "aiAssistant", "linkEmbed", "internallink", "contentEmbed", "insertIcon", "drawingCanvas",
    "insertTemplate", "markdownImport", "cuttonote"
]);

/** The toolbar items that upload into the note, which a guest gets with `#shareAttachments`. */
const SHARE_EDIT_UPLOAD_ITEMS = new Set([ "attachMenu" ]);

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
    if (isShareEditing()) {
        const hidden = glob.shareEdit?.attachments
            ? SHARE_EDIT_HIDDEN_ITEMS
            : new Set([ ...SHARE_EDIT_HIDDEN_ITEMS, ...SHARE_EDIT_UPLOAD_ITEMS ]);
        return withoutItems(buildClassicToolbar(false, false), hidden);
    }

    if (utils.isMobile()) {
        return buildMobileToolbar(aiAssistant);
    } else if (isClassicToolbar) {
        const multilineToolbar = utils.isDesktop() && options.get("textNoteEditorMultilineToolbar") === "true";
        return buildClassicToolbar(multilineToolbar, aiAssistant);
    } else {
        return buildFloatingToolbar(aiAssistant);
    }
}

type ToolbarItem = string | { items: string[]; [key: string]: unknown };

/** The toolbar config without the items `hidden` names, at the top level and inside its groups. */
export function withoutItems<T extends { toolbar: { items: ToolbarItem[] } }>(
    config: T,
    hidden: Set<string>
): T {
    const items = config.toolbar.items
        .filter((item) => typeof item !== "string" || !hidden.has(item))
        .map((item) => (typeof item === "string"
            ? item
            : { ...item, items: item.items.filter((subitem) => !hidden.has(subitem)) }));
    return { ...config, toolbar: { ...config.toolbar, items } };
}

/**
 * The bar above the virtual keyboard: scrolling rows whose only nested group is the insert menu,
 * which holds the least used insertions. Undo and redo lead the main row, since a virtual keyboard
 * has no key for either. The `textFormatting` button swaps in a second row of the formatting
 * applied to text, which `TextFormattingToolbar` builds.
 */
export function buildMobileToolbar(aiAssistant: boolean) {
    return {
        toolbar: {
            items: [
                "undo",
                "redo",
                // Shown while the selection is in a widget, in place of the widget's balloon toolbar.
                "contextToolbar",
                "|",
                "blockType",
                {
                    ...buildInsertGroup(),
                    // Groups of three fill the rows of tiles.
                    asMenu: { layout: "tiles" },
                    items: [
                        // The image and the to-do list are also under the paperclip and in the block
                        // type menu, and these blocks in the latter, where a reader might not look.
                        // The size grid of `insertTable` needs a pointer that hovers over its cells.
                        "addImage", "insertTableMenu", "todoList",
                        "|",
                        "codeBlock", "blockQuote", "admonition",
                        "|",
                        "collapsible", "tabs", "multicolumnLayout",
                        "|",
                        "horizontalLine", "pageBreak", "footnote",
                        "|",
                        "math", "drawingCanvas", "mermaid",
                        "|",
                        "bookmark", "linkEmbed", "contentEmbed",
                        "|",
                        "specialCharacters", "emoji", "insertIcon",
                        "|",
                        "dateTime", "insertTemplate", "markdownImport"
                    ]
                },
                "textFormatting",
                "|",
                // The most used after the blocks and text formatting, so they show without scrolling.
                // One button for links to notes and to addresses, which the link dialog tells apart.
                "addLink",
                "attachMenu",
                "|",
                "outdent",
                "indent",
                "moveBlockUp",
                "moveBlockDown",
                ...(aiAssistant ? ["|", "aiAssistantMenu"] : [])
            ]
        },
        textFormattingToolbar: [
            "bold",
            "italic",
            "underline",
            "strikethrough",
            "code",
            "|",
            // Turns the selection into a link.
            "addLink",
            "|",
            "superscript",
            "subscript",
            "kbd",
            "|",
            "fontSizeMenu",
            "colorMenu",
            "|",
            "removeFormat",
            "formatPainter",
            "|",
            // Of the block, but set as the look of selected text is.
            "alignment:left",
            "alignment:center",
            "alignment:right",
            "alignment:justify",
            "|",
            // Acts on the selection, which brings this row up.
            "cuttonote"
        ],
        // The row of the `contextToolbar` button in a list, as a list has no toolbar of its own. It
        // replaces the main row, so it repeats the indentation and the moves, used most in a list.
        listToolbar: [
            "outdent", "indent", "moveBlockUp", "moveBlockDown",
            "|",
            "listTypeMenu", "listStartAt", "listReversed"
        ],
        attachMenu: { camera: true }
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
                "attachMenu",
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
                    items: ["link", "linkEmbed", "bookmark", "internallink", "contentEmbed", "|", "collapsible", "tabs", "multicolumnLayout", "math", "drawingCanvas", "mermaid", "horizontalLine", "pageBreak", "|", "dateTime", "specialCharacters", "emoji", "insertIcon"]
                },
                "|",
                buildAlignmentToolbar(),
                "outdent",
                "indent",
                "|",
                "insertTemplate",
                "markdownImport",
                "cuttonote",
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
            "attachMenu",
            "blockQuote",
            "admonition",
            "codeBlock",
            "insertTable",
            "footnote",
            {
                ...buildInsertGroup(),
                items: ["link", "linkEmbed", "bookmark", "internallink", "contentEmbed", "|", "collapsible", "tabs", "multicolumnLayout", "math", "drawingCanvas", "mermaid", "horizontalLine", "pageBreak", "dateTime"]
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
            "insertIcon"
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
        icon: "plus",
        // The group holds enough entries that a strip of icons reads as a puzzle; `asMenu` (see
        // the `ToolbarGroupMenu` plugin) opens it as the app's menu of icon-and-label rows instead.
        asMenu: true
    };
}

function buildAlignmentToolbar() {
    return {
        label: t("text-editor.toolbar-groups.alignment"),
        icon: IconAlignCenter,
        items: ["alignment:left", "alignment:center", "alignment:right", "|", "alignment:justify"]
    };
}
