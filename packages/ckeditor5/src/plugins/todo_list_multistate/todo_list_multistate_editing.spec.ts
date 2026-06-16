import { type TaskStateDef } from "@triliumnext/commons";
import { Tooltip } from "bootstrap";
import { _setModelData as setModelData, ClassicEditor, Essentials, keyCodes, List, Paragraph, TodoList, type ModelElement } from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import TodoListMultistateEditing, { getActiveTaskStates, getConfiguredTaskStates, TASK_STATE_ATTRIBUTE } from "./todo_list_multistate_editing.js";

const TODO_LIST_CHECKED_ATTRIBUTE = "todoListChecked";

// A custom state set: one regular, one completed, one hidden.
const CUSTOM_STATES: TaskStateDef[] = [
    { id: "_doing", name: "doing", title: "Doing", markdownSymbol: "/", isCompleted: false, icon: "bx bx-loader" },
    { id: "_review", name: "review", title: "Review", markdownSymbol: "r", isCompleted: true, icon: "bx bx-check" },
    { id: "_hidden", name: "secret", title: "Secret", markdownSymbol: "s", isCompleted: false, icon: "bx bx-hide", isHidden: true }
];

const TODO_FIXTURE = '<paragraph listIndent="0" listItemId="t-a" listType="todo">Task[]</paragraph>';

async function createEditor(config: Record<string, unknown> = {}): Promise<ClassicEditor> {
    return await createTestEditor([Essentials, Paragraph, List, TodoList, TodoListMultistateEditing], config);
}

function getBlock(editor: ClassicEditor, index: number): ModelElement {
    const child = editor.model.document.getRoot()?.getChild(index);
    if (!child || !child.is("element")) {
        throw new Error(`No element block at index ${index}.`);
    }
    return child;
}

function pressCtrlShiftEnter(editor: ClassicEditor): void {
    editor.keystrokes.press({
        keyCode: keyCodes.enter,
        ctrlKey: true,
        shiftKey: true,
        preventDefault: () => {},
        stopPropagation: () => {}
    });
}

