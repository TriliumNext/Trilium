import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Component from "../../../components/component";
import type NoteContext from "../../../components/note_context";
import type FNote from "../../../entities/fnote";
import { ParentComponent } from "../../react/react_utils";

const renderOfficeToHtml = vi.fn<(entityType: string, entityId: string) => Promise<{ css: string; html: string }>>();
const { showAnchorElement, scroller } = vi.hoisted(() => ({
    showAnchorElement: vi.fn(),
    scroller: { scrollTo: vi.fn() }
}));

vi.mock("../../../services/office_renderer", async (importOriginal) => ({
    ...await importOriginal<typeof import("../../../services/office_renderer")>(),
    renderOfficeToHtml: (...args: [string, string]) => renderOfficeToHtml(...args)
}));
// The landing scrolls with these; happy-dom lays nothing out.
vi.mock("@triliumnext/ckeditor5/src/plugins/block_reference/block_reference_read_only.js", () => ({
    showAnchorElement,
    getScrollContainer: () => scroller
}));

const { default: OfficePreview } = await import("./Office");
const { OfficePreviewTooLargeError } = await import("../../../services/office_renderer");
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
        await vi.waitFor(() => expect(renderOfficeToHtml).toHaveBeenCalledWith("notes", "note42"));

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
