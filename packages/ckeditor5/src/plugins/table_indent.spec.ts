import { _getModelData as getModelData, _setModelData as setModelData, ClassicEditor, Essentials, Indent, IndentBlock, Paragraph, Table, TableEditing } from "ckeditor5";
import { beforeEach, describe, expect, it } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import TableIndent from "./table_indent.js";

const TABLE = "<table><tableRow><tableCell><paragraph>foo</paragraph></tableCell></tableRow></table>";

describe("TableIndent", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createTestEditor([Essentials, Paragraph, Indent, IndentBlock, Table, TableEditing, TableIndent]);
    });

    it("loads the plugin", () => {
        expect(editor.plugins.get(TableIndent)).toBeInstanceOf(TableIndent);
    });

    it("allows the blockIndent attribute on the table element", () => {
        expect(editor.model.schema.checkAttribute(["$root", "table"], "blockIndent")).toBe(true);
    });

    it("enables indentBlock when a table is selected", () => {
        setModelData(editor.model, `[${TABLE}]`);

        expect(editor.commands.get("indentBlock")?.isEnabled).toBe(true);
    });

    it("indents and outdents a selected table by the configured offset", () => {
        setModelData(editor.model, `[${TABLE}]`);

        editor.execute("indentBlock");
        expect(getModelData(editor.model)).toContain('blockIndent="40px"');

        editor.execute("outdentBlock");
        expect(getModelData(editor.model)).not.toContain("blockIndent");
    });

    it("round-trips the indentation as a margin-left on the table figure", () => {
        setModelData(editor.model, `[${TABLE}]`);
        editor.execute("indentBlock");

        const data = editor.getData();
        expect(data).toContain("margin-left:40px");

        editor.setData(data);
        expect(getModelData(editor.model)).toContain('blockIndent="40px"');
    });

    it("caps the table width by the indent so it stays within its parent", () => {
        setModelData(editor.model, `[${TABLE}]`);
        editor.execute("indentBlock");

        // margin-left + max-width land on the same element, so the indented table cannot overflow.
        const data = editor.getData();
        expect(data).toContain("margin-left:40px");
        expect(data).toContain("max-width:calc(100% - 40px)");

        // Outdenting back to zero removes both the offset and the width cap.
        editor.execute("outdentBlock");
        expect(editor.getData()).not.toContain("max-width");
    });
});
