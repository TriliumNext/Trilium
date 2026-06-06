import { act } from "preact/test-utils";
import type { CellComponent, ColumnDefinition } from "tabulator-tables";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the imports) ----------------------------------------------------

vi.mock("../../react/NoteAutocomplete", () => ({
    default: ({ noteId }: { noteId?: string }) => (
        <div className="input-group">
            <input className="note-autocomplete form-control" data-note-id={noteId ?? ""} />
        </div>
    )
}));

import froca from "../../../services/froca";
import { buildNote } from "../../../test/easy-froca";
import { flush, resetFroca } from "../../../test/render";
import { buildColumnDefinitions, restoreExistingData } from "./columns";

// --- Helpers -------------------------------------------------------------------------------------

type FormatterFn = (cell: CellComponent, formatterParams: object, onRendered: () => void) => string | HTMLElement;
type EditorFn = (cell: CellComponent, onRendered: () => void, success: (v: unknown) => boolean, cancel: (v: unknown) => void, editorParams: object) => HTMLElement | false;

interface FakeRowData {
    noteId?: string;
    iconClass?: string;
    colorClass?: string;
}

function fakeCell(value: unknown, rowData: FakeRowData = {}, position = 1): CellComponent {
    const row = {
        getData: () => rowData,
        getPosition: (_active?: boolean) => position
    };
    return {
        getValue: () => value,
        getRow: () => row
    } as unknown as CellComponent;
}

/** Invoke a column's formatter and return the produced DOM element (or string). */
function runFormatter(def: ColumnDefinition | undefined, cell: CellComponent): HTMLElement | string {
    const fn = def?.formatter as FormatterFn | undefined;
    if (typeof fn !== "function") {
        throw new Error("Column has no callable formatter");
    }
    return fn(cell, def?.formatterParams ?? {}, () => {});
}

function asElement(result: HTMLElement | string): HTMLElement {
    if (typeof result === "string") {
        throw new Error(`Expected an element, got string: ${result}`);
    }
    return result;
}

function findField(defs: ColumnDefinition[], field: string): ColumnDefinition | undefined {
    return defs.find((d) => d.field === field);
}

beforeEach(() => {
    resetFroca();
    vi.clearAllMocks();
});

afterEach(() => {
    resetFroca();
});

// --- buildColumnDefinitions: base columns --------------------------------------------------------

describe("buildColumnDefinitions - base columns", () => {
    it("always emits the index, noteId and title columns first", () => {
        const defs = buildColumnDefinitions({
            info: [],
            movableRows: false,
            existingColumnData: undefined,
            rowNumberHint: 5
        });

        expect(defs).toHaveLength(3);
        expect(defs[0].title).toBe("#");
        expect(defs[0].frozen).toBe(true);
        expect(defs[0].rowHandle).toBe(false);
        expect(findField(defs, "noteId")?.visible).toBe(false);
        expect(findField(defs, "title")?.width).toBe(400);
    });

    it("enables the row handle and adds width for movable rows", () => {
        const notMovable = buildColumnDefinitions({ info: [], movableRows: false, existingColumnData: undefined, rowNumberHint: 9 });
        const movable = buildColumnDefinitions({ info: [], movableRows: true, existingColumnData: undefined, rowNumberHint: 9 });

        expect(notMovable[0].rowHandle).toBe(false);
        expect(movable[0].rowHandle).toBe(true);
        // single-digit hint => 16px; movable adds 32px.
        expect(notMovable[0].width).toBe(16);
        expect(movable[0].width).toBe(48);
    });

    it("scales the index column width with the number of digits", () => {
        const threeDigits = buildColumnDefinitions({ info: [], movableRows: false, existingColumnData: undefined, rowNumberHint: 100 });
        expect(threeDigits[0].width).toBe(48); // 16 * 3
    });
});

// --- buildColumnDefinitions: attribute columns ---------------------------------------------------

