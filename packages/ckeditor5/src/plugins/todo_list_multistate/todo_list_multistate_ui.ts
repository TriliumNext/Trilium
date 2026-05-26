import { ButtonView, Plugin, View } from "ckeditor5";
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
    }

}
