import {
    _getModelData as getModelData, _ListItemUid as ListItemUid, _setModelData as setModelData,
    type ClassicEditor, List, ListProperties, Paragraph, TodoList, Undo
} from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import ListItemInsert from "./list_item_insert.js";

/** A list block of item `id`, at `indent`. */
function item(id: string, indent: number, type: string, text: string) {
    return `<paragraph listIndent="${indent}" listItemId="${id}" listType="${type}">`
        + `${text}</paragraph>`;
}

const A = item("a", 0, "bulleted", "A");
const A2 = item("a", 0, "bulleted", "A2");
const B = item("b", 1, "numbered", "B");
const C = item("c", 0, "bulleted", "C");

describe("ListItemInsert", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createTestEditor([ Paragraph, List, TodoList, Undo, ListItemInsert ]);
        vi.spyOn(ListItemUid, "next").mockReturnValue("new");
    });

    it("inserts an item above the item, below its nested items, or as its first child", () => {
        const cases = [
            [ "triliumInsertListItemAbove", [ item("new", 0, "bulleted", "[]"), A, A2, B, C ] ],
            [ "triliumInsertListItemBelow", [ A, A2, B, item("new", 0, "bulleted", "[]"), C ] ],
            [ "triliumInsertChildListItem", [ A, A2, item("new", 1, "numbered", "[]"), B, C ] ]
        ] as const;

        for (const [ command, expected ] of cases) {
            setModelData(editor.model, [ A, A2.replace("A2", "A2[]"), B, C ].join(""));
            expect(editor.commands.get(command)?.isEnabled).toBe(true);
            editor.execute(command);
            expect(getModelData(editor.model)).toBe(expected.join(""));
        }

        setModelData(editor.model, [ A, B, A2.replace("A2", "A2[]"), C ].join(""));
        editor.execute("triliumInsertChildListItem");
        expect(getModelData(editor.model))
            .toBe([ A, item("new", 1, "numbered", "[]"), B, A2, C ].join(""));
    });

    it("gives a first nested item the type of its item, and leaves a new to-do unchecked", () => {
        const todo = "<paragraph listIndent=\"0\" listItemId=\"t\" listType=\"todo\" "
            + "todoListChecked=\"true\">T[]</paragraph>";

        const unselected = todo.replace("T[]", "T");

        setModelData(editor.model, todo);
        editor.execute("triliumInsertChildListItem");
        expect(getModelData(editor.model)).toBe(unselected + item("new", 1, "todo", "[]"));

        setModelData(editor.model, todo);
        editor.execute("triliumInsertListItemBelow");
        expect(getModelData(editor.model)).toBe(unselected + item("new", 0, "todo", "[]"));
    });

    it("goes by the first selected block above, the last one below, and needs a list item", () => {
        const enabled = () => [
            "triliumInsertListItemAbove", "triliumInsertListItemBelow", "triliumInsertChildListItem"
        ].map((command) => editor.commands.get(command)?.isEnabled);

        setModelData(editor.model, `<paragraph>[x</paragraph>${A.replace("A<", "A]<")}`);
        expect(enabled()).toEqual([ false, true, true ]);

        setModelData(editor.model, `${A.replace("A<", "[A<")}<paragraph>x]</paragraph>`);
        expect(enabled()).toEqual([ true, false, false ]);
    });

    it("keeps the style, start and order of the list that the new item joins", async () => {
        editor = await createTestEditor([ Paragraph, List, ListProperties, ListItemInsert ], {
            list: { properties: { styles: true, startIndex: true, reversed: true } }
        });
        setModelData(editor.model, "<paragraph listIndent=\"0\" listItemId=\"a\" "
            + "listReversed=\"true\" listStart=\"3\" listStyle=\"upper-roman\" "
            + "listType=\"numbered\">[]a</paragraph>");

        editor.execute("triliumInsertListItemAbove");
        expect(editor.getData()).toBe("<ol style=\"list-style-type:upper-roman;\" "
            + "reversed=\"reversed\" start=\"3\"><li data-list-item-id=\"new\">&nbsp;</li>"
            + "<li data-list-item-id=\"a\">a</li></ol>");
    });
});