describe("buildColumnDefinitions - attribute columns", () => {
    it("appends a label column with the mapped editor/formatter and a falls-back title", () => {
        const defs = buildColumnDefinitions({
            info: [{ name: "myLabel", type: "number" }],
            movableRows: false,
            existingColumnData: undefined,
            rowNumberHint: 1
        });

        const col = findField(defs, "labels.myLabel");
        expect(col).toBeDefined();
        expect(col?.title).toBe("myLabel"); // falls back to name
        expect(col?.rowHandle).toBe(false);
        expect(col?.editor).toBe("number"); // from number mapping
        expect(col?.sorter).toBe("number");
    });

    it("uses the provided title and the relations prefix for relation columns", () => {
        const defs = buildColumnDefinitions({
            info: [{ name: "rel", title: "My Relation", type: "relation" }],
            movableRows: false,
            existingColumnData: undefined,
            rowNumberHint: 1
        });

        const col = findField(defs, "relations.rel");
        expect(col?.title).toBe("My Relation");
        expect(typeof col?.editor).toBe("function");
        expect(typeof col?.formatter).toBe("function");
    });

    it("defaults to the text mapping when no type is given", () => {
        const defs = buildColumnDefinitions({
            info: [{ name: "plain" }],
            movableRows: false,
            existingColumnData: undefined,
            rowNumberHint: 1
        });

        const col = findField(defs, "labels.plain");
        expect(col?.editor).toBe("input");
    });

    it("deduplicates repeated fields", () => {
        const defs = buildColumnDefinitions({
            info: [
                { name: "dup", type: "text" },
                { name: "dup", type: "number" }
            ],
            movableRows: false,
            existingColumnData: undefined,
            rowNumberHint: 1
        });

        const matches = defs.filter((d) => d.field === "labels.dup");
        expect(matches).toHaveLength(1);
        // First definition wins.
        expect(matches[0].editor).toBe("input");
    });

    it("covers every label-type mapping branch", () => {
        const types = ["text", "textarea", "boolean", "date", "datetime", "number", "time", "url", "color"] as const;
        const defs = buildColumnDefinitions({
            info: types.map((type) => ({ name: type, type })),
            movableRows: false,
            existingColumnData: undefined,
            rowNumberHint: 1
        });

        for (const type of types) {
            expect(findField(defs, `labels.${type}`)).toBeDefined();
        }
        expect(findField(defs, "labels.textarea")?.formatter).toBe("textarea");
        expect(findField(defs, "labels.boolean")?.editor).toBe("tickCross");
        expect(findField(defs, "labels.url")?.formatter).toBe("link");
        expect(findField(defs, "labels.color")?.formatter).toBe("color");
    });
});

// --- Inline formatters (index / noteId / title) --------------------------------------------------

describe("buildColumnDefinitions - inline formatters", () => {
    it("renders the row position, with a drag handle only when movable", () => {
        const movable = buildColumnDefinitions({ info: [], movableRows: true, existingColumnData: undefined, rowNumberHint: 1 });
        const notMovable = buildColumnDefinitions({ info: [], movableRows: false, existingColumnData: undefined, rowNumberHint: 1 });

        const movableEl = asElement(runFormatter(movable[0], fakeCell(null, {}, 3)));
        expect(movableEl.textContent).toContain("3");
        expect(movableEl.querySelector(".bx-dots-vertical-rounded")).not.toBeNull();

        const plainEl = asElement(runFormatter(notMovable[0], fakeCell(null, {}, 7)));
        expect(plainEl.textContent).toContain("7");
        expect(plainEl.querySelector(".bx-dots-vertical-rounded")).toBeNull();
    });

    it("renders the noteId inside a <code> element", () => {
        const defs = buildColumnDefinitions({ info: [], movableRows: false, existingColumnData: undefined, rowNumberHint: 1 });
        const el = asElement(runFormatter(findField(defs, "noteId"), fakeCell("abc123")));
        expect(el.tagName.toLowerCase()).toBe("code");
        expect(el.textContent).toBe("abc123");
    });

    it("renders the title as a reference link with the row's icon and color classes", () => {
        const defs = buildColumnDefinitions({ info: [], movableRows: false, existingColumnData: undefined, rowNumberHint: 1 });
        const el = asElement(runFormatter(findField(defs, "title"), fakeCell("Hello", { noteId: "note1", iconClass: "bx bx-file", colorClass: "color-red" })));

        expect(el.className).toContain("reference-link");
        expect(el.className).toContain("color-red");
        expect(el.getAttribute("data-href")).toBe("#root/note1");
        expect(el.textContent).toContain("Hello");
        expect(el.querySelector(".bx-file")).not.toBeNull();
    });
});

// --- NoteFormatter (relation column formatter) ---------------------------------------------------

describe("buildColumnDefinitions - relation NoteFormatter", () => {
    function relationFormatterColumn() {
        const defs = buildColumnDefinitions({
            info: [{ name: "rel", type: "relation" }],
            movableRows: false,
            existingColumnData: undefined,
            rowNumberHint: 1
        });
        return findField(defs, "relations.rel");
    }

    it("renders an empty reference link when there is no target note id", () => {
        const el = asElement(runFormatter(relationFormatterColumn(), fakeCell(null)));
        expect(el.className).toContain("reference-link");
        expect(el.getAttribute("data-href")).toBe("#root/null");
        // No icon/title since note is null.
        expect(el.querySelector(".tn-icon")).toBeNull();
        expect(el.textContent?.trim()).toBe("");
    });

    it("renders the target note's icon and title when it is already cached", () => {
        const target = buildNote({ id: "target1", title: "Target Note" });
        const getFromCache = vi.spyOn(froca, "getNoteFromCache").mockReturnValue(target);

        const el = asElement(runFormatter(relationFormatterColumn(), fakeCell("target1")));

        expect(getFromCache).toHaveBeenCalledWith("target1");
        expect(el.getAttribute("data-href")).toBe("#root/target1");
        expect(el.textContent).toContain("Target Note");
        expect(el.querySelector(".tn-icon")).not.toBeNull();
    });

    it("falls back to fetching the note asynchronously when it is not cached", async () => {
        const target = buildNote({ id: "target2", title: "Async Target" });
        vi.spyOn(froca, "getNoteFromCache").mockReturnValue(undefined);
        const getNote = vi.spyOn(froca, "getNote").mockResolvedValue(target);

        let el: HTMLElement | undefined;
        await act(async () => {
            el = asElement(runFormatter(relationFormatterColumn(), fakeCell("target2")));
        });
        // Initially no note is rendered (cache miss).
        expect(el?.querySelector(".tn-icon")).toBeNull();

        // The effect that fetches the note runs on a deferred microtask/timer.
        await flush();
        expect(getNote).toHaveBeenCalledWith("target2");
    });
});

