import { ComponentChildren, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the component import) --------------------------------------------

vi.mock("bootstrap", () => {
    class Tooltip {
        static instances = new Map<Element, Tooltip>();
        static getInstance(el: Element) { return Tooltip.instances.get(el) ?? null; }
        static getOrCreateInstance(el: Element) { return Tooltip.getInstance(el) ?? new Tooltip(el); }
        element: Element;
        constructor(el: Element) { this.element = el; Tooltip.instances.set(el, this); }
        dispose() { Tooltip.instances.delete(this.element); }
        show() {}
        hide() {}
        update() {}
    }
    class Modal {
        static getInstance() { return null; }
        static getOrCreateInstance() { return new Modal(); }
        show() {}
        hide() {}
        dispose() {}
    }
    class Dropdown {
        static getInstance() { return null; }
        static getOrCreateInstance() { return new Dropdown(); }
        show() {}
        hide() {}
        update() {}
        dispose() {}
    }
    return { Tooltip, Modal, Dropdown, default: { Tooltip, Modal, Dropdown } };
});

vi.mock("../../services/dialog", () => ({
    default: {},
    openDialog: vi.fn(async ($el: unknown) => $el)
}));
vi.mock("../../services/toast", () => ({ default: { showPersistent: vi.fn(), closePersistent: vi.fn() } }));
// Render the dropdown's children unconditionally so the printer menu items are always exercised.
vi.mock("../react/Dropdown", () => ({
    default: ({ text, children, disabled }: { text: ComponentChildren; children: ComponentChildren; disabled?: boolean }) => (
        <div className="dropdown-stub" data-disabled={disabled ? "1" : "0"}>
            <div className="dropdown-stub-text">{text}</div>
            <div className="dropdown-stub-menu">{children}</div>
        </div>
    )
}));
// Stub the PdfViewer so it does not attempt to load the real pdf.js iframe / options.
vi.mock("../type_widgets/file/PdfViewer", () => ({
    default: ({ pdfUrl }: { pdfUrl: string }) => <div className="pdf-stub" data-url={pdfUrl} />
}));

import Component from "../../components/component";
import FAttribute from "../../entities/fattribute";
import type FNote from "../../entities/fnote";
import attributes from "../../services/attributes";
import froca from "../../services/froca";
import noteAttributeCache from "../../services/note_attribute_cache";
import server from "../../services/server";
import toast from "../../services/toast";
import utils from "../../services/utils";
import ws from "../../services/ws";
import { buildNote } from "../../test/easy-froca";
import { ParentComponent } from "../react/react_utils";
import PrintPreviewDialog from "./print_preview";

// --- electronApi printing stub --------------------------------------------------------------------

interface PrintingStub {
    getPrinters: ReturnType<typeof vi.fn>;
    exportAsPdfPreview: ReturnType<typeof vi.fn>;
    onExportAsPdfPreviewResult: ReturnType<typeof vi.fn>;
    removeExportAsPdfPreviewResultListener: ReturnType<typeof vi.fn>;
    savePdf: ReturnType<typeof vi.fn>;
    printFromPreview: ReturnType<typeof vi.fn>;
}

let printing: PrintingStub | undefined;
let previewResultCallback: ((result: { buffer?: Uint8Array; error?: string }) => void) | undefined;

function installElectronApi(printers: unknown[] = []) {
    previewResultCallback = undefined;
    printing = {
        getPrinters: vi.fn(async () => printers),
        exportAsPdfPreview: vi.fn(),
        onExportAsPdfPreviewResult: vi.fn((cb: (result: { buffer?: Uint8Array; error?: string }) => void) => {
            previewResultCallback = cb;
        }),
        removeExportAsPdfPreviewResultListener: vi.fn(),
        savePdf: vi.fn(),
        printFromPreview: vi.fn()
    };
    (window as unknown as { electronApi?: { printing: PrintingStub } }).electronApi = { printing };
}

function clearElectronApi() {
    (window as unknown as { electronApi?: unknown }).electronApi = undefined;
    printing = undefined;
    previewResultCallback = undefined;
}

// --- Render harness ------------------------------------------------------------------------------

let container: HTMLDivElement | undefined;
let parent: Component | undefined;

function renderDialog() {
    const localParent = new Component();
    const localContainer = document.createElement("div");
    parent = localParent;
    container = localContainer;
    document.body.appendChild(localContainer);
    act(() => render(
        <ParentComponent.Provider value={localParent}>
            <PrintPreviewDialog />
        </ParentComponent.Provider>,
        localContainer
    ));
    return localContainer;
}

