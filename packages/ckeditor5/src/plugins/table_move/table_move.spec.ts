import {
    _getModelData as getModelData,
    _setModelData as setModelData,
    Essentials,
    Paragraph,
    Table
} from "ckeditor5";
import type { ClassicEditor } from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import { modelTable } from "../../../test/table-kit.js";
import TableMove from "./table_move.js";

describe("TableMove", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createTestEditor([Essentials, Paragraph, Table, TableMove]);
    });

    async function getRenderedDomRoot(): Promise<HTMLElement> {
        await new Promise<void>((resolve) => {
            editor.editing.view.once("render", () => resolve());
            editor.editing.view.forceRender();
        });
        const domRoot = editor.editing.view.getDomRoot();
        if (!domRoot) {
            throw new Error("No editing DOM root.");
        }
        return domRoot;
    }

    function keydown(domRoot: HTMLElement, key: string, modifiers: Partial<KeyboardEventInit> = {}) {
        const event = new KeyboardEvent("keydown", {
            key,
            altKey: true,
            bubbles: true,
            cancelable: true,
            ...modifiers
        });
        domRoot.dispatchEvent(event);
        return event;
    }

    it("registers the plugin and the four move commands", () => {
        expect(editor.plugins.get(TableMove)).toBeInstanceOf(TableMove);
        expect(editor.commands.get("moveTableRowUp")).toBeDefined();
        expect(editor.commands.get("moveTableRowDown")).toBeDefined();
        expect(editor.commands.get("moveTableColumnLeft")).toBeDefined();
        expect(editor.commands.get("moveTableColumnRight")).toBeDefined();
    });

    it("registers accessibility info for the four keystrokes", () => {
        const contentEditing = editor.accessibility.keystrokeInfos.get("contentEditing");
        const keystrokes = [...(contentEditing?.groups.get("common")?.keystrokes ?? [])];
        const labels = keystrokes.map((definition) => definition.label);
        expect(labels).toContain("Move row up");
        expect(labels).toContain("Move row down");
        expect(labels).toContain("Move column left");
        expect(labels).toContain("Move column right");
    });

    it("moves the column on Alt+ArrowRight inside a table", async () => {
        setModelData(editor.model, modelTable([["a[]", "b"]]));
        const domRoot = await getRenderedDomRoot();

        const event = keydown(domRoot, "ArrowRight");

        expect(event.defaultPrevented).toBe(true);
        expect(getModelData(editor.model, { withoutSelection: true }))
            .toBe(modelTable([["b", "a"]]));
    });

    it("moves the column on Alt+ArrowLeft inside a table", async () => {
        setModelData(editor.model, modelTable([["a", "b[]"]]));
        const domRoot = await getRenderedDomRoot();

        const event = keydown(domRoot, "ArrowLeft");

        expect(event.defaultPrevented).toBe(true);
        expect(getModelData(editor.model, { withoutSelection: true }))
            .toBe(modelTable([["b", "a"]]));
    });

    it("lets Alt+ArrowLeft through outside a table so the app shortcut keeps working", async () => {
        setModelData(editor.model, "<paragraph>fo[]o</paragraph>");
        const domRoot = await getRenderedDomRoot();
        const spy = vi.spyOn(editor, "execute");

        const event = keydown(domRoot, "ArrowLeft");

        expect(event.defaultPrevented).toBe(false);
        expect(spy).not.toHaveBeenCalled();
    });

    it("swallows an edge press inside a table without executing or navigating", async () => {
        setModelData(editor.model, modelTable([["a[]", "b"]]));
        const domRoot = await getRenderedDomRoot();
        const spy = vi.spyOn(editor, "execute");

        const event = keydown(domRoot, "ArrowLeft");

        expect(event.defaultPrevented).toBe(true);
        expect(spy).not.toHaveBeenCalled();
        expect(getModelData(editor.model, { withoutSelection: true }))
            .toBe(modelTable([["a", "b"]]));
    });

    it("ignores the keys without the move modifier or with extra modifiers", async () => {
        setModelData(editor.model, modelTable([["a[]", "b"]]));
        const domRoot = await getRenderedDomRoot();
        const spy = vi.spyOn(editor, "execute");

        expect(keydown(domRoot, "ArrowRight", { ctrlKey: true }).defaultPrevented).toBe(false);
        expect(keydown(domRoot, "a").defaultPrevented).toBe(false);
        expect(spy).not.toHaveBeenCalled();
    });

    it("removes the native keydown listener when the editor is destroyed", async () => {
        setModelData(editor.model, modelTable([["a[]"]]));
        const domRoot = await getRenderedDomRoot();
        const removeSpy = vi.spyOn(domRoot, "removeEventListener");

        await editor.destroy();

        expect(removeSpy).toHaveBeenCalledWith("keydown", expect.any(Function), { capture: true });
    });
});
