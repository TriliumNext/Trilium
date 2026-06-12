import { FUniver } from "@univerjs/presets";
import { MutableRef } from "preact/hooks";
import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the hook import) -------------------------------------------------

// The hook dynamically imports these commons modules on export; mock them so exceljs / the real
// renderers never load and so we can assert the exact arguments passed in.
const renderSpreadsheetToXlsx = vi.fn(async () => new Uint8Array([ 1, 2, 3 ]));
const renderSpreadsheetToCsv = vi.fn(() => "a,b\n1,2");
const renderSpreadsheetToCsvZip = vi.fn(async () => new Uint8Array([ 4, 5, 6 ]));

vi.mock("@triliumnext/commons/src/lib/spreadsheet/render_to_xlsx", () => ({ renderSpreadsheetToXlsx }));
vi.mock("@triliumnext/commons/src/lib/spreadsheet/render_to_csv", () => ({ renderSpreadsheetToCsv, renderSpreadsheetToCsvZip }));

vi.mock("../../../services/toast", () => ({ default: { showError: vi.fn() } }));

import toast from "../../../services/toast";
import utils from "../../../services/utils";
import { buildNote } from "../../../test/easy-froca";
import { fakeNoteContext, flush, renderHook } from "../../../test/render";
import useSpreadsheetExport from "./export";

// --- Helpers --------------------------------------------------------------------------------------

type Sheets = Record<string, { hidden?: number }>;

/** Builds a fake `FUniver` whose active workbook reports the given save data and active sheet. */
function fakeApi(opts: {
    save?: () => unknown;
    activeSheetId?: string;
    noWorkbook?: boolean;
} = {}): FUniver {
    const workbook = {
        save: opts.save ?? (() => ({ sheetOrder: [ "s1" ], sheets: { s1: {} } as Sheets })),
        getActiveSheet: () => (opts.activeSheetId !== undefined ? { getSheetId: () => opts.activeSheetId } : undefined)
    };
    return {
        getActiveWorkbook: () => (opts.noWorkbook ? undefined : workbook)
    } as unknown as FUniver;
}

/**
 * The export chain spans several macrotasks (dynamic import → renderer → FileReader → download),
 * so a single `flush()` won't drain it; flush repeatedly until it settles.
 */
async function settle() {
    for (let i = 0; i < 8; i++) {
        await flush();
    }
}

beforeEach(() => {
    vi.clearAllMocks();
    // clearAllMocks wipes the impls set at module init, so re-establish the happy-path defaults.
    renderSpreadsheetToXlsx.mockResolvedValue(new Uint8Array([ 1, 2, 3 ]));
    renderSpreadsheetToCsv.mockReturnValue("a,b\n1,2");
    renderSpreadsheetToCsvZip.mockResolvedValue(new Uint8Array([ 4, 5, 6 ]));
    vi.spyOn(utils, "triggerDownload").mockImplementation(() => {});
});

// --------------------------------------------------------------------------------------------------

describe("useSpreadsheetExport", () => {
    it("ignores export events meant for a different note context", async () => {
        const note = buildNote({ id: "sx1", title: "Sheet", type: "doc" });
        const apiRef: MutableRef<FUniver | undefined> = { current: fakeApi() };
        const harness = renderHook(() => useSpreadsheetExport(apiRef, note, fakeNoteContext({ ntxId: "ntxA" })));

        harness.fireEvent("exportXlsx", { ntxId: "other" });
        harness.fireEvent("exportCsv", { ntxId: "other" });
        await settle();

        expect(renderSpreadsheetToXlsx).not.toHaveBeenCalled();
        expect(renderSpreadsheetToCsv).not.toHaveBeenCalled();
        expect(utils.triggerDownload).not.toHaveBeenCalled();
    });

    it("ignores export events when there is no note context at all", async () => {
        const note = buildNote({ id: "sx2", title: "Sheet" });
        const apiRef: MutableRef<FUniver | undefined> = { current: fakeApi() };
        const harness = renderHook(() => useSpreadsheetExport(apiRef, note, null));

        // ntxId undefined on both sides — `undefined !== undefined` is false, so events without an
        // ntxId would match; pass one to keep the mismatch branch covered with a null context.
        harness.fireEvent("exportXlsx", { ntxId: "ntx1" });
        await settle();
        expect(renderSpreadsheetToXlsx).not.toHaveBeenCalled();
    });
});

