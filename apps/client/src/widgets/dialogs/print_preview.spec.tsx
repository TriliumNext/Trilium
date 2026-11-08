import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Component from "../../components/component";
import { endLivePrint } from "../../services/live_print";
import { buildNote } from "../../test/easy-froca";
import { renderInto } from "../../test/render";
import { ParentComponent } from "../react/react_utils";
import PrintPreviewDialog from "./print_preview";

vi.mock("../../services/i18n", () => ({ t: (key: string) => key }));
vi.mock("../type_widgets/file/PdfViewer", () => ({
    default: ({ pdfUrl }: { pdfUrl: string }) => <div className="pdf-viewer-mock" data-url={pdfUrl} />
}));

type PreviewResult = { buffer?: Uint8Array; error?: string; requestId?: number };

const printing = {
    getPrinters: vi.fn(async () => []),
    exportAsPdfPreview: vi.fn(),
    onExportAsPdfPreviewResult: vi.fn(),
    removeExportAsPdfPreviewResultListener: vi.fn(),
    savePdf: vi.fn(),
    printFromPreview: vi.fn()
};

/** Delivers a result to the listener the dialog registered, as the main process would. */
function deliver(result: PreviewResult) {
    const listener = printing.onExportAsPdfPreviewResult.mock.calls.at(-1)?.[0] as ((r: PreviewResult) => void) | undefined;
    if (!listener) throw new Error("the dialog registered no result listener");
    act(() => listener(result));
}

function requestIds(): unknown[] {
    return printing.exportAsPdfPreview.mock.calls.map(([ opts ]) => (opts as { requestId?: number }).requestId);
}

describe("PrintPreviewDialog", () => {
    let urlCount = 0;

    beforeEach(() => {
        document.body.innerHTML = "";
        for (const fn of Object.values(printing)) fn.mockClear();
        (window as any).electronApi = { printing };
        URL.createObjectURL = vi.fn(() => `blob:preview-${++urlCount}`);
        URL.revokeObjectURL = vi.fn();
        // happy-dom has no FontFaceSet, which a live print waits on.
        (document as any).fonts = { ready: Promise.resolve() };
    });

    afterEach(() => {
        delete (window as any).electronApi;
    });

    it("ignores the result of a request a newer one has superseded", async () => {
        const note = buildNote({ id: "print-me", title: "Print me" });
        const host = new Component();
        renderInto(
            <ParentComponent.Provider value={host}>
                <PrintPreviewDialog />
            </ParentComponent.Provider>
        );
        await act(async () => {
            await host.handleEvent("showPrintPreview", { note, notePath: "root/print-me" });
        });
        await vi.waitFor(() => expect(printing.exportAsPdfPreview).toHaveBeenCalledTimes(1));

        // A settings change while the first render is still running starts a second one.
        const pageRanges = document.querySelector<HTMLInputElement>(".print-preview-page-ranges");
        expect(pageRanges).toBeTruthy();
        act(() => {
            if (!pageRanges) return;
            pageRanges.value = "1";
            pageRanges.dispatchEvent(new Event("input", { bubbles: true }));
        });
        await vi.waitFor(() => expect(printing.exportAsPdfPreview).toHaveBeenCalledTimes(2), { timeout: 2000 });
        const [ firstId, secondId ] = requestIds();
        expect(firstId).not.toBe(secondId);

        deliver({ requestId: secondId as number, buffer: new Uint8Array([ 1 ]) });
        const viewer = () => document.querySelector(".pdf-viewer-mock");
        expect(viewer()?.getAttribute("data-url")).toBe(`blob:preview-${urlCount}`);
        const currentUrl = viewer()?.getAttribute("data-url");

        // The first request finishing late, with an error or a PDF, changes nothing.
        deliver({ requestId: firstId as number, error: "stale failure" });
        expect(document.querySelector(".print-preview-pane .no-items")).toBeNull();
        expect(viewer()?.getAttribute("data-url")).toBe(currentUrl);

        deliver({ requestId: firstId as number, buffer: new Uint8Array([ 2 ]) });
        expect(viewer()?.getAttribute("data-url")).toBe(currentUrl);
    });

    it("prints a live target from the window, keeping it prepared until the print is done", async () => {
        const note = buildNote({ id: "print-live", title: "Live", type: "render" });
        const host = new Component();
        renderInto(
            <ParentComponent.Provider value={host}>
                <PrintPreviewDialog />
            </ParentComponent.Provider>
        );
        const show = async () => {
            const liveTarget = document.createElement("div");
            document.body.appendChild(liveTarget);
            await act(async () => {
                await host.handleEvent("showPrintPreview", { note, notePath: "root/print-live", liveTarget });
            });
            await vi.waitFor(() => expect(printing.exportAsPdfPreview).toHaveBeenCalled());
            return liveTarget;
        };
        const close = () => {
            const closeButton = document.querySelector<HTMLButtonElement>(".print-preview-dialog .btn-close");
            expect(closeButton).toBeTruthy();
            act(() => closeButton?.click());
        };

        // Closing without printing restores the window.
        const cancelled = await show();
        expect(cancelled.classList.contains("print-live-target")).toBe(true);
        expect(printing.exportAsPdfPreview).toHaveBeenCalledWith(expect.objectContaining({ liveJobId: expect.any(Number) }));
        close();
        await vi.waitFor(() => expect(cancelled.classList.contains("print-live-target")).toBe(false));

        // Printing leaves it prepared: `print-done` from the main process ends it.
        printing.exportAsPdfPreview.mockClear();
        const printed = await show();
        deliver({ requestId: requestIds().at(-1) as number, buffer: new Uint8Array([ 1 ]) });
        const systemPrint = document.querySelector<HTMLAnchorElement>(".print-preview-dialog .modal-footer a");
        expect(systemPrint).toBeTruthy();
        act(() => systemPrint?.click());
        expect(printing.printFromPreview).toHaveBeenCalledWith(expect.objectContaining({ liveJobId: expect.any(Number), silent: false }));
        await vi.waitFor(() => expect(document.querySelector(".print-preview-dialog.show")).toBeNull());
        expect(printed.classList.contains("print-live-target")).toBe(true);

        // The main process echoes the job with `print-done`, which ends exactly this live print.
        const { liveJobId } = printing.printFromPreview.mock.calls[0]?.[0] as { liveJobId: number };
        endLivePrint(liveJobId);
        expect(printed.classList.contains("print-live-target")).toBe(false);
    });
});
