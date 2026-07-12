import { type TaskStateDef } from "@triliumnext/commons";
import { Tooltip } from "bootstrap";
import { _setModelData as setModelData, ClassicEditor, Essentials, keyCodes, List, Paragraph, TodoList, type ModelElement } from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import TodoListUncheckOnEnter from "../todo_list_uncheck_on_enter.js";
import TodoListMultistateEditing, { buildTooltipTitle, getActiveTaskStates, getConfiguredTaskStates, TASK_STATE_ATTRIBUTE } from "./todo_list_multistate_editing.js";

const TODO_LIST_CHECKED_ATTRIBUTE = "todoListChecked";

// A custom state set: one regular, one completed, one hidden.
const CUSTOM_STATES: TaskStateDef[] = [
    { id: "_doing", name: "doing", title: "Doing", markdownSymbol: "/", isCompleted: false, icon: "bx bx-loader" },
    { id: "_review", name: "review", title: "Review", markdownSymbol: "r", isCompleted: true, icon: "bx bx-check" },
    { id: "_hidden", name: "secret", title: "Secret", markdownSymbol: "s", isCompleted: false, icon: "bx bx-hide", isHidden: true }
];

const TODO_FIXTURE = '<paragraph listIndent="0" listItemId="t-a" listType="todo">Task[]</paragraph>';

