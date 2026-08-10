import { act } from "preact/test-utils";
import type { CellComponent, ColumnComponent, ColumnDefinition, RowComponent } from "tabulator-tables";
import { describe, expect, it, vi } from "vitest";

// A relation's target is picked in an Algolia autocomplete bound to jQuery, which is not loaded
// here; the mock hands the test the props, `noteIdChanged` being what an editor's behaviour hangs off.
const autocomplete = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
vi.mock("../../react/NoteAutocomplete", async () => {
    const { h } = await import("preact");
    return {
        default: (props: Record<string, unknown>) => {
            autocomplete.current = props;
            return h("input", { className: "note-autocomplete-stub" });
        }
    };
});

import options from "../../../services/options";
import { buildNote } from "../../../test/easy-froca";
import { formatLabelDate } from "../../attribute_widgets/label_value_display";
import { type AttributeDefinitionInformation, buildColumnDefinitions, restoreExistingData, type ValuesEditorParams } from "./columns";

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
        ];
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
        ];
        const oldDefs: ColumnDefinition[] = [
            { title: "#", headerSort: false, hozAlign: "center", resizable: false, rowHandle: false, visible: false },
        ];
        const restored = restoreExistingData(newDefs, oldDefs);
        expect(restored[0].visible).toStrictEqual(false);
    });

    it("enforces size for non-resizable columns", () => {
        const newDefs: ColumnDefinition[] = [
            { title: "#", resizable: false, width: "100px" },
        ];
        const oldDefs: ColumnDefinition[] = [
            { title: "#", resizable: false, width: "120px" },
        ];
        const restored = restoreExistingData(newDefs, oldDefs);
        expect(restored[0].width).toStrictEqual("100px");
    });
});

describe("buildColumnDefinitions — typed columns", () => {
    it("edits every temporal type through its native picker, as the promoted field does", () => {
        const columns = buildColumnDefinitions({
            info: [
                { name: "date", type: "date" },
                { name: "datetime", type: "datetime" },
                { name: "time", type: "time" }
            ],
            movableRows: false,
            existingColumnData: undefined,
            rowNumberHint: 1
        });
        const editorOf = (name: string) => columns.find((column) => column.field === `labels.${name}`)?.editor;

        expect(editorOf("date")).toBe("date");
        expect(editorOf("datetime")).toBe("datetime");
        // A plain input here would be a text box to type "14:05" into by hand.
        expect(editorOf("time")).toBe("time");
    });

    it("hands a url column's href through the scheme guard rather than linking the value as stored", () => {
        const column = buildColumnDefinitions({
            info: [ { name: "site", type: "url" } ],
            movableRows: false,
            existingColumnData: undefined,
            rowNumberHint: 1
        }).find((column) => column.field === "labels.site");

        // Tabulator's link formatter assigns whatever it is given straight to the anchor's href.
        const url = (column?.formatterParams as { url?: (cell: CellComponent) => string })?.url;
        if (typeof url !== "function") throw new Error("expected the href to be built by a callback");
        expect(url({ getValue: () => "javascript:alert(1)" } as CellComponent)).toBe("about:blank");
        expect(url({ getValue: () => "https://example.com" } as CellComponent)).toBe("https://example.com");
    });

    it("shows a single flag as the chip a set of flags wears, and an unset cell as nothing", () => {
        const [ column ] = buildColumnDefinitions({
            info: [ { name: "done", type: "boolean" } ],
            movableRows: false,
            existingColumnData: undefined,
            rowNumberHint: 1
        }).filter((candidate) => candidate.field === "labels.done");

        const formatter = column?.formatter;
        if (typeof formatter !== "function") throw new Error("expected a formatter of its own");
        const format = (value: unknown) =>
            formatter({ getValue: () => value } as CellComponent, {}, () => {}) as HTMLElement;

        // A stored label holds the text "true", a value fresh from the tickCross editor a real
        // boolean; either reads as the one chip, washed with its answer.
        for (const set of [ "true", true ]) {
            expect(format(set).querySelector(".tn-chip")?.className).toContain("label-flag-chip-set");
            expect(format(set).querySelector(".tn-icon")?.getAttribute("title")).toBe("true");
        }
        expect(format(false).querySelector(".tn-chip")?.className).toContain("label-flag-chip-unset");

        // An unset cell holds no flag at all, so it wears no chip either.
        for (const empty of [ "", undefined, null ]) {
            expect(format(empty).querySelector(".tn-chip")).toBeNull();
        }
    });
});