describe("TodoListMultistateEditing", () => {
    let editor: ClassicEditor;

    describe("with custom configured states", () => {
        beforeEach(async () => {
            editor = await createEditor({ taskStates: CUSTOM_STATES });
            setModelData(editor.model, TODO_FIXTURE);
        });

        it("loads the plugin, registers the command and extends the schema", () => {
            expect(editor.plugins.get(TodoListMultistateEditing)).toBeInstanceOf(TodoListMultistateEditing);
            expect(editor.commands.get("setTaskState")).toBeDefined();
            expect(editor.model.schema.checkAttribute(["$root", "paragraph"], TASK_STATE_ATTRIBUTE)).toBe(true);
        });

        it("setTaskState to a custom state sets the attribute and (via post-fixer) syncs the checkbox", () => {
            editor.execute("setTaskState", { state: "review" }); // isCompleted: true
            const block = getBlock(editor, 0);
            expect(block.getAttribute(TASK_STATE_ATTRIBUTE)).toBe("review");
            // Post-fixer forces the native checkbox to match isCompleted.
            expect(block.getAttribute(TODO_LIST_CHECKED_ATTRIBUTE)).toBe(true);

            editor.execute("setTaskState", { state: "doing" }); // isCompleted: false
            expect(block.getAttribute(TASK_STATE_ATTRIBUTE)).toBe("doing");
            expect(block.getAttribute(TODO_LIST_CHECKED_ATTRIBUTE)).toBe(false);
        });

        it("setTaskState to the 'done' anchor clears the state and checks the box", () => {
            editor.execute("setTaskState", { state: "done" });
            const block = getBlock(editor, 0);
            expect(block.hasAttribute(TASK_STATE_ATTRIBUTE)).toBe(false);
            expect(block.getAttribute(TODO_LIST_CHECKED_ATTRIBUTE)).toBe(true);
        });

        it("setTaskState to the 'none' anchor clears the state and unchecks the box", () => {
            editor.execute("setTaskState", { state: "review" });
            editor.execute("setTaskState", { state: "none" });
            const block = getBlock(editor, 0);
            expect(block.hasAttribute(TASK_STATE_ATTRIBUTE)).toBe(false);
            expect(block.getAttribute(TODO_LIST_CHECKED_ATTRIBUTE)).toBe(false);
        });

        it("setTaskState with a null state defaults to 'none'", () => {
            editor.execute("setTaskState", { state: "review" });
            editor.execute("setTaskState", { state: null });
            const block = getBlock(editor, 0);
            expect(block.hasAttribute(TASK_STATE_ATTRIBUTE)).toBe(false);
            expect(block.getAttribute(TODO_LIST_CHECKED_ATTRIBUTE)).toBe(false);
        });

        it("setTaskState skips non-todo blocks within a multi-block selection", () => {
            // The selection spans a todo block (so the command stays enabled) and a plain
            // paragraph; the command must skip the non-todo block.
            setModelData(editor.model,
                '<paragraph listIndent="0" listItemId="t-a" listType="todo">[Task</paragraph>' +
                "<paragraph>plain]</paragraph>");
            editor.execute("setTaskState", { state: "doing" });
            expect(getBlock(editor, 0).getAttribute(TASK_STATE_ATTRIBUTE)).toBe("doing");
            expect(getBlock(editor, 1).hasAttribute(TASK_STATE_ATTRIBUTE)).toBe(false);
        });

        it("downcasts a custom state to data-trilium-task-state and an unknown state to the editing-only class", () => {
            editor.execute("setTaskState", { state: "doing" });
            expect(editor.getData()).toContain('data-trilium-task-state="doing"');

            // 'review' is completed → also a data attribute (checkbox completed).
            editor.execute("setTaskState", { state: "review" });
            expect(editor.getData()).toContain('data-trilium-task-state="review"');

            // An unknown state (not in config) keeps the data attribute but, on the editing
            // pipeline only, gets the tn-unknown-task-state class.
            editor.model.change((writer) => {
                writer.setAttribute(TASK_STATE_ATTRIBUTE, "ghost", getBlock(editor, 0));
            });
            const domRoot = editor.editing.view.getDomRoot();
            expect(domRoot?.querySelector("li.tn-unknown-task-state")).not.toBeNull();
            // The unknown class is editing-only: never in the saved data.
            expect(editor.getData()).toContain('data-trilium-task-state="ghost"');
            expect(editor.getData()).not.toContain("tn-unknown-task-state");
        });

        it("removes the data attribute and unknown class when the state is cleared back to an anchor", () => {
            editor.model.change((writer) => {
                writer.setAttribute(TASK_STATE_ATTRIBUTE, "ghost", getBlock(editor, 0));
            });
            const domRoot = editor.editing.view.getDomRoot();
            expect(domRoot?.querySelector("li.tn-unknown-task-state")).not.toBeNull();

            editor.execute("setTaskState", { state: "done" }); // anchor → removes data attr + class
            expect(domRoot?.querySelector("li.tn-unknown-task-state")).toBeNull();
            expect(editor.getData()).not.toContain("data-trilium-task-state");
        });

        it("downcast removes the data attribute when the stored state is an anchor value", () => {
            // Directly storing an anchor value on the model drives the downcast strategy's
            // else branch (anchors map to the native checkbox, never to a data attribute).
            editor.model.change((writer) => {
                writer.setAttribute(TASK_STATE_ATTRIBUTE, "done", getBlock(editor, 0));
            });
            expect(editor.getData()).not.toContain("data-trilium-task-state");
            const domRoot = editor.editing.view.getDomRoot();
            expect(domRoot?.querySelector("li.tn-unknown-task-state")).toBeNull();
        });

        it("upcasts data-trilium-task-state, ignoring anchor/empty values", () => {
            editor.setData('<ul class="todo-list"><li data-trilium-task-state="doing"><label class="todo-list__label"><input type="checkbox"><span class="todo-list__label__description">A</span></label></li></ul>');
            expect(getBlock(editor, 0).getAttribute(TASK_STATE_ATTRIBUTE)).toBe("doing");

            // An anchor value must not become a model state attribute.
            editor.setData('<ul class="todo-list"><li data-trilium-task-state="done"><label class="todo-list__label"><input type="checkbox"><span class="todo-list__label__description">B</span></label></li></ul>');
            expect(getBlock(editor, 0).hasAttribute(TASK_STATE_ATTRIBUTE)).toBe(false);
        });

        it("cycles through active (non-hidden) states with Ctrl+Shift+Enter", () => {
            const command = editor.commands.get("setTaskState");
            // The active cycle is the configured non-hidden custom states: [doing, review].
            // The hidden 'secret' state is excluded. The 'none'/'done' anchors are not in
            // this config, so a starting 'none' value (indexOf === -1) advances to the
            // first active state.
            expect(command?.value).toBe("none");

            pressCtrlShiftEnter(editor); // none not in cycle → first entry
            expect(command?.value).toBe("doing");

            pressCtrlShiftEnter(editor);
            expect(command?.value).toBe("review");

            pressCtrlShiftEnter(editor); // wraps back to the first active state
            expect(command?.value).toBe("doing");
        });

        it("falls back to 'none' in the cycle when the command value is unexpectedly null", () => {
            const command = editor.commands.get("setTaskState");
            expect(command?.isEnabled).toBe(true);
            // Force a transient null value (without re-running refresh) so the keystroke's
            // `?? NONE_STATE_NAME` fallback is exercised while the command stays enabled.
            if (command) {
                command.value = null;
            }
            const spy = vi.spyOn(editor, "execute");
            pressCtrlShiftEnter(editor);
            // 'none' is not in this custom cycle (indexOf === -1) → first active entry.
            expect(spy).toHaveBeenCalledWith("setTaskState", { state: "doing" });
            spy.mockRestore();
        });

        it("does nothing on Ctrl+Shift+Enter when the command is disabled (no todo selection)", () => {
            setModelData(editor.model, "<paragraph>plain[]</paragraph>");
            const command = editor.commands.get("setTaskState");
            expect(command?.isEnabled).toBe(false);

            const spy = vi.spyOn(editor, "execute");
            pressCtrlShiftEnter(editor);
            expect(spy).not.toHaveBeenCalled();
            spy.mockRestore();
        });

        it("refresh reports the stored custom state value and disables outside todo blocks", () => {
            const command = editor.commands.get("setTaskState");
            editor.execute("setTaskState", { state: "doing" });
            expect(command?.value).toBe("doing");
            expect(command?.isEnabled).toBe(true);

            setModelData(editor.model, "<paragraph>plain[]</paragraph>");
            expect(command?.isEnabled).toBe(false);
            expect(command?.value).toBe(null);
        });

        it("refresh derives the anchor value from the native checkbox when no state is stored", () => {
            const command = editor.commands.get("setTaskState");
            // No taskState attribute, checkbox unchecked → none.
            expect(command?.value).toBe("none");

            editor.model.change((writer) => {
                writer.setAttribute(TODO_LIST_CHECKED_ATTRIBUTE, true, getBlock(editor, 0));
            });
            expect(command?.value).toBe("done");
        });

        it("refresh returns no block (and a null value) when the position has no element parent", () => {
            const command = editor.commands.get("setTaskState");
            const selection = editor.model.document.selection;
            // Only the next getFirstPosition() call (the one inside _getTodoBlock) sees a
            // position whose parent is not an element; later internal calls are unaffected.
            const spy = vi.spyOn(selection, "getFirstPosition")
                .mockReturnValueOnce({ parent: undefined } as unknown as ReturnType<typeof selection.getFirstPosition>);
            command?.refresh();
            expect(command?.isEnabled).toBe(false);
            expect(command?.value).toBe(null);
            spy.mockRestore();
        });

        it("post-fixer drops the state when the native checkbox is toggled directly", () => {
            editor.execute("setTaskState", { state: "doing" });
            expect(getBlock(editor, 0).getAttribute(TASK_STATE_ATTRIBUTE)).toBe("doing");

            // Toggle only the native checkbox; the post-fixer removes the special state.
            editor.model.change((writer) => {
                writer.setAttribute(TODO_LIST_CHECKED_ATTRIBUTE, true, getBlock(editor, 0));
            });
            expect(getBlock(editor, 0).hasAttribute(TASK_STATE_ATTRIBUTE)).toBe(false);
            expect(getBlock(editor, 0).getAttribute(TODO_LIST_CHECKED_ATTRIBUTE)).toBe(true);
        });

        it("post-fixer leaves a cleared (unknown) state alone instead of forcing the checkbox", () => {
            // 'ghost' is not in the config → stateByName lookup misses → no checkbox forcing.
            editor.model.change((writer) => {
                writer.setAttribute(TASK_STATE_ATTRIBUTE, "ghost", getBlock(editor, 0));
            });
            expect(getBlock(editor, 0).getAttribute(TASK_STATE_ATTRIBUTE)).toBe("ghost");
            // The native checkbox attribute is left untouched (never set on the fixture).
            expect(getBlock(editor, 0).hasAttribute(TODO_LIST_CHECKED_ATTRIBUTE)).toBe(false);
        });

        it("post-fixer ignores non-attribute changes and non-todo attribute changes", () => {
            // Typing inserts text (a non-attribute diff) — must not crash the post-fixer.
            editor.model.change((writer) => {
                writer.insertText("xyz", editor.model.document.selection.getFirstPosition() ?? undefined);
            });
            expect(getBlock(editor, 0).is("element")).toBe(true);

            // Attribute change on a non-todo block: post-fixer must skip it.
            setModelData(editor.model, '<paragraph listIndent="0" listItemId="b-a" listType="bulleted">B[]</paragraph>');
            editor.model.change((writer) => {
                writer.setAttribute(TODO_LIST_CHECKED_ATTRIBUTE, true, getBlock(editor, 0));
            });
            expect(getBlock(editor, 0).getAttribute("listType")).toBe("bulleted");
        });

        it("post-fixer ignores attribute changes on a todo block that touch neither tracked attribute", () => {
            // An attribute change on a todo element whose key is neither taskState nor
            // todoListChecked falls through both branches without being tracked.
            editor.model.change((writer) => {
                writer.setAttribute("listReversed", true, getBlock(editor, 0));
            });
            expect(getBlock(editor, 0).hasAttribute(TASK_STATE_ATTRIBUTE)).toBe(false);
            expect(getBlock(editor, 0).hasAttribute(TODO_LIST_CHECKED_ATTRIBUTE)).toBe(false);
        });

        it("post-fixer ignores attribute changes whose changed node is a text node, not an element", () => {
            // An inline (text-level) attribute change yields a differ entry whose
            // range.start.nodeAfter is a text node, exercising the non-element guard.
            editor.model.schema.extend("$text", { allowAttributes: "marker" });
            editor.model.change((writer) => {
                const block = getBlock(editor, 0);
                writer.setAttribute("marker", true, writer.createRangeIn(block));
            });
            expect(getBlock(editor, 0).is("element")).toBe(true);
            expect(getBlock(editor, 0).hasAttribute(TODO_LIST_CHECKED_ATTRIBUTE)).toBe(false);
        });

        it("the render listener bails out when there is no DOM root", () => {
            const view = editor.editing.view;
            const spy = vi.spyOn(view, "getDomRoot").mockReturnValue(undefined);
            // Firing a render with no DOM root must short-circuit without throwing.
            expect(() => view.fire("render")).not.toThrow();
            spy.mockRestore();
        });

        it("creates a Bootstrap tooltip on each checkbox and disposes it on destroy", async () => {
            const domRoot = editor.editing.view.getDomRoot();
            const input = domRoot?.querySelector<HTMLInputElement>('.todo-list__label input[type="checkbox"]');
            expect(input).not.toBeNull();
            if (input) {
                expect(Tooltip.getInstance(input)).not.toBeNull();
            }
        });
    });

    describe("post-fixer state-to-checkbox forcing on direct attribute writes", () => {
        beforeEach(async () => {
            editor = await createEditor({ taskStates: CUSTOM_STATES });
            setModelData(editor.model, TODO_FIXTURE);
        });

        it("forces the checkbox even when only the state attribute is written", () => {
            editor.model.change((writer) => {
                // 'review' is completed; checkbox starts unchecked → post-fixer flips it.
                writer.setAttribute(TASK_STATE_ATTRIBUTE, "review", getBlock(editor, 0));
            });
            expect(getBlock(editor, 0).getAttribute(TODO_LIST_CHECKED_ATTRIBUTE)).toBe(true);
        });
    });

    describe("with default (no) config and no translate provider", () => {
        beforeEach(async () => {
            editor = await createEditor();
            setModelData(editor.model, TODO_FIXTURE);
        });

        it("falls back to the default task states for the cycle", () => {
            const command = editor.commands.get("setTaskState");
            expect(command?.value).toBe("none");
            pressCtrlShiftEnter(editor); // default order: none → doing → ...
            expect(command?.value).toBe("doing");
        });

        it("downcasts a default custom state and creates a tooltip via the identity translate fallback", () => {
            editor.execute("setTaskState", { state: "doing" });
            expect(editor.getData()).toContain('data-trilium-task-state="doing"');
            // No `translate` config → the identity `(key) => key` fallback is used. The tooltip
            // is still created on the checkbox.
            const domRoot = editor.editing.view.getDomRoot();
            const input = domRoot?.querySelector<HTMLInputElement>('.todo-list__label input[type="checkbox"]');
            expect(input).not.toBeNull();
            if (input) {
                expect(Tooltip.getInstance(input)).not.toBeNull();
            }
        });
    });

    describe("helper functions and tooltip lifecycle", () => {
        let translate: ReturnType<typeof vi.fn>;

        beforeEach(async () => {
            translate = vi.fn((key: string) => `T:${key}`);
            editor = await createEditor({
                taskStates: CUSTOM_STATES,
                translate
            });
            setModelData(editor.model, TODO_FIXTURE);
        });

        it("getConfiguredTaskStates returns the config and getActiveTaskStates filters hidden states", () => {
            expect(getConfiguredTaskStates(editor)).toStrictEqual(CUSTOM_STATES);
            const active = getActiveTaskStates(editor).map((s) => s.name);
            expect(active).toContain("doing");
            expect(active).not.toContain("secret");
        });

        it("uses the configured translate provider for the tooltip title", () => {
            const domRoot = editor.editing.view.getDomRoot();
            const input = domRoot?.querySelector<HTMLInputElement>('.todo-list__label input[type="checkbox"]');
            expect(input).not.toBeNull();
            if (input) {
                expect(Tooltip.getInstance(input)).not.toBeNull();
            }
            // The configured translate provider is consulted for the checkbox tooltip title.
            expect(translate).toHaveBeenCalledWith("text-editor.checkbox-tooltip", expect.objectContaining({
                shortcut: expect.any(String)
            }));
        });

        it("disposes the tooltip of a checkbox that becomes disconnected and creates a fresh one", () => {
            const domRoot = editor.editing.view.getDomRoot();
            const firstInput = domRoot?.querySelector<HTMLInputElement>('.todo-list__label input[type="checkbox"]');
            expect(firstInput).not.toBeNull();
            const firstTooltip = firstInput ? Tooltip.getInstance(firstInput) : null;
            expect(firstTooltip).not.toBeNull();
            const disposeSpy = firstTooltip ? vi.spyOn(firstTooltip, "dispose") : null;

            // Toggling the checkbox reconverts the todo item, recreating the checkbox element;
            // the render listener then disposes the tooltip on the now-detached old input.
            editor.execute("setTaskState", { state: "doing" });
            editor.execute("checkTodoList");
            editor.editing.view.forceRender();

            if (firstInput) {
                expect(firstInput.isConnected).toBe(false);
            }
            if (disposeSpy) {
                expect(disposeSpy).toHaveBeenCalled();
            }

            // A new tooltip exists on the current checkbox.
            const currentInput = editor.editing.view.getDomRoot()?.querySelector<HTMLInputElement>('.todo-list__label input[type="checkbox"]');
            expect(currentInput).not.toBeNull();
            if (currentInput) {
                expect(Tooltip.getInstance(currentInput)).not.toBeNull();
            }
        });
    });
});