describe("XLSX export", () => {
    it("does nothing when there is no active workbook to serialize", async () => {
        const note = buildNote({ id: "sx3", title: "NoWb" });
        const apiRef: MutableRef<FUniver | undefined> = { current: fakeApi({ noWorkbook: true }) };
        const harness = renderHook(() => useSpreadsheetExport(apiRef, note, fakeNoteContext({ ntxId: "ntx1" })));

        harness.fireEvent("exportXlsx", { ntxId: "ntx1" });
        await settle();

        expect(renderSpreadsheetToXlsx).not.toHaveBeenCalled();
        expect(utils.triggerDownload).not.toHaveBeenCalled();
    });

    it("does nothing when the api ref is empty", async () => {
        const note = buildNote({ id: "sx3b", title: "NoApi" });
        const apiRef: MutableRef<FUniver | undefined> = { current: undefined };
        const harness = renderHook(() => useSpreadsheetExport(apiRef, note, fakeNoteContext({ ntxId: "ntx1" })));

        harness.fireEvent("exportXlsx", { ntxId: "ntx1" });
        await settle();

        expect(renderSpreadsheetToXlsx).not.toHaveBeenCalled();
    });

    it("serializes the workbook, renders xlsx and downloads with the note title", async () => {
        const save = () => ({ version: 1, foo: "bar" });
        const note = buildNote({ id: "sx4", title: "My Sheet" });
        const apiRef: MutableRef<FUniver | undefined> = { current: fakeApi({ save }) };
        const harness = renderHook(() => useSpreadsheetExport(apiRef, note, fakeNoteContext({ ntxId: "ntx1" })));

        harness.fireEvent("exportXlsx", { ntxId: "ntx1" });
        await settle();

        expect(renderSpreadsheetToXlsx).toHaveBeenCalledWith(JSON.stringify({ version: 1, workbook: save() }));
        expect(utils.triggerDownload).toHaveBeenCalledTimes(1);
        const [ fileName, dataUrl ] = (utils.triggerDownload as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(fileName).toBe("My Sheet.xlsx");
        expect(typeof dataUrl).toBe("string");
        expect(dataUrl).toMatch(/^data:/);
        expect(toast.showError).not.toHaveBeenCalled();
    });

    it("falls back to a default filename when the note has no title", async () => {
        const note = buildNote({ id: "sx5", title: "" });
        const apiRef: MutableRef<FUniver | undefined> = { current: fakeApi() };
        const harness = renderHook(() => useSpreadsheetExport(apiRef, note, fakeNoteContext({ ntxId: "ntx1" })));

        harness.fireEvent("exportXlsx", { ntxId: "ntx1" });
        await settle();

        const [ fileName ] = (utils.triggerDownload as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(fileName).toBe("spreadsheet.xlsx");
    });

    it("shows an error toast when the xlsx renderer throws", async () => {
        renderSpreadsheetToXlsx.mockRejectedValueOnce(new Error("boom"));
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        const note = buildNote({ id: "sx6", title: "Sheet" });
        const apiRef: MutableRef<FUniver | undefined> = { current: fakeApi() };
        const harness = renderHook(() => useSpreadsheetExport(apiRef, note, fakeNoteContext({ ntxId: "ntx1" })));

        harness.fireEvent("exportXlsx", { ntxId: "ntx1" });
        await settle();

        expect(toast.showError).toHaveBeenCalledTimes(1);
        expect(utils.triggerDownload).not.toHaveBeenCalled();
        expect(consoleError).toHaveBeenCalled();
    });
});

describe("CSV export", () => {
    it("does nothing when there is no active workbook", async () => {
        const note = buildNote({ id: "sc1", title: "NoWb" });
        const apiRef: MutableRef<FUniver | undefined> = { current: fakeApi({ noWorkbook: true }) };
        const harness = renderHook(() => useSpreadsheetExport(apiRef, note, fakeNoteContext({ ntxId: "ntx1" })));

        harness.fireEvent("exportCsv", { ntxId: "ntx1" });
        await settle();

        expect(renderSpreadsheetToCsv).not.toHaveBeenCalled();
        expect(renderSpreadsheetToCsvZip).not.toHaveBeenCalled();
    });

    it("exports a single visible sheet as a plain CSV (with the active sheet id)", async () => {
        const save = () => ({ sheetOrder: [ "s1", "s2" ], sheets: { s1: {}, s2: { hidden: 1 } } as Sheets });
        const note = buildNote({ id: "sc2", title: "Data" });
        const apiRef: MutableRef<FUniver | undefined> = { current: fakeApi({ save, activeSheetId: "s1" }) };
        const harness = renderHook(() => useSpreadsheetExport(apiRef, note, fakeNoteContext({ ntxId: "ntx1" })));

        harness.fireEvent("exportCsv", { ntxId: "ntx1" });
        await settle();

        expect(renderSpreadsheetToCsvZip).not.toHaveBeenCalled();
        expect(renderSpreadsheetToCsv).toHaveBeenCalledWith(
            JSON.stringify({ version: 1, workbook: save() }),
            { sheetId: "s1" }
        );
        expect(utils.triggerDownload).toHaveBeenCalledTimes(1);
        const [ fileName, dataUrl ] = (utils.triggerDownload as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(fileName).toBe("Data.csv");
        expect(dataUrl).toMatch(/^data:text\/csv/);
    });

    it("passes an undefined sheet id when no active sheet is reported", async () => {
        const save = () => ({ sheetOrder: [ "s1" ], sheets: { s1: {} } as Sheets });
        const note = buildNote({ id: "sc3", title: "Data" });
        const apiRef: MutableRef<FUniver | undefined> = { current: fakeApi({ save }) };
        const harness = renderHook(() => useSpreadsheetExport(apiRef, note, fakeNoteContext({ ntxId: "ntx1" })));

        harness.fireEvent("exportCsv", { ntxId: "ntx1" });
        await settle();

        expect(renderSpreadsheetToCsv).toHaveBeenCalledWith(expect.any(String), { sheetId: undefined });
    });

    it("bundles multiple visible sheets into a zip", async () => {
        const save = () => ({ sheetOrder: [ "s1", "s2" ], sheets: { s1: {}, s2: {} } as Sheets });
        const note = buildNote({ id: "sc4", title: "Multi" });
        const apiRef: MutableRef<FUniver | undefined> = { current: fakeApi({ save, activeSheetId: "s1" }) };
        const harness = renderHook(() => useSpreadsheetExport(apiRef, note, fakeNoteContext({ ntxId: "ntx1" })));

        harness.fireEvent("exportCsv", { ntxId: "ntx1" });
        await settle();

        expect(renderSpreadsheetToCsvZip).toHaveBeenCalledTimes(1);
        expect(renderSpreadsheetToCsv).not.toHaveBeenCalled();
        const [ fileName, dataUrl ] = (utils.triggerDownload as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(fileName).toBe("Multi.zip");
        expect(dataUrl).toMatch(/^data:application\/zip/);
    });

    it("counts visible sheets via Object.keys when sheetOrder is absent", async () => {
        // No sheetOrder → countVisibleSheets falls back to Object.keys(sheets); two visible → zip.
        const save = () => ({ sheets: { a: {}, b: {} } as Sheets });
        const note = buildNote({ id: "sc5", title: "Fallback" });
        const apiRef: MutableRef<FUniver | undefined> = { current: fakeApi({ save }) };
        const harness = renderHook(() => useSpreadsheetExport(apiRef, note, fakeNoteContext({ ntxId: "ntx1" })));

        harness.fireEvent("exportCsv", { ntxId: "ntx1" });
        await settle();

        expect(renderSpreadsheetToCsvZip).toHaveBeenCalledTimes(1);
    });

    it("treats a workbook with no sheets at all as single-sheet (plain CSV)", async () => {
        // Neither sheetOrder nor sheets → 0 visible → not > 1 → plain CSV branch.
        const save = () => ({});
        const note = buildNote({ id: "sc6", title: "Empty" });
        const apiRef: MutableRef<FUniver | undefined> = { current: fakeApi({ save }) };
        const harness = renderHook(() => useSpreadsheetExport(apiRef, note, fakeNoteContext({ ntxId: "ntx1" })));

        harness.fireEvent("exportCsv", { ntxId: "ntx1" });
        await settle();

        expect(renderSpreadsheetToCsvZip).not.toHaveBeenCalled();
        expect(renderSpreadsheetToCsv).toHaveBeenCalledTimes(1);
    });

    it("shows an error toast when the csv renderer throws", async () => {
        renderSpreadsheetToCsv.mockImplementationOnce(() => { throw new Error("nope"); });
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        const note = buildNote({ id: "sc7", title: "Sheet" });
        const apiRef: MutableRef<FUniver | undefined> = { current: fakeApi() };
        const harness = renderHook(() => useSpreadsheetExport(apiRef, note, fakeNoteContext({ ntxId: "ntx1" })));

        harness.fireEvent("exportCsv", { ntxId: "ntx1" });
        await settle();

        expect(toast.showError).toHaveBeenCalledTimes(1);
        expect(utils.triggerDownload).not.toHaveBeenCalled();
        expect(consoleError).toHaveBeenCalled();
    });
});
