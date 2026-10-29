import { EXTENDED_CODE_BLOCK_DEFAULT_LANGUAGE } from "@triliumnext/commons";
import bxCodeBlock from "boxicons/svg/regular/bx-code-block.svg?raw";
import { ButtonView, Command, type DowncastAttributeEvent, type Editor, Plugin } from "ckeditor5";

import ContentEmbed from "./content_embed.js";
import { INSERT_INLINE_EMBED_COMMAND } from "./inline_source.js";

export const INSERT_EXTENDED_CODE_BLOCK_COMMAND = "insertExtendedCodeBlock";

/** The toolbar button that inserts an extended code block. */
export const EXTENDED_CODE_BLOCK_BUTTON = "extendedCodeBlock";

/**
 * Extended code blocks: code blocks that the host shows and edits in its code editor, inside an
 * embed. `ContentEmbedInlineSource` saves each one as a `<pre><code class="language-…">` code block
 * of the note. This plugin adds the command and the button that insert one.
 */
export default class ExtendedCodeBlock extends Plugin {
    static get requires() {
        return [ ContentEmbed ] as const;
    }

    static get pluginName() {
        return "ExtendedCodeBlock" as const;
    }

    init() {
        const editor = this.editor;
        const t = editor.t;
        const command = new InsertExtendedCodeBlockCommand(editor);
        editor.commands.add(INSERT_EXTENDED_CODE_BLOCK_COMMAND, command);

        // A new block takes the language that was set last.
        editor.editing.downcastDispatcher.on<DowncastAttributeEvent>(
            "attribute:language:contentEmbed",
            (_evt, data) => {
                if (typeof data.attributeNewValue === "string") {
                    command.language = data.attributeNewValue;
                }
            }
        );

        editor.ui.componentFactory.add(EXTENDED_CODE_BLOCK_BUTTON, (locale) => {
            const button = new ButtonView(locale);
            button.set({ label: t("Extended code block"), icon: bxCodeBlock, tooltip: true });
            button.bind("isEnabled").to(command);
            this.listenTo(button, "execute", () => insertExtendedCodeBlock(editor));
            return button;
        });
    }
}

/** Inserts an empty extended code block, of the box size Full, which takes the focus. */
class InsertExtendedCodeBlockCommand extends Command {
    /** The language of the next block, as a CKEditor code block language. */
    language = EXTENDED_CODE_BLOCK_DEFAULT_LANGUAGE;

    override refresh() {
        this.isEnabled = !!this.editor.commands.get(INSERT_INLINE_EMBED_COMMAND)?.isEnabled;
    }

    override execute() {
        this.editor.execute(INSERT_INLINE_EMBED_COMMAND, {
            language: this.language,
            source: "",
            boxSize: "full"
        });
    }
}

/** Inserts an extended code block as its button does, and scrolls to it. */
export function insertExtendedCodeBlock(editor: Editor) {
    editor.execute(INSERT_EXTENDED_CODE_BLOCK_COMMAND);
    editor.editing.view.scrollToTheSelection();
    editor.editing.view.focus();
}

declare module "ckeditor5" {
    interface PluginsMap {
        [ExtendedCodeBlock.pluginName]: ExtendedCodeBlock;
    }
}
