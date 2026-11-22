import type { AttachmentRow, CachedTocResponse, TocOutlineHeading } from "@triliumnext/commons";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import appContext from "../../components/app_context";
import Component from "../../components/component";
import NoteContext from "../../components/note_context";
import FAttachment from "../../entities/fattachment";
import type { MenuCommandItem } from "../../menus/context_menu";
import froca from "../../services/froca";
import LoadResults from "../../services/load_results";
import options from "../../services/options";
import server from "../../services/server";
import { buildNote } from "../../test/easy-froca";
import { renderInto } from "../../test/render";
import { ParentComponent } from "../react/react_utils";
import type { ClientTocBuild, TocDocumentContext, TocDocumentState } from "./CachedToCProvider";
import { NavigatedInNote } from "./RightPanelWidget";
import TableOfContents from "./TableOfContents";

const { showMenu, getUnavailableReason, rawHtmlRenders } = vi.hoisted(() => ({
    showMenu: vi.fn(),
    getUnavailableReason: vi.fn(async (_entity: unknown): Promise<string | null> => null),
    rawHtmlRenders: { count: 0 }
}));
vi.mock("../../menus/context_menu", () => ({ default: { show: showMenu } }));
vi.mock("../../services/i18n", async (importOriginal) => ({
    ...await importOriginal<typeof import("../../services/i18n")>(),
    t: (key: string) => key
}));
vi.mock("../NoteDetail", () => ({ getUnavailableReason }));
vi.mock("../react/RawHtml", async (importOriginal) => {
    const original = await importOriginal<typeof import("../react/RawHtml")>();
    return {
        ...original,
        default(props: Parameters<typeof original.default>[0]) {
            rawHtmlRenders.count++;
            return original.default(props);
        }
    };
});

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const HEADINGS: TocOutlineHeading[] = [
    { id: "intro", title: "Intro <b>", level: 1, params: { heading: "intro" } },
    { id: "unshown", title: "Unshown", level: 2 },
    { id: "usage", title: "Usage", level: 1, params: { heading: "usage" } }
];

