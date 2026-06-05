import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the component import) --------------------------------------------

// CSS imports are side-effectful and unparseable by the test transform; stub them out.
vi.mock("./index.css", () => ({}));

// Capture the props handed to the inner <Tabulator> so we can exercise rowFormatter / persistence
// without standing up the real (DOM-heavy) tabulator-tables library.
const { tabulatorProps } = vi.hoisted(() => {
    const tabulatorProps: Record<string, unknown>[] = [];
    return { tabulatorProps };
});

vi.mock("./tabulator", () => ({
    default: (props: Record<string, unknown>) => {
        tabulatorProps.push(props);
        return null;
    }
}));

// tabulator-tables only contributes the module classes used as values in the `modules` array; a
// plain object per export keeps the import resolvable without pulling in the real library.
vi.mock("tabulator-tables", () => {
    const Module = class {};
    return {
        DataTreeModule: Module,
        EditModule: Module,
        FormatModule: Module,
        FrozenColumnsModule: Module,
        InteractionModule: Module,
        MoveColumnsModule: Module,
        MoveRowsModule: Module,
        PersistenceModule: Module,
        ResizeColumnsModule: Module,
        SortModule: Module,
        Tabulator: class {}
    };
});

// The attribute-detail legacy widget is rendered through useLegacyWidget; a minimal BasicWidget
// subclass avoids loading the full editor stack.
vi.mock("../../attribute_widgets/attribute_detail", async () => {
    const { default: BasicWidget } = await import("../../basic_widget");
    class FakeAttributeDetailWidget extends BasicWidget {
        doRender() { this.$widget = $("<div class='fake-attr-detail'></div>"); }
        showAttributeDetail() {}
    }
    return { default: FakeAttributeDetailWidget };
});

import type { NoteType } from "@triliumnext/commons";

import Component from "../../../components/component";
import froca from "../../../services/froca";
import noteAttributeCache from "../../../services/note_attribute_cache";
import server from "../../../services/server";
import ws from "../../../services/ws";
import { buildNote } from "../../../test/easy-froca";
import { ParentComponent } from "../../react/react_utils";
import type { TableConfig } from "./data";
import TableView from "./index";

// --- Render harness --------------------------------------------------------------------------------

let container: HTMLDivElement | undefined;

interface RenderOpts {
    note: ReturnType<typeof buildNote>;
    noteIds?: string[];
    viewConfig?: TableConfig | undefined;
    saveConfig?: (newConfig: TableConfig) => void;
    parent?: Component | null;
}

function renderTable({ note, noteIds = [], viewConfig, saveConfig = vi.fn(), parent = new Component() }: RenderOpts) {
    const root = document.createElement("div");
    container = root;
    document.body.appendChild(root);
    act(() => {
        render(
            <ParentComponent.Provider value={parent}>
                <TableView
                    note={note}
                    notePath={`root/${note.noteId}`}
                    noteIds={noteIds}
                    highlightedTokens={null}
                    viewConfig={viewConfig}
                    saveConfig={saveConfig}
                    media="screen"
                    onReady={vi.fn()}
                />
            </ParentComponent.Provider>,
            root
        );
    });
    return root;
}

async function flushAll() {
    for (let i = 0; i < 8; i++) {
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    }
}

/** The props of the most recently rendered inner Tabulator (after data settled). */
function latestTabulatorProps() {
    return tabulatorProps.at(-1);
}

function clearFroca() {
    for (const key of Object.keys(froca.notes)) delete froca.notes[key];
    for (const key of Object.keys(froca.attributes)) delete froca.attributes[key];
    for (const key of Object.keys(froca.branches)) delete froca.branches[key];
    for (const key of Object.keys(noteAttributeCache.attributes)) delete noteAttributeCache.attributes[key];
}

beforeEach(() => {
    clearFroca();
    tabulatorProps.length = 0;
    vi.clearAllMocks();
    Object.assign(server, { put: vi.fn(async () => undefined), upload: vi.fn(async () => undefined) });
    Object.assign(ws, { logError: vi.fn() });
    // The bootstrap tooltip jQuery plugin isn't wired up in tests; stub it so tooltip hooks no-op.
    Object.assign(($.fn as unknown as Record<string, unknown>), { tooltip: vi.fn() });
    (globalThis as unknown as { glob: { device?: string } }).glob.device = undefined;
});

afterEach(async () => {
    await act(async () => {});
    if (container) {
        act(() => render(null, container as HTMLDivElement));
        container.remove();
        container = undefined;
    }
    await act(async () => {});
    vi.restoreAllMocks();
    (globalThis as unknown as { glob: { device?: string } }).glob.device = undefined;
});

// --- tests ----------------------------------------------------------------------------------------

