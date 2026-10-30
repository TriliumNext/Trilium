import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Heavy seams are mocked so the suite stays light (no real content renderer / note-list
// engine, no Puppeteer). `getRenderedContent` is mocked both to avoid pulling in
// DOMPurify/mermaid/wheel-zoom and so we can hand back a precise DOM (images with a
// controlled `complete` flag) to drive the image-wait branches deterministically.
// `CustomNoteList` is mocked to a marker that records the props it receives, which is
// also how we reach `App`'s inline `onReady`/`onProgressChanged` callbacks.
const h = vi.hoisted(() => ({
    getRenderedContent: vi.fn(),
    noteListProps: null as any
}));

vi.mock("./services/content_renderer", () => ({
    default: { getRenderedContent: h.getRenderedContent }
}));

vi.mock("./widgets/collections/NoteList", () => ({
    useNoteViewType: () => "grid",
    CustomNoteList: (props: any) => {
        h.noteListProps = props;
        return "NOTELIST";
    }
}));

// The page opened in place of the app loads the translation catalogue over HTTP; keep that offline.
// `t()` returns the key, so a message reads the same without a loaded catalogue.
vi.mock("./services/i18n", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./services/i18n")>()),
    initLocale: vi.fn(),
    t: (key: string) => key
}));

import Component from "./components/component";
import { App, Error404, loadCustomCss, main, PrintPageToolbar, SingleNoteRenderer } from "./print";
import froca from "./services/froca";
import { initLocale } from "./services/i18n";
import { buildNote } from "./test/easy-froca";

const containers: HTMLDivElement[] = [];
function renderInto(vnode: any) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    containers.push(container);
    render(vnode, container);
    return container;
}

function makeImage(complete: boolean) {
    const img = document.createElement("img");
    Object.defineProperty(img, "complete", { value: complete, configurable: true });
    return img;
}

const countPageStyles = () =>
    [...document.head.querySelectorAll("style")].filter((s) => (s.textContent ?? "").includes("@page")).length;

beforeEach(() => {
    // Don't let happy-dom try to fetch the <link> stylesheets we append (font + printCss).
    const happyDOM = (window as any).happyDOM;
    if (happyDOM?.settings) {
        happyDOM.settings.disableCSSFileLoading = true;
        happyDOM.settings.handleDisabledFileLoadingAsSuccess = true;
    }
    // happy-dom has no FontFaceSet, so `document.fonts.ready` would throw without this stub.
    (document as any).fonts = { ready: Promise.resolve() };
    h.getRenderedContent.mockReset();
    h.getRenderedContent.mockResolvedValue({ $renderedContent: [] });
    h.noteListProps = null;
    window._noteReady = undefined;
    delete (window as any).electronApi;
    window.location.hash = "";
});

afterEach(() => {
    for (const container of containers) {
        render(null, container);
        container.remove();
    }
    containers.length = 0;
    document.body.replaceChildren();
    document.head
        .querySelectorAll('link[href="api/fonts"], link[href^="/api/notes/"]')
        .forEach((n) => n.remove());
    [...document.head.querySelectorAll("style")]
        .filter((s) => (s.textContent ?? "").includes("@page"))
        .forEach((n) => n.remove());
    delete (window as any).electronApi;
    window._noteReady = undefined;
    window.location.hash = "";
});

describe("Error404", () => {
    it("shows the not-found message and the requested note id", () => {
        const container = renderInto(<Error404 noteId="abc123" />);
        expect(container.querySelector("small")?.textContent).toBe("abc123");
        expect(container.querySelector("p")).toBeTruthy();
    });
});