describe("buildColumnDefinitions — relation columns", () => {
    function relationColumn(isMulti: boolean) {
        return buildColumnDefinitions({
            info: [ { name: "assignee", type: "relation", isMulti } ],
            movableRows: false,
            existingColumnData: undefined,
            rowNumberHint: 1
        }).find((column) => column.field === "relations.assignee");
    }

    function rowTitled(title: string | undefined) {
        return { getData: () => ({ relationTitles: title === undefined ? undefined : { assignee: title } }) } as unknown as RowComponent;
    }

    it("sorts by the title the cell shows, and by nothing where a row or the column carries none", () => {
        const sorter = relationColumn(false)?.sorter;
        if (typeof sorter !== "function") throw new Error("expected a sorter of its own");
        const column = { getField: () => "relations.assignee" } as ColumnComponent;

        expect(sorter("b-id", "a-id", rowTitled("Alpha"), rowTitled("Beta"), column, "asc", {})).toBeLessThan(0);
        // A row without the relation sorts as nothing rather than by an id the user never sees.
        expect(sorter("b-id", "", rowTitled("Alpha"), rowTitled(undefined), column, "asc", {})).toBeGreaterThan(0);
        // A column that lost its field has no titles to read, which is not a reason to throw.
        expect(sorter("a", "b", rowTitled("Alpha"), rowTitled("Beta"), { getField: () => undefined } as unknown as ColumnComponent, "asc", {})).toBe(0);
    });

    it("shows a set of targets as the chips naming their notes", async () => {
        const alpha = buildNote({ title: "Alpha" });
        const beta = buildNote({ title: "Beta" });
        const formatter = relationColumn(true)?.formatter;
        if (typeof formatter !== "function") throw new Error("expected a formatter of its own");

        let element: HTMLElement | undefined;
        await act(async () => {
            element = formatter({ getValue: () => [ alpha.noteId, beta.noteId ] } as CellComponent, { type: "relation" }, () => {}) as HTMLElement;
        });

        const chips = [ ...(element?.querySelectorAll(".label-value-chips .tn-chip") ?? []) ];
        expect(chips.map((chip) => chip.textContent?.trim())).toEqual([ "Alpha", "Beta" ]);
        // Named as the links a relation cell offers for its one target, not as bare text.
        expect(chips[0]?.querySelector(".reference-link")?.getAttribute("data-href")).toBe(`#root/${alpha.noteId}`);
    });

    it("edits a set of targets through the same field the note's own promoted grid offers", async () => {
        const editor = relationColumn(true)?.editor;
        if (typeof editor !== "function") throw new Error("expected an editor of its own");

        let element: HTMLElement | false = false;
        await act(async () => {
            element = editor(
                { getValue: () => [] } as unknown as CellComponent, () => {}, vi.fn(), () => {},
                { labelType: "relation", options: [], isMulti: true } satisfies Partial<ValuesEditorParams>
            );
        });

        expect((element as unknown as HTMLElement)?.querySelector(".relation-values-input")).not.toBeNull();
    });

    it("edits a single target through the note search, standing over the cell", async () => {
        const editor = relationColumn(false)?.editor;
        if (typeof editor !== "function") throw new Error("expected an editor of its own");

        const success = vi.fn();
        let element: HTMLElement | false = false;
        await act(async () => {
            element = editor({ getValue: () => "old-id" } as CellComponent, () => {}, success, () => {}, {});
        });

        expect((element as unknown as HTMLElement)?.querySelector(".note-autocomplete-stub")).not.toBeNull();
        expect(autocomplete.current?.noteId).toBe("old-id");
        // The pick is the whole of the edit, so reporting it ends the edit too.
        (autocomplete.current?.noteIdChanged as (noteId: string) => void)("new-id");
        expect(success).toHaveBeenCalledWith("new-id");
    });
});

