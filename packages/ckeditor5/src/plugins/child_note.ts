import childNoteIcon from "boxicons/svg/regular/bx-subdirectory-right.svg?raw";
import { ButtonView, Command, ModelLivePosition, Plugin } from "ckeditor5";

import ReferenceLink from "./referencelink.js";

export const COMMAND_NAME = "childNote";

/**
 * The "New child note" button: has the host create a child note of the note the editor holds,
 * links to it at the selection, and has the host open it for the user to name.
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

    /**
     * Has the host create the note, then links to it where the selection was. Skips the link when
     * the content was replaced meanwhile, as switching the editor to another note does.
     */
    override async execute() {
        const editor = this.editor;
        const host = editor.config.get("childNote");
        const selectionPosition = editor.model.document.selection.getFirstPosition();
        if (!host || !selectionPosition) {
            return;
        }

        const position = ModelLivePosition.fromPosition(selectionPosition, "toPrevious");
        try {
            const notePath = await host.create();
            if (notePath && position.root.rootName !== "$graveyard") {
                editor.execute("referenceLink", {
                    href: `#${notePath}`, position: position.toPosition()
                });
                host.open(notePath);
            }
        } finally {
            position.detach();
        }
    }
}

/** Creates and opens the child notes the `childNote` command links to. */
export interface ChildNoteHost {
    /**
     * Creates an empty child note of the note the editor holds, and resolves to the path of the
     * new note, or to `undefined` when none is created.
     */
    create(): Promise<string | undefined>;
    /** Opens the new note at `notePath` for the user to name, once the editor links to it. */
    open(notePath: string): void;
}

declare module "ckeditor5" {
    interface EditorConfig {
        childNote?: ChildNoteHost;
    }
}
