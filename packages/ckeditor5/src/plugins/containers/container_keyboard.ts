import { type Editor, env, Plugin } from "ckeditor5";

import { addEditingKeydownCapture } from "../move_block_updown.js";
import type { SiblingTarget } from "./container_content.js";

/** The commands that the keyboard runs in one kind of container, such as a layout column. */
export interface ContainerCommands {
    /**
     * Moves the selected content to another container and takes `{ target }`. Its keys act only
     * while it is enabled, so a caret keeps word jumps and select-to-edge.
     */
    moveContent: string;
    /** Moves the current container and takes `{ target }`. */
    moveContainer: string;
    /** Adds a container next to the current one and takes `{ position }`. */
    insert: string;
}

/**
 * Keyboard shortcuts of containers that sit side by side, such as layout columns and tabs. In the
 * innermost registered container around the selection, Ctrl+Left/Right and Ctrl+Shift+Home/End
 * move the selected content to another container, Ctrl+Alt+Left/Right/Home/End move the
 * container, and Ctrl+Enter and Ctrl+Shift+Enter add a container after or before it. Ctrl is Cmd
 * on macOS.
 */
export default class ContainerKeyboard extends Plugin {

    public static get pluginName() {
        return "ContainerKeyboard" as const;
    }

    /** The commands of each registered container, keyed by its model element name. */
    private readonly containers = new Map<string, ContainerCommands>();

    /** Lets the shortcuts act in `element` containers, through `commands`. */
    public register(element: string, commands: ContainerCommands): void {
        this.containers.set(element, commands);
    }

    public init(): void {
        const editor = this.editor;

        // The capture phase runs before `TodoListEditing`, which stops every Ctrl+Enter.
        addEditingKeydownCapture(this, event => {
            const isRtl = editor.locale.contentLanguageDirection === "rtl";
            const shortcut = getShortcut(event, isRtl);
            const commands = shortcut && this.getInnermostCommands();
            if (!shortcut || !commands || !appliesAtSelection(editor, shortcut, commands)) {
                return;
            }

            // At either end, or where no container can be added, the key does nothing.
            event.preventDefault();
            event.stopImmediatePropagation();
            const command = commands[shortcut.action];
            if (!editor.commands.get(command)?.isEnabled) {
                return;
            }
            const version = editor.model.document.version;
            if (shortcut.action === "insert") {
                editor.execute(command, { position: shortcut.position });
            } else {
                editor.execute(command, { target: shortcut.target });
            }
            if (editor.model.document.version !== version) {
                editor.editing.view.scrollToTheSelection();
            }
        });
    }

    /** Returns the commands of the innermost registered container around the selection. */
    private getInnermostCommands(): ContainerCommands | null {
        const position = this.editor.model.document.selection.getFirstPosition();
        /* v8 ignore next -- the document selection always has a position */
        for (const ancestor of position?.getAncestors().reverse() ?? []) {
            const commands = ancestor.is("element") && this.containers.get(ancestor.name);
            if (commands) {
                return commands;
            }
        }
        return null;
    }

}

type Shortcut =
    | { action: "moveContent" | "moveContainer"; target: SiblingTarget }
    | { action: "insert"; position: "before" | "after" };

/**
 * Returns the shortcut that `event` presses. Left and Right follow the screen, so in right-to-left
 * content Right moves toward the first container.
 */
function getShortcut(event: KeyboardEvent, isRtl: boolean): Shortcut | null {
    const { altKey: alt, shiftKey: shift } = event;
    const ctrl = env.isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
    if (!ctrl) {
        return null;
    }

    const action = alt ? "moveContainer" : "moveContent";
    switch (event.key) {
        case "ArrowLeft":
        case "ArrowRight": {
            const target = (event.key === "ArrowRight") !== isRtl ? "next" : "previous";
            return shift ? null : { action, target };
        }
        case "Home":
        case "End": {
            const target = event.key === "Home" ? "first" : "last";
            return alt === shift ? null : { action, target };
        }
        case "Enter":
            return alt ? null : { action: "insert", position: shift ? "before" : "after" };
        default:
            return null;
    }
}

/**
 * Whether `shortcut` acts on the selection in a container. Ctrl+Enter stays with links, to-do items
 * and collapsible titles, and Ctrl+Shift+Enter with to-do items.
 */
function appliesAtSelection(editor: Editor, shortcut: Shortcut, commands: ContainerCommands) {
    const selection = editor.model.document.selection;
    switch (shortcut.action) {
        case "moveContent":
            return !!editor.commands.get(commands.moveContent)?.isEnabled;
        case "moveContainer":
            return true;
        case "insert":
            if (shortcut.position === "before") {
                return !editor.commands.get("setTaskState")?.isEnabled;
            }
            return !editor.commands.get("checkTodoList")?.isEnabled
                && !selection.hasAttribute("linkHref")
                && !selection.getSelectedElement()?.is("element", "reference")
                && !selection.getFirstPosition()?.findAncestor("summary");
    }
}

declare module "ckeditor5" {
    interface PluginsMap {
        [ContainerKeyboard.pluginName]: ContainerKeyboard;
    }
}
