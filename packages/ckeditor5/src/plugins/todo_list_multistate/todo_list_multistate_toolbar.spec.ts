import {
    ClassicEditor,
    ContextualBalloon,
    Essentials,
    List,
    Paragraph,
    _setModelData as setModelData,
    type ModelElement,
    type ViewElement
} from "ckeditor5";
import { describe, expect, it, vi } from "vitest";

import { createTestEditor, getEditorElement } from "../../../test/editor-kit.js";
import TodoListMultistateToolbar from "./todo_list_multistate_toolbar.js";
import TodoListMultistateUI from "./todo_list_multistate_ui.js";

const TODO_FIXTURE =
    '<paragraph listIndent="0" listItemId="todo-a" listType="todo">First[]</paragraph>' +
    '<paragraph listIndent="0" listItemId="todo-b" listType="todo">Second</paragraph>';

describe("TodoListMultistateToolbar", () => {
    let editor: ClassicEditor;

    async function createEditor(config: Record<string, unknown> = {}) {
        editor = await createTestEditor(
            [Essentials, Paragraph, List, TodoListMultistateUI, TodoListMultistateToolbar],
            config
        );
        setModelData(editor.model, TODO_FIXTURE);
        // Make the editor visible & away from the viewport edge so positioning/DOM lookups work.
        const editorElement = getEditorElement(editor);
        editorElement.style.marginLeft = "120px";
        editorElement.style.marginTop = "60px";
        return editor;
    }

    function getCheckbox(index = 0): HTMLInputElement {
        const domRoot = editor.editing.view.getDomRoot();
        const inputs = domRoot ? Array.from(domRoot.querySelectorAll<HTMLInputElement>(".todo-list__label input[type=\"checkbox\"]")) : [];
        const input = inputs.at(index);
        if (!input) {
            throw new Error(`No checkbox at index ${index}.`);
        }
        return input;
    }

    function rightClick(el: Element): void {
        el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    }

    function getPlugin(): TodoListMultistateToolbar {
        return editor.plugins.get(TodoListMultistateToolbar);
    }

    function getBalloon(): ContextualBalloon {
        return editor.plugins.get(ContextualBalloon);
    }

    function getBlock(index: number): ModelElement {
        const child = editor.model.document.getRoot()?.getChild(index);
        if (!child || !child.is("element")) {
            throw new Error(`No element block at index ${index}.`);
        }
        return child;
    }

    it("registers the plugin and the state toolbar buttons", async () => {
        await createEditor();
        expect(editor.plugins.get(TodoListMultistateToolbar)).toBeInstanceOf(TodoListMultistateToolbar);
        // The default custom states are surfaced as toolbar buttons.
        expect(editor.ui.componentFactory.has("taskState:doing")).toBe(true);
        expect(editor.ui.componentFactory.has("taskState:maybe")).toBe(true);
        expect(editor.ui.componentFactory.has("taskState:cancelled")).toBe(true);
    });

    it("shows the balloon when a todo checkbox is right-clicked", async () => {
        await createEditor();
        const balloon = getBalloon();
        expect(balloon.visibleView).toBeNull();

        rightClick(getCheckbox(0));

        expect(balloon.visibleView).not.toBeNull();
        // The toolbar carries the active state buttons plus a separator and the edit button.
        const toolbarRoot = balloon.view.element?.querySelector(".task-state-toolbar");
        expect(toolbarRoot).not.toBeNull();
        expect(balloon.view.element?.querySelector(".ck-task-state-edit")).not.toBeNull();
        expect(balloon.view.element?.querySelectorAll(".ck-task-state-button").length).toBeGreaterThan(0);
    });

    it("moves the selection into the clicked todo item and records its id", async () => {
        await createEditor();
        rightClick(getCheckbox(1));

        const selectionParent = editor.model.document.selection.getFirstPosition()?.parent;
        expect((selectionParent as ModelElement | undefined)?.getAttribute("listItemId")).toBe("todo-b");
    });

    it("updates the balloon position when re-shown for another checkbox", async () => {
        await createEditor();
        const balloon = getBalloon();
        const updateSpy = vi.spyOn(balloon, "updatePosition");
        const addSpy = vi.spyOn(balloon, "add");

        rightClick(getCheckbox(0));
        expect(addSpy).toHaveBeenCalledTimes(1);

        rightClick(getCheckbox(1));
        // Already visible -> the balloon is repositioned rather than re-added.
        expect(updateSpy).toHaveBeenCalled();
        expect(addSpy).toHaveBeenCalledTimes(1);
    });

    it("does not open the balloon when right-clicking outside a todo checkbox", async () => {
        await createEditor();
        const balloon = getBalloon();
        const domRoot = editor.editing.view.getDomRoot();
        const paragraphText = domRoot?.querySelector("p, li");
        expect(paragraphText).toBeTruthy();
        if (paragraphText) {
            rightClick(paragraphText);
        }
        expect(balloon.visibleView).toBeNull();
    });

    it("hides the balloon when the selection moves to a different todo item", async () => {
        await createEditor();
        const balloon = getBalloon();
        rightClick(getCheckbox(0));
        expect(balloon.visibleView).not.toBeNull();

        // Move the model selection into the *other* todo item.
        editor.model.change((writer) => {
            writer.setSelection(writer.createPositionAt(getBlock(1), 0));
        });

        expect(balloon.visibleView).toBeNull();
    });

    it("keeps the balloon open when the selection stays within the same todo item", async () => {
        await createEditor();
        const balloon = getBalloon();
        rightClick(getCheckbox(0));
        expect(balloon.visibleView).not.toBeNull();

        // Re-set the selection at a different offset inside the *same* block.
        editor.model.change((writer) => {
            writer.setSelection(writer.createPositionAt(getBlock(0), "end"));
        });

        expect(balloon.visibleView).not.toBeNull();
    });

    it("ignores selection changes while the balloon is hidden", async () => {
        await createEditor();
        const balloon = getBalloon();
        const hideSpy = vi.spyOn(balloon, "remove");
        editor.model.change((writer) => {
            writer.setSelection(writer.createPositionAt(getBlock(1), 0));
        });
        expect(balloon.visibleView).toBeNull();
        expect(hideSpy).not.toHaveBeenCalled();
    });

    it("hides the balloon when the selection lands outside any list element", async () => {
        await createEditor();
        // Add a plain paragraph after the todo items.
        setModelData(editor.model,
            '<paragraph listIndent="0" listItemId="todo-a" listType="todo">First[]</paragraph>' +
            "<paragraph>Outside</paragraph>");
        const balloon = getBalloon();
        rightClick(getCheckbox(0));
        expect(balloon.visibleView).not.toBeNull();

        editor.model.change((writer) => {
            writer.setSelection(writer.createPositionAt(getBlock(1), 0));
        });
        expect(balloon.visibleView).toBeNull();
    });

    it("invokes the edit-states callback and hides the balloon when the edit button is clicked", async () => {
        const editTaskStates = vi.fn();
        await createEditor({ editTaskStates });
        const balloon = getBalloon();
        rightClick(getCheckbox(0));
        expect(balloon.visibleView).not.toBeNull();

        const editButton = balloon.view.element?.querySelector<HTMLButtonElement>(".ck-task-state-edit");
        expect(editButton).toBeTruthy();
        editButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

        expect(editTaskStates).toHaveBeenCalledTimes(1);
        expect(balloon.visibleView).toBeNull();
    });

    it("tolerates a missing edit-states callback", async () => {
        await createEditor();
        const balloon = getBalloon();
        rightClick(getCheckbox(0));

        const editButton = balloon.view.element?.querySelector<HTMLButtonElement>(".ck-task-state-edit");
        expect(editButton).toBeTruthy();
        // No editTaskStates configured: the click must not throw, and the balloon hides.
        editButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        expect(balloon.visibleView).toBeNull();
    });

    it("uses the configured translate function for labels", async () => {
        const translate = vi.fn((key: string) => `T:${key}`);
        await createEditor({ translate });
        rightClick(getCheckbox(0));
        // The edit button tooltip is routed through translate().
        expect(translate).toHaveBeenCalledWith("text-editor.edit-states-tooltip");
    });

    it("appends an unknown-state label for an unconfigured task state", async () => {
        const translate = vi.fn((key: string) => key === "text-editor.unknown-task-state" ? "Unknown state" : key);
        await createEditor({ translate });
        // Give the first todo item a state not present in the configured set.
        editor.model.change((writer) => {
            writer.setAttribute("taskState", "mystery", getBlock(0));
        });
        const balloon = getBalloon();
        rightClick(getCheckbox(0));

        const unknown = balloon.view.element?.querySelector(".tn-task-state-unknown");
        expect(unknown).not.toBeNull();
        const name = balloon.view.element?.querySelector(".tn-task-state-unknown-name");
        expect(name?.textContent).toBe("mystery");
    });

    it("clears a previously shown unknown-state label when reshown for a known state", async () => {
        await createEditor();
        const balloon = getBalloon();

        // First: unknown state on item A.
        editor.model.change((writer) => {
            writer.setAttribute("taskState", "mystery", getBlock(0));
        });
        rightClick(getCheckbox(0));
        expect(balloon.view.element?.querySelector(".tn-task-state-unknown")).not.toBeNull();

        // Then: item B has no special (or a configured) state -> label removed.
        rightClick(getCheckbox(1));
        expect(balloon.view.element?.querySelector(".tn-task-state-unknown")).toBeNull();
    });

    it("does not add an unknown-state label for a configured custom state", async () => {
        await createEditor();
        const balloon = getBalloon();
        editor.model.change((writer) => {
            // "doing" is one of the default configured states.
            writer.setAttribute("taskState", "doing", getBlock(0));
        });
        rightClick(getCheckbox(0));
        expect(balloon.view.element?.querySelector(".tn-task-state-unknown")).toBeNull();
    });

    it("hides via the click-outside handler", async () => {
        await createEditor();
        const balloon = getBalloon();
        rightClick(getCheckbox(0));
        expect(balloon.visibleView).not.toBeNull();

        // A mousedown anywhere outside the balloon triggers the click-outside callback.
        document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        expect(balloon.visibleView).toBeNull();
    });

    it("the click-outside contextElements include the balloon element while visible", async () => {
        await createEditor();
        const balloon = getBalloon();

        // While hidden, a click outside is a no-op (activator returns false).
        document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        expect(balloon.visibleView).toBeNull();

        rightClick(getCheckbox(0));
        // A mousedown *inside* the balloon must not hide it (it is in contextElements).
        const balloonEl = balloon.view.element;
        expect(balloonEl).toBeTruthy();
        balloonEl?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        expect(balloon.visibleView).not.toBeNull();
    });

    it("does not show when the checkbox has no element wrapper resolvable in the DOM", async () => {
        await createEditor();
        const balloon = getBalloon();
        const plugin = getPlugin();

        // A fake checkbox view element whose parent is not an element -> _show returns early.
        const fakeCheckbox = {
            parent: { is: () => false }
        } as unknown as ViewElement;
        (plugin as unknown as { _show(c: ViewElement): void })._show(fakeCheckbox);
        expect(balloon.visibleView).toBeNull();

        // No parent at all -> also returns early.
        const orphan = { parent: null } as unknown as ViewElement;
        (plugin as unknown as { _show(c: ViewElement): void })._show(orphan);
        expect(balloon.visibleView).toBeNull();
    });

    it("does not show when the wrapper has no DOM anchor", async () => {
        await createEditor();
        const balloon = getBalloon();
        const plugin = getPlugin();
        vi.spyOn(editor.editing.view.domConverter, "viewToDom").mockReturnValue(undefined as unknown as HTMLElement);

        const checkbox = editor.editing.view.domConverter.domToView(getCheckbox(0));
        expect(checkbox).toBeTruthy();
        if (checkbox && checkbox.is("element")) {
            (plugin as unknown as { _show(c: ViewElement): void })._show(checkbox);
        }
        expect(balloon.visibleView).toBeNull();
    });

    it("does not show when the model block cannot be resolved from the checkbox", async () => {
        await createEditor();
        const balloon = getBalloon();
        const plugin = getPlugin();
        // Force _findTodoBlock to return null while keeping a valid DOM anchor.
        vi.spyOn(plugin as unknown as { _findTodoBlock(c: ViewElement): ModelElement | null }, "_findTodoBlock")
            .mockReturnValue(null);

        const checkbox = editor.editing.view.domConverter.domToView(getCheckbox(0));
        if (checkbox && checkbox.is("element")) {
            (plugin as unknown as { _show(c: ViewElement): void })._show(checkbox);
        }
        expect(balloon.visibleView).toBeNull();
    });

    it("records a null target id when the resolved block has no listItemId", async () => {
        await createEditor();
        const plugin = getPlugin();
        const block = getBlock(0);
        const fakeBlock = {
            getAttribute: (key: string) => key === "listItemId" ? undefined : block.getAttribute(key)
        } as unknown as ModelElement;
        vi.spyOn(plugin as unknown as { _findTodoBlock(c: ViewElement): ModelElement | null }, "_findTodoBlock")
            .mockReturnValue(fakeBlock);

        const checkbox = editor.editing.view.domConverter.domToView(getCheckbox(0));
        // Selection writing on a fake block would crash; assert the id capture path only.
        try {
            if (checkbox && checkbox.is("element")) {
                (plugin as unknown as { _show(c: ViewElement): void })._show(checkbox);
            }
        } catch {
            // model.change on a detached fake block can throw; the targetItemId branch ran.
        }
        expect((plugin as unknown as { _targetItemId: string | null })._targetItemId).toBeNull();
    });

    describe("_findTodoBlock branches", () => {
        it("returns null when the checkbox has no <li> ancestor", async () => {
            await createEditor();
            const plugin = getPlugin();
            const find = (plugin as unknown as { _findTodoBlock(c: ViewElement): ModelElement | null })._findTodoBlock
                .bind(plugin);
            const fake = { findAncestor: () => null } as unknown as ViewElement;
            expect(find(fake)).toBeNull();
        });

        it("returns null when the <li> has no data-list-item-id", async () => {
            await createEditor();
            const plugin = getPlugin();
            const find = (plugin as unknown as { _findTodoBlock(c: ViewElement): ModelElement | null })._findTodoBlock
                .bind(plugin);
            const fakeLi = {} as unknown as ViewElement;
            vi.spyOn(editor.editing.view.domConverter, "viewToDom").mockReturnValue(
                document.createElement("li") as unknown as HTMLElement
            );
            const fake = { findAncestor: () => fakeLi } as unknown as ViewElement;
            expect(find(fake)).toBeNull();
        });

        it("returns null when the document has no root", async () => {
            await createEditor();
            const plugin = getPlugin();
            const find = (plugin as unknown as { _findTodoBlock(c: ViewElement): ModelElement | null })._findTodoBlock
                .bind(plugin);
            const domLi = document.createElement("li");
            domLi.setAttribute("data-list-item-id", "todo-a");
            vi.spyOn(editor.editing.view.domConverter, "viewToDom").mockReturnValue(domLi as unknown as HTMLElement);
            vi.spyOn(editor.model.document, "getRoot").mockReturnValue(null);
            const fake = { findAncestor: () => ({}) } as unknown as ViewElement;
            expect(find(fake)).toBeNull();
        });

        it("returns null when no model item matches the data-list-item-id", async () => {
            await createEditor();
            const plugin = getPlugin();
            const find = (plugin as unknown as { _findTodoBlock(c: ViewElement): ModelElement | null })._findTodoBlock
                .bind(plugin);
            const domLi = document.createElement("li");
            domLi.setAttribute("data-list-item-id", "no-such-id");
            vi.spyOn(editor.editing.view.domConverter, "viewToDom").mockReturnValue(domLi as unknown as HTMLElement);
            const fake = { findAncestor: () => ({}) } as unknown as ViewElement;
            expect(find(fake)).toBeNull();
        });

        it("resolves the matching todo model item", async () => {
            await createEditor();
            const plugin = getPlugin();
            const find = (plugin as unknown as { _findTodoBlock(c: ViewElement): ModelElement | null })._findTodoBlock
                .bind(plugin);
            const checkbox = editor.editing.view.domConverter.domToView(getCheckbox(0));
            if (checkbox && checkbox.is("element")) {
                const block = find(checkbox);
                expect(block?.getAttribute("listItemId")).toBe("todo-a");
            }
        });
    });

    describe("isTodoCheckbox guard (via contextmenu)", () => {
        function fireContextmenu(target: unknown): void {
            editor.editing.view.document.fire("contextmenu", {
                target,
                domEvent: { preventDefault: () => {} }
            });
        }

        it("ignores a null/non-view target", async () => {
            await createEditor();
            const balloon = getBalloon();
            fireContextmenu(undefined);
            expect(balloon.visibleView).toBeNull();

            // A target object without an is() function is rejected too.
            fireContextmenu({ foo: 1 });
            expect(balloon.visibleView).toBeNull();
        });

        it("ignores an element that is not an input", async () => {
            await createEditor();
            const balloon = getBalloon();
            const li = editor.editing.view.getDomRoot()?.querySelector("li");
            expect(li).toBeTruthy();
            if (li) {
                rightClick(li);
            }
            expect(balloon.visibleView).toBeNull();
        });

        it("ignores an input that is not a checkbox", async () => {
            await createEditor();
            const balloon = getBalloon();
            const fake = {
                is: (...args: string[]) => args[0] === "element" && args[1] === "input",
                getAttribute: () => "text",
                findAncestor: () => ({})
            };
            fireContextmenu(fake);
            expect(balloon.visibleView).toBeNull();
        });

        it("ignores a checkbox input that is not inside a todo label", async () => {
            await createEditor();
            const balloon = getBalloon();
            const fake = {
                is: (...args: string[]) => args[0] === "element" && args[1] === "input",
                getAttribute: (key: string) => key === "type" ? "checkbox" : null,
                findAncestor: () => null
            };
            fireContextmenu(fake);
            expect(balloon.visibleView).toBeNull();
        });
    });

    describe("_hide / change:range edge cases", () => {
        it("_hide is a no-op when the balloon is not visible", async () => {
            await createEditor();
            const balloon = getBalloon();
            const removeSpy = vi.spyOn(balloon, "remove");
            // Not visible: _hide should not call balloon.remove, just reset the id.
            (getPlugin() as unknown as { _hide(): void })._hide();
            expect(removeSpy).not.toHaveBeenCalled();
            expect((getPlugin() as unknown as { _targetItemId: string | null })._targetItemId).toBeNull();
        });

        it("hides when a visible balloon sees a selection with no element first position", async () => {
            await createEditor();
            const balloon = getBalloon();
            rightClick(getCheckbox(0));
            expect(balloon.visibleView).not.toBeNull();

            // Exercise the `block && is?.("element")` -> false branch of the change:range handler.
            // Override getFirstPosition just for the duration of one synchronous emit so other
            // editor listeners are not affected (restored before any further selection activity).
            const document = editor.model.document;
            const selection = document.selection as unknown as { getFirstPosition: () => unknown };
            const original = selection.getFirstPosition;
            selection.getFirstPosition = () => undefined;
            try {
                document.selection.fire("change:range", { directChange: false } as never);
            } finally {
                selection.getFirstPosition = original;
            }

            expect(balloon.visibleView).toBeNull();
        });

    });

    it("contextElements returns an empty list when the balloon has no element", async () => {
        await createEditor();
        const balloon = getBalloon();
        // Force balloon.view.element to be null and trigger an outside click while "visible".
        rightClick(getCheckbox(0));
        const elementSpy = vi.spyOn(balloon.view, "element", "get").mockReturnValue(null);
        // The click-outside handler reads contextElements(); with no element it returns [].
        document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        elementSpy.mockRestore();
        // The handler still ran (and hid the toolbar since the click was outside the empty set).
        expect(balloon.visibleView).toBeNull();
    });

    it("clears stale unknown-state items even when no longer present in the toolbar", async () => {
        await createEditor();
        const plugin = getPlugin();
        const update = (plugin as unknown as { _updateUnknownStateLabel(s: string | null): void })
            ._updateUnknownStateLabel.bind(plugin);
        const toolbar = (plugin as unknown as { _toolbarView: { items: { has(v: unknown): boolean } } })._toolbarView;

        // Seed an unknown-state label, then externally clear the toolbar's items so the
        // tracked items are no longer present -> the `has(item)` guard takes its false branch.
        update("mystery");
        const hasSpy = vi.spyOn(toolbar.items, "has").mockReturnValue(false);
        update(null);
        hasSpy.mockRestore();
        expect((plugin as unknown as { _unknownStateItems: unknown[] })._unknownStateItems).toHaveLength(0);
    });

    it("destroys the toolbar view on plugin destroy", async () => {
        await createEditor();
        const plugin = getPlugin();
        const toolbarView = (plugin as unknown as { _toolbarView: { destroy: () => void } })._toolbarView;
        const destroySpy = vi.spyOn(toolbarView, "destroy");
        await editor.destroy();
        expect(destroySpy).toHaveBeenCalled();
        // Recreate so afterEach's destroy() does not double-destroy.
        await createEditor();
    });
});