describe("App", () => {
    it("renders Error404 when the note is missing", () => {
        const container = renderInto(<App note={null} noteId="missing" />);
        expect(container.querySelector("small")?.textContent).toBe("missing");
    });

    it("renders SingleNoteRenderer for a non-book note", () => {
        const note = buildNote({ id: "app-text", title: "Hello", type: "text" });
        const container = renderInto(<App note={note} noteId="app-text" />);
        expect(container.querySelector("h1")?.textContent).toBe("Hello");
        expect(container.querySelector("main")).toBeTruthy();
        expect(document.body.dataset.noteType).toBe("text");
    });

    it("renders CollectionRenderer for a book note and wires its callbacks", async () => {
        buildNote({ id: "root", title: "root", children: [{ id: "app-book", title: "Book", type: "book" }] });
        const note = await froca.getNote("app-book");
        const container = renderInto(<App note={note} noteId="app-book" />);

        expect(container.textContent).toContain("NOTELIST");
        expect(document.body.dataset.noteType).toBe("book");
        expect(h.noteListProps).toBeTruthy();

        // onProgressChanged: dispatches a window event in the browser...
        const progressEvents: number[] = [];
        const progressListener = (e: Event) => progressEvents.push((e as CustomEvent).detail.progress);
        window.addEventListener("note-load-progress", progressListener);
        h.noteListProps.onProgressChanged(42);
        expect(progressEvents).toEqual([42]);

        // ...and forwards to Electron when present.
        const sendPrintProgress = vi.fn();
        window.electronApi = { printing: { sendPrintProgress } } as any;
        h.noteListProps.onProgressChanged(99);
        expect(sendPrintProgress).toHaveBeenCalledWith(99);
        window.removeEventListener("note-load-progress", progressListener);

        // onReady: dispatches "note-ready" once and records the report on window; later calls are ignored.
        const readyListener = vi.fn();
        window.addEventListener("note-ready", readyListener);
        const report = { type: "collection" as const, ignoredNoteIds: [] };
        await h.noteListProps.onReady(report);
        expect(readyListener).toHaveBeenCalledTimes(1);
        expect(window._noteReady).toEqual(report);
        await h.noteListProps.onReady({ type: "collection", ignoredNoteIds: ["x"] });
        expect(readyListener).toHaveBeenCalledTimes(1);
        window.removeEventListener("note-ready", readyListener);
    });

    it("renders CollectionRenderer for a search note, whose results print as a list", async () => {
        const loadSearchNote = vi.spyOn(froca, "loadSearchNote").mockResolvedValue(undefined);
        buildNote({ id: "root", title: "root", children: [{ id: "app-search", title: "Search", type: "search" }] });
        const note = await froca.getNote("app-search");
        const container = renderInto(<App note={note} noteId="app-search" />);

        await vi.waitFor(() => expect(container.textContent).toContain("NOTELIST"));
        expect(loadSearchNote).toHaveBeenCalledWith("app-search");
        expect(document.body.dataset.noteType).toBe("search");
        loadSearchNote.mockRestore();
    });

    it("reports a failed saved search instead of printing an empty list", async () => {
        const loadSearchNote = vi.spyOn(froca, "loadSearchNote").mockResolvedValue({ error: "Unknown label 'year'" });
        buildNote({ id: "root", title: "root", children: [{ id: "app-search-failed", title: "Broken", type: "search" }] });
        const note = await froca.getNote("app-search-failed");

        const readyListener = vi.fn();
        window.addEventListener("note-ready", readyListener);
        const container = renderInto(<App note={note} noteId="app-search-failed" />);

        await vi.waitFor(() => expect(readyListener).toHaveBeenCalledOnce());
        expect((readyListener.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({ type: "error", message: "Unknown label 'year'" });
        expect(container.textContent).not.toContain("NOTELIST");

        window.removeEventListener("note-ready", readyListener);
        loadSearchNote.mockRestore();
    });
});

describe("SingleNoteRenderer", () => {
    it("renders a spreadsheet note as inline HTML tables, falling back to empty when the blob is missing", async () => {
        const note = buildNote({ id: "sheet", title: "Sheet", type: "spreadsheet", content: "" });
        const onReady = vi.fn();
        const container = renderInto(<SingleNoteRenderer note={note} onReady={onReady} onProgressChanged={() => {}} />);

        await vi.waitFor(() => expect(onReady).toHaveBeenCalledWith({ type: "single-note" }));
        expect(container.querySelector("main")?.innerHTML).toContain("Unable to parse spreadsheet data");

        // A spreadsheet whose blob can't be loaded falls back to an empty string.
        const empty = buildNote({ id: "sheet-empty", title: "Empty", type: "spreadsheet" });
        empty.getBlob = async () => null;
        const onReadyEmpty = vi.fn();
        const emptyContainer = renderInto(<SingleNoteRenderer note={empty} onReady={onReadyEmpty} onProgressChanged={() => {}} />);

        await vi.waitFor(() => expect(onReadyEmpty).toHaveBeenCalledWith({ type: "single-note" }));
        expect(emptyContainer.querySelector("main")?.innerHTML).toContain("Unable to parse spreadsheet data");
    });

    it("renders a text note and waits for every image (complete, load, error, lazy)", async () => {
        const note = buildNote({ id: "rich", title: "Rich", type: "text" });
        const completeImg = makeImage(true);
        const loadImg = makeImage(false);
        const errorImg = makeImage(false);
        const lazyImg = makeImage(false);
        lazyImg.setAttribute("loading", "lazy");
        h.getRenderedContent.mockResolvedValueOnce({ $renderedContent: [completeImg, loadImg, errorImg, lazyImg] });
        const onReady = vi.fn();
        renderInto(<SingleNoteRenderer note={note} onReady={onReady} onProgressChanged={() => {}} />);

        await vi.waitFor(() => {
            // Re-firing once the listeners are attached resolves the pending image promises.
            loadImg.dispatchEvent(new Event("load"));
            errorImg.dispatchEvent(new Event("error"));
            lazyImg.dispatchEvent(new Event("load"));
            expect(onReady).toHaveBeenCalledWith({ type: "single-note" });
        });
        expect(lazyImg.getAttribute("loading")).toBe("eager");
        // Printing preserves full embed nesting via expandNestedEmbeds.
        expect(h.getRenderedContent).toHaveBeenCalledWith(note, { noChildrenList: true, expandNestedEmbeds: true, mediaEnvironment: "native", parentComponent: expect.any(Component) });
    });

    it("gives a render note a root component for its JSX to mount under", async () => {
        const note = buildNote({ id: "render", title: "Render", type: "render" });
        const onReady = vi.fn();
        renderInto(<SingleNoteRenderer note={note} onReady={onReady} onProgressChanged={() => {}} />);

        await vi.waitFor(() => expect(onReady).toHaveBeenCalledWith({ type: "single-note" }));
        expect(h.getRenderedContent.mock.lastCall?.[1]?.parentComponent).toBeInstanceOf(Component);
    });

    it("renders a non-text, non-spreadsheet note via the content renderer", async () => {
        const note = buildNote({ id: "img", title: "Image", type: "image" });
        const onReady = vi.fn();
        renderInto(<SingleNoteRenderer note={note} onReady={onReady} onProgressChanged={() => {}} />);

        await vi.waitFor(() => expect(onReady).toHaveBeenCalledWith({ type: "single-note" }));
        // Printing preserves full embed nesting via expandNestedEmbeds.
        expect(h.getRenderedContent).toHaveBeenCalledWith(note, { noChildrenList: true, expandNestedEmbeds: true, mediaEnvironment: "native", parentComponent: expect.any(Component) });
    });
});

describe("loadCustomCss", () => {
    it("links code/css targets, skips others and tolerates missing or failing targets", async () => {
        const codeNote = buildNote({ id: "css-code", title: "Code CSS", type: "code" });
        const cssMimeNote = buildNote({ id: "css-mime", title: "Mime CSS", type: "image" });
        cssMimeNote.mime = "text/css";
        const textNote = buildNote({ id: "css-text", title: "Not CSS", type: "text" });
        const note = buildNote({ id: "host", title: "Host" });
        note.getRelationTargets = async () => [null, codeNote, cssMimeNote, textNote];
        // Let happy-dom fail the stylesheet loads it blocks, as a missing download would.
        (window as any).happyDOM.settings.handleDisabledFileLoadingAsSuccess = false;
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

        const promise = loadCustomCss(note);

        const codeLink = await vi.waitFor(() => {
            const link = document.head.querySelector<HTMLLinkElement>('link[href="api/notes/css-code/download"]');
            expect(link).toBeTruthy();
            return link;
        });
        expect(document.head.querySelector('link[href="api/notes/css-mime/download"]')).toBeTruthy();
        await promise;
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("css-code"));
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("css-mime"));
        warn.mockRestore();

        expect(codeLink?.rel).toBe("stylesheet");
        // Relative, so it resolves against the app base when Trilium is served from a subpath
        expect(codeLink?.getAttribute("href")).toBe("api/notes/css-code/download");
        expect(document.head.querySelector('link[href="api/notes/css-text/download"]')).toBeNull();
    });
});

