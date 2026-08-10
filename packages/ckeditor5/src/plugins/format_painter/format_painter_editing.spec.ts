import {
    Bold,
    type ClassicEditor,
    Essentials,
    _getModelData as getModelData,
    Heading,
    HorizontalLine,
    Italic,
    Paragraph,
    _setModelData as setModelData,
    Underline
} from "ckeditor5";
import { beforeEach, describe, expect, it } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import { COPY_FORMAT_COMMAND, PASTE_FORMAT_COMMAND } from "./constants.js";
import FormatPainterEditing, { type CopyFormatCommand, type FormattingAttributes, type PasteFormatCommand } from "./format_painter_editing.js";

describe("FormatPainterEditing", () => {
    let editor: ClassicEditor;

    async function createEditor() {
        editor = await createTestEditor([ Essentials, Paragraph, Bold, Italic, Underline, Heading, HorizontalLine, FormatPainterEditing ]);
        // A registered-but-not-formatting attribute, to prove the commands key off `isFormatting`
        // rather than "any attribute present".
        editor.model.schema.extend("$text", { allowAttributes: "marker" });
    }

    function copyCommand() {
        const command = editor.commands.get(COPY_FORMAT_COMMAND) as CopyFormatCommand | undefined;
        if (!command) {
            throw new Error("copyFormat command was not registered");
        }
        return command;
    }

    function pasteCommand() {
        const command = editor.commands.get(PASTE_FORMAT_COMMAND) as PasteFormatCommand | undefined;
        if (!command) {
            throw new Error("pasteFormat command was not registered");
        }
        return command;
    }

    function model() {
        return getModelData(editor.model, { withoutSelection: true });
    }

    beforeEach(async () => {
        await createEditor();
    });

    it("registers both commands", () => {
        expect(FormatPainterEditing.pluginName).toBe("FormatPainterEditing");
        expect(copyCommand()).toBeTruthy();
        expect(pasteCommand()).toBeTruthy();
    });

    describe("copyFormat", () => {
        it("reads the formatting of a ranged selection's first text node, ignoring non-formatting attributes", () => {
            setModelData(editor.model, "<paragraph>[<$text bold=\"true\" marker=\"x\">foo</$text>]</paragraph>");

            copyCommand().execute();

            // `bold` is a formatting attribute; `marker` is registered but not, so it is dropped.
            expect(copyCommand().value).toEqual({ bold: true });
        });

        it("reads the caret's selection attributes when collapsed", () => {
            setModelData(editor.model, "<paragraph>foo[]</paragraph>");
            editor.model.change((writer) => writer.setSelectionAttribute("italic", true));

            copyCommand().execute();

            expect(copyCommand().value).toEqual({ italic: true });
        });

        it("stores an empty set when there is no formatting to copy", () => {
            setModelData(editor.model, "<paragraph>[foo]</paragraph>");

            copyCommand().execute();

            expect(copyCommand().value).toEqual({});
        });

        it("stores an empty set for a ranged selection that holds no text", () => {
            // Ranged, but wrapping only an inline element (a line break) — `getItems()` yields the
            // element, never a text node, yet the caret still sits where text is allowed (enabled).
            setModelData(editor.model, "<paragraph>[<softBreak></softBreak>]</paragraph>");

            copyCommand().execute();

            expect(copyCommand().value).toEqual({});
        });

        it("forgets the stored formatting on reset()", () => {
            setModelData(editor.model, "<paragraph>[<$text bold=\"true\">foo</$text>]</paragraph>");
            copyCommand().execute();
            expect(copyCommand().value).toEqual({ bold: true });

            copyCommand().reset();
            expect(copyCommand().value).toBeUndefined();
        });

        it("is enabled inside text content and disabled where text is not allowed", () => {
            setModelData(editor.model, "<paragraph>foo[]</paragraph>");
            copyCommand().refresh();
            expect(copyCommand().isEnabled).toBe(true);

            // A selected block object (a horizontal line) is not a place `$text` may go.
            setModelData(editor.model, "[<horizontalLine></horizontalLine>]");
            copyCommand().refresh();
            expect(copyCommand().isEnabled).toBe(false);
        });
    });

    describe("pasteFormat", () => {
        it("replaces the target's formatting with the stored set over a range", () => {
            setModelData(editor.model, "<paragraph>[<$text bold=\"true\">foo</$text>]</paragraph>");
            copyCommand().execute();

            // Target already has different formatting; it must be gone afterwards.
            setModelData(editor.model, "<paragraph>[<$text italic=\"true\">bar</$text>]</paragraph>");
            pasteCommand().execute();

            const data = model();
            expect(data).toContain("bold=\"true\"");
            expect(data).not.toContain("italic");
        });

        it("keeps a target's non-formatting attribute while replacing its formatting", () => {
            copyCommand().value = { bold: true };

            setModelData(editor.model, "<paragraph>[<$text italic=\"true\" marker=\"x\">bar</$text>]</paragraph>");
            pasteCommand().execute();

            const data = model();
            expect(data).toContain("bold=\"true\"");
            expect(data).toContain("marker=\"x\"");
            expect(data).not.toContain("italic");
        });

        it("applies stored formatting as selection attributes at a collapsed caret, clearing existing ones", () => {
            copyCommand().value = { bold: true };

            setModelData(editor.model, "<paragraph>foo[]</paragraph>");
            editor.model.change((writer) => {
                writer.setSelectionAttribute("italic", true);
                writer.setSelectionAttribute("marker", "x");
            });

            pasteCommand().execute();

            const attributes = [ ...editor.model.document.selection.getAttributeKeys() ].sort();
            // Formatting `italic` is cleared, `bold` applied; the non-formatting `marker` is untouched.
            expect(attributes).toEqual([ "bold", "marker" ]);
        });

        it("spans multiple blocks, skipping the element boundaries between them", () => {
            copyCommand().value = { bold: true };

            setModelData(editor.model, "<paragraph>[foo</paragraph><paragraph>bar]</paragraph>");
            pasteCommand().execute();

            const data = model();
            expect(data).toContain("<paragraph><$text bold=\"true\">foo</$text></paragraph>");
            expect(data).toContain("<paragraph><$text bold=\"true\">bar</$text></paragraph>");
        });

        it("prefers an explicit argument over the stored value", () => {
            copyCommand().value = { bold: true };

            setModelData(editor.model, "<paragraph>[bar]</paragraph>");
            pasteCommand().execute({ italic: true } satisfies FormattingAttributes);

            const data = model();
            expect(data).toContain("italic=\"true\"");
            expect(data).not.toContain("bold");
        });

        it("does nothing when neither an argument nor a stored value is available", () => {
            setModelData(editor.model, "<paragraph>[bar]</paragraph>");
            const before = model();

            pasteCommand().execute();

            expect(model()).toBe(before);
        });
    });
});