// --- RelationEditor (relation column editor) -----------------------------------------------------

describe("buildColumnDefinitions - relation RelationEditor", () => {
    function relationEditorColumn() {
        const defs = buildColumnDefinitions({
            info: [{ name: "rel", type: "relation" }],
            movableRows: false,
            existingColumnData: undefined,
            rowNumberHint: 1
        });
        return findField(defs, "relations.rel");
    }

    it("produces a NoteAutocomplete input element for editing", () => {
        const col = relationEditorColumn();
        const editor = col?.editor as EditorFn | undefined;
        expect(typeof editor).toBe("function");
        if (typeof editor !== "function") return;

        const success = vi.fn(() => true);
        const cancel = vi.fn();
        const el = editor(fakeCell(""), () => {}, success, cancel, {});

        expect(el).not.toBe(false);
        if (el === false) return;
        expect(el.querySelector("input.note-autocomplete")).not.toBeNull();
    });
});

// --- restoreExistingData -------------------------------------------------------------------------

describe("restoreExistingData", () => {
    function makeNewDefs(): ColumnDefinition[] {
        return [
            { title: "#", field: undefined },
            { field: "title", title: "Title" },
            { field: "labels.a", title: "A" },
            { field: "labels.b", title: "B" }
        ];
    }

    it("restores width and visibility from old definitions and keeps order", () => {
        const oldDefs: ColumnDefinition[] = [
            { title: "#" },
            { field: "labels.b", title: "B", width: 222, visible: false },
            { field: "title", title: "Title", width: 333 }
        ];

        const result = restoreExistingData(makeNewDefs(), oldDefs);

        // Existing columns first (in the old order), then the brand-new "labels.a".
        const fields = result.map((d) => d.field);
        expect(fields).toEqual([undefined, "labels.b", "title", "labels.a"]);
        expect(findField(result, "labels.b")?.width).toBe(222);
        expect(findField(result, "labels.b")?.visible).toBe(false);
        expect(findField(result, "title")?.width).toBe(333);
    });

    it("does not override width when the old column was non-resizable", () => {
        const oldDefs: ColumnDefinition[] = [
            { title: "#" },
            { field: "title", title: "Title", width: 999, resizable: false }
        ];
        const result = restoreExistingData(makeNewDefs(), oldDefs);
        // resizable === false => width is NOT copied, keeps the new default (undefined).
        expect(findField(result, "title")?.width).toBeUndefined();
    });

    it("inserts new columns at a clamped position", () => {
        const oldDefs: ColumnDefinition[] = [
            { title: "#" },
            { field: "title", title: "Title" }
        ];
        // newDefs adds labels.a and labels.b which are absent from oldDefs.
        const atZero = restoreExistingData(makeNewDefs(), oldDefs, 0);
        expect(atZero.map((d) => d.field)).toEqual(["labels.a", "labels.b", undefined, "title"]);

        const wayPastEnd = restoreExistingData(makeNewDefs(), oldDefs, 999);
        expect(wayPastEnd.map((d) => d.field)).toEqual([undefined, "title", "labels.a", "labels.b"]);

        const negative = restoreExistingData(makeNewDefs(), oldDefs, -5);
        expect(negative.map((d) => d.field)).toEqual(["labels.a", "labels.b", undefined, "title"]);
    });

    it("defaults the insert position to the end when none is provided", () => {
        const oldDefs: ColumnDefinition[] = [
            { title: "#" },
            { field: "title", title: "Title" }
        ];
        const result = restoreExistingData(makeNewDefs(), oldDefs);
        expect(result.map((d) => d.field)).toEqual([undefined, "title", "labels.a", "labels.b"]);
    });

    it("is reachable through buildColumnDefinitions when existingColumnData is supplied", () => {
        const existing: ColumnDefinition[] = [
            { title: "#" },
            { field: "noteId", title: "Note ID", visible: true },
            { field: "title", title: "Title", width: 500 }
        ];
        const defs = buildColumnDefinitions({
            info: [{ name: "extra", type: "text" }],
            movableRows: false,
            existingColumnData: existing,
            rowNumberHint: 1,
            position: 1
        });

        expect(findField(defs, "title")?.width).toBe(500);
        expect(findField(defs, "noteId")?.visible).toBe(true);
        expect(findField(defs, "labels.extra")).toBeDefined();
    });
});
