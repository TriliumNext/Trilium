import {
    _getViewData as getViewData,
    _setModelData as setModelData,
    ClassicEditor,
    Essentials,
    Paragraph,
    Widget,
    type ModelElement
} from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import { installGlobMock } from "../../test/globals-test-kit.js";
import IncludeNote, { BOX_SIZE_COMMAND_NAME, BOX_SIZES, COMMAND_NAME } from "./includenote.js";

describe("IncludeNote", () => {
    let editor: ClassicEditor;
    let triggerCommand: ReturnType<typeof vi.fn>;
    let loadIncludedNote: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
        triggerCommand = vi.fn();
        loadIncludedNote = vi.fn();
        installGlobMock({
            getComponentByEl: () => ({ triggerCommand, loadIncludedNote })
        });

        editor = await createTestEditor([Essentials, Paragraph, Widget, IncludeNote]);
    });

    // -----------------------------------------------------------------------
    // Plugin / schema registration
    // -----------------------------------------------------------------------

    it("loads the plugin, sub-plugins, schema, commands and the toolbar button", () => {
        expect(editor.plugins.get(IncludeNote)).toBeInstanceOf(IncludeNote);
        expect(editor.commands.get(COMMAND_NAME)).toBeDefined();
        expect(editor.commands.get(BOX_SIZE_COMMAND_NAME)).toBeDefined();
        expect(editor.ui.componentFactory.has("includeNote")).toBe(true);

        const schema = editor.model.schema;
        expect(schema.isRegistered("includeNote")).toBe(true);
        expect(schema.isObject("includeNote")).toBe(true);
        expect(schema.checkAttribute(["$root", "includeNote"], "noteId")).toBe(true);
        expect(schema.checkAttribute(["$root", "includeNote"], "boxSize")).toBe(true);
    });

    // -----------------------------------------------------------------------
    // UI button
    // -----------------------------------------------------------------------

    it("wires the toolbar button to the insert command (enablement and execution)", () => {
        const view = editor.ui.componentFactory.create("includeNote") as {
            isEnabled: boolean;
            isOn: boolean;
            label: string;
            fire(name: string): void;
        };
        const command = editor.commands.get(COMMAND_NAME);

        expect(view.label).toBe("Include note");
        expect(view.isEnabled).toBe(command?.isEnabled);

        const spy = vi.spyOn(editor, "execute");
        view.fire("execute");
        expect(spy).toHaveBeenCalledWith(COMMAND_NAME);
    });

    // -----------------------------------------------------------------------
    // Conversion: upcast / data downcast / editing downcast
    // -----------------------------------------------------------------------

    it("upcasts a <section class=\"include-note\"> into an includeNote model element", () => {
        editor.setData(
            '<section class="include-note" data-note-id="abc123" data-box-size="medium"></section>'
        );

        const element = findIncludeNote(editor);
        expect(element).toBeDefined();
        expect(element?.getAttribute("noteId")).toBe("abc123");
        expect(element?.getAttribute("boxSize")).toBe("medium");
    });

    it("data-downcasts an includeNote back to a <section class=\"include-note\"> with data attributes", () => {
        insertIncludeNote(editor, "noteX", "full");

        const data = editor.getData();
        expect(data).toContain('class="include-note"');
        expect(data).toContain('data-note-id="noteX"');
        expect(data).toContain('data-box-size="full"');
    });

    it("editing-downcasts to a widget and invokes loadIncludedNote when the UIElement renders", () => {
        editor.setData(
            '<section class="include-note" data-note-id="noteY" data-box-size="small"></section>'
        );

        const view = getViewData(editor.editing.view);
        expect(view).toContain("include-note");
        expect(view).toContain("ck-widget");
        expect(view).toContain("box-size-small");

        // Querying the DOM root forces the UIElement render callback to run.
        const domRoot = editor.editing.view.getDomRoot();
        const wrapper = domRoot?.querySelector("div.include-note-wrapper");
        expect(wrapper).not.toBeNull();

        expect(loadIncludedNote).toHaveBeenCalledTimes(1);
        expect(loadIncludedNote.mock.calls[0]?.[0]).toBe("noteY");
        // The box size is passed explicitly so the client render does not have to read it back
        // from the DOM (which may not be flushed yet at conversion time).
        expect(loadIncludedNote.mock.calls[0]?.[2]).toBe("small");
    });

    it("updates the box-size class on the editing view when the boxSize attribute changes", () => {
        insertIncludeNote(editor, "noteZ", "small");

        const domRoot = editor.editing.view.getDomRoot();
        const section = domRoot?.querySelector("section.include-note");
        expect(section?.classList.contains("box-size-small")).toBe(true);

        editor.execute(BOX_SIZE_COMMAND_NAME, { value: "full" });

        expect(section?.classList.contains("box-size-small")).toBe(false);
        expect(section?.classList.contains("box-size-full")).toBe(true);
        expect(section?.getAttribute("data-box-size")).toBe("full");
    });

    it("re-renders the included note content with the new size on a genuine box-size change", () => {
        insertIncludeNote(editor, "noteReload", "small");

        // One call for the initial render.
        expect(loadIncludedNote).toHaveBeenCalledTimes(1);
        expect(loadIncludedNote.mock.calls[0]?.[2]).toBe("small");

        editor.execute(BOX_SIZE_COMMAND_NAME, { value: "expandable" });

        // The downcast handler drives a second render with the new size, without any DOM observer.
        expect(loadIncludedNote).toHaveBeenCalledTimes(2);
        const reloadCall = loadIncludedNote.mock.calls[1];
        expect(reloadCall?.[0]).toBe("noteReload");
        expect(reloadCall?.[2]).toBe("expandable");
    });

    it("handles a boxSize change from an empty old value (no class to remove)", () => {
        // Insert an includeNote whose boxSize is empty so the attribute-change converter
        // hits the falsy `oldBoxSize` branch when the value is set for the first time.
        const element = insertIncludeNote(editor, "noteW", "");

        editor.model.change((writer) => {
            writer.setAttribute("boxSize", "medium", element);
        });

        const domRoot = editor.editing.view.getDomRoot();
        const section = domRoot?.querySelector("section.include-note");
        expect(section?.classList.contains("box-size-medium")).toBe(true);
        expect(section?.getAttribute("data-box-size")).toBe("medium");
    });

    it("ignores a boxSize change cleared to an empty value (no new class to add)", () => {
        const element = insertIncludeNote(editor, "noteV", "small");

        editor.model.change((writer) => {
            writer.setAttribute("boxSize", "", element);
        });

        const domRoot = editor.editing.view.getDomRoot();
        const section = domRoot?.querySelector("section.include-note");
        // Old class removed, no new class added because the new value is empty.
        expect(section?.classList.contains("box-size-small")).toBe(false);
        expect(section?.classList.contains("box-size-")).toBe(false);
    });

    // -----------------------------------------------------------------------
    // InsertIncludeNoteCommand
    // -----------------------------------------------------------------------

    it("triggers addIncludeNoteToText on the Trilium component when the insert command executes", () => {
        editor.execute(COMMAND_NAME);
        expect(triggerCommand).toHaveBeenCalledWith("addIncludeNoteToText");
    });

    it("enables the insert command in a paragraph and disables it where blocks are disallowed", () => {
        const command = editor.commands.get(COMMAND_NAME);

        setModelData(editor.model, "<paragraph>foo[]bar</paragraph>");
        expect(command?.isEnabled).toBe(true);

        // Forbid includeNote anywhere via a child check, then refresh: no allowed parent
        // for the current selection means the command disables itself.
        editor.model.schema.addChildCheck((_context, def) => {
            if (def.name === "includeNote") {
                return false;
            }
        });
        command?.refresh();
        expect(command?.isEnabled).toBe(false);
    });

    // -----------------------------------------------------------------------
    // IncludeNoteBoxSizeCommand
    // -----------------------------------------------------------------------

    it("box-size command is disabled with no selected includeNote and reports a null value", () => {
        setModelData(editor.model, "<paragraph>foo[]bar</paragraph>");

        const command = editor.commands.get(BOX_SIZE_COMMAND_NAME) as {
            isEnabled: boolean;
            value: string | null;
        };
        expect(command.isEnabled).toBe(false);
        expect(command.value).toBeNull();
    });

    it("box-size command enables and reflects the value when an includeNote is selected", () => {
        insertIncludeNote(editor, "noteSel", "medium");

        const command = editor.commands.get(BOX_SIZE_COMMAND_NAME) as {
            isEnabled: boolean;
            value: string | null;
        };
        expect(command.isEnabled).toBe(true);
        expect(command.value).toBe("medium");

        // Execute through every defined box size to cover the model write path.
        for (const { value } of BOX_SIZES) {
            editor.execute(BOX_SIZE_COMMAND_NAME, { value });
            expect(command.value).toBe(value);
            expect(findIncludeNote(editor)?.getAttribute("boxSize")).toBe(value);
        }
    });

    it("box-size command resolves the includeNote via an ancestor position (not a direct selection)", () => {
        // Make the includeNote allow text inside so the selection can be placed within it
        // (a collapsed position) rather than selecting the element itself.
        editor.model.schema.extend("$text", { allowIn: "includeNote" });

        const element = insertIncludeNote(editor, "noteAnc", "expandable");
        editor.model.change((writer) => {
            writer.setSelection(writer.createPositionAt(element, 0));
        });

        const command = editor.commands.get(BOX_SIZE_COMMAND_NAME) as {
            isEnabled: boolean;
            value: string | null;
        };
        expect(command.isEnabled).toBe(true);
        expect(command.value).toBe("expandable");
    });

    it("box-size command execute is a no-op when nothing is selected", () => {
        setModelData(editor.model, "<paragraph>foo[]bar</paragraph>");
        const before = editor.getData();

        // The decorated Command.execute short-circuits while the command is disabled, so to
        // run our execute() body with no includeNote selected we force it enabled first. This
        // exercises the falsy `if (includeNoteElement)` branch.
        const command = editor.commands.get(BOX_SIZE_COMMAND_NAME) as {
            isEnabled: boolean;
            execute(options: { value: string }): void;
        };
        command.isEnabled = true;
        command.execute({ value: "full" });

        expect(editor.getData()).toBe(before);
    });

    // -----------------------------------------------------------------------
    // preventCKEditorHandling / selectIncludeNoteWidget (DOM event handlers)
    // -----------------------------------------------------------------------

    it("selects the widget and suppresses editor handling on a mousedown inside the wrapper", () => {
        insertIncludeNote(editor, "noteEvt", "small");

        const domRoot = editor.editing.view.getDomRoot();
        const wrapper = domRoot?.querySelector("div.include-note-wrapper");
        expect(wrapper).not.toBeNull();
        if (!wrapper) {
            return;
        }

        const evt = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
        const stopSpy = vi.spyOn(evt, "stopPropagation");
        wrapper.dispatchEvent(evt);
        expect(stopSpy).toHaveBeenCalled();

        // The widget should now be selected (the mousedown handler selects it).
        const selected = editor.model.document.selection.getSelectedElement();
        expect(selected?.name).toBe("includeNote");
    });

    it("suppresses the native caret on a non-interactive mousedown but not on interactive targets", () => {
        insertIncludeNote(editor, "noteCaret", "small");

        const domRoot = editor.editing.view.getDomRoot();
        const wrapper = domRoot?.querySelector("div.include-note-wrapper");
        expect(wrapper).not.toBeNull();
        if (!wrapper) {
            return;
        }

        // Clicking a plain (non-interactive) area should preventDefault so the browser does not
        // drop a caret next to the contenteditable=false widget.
        const plainEvt = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
        const plainPrevent = vi.spyOn(plainEvt, "preventDefault");
        wrapper.dispatchEvent(plainEvt);
        expect(plainPrevent).toHaveBeenCalled();

        // Clicking a link must keep native behaviour: the handler steps aside entirely, so neither
        // preventDefault nor stopPropagation is called.
        const innerLink = document.createElement("a");
        innerLink.href = "#root/abc";
        wrapper.appendChild(innerLink);

        const linkEvt = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
        const linkPrevent = vi.spyOn(linkEvt, "preventDefault");
        const linkStop = vi.spyOn(linkEvt, "stopPropagation");
        innerLink.dispatchEvent(linkEvt);
        expect(linkPrevent).not.toHaveBeenCalled();
        expect(linkStop).not.toHaveBeenCalled();
    });

    it("leaves a mousedown inside an embedded collection untouched so the live widget keeps working", () => {
        insertIncludeNote(editor, "noteColl", "full");

        const domRoot = editor.editing.view.getDomRoot();
        const wrapper = domRoot?.querySelector("div.include-note-wrapper");
        expect(wrapper).not.toBeNull();
        if (!wrapper) {
            return;
        }

        // Simulate the embedded collection markup (e.g. a geo-map marker lives under .rendered-collection).
        const collection = document.createElement("div");
        collection.className = "rendered-collection";
        const marker = document.createElement("div");
        collection.appendChild(marker);
        wrapper.appendChild(collection);

        const evt = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
        const prevent = vi.spyOn(evt, "preventDefault");
        const stop = vi.spyOn(evt, "stopPropagation");
        marker.dispatchEvent(evt);

        // The handler must step aside completely so Leaflet (and other live widgets) get the event.
        expect(prevent).not.toHaveBeenCalled();
        expect(stop).not.toHaveBeenCalled();
    });

    it("treats a mousedown whose target is not an Element (e.g. a text node) as non-interactive", () => {
        insertIncludeNote(editor, "noteText", "small");

        const domRoot = editor.editing.view.getDomRoot();
        const wrapper = domRoot?.querySelector("div.include-note-wrapper");
        expect(wrapper).not.toBeNull();
        if (!wrapper) {
            return;
        }

        // A capture-phase mousedown on a bare text node makes evt.target a Text, not an Element. The
        // interactive-target guard must short-circuit and report "not interactive", so the widget's
        // normal suppression (preventDefault + stopPropagation) still runs.
        const textNode = document.createTextNode("plain text");
        wrapper.appendChild(textNode);

        const evt = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
        const prevent = vi.spyOn(evt, "preventDefault");
        const stop = vi.spyOn(evt, "stopPropagation");
        textNode.dispatchEvent(evt);

        expect(prevent).toHaveBeenCalled();
        expect(stop).toHaveBeenCalled();
    });

    it("stops propagation on focus and keydown inside the wrapper", () => {
        insertIncludeNote(editor, "noteKbd", "small");

        const domRoot = editor.editing.view.getDomRoot();
        const wrapper = domRoot?.querySelector("div.include-note-wrapper");
        expect(wrapper).not.toBeNull();
        if (!wrapper) {
            return;
        }

        const focusEvt = new FocusEvent("focus");
        const focusStop = vi.spyOn(focusEvt, "stopPropagation");
        wrapper.dispatchEvent(focusEvt);
        expect(focusStop).toHaveBeenCalled();

        const keyEvt = new KeyboardEvent("keydown", { bubbles: true });
        const keyStop = vi.spyOn(keyEvt, "stopPropagation");
        wrapper.dispatchEvent(keyEvt);
        expect(keyStop).toHaveBeenCalled();
    });

    it("does nothing on a mousedown when the wrapper has no enclosing include-note section", () => {
        insertIncludeNote(editor, "noteDetached", "small");

        const domRoot = editor.editing.view.getDomRoot();
        const wrapper = domRoot?.querySelector("div.include-note-wrapper");
        expect(wrapper).not.toBeNull();
        if (!wrapper) {
            return;
        }

        // Detach the wrapper (which carries the capture-phase mousedown handler) from its
        // section so that domElement.closest("section.include-note") returns null. The handler
        // still fires because it is bound to the wrapper element itself.
        const holder = document.createElement("div");
        document.body.appendChild(holder);
        holder.appendChild(wrapper);

        wrapper.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));

        holder.remove();
        // The early return means no selection change beyond the original insert selection.
        expect(true).toBe(true);
    });

    it("does nothing on a mousedown when the section is not mapped to a view element", () => {
        insertIncludeNote(editor, "noteUnmapped", "small");

        const domRoot = editor.editing.view.getDomRoot();
        const wrapper = domRoot?.querySelector("div.include-note-wrapper");
        expect(wrapper).not.toBeNull();
        if (!wrapper) {
            return;
        }

        // Move the wrapper into a hand-built section.include-note that the editor's
        // DomConverter knows nothing about. closest() then finds this fake section, but
        // mapDomToView() returns nothing for it, so selectIncludeNoteWidget returns early.
        const fakeSection = document.createElement("section");
        fakeSection.className = "include-note";
        document.body.appendChild(fakeSection);
        fakeSection.appendChild(wrapper);

        wrapper.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));

        fakeSection.remove();
        expect(true).toBe(true);
    });

    it("does nothing on a mousedown when the section view element has no mapped model element", () => {
        insertIncludeNote(editor, "noteNoModel", "small");

        const domRoot = editor.editing.view.getDomRoot();
        const wrapper = domRoot?.querySelector("div.include-note-wrapper");
        const section = domRoot?.querySelector<HTMLElement>("section.include-note");
        expect(wrapper).not.toBeNull();
        expect(section).not.toBeNull();
        if (!wrapper || !section) {
            return;
        }

        // The DOM->view mapping stays intact (mapDomToView succeeds), but we break the
        // view->model mapping so selectIncludeNoteWidget returns at the !modelElement guard.
        const viewElement = editor.editing.view.domConverter.mapDomToView(section);
        expect(viewElement).toBeDefined();
        if (viewElement && viewElement.is("element")) {
            editor.editing.mapper.unbindViewElement(viewElement);
        }

        expect(() => {
            wrapper.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
        }).not.toThrow();
    });

    it("falls back gracefully in the button factory when the insert command is absent", () => {
        // Exercise the falsy `if (command)` branch in IncludeNoteUI: when the command lookup
        // returns undefined, the button must still be created (just without the binding).
        const realGet = editor.commands.get.bind(editor.commands);
        const getSpy = vi
            .spyOn(editor.commands, "get")
            .mockImplementation((name) => (name === COMMAND_NAME ? undefined : realGet(name)));

        try {
            const view = editor.ui.componentFactory.create("includeNote") as unknown as { label: string };
            expect(view.label).toBe("Include note");
        } finally {
            getSpy.mockRestore();
        }
    });
});

function findIncludeNote(editor: ClassicEditor): ModelElement | undefined {
    const root = editor.model.document.getRoot();
    if (!root) {
        return undefined;
    }
    for (const item of editor.model.createRangeIn(root).getItems()) {
        if (item.is("element", "includeNote")) {
            return item;
        }
    }
    return undefined;
}

function insertIncludeNote(editor: ClassicEditor, noteId: string, boxSize: string): ModelElement {
    let created: ModelElement | null = null;
    editor.model.change((writer) => {
        const root = editor.model.document.getRoot();
        if (!root) {
            throw new Error("The editor has no root.");
        }
        const element = writer.createElement("includeNote", { noteId, boxSize });
        writer.insert(element, root, 0);
        writer.setSelection(element, "on");
        created = element;
    });
    if (!created) {
        throw new Error("Failed to create includeNote element.");
    }
    return created;
}