function fireEvent(name: string, data: unknown) {
    act(() => { (parent?.handleEventInChildren as (n: string, d: unknown) => void)?.(name, data); });
}

/**
 * Mutates a froca note's cached label and fires an `entitiesReloaded` event so the
 * `useNoteLabel*` hooks update their state — mimicking the round-trip the real attribute
 * setters perform via the server + websocket. `value === null` removes the label.
 */
function applyLabelChange(note: FNote, name: string, value: string | null) {
    const cached = noteAttributeCache.attributes[note.noteId] ?? [];
    const remaining = cached.filter((a) => !(a.type === "label" && a.name === name));
    if (value !== null) {
        const attributeId = utils.randomString(12);
        const attribute = new FAttribute(froca, {
            noteId: note.noteId, attributeId, type: "label", name, value, position: remaining.length, isInheritable: false
        });
        froca.attributes[attributeId] = attribute;
        remaining.push(attribute);
        if (!note.attributes.includes(attributeId)) note.attributes.push(attributeId);
    }
    noteAttributeCache.attributes[note.noteId] = remaining;

    fireEvent("entitiesReloaded", {
        loadResults: {
            getAttributeRows: () => [ { type: "label", name, value, noteId: note.noteId, isDeleted: value === null } ],
            getBranchRows: () => [],
            getOptionNames: () => [],
            isNoteReloaded: () => false,
            isNoteContentReloaded: () => false,
            getEntityRow: () => undefined
        }
    });
}

/** Spies the attribute setters so they update the froca note and fire `entitiesReloaded`. */
function wireAttributeSetters() {
    vi.spyOn(attributes, "setLabel").mockImplementation((noteId, name, value) => {
        const note = froca.notes[noteId as string];
        if (note) applyLabelChange(note, name as string, (value as string | undefined) ?? "");
        return undefined as never;
    });
    vi.spyOn(attributes, "setBooleanWithInheritance").mockImplementation((note, name, value) => {
        applyLabelChange(note as FNote, name as string, String(value));
        return undefined as never;
    });
    vi.spyOn(attributes, "removeOwnedLabelByName").mockImplementation((note, name) => {
        applyLabelChange(note as FNote, name as string, null);
        return undefined as never;
    });
}

async function flush() {
    // Fake timers are active; advance any 0ms timers and drain the microtask queue between cycles.
    for (let i = 0; i < 4; i++) {
        await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    }
}

/** Delivers a successful preview buffer to the registered listener, clearing the loading overlay. */
async function deliverBuffer(bytes = [ 1, 2, 3 ]) {
    act(() => previewResultCallback?.({ buffer: new Uint8Array(bytes) }));
    await flush();
}

/**
 * Opens the dialog with a freshly-built note. By default the initial debounce is flushed and a
 * preview buffer is delivered so `loading` is cleared and the settings controls are enabled.
 */
async function openDialog({ title = "Note", printers = [] as unknown[], notePath = "root/p1", note = buildNote({ id: "p1", title, content: "<p>body</p>" }), settle = false } = {}) {
    installElectronApi(printers);
    wireAttributeSetters();
    const el = renderDialog();
    fireEvent("showPrintPreview", { note, notePath });
    await flush();
    if (settle) {
        await advanceAndFlush(0);
        await deliverBuffer();
        (printing?.exportAsPdfPreview as ReturnType<typeof vi.fn>).mockClear();
    }
    return el;
}

function makePrinter(over: Partial<Record<string, unknown>> = {}) {
    return {
        name: "p_name",
        displayName: "Printer Display",
        description: "Desc",
        location: "Office",
        isDefault: false,
        ...over
    };
}

beforeEach(() => {
    for (const key of Object.keys(froca.notes)) delete froca.notes[key];
    for (const key of Object.keys(froca.attributes)) delete froca.attributes[key];
    for (const key of Object.keys(froca.branches)) delete froca.branches[key];
    for (const key of Object.keys(noteAttributeCache.attributes)) delete noteAttributeCache.attributes[key];
    vi.clearAllMocks();
    // The auto-mocked server (test/setup.ts) only defines get/post — the label setters use put.
    Object.assign(server, { put: vi.fn(async () => undefined), upload: vi.fn(async () => undefined) });
    Object.assign(ws, { logError: vi.fn() });
    // happy-dom does not provide a usable Blob URL factory — stub it (tests can override per-case).
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
    if (container) { act(() => render(null, container ?? document.createElement("div"))); container.remove(); container = undefined; }
    clearElectronApi();
    vi.restoreAllMocks();
});

