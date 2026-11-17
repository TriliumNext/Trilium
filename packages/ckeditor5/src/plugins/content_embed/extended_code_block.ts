import {
    EXTENDED_CODE_BLOCK_DEFAULT_LANGUAGE
} from "@triliumnext/commons/src/lib/content_embeds.js";
import { MIME_TYPE_AUTO } from "@triliumnext/commons/src/lib/mime_type.js";
import { type DowncastAttributeEvent, type ModelElement, Plugin } from "ckeditor5";

import CopyToClipboardButton, { createCopyToClipboardButton } from "../copy_to_clipboard_button.js";
import ContentEmbed from "./content_embed.js";
import ContentEmbedInlineSource, {
    getSelectedExtendedCodeBlock, isCodeBlockExtended, isExtendedCodeBlock
} from "./inline_source.js";

/** The button of the embed toolbar that copies the code of the selected extended code block. */
export const EXTENDED_CODE_BLOCK_COPY_BUTTON = "extendedCodeBlockCopy";

/**
 * Extended code blocks: code blocks that the host shows and edits in its code editor, inside an
 * embed. `ContentEmbedInlineSource` saves each one as a `<pre><code class="language-…">` code block
 * of the note. While `contentEmbed.isCodeBlockExtended`, they replace the code blocks of CKEditor:
 * the `codeBlock` command makes one, and a block saved as `MIME_TYPE_AUTO` takes the language that
 * the host detects.
 */
export default class ExtendedCodeBlock extends Plugin {
    /** Whether the selection is on an extended code block. */
    declare public isSelected: boolean;

    /** The language of a new block: the one set last on a block, as a code block language. */
    private language = EXTENDED_CODE_BLOCK_DEFAULT_LANGUAGE;

    static get requires() {
        return [ ContentEmbed, CopyToClipboardButton ] as const;
    }

    static get pluginName() {
        return "ExtendedCodeBlock" as const;
    }

    init() {
        const editor = this.editor;

        this.set("isSelected", false);
        // Runs before `WidgetToolbarRepository` positions the toolbar from its width.
        this.listenTo(editor.ui, "update", () => {
            this.isSelected = !!getSelectedExtendedCodeBlock(editor);
        }, { priority: "high" });

        editor.ui.componentFactory.add(EXTENDED_CODE_BLOCK_COPY_BUTTON, (locale) => {
            const button = createCopyToClipboardButton(editor, locale);
            button.bind("isVisible").to(this, "isSelected");
            return button;
        });
    }

    afterInit() {
        if (isCodeBlockExtended(this.editor)) {
            this.replaceCodeBlocks();
        }
    }

    /** Has the `codeBlock` command make extended code blocks, and detects their languages. */
    private replaceCodeBlocks() {
        const editor = this.editor;
        const command = editor.commands.get("codeBlock");
        if (command) {
            // `Command` stops the execution of a disabled command before this listener.
            this.listenTo(command, "execute", (evt, [ options ]: [ CodeBlockOptions? ]) => {
                // The selection is in a `codeBlock` of CKEditor, or the caller removes one.
                if (command.value || options?.forceValue === false) {
                    return;
                }
                if (this.makeCodeBlocks(options?.language || this.language)) {
                    editor.editing.view.scrollToTheSelection();
                    evt.stop();
                }
            }, { priority: "high" });
        }

        // Fires for the language of an inserted block too, with no old value.
        editor.editing.downcastDispatcher.on<DowncastAttributeEvent<ModelElement>>(
            "attribute:language:contentEmbed",
            (_evt, data) => {
                const { attributeNewValue: language, attributeOldValue: oldLanguage } = data;
                if (language === MIME_TYPE_AUTO) {
                    void this.detectLanguage(data.item);
                } else if (typeof language === "string" && typeof oldLanguage === "string"
                    && oldLanguage !== MIME_TYPE_AUTO && isExtendedCodeBlock(editor, data.item)) {
                    // A language that the user set: a detected one replaces `MIME_TYPE_AUTO`.
                    this.language = language;
                }
            }
        );
    }

