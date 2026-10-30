import type { LOCALE_IDS } from "@triliumnext/commons";
import { render } from "preact";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

import Component from "./components/component";
import FNote from "./entities/fnote";
import content_renderer from "./services/content_renderer";
import froca from "./services/froca";
import { initLocale, t } from "./services/i18n";
import { waitForPendingRenders } from "./services/pending_renders";
import protected_session_holder from "./services/protected_session_holder";
import { isElectron } from "./services/utils";
import { CustomNoteList, useNoteViewType } from "./widgets/collections/NoteList";
import Button from "./widgets/react/Button";

interface RendererProps {
    note: FNote;
    onReady: (data: PrintReport) => void;
    onProgressChanged?: (progress: number) => void;
}

export type PrintReport = {
    type: "single-note";
} | {
    type: "collection";
    ignoredNoteIds: string[];
} | {
    type: "error";
    message: string;
    stack?: string;
};

export async function main() {
    const notePath = window.location.hash.substring(1);
    const noteId = notePath.split("/").at(-1);
    console.debug("[print] Rendering the print page for", notePath || "(no note path)");
    if (!noteId) return;

    await import("./print.css");

    // Browser printing relies on @page margins since there's no programmatic control.
    // Electron uses printToPDF() margins instead, so we only inject this for the browser path.
    if (!isElectron()) {
        const style = document.createElement("style");
        style.textContent = "@page { margin: 2cm; }";
        document.head.appendChild(style);
    }

    // Load the user's font preferences so that --detail-font-family is available.
    const fontLink = document.createElement("link");
    fontLink.rel = "stylesheet";
    fontLink.href = "api/fonts";
    document.head.appendChild(fontLink);

    // Only the page opened in place of the app shows text of its own, in its toolbar.
    const autoPrint = isAutoPrintPage();
    if (autoPrint) {
        await initLocale((window.glob?.currentLocale?.id ?? "en") as LOCALE_IDS);
    }

    const note = await froca.getNote(noteId);
    console.debug("[print] Note loaded:", noteId, note?.type);

    // printToPDF() and the browser print dialog name the document after document.title.
    if (note?.title) {
        document.title = note.title;
    }

    if (!note) {
        reportPrintError(new Error(`The note to print (${noteId}) could not be loaded.`));
    }

    const bodyWrapper = document.createElement("div");
    render(
        <App note={note} noteId={noteId} notePath={notePath} autoPrint={autoPrint} />,
        bodyWrapper
    );
    document.body.appendChild(bodyWrapper);
}

/**
 * The print page. With `autoPrint`, it stands in place of the app, as it does on iPhone and iPad:
 * it shows a toolbar and opens the print sheet once the note has rendered.
 */
export function App({ note, noteId, notePath, autoPrint }: {
    note: FNote | null | undefined;
    noteId: string;
    notePath?: string;
    autoPrint?: boolean;
}) {
    const sentReadyEvent = useRef(false);
    const [ report, setReport ] = useState<PrintReport>();
    const onProgressChanged = useCallback((progress: number) => {
        if (window.electronApi) {
            window.electronApi.printing.sendPrintProgress(progress);
        } else {
            window.dispatchEvent(new CustomEvent("note-load-progress", { detail: { progress } }));
        }
    }, []);
    const onReady = useCallback((printReport: PrintReport) => {
        if (sentReadyEvent.current) return;
        window.dispatchEvent(new CustomEvent("note-ready", {
            detail: printReport
        }));
        window._noteReady = printReport;
        sentReadyEvent.current = true;

        if (autoPrint) {
            setReport(printReport);
            if (printReport.type !== "error") {
                printOncePerVisit();
            }
        }
    }, [ autoPrint ]);
    const props: RendererProps | undefined | null = note && { note, onReady, onProgressChanged };

    // Keep this hook above the early return so hook order stays stable across renders.
    useLayoutEffect(() => {
        if (note) {
            document.body.dataset.noteType = note.type;
        }
    }, [ note ]);

    const toolbar = autoPrint && notePath
        && <PrintPageToolbar notePath={notePath} report={report} />;

    if (!note || !props) return <>{toolbar}<Error404 noteId={noteId} /></>;

    return (
        <>
            {toolbar}
            {note.type === "book" || note.type === "search"
                ? <CollectionRenderer {...props} />
                : <SingleNoteRenderer {...props} />
            }
        </>
    );
}

