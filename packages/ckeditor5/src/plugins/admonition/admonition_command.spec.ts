import { _getModelData as getModelData, _setModelData as setModelData, ClassicEditor, Essentials, Heading, Paragraph } from "ckeditor5";
import { beforeEach, describe, expect, it } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import Admonition from "./admonition.js";
import type AdmonitionCommand from "./admonition_command.js";
import AdmonitionEditing from "./admonition_editing.js";

describe("AdmonitionCommand", () => {
    let editor: ClassicEditor;
    let command: AdmonitionCommand;

    beforeEach(async () => {
        editor = await createTestEditor([Essentials, Paragraph, Heading, Admonition]);
        command = editor.commands.get("admonition") as AdmonitionCommand;
    });

    describe("value and isEnabled", () => {
        it("is off and enabled in a plain paragraph", () => {
            setModelData(editor.model, "<paragraph>foo[]</paragraph>");

            expect(command.value).toBe(false);
            expect(command.isEnabled).toBe(true);
        });

        it("reports the type of the admonition the selection sits in", () => {
            setModelData(editor.model, `<aside admonitionType="warning"><paragraph>foo[]</paragraph></aside>`);

            expect(command.value).toBe("warning");
            expect(command.isEnabled).toBe(true);
        });

        it("is off and disabled when the selection contains no block at all", async () => {
            // No Paragraph plugin, so the root stays empty and `getSelectedBlocks()` yields nothing.
            const blockless = await createTestEditor([Essentials, AdmonitionEditing]);
            const blocklessCommand = blockless.commands.get("admonition") as AdmonitionCommand;

            expect(blocklessCommand.value).toBe(false);
            expect(blocklessCommand.isEnabled).toBe(false);
        });
    });

    describe("applying", () => {
        it("wraps the selected block in a note by default", () => {
            setModelData(editor.model, "<paragraph>foo[]</paragraph>");

            editor.execute("admonition");

            expect(getModelData(editor.model)).toBe(
                `<aside admonitionType="note"><paragraph>foo[]</paragraph></aside>`
            );
        });

        it("applies the type given via forceValue", () => {
            setModelData(editor.model, "<paragraph>foo[]</paragraph>");

            editor.execute("admonition", { forceValue: "caution" });

            expect(command.value).toBe("caution");
        });

        it("reuses the previous choice when usePreviousChoice is set", () => {
            setModelData(editor.model, "<paragraph>foo[]</paragraph>");
            editor.execute("admonition", { forceValue: "tip" });
            editor.execute("admonition");

            expect(command.value).toBe(false);

            editor.execute("admonition", { usePreviousChoice: true });

            expect(command.value).toBe("tip");
        });

        it("falls back to the default type when usePreviousChoice is set but nothing was chosen yet", () => {
            setModelData(editor.model, "<paragraph>foo[]</paragraph>");

            editor.execute("admonition", { usePreviousChoice: true });

            expect(command.value).toBe("note");
        });

        it("changes the type of an admonition the selection already sits in", () => {
            setModelData(editor.model, `<aside admonitionType="note"><paragraph>foo[]</paragraph></aside>`);

            editor.execute("admonition", { forceValue: "important" });

            expect(getModelData(editor.model)).toBe(
                `<aside admonitionType="important"><paragraph>foo[]</paragraph></aside>`
            );
        });

        it("wraps several selected blocks in a single admonition", () => {
            setModelData(editor.model, "<paragraph>[foo</paragraph><paragraph>bar]</paragraph>");

            editor.execute("admonition");

            expect(getModelData(editor.model)).toBe(
                `<aside admonitionType="note"><paragraph>[foo</paragraph><paragraph>bar]</paragraph></aside>`
            );
        });

        it("merges a newly wrapped block into the admonition it now sits next to", () => {
            // The selection spans the block already inside an admonition and the one after it, so
            // the command reuses the existing <aside> for the first and creates one for the second
            // — the two then get merged.
            setModelData(
                editor.model,
                `<aside admonitionType="note"><paragraph>[foo</paragraph></aside><paragraph>bar]</paragraph>`
            );

            editor.execute("admonition", { forceValue: "note" });

            expect(getModelData(editor.model, { withoutSelection: true })).toBe(
                `<aside admonitionType="note"><paragraph>foo</paragraph><paragraph>bar</paragraph></aside>`
            );
        });

        it("keeps non-adjacent block groups in separate admonitions", () => {
            setModelData(
                editor.model,
                "<paragraph>[foo</paragraph><heading1>skipped</heading1><paragraph>bar]</paragraph>"
            );
            // Restrict the selection to the two paragraphs only by re-selecting them individually.
            editor.model.change((writer) => {
                const root = editor.model.document.getRoot();
                const first = root?.getChild(0);
                const last = root?.getChild(2);
                if (!first?.is("element") || !last?.is("element")) {
                    return;
                }
                writer.setSelection([
                    writer.createRangeIn(first),
                    writer.createRangeIn(last)
                ]);
            });

            editor.execute("admonition");

            const data = getModelData(editor.model, { withoutSelection: true });
            expect(data).toBe(
                `<aside admonitionType="note"><paragraph>foo</paragraph></aside>` +
                `<heading1>skipped</heading1>` +
                `<aside admonitionType="note"><paragraph>bar</paragraph></aside>`
            );
        });
    });

    describe("removing", () => {
        it("unwraps the admonition when every block inside is selected", () => {
            setModelData(editor.model, `<aside admonitionType="note"><paragraph>foo[]</paragraph></aside>`);

            editor.execute("admonition");

            expect(getModelData(editor.model)).toBe("<paragraph>foo[]</paragraph>");
        });

        it("moves the block out to the left when it starts the admonition", () => {
            setModelData(
                editor.model,
                `<aside admonitionType="note"><paragraph>foo[]</paragraph><paragraph>bar</paragraph></aside>`
            );

            editor.execute("admonition");

            expect(getModelData(editor.model)).toBe(
                `<paragraph>foo[]</paragraph><aside admonitionType="note"><paragraph>bar</paragraph></aside>`
            );
        });

        it("moves the block out to the right when it ends the admonition", () => {
            setModelData(
                editor.model,
                `<aside admonitionType="note"><paragraph>foo</paragraph><paragraph>bar[]</paragraph></aside>`
            );

            editor.execute("admonition");

            expect(getModelData(editor.model)).toBe(
                `<aside admonitionType="note"><paragraph>foo</paragraph></aside><paragraph>bar[]</paragraph>`
            );
        });

        it("splits the admonition when the block is in the middle", () => {
            setModelData(
                editor.model,
                `<aside admonitionType="note">` +
                `<paragraph>foo</paragraph><paragraph>bar[]</paragraph><paragraph>baz</paragraph>` +
                `</aside>`
            );

            editor.execute("admonition");

            expect(getModelData(editor.model)).toBe(
                `<aside admonitionType="note"><paragraph>foo</paragraph></aside>` +
                `<paragraph>bar[]</paragraph>` +
                `<aside admonitionType="note"><paragraph>baz</paragraph></aside>`
            );
        });
    });
});
