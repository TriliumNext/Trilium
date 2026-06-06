import { SchemaResponse, SqlExecuteResponse } from "@triliumnext/commons";
import { ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the imports) ----------------------------------------------------

// Replace the heavy SplitEditor (CodeMirror + Split.js) with a lightweight stub that simply renders
// the two slots SqlConsole feeds it (`editorBefore` and `previewContent`) so the internal sub-trees
// (SqlTableSchemas / SqlResults / SqlResultTable) mount and can be exercised directly.
vi.mock("./helpers/SplitEditor", () => ({
    default: (props: {
        editorBefore?: ComponentChildren;
        previewContent?: ComponentChildren;
        noteType?: string;
        forceOrientation?: string;
    }) => (
        <div
            className="split-editor-stub"
            data-note-type={props.noteType}
            data-force-orientation={props.forceOrientation}
        >
            <div className="editor-before">{props.editorBefore}</div>
            <div className="preview-content">{props.previewContent}</div>
        </div>
    )
}));

// Replace the Tabulator wrapper (which constructs a real VanillaTabulator) with a stub that exposes
// the columns/data it was given so the column-building logic in SqlResultTable can be asserted.
const tabulatorCalls: { columns: unknown[]; data: unknown[] }[] = [];
vi.mock("../collections/table/tabulator", () => ({
    default: (props: { columns?: unknown[]; data?: unknown[] }) => {
        tabulatorCalls.push({ columns: props.columns ?? [], data: props.data ?? [] });
        return <div className="tabulator-stub" />;
    }
}));

import type Component from "../../components/component";
import server from "../../services/server";
import { buildNote } from "../../test/easy-froca";
import { flush, renderComponent } from "../../test/render";
import SqlConsole, { SqlTableSchemas } from "./SqlConsole";
import { TypeWidgetProps } from "./type_widget";

// --- Render helper --------------------------------------------------------------------------------

let parent: Component;

function renderWithContext(vnode: ComponentChildren) {
    const { container, parent: renderedParent } = renderComponent(vnode);
    parent = renderedParent;
    return container;
}

function fireTriliumEvent(name: string, data: unknown) {
    act(() => {
        (parent.handleEventInChildren as (n: string, d: unknown) => unknown)(name, data);
    });
}

function makeProps(overrides: Partial<TypeWidgetProps> = {}): TypeWidgetProps {
    const note = buildNote({ id: "sqlNote", title: "SQL", type: "code" });
    return {
        note,
        viewScope: undefined,
        ntxId: "ntx1",
        parentComponent: undefined,
        noteContext: undefined,
        ...overrides
    };
}

beforeEach(() => {
    tabulatorCalls.length = 0;
    vi.clearAllMocks();
    // The auto-mock only defines server.get/post; SqlTableSchemas calls server.get<SchemaResponse[]>.
    Object.assign(server, { get: vi.fn(async () => [] as SchemaResponse[]) });
});

// --- SqlConsole (default export) ------------------------------------------------------------------

describe("SqlConsole", () => {
    it("wires SplitEditor with the schema editor pane and results preview pane", () => {
        const props = makeProps();
        const el = renderWithContext(<SqlConsole {...props} />);

        const stub = el.querySelector(".split-editor-stub");
        expect(stub).not.toBeNull();
        expect(stub?.getAttribute("data-note-type")).toBe("code");
        expect(stub?.getAttribute("data-force-orientation")).toBe("vertical");
        // Both slots rendered.
        expect(el.querySelector(".editor-before .sql-table-schemas-widget")).not.toBeNull();
        // Preview defaults to the "not executed" empty state.
        expect(el.querySelector(".preview-content .no-items")).not.toBeNull();
    });
});

// --- SqlResults (driven through the previewContent slot) ------------------------------------------