describe("buildColumnDefinitions — colour columns", () => {
    /** Opens a colour cell's editor, as Tabulator does, and hands back what it built. */
    async function editColorCell(value: string | undefined) {
        const [ column ] = buildColumnDefinitions({
            info: [ { name: "tint", type: "color" } ],
            movableRows: false,
            existingColumnData: undefined,
            rowNumberHint: 1
        }).filter((candidate) => candidate.field === "labels.tint");

        const editor = column?.editor;
        if (typeof editor !== "function") throw new Error("expected an editor of its own");

        const success = vi.fn();
        let element: HTMLElement | false = false;
        await act(async () => {
            element = editor({ getValue: () => value } as CellComponent, () => {}, success, () => {}, {});
        });
        if (!element) throw new Error("expected the editor to build a field");
        return { element: element as HTMLElement, success };
    }

    it("reports the picked colour once the pick is settled, not through the drag", async () => {
        const { element, success } = await editColorCell("#ff0000");
        const picker = element.querySelector<HTMLInputElement>("input[type=color]");
        if (!picker) throw new Error("expected a colour picker");

        picker.value = "#00ff00";
        // Reporting ends the edit, so a colour reported as the picker is dragged through would tear
        // the editor down — and with it the open picker — at the first step.
        picker.dispatchEvent(new Event("input", { bubbles: true }));
        expect(success).not.toHaveBeenCalled();

        picker.dispatchEvent(new Event("change", { bubbles: true }));
        expect(success).toHaveBeenCalledWith("#00ff00");
    });

    it("clears a colour back to the unset value a bare picker cannot express", async () => {
        const { element, success } = await editColorCell("#ff0000");

        element.querySelector<HTMLElement>(".input-group-text")?.click();
        expect(success).toHaveBeenCalledWith("");
    });

    it("shows a colour as the chip a set of colours wears, and an unset one as nothing", () => {
        const [ column ] = buildColumnDefinitions({
            info: [ { name: "tint", type: "color" } ],
            movableRows: false,
            existingColumnData: undefined,
            rowNumberHint: 1
        }).filter((candidate) => candidate.field === "labels.tint");

        const formatter = column?.formatter;
        if (typeof formatter !== "function") throw new Error("expected a formatter of its own");
        const chipOf = (value: unknown) => (
            formatter({ getValue: () => value } as CellComponent, {}, () => {}) as HTMLElement
        ).querySelector<HTMLElement>(".label-color-chip");

        // A chip of the colour rather than a filled cell, which would paint over the row's own
        // striping, hover and selection.
        const chip = chipOf("#ff2e88");
        expect(chip?.style.backgroundColor).toBe("#ff2e88");
        expect(chip?.title).toBe("#ff2e88");

        // A cell holds whatever the label does: text naming no colour keeps the chip, whose ground
        // the browser refuses, and says what is stored where it can be read.
        expect(chipOf("nonsense")?.title).toBe("nonsense");

        // An unset cell holds no colour at all, so it wears no chip either.
        for (const empty of [ "", undefined, null ]) {
            expect(chipOf(empty)).toBeNull();
        }
    });

    it("leaves a cell alone until a colour is picked, an opened picker being no decision", async () => {
        // A colour input has no empty value, so it shows black over an unset cell; committing that on
        // the way out would fill in a colour nobody chose.
        const { element, success } = await editColorCell("");
        expect(element.querySelector<HTMLInputElement>("input[type=hidden]")?.value).toBe("");
        expect(success).not.toHaveBeenCalled();

        // A cell never written at all holds no value, which reads the same as one emptied.
        const unset = await editColorCell(undefined);
        expect(unset.element.querySelector<HTMLInputElement>("input[type=hidden]")?.value).toBe("");
    });
});

