import {
    _getModelData as getModelData,
    _setModelData as setModelData,
    type ClassicEditor,
    Essentials,
    List,
    Paragraph,
    Table
} from "ckeditor5";
import { beforeEach, describe, expect, it } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import Aside from "./aside.js";

const WRAPPED = " position=\"wrap-right\"";

/** An aside in model notation, with `blocks` and the model `attributes`, those of a new one. */
function aside(blocks: string, attributes = ` backgroundColor="#555555"${WRAPPED}`) {
    return `<asideBlock${attributes}><asideContent>${blocks}</asideContent></asideBlock>`;
}

function paragraph(text: string) {
    return `<paragraph>${text}</paragraph>`;
}

const TABLE = "<table><tableRow><tableCell><paragraph>T</paragraph></tableCell></tableRow></table>";

describe("aside commands", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createTestEditor([ Essentials, Paragraph, List, Table, Aside ]);
    });

    function isEnabled(name: "insertAside" | "removeAside") {
        return editor.commands.get(name)?.isEnabled;
    }

    describe("insertAside", () => {
        it("goes before the block that holds the caret, wrapped at the right", () => {
            for (const text of [ "[]Text", "Te[]xt", "Text[]" ]) {
                setModelData(editor.model, paragraph("Before") + paragraph(text));

                editor.execute("insertAside");

                expect(getModelData(editor.model), text).toBe(
                    paragraph("Before") + aside(paragraph("[]")) + paragraph("Text"));
            }
        });

        it("replaces an empty block, and joins the list item of the block it goes before", () => {
            setModelData(editor.model, paragraph("Before") + paragraph("[]"));
            editor.execute("insertAside");
            expect(getModelData(editor.model)).toBe(paragraph("Before") + aside(paragraph("[]")));

            const listAttributes = " listIndent=\"0\" listItemId=\"a\" listType=\"bulleted\"";
            setModelData(editor.model, `<paragraph${listAttributes}>It[]em</paragraph>`);
            editor.execute("insertAside");
            expect(getModelData(editor.model)).toBe(
                aside(paragraph("[]"), ` backgroundColor="#555555"${listAttributes}${WRAPPED}`) +
                `<paragraph${listAttributes}>Item</paragraph>`);
        });

        it("moves selected text, blocks and objects into the aside, in their place", () => {
            setModelData(editor.model, paragraph("Keep [moved] text"));
            editor.execute("insertAside");
            expect(getModelData(editor.model)).toBe(
                paragraph("Keep ") + aside(paragraph("moved[]")) + paragraph(" text"));

            setModelData(editor.model, `[${paragraph("One")}${TABLE}]${paragraph("After")}`);
            editor.execute("insertAside");
            expect(getModelData(editor.model, { withoutSelection: true }))
                .toBe(aside(paragraph("One") + TABLE) + paragraph("After"));
        });

        it("leaves the blocks of a selected aside in the new one", () => {
            setModelData(editor.model, `[${paragraph("A")}${aside(paragraph("B"), "")}]`);

            editor.execute("insertAside");

            expect(getModelData(editor.model, { withoutSelection: true }))
                .toBe(aside(paragraph("A") + paragraph("B")));
        });

        it("is disabled in an aside, on one and where no block can go", () => {
            setModelData(editor.model, paragraph("[]"));
            expect(isEnabled("insertAside")).toBe(true);

            setModelData(editor.model, aside(paragraph("[]")));
            expect(isEnabled("insertAside")).toBe(false);

            setModelData(editor.model, `[${aside(paragraph(""))}]`);
            expect(isEnabled("insertAside")).toBe(false);

            setModelData(editor.model, paragraph("[]"));
            editor.enableReadOnlyMode("spec");
            expect(isEnabled("insertAside")).toBe(false);
        });

        it("is one undo step", () => {
            setModelData(editor.model, paragraph("Keep [moved] text"));
            const before = editor.getData();

            editor.execute("insertAside");
            editor.execute("undo");

            expect(editor.getData()).toBe(before);
        });
    });

    describe("removeAside", () => {
        it("replaces the aside with its blocks, from inside it or with it selected", () => {
            setModelData(editor.model,
                paragraph("Before") + aside(paragraph("A[]") + paragraph("B")));
            expect(isEnabled("removeAside")).toBe(true);
            editor.execute("removeAside");
            expect(getModelData(editor.model))
                .toBe(paragraph("Before") + paragraph("A[]") + paragraph("B"));
            expect(isEnabled("removeAside")).toBe(false);

            setModelData(editor.model, `[${aside(paragraph("A"))}]${paragraph("After")}`);
            editor.execute("removeAside");
            expect(getModelData(editor.model, { withoutSelection: true }))
                .toBe(paragraph("A") + paragraph("After"));
        });

        it("is one undo step", () => {
            setModelData(editor.model, aside(paragraph("A[]") + paragraph("B")));
            const before = editor.getData();

            editor.execute("removeAside");
            editor.execute("undo");

            expect(editor.getData()).toBe(before);
        });
    });

    it("sets the position of an aside in one undo step", () => {
        setModelData(editor.model, `[${aside(paragraph("A"), WRAPPED)}]`);
        const command = editor.commands.get("asidePosition");
        expect([ command?.isEnabled, command?.value ]).toEqual([ true, "wrap-right" ]);

        editor.execute("asidePosition", { value: "center" });
        expect(editor.getData()).toBe("<aside><p>A</p></aside>");

        editor.execute("undo");
        expect(editor.getData()).toBe("<aside data-position=\"wrap-right\"><p>A</p></aside>");
    });

    describe("asideColor", () => {
        function getCommand() {
            const command = editor.commands.get("asideColor");
            if (!command) {
                throw new Error("The aside plugin registers no asideColor command.");
            }
            return command;
        }

        it("sets and removes the color of the aside, from inside it or with it selected", () => {
            setModelData(editor.model, aside(paragraph("A[]")));
            const command = getCommand();
            expect([ command.isEnabled, command.value ]).toEqual([ true, "#555555" ]);

            editor.execute("asideColor", { value: "#e64d4d" });
            expect(getModelData(editor.model))
                .toBe(aside(paragraph("A[]"), ` backgroundColor="#e64d4d"${WRAPPED}`));
            expect(command.value).toBe("#e64d4d");

            // The Remove color button of the dropdown.
            editor.execute("asideColor", { value: null });
            expect(getModelData(editor.model)).toBe(aside(paragraph("A[]"), WRAPPED));
            expect(command.value).toBeUndefined();

            setModelData(editor.model, `[${aside(paragraph("A"), WRAPPED)}]`);
            editor.execute("asideColor", { value: "#4d99e6" });
            expect(getModelData(editor.model, { withoutSelection: true }))
                .toBe(aside(paragraph("A"), ` backgroundColor="#4d99e6"${WRAPPED}`));
        });

        it("is disabled outside an aside", () => {
            setModelData(editor.model, paragraph("[]") + aside(paragraph("A")));
            expect(getCommand().isEnabled).toBe(false);
        });

        it("is one undo step, also for the colors the picker sets in one batch", () => {
            setModelData(editor.model, aside(paragraph("A[]")));
            const command = getCommand();
            editor.execute("asideColor", { value: "#e64d4d" });
            editor.execute("undo");
            expect(command.value).toBe("#555555");

            const batch = editor.model.createBatch();
            editor.execute("asideColor", { value: "#e64d4d", batch });
            editor.execute("asideColor", { value: "#4d99e6", batch });
            expect(command.value).toBe("#4d99e6");
            editor.execute("undo");
            expect(command.value).toBe("#555555");
        });
    });
});
