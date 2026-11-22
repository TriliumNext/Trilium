import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Component from "../../../components/component";
import type NoteContext from "../../../components/note_context";
import type FNote from "../../../entities/fnote";
import { ParentComponent } from "../../react/react_utils";
import type { TocDocumentContext, TocDocumentState } from "../../sidebar/CachedToCProvider";

type RenderArgs = [ entityType: string, entityId: string, options?: { blobId?: string } ];
const renderOfficeToHtml = vi.fn<(...args: RenderArgs) => Promise<{ css: string; html: string }>>();
const { showAnchorElement, scroller, refreshBlobId } = vi.hoisted(() => ({
    showAnchorElement: vi.fn(),
    scroller: { scrollTo: vi.fn() },
    refreshBlobId: vi.fn<(ref: object) => Promise<string | null>>()
}));

vi.mock("../../../services/office_renderer", async (importOriginal) => ({
    ...await importOriginal<typeof import("../../../services/office_renderer")>(),
    renderOfficeToHtml: (...args: RenderArgs) => renderOfficeToHtml(...args)
}));
vi.mock("./toc_build", () => ({ refreshBlobId }));
// The landing scrolls with these; happy-dom lays nothing out.
vi.mock("@triliumnext/ckeditor5/src/plugins/block_reference/block_reference_read_only.js", () => ({
    showAnchorElement,
    getScrollContainer: () => scroller
}));

const { default: OfficePreview } = await import("./Office");
const { OfficePreviewChangedError, OfficePreviewTooLargeError } =
    await import("../../../services/office_renderer");
const { t } = await import("../../../services/i18n");

type OfficeNote = Parameters<typeof OfficePreview>[0]["note"];

let container: HTMLDivElement;

beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
});

afterEach(() => {
    render(null, container);
    container.remove();
    vi.clearAllMocks();
});

function mount(noteId = "office1", blobId = "blob1") {
    const note = { noteId, blobId } as unknown as OfficeNote;
    render(<OfficePreview note={note} />, container);
}

describe("OfficePreview", () => {
    it("shows the loading state, then the sanitized server-rendered HTML for the note", async () => {
        let resolve: (preview: { css: string; html: string }) => void = () => {};
        renderOfficeToHtml.mockReturnValue(new Promise((r) => { resolve = r; }));

        mount("note42");
        // While the conversion is in flight, only the loading placeholder is shown.
        expect(container.querySelector(".office-preview-loading")).not.toBeNull();
        expect(container.querySelector(".office-preview-body")).toBeNull();
        // Effects run after the render tick, so the fetch is observed asynchronously.
        await vi.waitFor(() => expect(renderOfficeToHtml)
            .toHaveBeenCalledWith("notes", "note42", { blobId: "blob1" }));

        resolve({ css: "", html: '<p class="converted-doc">Hello</p>' });
        await vi.waitFor(() => expect(container.querySelector(".converted-doc")?.textContent).toBe("Hello"));

        const body = container.querySelector(".office-preview-body");
        // The preview body opts into text selection (the app disables it globally).
        expect(body?.classList.contains("selectable-text")).toBe(true);
        expect(container.querySelector(".office-preview-loading")).toBeNull();
    });

    it("falls back to the not-available placeholder when the conversion fails", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        renderOfficeToHtml.mockRejectedValue(new Error("conversion exploded"));

        mount();
        await vi.waitFor(() => expect(container.querySelector(".no-items.file-preview-not-available")).not.toBeNull());
        expect(container.querySelector(".no-items")?.textContent).toBe(t("content_renderer.office_render_error"));
        expect(container.querySelector(".office-preview-body")).toBeNull();
    });

    it("says the document is too large when the server refuses it for its size", async () => {
        renderOfficeToHtml.mockRejectedValue(new OfficePreviewTooLargeError());

        mount();
        await vi.waitFor(() => expect(container.querySelector(".no-items.file-preview-not-available")).not.toBeNull());
        expect(container.querySelector(".no-items")?.textContent).toBe(t("content_renderer.office_too_large"));
        expect(container.querySelector(".office-preview-body")).toBeNull();
    });

    it("re-fetches when the note's content (blobId) changes", async () => {
        renderOfficeToHtml.mockResolvedValue({ css: "", html: "<p>v1</p>" });
        mount("note1", "blobA");
        await vi.waitFor(() => expect(container.querySelector(".office-preview-body")).not.toBeNull());

        renderOfficeToHtml.mockResolvedValue({ css: "", html: '<p class="v2">v2</p>' });
        mount("note1", "blobB");
        await vi.waitFor(() => expect(container.querySelector(".v2")).not.toBeNull());
        expect(renderOfficeToHtml).toHaveBeenCalledTimes(2);
    });

    it("discards a conversion that resolves after unmount without touching the DOM", async () => {
        let resolve: (preview: { css: string; html: string }) => void = () => {};
        renderOfficeToHtml.mockReturnValue(new Promise((r) => { resolve = r; }));

        mount();
        // Wait for the effect to start the fetch before unmounting, so the cleanup
        // path (not a never-started effect) is what's exercised.
        await vi.waitFor(() => expect(renderOfficeToHtml).toHaveBeenCalled());
        render(null, container);
        resolve({ css: "", html: "<p>too late</p>" });
        // Let the microtask run; the cancelled effect must not re-render into the container.
        await Promise.resolve();
        expect(container.innerHTML).toBe("");
    });

    it("discards the conversion of a replaced blob that resolves late", async () => {
        const conversions: ((preview: { css: string; html: string }) => void)[] = [];
        renderOfficeToHtml.mockImplementation(() => new Promise((resolve) => {
            conversions.push(resolve);
        }));

        await act(async () => mount("note1", "blobA"));
        await act(async () => mount("note1", "blobB"));
        expect(conversions).toHaveLength(2);

        await act(async () => conversions[0]?.({ css: "", html: "<p class=\"v1\">v1</p>" }));
        expect(container.querySelector(".v1")).toBeNull();
        expect(container.querySelector(".office-preview-loading")).not.toBeNull();

        await act(async () => conversions[1]?.({ css: "", html: "<p class=\"v2\">v2</p>" }));
        expect(container.querySelector(".v2")).not.toBeNull();
    });
});

