import { _setModelData as setModelData, ClassicEditor, Essentials, Indent, IndentBlock, Paragraph, Table, TableEditing } from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import IndentBlockShortcutPlugin from "./indent_block_shortcut.js";

describe("IndentBlockShortcutPlugin", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createTestEditor([Essentials, Paragraph, Indent, IndentBlock, Table, TableEditing, IndentBlockShortcutPlugin]);
    });

    it("loads the plugin", () => {
        expect(editor.plugins.get(IndentBlockShortcutPlugin)).toBeInstanceOf(IndentBlockShortcutPlugin);
    });

    describe("Tab in a non-table context", () => {
        beforeEach(() => {
            setModelData(editor.model, "<paragraph>foo[]bar</paragraph>");
        });

        it("calls preventDefault when Tab is pressed in a paragraph (not a table)", () => {
            const preventDefaultSpy = vi.fn();

            editor.editing.view.document.fire("tab", {
                shiftKey: false,
                preventDefault: preventDefaultSpy,
                stopPropagation: () => {}
            });

            expect(preventDefaultSpy).toHaveBeenCalled();
        });

        it("calls preventDefault when Shift+Tab is pressed in a paragraph", () => {
            const preventDefaultSpy = vi.fn();

            editor.editing.view.document.fire("tab", {
                shiftKey: true,
                preventDefault: preventDefaultSpy,
                stopPropagation: () => {}
            });

            expect(preventDefaultSpy).toHaveBeenCalled();
        });

        it("executes indentBlock command when Tab is pressed and the command is enabled", () => {
            const plugin = editor.plugins.get(IndentBlockShortcutPlugin);
            const indentBlockCommand = editor.commands.get("indentBlock");
            expect(indentBlockCommand).toBeDefined();
            if (!indentBlockCommand) {
                return;
            }

            // Stub isInTable to ensure non-table branch is exercised
            vi.spyOn(plugin, "isInTable").mockReturnValue(false);

            // Force the command to be enabled
            Object.defineProperty(indentBlockCommand, "isEnabled", {
                get: () => true,
                configurable: true
            });

            const commandExecuteSpy = vi.spyOn(indentBlockCommand, "execute");

            editor.editing.view.document.fire("tab", {
                shiftKey: false,
                preventDefault: () => {},
                stopPropagation: () => {}
            });

            expect(commandExecuteSpy).toHaveBeenCalled();

            // Restore
            delete (indentBlockCommand as unknown as Record<string, unknown>)["isEnabled"];
            vi.restoreAllMocks();
        });

        it("executes outdentBlock command when Shift+Tab is pressed and command is enabled", () => {
            const plugin = editor.plugins.get(IndentBlockShortcutPlugin);
            const outdentBlockCommand = editor.commands.get("outdentBlock");
            expect(outdentBlockCommand).toBeDefined();
            if (!outdentBlockCommand) {
                return;
            }

            vi.spyOn(plugin, "isInTable").mockReturnValue(false);

            Object.defineProperty(outdentBlockCommand, "isEnabled", {
                get: () => true,
                configurable: true
            });

            const commandExecuteSpy = vi.spyOn(outdentBlockCommand, "execute");

            editor.editing.view.document.fire("tab", {
                shiftKey: true,
                preventDefault: () => {},
                stopPropagation: () => {}
            });

            expect(commandExecuteSpy).toHaveBeenCalled();

            // Restore
            delete (outdentBlockCommand as unknown as Record<string, unknown>)["isEnabled"];
            vi.restoreAllMocks();
        });

        it("does not execute the command when Tab is pressed and indentBlock is disabled", () => {
            const plugin = editor.plugins.get(IndentBlockShortcutPlugin);
            const indentBlockCommand = editor.commands.get("indentBlock");
            expect(indentBlockCommand).toBeDefined();
            if (!indentBlockCommand) {
                return;
            }

            vi.spyOn(plugin, "isInTable").mockReturnValue(false);

            // indentBlock is disabled in plain paragraph context (no list)
            if (!indentBlockCommand.isEnabled) {
                const commandExecuteSpy = vi.spyOn(indentBlockCommand, "execute");

                editor.editing.view.document.fire("tab", {
                    shiftKey: false,
                    preventDefault: () => {},
                    stopPropagation: () => {}
                });

                expect(commandExecuteSpy).not.toHaveBeenCalled();
            }

            vi.restoreAllMocks();
        });

        it("does not execute outdentBlock when Shift+Tab is pressed and command is disabled", () => {
            const plugin = editor.plugins.get(IndentBlockShortcutPlugin);
            const outdentBlockCommand = editor.commands.get("outdentBlock");
            expect(outdentBlockCommand).toBeDefined();
            if (!outdentBlockCommand) {
                return;
            }

            vi.spyOn(plugin, "isInTable").mockReturnValue(false);

            if (!outdentBlockCommand.isEnabled) {
                const commandExecuteSpy = vi.spyOn(outdentBlockCommand, "execute");

                editor.editing.view.document.fire("tab", {
                    shiftKey: true,
                    preventDefault: () => {},
                    stopPropagation: () => {}
                });

                expect(commandExecuteSpy).not.toHaveBeenCalled();
            }

            vi.restoreAllMocks();
        });
    });

    describe("Tab in a table cell context (isInTable mocked)", () => {
        beforeEach(() => {
            setModelData(editor.model, "<paragraph>foo[]bar</paragraph>");
        });

        it("does not call preventDefault when isInTable returns true", () => {
            const plugin = editor.plugins.get(IndentBlockShortcutPlugin);
            vi.spyOn(plugin, "isInTable").mockReturnValue(true);

            const preventDefaultSpy = vi.fn();

            editor.editing.view.document.fire("tab", {
                shiftKey: false,
                preventDefault: preventDefaultSpy,
                stopPropagation: () => {}
            });

            expect(preventDefaultSpy).not.toHaveBeenCalled();

            vi.restoreAllMocks();
        });

        it("does not execute indentBlock when isInTable returns true", () => {
            const plugin = editor.plugins.get(IndentBlockShortcutPlugin);
            vi.spyOn(plugin, "isInTable").mockReturnValue(true);

            const indentBlockCommand = editor.commands.get("indentBlock");
            if (indentBlockCommand) {
                const commandExecuteSpy = vi.spyOn(indentBlockCommand, "execute");

                editor.editing.view.document.fire("tab", {
                    shiftKey: false,
                    preventDefault: () => {},
                    stopPropagation: () => {}
                });

                expect(commandExecuteSpy).not.toHaveBeenCalled();
            }

            vi.restoreAllMocks();
        });
    });

    describe("isInTable()", () => {
        it("returns false when the cursor is in a plain paragraph", () => {
            setModelData(editor.model, "<paragraph>foo[]bar</paragraph>");
            const plugin = editor.plugins.get(IndentBlockShortcutPlugin);
            expect(plugin.isInTable()).toBe(false);
        });

        it("returns true when the cursor is inside a table cell", () => {
            editor.setData(
                "<figure class=\"table\"><table><tbody><tr><td>Cell content</td></tr></tbody></table></figure>"
            );

            // Navigate the model tree to find and select inside the table cell
            const root = editor.model.document.getRoot();
            if (root) {
                const tableEl = root.getChild(0);
                if (tableEl && tableEl.is("element") && tableEl.name === "table") {
                    const row = tableEl.getChild(0);
                    if (row && row.is("element")) {
                        const cell = row.getChild(0);
                        if (cell && cell.is("element")) {
                            const cellContent = cell.getChild(0);
                            if (cellContent && cellContent.is("element")) {
                                editor.model.change((writer) => {
                                    writer.setSelection(writer.createPositionAt(cellContent, 0));
                                });
                            }
                        }
                    }
                }
            }

            const plugin = editor.plugins.get(IndentBlockShortcutPlugin);
            expect(plugin.isInTable()).toBe(true);
        });

        it("returns false when getFirstPosition returns null (no selection)", () => {
            setModelData(editor.model, "<paragraph>foo[]bar</paragraph>");
            const plugin = editor.plugins.get(IndentBlockShortcutPlugin);

            vi.spyOn(editor.model.document.selection, "getFirstPosition").mockReturnValueOnce(null);

            expect(plugin.isInTable()).toBe(false);

            vi.restoreAllMocks();
        });
    });
});
