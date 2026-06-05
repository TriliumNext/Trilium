import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the component import) --------------------------------------------
//
// Spreadsheet.tsx pulls in the full Univer editor (createUniver) plus a dozen preset packages and
// their CSS. None of that can run under happy-dom, so every Univer entry point and the two local
// hooks that re-import Univer (./export, ./persistence) are stubbed. The stubs are deliberately
// observable so the component's own wiring (lifecycle listeners, shortcut release, dark mode,
// dialog/sidebar dismissal, search) can be exercised.

// Shared, hoisted state so the (hoisted) vi.mock factories can reference it.
const h = vi.hoisted(() => {
    const IDialogService = { __token: "dialog" };
    const IShortcutService = { __token: "shortcut" };
    const ISidebarService = { __token: "sidebar" };
    const DEFAULT_STYLES = { ff: "" };
    const LifecycleStages = { Rendered: "Rendered", Starting: "Starting" };

    const univerState: {
        lastConfig?: Record<string, unknown>;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        lastApi?: any;
        createCount: number;
    } = { createCount: 0 };

    function makeFakeUniverApi() {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const lifecycleListeners: ((payload: { stage: unknown }) => void)[] = [];
        const shortcuts: { id: string }[] = [
            { id: "sheet.command.copy-right" },
            { id: "sheet.command.copy-down" },
            { id: "sheet.command.unrelated" }
        ];
        const shortcutService = {
            // Return a fresh copy so callers that splice during iteration (the real
            // Spreadsheet loop disposes while iterating) don't skip elements.
            getAllShortcuts: vi.fn(() => shortcuts.slice()),
            registerShortcut: vi.fn((item: { id: string }) => ({
                dispose: vi.fn(() => {
                    const idx = shortcuts.indexOf(item);
                    if (idx >= 0) shortcuts.splice(idx, 1);
                })
            }))
        };
        const dialogService = { closeAll: vi.fn(), close: vi.fn() };
        const sidebarService = { closeAll: vi.fn(), close: vi.fn() };
        const setReadOnly = vi.fn();
        const workbook = {
            disableSelection: vi.fn(),
            getWorkbookPermission: vi.fn(() => ({ setReadOnly }))
        };
        const lifecycleDisposable = { dispose: vi.fn() };

        return {
            Event: { LifeCycleChanged: "LifeCycleChanged" },
            Enum: { LifecycleStages },
            _injector: {
                get: vi.fn((token: unknown) => {
                    if (token === IShortcutService) return shortcutService;
                    if (token === IDialogService) return dialogService;
                    if (token === ISidebarService) return sidebarService;
                    return { closeAll: vi.fn(), close: vi.fn() };
                })
            },
            addEvent: vi.fn((_event: unknown, listener: (payload: { stage: unknown }) => void) => {
                lifecycleListeners.push(listener);
                return lifecycleDisposable;
            }),
            getActiveWorkbook: vi.fn(() => workbook),
            toggleDarkMode: vi.fn(),
            executeCommand: vi.fn(),
            dispose: vi.fn(),
            // test handles
            _shortcuts: shortcuts,
            _shortcutService: shortcutService,
            _dialogService: dialogService,
            _sidebarService: sidebarService,
            _workbook: workbook,
            _setReadOnly: setReadOnly,
            _lifecycleDisposable: lifecycleDisposable,
            _fireLifecycle: (stage: unknown) => lifecycleListeners.forEach(l => l({ stage }))
        };
    }

    const usePersistenceMock = vi.fn();
    const useSpreadsheetExportMock = vi.fn();

    return {
        IDialogService, IShortcutService, ISidebarService, DEFAULT_STYLES, LifecycleStages,
        univerState, makeFakeUniverApi, usePersistenceMock, useSpreadsheetExportMock
    };
});

vi.mock("./Spreadsheet.css", () => ({}));
vi.mock("@univerjs/preset-sheets-core/lib/index.css", () => ({}));
vi.mock("@univerjs/preset-sheets-sort/lib/index.css", () => ({}));
vi.mock("@univerjs/preset-sheets-conditional-formatting/lib/index.css", () => ({}));
vi.mock("@univerjs/preset-sheets-find-replace/lib/index.css", () => ({}));
vi.mock("@univerjs/preset-sheets-note/lib/index.css", () => ({}));
vi.mock("@univerjs/preset-sheets-filter/lib/index.css", () => ({}));
vi.mock("@univerjs/preset-sheets-hyper-link/lib/index.css", () => ({}));
vi.mock("@univerjs/preset-sheets-data-validation/lib/index.css", () => ({}));

vi.mock("@univerjs/core", () => ({ DEFAULT_STYLES: h.DEFAULT_STYLES }));

vi.mock("@univerjs/sheets-formula", () => ({ CalculationMode: { NO_CALCULATION: "no-calc" } }));