describe("buildColumnDefinitions — select columns", () => {
    /** Resolves the params a column hands its editor, which Tabulator asks for as a function. */
    function editorParamsOf(column: ColumnDefinition | undefined) {
        const params = column?.editorParams;
        if (typeof params !== "function") throw new Error("expected the params to be a function");
        return params({} as CellComponent) as ValuesEditorParams;
    }

    function selectColumn(
        onCreateSelectOption?: (columnName: string, option: string) => void,
        currentSelectOptions?: (columnName: string) => string[] | undefined
    ) {
        const columns = buildColumnDefinitions({
            info: [ { name: "status", type: "select", options: [ "Todo", "Done" ] } ],
            movableRows: false,
            existingColumnData: undefined,
            rowNumberHint: 1,
            onCreateSelectOption,
            currentSelectOptions
        });
        return columns.find((column) => column.field === "labels.status");
    }

    it("hands the editor the column's own options, and a way to add to them", () => {
        const onCreateSelectOption = vi.fn();
        const params = editorParamsOf(selectColumn(onCreateSelectOption));

        expect(params.options).toEqual([ "Todo", "Done" ]);

        // The editor knows the option alone; the column it belongs to is bound in here.
        params.onCreateOption?.("Blocked");
        expect(onCreateSelectOption).toHaveBeenCalledWith("status", "Blocked");
    });

    it("asks for the options as a cell is opened, so one just created is already among them", () => {
        // A cell can add an option to the definition, and the table does not rebuild its columns for
        // a change of its own — so a column built before that must not answer with what it was built
        // with, or the option would go missing until something else rebuilt the table.
        const currentSelectOptions = vi.fn(() => [ "Todo", "Done", "Blocked" ]);
        const params = editorParamsOf(selectColumn(undefined, currentSelectOptions));

        expect(params.options).toEqual([ "Todo", "Done", "Blocked" ]);
        expect(currentSelectOptions).toHaveBeenCalledWith("status");

        // Asked but unanswered — a column whose definition has since gone — falls back to its own.
        expect(editorParamsOf(selectColumn(undefined, () => undefined)).options).toEqual([ "Todo", "Done" ]);
    });

    it("leaves the editor no way to create where the caller offers none", () => {
        // Without it the field stays a plain picker rather than calling something undefined.
        expect(editorParamsOf(selectColumn()).onCreateOption).toBeUndefined();
    });
});

