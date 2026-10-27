import bxPencil from "boxicons/svg/regular/bx-pencil.svg?raw";
import { ButtonView, Plugin, View, type Editor, type ToolbarConfigItem } from "ckeditor5";
import TodoListMultistateEditing, { getActiveTaskStates } from "./todo_list_multistate_editing.js";

export default class TodoListMultistateUI extends Plugin {

    static get requires() {
        return [TodoListMultistateEditing] as const;
    }

    init() {
        const editor = this.editor;
        const command = editor.commands.get("setTaskState")!;

        for (const state of getActiveTaskStates(editor)) {
            editor.ui.componentFactory.add(`taskState:${state.name}`, (locale) => {
                const button = new ButtonView(locale);
                button.set({
                    label: state.title || state.name,
                    withText: false,
                    tooltip: true,
                    class: "ck-task-state-button"
                });

                // A checkbox preview inside the button, styled by the same
                // `[data-trilium-task-state]` CSS that decorates the real checkboxes.
                const preview = new View(locale);
                preview.setTemplate({
                    tag: "div",
                    attributes: {
                        class: "tn-task-checkbox ck-reset_all-excluded",
                        "data-trilium-task-state": state.name
                    }
                });
                button.children.add(preview);

                button.bind("isOn").to(command, "value", (value) => value === state.name);
                button.bind("isEnabled").to(command, "isEnabled");
                button.on("execute", () => {
                    editor.execute("setTaskState", {state: state.name});
                    editor.editing.view.focus();
                });
                return button;
            });
        }

        editor.ui.componentFactory.add("taskStateEdit", (locale) => {
            const button = new ButtonView(locale);
            button.set({
                label: editor.t("Edit task states"),
                icon: bxPencil,
                tooltip: true,
                class: "ck-task-state-edit"
            });
            button.on("execute", () => {
                const editTaskStates = editor.config.get("editTaskStates") as (() => void) | undefined;
                editTaskStates?.();
            });
            return button;
        });
    }

}

/** The task state buttons and the button that edits the states, as the task state toolbar holds them. */
export function getTaskStateToolbarItems(editor: Editor): ToolbarConfigItem[] {
    return [...getActiveTaskStates(editor).map((state) => `taskState:${state.name}`), "|", "taskStateEdit"];
}