let getToc: ReturnType<typeof vi.spyOn>;
let buildToc: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    showMenu.mockClear();
    getUnavailableReason.mockReset().mockResolvedValue(null);
    getToc = vi.spyOn(server, "getWithSilentErrors");
    buildToc = vi.spyOn(server, "postWithSilentErrors");
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe("CachedToCProvider", () => {
    it("waits for the shown document, then lists the cache of its blob", async () => {
        answerToc({ status: "ready", blobId: "blobA", headings: HEADINGS });
        const outline = await renderOutline();
        expect(outline.container.querySelector(".cached-toc-waiting")).not.toBeNull();
        expect(getToc).not.toHaveBeenCalled();

        const document = await outline.publish(shown());

        expect(getToc).toHaveBeenCalledWith("notes/doc/toc");
        expect(outline.titles()).toStrictEqual([ "Intro <b>", "Unshown", "Usage" ]);
        expect(outline.rows()[1].classList.contains("disabled")).toBe(true);
        await outline.click(0);
        expect(document.showTarget).toHaveBeenCalledWith({ heading: "intro" });
        expect(outline.onNavigated).toHaveBeenCalledOnce();
        await outline.click(1);
        expect(document.showTarget).toHaveBeenCalledOnce();
        expect(await outline.hasMenu(1)).toBe(false);
    });

    it("copies a reference to a heading from the cache's parameters", async () => {
        answerToc({ status: "ready", blobId: "blobA", headings: HEADINGS });
        const outline = await renderOutline();
        await outline.publish(shown({ linkPath: "root/doc", title: "Manual.docx" }));
        const writes = stubClipboard();

        const items = await outline.openMenu(2);
        items[0].handler?.(items[0], new MouseEvent("click"));

        await vi.waitFor(() => expect(writes).toHaveLength(1));
        const written = await writes[0];
        expect(written["text/plain"]).toBe("#root/doc?heading=usage");
        expect(written["text/html"]).toContain("Manual.docx - Usage");
        restoreClipboard();
    });

    it("leaves the pane where it is after a click that showed nothing", async () => {
        answerToc({ status: "ready", blobId: "blobA", headings: HEADINGS });
        const outline = await renderOutline();
        await outline.publish(shown({ showTarget: vi.fn(() => false) }));

        await outline.click(0);

        expect(outline.onNavigated).not.toHaveBeenCalled();
    });

    it("holds an answer for another blob, and drops the answer of an older blob", async () => {
        const older = deferred<CachedTocResponse>();
        getToc.mockReturnValueOnce(older.promise);
        answerToc({ status: "ready", blobId: "blobA", headings: HEADINGS });
        const outline = await renderOutline();
        await outline.publish(shown({ renderedBlobId: "blobOld" }));
        await outline.publish(shown());
        await act(async () => older.resolve({
            status: "ready", blobId: "blobOld", headings: [ heading("old") ]
        }));
        expect(outline.titles()).toStrictEqual([ "Intro <b>", "Unshown", "Usage" ]);

        answerToc({ status: "ready", blobId: "blobB", headings: [ heading("newer") ] });
        await outline.publish(shown({ renderedBlobId: "blobC" }));

        expect(outline.titles()).toStrictEqual([ "Intro <b>", "Unshown", "Usage" ]);
        expect(await outline.hasMenu(0)).toBe(false);

        answerToc({ status: "missing" });
        buildToc.mockResolvedValueOnce({ status: "ready", blobId: "blobB", headings: [] });
        await outline.publish(shown({ renderedBlobId: "blobD" }));
        expect(outline.titles()).toStrictEqual([ "Intro <b>", "Unshown", "Usage" ]);
        expect(outline.text()).not.toContain("toc.no_headings");
    });

    it("keeps the stale rows during a build, clickable and without menu, and inert while rendering",
        async () => {
        answerToc({ status: "stale", blobId: "blobA", headings: HEADINGS });
        const build = deferred<CachedTocResponse>();
        buildToc.mockReturnValueOnce(build.promise);
        const outline = await renderOutline();
        const document = await outline.publish(shown({ renderedBlobId: "blobB" }));

        expect(buildToc).toHaveBeenCalledWith("notes/doc/toc/build");
        expect(outline.titles()).toStrictEqual([ "Intro <b>", "Unshown", "Usage" ]);
        expect(await outline.hasMenu(0)).toBe(false);
        await outline.click(0);
        expect(document.showTarget).toHaveBeenCalledWith({ heading: "intro" });

        expect(outline.container.querySelector(".toc.inert")).toBeNull();
        await outline.publish({ status: "rendering" });
        expect(outline.container.querySelector(".toc.inert")).not.toBeNull();
        outline.onNavigated.mockClear();
        await outline.click(2);
        expect(document.showTarget).toHaveBeenCalledOnce();
        expect(outline.onNavigated).not.toHaveBeenCalled();
        expect(await outline.hasMenu(2)).toBe(false);

        await act(async () => build.resolve({
            status: "ready", blobId: "blobB", headings: [ heading("rebuilt") ]
        }));
        answerToc({ status: "ready", blobId: "blobB", headings: [ heading("rebuilt") ] });
        const next = await outline.publish(shown({ renderedBlobId: "blobB" }));
        expect(outline.titles()).toStrictEqual([ "rebuilt" ]);
        await outline.click(0);
        expect(next.showTarget).toHaveBeenCalledOnce();
        expect(await outline.hasMenu(0)).toBe(true);
    });

    it("says that it builds while it has no rows to show", async () => {
        answerToc({ status: "missing" });
        buildToc.mockReturnValueOnce(new Promise(() => {}));
        const outline = await renderOutline();

        await outline.publish(shown());

        expect(outline.text()).toContain("toc.building");
        expect(outline.rows()).toHaveLength(0);
    });

    it("offers to try a failed read again, and lists the rows of the next one", async () => {
        getToc.mockRejectedValueOnce(new Error("offline"));
        const outline = await renderOutline();
        await outline.publish(shown());
        expect(outline.text()).toContain("toc.build_failed");

        getToc.mockRejectedValueOnce("Internal Server Error");
        await outline.retry();
        expect(outline.text()).toContain("toc.build_failed");

        answerToc({ status: "ready", blobId: "blobA", headings: HEADINGS });
        await outline.retry();
        expect(getToc).toHaveBeenCalledTimes(3);
        expect(outline.titles()).toHaveLength(3);
    });

    it("ends an unavailable or unreadable answer, and reads again for a new document", async () => {
        answerToc({ status: "unavailable" });
        const outline = await renderOutline();
        await outline.publish(shown());
        expect(outline.text()).toContain("toc.unavailable");
        expect(outline.container.querySelector(".cached-toc button")).toBeNull();

        answerToc({ status: "missing" });
        buildToc.mockResolvedValueOnce({ status: "unavailable" });
        await outline.publish({ status: "rendering" });
        await outline.publish(shown());
        expect(outline.text()).toContain("toc.unavailable");

        answerToc({ status: "missing" });
        buildToc.mockResolvedValueOnce({ status: "unreadable" });
        await outline.publish({ status: "rendering" });
        await outline.publish(shown());
        expect(outline.text()).toContain("toc.build_failed");
    });

    it("tells that a document is not available when its widget gives up or the note is locked",
        async () => {
        getUnavailableReason.mockResolvedValue("protectedSession");
        const outline = await renderOutline();
        expect(outline.text()).toContain("toc.unavailable");

        getUnavailableReason.mockResolvedValue(null);
        answerToc({ status: "ready", blobId: "blobA", headings: HEADINGS });
        await outline.publish({ status: "rendering" });
        await outline.publish(shown());
        expect(outline.titles()).toHaveLength(3);

        await outline.publish({ status: "unavailable" });
        expect(outline.text()).toContain("toc.unavailable");
    });

    it("asks the viewer to build once per load, and takes the cache that its build found",
        async () => {
        answerToc({ status: "missing", pendingToc: { format: "pdf" } });
        const clientBuild = fakeBuild();
        const outline = await renderOutline();

        await outline.publish(shown({ clientBuild }));
        expect(clientBuild.request).toHaveBeenCalledOnce();
        expect(outline.text()).toContain("toc.building");
        // A position update before the build reports that it runs.
        await outline.publish(shown({ clientBuild }));
        expect(clientBuild.request).toHaveBeenCalledOnce();

        clientBuild.status = "building";
        await outline.publish(shown({ clientBuild }));
        clientBuild.status = "idle";
        clientBuild.ready = { blobId: "blobA", headings: HEADINGS };
        await outline.publish(shown({ clientBuild }));

        expect(outline.titles()).toHaveLength(3);
        expect(clientBuild.request).toHaveBeenCalledOnce();
        expect(getToc).toHaveBeenCalledOnce();
    });

    it("waits for a running build, and asks again only after a failure on Try again", async () => {
        answerToc({ status: "missing", pendingToc: { format: "pdf" } });
        const clientBuild = fakeBuild("building");
        const outline = await renderOutline();
        await outline.publish(shown({ clientBuild }));
        expect(clientBuild.request).not.toHaveBeenCalled();

        clientBuild.status = "failed";
        await outline.publish(shown({ clientBuild }));
        expect(outline.text()).toContain("toc.build_failed");

        clientBuild.request.mockImplementation(() => {
            clientBuild.status = "building";
        });
        answerToc({ status: "missing", pendingToc: { format: "pdf" } });
        await outline.retry();
        expect(clientBuild.request).toHaveBeenCalledOnce();
        clientBuild.status = "idle";
        clientBuild.ready = { blobId: "blobA", headings: HEADINGS };
        await outline.publish(shown({ clientBuild }));
        expect(outline.titles()).toHaveLength(3);
    });

    it("fails a document that waits for a viewer without one", async () => {
        answerToc({ status: "missing", pendingToc: { format: "pdf" } });
        const outline = await renderOutline();

        await outline.publish(shown());

        expect(outline.text()).toContain("toc.build_failed");
    });

    it("reads again when a cache of its note changes", async () => {
        answerToc({ status: "missing", pendingToc: { format: "pdf" } });
        const outline = await renderOutline();
        await outline.publish(shown({ clientBuild: fakeBuild("building") }));

        answerToc({ status: "ready", blobId: "blobA", headings: HEADINGS });
        await outline.reloadCache("other");
        expect(getToc).toHaveBeenCalledOnce();
        await outline.reloadCache("doc");

        expect(getToc).toHaveBeenCalledTimes(2);
        expect(outline.titles()).toHaveLength(3);
    });

    it("loads nothing while the outline is hidden", async () => {
        const observers: (() => void)[] = [];
        const { ResizeObserver } = globalThis;
        globalThis.ResizeObserver = class {
            constructor(callback: () => void) {
                observers.push(callback);
            }
            observe() {}
            disconnect() {}
        } as unknown as typeof ResizeObserver;
        try {
            answerToc({ status: "ready", blobId: "blobA", headings: HEADINGS });
            const outline = await renderOutline();
            outline.container.style.display = "none";
            await outline.publish(shown());
            expect(getToc).not.toHaveBeenCalled();

            outline.container.style.display = "";
            await act(async () => observers.at(-1)?.());
            await settle();
            expect(outline.titles()).toHaveLength(3);
        } finally {
            globalThis.ResizeObserver = ResizeObserver;
        }
    });

    it("re-renders no row for a position update that keeps the active heading", async () => {
        answerToc({ status: "ready", blobId: "blobA", headings: HEADINGS });
        const outline = await renderOutline();
        await outline.publish(shown({ findActiveHeading: () => "usage" }));
        expect(outline.rows()[2].classList.contains("active")).toBe(true);

        const renders = rawHtmlRenders.count;
        await outline.publish(shown({ findActiveHeading: () => "usage" }));
        expect(rawHtmlRenders.count).toBe(renders);

        await outline.publish(shown({ findActiveHeading: () => "intro" }));
        expect(outline.rows()[0].classList.contains("active")).toBe(true);
    });
});