describe("buildColumnDefinitions — multi-valued columns", () => {
    function multiColumn(type: AttributeDefinitionInformation["type"]) {
        return buildColumnDefinitions({
            info: [ { name: "tags", type, isMulti: true } ],
            movableRows: false,
            existingColumnData: undefined,
            rowNumberHint: 1
        }).find((column) => column.field === "labels.tags");
    }

    it("edits and shows a set as chips whatever it holds, not only a set of options", () => {
        for (const type of [ "text", "date", "url", "select", "color", "boolean" ] as const) {
            const column = multiColumn(type);
            // The type's own single-value editor would show one of the values and store back one.
            expect(typeof column?.editor).toBe("function");
            expect(typeof column?.formatter).toBe("function");
            expect(column?.formatterParams).toEqual({ type });
            // The editor is told which kind of value it is gathering, since that decides the field.
            const params = column?.editorParams;
            if (typeof params !== "function") throw new Error("expected the params to be a function");
            expect((params({} as CellComponent) as ValuesEditorParams).labelType).toBe(type);
        }
    });

    /** Opens a multi-valued cell's editor, as Tabulator does, and puts it in the document. */
    async function editMultiCell(type: AttributeDefinitionInformation["type"], values: string[]) {
        const column = multiColumn(type);
        const editor = column?.editor;
        const params = column?.editorParams;
        if (typeof editor !== "function") throw new Error("expected an editor of its own");
        if (typeof params !== "function") throw new Error("expected the params to be a function");

        const success = vi.fn();
        let element: HTMLElement | false = false;
        await act(async () => {
            element = editor(
                { getValue: () => values } as CellComponent,
                () => {}, success, () => {}, params({} as CellComponent)
            );
        });
        if (!element) throw new Error("expected the editor to build a field");

        // Focus only means anything for an element the document holds.
        const built = element as HTMLElement;
        document.body.appendChild(built);
        return { element: built, success };
    }

    it("stays open where the focus leaves the page rather than the cell", async () => {
        const { element, success } = await editMultiCell("color", [ "#ff0000" ]);
        const picker = element.querySelector<HTMLInputElement>("input[type=color]");
        if (!picker) throw new Error("expected a colour picker");
        picker.focus();

        // A native picker's dialog takes the focus with nothing in the page gaining it. Ending the
        // edit here would take the editor down, and the dialog with it, before it reported a colour.
        picker.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
        expect(success).not.toHaveBeenCalled();

        // Whereas the cell being left for good: nothing in the editor holds the focus any more.
        picker.blur();
        picker.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
        expect(success).toHaveBeenCalledWith([ "#ff0000" ]);

        element.remove();
    });

    it("shows each value as its type reads it, rather than as the text it is stored as", () => {
        const format = (type: AttributeDefinitionInformation["type"], values: string[]) => {
            const formatter = multiColumn(type)?.formatter;
            if (typeof formatter !== "function") throw new Error("expected a formatter of its own");
            return formatter(
                { getValue: () => values } as CellComponent, { type }, () => {}
            ) as HTMLElement;
        };

        // A flag reads as the mark a column of single flags shows, not as the word "true" — and its
        // chip takes a wash of the answer, telling checks from crosses across the table.
        const flags = format("boolean", [ "true", "false" ]);
        expect([ ...flags.querySelectorAll(".tn-icon") ].map((mark) => mark.getAttribute("title")))
            .toEqual([ "true", "false" ]);
        expect(flags.querySelector(".label-flag-set")?.className).toContain("bx-check");
        expect(flags.querySelector(".label-flag-unset")?.className).toContain("bx-x");
        const chips = [ ...flags.querySelectorAll(".tn-chip") ];
        expect(chips[0]?.className).toContain("label-flag-chip-set");
        expect(chips[1]?.className).toContain("label-flag-chip-unset");

        // And a colour floods the chip itself — read-only, the chip holds nothing the colour could
        // hide — with the stored text kept to the tooltip.
        expect(format("color", [ "#ff2e88" ]).querySelector(".label-color-chip")?.getAttribute("title"))
            .toBe("#ff2e88");
    });

    it("links each url of a set, without making a hostile scheme clickable", () => {
        const formatter = multiColumn("url")?.formatter;
        if (typeof formatter !== "function") throw new Error("expected a formatter of its own");
        const cell = formatter(
            { getValue: () => [ "example.com", "javascript:alert(1)" ] } as CellComponent,
            { type: "url" }, () => {}
        ) as HTMLElement;

        expect([ ...cell.querySelectorAll("a") ].map((link) => link.getAttribute("href")))
            .toEqual([ "https://example.com", "about:blank" ]);
        // The value is still readable even where it is not one we may link to.
        expect(cell.textContent).toContain("javascript:alert(1)");
    });

    it("sorts by the values a cell holds, not by the array they arrive in", () => {
        const sorter = multiColumn("text")?.sorter;
        if (typeof sorter !== "function") throw new Error("expected a sorter of its own");

        const compare = (a: unknown, b: unknown) =>
            Math.sign((sorter as (a: unknown, b: unknown, ...rest: never[]) => number)(a, b));
        expect(compare([ "alpha", "beta" ], [ "alpha", "gamma" ])).toBe(-1);
        expect(compare([ "beta" ], [ "alpha", "beta" ])).toBe(1);
        expect(compare([ "alpha" ], [ "alpha" ])).toBe(0);
    });
});