describe("OfficePreview landing on a link", () => {
    const PREVIEW = "<h2 data-toc-heading=\"idA\">A</h2><h2 data-toc-heading=\"idB\">B</h2>"
        + "<p data-toc-bookmark=\"Intro\">Text</p>";

    it("lands once the preview of the shown blob is in place, and clears the target", async () => {
        const view = await open({ heading: "idA" });

        expect(showAnchorElement).not.toHaveBeenCalled();
        expect(view.viewScope.heading).toBe("idA");

        await view.resolvePreview();
        await vi.waitFor(() => expect(showAnchorElement).toHaveBeenCalledOnce());
        expect(showAnchorElement.mock.calls[0][0].textContent).toBe("A");
        expect(view.viewScope.heading).toBeUndefined();
    });

    it("lands on the latest link that arrives while the preview loads", async () => {
        const view = await open({ heading: "idA" });
        view.viewScope.heading = "idB";
        await view.switchTo(view.note);

        await view.resolvePreview();

        await vi.waitFor(() => expect(showAnchorElement).toHaveBeenCalledOnce());
        expect(showAnchorElement.mock.calls[0][0].textContent).toBe("B");
    });

    it("leaves the target while hidden, and lands once shown", async () => {
        const view = await open({ heading: "idA" }, false);
        await view.resolvePreview();
        await settle();
        expect(showAnchorElement).not.toHaveBeenCalled();
        expect(view.viewScope.heading).toBe("idA");

        await view.rerender(true);

        await vi.waitFor(() => expect(showAnchorElement).toHaveBeenCalledOnce());
        expect(view.viewScope.heading).toBeUndefined();
    });

    it("lands a link to the open note on noteSwitched, a bookmark the same way", async () => {
        const view = await open({});
        await view.resolvePreview();

        view.viewScope.bookmark = "Intro";
        await view.switchTo(view.note);

        await vi.waitFor(() => expect(showAnchorElement).toHaveBeenCalledOnce());
        expect(showAnchorElement.mock.calls[0][0].tagName).toBe("P");
        expect(view.viewScope.bookmark).toBeUndefined();
    });

    it("never takes the target of another note, or of a new blob, against the preview", async () => {
        const view = await open({});
        await view.resolvePreview();

        view.viewScope.heading = "idA";
        await view.switchTo({ noteId: "note2", blobId: "blob2" } as FNote);
        await view.switchTo({ noteId: "note1", blobId: "blob9" } as FNote);
        await settle();

        expect(showAnchorElement).not.toHaveBeenCalled();
        expect(view.viewScope.heading).toBe("idA");
    });

    it("scrolls to the top for an id no element has, and moves nothing without one", async () => {
        const view = await open({});
        await view.resolvePreview();

        await view.switchTo(view.note);
        await settle();
        expect(scroller.scrollTo).not.toHaveBeenCalled();

        view.viewScope.heading = "missing";
        await view.switchTo(view.note);
        await vi.waitFor(() => expect(scroller.scrollTo)
            .toHaveBeenCalledExactlyOnceWith({ top: 0 }));
        expect(showAnchorElement).not.toHaveBeenCalled();
        expect(view.viewScope.heading).toBeUndefined();
    });

    /**
     * Shows the preview of a DOCX note whose view scope holds `scope`, as `File.tsx` does. The
     * fetch of the preview waits for `resolvePreview()`.
     */
    async function open(scope: Record<string, string>, isVisible = true) {
        const note = { noteId: "note1", blobId: "blob1" } as FNote;
        const viewScope: Record<string, string | undefined> = { ...scope };
        const noteContext = { ntxId: "ntx1", note, viewScope } as unknown as NoteContext;
        let resolve: (preview: { css: string; html: string }) => void = () => {};
        renderOfficeToHtml.mockReturnValue(new Promise((done) => {
            resolve = done;
        }));
        const component = new Component();

        function draw(visible: boolean) {
            render(
                <ParentComponent.Provider value={component}>
                    <OfficePreview note={note} noteContext={noteContext} isVisible={visible} />
                </ParentComponent.Provider>, container);
        }
        await act(async () => draw(isVisible));

        return {
            note,
            viewScope,
            async resolvePreview() {
                await act(async () => resolve({ css: "", html: PREVIEW }));
            },
            async rerender(visible: boolean) {
                await act(async () => draw(visible));
            },
            /** Navigates the pane to `shown`, keeping the view scope, as a link does. */
            async switchTo(shown: FNote) {
                (noteContext as { note: FNote }).note = shown;
                await act(async () => {
                    await component.handleEvent("noteSwitched", { noteContext } as never);
                });
            }
        };
    }

    /** Lets the lazy import of the landing and its scroll run. */
    async function settle() {
        await act(async () => {
            await new Promise((done) => setTimeout(done, 20));
        });
    }
});

