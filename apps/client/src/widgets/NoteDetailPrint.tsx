import appContext from "../components/app_context";
import type NoteContext from "../components/note_context";
import type FNote from "../entities/fnote";
import type { PrintReport } from "../print";
import dialog from "../services/dialog";
import { t } from "../services/i18n";
import { endLivePrint, getLivePrintTarget, printLiveInBrowser } from "../services/live_print";
import toast from "../services/toast.js";
import { isElectron, isIOS, isMobileApp } from "../services/utils";
import type { ExtendedNoteType } from "./note_types";
import { NoteListWithLinks } from "./react/NoteList";

/**
 * Prints the note `NoteDetail` shows: through the print preview on Electron, from the screen for a
 * render note, and otherwise from the print page in a hidden iframe. `NoteDetail` imports this
 * module on the first print.
 */
export function printNote(
    note: FNote, noteContext: NoteContext, container: HTMLElement | null, type: ExtendedNoteType | undefined
) {
    // A render note prints from the screen, keeping its script's state.
    const liveTarget = getLivePrintTarget(container, type);

    if (isElectron() && noteContext.notePath) {
        appContext.triggerCommand("showPrintPreview", { note, notePath: noteContext.notePath, liveTarget });
        return;
    }

    if (liveTarget) {
        void printLiveInBrowser(note, liveTarget);
        return;
    }

    // Every browser on iOS prints the whole tab rather than the frame that asks, so the print
    // page takes over the tab instead of printing from a hidden frame.
    if (isIOS() && !isMobileApp() && noteContext.notePath) {
        void printInThisTab(noteContext.notePath);
        return;
    }

    // Browser fallback: render the print page in a hidden iframe and use window.print().
    console.debug("[print] Opening the print page for", noteContext.notePath);
    showPrintToast("printing");
    const iframe = document.createElement('iframe');
    iframe.src = `?print#${noteContext.notePath}`;
    iframe.className = "print-iframe";
    document.body.appendChild(iframe);
    iframe.onload = () => {
        const printWindow = iframe.contentWindow;
        console.debug("[print] The print page loaded", printWindow ? "" : "without a window");
        if (!printWindow) {
            toast.closePersistent("printing");
            document.body.removeChild(iframe);
            return;
        }

        printWindow.addEventListener("error", (e) => {
            console.error("[print] Uncaught error in the print page:", e.error ?? e.message);
        });
        printWindow.addEventListener("unhandledrejection", (e) => {
            console.error("[print] Unhandled rejection in the print page:", e.reason);
        });

        // A print page that never reports leaves the toast up and prints nothing.
        const watchdog = setTimeout(() => console.warn(
            "[print] The print page has not reported ready; it may have failed to render.",
            { src: iframe.src, noteType: printWindow.document.body.dataset.noteType }
        ), 20_000);

        printWindow.addEventListener("note-load-progress", (e) => {
            console.debug("[print] Progress:", (e as CustomEvent<{ progress: number }>).detail.progress);
            showPrintToast("printing", (e as CustomEvent<{ progress: number }>).detail.progress);
        });

        printWindow.addEventListener("note-ready", (e) => {
            clearTimeout(watchdog);
            toast.closePersistent("printing");

            const report = "detail" in e ? e.detail as PrintReport : undefined;
            console.debug("[print] The print page is ready:", report);
            handlePrintReport(report);

            if (report?.type !== "error") {
                printWindow.print();
            }
            document.body.removeChild(iframe);
        });
    };
}

/**
 * Saves every open note, then opens the print page of `notePath` in this tab, which opens the print
 * sheet itself once the note has rendered. Stays in the app while a save has not landed.
 */
export async function printInThisTab(notePath: string) {
    const ntxIds = appContext.tabManager.getNoteContexts()
        .map((noteContext) => noteContext.ntxId)
        .filter((ntxId): ntxId is string => !!ntxId);
    await appContext.triggerEvent("beforeNoteContextRemove", { ntxIds });

    // `triggerEvent()` logs a failed save instead of throwing, and iOS browsers never ask before
    // leaving a page, so leaving now would drop the changes still queued.
    if (!appContext.isAllSaved()) {
        toast.showMessage(t("app_context.please_wait_for_save"), 10000);
        return;
    }

    // The app's own parameters configure standalone's database worker (`safeMode`), which the
    // print page starts again. `fromApp` tells the print page (`takeOpenedByAppMarker()` in
    // `print.tsx`) that its Back button can return through the history.
    const search = window.location.search.replace(/^\?/, "");
    window.location.assign(`?${search ? `${search}&` : ""}print&autoprint&fromApp#${notePath}`);
}

/** Ends an Electron print, which reports its outcome through `onPrintDone`. */
export function finishElectronPrint(printReport: PrintReport, liveJobId: number | undefined) {
    if (liveJobId !== undefined) endLivePrint(liveJobId);
    toast.closePersistent("printing");
    handlePrintReport(printReport);
}

export function showPrintToast(type: "printing" | "exporting_pdf", progress: number = 0) {
    toast.showPersistent({
        icon: "bx bx-loader-circle bx-spin",
        message: type === "printing" ? t("note_detail.printing") : t("note_detail.printing_pdf"),
        id: "printing",
        progress
    });
}

function handlePrintReport(printReport?: PrintReport) {
    if (!printReport) return;

    if (printReport.type === "error") {
        toast.showPersistent({
            id: "print-error",
            icon: "bx bx-error-circle",
            title: t("note_detail.print_report_error_title"),
            message: printReport.message,
            buttons: printReport.stack ? [
                {
                    text: t("note_detail.print_report_collection_details_button"),
                    onClick(api) {
                        api.dismissToast();
                        dialog.info(<>
                            <p>{printReport.message}</p>
                            <details>
                                <summary>{t("note_detail.print_report_stack_trace")}</summary>
                                <pre style="font-size: 0.85em; overflow-x: auto;">{printReport.stack}</pre>
                            </details>
                        </>, {
                            title: t("note_detail.print_report_error_title")
                        });
                    }
                }
            ] : undefined
        });
    } else if (printReport.type === "collection" && printReport.ignoredNoteIds.length > 0) {
        toast.showPersistent({
            id: "print-report",
            icon: "bx bx-collection",
            title: t("note_detail.print_report_title"),
            message: t("note_detail.print_report_collection_content", { count: printReport.ignoredNoteIds.length }),
            buttons: [
                {
                    text: t("note_detail.print_report_collection_details_button"),
                    onClick(api) {
                        api.dismissToast();
                        dialog.info(<>
                            <h3>{t("note_detail.print_report_collection_details_ignored_notes")}</h3>
                            <NoteListWithLinks noteIds={printReport.ignoredNoteIds} />
                        </>, {
                            title: t("note_detail.print_report_title"),
                            size: "md"
                        });
                    }
                }
            ]
        });
    }
}