describe("SqlResults", () => {
    it("shows the not-executed empty state with a run button before any query", () => {
        const props = makeProps();
        const el = renderWithContext(<SqlConsole {...props} />);

        const noItems = el.querySelector(".preview-content .no-items");
        expect(noItems).not.toBeNull();
        const runButton = noItems?.querySelector("button[data-trigger-command='runActiveNote']");
        expect(runButton).not.toBeNull();
    });

    it("ignores sqlQueryResults events for a different ntxId", () => {
        const props = makeProps({ ntxId: "ntx1" });
        const el = renderWithContext(<SqlConsole {...props} />);

        const response: SqlExecuteResponse = { success: true, results: [ [ { a: 1 } ] ] };
        fireTriliumEvent("sqlQueryResults", { ntxId: "other", response });

        // Still the not-executed empty state (icon bx-data), no result table.
        expect(el.querySelector(".preview-content .sql-result-widget")).toBeNull();
        expect(el.querySelector(".preview-content .bx-data")).not.toBeNull();
    });

    it("renders the failure state with the error message when success is false", () => {
        const props = makeProps();
        const el = renderWithContext(<SqlConsole {...props} />);

        const response: SqlExecuteResponse = { success: false, error: "boom error", results: [] };
        fireTriliumEvent("sqlQueryResults", { ntxId: "ntx1", response });

        const pre = el.querySelector(".preview-content pre.sql-error-message");
        expect(pre).not.toBeNull();
        expect(pre?.textContent).toBe("boom error");
        expect(el.querySelector(".preview-content .bx-error")).not.toBeNull();
    });

    it("renders the no-rows state for a single empty array result", () => {
        const props = makeProps();
        const el = renderWithContext(<SqlConsole {...props} />);

        const response: SqlExecuteResponse = { success: true, results: [ [] ] };
        fireTriliumEvent("sqlQueryResults", { ntxId: "ntx1", response });

        // No result widget; the dedicated no-rows empty state (icon bx-rectangle) is shown.
        expect(el.querySelector(".preview-content .sql-result-widget")).toBeNull();
        expect(el.querySelector(".preview-content .bx-rectangle")).not.toBeNull();
    });

    it("renders a statement-result block for non-array (insert/update) results", () => {
        const props = makeProps();
        const el = renderWithContext(<SqlConsole {...props} />);

        const statement = { changes: 3, lastInsertRowid: 7 };
        const response: SqlExecuteResponse = { success: true, results: [ statement ] };
        fireTriliumEvent("sqlQueryResults", { ntxId: "ntx1", response });

        const widget = el.querySelector(".preview-content .sql-result-widget");
        expect(widget).not.toBeNull();
        const pre = widget?.querySelector("pre");
        expect(pre).not.toBeNull();
        expect(pre?.textContent).toBe(JSON.stringify(statement, null, "\t"));
        // The statement-result branch uses the bx-play icon, not a table.
        expect(widget?.querySelector(".bx-play")).not.toBeNull();
        expect(tabulatorCalls.length).toBe(0);
    });

    it("renders a result table for SELECT rows and builds columns from the first row", () => {
        const props = makeProps();
        const el = renderWithContext(<SqlConsole {...props} />);

        const rows = [
            { id: 1, name: "alpha" },
            { id: 2, name: "beta" }
        ];
        const response: SqlExecuteResponse = { success: true, results: [ rows ] };
        fireTriliumEvent("sqlQueryResults", { ntxId: "ntx1", response });

        expect(el.querySelector(".preview-content .sql-result-widget")).not.toBeNull();
        expect(el.querySelector(".preview-content .tabulator-stub")).not.toBeNull();
        expect(tabulatorCalls.length).toBe(1);

        const call = tabulatorCalls[0];
        expect(call.data).toBe(rows);
        // First column is the synthetic row-number column, then one per key of rows[0].
        const titles = call.columns.map((c) => (c as { title: string }).title);
        expect(titles).toEqual([ "#", "id", "name" ]);
        const idColumn = call.columns[1] as { field: string; headerFilter: boolean; width: number };
        expect(idColumn.field).toBe("id");
        expect(idColumn.headerFilter).toBe(true);
        expect(idColumn.width).toBe(250);
    });

    it("renders nothing (no table) for an empty SELECT result array within a multi-result set", () => {
        const props = makeProps();
        const el = renderWithContext(<SqlConsole {...props} />);

        // Two results: a non-empty select and an empty select. The multi-result path is taken because
        // the single-empty-array shortcut only fires when results.length === 1.
        const rows = [ { id: 1 } ];
        const response: SqlExecuteResponse = { success: true, results: [ rows, [] ] };
        fireTriliumEvent("sqlQueryResults", { ntxId: "ntx1", response });

        expect(el.querySelector(".preview-content .sql-result-widget")).not.toBeNull();
        // Only the non-empty select produces a Tabulator; the empty one returns undefined.
        expect(tabulatorCalls.length).toBe(1);
        expect(tabulatorCalls[0].data).toBe(rows);
    });
});

// --- SqlTableSchemas (named export) ---------------------------------------------------------------

describe("SqlTableSchemas", () => {
    it("hides the widget when the note is not the trilium sqlite note", async () => {
        const note = buildNote({ id: "plain", title: "Plain", type: "code" });
        const props = makeProps({ note });
        const el = renderWithContext(<SqlTableSchemas {...props} />);
        await flush();

        const widget = el.querySelector(".sql-table-schemas-widget");
        expect(widget).not.toBeNull();
        // Not the sqlite note -> hidden-ext class, no dropdowns.
        expect(widget?.className).toContain("hidden-ext");
        expect(el.querySelector(".sql-table-schemas")).toBeNull();
    });

    it("hides the widget while schemas are still loading even for the sqlite note", () => {
        const note = buildNote({ id: "sqlite1", title: "DB", type: "code" });
        note.mime = "text/x-sqlite;schema=trilium";
        // Never resolve so `schemas` stays undefined.
        Object.assign(server, { get: vi.fn(() => new Promise<SchemaResponse[]>(() => {})) });

        const props = makeProps({ note });
        const el = renderWithContext(<SqlTableSchemas {...props} />);

        const widget = el.querySelector(".sql-table-schemas-widget");
        expect(widget?.className).toContain("hidden-ext");
        expect(el.querySelector(".sql-table-schemas")).toBeNull();
    });

    it("renders one dropdown per table with a row per column once schemas load for the sqlite note", async () => {
        const note = buildNote({ id: "sqlite2", title: "DB", type: "code" });
        note.mime = "text/x-sqlite;schema=trilium";

        const schemas: SchemaResponse[] = [
            { name: "notes", columns: [ { name: "noteId", type: "TEXT" }, { name: "title", type: "TEXT" } ] },
            { name: "branches", columns: [ { name: "branchId", type: "TEXT" } ] }
        ];
        Object.assign(server, { get: vi.fn(async () => schemas) });

        const props = makeProps({ note });
        const el = renderWithContext(<SqlTableSchemas {...props} />);
        await flush();

        const widget = el.querySelector(".sql-table-schemas-widget");
        expect(widget?.className).not.toContain("hidden-ext");

        const schemaContainer = el.querySelector(".sql-table-schemas");
        expect(schemaContainer).not.toBeNull();
        // One dropdown trigger button per table.
        const dropdownButtons = schemaContainer?.querySelectorAll(":scope > .dropdown");
        expect(dropdownButtons?.length).toBe(2);

        // server.get was called for the schema endpoint.
        expect(server.get).toHaveBeenCalledWith("sql/schema");
    });
});