// Univer service tokens — opaque identity values is all the component needs.
vi.mock("@univerjs/ui", () => ({
    IDialogService: h.IDialogService,
    IShortcutService: h.IShortcutService,
    ISidebarService: h.ISidebarService
}));

vi.mock("@univerjs/presets", () => ({
    createUniver: vi.fn((config: Record<string, unknown>) => {
        h.univerState.lastConfig = config;
        const api = h.makeFakeUniverApi();
        h.univerState.lastApi = api;
        h.univerState.createCount++;
        return { univerAPI: api };
    }),
    FUniver: class {},
    LocaleType: { EN_US: "enUS" },
    mergeLocales: vi.fn((...locales: unknown[]) => Object.assign({}, ...locales))
}));

// Preset factory functions: each returns an opaque preset descriptor and records its call.
function presetMock(name: string) {
    return { [name]: vi.fn((arg?: unknown) => ({ __preset: name, arg })) };
}
vi.mock("@univerjs/preset-sheets-conditional-formatting", () => presetMock("UniverSheetsConditionalFormattingPreset"));
vi.mock("@univerjs/preset-sheets-conditional-formatting/locales/en-US", () => ({ default: { cf: true } }));
vi.mock("@univerjs/preset-sheets-core", () => presetMock("UniverSheetsCorePreset"));
vi.mock("@univerjs/preset-sheets-core/locales/en-US", () => ({ default: { core: true } }));
vi.mock("@univerjs/preset-sheets-data-validation", () => presetMock("UniverSheetsDataValidationPreset"));
vi.mock("@univerjs/preset-sheets-data-validation/locales/en-US", () => ({ default: { dv: true } }));
vi.mock("@univerjs/preset-sheets-filter", () => presetMock("UniverSheetsFilterPreset"));
vi.mock("@univerjs/preset-sheets-filter/locales/en-US", () => ({ default: { filter: true } }));
vi.mock("@univerjs/preset-sheets-find-replace", () => presetMock("UniverSheetsFindReplacePreset"));
vi.mock("@univerjs/preset-sheets-find-replace/locales/en-US", () => ({ default: { fr: true } }));
vi.mock("@univerjs/preset-sheets-hyper-link", () => presetMock("UniverSheetsHyperLinkPreset"));
vi.mock("@univerjs/preset-sheets-hyper-link/locales/en-US", () => ({ default: { hl: true } }));
vi.mock("@univerjs/preset-sheets-note", () => presetMock("UniverSheetsNotePreset"));
vi.mock("@univerjs/preset-sheets-note/locales/en-US", () => ({ default: { note: true } }));
vi.mock("@univerjs/preset-sheets-sort", () => presetMock("UniverSheetsSortPreset"));
vi.mock("@univerjs/preset-sheets-sort/locales/en-US", () => ({ default: { sort: true } }));

// The two local hooks re-import Univer; replace them with no-ops we can assert were wired.
vi.mock("./persistence", () => ({ default: h.usePersistenceMock }));
vi.mock("./export", () => ({ default: h.useSpreadsheetExportMock }));

vi.mock("../../../services/i18n", () => ({ t: (key: string) => key }));

import type NoteContext from "../../../components/note_context";
import Component from "../../../components/component";
import froca from "../../../services/froca";
import { buildNote } from "../../../test/easy-froca";
import { ParentComponent } from "../../react/react_utils";
import { TypeWidgetProps } from "../type_widget";
import Spreadsheet from "./Spreadsheet";

const univerState = h.univerState;
const DEFAULT_STYLES = h.DEFAULT_STYLES;
const usePersistenceMock = h.usePersistenceMock;
const useSpreadsheetExportMock = h.useSpreadsheetExportMock;

// --- Render helper -------------------------------------------------------------------------------

let container: HTMLDivElement | undefined;
let parent: Component;

function makeProps(overrides: Partial<TypeWidgetProps> = {}): TypeWidgetProps {
    const note = overrides.note ?? buildNote({ id: "sheetNote", title: "Sheet", type: "spreadsheet" });
    return {
        note,
        viewScope: undefined,
        ntxId: "ntx1",
        parentComponent: undefined,
        noteContext: overrides.noteContext,
        ...overrides
    };
}

function renderSpreadsheet(props: TypeWidgetProps) {
    const target = document.createElement("div");
    container = target;
    document.body.appendChild(target);
    act(() => render(
        <ParentComponent.Provider value={parent}>
            <Spreadsheet {...props} />
        </ParentComponent.Provider>,
        target
    ));
    return target;
}

function fireEvent(name: string, data: unknown) {
    act(() => {
        (parent.handleEventInChildren as unknown as (n: string, d: unknown) => void)(name, data);
    });
}

