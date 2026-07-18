import { DEFAULT_TASK_STATES, DONE_STATE_NAME, NONE_STATE_NAME, type TaskStateDef } from "@triliumnext/commons";
import { _setModelData as setModelData, ClassicEditor, Essentials, Paragraph, TodoList } from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import TodoListMultistateEditing, { getActiveTaskStates } from "./todo_list_multistate_editing.js";
import TodoListMultistateUI from "./todo_list_multistate_ui.js";

// A minimal todo-list item fixture (selection inside the list item).
const TODO_FIXTURE =
    '<paragraph listIndent="0" listItemId="i-a" listType="todo">Task[]</paragraph>';

describe("TodoListMultistateUI", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createTestEditor([Essentials, Paragraph, TodoList, TodoListMultistateEditing, TodoListMultistateUI]);
    });

    it("loads the plugin", () => {
        expect(editor.plugins.get(TodoListMultistateUI)).toBeInstanceOf(TodoListMultistateUI);
    });

    it("registers a toolbar component for every active task state", () => {
        const activeStates = getActiveTaskStates(editor);
        expect(activeStates.length).toBeGreaterThan(0);
        for (const state of activeStates) {
            expect(editor.ui.componentFactory.has(`taskState:${state.name}`)).toBe(true);
        }
    });

    it("button label uses state.title when available", () => {
        const activeStates = getActiveTaskStates(editor);
        const first = activeStates[0];
        if (!first) {
            return;
        }
        const button = editor.ui.componentFactory.create(`taskState:${first.name}`) as { label: string };
        expect(button.label).toBe(first.title || first.name);
    });

    it("button has tooltip enabled and the ck-task-state-button class", () => {
        const activeStates = getActiveTaskStates(editor);
        const first = activeStates[0];
        if (!first) {
            return;
        }
        const button = editor.ui.componentFactory.create(`taskState:${first.name}`) as {
            tooltip: boolean;
            class: string;
        };
        expect(button.tooltip).toBe(true);
        expect(button.class).toBe("ck-task-state-button");
    });

    it("button is bound to command isEnabled — disabled outside a todo item", () => {
        setModelData(editor.model, "<paragraph>plain text[]</paragraph>");
        const activeStates = getActiveTaskStates(editor);
        const first = activeStates[0];
        if (!first) {
            return;
        }
        const command = editor.commands.get("setTaskState");
        const button = editor.ui.componentFactory.create(`taskState:${first.name}`) as { isEnabled: boolean };

        // The button must mirror the command.
        expect(button.isEnabled).toBe(command?.isEnabled);
        expect(button.isEnabled).toBe(false);
    });

    it("button is enabled inside a todo item", () => {
        setModelData(editor.model, TODO_FIXTURE);
        const activeStates = getActiveTaskStates(editor);
        const first = activeStates[0];
        if (!first) {
            return;
        }
        const command = editor.commands.get("setTaskState");
        const button = editor.ui.componentFactory.create(`taskState:${first.name}`) as { isEnabled: boolean };

        expect(button.isEnabled).toBe(command?.isEnabled);
        expect(button.isEnabled).toBe(true);
    });

    it("button isOn reflects whether its state matches the command value", () => {
        setModelData(editor.model, TODO_FIXTURE);
        const activeStates = getActiveTaskStates(editor);
        const command = editor.commands.get("setTaskState");

        for (const state of activeStates) {
            const button = editor.ui.componentFactory.create(`taskState:${state.name}`) as { isOn: boolean };
            const expected = command?.value === state.name;
            expect(button.isOn).toBe(expected);
        }
    });

    it("isOn is true for the 'none' state when the cursor is on an unchecked todo item", () => {
        setModelData(editor.model, TODO_FIXTURE);
        const noneState = DEFAULT_TASK_STATES.find((s) => s.name === NONE_STATE_NAME);
        if (!noneState) {
            return;
        }
        // The default is unchecked → command value is 'none'.
        const command = editor.commands.get("setTaskState");
        expect(command?.value).toBe(NONE_STATE_NAME);
        const button = editor.ui.componentFactory.create(`taskState:${NONE_STATE_NAME}`) as { isOn: boolean };
        expect(button.isOn).toBe(true);
    });

    it("isOn is true for the 'done' state after executing setTaskState with done", () => {
        setModelData(editor.model, TODO_FIXTURE);
        editor.execute("setTaskState", { state: DONE_STATE_NAME });
        const button = editor.ui.componentFactory.create(`taskState:${DONE_STATE_NAME}`) as { isOn: boolean };
        expect(button.isOn).toBe(true);
    });

    it("executing the button fires setTaskState with the correct state", () => {
        setModelData(editor.model, TODO_FIXTURE);
        const activeStates = getActiveTaskStates(editor);
        const customState = activeStates.find((s) => s.name !== NONE_STATE_NAME && s.name !== DONE_STATE_NAME);
        if (!customState) {
            return;
        }

        const executeSpy = vi.spyOn(editor, "execute");
        const button = editor.ui.componentFactory.create(`taskState:${customState.name}`) as {
            fire(name: string): void;
        };
        button.fire("execute");

        expect(executeSpy).toHaveBeenCalledWith("setTaskState", { state: customState.name });
    });

    it("executing the button calls editor.editing.view.focus()", () => {
        setModelData(editor.model, TODO_FIXTURE);
        const activeStates = getActiveTaskStates(editor);
        const first = activeStates[0];
        if (!first) {
            return;
        }

        const focusSpy = vi.spyOn(editor.editing.view, "focus");
        const button = editor.ui.componentFactory.create(`taskState:${first.name}`) as {
            fire(name: string): void;
        };
        button.fire("execute");

        expect(focusSpy).toHaveBeenCalled();
    });

    it("each button renders a preview div with the correct data-trilium-task-state", () => {
        const activeStates = getActiveTaskStates(editor);
        const first = activeStates[0];
        if (!first) {
            return;
        }

        const button = editor.ui.componentFactory.create(`taskState:${first.name}`) as {
            render(): void;
            element: HTMLElement | null;
        };
        button.render();

        const preview = button.element?.querySelector(".tn-task-checkbox");
        expect(preview).not.toBeNull();
        expect(preview?.getAttribute("data-trilium-task-state")).toBe(first.name);
    });

    it("button label falls back to state.name when state.title is empty", async () => {
        // Build a second editor with a custom state whose title is empty.
        const stateWithNoTitle: TaskStateDef = {
            name: "custom-notitle",
            title: "",
            markdownSymbol: "!",
            isCompleted: false,
            icon: "bx bx-x"
        };
        const customStates: TaskStateDef[] = [
            ...DEFAULT_TASK_STATES,
            stateWithNoTitle
        ];

        const customEditor = await createTestEditor(
            [Essentials, Paragraph, TodoList, TodoListMultistateEditing, TodoListMultistateUI],
            { taskStates: customStates } as unknown as Parameters<typeof ClassicEditor.create>[1]
        );

        const button = customEditor.ui.componentFactory.create(`taskState:${stateWithNoTitle.name}`) as unknown as {
            label: string;
        };
        expect(button.label).toBe(stateWithNoTitle.name);
    });
});
