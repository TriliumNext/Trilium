import utils from "../../../services/utils.js";
import options from "../../../services/options.js";
import IconAlignCenter from "@ckeditor/ckeditor5-icons/theme/icons/align-center.svg?raw";

const TEXT_FORMATTING_GROUP = {
    label: "Text formatting",
    icon: "text"
};

export function buildToolbarConfig(isClassicToolbar: boolean) {
    if (utils.isMobile()) {
        return buildMobileToolbar();
    } else if (isClassicToolbar) {
        const multilineToolbar = utils.isDesktop() && options.get("textNoteEditorMultilineToolbar") === "true";
        return buildClassicToolbar(multilineToolbar);
    } else {
        return buildFloatingToolbar();
    }
}

export function buildMobileToolbar() {
    const classicConfig = buildClassicToolbar(false);
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

export function buildClassicToolbar(multilineToolbar: boolean) {
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
                    ...TEXT_FORMATTING_GROUP,
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
                "blockQuote",
                "admonition",
                "insertTable",
                "|",
                "code",
                "codeBlock",
                "|",
                "footnote",
                {
                    label: "Insert",
                    icon: "plus",
                    items: ["imageUpload", "|", "link", "bookmark", "internallink", "includeNote", "|", "specialCharacters", "emoji", "math", "mermaid", "horizontalLine", "pageBreak", "dateTime"]
                },
                "|",
                buildAlignmentToolbar(),
                "outdent",
                "indent",
                "|",
                "insertTemplate",
                "markdownImport",
                "cuttonote"
            ],
            shouldNotGroupWhenFull: multilineToolbar
        }
    };
}

export function buildFloatingToolbar() {
    return {
        toolbar: {
            items: [
                "fontSize",
                "bold",
                "italic",
                "underline",
                {
                    ...TEXT_FORMATTING_GROUP,
                    items: [ "strikethrough", "|", "superscript", "subscript", "|", "kbd" ]
                },
                "formatPainter",
                "|",
                "fontColor",
                "fontBackgroundColor",
                "|",
                "code",
                "link",
                "bookmark",
                "removeFormat",
                "internallink",
                "cuttonote"
            ]
        },

        blockToolbar: [
            "heading",
            "|",
            "bulletedList",
            "numberedList",
            "todoList",
            "|",
            "blockQuote",
            "admonition",
            "codeBlock",
            "insertTable",
            "footnote",
            {
                label: "Insert",
                icon: "plus",
                items: ["link", "bookmark", "internallink", "includeNote", "|", "math", "mermaid", "horizontalLine", "pageBreak", "dateTime"]
            },
            "|",
            buildAlignmentToolbar(),
            "outdent",
            "indent",
            "|",
            "insertTemplate",
            "imageUpload",
            "markdownImport",
            "specialCharacters",
            "emoji"
        ]
    };
}

function buildAlignmentToolbar() {
    return {
        label: "Alignment",
        icon: IconAlignCenter,
        items: ["alignment:left", "alignment:center", "alignment:right", "|", "alignment:justify"]
    };
}