async function createEditor(config: Record<string, unknown> = {}): Promise<ClassicEditor> {
    // TodoListUncheckOnEnter ships alongside multistate in the real build; include it so the
    // Enter-reset behavior is exercised end to end.
    return await createTestEditor([Essentials, Paragraph, List, TodoList, TodoListUncheckOnEnter, TodoListMultistateEditing], config);
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

/**
 * The visible tooltip popup Bootstrap adds to `<body>` when the manager renders
 * the top-of-stack entry, or `null` when nothing is shown. Ground-truth for
 * every "is the tooltip on screen" assertion.
 */
function livePopup(): HTMLElement | null {
    return document.body.querySelector<HTMLElement>(".tooltip");
}

/**
 * The multistate plugin's `TOOLTIP_DWELL_MS` — kept in sync with the plugin's
 * constant. Tests advance fake timers by this to bypass the dwell without
 * paying real wall-clock latency.
 */
const TOOLTIP_DWELL_MS = 200;

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

        it("Enter on a checked/custom-state row starts the new row unchecked with no state (#10084)", () => {
            // A native completed (checked) row: pressing Enter must not carry the check over.
            setModelData(editor.model,
                '<paragraph listIndent="0" listItemId="t-a" listType="todo" todoListChecked="true">Task[]</paragraph>');
            editor.execute("enter");
            const newNative = getBlock(editor, 1);
            expect(newNative.getAttribute("listType")).toBe("todo");
            expect(newNative.hasAttribute(TODO_LIST_CHECKED_ATTRIBUTE)).toBe(false);
            expect(newNative.hasAttribute(TASK_STATE_ATTRIBUTE)).toBe(false);

            // A custom completed state ('review', isCompleted: true) must not carry the state
            // or the (post-fixer-forced) checkbox over to the new row.
            setModelData(editor.model, TODO_FIXTURE);
            editor.execute("setTaskState", { state: "review" });
            editor.execute("enter");
            const newCustom = getBlock(editor, 1);
            expect(newCustom.hasAttribute(TASK_STATE_ATTRIBUTE)).toBe(false);
            expect(newCustom.hasAttribute(TODO_LIST_CHECKED_ATTRIBUTE)).toBe(false);

            // The original row keeps its state.
            expect(getBlock(editor, 0).getAttribute(TASK_STATE_ATTRIBUTE)).toBe("review");
            expect(getBlock(editor, 0).getAttribute(TODO_LIST_CHECKED_ATTRIBUTE)).toBe(true);
        });

        it("Enter outside a todo list leaves the new block untouched", () => {
            // The afterExecute reset only applies to todo blocks.
            setModelData(editor.model, "<paragraph>Hello[]</paragraph>");
            editor.execute("enter");
            expect(getBlock(editor, 1).getAttribute("listType")).toBe(undefined);
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

        it("does not spawn a Bootstrap tooltip eagerly; nothing is on screen until a handle pushes", () => {
            // The manager creates handles lazily and shows nothing until a handle
            // pushes onto the visibility stack — so a freshly-rendered editor
            // has no popup, and every checkbox reports `null` for
            // `Tooltip.getInstance` until it is hovered or the caret enters it.
            const domRoot = editor.editing.view.getDomRoot();
            const input = domRoot?.querySelector<HTMLInputElement>('.todo-list__label input[type="checkbox"]');
            expect(input).not.toBeNull();
            expect(livePopup()).toBeNull();
            if (input) {
                expect(Tooltip.getInstance(input)).toBeNull();
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

        it("downcasts a default custom state; the identity translate fallback doesn't crash the tooltip pipeline", () => {
            editor.execute("setTaskState", { state: "doing" });
            expect(editor.getData()).toContain('data-trilium-task-state="doing"');
            // No `translate` config → the identity `(key) => key` fallback feeds
            // the raw i18n keys straight into `buildTooltipTitle`. It must not
            // crash the render loop even though the assembled HTML then reads
            // like `"…{{shortcut}}…"` because the fallback echoes keys back.
            const domRoot = editor.editing.view.getDomRoot();
            const input = domRoot?.querySelector<HTMLInputElement>('.todo-list__label input[type="checkbox"]');
            expect(input).not.toBeNull();
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

        it("consults the configured translate provider for the tooltip content on each rendered checkbox", () => {
            // Render creates hover handles eagerly per checkbox; each handle's
            // initial content is assembled via `buildTooltipTitle` which calls
            // `translate("text-editor.checkbox-tooltip", { shortcut: … })`.
            // We don't need the popup on screen to verify that.
            expect(translate).toHaveBeenCalledWith("text-editor.checkbox-tooltip", expect.objectContaining({
                shortcut: expect.any(String)
            }));
        });

        it("disposes the hover handle of a checkbox that becomes disconnected and re-attaches to the fresh input", () => {
            const domRoot = editor.editing.view.getDomRoot();
            const firstInput = domRoot?.querySelector<HTMLInputElement>('.todo-list__label input[type="checkbox"]');
            expect(firstInput).not.toBeNull();

            // Toggling the native checkbox reconverts the todo item, replacing
            // the input DOM node. The render listener reaps the old handle and
            // creates one on the fresh input.
            editor.execute("setTaskState", { state: "doing" });
            editor.execute("checkTodoList");
            editor.editing.view.forceRender();

            if (firstInput) {
                expect(firstInput.isConnected).toBe(false);
            }
            // The new checkbox is present in the DOM and is a fresh node.
            const currentInput = editor.editing.view.getDomRoot()?.querySelector<HTMLInputElement>('.todo-list__label input[type="checkbox"]');
            expect(currentInput).not.toBeNull();
            expect(currentInput).not.toBe(firstInput);
            // Whether a popup is currently visible depends on where the caret
            // is (`TODO_FIXTURE` places it inside the item, so the plugin's
            // caret-driven flow can legitimately show the tooltip during the
            // rebuild) — that's orthogonal to the "old-handle-disposed" invariant
            // this test exists to verify.
        });

        it("consults the state-label translation key when a configured state is set", () => {
            translate.mockClear();
            editor.execute("setTaskState", { state: "doing" });
            expect(translate).toHaveBeenCalledWith("text-editor.checkbox-tooltip-state-label");
        });

        it("consults the unknown-state suffix translation when the state has no definition", () => {
            translate.mockClear();
            editor.model.change((writer) => {
                writer.setAttribute(TASK_STATE_ATTRIBUTE, "ghost", getBlock(editor, 0));
            });
            expect(translate).toHaveBeenCalledWith("text-editor.checkbox-tooltip-state-label");
            expect(translate).toHaveBeenCalledWith("text-editor.checkbox-tooltip-state-unknown-suffix");
        });

        it("omits the state prefix entirely for anchor states (unchecked / checked)", () => {
            // Starting fixture has no taskState → anchor. Re-render explicitly and assert
            // neither state-prefix key was consulted.
            translate.mockClear();
            editor.editing.view.forceRender();
            expect(translate).not.toHaveBeenCalledWith("text-editor.checkbox-tooltip-state-label");
            expect(translate).not.toHaveBeenCalledWith("text-editor.checkbox-tooltip-state-unknown-suffix");
        });

        it("rebuilds hover-handle content when the state changes on a rendered checkbox", () => {
            translate.mockClear();

            // A state change on the todo item triggers a reconvert of the list
            // item block (any scope-`item` attribute mutation does), which
            // gives us a new `<input>` and a new hover handle. Either way the
            // plugin must consult `translate` for the fresh content — including
            // the state-prefix keys — so a subsequent hover shows the right
            // tooltip.
            editor.execute("setTaskState", { state: "doing" });

            expect(translate).toHaveBeenCalledWith("text-editor.checkbox-tooltip", expect.objectContaining({
                shortcut: expect.any(String)
            }));
            expect(translate).toHaveBeenCalledWith("text-editor.checkbox-tooltip-state-label");
        });

        it("does not touch handle content when a render fires without any state change", () => {
            const input = editor.editing.view.getDomRoot()?.querySelector<HTMLInputElement>('.todo-list__label input[type="checkbox"]');
            expect(input).not.toBeNull();
            translate.mockClear();

            // Render fires but the tracked state on every input matches the DOM,
            // so the plugin does no work.
            editor.editing.view.forceRender();

            // No content-rebuild keys were consulted.
            expect(translate).not.toHaveBeenCalledWith("text-editor.checkbox-tooltip", expect.anything());
            expect(translate).not.toHaveBeenCalledWith("text-editor.checkbox-tooltip-state-label");
        });
    });

    describe("caret-driven tooltip visibility", () => {
        // Fixture: a plain paragraph then two todo items. The caret starts in the plain
        // paragraph so we can move it into (and between) the todos to drive the listener.
        const CARET_FIXTURE = '<paragraph>plain[]</paragraph>' +
            '<paragraph listIndent="0" listItemId="t-a" listType="todo">A</paragraph>' +
            '<paragraph listIndent="0" listItemId="t-b" listType="todo">B</paragraph>';

        function moveCaretTo(blockIndex: number): void {
            editor.model.change((writer) => {
                const block = getBlock(editor, blockIndex);
                writer.setSelection(writer.createPositionAt(block, 0));
            });
        }

        beforeEach(async () => {
            editor = await createEditor({ taskStates: CUSTOM_STATES });
            setModelData(editor.model, CARET_FIXTURE);
            // Real timers by default — the dwell-delay tests below opt into fake
            // timers explicitly so they can advance past `TOOLTIP_DWELL_MS`
            // without paying the wall-clock cost.
            vi.useFakeTimers({ shouldAdvanceTime: false });
        });

        // Switch back to real timers between tests — Bootstrap's own transitions
        // still run on real time, and leaving fake timers on can wedge cleanup.
        function endFakeTimers(): void {
            vi.runOnlyPendingTimers();
            vi.useRealTimers();
        }

        it("shows a tooltip on the correct source element after the dwell delay when the caret enters a todo <li>", () => {
            expect(livePopup()).toBeNull();

            moveCaretTo(1); // caret in todo A → schedules a delayed show
            expect(livePopup()).toBeNull(); // still deferred

            vi.advanceTimersByTime(TOOLTIP_DWELL_MS);
            expect(livePopup()).not.toBeNull();

            // The tooltip belongs to the caret's todo item — its aria link points
            // back at the corresponding checkbox.
            const source = document.querySelector<HTMLElement>(`[aria-describedby="${livePopup()?.id}"]`);
            const targetLi = source?.closest("li");
            expect(targetLi?.getAttribute("data-list-item-id")).toBe("t-a");

            endFakeTimers();
        });

        it("hides the visible tooltip when the caret leaves any todo item", () => {
            moveCaretTo(1);
            vi.advanceTimersByTime(TOOLTIP_DWELL_MS);
            expect(livePopup()).not.toBeNull();

            moveCaretTo(0); // back to the plain paragraph — the caret handle disposes
            expect(livePopup()).toBeNull();

            endFakeTimers();
        });

        it("switches the visible tooltip's source element when the caret moves between two todo items", () => {
            moveCaretTo(1);
            vi.advanceTimersByTime(TOOLTIP_DWELL_MS);
            const firstSourceLi = document.querySelector<HTMLElement>(
                `[aria-describedby="${livePopup()?.id}"]`
            )?.closest("li");
            expect(firstSourceLi?.getAttribute("data-list-item-id")).toBe("t-a");

            moveCaretTo(2); // enter B — the caret handle rebinds to the new checkbox
            vi.advanceTimersByTime(TOOLTIP_DWELL_MS);
            const secondSourceLi = document.querySelector<HTMLElement>(
                `[aria-describedby="${livePopup()?.id}"]`
            )?.closest("li");
            expect(secondSourceLi?.getAttribute("data-list-item-id")).toBe("t-b");

            endFakeTimers();
        });

        it("does not disturb the popup when the caret moves within the same todo item", () => {
            moveCaretTo(1);
            vi.advanceTimersByTime(TOOLTIP_DWELL_MS);
            const before = livePopup();
            expect(before).not.toBeNull();

            // Move the caret to a different position WITHIN the same todo item.
            editor.model.change((writer) => {
                writer.setSelection(writer.createPositionAt(getBlock(editor, 1), 1));
            });

            // Same DOM popup element — no dispose/re-create dance.
            expect(livePopup()).toBe(before);

            endFakeTimers();
        });

        it("re-shows the tooltip immediately after a state change on the caret's item (no second dwell)", () => {
            moveCaretTo(1); // caret in todo A
            vi.advanceTimersByTime(TOOLTIP_DWELL_MS);
            expect(livePopup()).not.toBeNull();

            // 'doing' has isCompleted=false → the checkbox input stays the same
            // DOM element. The plugin detects the state change on the caret's
            // item and calls `handle.show()` (not showAfter), so the popup
            // stays visible without any additional dwell wait.
            editor.execute("setTaskState", { state: "doing" });
            expect(livePopup()).not.toBeNull();

            endFakeTimers();
        });

        it("recovers cleanly when the checkbox under the caret is replaced by a reconvert", () => {
            moveCaretTo(1);
            vi.advanceTimersByTime(TOOLTIP_DWELL_MS);
            const domRoot = editor.editing.view.getDomRoot();
            const oldInput = domRoot?.querySelector<HTMLInputElement>('.todo-list__label input[type="checkbox"]');

            // Toggling the native checkbox reconverts the todo item — the DOM
            // input is replaced. The plugin reaps the old hover handle and
            // re-attaches its caret handle to the new input.
            editor.execute("checkTodoList");
            editor.editing.view.forceRender();

            expect(oldInput?.isConnected).toBe(false);
            // Moving the caret out must not throw despite the stale reference.
            expect(() => moveCaretTo(0)).not.toThrow();

            endFakeTimers();
        });

        it("keeps no tooltip visible when the caret has no todo ancestor", () => {
            moveCaretTo(1);
            vi.advanceTimersByTime(TOOLTIP_DWELL_MS);
            expect(livePopup()).not.toBeNull();

            moveCaretTo(0); // plain paragraph → no todo ancestor → hide
            expect(livePopup()).toBeNull();

            endFakeTimers();
        });

        it("bails out safely when the position has no parent (defensive branch)", () => {
            const selection = editor.model.document.selection;
            const spy = vi.spyOn(selection, "getFirstPosition")
                .mockReturnValueOnce(null as unknown as ReturnType<typeof selection.getFirstPosition>);
            // Nudge the selection so `change:range` fires with the mocked getFirstPosition.
            editor.model.change((writer) => {
                writer.setSelection(writer.createPositionAt(getBlock(editor, 0), 0));
            });
            spy.mockRestore();
        });

        it("nulls the caret-shown reference on destroy", async () => {
            moveCaretTo(1);
            // No throw expected — destroy must clear internal state cleanly whether
            // or not a caret-shown tooltip is currently tracked.
            await editor.destroy();
            expect(editor.state).toBe("destroyed");
            // Recreate so the shared afterEach's destroy() does not double-destroy.
            editor = await createEditor({ taskStates: CUSTOM_STATES });
        });
    });

    describe("hover-driven tooltip visibility", () => {
        // Two todos so we can hover one while the caret sits in a plain
        // paragraph — the caret and hover flows must be independently
        // exercised, since the `ownedByCaret` check yields different results
        // in each case.
        const HOVER_FIXTURE = '<paragraph>plain[]</paragraph>' +
            '<paragraph listIndent="0" listItemId="t-a" listType="todo">A</paragraph>' +
            '<paragraph listIndent="0" listItemId="t-b" listType="todo">B</paragraph>';

        function moveCaretTo(blockIndex: number): void {
            editor.model.change((writer) => {
                const block = getBlock(editor, blockIndex);
                writer.setSelection(writer.createPositionAt(block, 0));
            });
        }

        function checkboxOfItem(itemId: string): HTMLInputElement {
            const domRoot = editor.editing.view.getDomRoot();
            const input = domRoot?.querySelector<HTMLInputElement>(
                `li[data-list-item-id="${itemId}"] .todo-list__label input[type="checkbox"]`
            );
            if (!input) {
                throw new Error(`No checkbox for item ${itemId}.`);
            }
            return input;
        }

        beforeEach(async () => {
            editor = await createEditor({ taskStates: CUSTOM_STATES });
            setModelData(editor.model, HOVER_FIXTURE);
            vi.useFakeTimers({ shouldAdvanceTime: false });
        });

        function endFakeTimers(): void {
            vi.runOnlyPendingTimers();
            vi.useRealTimers();
        }

        it("mouseenter on a checkbox not owned by the caret schedules a delayed show; mouseleave cancels it", () => {
            // Caret in the plain paragraph — no todo owns the caret, so the
            // hover flow is fully in charge of the hovered checkbox's tooltip.
            moveCaretTo(0);
            const inputA = checkboxOfItem("t-a");
            expect(livePopup()).toBeNull();

            inputA.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
            expect(livePopup()).toBeNull(); // dwell not yet elapsed

            vi.advanceTimersByTime(TOOLTIP_DWELL_MS);
            expect(livePopup()).not.toBeNull();
            const source = document.querySelector<HTMLElement>(
                `[aria-describedby="${livePopup()?.id}"]`
            );
            expect(source?.closest("li")?.getAttribute("data-list-item-id")).toBe("t-a");

            // Leaving the checkbox pops the hover handle → stack empties → popup gone.
            inputA.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
            expect(livePopup()).toBeNull();

            endFakeTimers();
        });

        it("mouseenter is a no-op when the caret is inside the hovered checkbox's item", () => {
            // Caret is inside todo A → the caret handle already owns A's
            // tooltip visibility. Hovering the same checkbox must not run the
            // dwell-and-push cycle (the manager would flicker if it did).
            moveCaretTo(1);
            vi.advanceTimersByTime(TOOLTIP_DWELL_MS);
            const beforeHover = livePopup();
            expect(beforeHover).not.toBeNull(); // caret drove this popup

            const inputA = checkboxOfItem("t-a");
            inputA.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
            // Advance well past the dwell — no NEW render, and no manager churn.
            vi.advanceTimersByTime(TOOLTIP_DWELL_MS * 2);
            // Same popup element — the caret handle's tooltip was never disturbed.
            expect(livePopup()).toBe(beforeHover);

            endFakeTimers();
        });

        it("mouseleave is a no-op when the caret is inside the hovered checkbox's item", () => {
            // The caret owns A's popup. Even if a mouseleave arrives (mouse
            // sweeping across the checkbox during selection), the hover branch
            // must not tear the popup down — the caret handle still wants it.
            moveCaretTo(1);
            vi.advanceTimersByTime(TOOLTIP_DWELL_MS);
            const beforeLeave = livePopup();
            expect(beforeLeave).not.toBeNull();

            const inputA = checkboxOfItem("t-a");
            inputA.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
            expect(livePopup()).toBe(beforeLeave);

            endFakeTimers();
        });
    });

    // Pure-function tests for the tooltip HTML builder. Assert against the
    // returned string directly rather than introspecting Bootstrap Tooltip
    // instances — no `_config` peeking, no editor scaffolding needed.
    describe("buildTooltipTitle", () => {
        const translate = (key: string, params: Record<string, unknown> = {}) => {
            if (key === "text-editor.checkbox-tooltip") {
                return `Right click for more task states.\nPress ${params.shortcut} to cycle between states.`;
            }
            if (key === "text-editor.checkbox-tooltip-state-label") {
                return "Task state:";
            }
            if (key === "text-editor.checkbox-tooltip-state-unknown-suffix") {
                return "(missing definition)";
            }
            return key;
        };

        it("returns just the body (with <br>-joined lines) for an anchor state (null)", () => {
            const title = buildTooltipTitle(document, null, new Map(), translate);
            expect(title).toContain("Right click for more task states.<br>Press");
            expect(title).not.toContain("Task state:");
        });

        it("prepends the state prefix with a bold state title for a configured state", () => {
            const stateByName = new Map(CUSTOM_STATES.map((state) => [state.name, state]));
            const title = buildTooltipTitle(document, "doing", stateByName, translate);
            expect(title).toContain("Task state:");
            expect(title).toContain("<strong>Doing</strong>"); // state.title takes precedence over name
            expect(title).toContain('data-trilium-task-state="doing"');
            expect(title).toContain('class="tn-task-tooltip-state"');
        });

        it("falls back to state.name in the state prefix when the state's title is empty", () => {
            const stateByName = new Map<string, TaskStateDef>([
                ["bare", { id: "_bare", name: "bare", title: "", markdownSymbol: "b", isCompleted: false, icon: "bx bx-x" }]
            ]);
            const title = buildTooltipTitle(document, "bare", stateByName, translate);
            expect(title).toContain("<strong>bare</strong>");
        });

        it("uses the unknown-state suffix for a state with no definition, without bold or icon", () => {
            const title = buildTooltipTitle(document, "ghost", new Map(), translate);
            expect(title).toContain("Task state:");
            expect(title).toContain("ghost (missing definition)");
            expect(title).not.toContain("<strong>");
            expect(title).not.toContain('data-trilium-task-state="ghost"');
        });

        it("text-escapes the raw state name in the unknown-state suffix (no HTML injection)", () => {
            const title = buildTooltipTitle(document, "<script>alert(1)</script>", new Map(), translate);
            expect(title).not.toContain("<script>");
            expect(title).toContain("&lt;script&gt;");
        });
    });
});
