import childNoteIcon from "boxicons/svg/regular/bx-note.svg?raw";
import { ButtonView, Command, Plugin } from "ckeditor5";

import ReferenceLink from "./referencelink.js";

export const COMMAND_NAME = "childNote";

/**
 * The "New child note" button: has the host create a child note of the note the editor holds, which
 * the host links to at the selection and opens for the user to name.
 */
export default class ChildNotePlugin extends Plugin {

    static get requires() {
        return [ ReferenceLink ] as const;
    }

    static get pluginName() {
        return "ChildNote" as const;
    }

    init() {
        const editor = this.editor;
        const t = editor.t;
        const command = new ChildNoteCommand(editor);

        editor.commands.add(COMMAND_NAME, command);

        editor.ui.componentFactory.add(COMMAND_NAME, (locale) => {
            const button = new ButtonView(locale);

            button.set({
                label: t("New child note"),
                icon: childNoteIcon,
                tooltip: true
            });
            button.bind("isEnabled").to(command, "isEnabled");
            this.listenTo(button, "execute", () => editor.execute(COMMAND_NAME));

            return button;
        });
    }
}

/** Enabled wherever the reference link to the new note can go, with a host to create the note. */
class ChildNoteCommand extends Command {

    override refresh() {
        const { model } = this.editor;
        const position = model.document.selection.getFirstPosition();

        this.isEnabled = !!this.editor.config.get("childNote")
            && !!position
            && !position.findAncestor("codeBlock")
            && model.schema.checkChild(position, "reference");
    }

    override execute() {
        this.editor.config.get("childNote")?.create();
    }
}

declare module "ckeditor5" {
    interface EditorConfig {
        childNote?: {
            /**
             * Creates a child note of the note the editor holds, links to it at the selection and
             * opens it with its title selected.
             */
            create(): void;
        };
    }
}