describe("buildColumnDefinitions — relation columns", () => {
    it("sorts by the target's title carried in the row, not by the noteId the cell stores", () => {
        const sorter = buildColumnDefinitions({
            info: [ { name: "assignee", type: "relation" } ],
            movableRows: false,
            existingColumnData: undefined,
            rowNumberHint: 1
        }).find((column) => column.field === "relations.assignee")?.sorter;
        if (typeof sorter !== "function") throw new Error("expected a sorter of its own");

        const column = { getField: () => "relations.assignee" } as ColumnComponent;
        const row = (title: string | undefined) =>
            ({ getData: () => ({ relationTitles: title === undefined ? {} : { assignee: title } }) }) as unknown as RowComponent;
        const compare = (a: string | undefined, b: string | undefined) => Math.sign(
            (sorter as (...args: unknown[]) => number)("idA", "idB", row(a), row(b), column, "asc", {})
        );

        // "Alpha" would come after "Beta" if the ids were what was compared.
        expect(compare("Alpha", "Beta")).toBe(-1);
        expect(compare("Beta", "Alpha")).toBe(1);
        expect(compare("Alpha", "Alpha")).toBe(0);
        // A cell without a target sorts as nothing rather than by its absence crashing the grid.
        expect(compare(undefined, "Alpha")).toBe(-1);
    });

    it("keeps the title sort for a column of several targets, whose cells hold noteId arrays", () => {
        const column = buildColumnDefinitions({
            info: [ { name: "crew", type: "relation", isMulti: true } ],
            movableRows: false,
            existingColumnData: undefined,
            rowNumberHint: 1
        }).find((candidate) => candidate.field === "relations.crew");

        // The set is edited and shown as chips of notes, not as the text the ids are.
        expect(typeof column?.editor).toBe("function");
        expect(typeof column?.formatter).toBe("function");
        const params = column?.editorParams;
        if (typeof params !== "function") throw new Error("expected the params to be a function");
        expect((params({} as CellComponent) as ValuesEditorParams).labelType).toBe("relation");

        const sorter = column?.sorter;
        if (typeof sorter !== "function") throw new Error("expected a sorter of its own");
        const columnComponent = { getField: () => "relations.crew" } as ColumnComponent;
        const row = (titles: string) =>
            ({ getData: () => ({ relationTitles: { crew: titles } }) }) as unknown as RowComponent;

        // Compared by the joined titles the row carries — the ids the cells hold would order
        // "Beta, Gamma" before "Alpha, Zed" whenever their ids happened to.
        expect(Math.sign((sorter as (...args: unknown[]) => number)(
            [ "id1", "id2" ], [ "id3" ], row("Alpha, Zed"), row("Beta, Gamma"), columnComponent, "asc", {}
        ))).toBe(-1);
    });
});

describe("formatLabelDate", () => {
    it("renders dates and datetimes in the configured formatting locale", () => {
        options.set("formattingLocale", "de");

        expect(formatLabelDate("2026-01-31", false)).toBe("31.01.2026");
        expect(formatLabelDate("2026-01-31T14:05", true)).toBe("31.01.2026, 14:05");
    });

    it("keeps a date-only value on its calendar day rather than shifting it by timezone", () => {
        options.set("formattingLocale", "de");

        // Parsed as UTC midnight, "2026-01-31" would roll back a day in a negative UTC offset.
        expect(formatLabelDate("2026-01-31", false)).toBe("31.01.2026");
    });

    it("echoes values that are not dates instead of throwing inside the grid render", () => {
        options.set("formattingLocale", "de");

        // Intl throws a RangeError on an invalid date, which would break the whole table.
        expect(formatLabelDate("not a date", true)).toBe("not a date");
        expect(formatLabelDate("not a date", false)).toBe("not a date");
    });

    it("renders a blank cell for missing values", () => {
        expect(formatLabelDate(undefined, false)).toBe("");
        expect(formatLabelDate(null, true)).toBe("");
        expect(formatLabelDate("", false)).toBe("");
    });
});