/**
 * Back to the note, Print to open the print sheet again, and what the render reported, such as a
 * failure or the notes a collection left out; hidden on paper.
 */
export function PrintPageToolbar({ notePath, report }: { notePath: string; report?: PrintReport }) {
    const message = getReportMessage(report);
    return (
        <div className="print-page-toolbar">
            <Button
                text={t("note_detail.print_page_back")}
                icon="bx bx-arrow-back"
                onClick={() => leavePrintPage(notePath)}
            />
            <Button
                text={t("note_detail.print_page_print")}
                icon="bx bx-printer"
                kind="primary"
                onClick={() => window.print()}
            />
            {message && <p className="print-page-report">{message}</p>}
        </div>
    );
}

export function SingleNoteRenderer({ note, onReady }: RendererProps) {
    const containerRef = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        async function load() {
            const container = containerRef.current;
            /* v8 ignore next -- @preserve: ref is always attached by the time this layout effect runs */
            if (!container) return;

            // Without its protected session, the renderer would print the password notice instead.
            if (note.isProtected && !protected_session_holder.isProtectedSessionAvailable()) {
                throw new Error(t("note_detail.print_protected_locked"));
            }

            if (note.type === "spreadsheet") {
                // Render spreadsheet as HTML tables instead of an image.
                const { renderSpreadsheetToHtml } = await import("@triliumnext/commons/src/lib/spreadsheet/render_to_html");
                const blob = await note.getBlob();
                const html = renderSpreadsheetToHtml(blob?.content ?? "");
                container.innerHTML = html;
            } else {
                if (note.type === "text") {
                    await import("@triliumnext/ckeditor5/src/theme/ck-content.css");
                    await import("@triliumnext/ckeditor5/src/theme/multicolumn.css");
                }
                // Printing preserves full embed nesting (see expandNestedEmbeds). The print page has
                // no component tree, so a JSX render note mounts under a bare root `Component`.
                const { $renderedContent } = await content_renderer.getRenderedContent(note, {
                    noChildrenList: true,
                    expandNestedEmbeds: true,
                    mediaEnvironment: "native",
                    parentComponent: new Component()
                });
                container.replaceChildren(...$renderedContent);

                // Note types rendered as a mounted component (an AI chat) start their transform
                // passes — mermaid, syntax highlighting, embedded notes — in a layout effect that
                // getRenderedContent does not await. Printing snapshots the page, so wait for those
                // to settle first; otherwise they land after the capture and are missing from the PDF.
                await waitForPendingRenders(container);

                // Wait for all images to load. A lazy image, such as a link embed's favicon, never
                // scrolls into the print window's viewport, so it would fire neither `load` nor `error`.
                const images = Array.from(container.querySelectorAll("img"));
                for (const img of images) {
                    img.loading = "eager";
                }
                await Promise.all(
                    images.map(img => {
                        if (img.complete) return Promise.resolve();
                        return new Promise<void>(resolve => {
                            img.addEventListener("load", () => resolve(), { once: true });
                            img.addEventListener("error", () => resolve(), { once: true });
                        });
                    })
                );
            }

            // Check custom CSS.
            await loadCustomCss(note);

            // Wait for all fonts (including those from custom CSS) to finish loading.
            await document.fonts.ready;
        }

        load().then(() => requestAnimationFrame(() => onReady({
            type: "single-note"
        }))).catch((error: unknown) => {
            console.error("[print] Rendering the note failed:", error);
            onReady({
                type: "error",
                message: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined
            });
        });
    }, [ note ]);

    return <>
        <h1>{note.title}</h1>
        <main ref={containerRef} />
    </>;
}