describe("the outline of an attachment", () => {
    /** An attachment of the note that `renderOutline()` builds, in froca. */
    function buildAttachment(attachmentId: string) {
        return new FAttachment(froca, {
            attachmentId, ownerId: "doc", role: "file", mime: DOCX_MIME, title: "Manual.docx",
            blobId: "blobA", dateModified: "", utcDateModified: "",
            utcDateScheduledForErasureSince: "", contentLength: 1
        });
    }

    it("ignores the entry of another attachment than the one in view", async () => {
        buildAttachment("attB");
        answerToc({ status: "ready", blobId: "blobA", headings: HEADINGS });
        const outline = await renderOutline("text/html",
            { viewMode: "attachments", attachmentId: "attB" });

        await outline.publish(shown({ attachmentId: "attA", tocUrl: "attachments/attA/toc" }));
        expect(getToc).not.toHaveBeenCalled();
        expect(outline.container.querySelector(".cached-toc-waiting")).not.toBeNull();

        await outline.publish(shown({ attachmentId: "attB", tocUrl: "attachments/attB/toc" }));
        expect(getToc).toHaveBeenCalledWith("attachments/attB/toc");
        expect(outline.titles()).toHaveLength(3);
    });

    it("tells whether the attachment in view is available, whatever its owner's blob", async () => {
        const attachment = buildAttachment("attS");
        getUnavailableReason.mockImplementation(async (entity) => (
            entity === attachment ? null : "blobStub"));
        answerToc({ status: "ready", blobId: "blobA", headings: HEADINGS });
        const outline = await renderOutline("text/html",
            { viewMode: "attachments", attachmentId: "attS" });
        await outline.publish(shown({ attachmentId: "attS", tocUrl: "attachments/attS/toc" }));
        expect(getUnavailableReason).toHaveBeenCalledWith(attachment);
        expect(outline.titles()).toHaveLength(3);

        getUnavailableReason.mockImplementation(async (entity) => (
            entity === attachment ? "blobStub" : null));
        await outline.publish({ status: "rendering", attachmentId: "attS" });
        expect(outline.text()).toContain("toc.unavailable");
    });
});