describe("main", () => {
    it("no-ops when the hash carries no note id", async () => {
        window.location.hash = "";
        await expect(main()).resolves.toBeUndefined();
    });

    it("injects @page margins (browser) plus the font link and renders the app", async () => {
        buildNote({ id: "main-note", title: "Main Note", type: "text" });
        window.location.hash = "main-note";
        document.title = "Trilium Notes";

        await main();

        expect(countPageStyles()).toBeGreaterThan(0);
        expect(document.head.querySelector('link[href="api/fonts"]')).toBeTruthy();
        const titles = [...document.body.querySelectorAll("h1")].map((el) => el.textContent);
        expect(titles).toContain("Main Note");
        expect(document.title).toBe("Main Note");
    });

    it("skips @page injection under Electron", async () => {
        buildNote({ id: "main-electron", title: "Electron Note", type: "text" });
        window.electronApi = { printing: { sendPrintProgress: vi.fn() } } as any;
        const before = countPageStyles();
        window.location.hash = "main-electron";

        await main();

        expect(countPageStyles()).toBe(before);
        expect(document.body.querySelectorAll("h1").length).toBeGreaterThan(0);
    });
});

describe("printing in place of the app", () => {
    afterEach(() => {
        window.history.replaceState(null, "", "/");
        vi.mocked(initLocale).mockClear();
    });

    /** happy-dom has no `window.print`, so each test installs its own. */
    function stubPrint() {
        const print = vi.fn();
        Object.defineProperty(window, "print", {
            value: print, configurable: true, writable: true
        });
        return print;
    }

    function renderAutoPrint(note: ReturnType<typeof buildNote>) {
        return renderInto(
            <App note={note} noteId={note.noteId} notePath={`root/${note.noteId}`} autoPrint />
        );
    }

    it("shows the toolbar and opens the print sheet once per visit, once ready", async () => {
        const print = stubPrint();
        try {
            const note = buildNote({ id: "auto-note", title: "Auto", type: "text" });
            const container = renderAutoPrint(note);
            expect(container.querySelectorAll(".print-page-toolbar button")).toHaveLength(2);
            await vi.waitFor(() => expect(print).toHaveBeenCalledOnce());

            // Coming back to the same page, as Back then Forward does, does not print again.
            render(null, container);
            window._noteReady = undefined;
            renderAutoPrint(note);
            await vi.waitFor(() => expect(window._noteReady).toBeDefined());
            expect(print).toHaveBeenCalledOnce();
        } finally {
            delete (window as { print?: unknown }).print;
        }
    });

    it("does not print a note that failed to render", async () => {
        const print = stubPrint();
        try {
            h.getRenderedContent.mockRejectedValue(new Error("boom"));
            renderAutoPrint(buildNote({ id: "auto-broken", title: "Broken", type: "text" }));
            await vi.waitFor(() => expect(window._noteReady?.type).toBe("error"));
            expect(print).not.toHaveBeenCalled();
            // The failure shows on the page, outside the printed content.
            const report = () => document.querySelector(".print-page-toolbar .print-page-report");
            await vi.waitFor(() => expect(report()?.textContent).toContain("boom"));
        } finally {
            delete (window as { print?: unknown }).print;
        }
    });

    it("refuses a protected note whose protected session is not open", async () => {
        const print = stubPrint();
        const glob = window.glob;
        window.glob = { ...glob, isProtectedSessionAvailable: false };
        try {
            const note = buildNote({ id: "auto-locked", title: "Locked", type: "text" });
            note.isProtected = true;
            renderAutoPrint(note);
            await vi.waitFor(() => expect(window._noteReady?.type).toBe("error"));
            expect(h.getRenderedContent).not.toHaveBeenCalled();
            expect(print).not.toHaveBeenCalled();
        } finally {
            window.glob = glob;
            delete (window as { print?: unknown }).print;
        }
    });

    it("lists the notes a collection left out, and its buttons go back and print", () => {
        const print = stubPrint();
        const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
        const assign = vi.spyOn(window.location, "assign").mockImplementation(() => {});
        const historyLength = vi.spyOn(window.history, "length", "get");
        try {
            const container = renderInto(<PrintPageToolbar
                notePath="root/book"
                report={{ type: "collection", ignoredNoteIds: [ "a", "b" ] }}
            />);
            expect(container.querySelector(".print-page-report")).toBeTruthy();
            const [ backButton, printButton ] = container.querySelectorAll("button");

            printButton.click();
            expect(print).toHaveBeenCalledOnce();

            // Back returns through the history the app left, or opens the note when there is none.
            historyLength.mockReturnValue(2);
            backButton.click();
            expect(back).toHaveBeenCalledOnce();
            historyLength.mockReturnValue(1);
            backButton.click();
            expect(assign).toHaveBeenCalledWith("./#root/book");

            render(null, container);
            const quiet = renderInto(
                <PrintPageToolbar notePath="root/book" report={{ type: "single-note" }} />
            );
            expect(quiet.querySelector(".print-page-report")).toBeNull();
        } finally {
            back.mockRestore();
            assign.mockRestore();
            historyLength.mockRestore();
            delete (window as { print?: unknown }).print;
        }
    });

    it("loads the translations only for a page opened to print in place of the app", async () => {
        const print = stubPrint();
        try {
            buildNote({ id: "main-plain", title: "Plain", type: "text" });
            window.history.replaceState(null, "", "/?print#main-plain");
            await main();
            expect(initLocale).not.toHaveBeenCalled();
            expect(document.body.querySelector(".print-page-toolbar")).toBeNull();

            buildNote({ id: "main-auto", title: "Auto", type: "text" });
            window.history.replaceState(null, "", "/?print&autoprint#main-auto");
            await main();
            expect(initLocale).toHaveBeenCalledOnce();
            expect(document.body.querySelector(".print-page-toolbar")).toBeTruthy();
            await vi.waitFor(() => expect(print).toHaveBeenCalledOnce());
        } finally {
            delete (window as { print?: unknown }).print;
        }
    });
});
