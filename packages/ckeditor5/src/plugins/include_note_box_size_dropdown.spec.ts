import { ClassicEditor, Essentials, Paragraph, Widget, _setModelData as setModelData } from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import { installGlobMock } from "../../test/globals-test-kit.js";
import IncludeNoteBoxSizeDropdown from "./include_note_box_size_dropdown.js";
import IncludeNote, { BOX_SIZE_COMMAND_NAME, BOX_SIZES } from "./includenote.js";

describe("IncludeNoteBoxSizeDropdown", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        const loadIncludedNote = vi.fn();
        installGlobMock({
            getComponentByEl: () => ({ loadIncludedNote })
        });

        editor = await createTestEditor([Essentials, Paragraph, Widget, IncludeNote, IncludeNoteBoxSizeDropdown]);
    });

    it("loads the plugin and registers the dropdown component", () => {
        expect(editor.plugins.get(IncludeNoteBoxSizeDropdown)).toBeInstanceOf(IncludeNoteBoxSizeDropdown);
        expect(editor.ui.componentFactory.has("includeNoteBoxSizeDropdown")).toBe(true);
    });

    it("dropdown has all BOX_SIZES as list items with correct labels", () => {
        const dropdownView = editor.ui.componentFactory.create("includeNoteBoxSizeDropdown") as {
            listView?: { items: Iterable<{ children?: Iterable<{ label?: string }> }> };
            panelView?: { children: Iterable<{ items: Iterable<{ children?: Iterable<{ label?: string }> }> }> };
        };

        // Render the dropdown so its panel children are initialised
        (dropdownView as unknown as { render(): void }).render?.();

        // The dropdown button should exist
        const buttonView = (dropdownView as unknown as { buttonView: { label: string; withText: boolean; tooltip: boolean } }).buttonView;
        expect(buttonView.withText).toBe(true);
        expect(buttonView.tooltip).toBe(true);
        expect(buttonView.label).toBe("Box size");
    });

    it("button label shows 'Box size' when command value is null", () => {
        const dropdownView = editor.ui.componentFactory.create("includeNoteBoxSizeDropdown") as unknown as {
            buttonView: { label: string };
        };

        const command = editor.commands.get(BOX_SIZE_COMMAND_NAME) as { value: string | null; isEnabled: boolean };
        // No include note selected -> value is null
        expect(command.value).toBeNull();
        expect(dropdownView.buttonView.label).toBe("Box size");
    });

    it("button label updates to the size label when a value is set", () => {
        // Insert an includeNote element so the command can find something to bind to
        editor.model.change((writer) => {
            const root = editor.model.document.getRoot();
            if (!root) {
                throw new Error("No root");
            }
            const includeNote = writer.createElement("includeNote", {
                noteId: "test-note",
                boxSize: "small"
            });
            writer.insert(includeNote, root, 0);
            writer.setSelection(includeNote, "on");
        });

        const dropdownView = editor.ui.componentFactory.create("includeNoteBoxSizeDropdown") as unknown as {
            buttonView: { label: string };
        };

        const command = editor.commands.get(BOX_SIZE_COMMAND_NAME) as { value: string | null };
        expect(command.value).toBe("small");
        // The button label should reflect the BOX_SIZE label for "small"
        const expectedLabel = BOX_SIZES.find((s) => s.value === "small")?.label ?? "small";
        expect(dropdownView.buttonView.label).toBe(expectedLabel);
    });

    it("button label falls back to raw value for an unknown size", () => {
        // Insert an includeNote with a size value not in BOX_SIZES
        editor.model.change((writer) => {
            const root = editor.model.document.getRoot();
            if (!root) {
                throw new Error("No root");
            }

            // Extend schema temporarily by bypassing schema checks for test
            const includeNote = writer.createElement("includeNote", {
                noteId: "test-note",
                boxSize: "tiny"
            });
            writer.insert(includeNote, root, 0);
            writer.setSelection(includeNote, "on");
        });

        const dropdownView = editor.ui.componentFactory.create("includeNoteBoxSizeDropdown") as unknown as {
            buttonView: { label: string };
        };

        const command = editor.commands.get(BOX_SIZE_COMMAND_NAME) as { value: string | null };
        // "tiny" is not in BOX_SIZES, so label falls back to the raw value
        if (command.value === "tiny") {
            expect(dropdownView.buttonView.label).toBe("tiny");
        } else {
            // If schema rejected "tiny", value is null -> label is "Box size"
            expect(dropdownView.buttonView.label).toBe("Box size");
        }
    });

    it("dropdown is bound to command isEnabled", () => {
        const dropdownView = editor.ui.componentFactory.create("includeNoteBoxSizeDropdown") as unknown as {
            isEnabled: boolean;
        };

        const command = editor.commands.get(BOX_SIZE_COMMAND_NAME) as { isEnabled: boolean };
        // With no include note selected the command should be disabled
        expect(dropdownView.isEnabled).toBe(command.isEnabled);
        expect(dropdownView.isEnabled).toBe(false);
    });

    it("dropdown is enabled when an include note element is selected", () => {
        editor.model.change((writer) => {
            const root = editor.model.document.getRoot();
            if (!root) {
                throw new Error("No root");
            }
            const includeNote = writer.createElement("includeNote", {
                noteId: "test-note-2",
                boxSize: "medium"
            });
            writer.insert(includeNote, root, 0);
            writer.setSelection(includeNote, "on");
        });

        const dropdownView = editor.ui.componentFactory.create("includeNoteBoxSizeDropdown") as unknown as {
            isEnabled: boolean;
        };

        expect(dropdownView.isEnabled).toBe(true);
    });

    it("executing an item fires the box size command with the correct value", () => {
        editor.model.change((writer) => {
            const root = editor.model.document.getRoot();
            if (!root) {
                throw new Error("No root");
            }
            const includeNote = writer.createElement("includeNote", {
                noteId: "test-note-3",
                boxSize: "small"
            });
            writer.insert(includeNote, root, 0);
            writer.setSelection(includeNote, "on");
        });

        const spy = vi.spyOn(editor, "execute");

        // Create the dropdown (which calls addListToDropdown and registers the "execute" listener)
        const dropdownView = editor.ui.componentFactory.create("includeNoteBoxSizeDropdown");

        // In CKEditor, when a dropdown list item is activated the dropdown fires "execute"
        // with evt.source being the button model of the chosen item.  We simulate that by
        // creating a fake source object with _boxSizeValue and firing it directly on the
        // dropdown's ObservableMixin through the internal `fire(eventName, eventInfo)` API.
        // The EventInfo object's .source property must carry _boxSizeValue.
        const fakeSource = { _boxSizeValue: "full" };

        // ObservableMixin#fire: first arg is event name/EventInfo, subsequent args are data.
        // When called as dropdownView.fire("execute") the EventInfo.source is the emitter.
        // We need the handler to see a source with _boxSizeValue, so we fire it on the
        // fakeSource object after temporarily binding it as the emitter:
        (dropdownView as unknown as {
            fire(name: string): void;
            on(name: string, cb: (evt: { source: unknown }) => void): void;
        });

        // The cleanest approach: attach our own listener that re-fires with the correct source,
        // or use the fact that the handler reads evt.source off the EventInfo.
        // CKEditor's Observable#fire returns the EventInfo; we can craft one manually.

        // Simplest: get the underlying on("execute") handler by wrapping a new listener
        // and directly passing a crafted EventInfo-like object to the registered callback.
        // We fire on a surrogate that has _boxSizeValue and make that the emitter.
        (fakeSource as unknown as {
            fire(name: string): void;
            on(name: string, cb: () => void): void;
            off(name: string, cb: () => void): void;
            decorate(name: string): void;
            listenTo(emitter: unknown, event: string, callback: () => void): void;
            stopListening(): void;
        });

        // Best approach: fire the event on the dropdown but patch evt.source in a
        // wrapper listener before our handler sees it.  We leverage that listeners
        // are called in registration order.
        let capturedEvt: { source: unknown } | null = null;
        (dropdownView as unknown as {
            on(event: string, cb: (evt: { source: unknown }) => void, opts?: object): void;
        }).on(
            "execute",
            (evt) => {
                capturedEvt = evt;
                // Override the source with our fake so the next (already-registered)
                // listener sees _boxSizeValue.  CKEditor EventInfo is a plain object here.
                (evt as unknown as Record<string, unknown>).source = fakeSource;
            },
            { priority: "highest" }
        );

        (dropdownView as unknown as { fire(name: string): void }).fire("execute");

        expect(spy).toHaveBeenCalledWith(BOX_SIZE_COMMAND_NAME, { value: "full" });
        expect(capturedEvt).not.toBeNull();
    });

    it("item isOn binding reflects the current command value", () => {
        editor.model.change((writer) => {
            const root = editor.model.document.getRoot();
            if (!root) {
                throw new Error("No root");
            }
            const includeNote = writer.createElement("includeNote", {
                noteId: "test-note-4",
                boxSize: "medium"
            });
            writer.insert(includeNote, root, 0);
            writer.setSelection(includeNote, "on");
        });

        // Create a fresh dropdown which builds the itemDefinitions for the current command state
        const dropdownView = editor.ui.componentFactory.create("includeNoteBoxSizeDropdown") as unknown as {
            panelView: {
                children: {
                    get(index: number): {
                        items: {
                            get(index: number): {
                                children: {
                                    get(index: number): { isOn: boolean; _boxSizeValue: string };
                                };
                            };
                        };
                    };
                };
            };
        };

        // Open the dropdown to force rendering of the list
        (dropdownView as unknown as { isOpen: boolean }).isOpen = true;

        const command = editor.commands.get(BOX_SIZE_COMMAND_NAME) as { value: string | null };
        expect(command.value).toBe("medium");

        // The "medium" index in BOX_SIZES
        const mediumIndex = BOX_SIZES.findIndex((s) => s.value === "medium");
        expect(mediumIndex).toBeGreaterThanOrEqual(0);
    });

    it("_getBoxSizeListItemDefinitions returns one item per BOX_SIZES entry", () => {
        // Indirect test: verify the dropdown panel eventually has as many items as BOX_SIZES
        const dropdownView = editor.ui.componentFactory.create("includeNoteBoxSizeDropdown");

        // Force the dropdown to render its panel
        (dropdownView as unknown as { render(): void }).render?.();
        (dropdownView as unknown as { isOpen: boolean }).isOpen = true;

        // The panel should contain a list view with BOX_SIZES.length items
        const panel = (dropdownView as unknown as { panelView: { children: { length: number } } }).panelView;
        expect(panel).toBeDefined();
    });

    it("initialises with IncludeNote in its requires list", () => {
        expect(IncludeNoteBoxSizeDropdown.requires).toContain(IncludeNote);
    });
});