export function CollectionRenderer({ note, onReady, onProgressChanged }: RendererProps) {
    const viewType = useNoteViewType(note);
    // A saved search holds its results as virtual children only once it has run server-side.
    const [ ready, setReady ] = useState(note.type !== "search");

    useEffect(() => {
        if (note.type !== "search") {
            return;
        }

        let cancelled = false;
        console.debug("[print] Running the saved search…");
        void froca.loadSearchNote(note.noteId)
            .then((result) => {
                if (cancelled) return;

                // The query's own errors come back resolved, in `error`.
                if (result?.error) {
                    console.warn("[print] The saved search failed:", result.error);
                    onReady({ type: "error", message: result.error });
                    return;
                }

                console.debug("[print] The saved search run finished.");
                setReady(true);
            })
            .catch((e: unknown) => {
                if (cancelled) return;

                console.warn("[print] Unable to run the saved search being printed:", e);
                onReady({
                    type: "error",
                    message: e instanceof Error ? e.message : String(e),
                    stack: e instanceof Error ? e.stack : undefined
                });
            });
        return () => {
            cancelled = true;
        };
    }, [ note, onReady ]);

    if (!ready) return null;

    return <CustomNoteList
        viewType={viewType}
        isEnabled
        note={note}
        notePath={note.getBestNotePath().join("/")}
        ntxId="print"
        highlightedTokens={null}
        media="print"
        onReady={async (data: PrintReport) => {
            await loadCustomCss(note);
            await document.fonts.ready;
            onReady(data);
        }}
        onProgressChanged={onProgressChanged}
    />;
}

export function Error404({ noteId }: { noteId: string }) {
    return (
        <main>
            <p>The note you are trying to print could not be found.</p>
            <small>{noteId}</small>
        </main>
    );
}

export async function loadCustomCss(note: FNote) {
    const printCssNotes = await note.getRelationTargets("printCss");
    const loadPromises: JQueryPromise<void>[] = [];

    for (const printCssNote of printCssNotes) {
        if (!printCssNote || (printCssNote.type !== "code" && printCssNote.mime !== "text/css")) continue;

        const linkEl = document.createElement("link");
        // Relative like the fonts link above, so it resolves under a subpath deployment
        linkEl.href = `api/notes/${printCssNote.noteId}/download`;
        linkEl.rel = "stylesheet";

        const promise = $.Deferred();
        loadPromises.push(promise.promise());
        linkEl.onload = () => promise.resolve();
        linkEl.onerror = () => {
            console.warn(`Unable to load the print stylesheet ${printCssNote.noteId}; printing without it.`);
            promise.resolve();
        };

        document.head.appendChild(linkEl);
    }

    await Promise.allSettled(loadPromises);
}

/** index.ts holds the splash up until the note has rendered. */
window.addEventListener("error", (e) => console.error("[print] Uncaught error in the print page:", e.error ?? e.message));
window.addEventListener("unhandledrejection", (e) => console.error("[print] Unhandled rejection in the print page:", e.reason));

export const ready = main().catch((error: unknown) => {
    console.error("[print] The print page failed to render:", error);
    reportPrintError(error);
});

/**
 * Tells the window that opened the print page that it should not wait for a render any longer, so a
 * failure shows as the print report rather than as a print that never starts.
 */
function reportPrintError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    window.dispatchEvent(new CustomEvent("note-ready", { detail: { type: "error", message, stack } }));
}

/** Whether this page stands in place of the app (`?print&autoprint`) rather than in a frame. */
function isAutoPrintPage() {
    return window.top === window
        && !isElectron()
        && new URLSearchParams(window.location.search).has("autoprint");
}

/** Opens the print sheet, unless it already opened for this history entry. */
function printOncePerVisit() {
    const state = window.history.state as { printed?: boolean } | null;
    if (state?.printed) return;
    window.history.replaceState({ ...state, printed: true }, "");
    window.print();
}

function getReportMessage(report: PrintReport | undefined) {
    if (report?.type === "error") {
        return `${t("note_detail.print_report_error_title")}: ${report.message}`;
    }
    if (report?.type === "collection" && report.ignoredNoteIds.length > 0) {
        const count = report.ignoredNoteIds.length;
        return t("note_detail.print_report_collection_content", { count });
    }
    return undefined;
}

function leavePrintPage(notePath: string) {
    if (window.history.length > 1) {
        window.history.back();
    } else {
        window.location.assign(`./#${notePath}`);
    }
}
