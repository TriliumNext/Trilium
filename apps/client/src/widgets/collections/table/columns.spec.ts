import { describe, expect, it } from "vitest";
import { restoreExistingData } from "./columns";
import type { ColumnDefinition } from "tabulator-tables";

describe("restoreExistingData", () => {
    it("maintains important columns properties", () => {
        const newDefs: ColumnDefinition[] = [
            { field: "title", title: "Title", editor: "input" },
            { field: "noteId", title: "Note ID", formatter: "color", visible: false }
        ];
        const oldDefs: ColumnDefinition[] = [
            { field: "title", title: "Title", width: 300, visible: true },
            { field: "noteId", title: "Note ID", width: 200, visible: true }
        ];
        const restored = restoreExistingData(newDefs, oldDefs);
        expect(restored[0].editor).toBe("input");
        expect(restored[1].formatter).toBe("color");
    });

    it("should restore existing column data", () => {
        const newDefs: ColumnDefinition[] = [
            { field: "title", title: "Title", editor: "input" },
            { field: "noteId", title: "Note ID", visible: false }
        ];
        const oldDefs: ColumnDefinition[] = [
            { field: "title", title: "Title", width: 300, visible: true },
            { field: "noteId", title: "Note ID", width: 200, visible: true }
        ];
        const restored = restoreExistingData(newDefs, oldDefs);
        expect(restored[0].width).toBe(300);
        expect(restored[1].width).toBe(200);
    });

    it("restores order of columns", () => {
        const newDefs: ColumnDefinition[] = [
            { field: "title", title: "Title", editor: "input" },
            { field: "noteId", title: "Note ID", visible: false }
        ];
        const oldDefs: ColumnDefinition[] = [
            { field: "noteId", title: "Note ID", width: 200, visible: true },
            { field: "title", title: "Title", width: 300, visible: true }
        ];
        const restored = restoreExistingData(newDefs, oldDefs);
        expect(restored[0].field).toBe("noteId");
        expect(restored[1].field).toBe("title");
    });

    it("inserts new columns at given position", () => {
        const newDefs: ColumnDefinition[] = [
            { field: "title", title: "Title", editor: "input" },
            { field: "noteId", title: "Note ID", visible: false },
            { field: "newColumn", title: "New Column", editor: "input" }
        ];
        const oldDefs: ColumnDefinition[] = [
            { field: "title", title: "Title", width: 300, visible: true },
            { field: "noteId", title: "Note ID", width: 200, visible: true }
        ];
        const restored = restoreExistingData(newDefs, oldDefs, 0);
        expect(restored.length).toBe(3);
        expect(restored[0].field).toBe("newColumn");
        expect(restored[1].field).toBe("title");
        expect(restored[2].field).toBe("noteId");
    });

    it("inserts new columns at the end if no position is specified", () => {
        const newDefs: ColumnDefinition[] = [
            { field: "title", title: "Title", editor: "input" },
            { field: "noteId", title: "Note ID", visible: false },
            { field: "newColumn", title: "New Column", editor: "input" }
        ];
        const oldDefs: ColumnDefinition[] = [
            { field: "title", title: "Title", width: 300, visible: true },
            { field: "noteId", title: "Note ID", width: 200, visible: true }
        ];
        const restored = restoreExistingData(newDefs, oldDefs);
        expect(restored.length).toBe(3);
        expect(restored[0].field).toBe("title");
        expect(restored[1].field).toBe("noteId");
        expect(restored[2].field).toBe("newColumn");
    });

    it("supports a rename", () => {
        const newDefs: ColumnDefinition[] = [
            { field: "title", title: "Title", editor: "input" },
            { field: "noteId", title: "Note ID", visible: false },
            { field: "newColumn", title: "New Column", editor: "input" }
        ];
        const oldDefs: ColumnDefinition[] = [
            { field: "title", title: "Title", width: 300, visible: true },
            { field: "noteId", title: "Note ID", width: 200, visible: true },
            { field: "oldColumn", title: "New Column", editor: "input" }
        ];
        const restored = restoreExistingData(newDefs, oldDefs);
        expect(restored.length).toBe(3);
    });

    it("doesn't alter the existing order", () => {
        const newDefs: ColumnDefinition[] = [
            { title: "#", headerSort: false, hozAlign: "center", resizable: false, frozen: true, rowHandle: false },
            { field: "noteId", title: "Note ID", visible: false },
            { field: "title", title: "Title", editor: "input", width: 400 }
        ]
        const oldDefs: ColumnDefinition[] = [
            { title: "#", headerSort: false, hozAlign: "center", resizable: false, rowHandle: false },
            { field: "noteId", title: "Note ID", visible: false },
            { field: "title", title: "Title", editor: "input", width: 400 }
        ];
        const restored = restoreExistingData(newDefs, oldDefs);
        expect(restored).toStrictEqual(newDefs);
    });

    it("allows hiding the row number column", () => {
        const newDefs: ColumnDefinition[] = [
            { title: "#", headerSort: false, hozAlign: "center", resizable: false, frozen: true, rowHandle: false },
        ]
        const oldDefs: ColumnDefinition[] = [
            { title: "#", headerSort: false, hozAlign: "center", resizable: false, rowHandle: false, visible: false },
        ];
        const restored = restoreExistingData(newDefs, oldDefs);
        expect(restored[0].visible).toStrictEqual(false);
    });

    it("enforces size for non-resizable columns", () => {
        const newDefs: ColumnDefinition[] = [
            { title: "#", resizable: false, width: "100px" },
        ]
        const oldDefs: ColumnDefinition[] = [
            { title: "#", resizable: false, width: "120px" },
        ];
        const restored = restoreExistingData(newDefs, oldDefs);
        expect(restored[0].width).toStrictEqual("100px");
    });
});