describe("the outline of a file note", () => {
    it("comes from the ToC cache for a Word document, and is absent for a presentation",
        async () => {
        answerToc({ status: "ready", blobId: "blobA", headings: HEADINGS });
        const docx = await renderOutline();
        expect(docx.container.querySelector(".cached-toc")).not.toBeNull();

        const pptx = await renderOutline(
            "application/vnd.openxmlformats-officedocument.presentationml.presentation");
        expect(pptx.container.querySelector(".cached-toc")).toBeNull();
        expect(pptx.container.querySelector(".toc")).toBeNull();
    });
});

/** Answers the next read of the ToC cache with `answer`. */
function answerToc(answer: CachedTocResponse) {
    getToc.mockResolvedValueOnce(answer);
}

function heading(title: string): TocOutlineHeading {
    return { id: title, title, level: 1, params: { heading: title } };
}

/** A shown document whose functions are spies. */
function shown(overrides: Partial<TocDocumentContext> = {}): TocDocumentContext {
    return {
        status: "shown",
        tocUrl: "notes/doc/toc",
        renderedBlobId: "blobA",
        ownerNoteId: "doc",
        linkPath: "doc",
        title: "Manual",
        showTarget: vi.fn(() => true),
        findActiveHeading: () => null,
        ...overrides
    };
}