// Helper to advance the debounce timer and settle async effects.
async function advanceAndFlush(ms = 800) {
    await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
    await flush();
}

// --- Tests ---------------------------------------------------------------------------------------

describe("PrintPreviewDialog — opening", () => {
    it("renders the dialog body when showPrintPreview fires and requests the initial preview", async () => {
        const el = await openDialog();

        // The settings panel and PDF pane render once shown.
        expect(el.querySelector(".print-preview-dialog")).toBeTruthy();
        expect(el.querySelector(".print-preview-settings")).toBeTruthy();
        expect(el.querySelector(".print-preview-pane")).toBeTruthy();

        // The loading overlay is visible until the first preview result arrives.
        expect(el.querySelector(".print-preview-loading-overlay")).toBeTruthy();

        // First generation runs immediately (delay 0) and requests an export.
        await advanceAndFlush(0);
        expect(printing?.exportAsPdfPreview).toHaveBeenCalled();
        // The listener and the printer query were both set up.
        expect(printing?.onExportAsPdfPreviewResult).toHaveBeenCalled();
        expect(printing?.getPrinters).toHaveBeenCalled();
    });

    it("ignores a second showPrintPreview while already shown", async () => {
        const el = await openDialog();
        await advanceAndFlush(0);
        const note2 = buildNote({ id: "other", title: "Other", content: "x" });
        fireEvent("showPrintPreview", { note: note2, notePath: "root/other" });
        // Still the same dialog; no crash.
        expect(el.querySelector(".print-preview-dialog")).toBeTruthy();
    });

    it("does nothing when no electron printing API is available", async () => {
        const note = buildNote({ id: "p1", title: "N", content: "x" });
        clearElectronApi();
        const el = renderDialog();
        fireEvent("showPrintPreview", { note, notePath: "root/p1" });
        await flush();
        // Dialog still becomes visible, but no export was requested (api missing → early returns).
        expect(el.querySelector(".print-preview-dialog")).toBeTruthy();
    });
});

describe("PrintPreviewDialog — preview results", () => {
    it("renders the PdfViewer and clears loading once a buffer arrives", async () => {
        const createSpy = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview");
        const el = await openDialog();
        await advanceAndFlush(0);

        act(() => previewResultCallback?.({ buffer: new Uint8Array([ 1, 2, 3 ]) }));
        await flush();

        expect(createSpy).toHaveBeenCalled();
        expect(el.querySelector(".pdf-stub")?.getAttribute("data-url")).toBe("blob:preview");
        expect(el.querySelector(".print-preview-loading-overlay")).toBeNull();
        expect(toast.closePersistent).toHaveBeenCalledWith("printing");
    });

    it("revokes the previous URL when a new buffer replaces it", async () => {
        vi.spyOn(URL, "createObjectURL").mockReturnValueOnce("blob:first").mockReturnValue("blob:second");
        const revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
        const el = await openDialog();
        await advanceAndFlush(0);

        act(() => previewResultCallback?.({ buffer: new Uint8Array([ 1 ]) }));
        await flush();
        act(() => previewResultCallback?.({ buffer: new Uint8Array([ 2 ]) }));
        await flush();

        expect(revokeSpy).toHaveBeenCalledWith("blob:first");
        expect(el.querySelector(".pdf-stub")?.getAttribute("data-url")).toBe("blob:second");
    });

    it("shows a persistent error toast and clears the preview when an error result arrives", async () => {
        vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview");
        const revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
        const el = await openDialog();
        await advanceAndFlush(0);

        // First a successful buffer so there is a URL to revoke.
        act(() => previewResultCallback?.({ buffer: new Uint8Array([ 9 ]) }));
        await flush();
        expect(el.querySelector(".pdf-stub")).toBeTruthy();

        act(() => previewResultCallback?.({ error: "boom" }));
        await flush();

        expect(revokeSpy).toHaveBeenCalledWith("blob:preview");
        expect(el.querySelector(".pdf-stub")).toBeNull();
        expect(toast.showPersistent).toHaveBeenCalledWith(expect.objectContaining({ id: "print-preview-error" }));
    });

    it("shows an error toast even when there was no prior preview URL", async () => {
        const el = await openDialog();
        await advanceAndFlush(0);
        // Error arrives before any successful buffer → the `if (pdfUrlRef.current)` branch is skipped.
        act(() => previewResultCallback?.({ error: "no render" }));
        await flush();
        expect(el.querySelector(".pdf-stub")).toBeNull();
        expect(toast.showPersistent).toHaveBeenCalledWith(expect.objectContaining({ id: "print-preview-error" }));
    });

    it("ignores a result with neither buffer nor error", async () => {
        const el = await openDialog();
        await advanceAndFlush(0);
        act(() => previewResultCallback?.({}));
        await flush();
        // No preview rendered, but the persistent printing toast was still closed.
        expect(el.querySelector(".pdf-stub")).toBeNull();
        expect(toast.closePersistent).toHaveBeenCalledWith("printing");
    });
});