beforeEach(() => {
    parent = new Component();
    univerState.createCount = 0;
    univerState.lastApi = undefined;
    univerState.lastConfig = undefined;
    DEFAULT_STYLES.ff = "";
    (window.glob as unknown as Record<string, unknown>).getThemeStyle = () => "light";
    for (const key of Object.keys(froca.notes)) delete froca.notes[key];
    vi.clearAllMocks();
});

afterEach(() => {
    const target = container;
    if (target) {
        act(() => render(null, target));
        target.remove();
        container = undefined;
    }
    vi.restoreAllMocks();
});

// --- Tests ---------------------------------------------------------------------------------------

describe("Spreadsheet", () => {
    it("renders the container, initializes Univer, and wires the local hooks", () => {
        const root = renderSpreadsheet(makeProps());
        const div = root.querySelector("div.spreadsheet");
        expect(div).toBeTruthy();
        expect(univerState.createCount).toBe(1);
        expect(usePersistenceMock).toHaveBeenCalled();
        expect(useSpreadsheetExportMock).toHaveBeenCalled();
    });

    it("builds a non-read-only editor with toolbar/contextMenu/formulaBar enabled", () => {
        renderSpreadsheet(makeProps());
        const presets = (univerState.lastConfig?.presets ?? []) as { __preset: string; arg?: { toolbar?: boolean; contextMenu?: boolean; formulaBar?: boolean; footer?: unknown } }[];
        const core = presets.find(p => p.__preset === "UniverSheetsCorePreset");
        expect(core?.arg?.toolbar).toBe(true);
        expect(core?.arg?.contextMenu).toBe(true);
        expect(core?.arg?.formulaBar).toBe(true);
        expect(core?.arg?.footer).toBeUndefined();
    });

    it("releases the fill shortcuts (Ctrl+R / Ctrl+D) leaving unrelated ones", () => {
        renderSpreadsheet(makeProps());
        const api = univerState.lastApi;
        expect(api).toBeDefined();
        // copy-right and copy-down removed; unrelated survives.
        expect(api?._shortcuts.map((s: { id: string }) => s.id)).toEqual([ "sheet.command.unrelated" ]);
        expect(api?._shortcutService.registerShortcut).toHaveBeenCalledTimes(2);
    });

    it("toggles dark mode based on the color scheme", () => {
        const glob = window.glob as unknown as Record<string, unknown>;
        glob.getThemeStyle = () => "dark";
        renderSpreadsheet(makeProps());
        expect(univerState.lastApi?.toggleDarkMode).toHaveBeenCalledWith(true);
    });

    it("opens the find dialog on findInText when the note context is active", () => {
        const noteContext = { ntxId: "ntx1", isActive: () => true } as unknown as NoteContext;
        renderSpreadsheet(makeProps({ noteContext }));
        fireEvent("findInText", {});
        expect(univerState.lastApi?.executeCommand).toHaveBeenCalledWith("ui.operation.open-find-dialog");
    });

    it("ignores findInText when the note context is inactive", () => {
        const noteContext = { ntxId: "ntx1", isActive: () => false } as unknown as NoteContext;
        renderSpreadsheet(makeProps({ noteContext }));
        fireEvent("findInText", {});
        expect(univerState.lastApi?.executeCommand).not.toHaveBeenCalled();
    });

    it("dismisses dialogs and sidebar on note switch / mime change", () => {
        renderSpreadsheet(makeProps());
        const api = univerState.lastApi;
        fireEvent("beforeNoteSwitch", {});
        fireEvent("noteTypeMimeChanged", {});
        expect(api?._dialogService.closeAll).toHaveBeenCalledTimes(2);
        expect(api?._sidebarService.close).toHaveBeenCalledTimes(2);
    });

    it("focuses the editor element on focusOnDetail", () => {
        const root = renderSpreadsheet(makeProps());
        const editor = document.createElement("input");
        editor.setAttribute("data-u-comp", "editor");
        root.querySelector("div.spreadsheet")?.appendChild(editor);
        const focusSpy = vi.spyOn(editor, "focus");
        fireEvent("focusOnDetail", {});
        expect(focusSpy).toHaveBeenCalled();
    });

    it("disposes Univer on unmount", () => {
        const target = renderSpreadsheet(makeProps());
        const api = univerState.lastApi;
        act(() => render(null, target));
        target.remove();
        container = undefined;
        expect(api?.dispose).toHaveBeenCalled();
    });

    it("applies the detail font family to Univer's default styles when present", () => {
        const original = getComputedStyle(document.body).getPropertyValue("--detail-font-family");
        document.body.style.setProperty("--detail-font-family", "Comic Sans");
        try {
            renderSpreadsheet(makeProps());
            expect(DEFAULT_STYLES.ff).toBe("Comic Sans");
        } finally {
            document.body.style.setProperty("--detail-font-family", original);
        }
    });

    it("re-releases fill shortcuts when the Rendered lifecycle stage fires", () => {
        renderSpreadsheet(makeProps());
        const api = univerState.lastApi;
        // Re-add a fill shortcut and fire Rendered; the lifecycle listener should release it again.
        api?._shortcuts.push({ id: "sheet.command.copy-right" });
        act(() => api?._fireLifecycle("Rendered"));
        expect(api?._shortcuts.some((s: { id: string }) => s.id === "sheet.command.copy-right")).toBe(false);

        // A non-Rendered stage is ignored.
        api?._shortcuts.push({ id: "sheet.command.copy-down" });
        act(() => api?._fireLifecycle("Starting"));
        expect(api?._shortcuts.some((s: { id: string }) => s.id === "sheet.command.copy-down")).toBe(true);
    });

    it("warns when a fill shortcut survives release", () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        renderSpreadsheet(makeProps());
        const api = univerState.lastApi;
        // registerShortcut no longer disposes anything, so the binding survives the next release.
        if (api) api._shortcutService.registerShortcut.mockReturnValue({ dispose: vi.fn() });
        api?._shortcuts.push({ id: "sheet.command.copy-right" });
        act(() => api?._fireLifecycle("Rendered"));
        expect(warnSpy).toHaveBeenCalled();
    });

    it("logs an error when releasing shortcuts throws", () => {
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
        renderSpreadsheet(makeProps());
        const api = univerState.lastApi;
        if (api) api._injector.get.mockImplementation(() => { throw new Error("injector boom"); });
        act(() => api?._fireLifecycle("Rendered"));
        expect(errorSpy).toHaveBeenCalled();
    });

    it("prevents dismissal for radix-portal targets and ignores others", () => {
        renderSpreadsheet(makeProps());

        const inside = document.createElement("div");
        const portal = document.createElement("div");
        portal.id = "radix-popup-1";
        portal.appendChild(inside);
        document.body.appendChild(portal);
        const ev1 = new Event("dismissableLayer.pointerDownOutside", { cancelable: true });
        inside.dispatchEvent(ev1);
        expect(ev1.defaultPrevented).toBe(true);

        const outside = document.createElement("div");
        document.body.appendChild(outside);
        const ev2 = new Event("dismissableLayer.focusOutside", { cancelable: true });
        outside.dispatchEvent(ev2);
        expect(ev2.defaultPrevented).toBe(false);

        portal.remove();
        outside.remove();
    });

    it("does nothing on focusOnDetail when there is no editor element", () => {
        renderSpreadsheet(makeProps());
        // No [data-u-comp=editor] child exists; the handler must short-circuit without throwing.
        expect(() => fireEvent("focusOnDetail", {})).not.toThrow();
    });
});