describe("OfficePreview and the outline", () => {
    const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    const PREVIEW = "<h1 data-toc-heading=\"idA\">A</h1><p>x</p>"
        + "<h2 data-toc-heading=\"idB idC\">B</h2>";

    it("publishes that it renders, then the shown blob once the preview is in place", async () => {
        let resolve: (preview: { css: string; html: string }) => void = () => {};
        renderOfficeToHtml.mockReturnValue(new Promise((done) => {
            resolve = done;
        }));
        const view = await show();
        expect(view.current()).toStrictEqual({ status: "rendering" });

        await act(async () => resolve({ css: "", html: PREVIEW }));

        await vi.waitFor(() => expect(view.current()).toMatchObject({
            status: "shown", tocUrl: "notes/note1/toc", renderedBlobId: "blob1",
            ownerNoteId: "note1", linkPath: "root/note1", title: "Manual"
        }));
    });

    it("lands on a marked heading and stays put for one the preview does not mark", async () => {
        renderOfficeToHtml.mockResolvedValue({ css: "", html: PREVIEW });
        const view = await show();
        const shown = await view.shown();

        expect(shown.showTarget({ heading: "idC" })).toBe(true);
        await vi.waitFor(() => expect(showAnchorElement).toHaveBeenCalledOnce());
        expect(showAnchorElement.mock.calls[0][0].textContent).toBe("B");

        expect(shown.showTarget({ heading: "missing" })).toBe(false);
        await new Promise((done) => setTimeout(done, 20));
        expect(scroller.scrollTo).not.toHaveBeenCalled();
    });

    it("publishes nothing for a format without an outline", async () => {
        renderOfficeToHtml.mockResolvedValue({ css: "", html: PREVIEW });
        const view = await show(
            "application/vnd.openxmlformats-officedocument.presentationml.presentation");
        await vi.waitFor(() => expect(container.querySelector(".office-preview-body"))
            .not.toBeNull());

        expect(view.published).toStrictEqual([]);
    });

    it("renders the blob that the note holds now after a refusal, with no event", async () => {
        renderOfficeToHtml
            .mockRejectedValueOnce(new OfficePreviewChangedError())
            .mockResolvedValueOnce({ css: "", html: PREVIEW });
        refreshBlobId.mockResolvedValueOnce("blob2");
        const view = await show();

        expect((await view.shown()).renderedBlobId).toBe("blob2");
        expect(renderOfficeToHtml.mock.calls).toStrictEqual([
            [ "notes", "note1", { blobId: "blob1" } ], [ "notes", "note1", { blobId: "blob2" } ]
        ]);
        expect(refreshBlobId).toHaveBeenCalledWith({ kind: "note", noteId: "note1" });

        // The note learns of the blob later, and the preview of it stays.
        await act(async () => view.rerender({ ...view.note, blobId: "blob2" } as FNote));
        expect(renderOfficeToHtml).toHaveBeenCalledTimes(2);
    });

    it("gives up after three refusals in a row, and when the read of the blob fails", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        renderOfficeToHtml.mockRejectedValue(new OfficePreviewChangedError());
        refreshBlobId.mockResolvedValue("blobN");
        const view = await show();

        await vi.waitFor(() => expect(view.current()).toStrictEqual({ status: "unavailable" }));
        expect(renderOfficeToHtml).toHaveBeenCalledTimes(3);
        expect(container.querySelector(".file-preview-not-available")).not.toBeNull();

        renderOfficeToHtml.mockClear();
        refreshBlobId.mockRejectedValue(new Error("offline"));
        await act(async () => view.rerender({ ...view.note, blobId: "blob5" } as FNote));
        await vi.waitFor(() => expect(view.published.at(-1))
            .toStrictEqual({ status: "unavailable" }));
        expect(renderOfficeToHtml).toHaveBeenCalledOnce();
    });

    it("publishes unavailable for a preview that is refused or fails", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        renderOfficeToHtml.mockRejectedValueOnce(new OfficePreviewTooLargeError());
        const view = await show();
        await vi.waitFor(() => expect(view.current()).toStrictEqual({ status: "unavailable" }));

        renderOfficeToHtml.mockRejectedValueOnce(new Error("conversion exploded"));
        await act(async () => view.rerender({ ...view.note, blobId: "blob2" } as FNote));
        await vi.waitFor(() => expect(view.published.at(-1))
            .toStrictEqual({ status: "unavailable" }));
        expect(container.querySelector(".no-items")?.textContent)
            .toBe(t("content_renderer.office_render_error"));
        expect(refreshBlobId).not.toHaveBeenCalled();
    });

    it("refuses a target from the showTarget of an older render", async () => {
        renderOfficeToHtml.mockResolvedValue({ css: "", html: PREVIEW });
        const view = await show();
        const older = await view.shown();

        renderOfficeToHtml.mockReturnValue(new Promise(() => {}));
        await act(async () => view.rerender({ ...view.note, blobId: "blob2" } as FNote));

        expect(older.showTarget({ heading: "idA" })).toBe(false);
        expect(showAnchorElement).not.toHaveBeenCalled();
    });

    it("tells the heading being read from the marks, the deepest of shared ones", async () => {
        renderOfficeToHtml.mockResolvedValue({ css: "", html: PREVIEW });
        container.classList.add("note-detail-file");
        const view = await show();
        const activeHeading = () => (view.current() as TocDocumentContext).findActiveHeading([]);
        await vi.waitFor(() => expect(activeHeading()).toBe("idC"));

        vi.spyOn(container.querySelector("h2") as HTMLElement, "getBoundingClientRect")
            .mockReturnValue({ top: 500 } as DOMRect);
        container.dispatchEvent(new Event("scroll"));

        await vi.waitFor(() => expect(activeHeading()).toBe("idA"));
    });

    /** Shows a file note of `mime` in a pane whose context records what is published. */
    async function show(mime = DOCX) {
        const note = {
            noteId: "note1", blobId: "blob1", type: "file", mime, title: "Manual"
        } as FNote;
        const data = new Map<string, unknown>();
        const published: TocDocumentState[] = [];
        const noteContext = {
            ntxId: "ntx1", note, viewScope: {}, notePath: "root/note1",
            setContextData(key: string, value: TocDocumentState) {
                data.set(key, value);
                published.push(value);
            },
            getContextData: (key: string) => data.get(key),
            clearContextData: (key: string) => data.delete(key)
        } as unknown as NoteContext;
        const component = new Component();
        function draw(shownNote: FNote) {
            (noteContext as { note: FNote }).note = shownNote;
            render(
                <ParentComponent.Provider value={component}>
                    <OfficePreview note={shownNote} noteContext={noteContext} />
                </ParentComponent.Provider>, container);
        }
        await act(async () => draw(note));

        const current = () => data.get("tocDocument") as TocDocumentState | undefined;
        return {
            note,
            published,
            current,
            rerender: draw,
            async shown() {
                await vi.waitFor(() => expect(current()?.status).toBe("shown"));
                return current() as TocDocumentContext;
            }
        };
    }
});