describe("TableView", () => {
    it("renders the table-view container with the legacy attribute-detail widget and a Tabulator once data is ready", async () => {
        const note = buildNote({
            id: "book1",
            title: "Book",
            "#viewType": "table",
            children: [
                { id: "row1", title: "Row 1" },
                { id: "row2", title: "Row 2" }
            ]
        });
        // book notes get the CollectionProperties chrome rendered (noteType is "book").
        Object.assign(note, { type: "book" as NoteType });

        const root = renderTable({ note, noteIds: [ "row1", "row2" ] });
        await flushAll();

        expect(root.querySelector(".table-view")).not.toBeNull();
        expect(root.querySelector(".fake-attr-detail")).not.toBeNull();

        const props = latestTabulatorProps();
        expect(props).toBeDefined();
        expect(props?.className).toBe("table-view-container");
        expect(props?.index).toBe("branchId");
        expect(props?.layout).toBe("fitDataFill");
        // 10 tabulator modules are wired in.
        expect((props?.modules as unknown[]).length).toBe(10);
        // No subtree -> dataTree props are not spread in.
        expect(props?.dataTree).toBeUndefined();
        // No subtree and not a search note -> movable rows enabled.
        expect(props?.movableRows).toBe(true);
    });

    it("spreads dataTree options when the collection has a subtree", async () => {
        const note = buildNote({
            id: "tree1",
            title: "Tree",
            children: [
                { id: "branchA", title: "Branch", children: [ { id: "leafA", title: "Leaf" } ] }
            ]
        });
        Object.assign(note, { type: "book" as NoteType });

        renderTable({ note, noteIds: [ "branchA" ] });
        await flushAll();

        const props = latestTabulatorProps();
        expect(props?.dataTree).toBe(true);
        expect(props?.dataTreeStartExpanded).toBe(true);
        expect(props?.dataTreeElementColumn).toBe("title");
        // A subtree disables movable rows.
        expect(props?.movableRows).toBe(false);
    });

    it("rowFormatter toggles the archived class based on row data", async () => {
        const note = buildNote({ id: "fmt1", title: "Fmt", children: [ { id: "fmtRow", title: "R" } ] });
        Object.assign(note, { type: "book" as NoteType });

        renderTable({ note, noteIds: [ "fmtRow" ] });
        await flushAll();

        const rowFormatter = latestTabulatorProps()?.rowFormatter as (row: unknown) => void;
        expect(typeof rowFormatter).toBe("function");

        const el = document.createElement("div");
        const makeRow = (isArchived: boolean) => ({
            getData: () => ({ isArchived }),
            getElement: () => el
        });
        rowFormatter(makeRow(true));
        expect(el.classList.contains("archived")).toBe(true);
        rowFormatter(makeRow(false));
        expect(el.classList.contains("archived")).toBe(false);
    });

    it("does not render the new-row / new-column buttons for search notes", async () => {
        const note = buildNote({ id: "search1", title: "Search", children: [ { id: "sr1", title: "SR" } ] });
        Object.assign(note, { type: "search" as NoteType });

        const root = renderTable({ note, noteIds: [ "sr1" ] });
        await flushAll();

        // CollectionProperties renders for "search" notes; but the add-row/add-column trigger
        // buttons (right children) are omitted because note.type === "search".
        expect(root.querySelector("[data-trigger-command='addNewRow']")).toBeNull();
        expect(root.querySelector("[data-trigger-command='addNewTableColumn']")).toBeNull();
        // Search notes also disable movable rows.
        expect(latestTabulatorProps()?.movableRows).toBe(false);
    });
});

describe("TableView - persistence", () => {
    it("wires persistence reader/writer functions and schedules a save through the writer", async () => {
        const note = buildNote({ id: "persist1", title: "P", children: [ { id: "pr1", title: "PR" } ] });
        Object.assign(note, { type: "book" as NoteType });

        const saveConfig = vi.fn();
        const viewConfig: TableConfig = { tableData: { columns: [ { title: "Title", field: "title" } ] } };

        renderTable({ note, noteIds: [ "pr1" ], viewConfig, saveConfig });
        await flushAll();

        const props = latestTabulatorProps();
        expect(props?.persistence).toBe(true);
        const reader = props?.persistenceReaderFunc as (id: string, type: string) => unknown;
        const writer = props?.persistenceWriterFunc as (id: string, type: string, data: unknown) => void;
        expect(typeof reader).toBe("function");
        expect(typeof writer).toBe("function");

        // The reader pulls the stored slice for a given persistence type.
        expect(reader("table", "columns")).toEqual([ { title: "Title", field: "title" } ]);
        // An unknown type yields undefined (tableData has no such slice).
        expect(reader("table", "sort")).toBeUndefined();

        // The writer stores the data; the spaced save fires only after the (long) interval, so the
        // save callback should not have run yet.
        writer("table", "sort", [ { column: "title", dir: "asc" } ]);
        expect(saveConfig).not.toHaveBeenCalled();
    });

    it("flushes any pending persistence write on unmount", async () => {
        const note = buildNote({ id: "persist2", title: "P2", children: [ { id: "pr2", title: "PR2" } ] });
        Object.assign(note, { type: "book" as NoteType });

        const saveConfig = vi.fn();
        renderTable({ note, noteIds: [ "pr2" ], saveConfig });
        await flushAll();

        const writer = latestTabulatorProps()?.persistenceWriterFunc as (id: string, type: string, data: unknown) => void;
        // Queue a write, then unmount: usePersistence's cleanup calls updateNowIfNecessary(), which
        // forces the pending spaced save to run with the mutated local config.
        writer("table", "sort", [ { column: "title", dir: "desc" } ]);

        await act(async () => render(null, container as HTMLDivElement));
        if (container) { container.remove(); container = undefined; }
        await flushAll();
        expect(saveConfig).toHaveBeenCalledWith({
            tableData: { sort: [ { column: "title", dir: "desc" } ] }
        });
    });

    it("falls back to an empty tableData config when no viewConfig is provided", async () => {
        const note = buildNote({ id: "persist3", title: "P3", children: [ { id: "pr3", title: "PR3" } ] });
        Object.assign(note, { type: "book" as NoteType });

        renderTable({ note, noteIds: [ "pr3" ], viewConfig: undefined });
        await flushAll();

        const reader = latestTabulatorProps()?.persistenceReaderFunc as (id: string, type: string) => unknown;
        // viewConfig undefined -> reader reads from the { tableData: {} } fallback.
        expect(reader("table", "columns")).toBeUndefined();
    });
});
