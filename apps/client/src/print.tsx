import { render } from "preact";
import { useCallback, useLayoutEffect, useRef } from "preact/hooks";

import FNote from "./entities/fnote";
import content_renderer from "./services/content_renderer";
import { applyInlineMermaid } from "./services/content_renderer_text";
import { dynamicRequire, isElectron } from "./services/utils";
import { CustomNoteList, useNoteViewType } from "./widgets/collections/NoteList";

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
};

async function main() {
    const notePath = window.location.hash.substring(1);
    const noteId = notePath.split("/").at(-1);
    if (!noteId) return;

    await import("./print.css");
    const froca = (await import("./services/froca")).default;
    const note = await froca.getNote(noteId);

    render(<App note={note} noteId={noteId} />, document.body);
}

function App({ note, noteId }: { note: FNote | null | undefined, noteId: string }) {
    const sentReadyEvent = useRef(false);
    const onProgressChanged = useCallback((progress: number) => {
        if (isElectron()) {
            const { ipcRenderer } = dynamicRequire('electron');
            ipcRenderer.send("print-progress", progress);
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
    }, []);
    const props: RendererProps | undefined | null = note && { note, onReady, onProgressChanged };

    if (!note || !props) return <Error404 noteId={noteId} />;

    useLayoutEffect(() => {
        document.body.dataset.noteType = note.type;
    }, [ note ]);

    return (
        <>
            {note.type === "book"
                ? <CollectionRenderer {...props} />
                : <SingleNoteRenderer {...props} />
            }
        </>
    );
}

function SingleNoteRenderer({ note, onReady }: RendererProps) {
    const containerRef = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        async function load() {
            if (note.type === "text") {
                await import("@triliumnext/ckeditor5/src/theme/ck-content.css");
            }
            const { $renderedContent } = await content_renderer.getRenderedContent(note, { noChildrenList: true });
            const container = containerRef.current!;
            container.replaceChildren(...$renderedContent);

            // Wait for all images to load.
            const images = Array.from(container.querySelectorAll("img"));
            await Promise.all(
                images.map(img => {
                    if (img.complete) return Promise.resolve();
                    return new Promise<void>(resolve => {
                        img.addEventListener("load", () => resolve(), { once: true });
                        img.addEventListener("error", () => resolve(), { once: true });
                    });
                })
            );

            // Initialize mermaid.
            if (note.type === "text") {
                await applyInlineMermaid(container);
            }

            // Check custom CSS.
            await loadCustomCss(note);
        }

        load().then(() => requestAnimationFrame(() => onReady({
            type: "single-note"
        })));
    }, [ note ]);

    return <>
        <h1>{note.title}</h1>
        <main ref={containerRef} />
    </>;
}

function CollectionRenderer({ note, onReady, onProgressChanged }: RendererProps) {
    const viewType = useNoteViewType(note);
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
            onReady(data);
        }}
        onProgressChanged={onProgressChanged}
    />;
}

function Error404({ noteId }: { noteId: string }) {
    return (
        <main>
            <p>The note you are trying to print could not be found.</p>
            <small>{noteId}</small>
        </main>
    );
}

async function loadCustomCss(note: FNote) {
    const printCssNotes = await note.getRelationTargets("printCss");
    const loadPromises: JQueryPromise<void>[] = [];

    for (const printCssNote of printCssNotes) {
        if (!printCssNote || (printCssNote.type !== "code" && printCssNote.mime !== "text/css")) continue;

        const linkEl = document.createElement("link");
        linkEl.href = `/api/notes/${printCssNote.noteId}/download`;
        linkEl.rel = "stylesheet";

        const promise = $.Deferred();
        loadPromises.push(promise.promise());
        linkEl.onload = () => promise.resolve();

        document.head.appendChild(linkEl);
    }

    await Promise.allSettled(loadPromises);
}

main();
