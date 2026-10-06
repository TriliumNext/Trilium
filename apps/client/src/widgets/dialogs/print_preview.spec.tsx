import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Component from "../../components/component";
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
});