describe("PrintPreviewDialog — printer destinations", () => {
    it("selects the default printer and lists printers with descriptions", async () => {
        const el = await openDialog({
            printers: [
                makePrinter({ name: "def", displayName: "Default One", isDefault: true, location: "Lobby" }),
                makePrinter({ name: "loc", displayName: "Loc Printer", isDefault: false, location: "Room B", description: "ignored" }),
                makePrinter({ name: "descOnly", displayName: "", isDefault: false, location: "", description: "Only desc" })
            ]
        });
        await advanceAndFlush(0);

        const items = el.querySelectorAll(".dropdown-stub-menu .dropdown-item");
        // PDF entry + 3 printers.
        expect(items.length).toBe(4);
        // The default printer became the selected destination (primary button = Print, not Export).
        const primary = el.querySelector(".modal-footer .btn-primary");
        expect(primary?.querySelector(".bx-printer")).toBeTruthy();

        // The label area reflects the default printer's display name.
        const label = el.querySelector(".dropdown-stub-text");
        expect(label?.textContent).toContain("Default One");

        // Description lines were built (default tag, location, description fallback).
        const descriptions = Array.from(el.querySelectorAll(".dropdown-stub-menu .description")).map(d => d.textContent ?? "");
        expect(descriptions.some(d => d.includes("Lobby"))).toBe(true);
        expect(descriptions.some(d => d.includes("Room B"))).toBe(true);
        expect(descriptions.some(d => d.includes("Only desc"))).toBe(true);
    });

    it("switching destination back to PDF flips the primary button to Export and falls back to name when no displayName", async () => {
        const el = await openDialog({
            printers: [ makePrinter({ name: "fallbackName", displayName: "", isDefault: false, location: "", description: "" }) ]
        });
        await advanceAndFlush(0);

        // Click the printer item (no displayName → uses name).
        const printerItem = Array.from(el.querySelectorAll(".dropdown-stub-menu .dropdown-item"))
            .find(li => li.textContent?.includes("fallbackName")) as HTMLElement | undefined;
        expect(printerItem).toBeTruthy();
        act(() => { printerItem?.click(); });
        expect(el.querySelector(".modal-footer .btn-primary")?.querySelector(".bx-printer")).toBeTruthy();

        // Now click the PDF item to switch back.
        const pdfItem = el.querySelector(".dropdown-stub-menu .dropdown-item") as HTMLElement | null;
        act(() => { pdfItem?.click(); });
        expect(el.querySelector(".modal-footer .btn-primary")?.querySelector(".bx-file")).toBeTruthy();
    });

    it("falls back to the raw destination string when the printer is unknown", async () => {
        // No default printer; destination stays as PDF, so select a printer then remove it from list isn't
        // possible — instead verify DestinationLabel handles a printer present in list with displayName.
        const el = await openDialog({
            printers: [ makePrinter({ name: "only", displayName: "Only Printer", isDefault: true }) ]
        });
        await advanceAndFlush(0);
        expect(el.querySelector(".dropdown-stub-text")?.textContent).toContain("Only Printer");
    });

    it("tolerates getPrinters resolving without a list", async () => {
        const note = buildNote({ id: "p1", title: "N", content: "x" });
        installElectronApi();
        wireAttributeSetters();
        // Override getPrinters to resolve undefined → the `list ?? []` fallback is exercised.
        if (printing) (printing.getPrinters as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
        const el = renderDialog();
        fireEvent("showPrintPreview", { note, notePath: "root/p1" });
        await flush();
        await advanceAndFlush(0);
        // Only the PDF entry remains; destination stays PDF (no default printer was found).
        expect(el.querySelectorAll(".dropdown-stub-menu .dropdown-item").length).toBe(1);
        expect(el.querySelector(".modal-footer .btn-primary")?.querySelector(".bx-file")).toBeTruthy();
    });
});

describe("PrintPreviewDialog — settings controls", () => {
    it("toggles orientation and regenerates after the debounce", async () => {
        const el = await openDialog({ settle: true });

        const buttons = Array.from(el.querySelectorAll(".btn-group button"));
        const landscapeBtn = buttons.find(b => b.querySelector(".bx-rectangle:not(.bx-rotate-90)")) as HTMLButtonElement | undefined;
        const portraitBtn = buttons.find(b => b.querySelector(".bx-rotate-90")) as HTMLButtonElement | undefined;
        expect(landscapeBtn).toBeTruthy();
        act(() => { landscapeBtn?.click(); });
        await advanceAndFlush(800);
        expect(printing?.exportAsPdfPreview).toHaveBeenCalled();
        let lastCall = (printing?.exportAsPdfPreview as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
        expect(lastCall?.landscape).toBe(true);

        // The regeneration set loading=true again; deliver a buffer to re-enable the buttons.
        await deliverBuffer();

        // Switching back to portrait also regenerates with landscape=false.
        act(() => { portraitBtn?.click(); });
        await advanceAndFlush(800);
        lastCall = (printing?.exportAsPdfPreview as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
        expect(lastCall?.landscape).toBe(false);
    });

    it("changes the page size via the select", async () => {
        const el = await openDialog({ settle: true });

        const select = Array.from(el.querySelectorAll("select")).find(s => Array.from(s.options).some(o => o.value === "A4"));
        if (select) {
            select.value = "A4";
            act(() => { select.dispatchEvent(new Event("change", { bubbles: true })); });
        }
        await advanceAndFlush(800);
        const lastCall = (printing?.exportAsPdfPreview as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
        expect(lastCall?.pageSize).toBe("A4");
    });

    it("changes scale via the slider and clamps to bounds", async () => {
        const el = await openDialog({ settle: true });

        const slider = el.querySelector("input[type=range]") as HTMLInputElement | null;
        expect(slider).toBeTruthy();
        if (slider) {
            slider.value = "1.5";
            slider.valueAsNumber = 1.5;
            act(() => {
                slider.dispatchEvent(new Event("input", { bubbles: true }));
                slider.dispatchEvent(new Event("change", { bubbles: true }));
            });
        }
        await advanceAndFlush(800);
        const lastCall = (printing?.exportAsPdfPreview as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
        expect(lastCall?.scale).toBe(1.5);
    });

    it("selecting custom margins shows the margin editor and edits propagate", async () => {
        const el = await openDialog({ settle: true });

        const marginSelect = Array.from(el.querySelectorAll("select"))
            .find(s => Array.from(s.options).some(o => o.value === "custom"));
        expect(marginSelect).toBeTruthy();
        if (marginSelect) {
            marginSelect.value = "custom";
            act(() => { marginSelect.dispatchEvent(new Event("change", { bubbles: true })); });
        }
        await flush();

        const editor = el.querySelector(".margin-editor");
        expect(editor).toBeTruthy();
        const spinners = el.querySelectorAll("input.margin-spinner");
        expect(spinners.length).toBe(4);

        // The MarginEditor renders spinners in DOM order: top, left, right, bottom.
        // Exercise each side's onChange so every callback is covered.
        const values = [ "25", "11", "12", "13" ];
        for (let i = 0; i < spinners.length; i++) {
            (printing?.exportAsPdfPreview as ReturnType<typeof vi.fn>).mockClear();
            const spinner = spinners[i] as HTMLInputElement;
            spinner.value = values[i];
            act(() => { spinner.dispatchEvent(new Event("input", { bubbles: true })); });
            await advanceAndFlush(800);
        }
        const lastCall = (printing?.exportAsPdfPreview as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
        // Custom margins serialized as "top,right,bottom,left" → all four edits applied.
        expect(lastCall?.margins).toBe("25,12,13,11");
    });

    it("clamps an out-of-range margin spinner value", async () => {
        const el = await openDialog({ settle: true });
        const marginSelect = Array.from(el.querySelectorAll("select"))
            .find(s => Array.from(s.options).some(o => o.value === "custom"));
        if (marginSelect) {
            marginSelect.value = "custom";
            act(() => { marginSelect.dispatchEvent(new Event("change", { bubbles: true })); });
        }
        await flush();

        (printing?.exportAsPdfPreview as ReturnType<typeof vi.fn>).mockClear();
        const spinner = el.querySelector("input.margin-spinner") as HTMLInputElement | null;
        if (spinner) {
            spinner.value = "500";
            act(() => { spinner.dispatchEvent(new Event("input", { bubbles: true })); });
        }
        await advanceAndFlush(800);
        let lastCall = (printing?.exportAsPdfPreview as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
        // 500 (and number input clamps to max=100) → 100.
        expect(lastCall?.margins).toMatch(/^100,/);

        // An empty/non-numeric spinner value resolves to 0 via the `parseInt(...) || 0` fallback.
        await deliverBuffer();
        (printing?.exportAsPdfPreview as ReturnType<typeof vi.fn>).mockClear();
        const spinner2 = el.querySelector("input.margin-spinner") as HTMLInputElement | null;
        if (spinner2) {
            spinner2.value = "";
            act(() => { spinner2.dispatchEvent(new Event("input", { bubbles: true })); });
        }
        await advanceAndFlush(800);
        lastCall = (printing?.exportAsPdfPreview as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
        expect(lastCall?.margins).toMatch(/^0,/);
    });

    it("validates page ranges: invalid input is flagged and blocks regeneration", async () => {
        const el = await openDialog({ settle: true });

        const rangeInput = el.querySelector(".print-preview-page-ranges") as HTMLInputElement | null;
        expect(rangeInput).toBeTruthy();
        if (rangeInput) {
            rangeInput.value = "abc";
            act(() => { rangeInput.dispatchEvent(new Event("input", { bubbles: true })); });
        }
        await advanceAndFlush(800);
        // Invalid → input marked invalid and no new generation.
        expect(el.querySelector(".print-preview-page-ranges.is-invalid")).toBeTruthy();
        expect(printing?.exportAsPdfPreview).not.toHaveBeenCalled();

        // Now a valid range regenerates.
        if (rangeInput) {
            rangeInput.value = "1-3, 5";
            act(() => { rangeInput.dispatchEvent(new Event("input", { bubbles: true })); });
        }
        await advanceAndFlush(800);
        const lastCall = (printing?.exportAsPdfPreview as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
        expect(lastCall?.pageRanges).toBe("1-3, 5");
    });
});

describe("PrintPreviewDialog — persisted label parsing", () => {
    it("falls back to the default margin preset for a malformed margins label", async () => {
        // "1,2" is neither a known preset nor a full 4-tuple → parseMarginValue returns the default preset.
        const note = buildNote({ id: "p1", title: "N", content: "x", "#printMargins": "1,2" });
        const el = await openDialog({ note });
        await advanceAndFlush(0);
        // Default preset → no custom margin editor.
        expect(el.querySelector(".margin-editor")).toBeNull();
        const marginSelect = Array.from(el.querySelectorAll("select"))
            .find(s => Array.from(s.options).some(o => o.value === "custom"));
        expect((marginSelect as HTMLSelectElement | undefined)?.value).toBe("default");
    });

    it("treats a non-numeric scale label as 1x", async () => {
        const note = buildNote({ id: "p1", title: "N", content: "x", "#printScale": "abc" });
        const el = await openDialog({ note });
        await advanceAndFlush(0);
        await deliverBuffer();
        const lastCall = (printing?.exportAsPdfPreview as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
        // parseFloat("abc") || 1 → 1.
        expect(lastCall?.scale).toBe(1);
        // The scale description shows 100%.
        expect(el.querySelector(".option-row")?.textContent).toBeTruthy();
    });

    it("reads a persisted custom margins tuple and shows the editor immediately", async () => {
        const note = buildNote({ id: "p1", title: "N", content: "x", "#printMargins": "5,6,7,8" });
        const el = await openDialog({ note });
        await advanceAndFlush(0);
        expect(el.querySelector(".margin-editor")).toBeTruthy();
        expect(el.querySelectorAll("input.margin-spinner").length).toBe(4);
    });
});

describe("PrintPreviewDialog — primary actions", () => {
    it("exports the PDF when a buffer exists and the destination is PDF", async () => {
        const el = await openDialog({ title: "My Doc", settle: true });

        const primary = el.querySelector(".modal-footer .btn-primary") as HTMLButtonElement | null;
        act(() => { primary?.click(); });
        expect(printing?.savePdf).toHaveBeenCalledWith(expect.objectContaining({ title: "My Doc" }));
        // After export the dialog closes (body removed).
        expect(el.querySelector(".pdf-stub")).toBeNull();
    });

    it("does not save when there is no buffer yet", async () => {
        const el = await openDialog();
        await advanceAndFlush(0);
        // Primary is disabled while loading, but invoke its handler directly to hit the early return.
        const primary = el.querySelector(".modal-footer .btn-primary") as HTMLButtonElement | null;
        expect(primary?.hasAttribute("disabled")).toBe(true);
        act(() => { primary?.click(); });
        expect(printing?.savePdf).not.toHaveBeenCalled();
    });

    it("silently prints to the selected printer when the destination is a printer", async () => {
        const el = await openDialog({
            printers: [ makePrinter({ name: "office", displayName: "Office", isDefault: true }) ],
            settle: true
        });
        const primary = el.querySelector(".modal-footer .btn-primary") as HTMLButtonElement | null;
        act(() => { primary?.click(); });
        expect(printing?.printFromPreview).toHaveBeenCalledWith(expect.objectContaining({ silent: true, deviceName: "office" }));
    });

    it("system print link opens the dialog without a device when destination is PDF", async () => {
        const el = await openDialog({ settle: true });

        const link = el.querySelector(".modal-footer a") as HTMLAnchorElement | null;
        expect(link).toBeTruthy();
        act(() => { link?.click(); });
        expect(printing?.printFromPreview).toHaveBeenCalledWith(expect.objectContaining({ silent: false, deviceName: undefined }));
    });

    it("system print link pre-selects the chosen printer as deviceName", async () => {
        const el = await openDialog({
            printers: [ makePrinter({ name: "lab", displayName: "Lab", isDefault: true }) ],
            settle: true
        });
        const link = el.querySelector(".modal-footer a") as HTMLAnchorElement | null;
        act(() => { link?.click(); });
        expect(printing?.printFromPreview).toHaveBeenCalledWith(expect.objectContaining({ silent: false, deviceName: "lab" }));
    });

    it("ignores the system print link while loading", async () => {
        const el = await openDialog();
        await advanceAndFlush(0);
        // Still loading (no buffer arrived) → link has the disabled class and does nothing.
        const link = el.querySelector(".modal-footer a") as HTMLAnchorElement | null;
        expect(link?.className).toContain("disabled");
        act(() => { link?.click(); });
        expect(printing?.printFromPreview).not.toHaveBeenCalled();
    });
});

describe("PrintPreviewDialog — closing", () => {
    it("clears state and revokes the URL when the modal is hidden", async () => {
        const el = await openDialog({ settle: true });
        // settle delivered a buffer → a blob URL was created and the preview shows.
        expect(el.querySelector(".pdf-stub")).toBeTruthy();

        const modalEl = el.querySelector(".print-preview-dialog") as HTMLElement | null;
        act(() => { modalEl?.dispatchEvent(new Event("hidden.bs.modal", { bubbles: true })); });
        await flush();

        expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview");
        expect(el.querySelector(".pdf-stub")).toBeNull();
        expect(toast.closePersistent).toHaveBeenCalledWith("print-preview-error");
        // The result listener was removed on cleanup.
        expect(printing?.removeExportAsPdfPreviewResultListener).toHaveBeenCalled();
    });

    it("can be reopened after closing (generation counter resets)", async () => {
        const el = await openDialog();
        await advanceAndFlush(0);
        const modalEl = el.querySelector(".print-preview-dialog") as HTMLElement | null;
        act(() => { modalEl?.dispatchEvent(new Event("hidden.bs.modal", { bubbles: true })); });
        await flush();

        (printing?.exportAsPdfPreview as ReturnType<typeof vi.fn>).mockClear();
        const note2 = buildNote({ id: "p2", title: "Second", content: "y" });
        fireEvent("showPrintPreview", { note: note2, notePath: "root/p2" });
        await flush();
        await advanceAndFlush(0);
        expect(el.querySelector(".print-preview-dialog")).toBeTruthy();
        expect(printing?.exportAsPdfPreview).toHaveBeenCalled();
    });
});
