import {
    CodeBlock,
    Plugin,
    ViewDocumentFragment,
    WidgetToolbarRepository,
    type ViewNode,
} from "ckeditor5";
import CodeBlockLanguageDropdown from "./code_block_language_dropdown";
import CopyToClipboardButton from "./copy_to_clipboard_button";
import FormatCodeblockButton from "./format_codeblock/format_codeblock_button";

export default class CodeBlockToolbar extends Plugin {
    static get requires() {
        return [
            WidgetToolbarRepository,
            CodeBlock,
            CodeBlockLanguageDropdown,
            CopyToClipboardButton,
            FormatCodeblockButton,
        ] as const;
    }

    afterInit() {
        const editor = this.editor;
        const widgetToolbarRepository = editor.plugins.get(
            WidgetToolbarRepository,
        );

        widgetToolbarRepository.register("codeblock", {
            items: [
                "codeBlockDropdown",
                "|",
                "copyToClipboard",
                "formatCodeblock",
            ],
            balloonClassName: "ck-toolbar-container codeblock-language-list",
            getRelatedElement(selection) {
                const selectionPosition = selection.getFirstPosition();
                if (!selectionPosition) {
                    return null;
                }

                let parent: ViewNode | ViewDocumentFragment | null =
                    selectionPosition.parent;
                while (parent) {
                    if (parent.is("element", "pre")) {
                        return parent;
                    }

                    parent = parent.parent;
                }

                return null;
            },
        });

        // Hide balloon toolbar when in a code block
        if (editor.plugins.has("BalloonToolbar")) {
            editor.listenTo(
                editor.plugins.get("BalloonToolbar"),
                "show",
                (evt) => {
                    const firstPosition =
                        editor.model.document.selection.getFirstPosition();
                    const isInCodeBlock =
                        firstPosition?.findAncestor("codeBlock");

                    if (isInCodeBlock) {
                        evt.stop(); // Prevent the balloon toolbar from showing
                    }
                },
                { priority: "high" },
            );
        }
    }
}