describe("Spreadsheet (read-only)", () => {
    function readOnlyProps() {
        const note = buildNote({ id: "roSheet", title: "RO", type: "spreadsheet", "#readOnly": "true" });
        const noteContext = {
            ntxId: "ntx1",
            isActive: () => true,
            viewScope: { readOnlyTemporarilyDisabled: false }
        } as unknown as NoteContext;
        return makeProps({ note, noteContext });
    }

    it("disables toolbar/contextMenu/formulaBar/footer and merges read-only locale overrides", () => {
        renderSpreadsheet(readOnlyProps());
        const presets = (univerState.lastConfig?.presets ?? []) as { __preset: string; arg?: { toolbar?: boolean; contextMenu?: boolean; formulaBar?: boolean; footer?: unknown } }[];
        const core = presets.find(p => p.__preset === "UniverSheetsCorePreset");
        expect(core?.arg?.toolbar).toBe(false);
        expect(core?.arg?.contextMenu).toBe(false);
        expect(core?.arg?.formulaBar).toBe(false);
        expect(core?.arg?.footer).toBe(false);

        const locales = univerState.lastConfig?.locales as Record<string, Record<string, unknown>> | undefined;
        const enUS = locales?.enUS;
        expect(enUS?.permission).toBeDefined();
    });

    it("makes the workbook read-only when the Rendered lifecycle stage fires", () => {
        renderSpreadsheet(readOnlyProps());
        const api = univerState.lastApi;
        act(() => api?._fireLifecycle("Rendered"));
        expect(api?._workbook.disableSelection).toHaveBeenCalled();
        expect(api?._setReadOnly).toHaveBeenCalled();

        // A non-Rendered stage does not re-apply.
        act(() => api?._fireLifecycle("Starting"));
        expect(api?._workbook.disableSelection).toHaveBeenCalledTimes(1);
    });

    it("tolerates a missing workbook on the read-only Rendered stage", () => {
        renderSpreadsheet(readOnlyProps());
        const api = univerState.lastApi;
        if (api) api.getActiveWorkbook.mockReturnValue(undefined);
        expect(() => act(() => api?._fireLifecycle("Rendered"))).not.toThrow();
    });
});