    /**
     * Turns the selected text blocks into extended code blocks of `language`, one for each run of
     * sibling blocks, and has the first take the focus. Returns whether it made one.
     */
    private makeCodeBlocks(language: string) {
        const editor = this.editor;
        const model = editor.model;
        const schema = model.schema;
        const blocks = Array.from(model.document.selection.getSelectedBlocks())
            .filter((block) => !schema.isLimit(block)
                && schema.checkChild(model.createPositionBefore(block), "contentEmbed"));
        if (!blocks.length) {
            return false;
        }

        this.language = language;
        model.change((writer) => {
            const codeBlocks = getSiblingRuns(blocks).map((run) => {
                const codeBlock = writer.createElement("contentEmbed", {
                    language,
                    source: run.map(getCodeText).join("\n"),
                    boxSize: "full",
                    hideTitle: true,
                    editable: true
                });
                writer.insert(codeBlock, run[0], "before");
                // A block of a list item stays one, and a referenced block keeps its ID.
                for (const [ name, value ] of run[0].getAttributes()) {
                    if (schema.checkAttribute(codeBlock, name)) {
                        writer.setAttribute(name, value, codeBlock);
                    }
                }
                for (const block of run) {
                    writer.remove(block);
                }
                return codeBlock;
            });
            editor.plugins.get(ContentEmbedInlineSource).focusOnLoad(codeBlocks[0]);
            writer.setSelection(codeBlocks[0], "on");
        });
        return true;
    }

    /**
     * Sets the language that the host detects in the code of `codeBlock`, saved as
     * `MIME_TYPE_AUTO`, outside the undo stack. Code that reads as no language is plain text.
     */
    private async detectLanguage(codeBlock: ModelElement) {
        const editor = this.editor;
        const detect = editor.config.get("contentEmbed")?.detectLanguage;
        if (!detect || editor.isReadOnly || codeBlock.getAttribute("language") !== MIME_TYPE_AUTO) {
            return;
        }

        const code = codeBlock.getAttribute("source") as string | undefined ?? "";
        const language = await detect(code) ?? EXTENDED_CODE_BLOCK_DEFAULT_LANGUAGE;
        const root = codeBlock.root;
        if (editor.state === "destroyed" || !root.is("rootElement")
            || root.rootName === "$graveyard"
            || codeBlock.getAttribute("language") !== MIME_TYPE_AUTO) {
            return;
        }
        editor.model.enqueueChange({ isUndoable: false }, (writer) => {
            writer.setAttribute("language", language, codeBlock);
        });
    }
}

/** The options of the `codeBlock` command of CKEditor that the replacement reads. */
interface CodeBlockOptions {
    language?: string;
    forceValue?: boolean;
}

/**
 * `blocks`, in document order, as the runs of blocks that follow each other in one parent and in
 * one list item, or outside a list.
 */
function getSiblingRuns(blocks: ModelElement[]) {
    const runs: ModelElement[][] = [];
    for (const block of blocks) {
        const run = runs.at(-1);
        const last = run?.at(-1);
        if (run && last?.nextSibling === block
            && last.getAttribute("listItemId") === block.getAttribute("listItemId")) {
            run.push(block);
        } else {
            runs.push([ block ]);
        }
    }
    return runs;
}

/** The text of `block` as a line of code, with a soft break as a line break. */
function getCodeText(block: ModelElement) {
    return Array.from(block.getChildren())
        .map((child) => {
            if (child.is("$text")) {
                return child.data;
            }
            return child.is("element", "softBreak") ? "\n" : "";
        })
        .join("");
}

declare module "ckeditor5" {
    interface PluginsMap {
        [ExtendedCodeBlock.pluginName]: ExtendedCodeBlock;
    }
}