function fakeBuild(status: ClientTocBuild["status"] = "idle") {
    return { status, ready: undefined, request: vi.fn() } as
        ClientTocBuild & { request: ReturnType<typeof vi.fn> };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

async function renderOutline(mime = DOCX_MIME, viewScope?: NoteContext["viewScope"]) {
    options.load({ rightPaneCollapsedItems: "[]" } as Parameters<typeof options.load>[0]);
    const note = buildNote({ id: "doc", title: "Manual", type: "file", mime });
    const noteContext = new NoteContext("cached-toc-ntx");
    noteContext.noteId = note.noteId;
    noteContext.notePath = note.noteId;
    noteContext.parent = appContext;
    if (viewScope) {
        noteContext.viewScope = viewScope;
    }
    Object.defineProperty(noteContext, "note", { get: () => note });
    appContext.tabManager = { getActiveContext: () => noteContext } as typeof appContext.tabManager;
    const onNavigated = vi.fn();

    const parent = new Component();
    appContext.child(parent);
    let container!: HTMLElement;
    await act(async () => {
        container = renderInto(
            <ParentComponent.Provider value={parent}>
                <NavigatedInNote.Provider value={onNavigated}>
                    <TableOfContents />
                </NavigatedInNote.Provider>
            </ParentComponent.Provider>
        );
    });
    await settle();

    const rows = () => [ ...container.querySelectorAll<HTMLElement>(".toc li") ];
    async function openMenu(index: number) {
        showMenu.mockClear();
        const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
        act(() => { rows()[index].dispatchEvent(event); });
        await settle();
        return showMenu.mock.calls[0]?.[0]?.items as MenuCommandItem<string>[];
    }
    return {
        container,
        onNavigated,
        rows,
        text: () => container.textContent ?? "",
        titles: () => rows().map((row) => row.querySelector(".item-content")?.textContent),
        async publish<T extends TocDocumentState>(state: T) {
            await act(async () => noteContext.setContextData("tocDocument", state));
            await settle();
            return state;
        },
        async click(index: number) {
            const content = rows()[index].querySelector<HTMLElement>(".item-content");
            await act(async () => content?.click());
        },
        openMenu,
        async hasMenu(index: number) {
            return !!await openMenu(index);
        },
        async retry() {
            const button = container.querySelector<HTMLButtonElement>(".cached-toc button");
            await act(async () => button?.click());
            await settle();
        },
        async reloadCache(ownerId: string) {
            const loadResults = new LoadResults([]);
            loadResults.addAttachmentRow({ ownerId, role: "tocCache" } as AttachmentRow);
            await act(async () => { parent.handleEvent("entitiesReloaded", { loadResults }); });
            await settle();
        }
    };
}

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");

/** A clipboard whose writes read their data, as a browser does; returns the written data. */
function stubClipboard() {
    const writes: Promise<Record<string, string>>[] = [];
    (globalThis as Record<string, unknown>).ClipboardItem = class {
        constructor(public readonly data: Record<string, Promise<Blob>>) {}
    };
    Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
            write: vi.fn((items: { data: Record<string, Promise<Blob>> }[]) => {
                const entries = Object.entries(items[0].data).map(async ([ type, blob ]) =>
                    [ type, await (await blob).text() ] as const);
                const written = Promise.all(entries).then(Object.fromEntries);
                writes.push(written);
                return written.then(() => undefined);
            })
        }
    });
    return writes;
}

function restoreClipboard() {
    delete (globalThis as Record<string, unknown>).ClipboardItem;
    if (originalClipboard) {
        Object.defineProperty(navigator, "clipboard", originalClipboard);
    }
}

async function settle(rounds = 5) {
    for (let i = 0; i < rounds; i++) {
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    }
}
