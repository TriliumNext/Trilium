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

import { App, Error404, loadCustomCss, main, SingleNoteRenderer } from "./print";
import froca from "./services/froca";
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

    it("renders a text note and waits for every image (complete, load, error)", async () => {
        const note = buildNote({ id: "rich", title: "Rich", type: "text" });
        const completeImg = makeImage(true);
        const loadImg = makeImage(false);
        const errorImg = makeImage(false);
        h.getRenderedContent.mockResolvedValueOnce({ $renderedContent: [completeImg, loadImg, errorImg] });
        const onReady = vi.fn();
        renderInto(<SingleNoteRenderer note={note} onReady={onReady} onProgressChanged={() => {}} />);

        await vi.waitFor(() => {
            // Re-firing once the listeners are attached resolves the pending image promises.
            loadImg.dispatchEvent(new Event("load"));
            errorImg.dispatchEvent(new Event("error"));
            expect(onReady).toHaveBeenCalledWith({ type: "single-note" });
        });
        expect(h.getRenderedContent).toHaveBeenCalledWith(note, { noChildrenList: true });
    });

    it("renders a non-text, non-spreadsheet note via the content renderer", async () => {
        const note = buildNote({ id: "img", title: "Image", type: "image" });
        const onReady = vi.fn();
        renderInto(<SingleNoteRenderer note={note} onReady={onReady} onProgressChanged={() => {}} />);

        await vi.waitFor(() => expect(onReady).toHaveBeenCalledWith({ type: "single-note" }));
        expect(h.getRenderedContent).toHaveBeenCalledWith(note, { noChildrenList: true });
    });
});

describe("loadCustomCss", () => {
    it("links code/css targets, skips others and tolerates missing targets", async () => {
        const codeNote = buildNote({ id: "css-code", title: "Code CSS", type: "code" });
        const cssMimeNote = buildNote({ id: "css-mime", title: "Mime CSS", type: "image" });
        cssMimeNote.mime = "text/css";
        const textNote = buildNote({ id: "css-text", title: "Not CSS", type: "text" });
        const note = buildNote({ id: "host", title: "Host" });
        note.getRelationTargets = async () => [null, codeNote, cssMimeNote, textNote];

        const promise = loadCustomCss(note);

        const codeLink = await vi.waitFor(() => {
            const link = document.head.querySelector<HTMLLinkElement>('link[href="/api/notes/css-code/download"]');
            expect(link).toBeTruthy();
            return link;
        });
        // Fire onload so the deferred resolves and loadCustomCss can settle.
        document.head
            .querySelectorAll<HTMLLinkElement>('link[href^="/api/notes/"]')
            .forEach((link) => link.onload?.(new Event("load")));
        await promise;

        expect(codeLink?.rel).toBe("stylesheet");
        expect(document.head.querySelector('link[href="/api/notes/css-mime/download"]')).toBeTruthy();
        expect(document.head.querySelector('link[href="/api/notes/css-text/download"]')).toBeNull();
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

        await main();

        expect(countPageStyles()).toBeGreaterThan(0);
        expect(document.head.querySelector('link[href="api/fonts"]')).toBeTruthy();
        const titles = [...document.body.querySelectorAll("h1")].map((el) => el.textContent);
        expect(titles).toContain("Main Note");
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
