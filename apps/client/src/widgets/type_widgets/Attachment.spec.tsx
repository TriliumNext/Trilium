import { render } from "preact";
import { useEffect } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import Component from "../../components/component";
import FAttachment from "../../entities/fattachment";
import froca from "../../services/froca";
import LoadResults from "../../services/load_results";
import options from "../../services/options";
import { renderInto } from "../../test/render";
import { ParentComponent } from "../react/react_utils";
import type { TocDocumentContext } from "../sidebar/CachedToCProvider";
import type { PdfReading } from "./file/PdfViewer";

const CANVAS_MIME = "application/vnd.excalidraw+json";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const {
    getRenderedContent, disposeInteractiveContent, drawingMounts, uploadFiles
} = vi.hoisted(() => ({
    getRenderedContent: vi.fn(
        async (..._args: unknown[]): Promise<unknown> => ({ $renderedContent: [] })),
    disposeInteractiveContent: vi.fn(),
    drawingMounts: vi.fn(),
    uploadFiles: vi.fn(async () => {})
}));

// Nothing initialises i18next in a unit test, and an uninitialised one answers every lookup with an
// empty string — which would make the two placeholder messages indistinguishable. Answering with the
// key instead is enough to tell which of them the list reached for.
vi.mock("i18next", () => {
    const t = (key: string) => key;
    // `services/dayjs` follows the language through `on()`.
    return { default: { t, on: () => {} }, t };
});

// The cards' content is drawn imperatively; nothing here asks what a preview looks like, only how many
// were built at all.
vi.mock("../../services/content_renderer", () => ({
    default: {
        getRenderedContent,
        disposeInteractiveContent
    },
    hasRenderedPreview: (attachment: FAttachment) => attachment.mime === CANVAS_MIME
}));
const spreadsheetErrors = vi.hoisted(() => [] as (() => void)[]);
vi.mock("./spreadsheet/Spreadsheet", () => ({
    SpreadsheetFile: ({ onError }: { onError: () => void }) => {
        spreadsheetErrors.push(onError);
        return <div className="spreadsheet-file-stub" />;
    }
}));
// Counts the mounts of the drawing editor, which loads a change saved elsewhere in place.
vi.mock("./canvas/CanvasDrawing", () => ({
    CanvasDrawingDetail: () => {
        useEffect(() => drawingMounts(), []);
        return <div className="drawing-detail-stub" />;
    }
}));
// Bootstrap's dropdown and the note link both reach well past this widget; the compression dialog only
// exists to be opened from a menu that is stubbed out anyway.
vi.mock("../react/Dropdown", () => ({ default: () => <div class="dropdown-stub" /> }));
vi.mock("../react/NoteLink", () => ({ default: () => <span class="note-link-stub" /> }));
vi.mock("../dialogs/image_compression/image_compression_dialog", () => ({ showImageCompressionDialog: vi.fn() }));
vi.mock("../../services/import", () => ({ default: { uploadFiles } }));

const { AttachmentDetail, AttachmentList } = await import("./Attachment");

describe("AttachmentList", () => {
    it("lists what the reader placed, with nothing to unfold where the app has made nothing", async () => {
        const container = await mount([ role("image"), role("file") ]);

        expect(cards(container)).toHaveLength(2);
        expect(container.querySelector(".attachment-system-group")).toBeNull();
    });

    it("folds the app's own away, and does not build them until they are asked for", async () => {
        const container = await mount([ role("image"), role("favicon"), role("coverImage") ]);

        // Only the reader's own is listed; the other two are behind the disclosure, and behind it they
        // are not rendered at all — each card would otherwise fetch and draw its content unprompted.
        expect(cards(container)).toHaveLength(1);
        const disclosure = container.querySelector<HTMLButtonElement>(".attachment-system-group .collapsible-title");
        expect(disclosure?.getAttribute("aria-expanded")).toBe("false");

        disclosure?.click();
        await vi.waitFor(() => expect(cards(container)).toHaveLength(3));
        expect(disclosure?.getAttribute("aria-expanded")).toBe("true");
        expect(container.querySelectorAll(".attachment-system-group .attachment-detail-widget")).toHaveLength(2);
    });

    it("stays folded on a note whose attachments are all the app's, saying so in its place", async () => {
        const container = await mount([ role("favicon"), role("viewConfig") ]);

        expect(cards(container)).toHaveLength(0);
        // Sized and placed to sit with the row under it rather than to fill the pane over it, and
        // saying what is actually absent: the note's own, not attachments as such.
        const placeholder = container.querySelector(".no-items.no-items-small.beside-folded-away");
        expect(placeholder?.textContent).toBe("attachment_list.no_user_attachments");
        expect(container.querySelector(".attachment-system-group .collapsible-title")?.getAttribute("aria-expanded")).toBe("false");
    });

    it("folds away the picture of a canvas note", async () => {
        const picture = { ...role("image"), title: "canvas-export.svg", mime: "image/svg+xml" };
        const container = await mount([ role("image"), picture ] as FAttachment[], "canvas");

        expect(cards(container)).toHaveLength(1);
        expect(container.querySelector(".attachment-system-group")).not.toBeNull();
    });

    it("previews a file as text only where the renderer draws nothing of it", async () => {
        const drawingBlob = vi.fn(async () => ({ content: "{}" }));
        const drawing = { ...role("file"), mime: CANVAS_MIME, getBlob: drawingBlob };
        const text = { ...role("file"), mime: "text/plain", getBlob: async () => ({ content: "hi" }) };
        const container = await mount([ drawing, text ] as FAttachment[]);

        await vi.waitFor(() => expect(container.querySelector(".file-preview-content")).not.toBeNull());
        expect(container.querySelectorAll(".file-preview-content")).toHaveLength(1);
        expect(drawingBlob).not.toHaveBeenCalled();
    });

    it("previews only the corner of a workbook in the list", async () => {
        getRenderedContent.mockClear();
        const workbook = { ...role("file"), mime: XLSX_MIME } as FAttachment;
        await mount([ workbook ]);

        await vi.waitFor(() => expect(getRenderedContent).toHaveBeenCalledOnce());
        expect(getRenderedContent).toHaveBeenCalledWith(workbook, expect.objectContaining({ trim: true }));
    });

    it("files a transcript with the app's own, shown as its conversation", async () => {
        const content = JSON.stringify({
            version: 1,
            startedAt: "2026-10-13T14:30:00.000Z",
            utterances: [ { source: "system", offsetMs: 3000, text: "Yes." } ]
        });
        const transcript = {
            ...role("transcript"),
            mime: "application/json",
            getBlob: async () => ({ content })
        };
        getRenderedContent.mockClear();
        const container = await mount([ transcript ] as FAttachment[]);

        expect(cards(container)).toHaveLength(0);
        const disclosure = container.querySelector<HTMLButtonElement>(".attachment-system-group .collapsible-title");
        expect(disclosure).not.toBeNull();
        disclosure?.click();

        await vi.waitFor(() =>
            expect(container.querySelector(".attachment-system-group .attachment-transcript .transcript-turn")).not.toBeNull());
        expect(container.querySelector(".attachment-transcript")?.textContent).toContain("Yes.");
        expect(getRenderedContent).not.toHaveBeenCalled();
    });

    it("says plainly that there is nothing where a note carries nothing at all", async () => {
        const container = await mount([]);

        // Nothing here is qualified by anything: the full-size placeholder fills the pane as it always
        // did, with no row underneath to leave room for and nothing to correct about the word it uses.
        expect(container.querySelector(".attachment-system-group")).toBeNull();
        expect(container.querySelector(".no-items")?.textContent).toBe("attachment_list.no_attachments");
        expect(container.querySelector(".no-items-small, .beside-folded-away")).toBeNull();
    });

    it("uploads files dropped from outside the app as attachments of the note", async () => {
        vi.spyOn(options, "is").mockReturnValue(true);
        uploadFiles.mockClear();
        const container = await mount([ role("image") ]);
        const list = container.querySelector(".attachment-list-container");
        const card = cards(container)[0];
        expect(list).not.toBeNull();
        expect(card).toBeDefined();
        if (!list) return;

        expect(drag(card, "dragenter", [ "Files" ]).defaultPrevented).toBe(true);
        expect(dropOverlay(container)?.textContent).toBe("attachment_list.drop_files");

        // Moving from the card to the list around it keeps the overlay.
        drag(list, "dragenter", [ "Files" ]);
        drag(card, "dragleave", [ "Files" ]);
        expect(dropOverlay(container)).not.toBeNull();
        expect(drag(list, "dragover", [ "Files" ]).defaultPrevented).toBe(true);

        const file = new File([ "x" ], "notes.txt");
        expect(drag(list, "drop", [ "Files" ], [ file ]).defaultPrevented).toBe(true);
        expect(uploadFiles).toHaveBeenCalledExactlyOnceWith(
            "attachments", "note1", [ file ], { shrinkImages: true });
        expect(dropOverlay(container)).toBeNull();
    });

    it("ignores a drag that carries no files or that started in the page", async () => {
        uploadFiles.mockClear();
        const container = await mount([ role("image") ]);
        const card = cards(container)[0];
        expect(card).toBeDefined();

        // Notes dragged from the tree.
        expect(drag(card, "dragenter", [ "text/plain" ]).defaultPrevented).toBe(false);
        expect(dropOverlay(container)).toBeNull();

        // An image dragged out of a card also carries files.
        drag(card, "dragstart", [ "Files" ]);
        expect(drag(card, "dragenter", [ "Files" ]).defaultPrevented).toBe(false);
        expect(drag(card, "dragover", [ "Files" ]).defaultPrevented).toBe(false);
        expect(dropOverlay(container)).toBeNull();
        drag(card, "drop", [ "Files" ], [ new File([ "x" ], "image.png") ]);
        expect(uploadFiles).not.toHaveBeenCalled();

        // Either a drop or a `dragend` ends the drag from the page.
        expect(drag(card, "dragover", [ "Files" ]).defaultPrevented).toBe(true);
        drag(card, "dragstart", [ "Files" ]);
        drag(card, "dragend", [ "Files" ]);
        expect(drag(card, "dragover", [ "Files" ]).defaultPrevented).toBe(true);
    });
});

describe("AttachmentDetail", () => {
    afterEach(() => {
        getRenderedContent.mockReset();
        getRenderedContent.mockImplementation(async () => ({ $renderedContent: [] }));
        disposeInteractiveContent.mockClear();
    });

    it("edits a canvas drawing in an editor that stays mounted through every save", async () => {
        const drawing = { ...role("file"), mime: CANVAS_MIME } as FAttachment;
        vi.spyOn(froca, "getAttachment").mockResolvedValue(drawing);
        getRenderedContent.mockClear();
        drawingMounts.mockClear();

        const component = new Component();
        const props = {
            note: { noteId: "note1" },
            viewScope: { viewMode: "attachments", attachmentId: drawing.attachmentId }
        } as unknown as Parameters<typeof AttachmentDetail>[0];
        const container = renderInto(
            <ParentComponent.Provider value={component}>
                <AttachmentDetail {...props} />
            </ParentComponent.Provider>
        );

        await vi.waitFor(() => expect(drawingMounts).toHaveBeenCalledOnce());
        expect(container.querySelector(".attachment-canvas-drawing .drawing-detail-stub")).not.toBeNull();
        expect(getRenderedContent).not.toHaveBeenCalled();

        // The drawing shows a save made elsewhere in place.
        await reloadAttachment(component, drawing.attachmentId, component.componentId);
        await reloadAttachment(component, drawing.attachmentId, "otherComponent");
        await reloadAttachment(component, "otherAttachment", "otherComponent");
        expect(drawingMounts).toHaveBeenCalledOnce();
        expect(getRenderedContent).not.toHaveBeenCalled();
    });

    describe.each([
        {
            name: "a PDF", mime: "application/pdf",
            first: { page: "3", heading: "h1" }, second: { page: "5", annotation: "12R" },
            firstTarget: { page: 3, heading: "h1", annotation: undefined, bookmark: undefined },
            secondTarget: { page: 5, heading: undefined, annotation: "12R", bookmark: undefined }
        },
        {
            name: "a Word document", mime: DOCX_MIME,
            first: { heading: "h1" }, second: { bookmark: "Appendix" },
            firstTarget: {
                page: undefined, heading: "h1", annotation: undefined, bookmark: undefined
            },
            secondTarget: {
                page: undefined, heading: undefined, annotation: undefined, bookmark: "Appendix"
            }
        }
    ])("the place in $name that a link names", ({ mime, first, second, ...targets }) => {
        const { firstTarget, secondTarget } = targets;

        it("is shown once the content is in place, and that of each later link at once", async () => {
            const { attachment, renders, follow, viewScope } = await openDetail(mime, first);

            expect(getRenderedContent).toHaveBeenCalledWith(attachment, expect.objectContaining(
                { pdfToolbar: true, buildsPdfToc: true, trim: false }));
            expect(viewScope).toMatchObject(first);
            const content = await renders.finish(0);
            expect(content.showTarget).toHaveBeenCalledExactlyOnceWith(firstTarget);
            expect(viewScope)
                .toMatchObject({ page: undefined, heading: undefined, annotation: undefined });

            await follow(second);
            expect(content.showTarget).toHaveBeenLastCalledWith(secondTarget);

            // A link without a place, or to another attachment, moves nothing.
            await follow({});
            await follow({ attachmentId: "other", heading: "h2" });
            expect(content.showTarget).toHaveBeenCalledTimes(2);
            expect(getRenderedContent).toHaveBeenCalledOnce();
        });

        it("of the latest link is shown, once, when links follow during a render", async () => {
            const { attachment, renders, follow } = await openDetail(mime, first);

            await follow(second);
            const content = await renders.finish(0);
            expect(content.showTarget).toHaveBeenCalledExactlyOnceWith(secondTarget);

            // During a render after a change of the content, the link goes to the new content.
            await reloadAttachment(renders.component, attachment.attachmentId, "otherComponent");
            await follow(first);
            expect(content.showTarget).toHaveBeenCalledOnce();
            const changed = await renders.finish(1);
            expect(changed.showTarget).toHaveBeenCalledExactlyOnceWith(firstTarget);
            expect(content.showTarget).toHaveBeenCalledOnce();
        });

        it("comes from the latest render when two resolve out of order", async () => {
            const { attachment, renders, follow, container } = await openDetail(mime, {});
            await reloadAttachment(renders.component, attachment.attachmentId, "otherComponent");
            await follow(first);

            const latest = await renders.finish(1);
            const superseded = await renders.finish(0);

            expect(container.contains(latest.element)).toBe(true);
            expect(container.contains(superseded.element)).toBe(false);
            expect(disposeInteractiveContent).toHaveBeenCalledWith([ superseded.element ]);
            expect(superseded.showTarget).not.toHaveBeenCalled();
            expect(latest.showTarget).toHaveBeenCalledExactlyOnceWith(firstTarget);
        });
    });

    it("shows the attachment of the latest navigation, whichever lookup ends last", async () => {
        const older = { ...role("file"), mime: DOCX_MIME } as FAttachment;
        const newer = { ...role("file"), mime: DOCX_MIME } as FAttachment;
        const lookups = new Map<string, (attachment: FAttachment) => void>();
        vi.spyOn(froca, "getAttachment").mockImplementation((attachmentId) =>
            new Promise((resolve) => lookups.set(attachmentId, resolve)));
        const renders = holdRenders();
        const noteContext = {
            ...recordingContext(), viewScope: {} as Record<string, string | undefined>
        };
        const container = document.createElement("div");
        document.body.append(container);
        async function navigate(attachment: FAttachment, heading: string) {
            noteContext.viewScope = {
                viewMode: "attachments", attachmentId: attachment.attachmentId, heading
            };
            const props = {
                note: { noteId: "note1" }, viewScope: noteContext.viewScope, noteContext
            } as unknown as Parameters<typeof AttachmentDetail>[0];
            await act(async () => {
                render(
                    <ParentComponent.Provider value={renders.component}>
                        <AttachmentDetail {...props} />
                    </ParentComponent.Provider>, container);
            });
        }

        await navigate(older, "a");
        await navigate(newer, "b");
        await act(async () => lookups.get(newer.attachmentId)?.(newer));
        await act(async () => lookups.get(older.attachmentId)?.(older));
        const content = await renders.finish(0);

        expect(getRenderedContent).toHaveBeenCalledExactlyOnceWith(newer, expect.anything());
        expect(content.showTarget)
            .toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ heading: "b" }));
        await act(async () => render(null, container));
        container.remove();
    });

    describe("and the outline", () => {
        const PREVIEW = "<div class=\"office-preview-scroll\"><div class=\"office-preview-body\">"
            + "<h2 data-toc-heading=\"a b\">A</h2></div></div>";

        /** The options of the latest render, which report its document to the outline. */
        function reports() {
            return getRenderedContent.mock.calls.at(-1)?.[1] as {
                onDocumentState(state: object): void;
                onReadingChange(reading: PdfReading): void;
            };
        }

        it("publishes rendering, then the blob the render reports once the content is in place",
            async () => {
            const { attachment, renders, noteContext } = await openDetail(DOCX_MIME, {});
            const { attachmentId } = attachment;
            expect(noteContext.contextData.get("tocDocument"))
                .toStrictEqual({ status: "rendering", attachmentId });

            reports().onDocumentState({ status: "shown", blobId: "blob1" });
            expect(noteContext.contextData.get("tocDocument"))
                .toStrictEqual({ status: "rendering", attachmentId });
            await renders.finish(0, PREVIEW);

            expect(noteContext.contextData.get("tocDocument")).toMatchObject({
                status: "shown", attachmentId, tocUrl: `attachments/${attachmentId}/toc`,
                renderedBlobId: "blob1", ownerNoteId: "note1", title: attachment.title,
                linkPath: `note1?viewMode=attachments&attachmentId=${attachmentId}`
            });
            const shown = noteContext.contextData.get("tocDocument") as TocDocumentContext;
            expect(shown.findActiveHeading([])).toBe("b");

            reports().onDocumentState({ status: "unavailable" });
            expect(noteContext.contextData.get("tocDocument"))
                .toStrictEqual({ status: "unavailable", attachmentId });
        });

        it("lands a click through the latest render, the page as a number, refusing an older one",
            async () => {
            const { attachment, renders, noteContext, viewScope } =
                await openDetail("application/pdf", {});
            const content = await renders.finish(0);
            reports().onDocumentState({ status: "shown", blobId: "blob1" });
            const older = noteContext.contextData.get("tocDocument") as TocDocumentContext;

            expect(older.showTarget({ page: "3", heading: "gone" })).toBe(true);
            expect(content.showTarget).toHaveBeenCalledExactlyOnceWith(
                { page: 3, heading: "gone" }, { isFallbackToTop: false });

            // Another attachment in the scope, and another render, refuse the callback.
            viewScope.attachmentId = "other";
            expect(older.showTarget({ page: "4" })).toBe(false);
            viewScope.attachmentId = attachment.attachmentId;
            await reloadAttachment(renders.component, attachment.attachmentId, "otherComponent");
            expect(older.showTarget({ page: "4" })).toBe(false);
            expect(content.showTarget).toHaveBeenCalledOnce();
            expect(noteContext.contextData.get("tocDocument"))
                .toStrictEqual({ status: "rendering", attachmentId: attachment.attachmentId });
        });

        it("tells the heading being read in a PDF from where its viewer reads", async () => {
            const { renders, noteContext } = await openDetail("application/pdf", {});
            await renders.finish(0);
            reports().onDocumentState({ status: "shown", blobId: "blob1" });
            const shown = () => noteContext.contextData.get("tocDocument") as TocDocumentContext;
            const headings = [
                { id: "p1", title: "A", level: 1, page: 1, top: 700 },
                { id: "p2", title: "B", level: 1, page: 2, top: 700 }
            ];
            const before = shown();
            expect(before.findActiveHeading(headings)).toBeNull();

            // Each report publishes again, so the outline reads the heading once more.
            reports().onReadingChange({
                position: { pageNumber: 2, x: 0, y: 600 }, rotations: [ 0, 0 ]
            });
            expect(shown()).not.toBe(before);
            expect(shown().findActiveHeading(headings)).toBe("p2");
            reports().onReadingChange({
                position: { pageNumber: 2, x: 0, y: 750 }, rotations: [ 0, 0 ]
            });
            expect(shown().findActiveHeading(headings)).toBe("p1");
        });

        it("stays where it is for a heading that the preview does not mark", async () => {
            const { renders, noteContext } = await openDetail(DOCX_MIME, {});
            reports().onDocumentState({ status: "shown", blobId: "blob1" });
            const content = await renders.finish(0, PREVIEW);
            const shown = noteContext.contextData.get("tocDocument") as TocDocumentContext;

            expect(shown.showTarget({ heading: "missing" })).toBe(false);
            expect(content.showTarget).not.toHaveBeenCalled();
            expect(shown.showTarget({ heading: "b" })).toBe(true);
            expect(content.showTarget).toHaveBeenCalledOnce();
        });

        it("publishes nothing while the scope names another attachment, and clears its own entry",
            async () => {
            const { attachment, renders, noteContext, viewScope, container } =
                await openDetail(DOCX_MIME, {});
            viewScope.attachmentId = "other";
            noteContext.contextData.clear();
            reports().onDocumentState({ status: "shown", blobId: "blob1" });
            await renders.finish(0, PREVIEW);
            expect(noteContext.contextData.has("tocDocument")).toBe(false);

            viewScope.attachmentId = attachment.attachmentId;
            await reloadAttachment(renders.component, attachment.attachmentId, "otherComponent");
            expect(noteContext.contextData.get("tocDocument"))
                .toMatchObject({ status: "rendering" });
            await act(async () => render(null, container));
            expect(noteContext.contextData.has("tocDocument")).toBe(false);
        });

        it("publishes the document again when the pane shows the attachment again", async () => {
            const { attachment, renders, noteContext, hide, show, unmount } =
                await openHideableDetail(DOCX_MIME);
            reports().onDocumentState({ status: "shown", blobId: "blob1" });
            await renders.finish(0, PREVIEW);
            expect(noteContext.contextData.get("tocDocument"))
                .toMatchObject({ status: "shown", renderedBlobId: "blob1" });

            await hide();
            expect(noteContext.contextData.has("tocDocument")).toBe(false);

            await show();
            expect(noteContext.contextData.get("tocDocument")).toMatchObject({
                status: "shown", attachmentId: attachment.attachmentId, renderedBlobId: "blob1"
            });
            expect(getRenderedContent).toHaveBeenCalledOnce();
            await unmount();
        });

        it("publishes what a render started while the pane was hidden reports once it shows",
            async () => {
            const { attachment, renders, noteContext, hide, show, unmount } =
                await openHideableDetail("application/pdf");
            const { attachmentId } = attachment;
            const published = () =>
                noteContext.contextData.get("tocDocument") as TocDocumentContext | undefined;
            await renders.finish(0);
            await hide();
            await reloadAttachment(renders.component, attachmentId, "otherComponent");
            expect(getRenderedContent).toHaveBeenCalledTimes(2);
            expect(published()).toBeUndefined();

            await show();
            await renders.finish(1);
            expect(published()).toStrictEqual({ status: "rendering", attachmentId });
            reports().onDocumentState({ status: "shown", blobId: "blob2" });
            expect(published()).toMatchObject({ status: "shown", renderedBlobId: "blob2" });
            const before = published();
            reports().onReadingChange({
                position: { pageNumber: 1, x: 0, y: 600 }, rotations: [ 0 ]
            });
            expect(published()).not.toBe(before);
            await unmount();
        });
    });

    it("looks nothing up while the view scope names no attachment", async () => {
        const getAttachment = vi.spyOn(froca, "getAttachment").mockResolvedValue(null);
        const component = new Component();
        const container = document.createElement("div");
        document.body.append(container);
        async function show(viewScope: Record<string, string>) {
            const props = { note: { noteId: "note1" }, viewScope } as unknown as
                Parameters<typeof AttachmentDetail>[0];
            await act(async () => {
                render(
                    <ParentComponent.Provider value={component}>
                        <AttachmentDetail {...props} />
                    </ParentComponent.Provider>, container);
            });
        }

        await show({ viewMode: "attachments" });
        expect(getAttachment).not.toHaveBeenCalled();

        await show({ viewMode: "attachments", attachmentId: "att1" });
        expect(getAttachment).toHaveBeenCalledExactlyOnceWith("att1");
        await act(async () => render(null, container));
        container.remove();
    });

    it("shows a workbook opened on its own in the read-only spreadsheet, else its whole preview until it changes", async () => {
        const workbook = { ...role("file"), mime: XLSX_MIME } as FAttachment;
        vi.spyOn(froca, "getAttachment").mockResolvedValue(workbook);
        getRenderedContent.mockClear();

        const props = {
            note: { noteId: "note1" },
            viewScope: { viewMode: "attachments", attachmentId: workbook.attachmentId }
        } as unknown as Parameters<typeof AttachmentDetail>[0];
        const parent = new Component();
        const container = renderInto(
            <ParentComponent.Provider value={parent}>
                <AttachmentDetail {...props} />
            </ParentComponent.Provider>
        );

        await vi.waitFor(() => expect(container.querySelector(".attachment-spreadsheet .spreadsheet-file-stub")).not.toBeNull());
        expect(getRenderedContent).not.toHaveBeenCalled();

        // A file that is no workbook falls back to the whole HTML preview.
        await act(async () => spreadsheetErrors.at(-1)?.());
        await vi.waitFor(() => expect(getRenderedContent).toHaveBeenCalledOnce());
        expect(getRenderedContent).toHaveBeenCalledWith(workbook, expect.objectContaining({ trim: false }));
        expect(container.querySelector(".spreadsheet-file-stub")).toBeNull();

        // A replaced file gets the spreadsheet again.
        workbook.utcDateModified = "2026-02-01 00:00:00Z";
        await reloadAttachment(parent, workbook.attachmentId, "elsewhere");
        await vi.waitFor(() => expect(container.querySelector(".attachment-spreadsheet .spreadsheet-file-stub")).not.toBeNull());
    });
});

/**
 * Opens the full detail of a file attachment of `mime` from a link whose view scope holds `scope`.
 * Its renders wait until `renders.finish()`.
 */
async function openDetail(mime: string, scope: Record<string, string | undefined>) {
    const attachment = { ...role("file"), mime } as FAttachment;
    vi.spyOn(froca, "getAttachment").mockResolvedValue(attachment);
    const renders = holdRenders();
    const viewScope: Record<string, string | undefined> = {
        viewMode: "attachments", attachmentId: attachment.attachmentId, ...scope
    };
    const noteContext = { ...recordingContext(), viewScope };
    const props = { note: { noteId: "note1" }, viewScope, noteContext } as unknown as
        Parameters<typeof AttachmentDetail>[0];
    const container = renderInto(
        <ParentComponent.Provider value={renders.component}>
            <AttachmentDetail {...props} />
        </ParentComponent.Provider>
    );
    await vi.waitFor(() => expect(getRenderedContent).toHaveBeenCalledOnce());

    /** Follows a link to the attachment the pane shows, with `changes` to the view scope. */
    async function follow(changes: Record<string, string | undefined>) {
        for (const key of [ "page", "heading", "annotation", "bookmark" ]) {
            viewScope[key] = undefined;
        }
        Object.assign(viewScope, changes);
        await act(async () => {
            await renders.component.handleEvent("noteSwitched",
                { noteContext: { ntxId: "ntx1", note: { noteId: "note1" } } } as never);
        });
    }
    return { attachment, renders, follow, viewScope, container, noteContext };
}

/**
 * Opens the full detail of a file attachment of `mime` in a pane that `hide()` hides and `show()`
 * shows again. Its renders wait until `renders.finish()`.
 */
async function openHideableDetail(mime: string) {
    const attachment = { ...role("file"), mime } as FAttachment;
    vi.spyOn(froca, "getAttachment").mockResolvedValue(attachment);
    const renders = holdRenders();
    const scope = () => ({ viewMode: "attachments", attachmentId: attachment.attachmentId });
    const noteContext = {
        ...recordingContext(), viewScope: scope() as Record<string, string | undefined>
    };
    let paneScope: object = noteContext.viewScope;
    const container = document.createElement("div");
    document.body.append(container);
    async function renderPane(isVisible: boolean) {
        const props = { note: { noteId: "note1" }, viewScope: paneScope, noteContext, isVisible } as
            unknown as Parameters<typeof AttachmentDetail>[0];
        await act(async () => {
            render(
                <ParentComponent.Provider value={renders.component}>
                    <AttachmentDetail {...props} />
                </ParentComponent.Provider>, container);
        });
    }
    await renderPane(true);
    await vi.waitFor(() => expect(getRenderedContent).toHaveBeenCalledOnce());

    return {
        attachment, renders, noteContext,
        /** Another note clears the context data, and `NoteDetailWrapper` keeps the props. */
        async hide() {
            noteContext.viewScope = { viewMode: "default" };
            noteContext.contextData.clear();
            await renderPane(false);
        },
        async show() {
            noteContext.viewScope = scope();
            paneScope = noteContext.viewScope;
            await renderPane(true);
        },
        async unmount() {
            await act(async () => render(null, container));
            container.remove();
        }
    };
}

/** The context data methods of a note context, which record what is published. */
function recordingContext() {
    const data = new Map<string, unknown>();
    return {
        ntxId: "ntx1",
        contextData: data,
        setContextData: (key: string, value: unknown) => data.set(key, value),
        getContextData: (key: string) => data.get(key),
        clearContextData: (key: string) => data.delete(key)
    };
}

/** Holds each call of `getRenderedContent()` until `finish()` gives it content. */
function holdRenders() {
    const pending: ((content: unknown) => void)[] = [];
    getRenderedContent.mockReset();
    getRenderedContent.mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
    return {
        component: new Component(),
        /** Completes the render that started `index`-th, with an element and a `showTarget()`. */
        async finish(index: number, html = "") {
            const element = document.createElement("div");
            element.innerHTML = html;
            const showTarget = vi.fn();
            await act(async () => pending[index]?.({ $renderedContent: [ element ], showTarget }));
            return { element, showTarget };
        }
    };
}

/** Reports a saved change to an attachment, as the server does after a save from `componentId`. */
async function reloadAttachment(component: Component, attachmentId: string, componentId: string) {
    const loadResults = new LoadResults([]);
    loadResults.addAttachmentRow({ attachmentId, ownerId: "note1" } as never, componentId);
    await act(async () => {
        await component.handleEvent("entitiesReloaded", { loadResults });
    });
}

function role(role: string) {
    return {
        attachmentId: `att-${role}-${Math.random().toString(36).slice(2)}`,
        ownerId: "note1",
        title: `${role}.dat`,
        role,
        mime: "application/octet-stream",
        contentLength: 10,
        utcDateModified: "2026-01-01 00:00:00Z",
        getBlob: async () => null
    } as unknown as FAttachment;
}

/** Renders the list for a note carrying the given attachments, once the asynchronous load has settled. */
async function mount(attachments: FAttachment[], type = "text") {
    const props = {
        note: {
            noteId: "note1",
            type,
            getAttachments: async () => attachments
        }
    } as unknown as Parameters<typeof AttachmentList>[0];
    const container = renderInto(<AttachmentList {...props} />);

    // The load is asynchronous, and its first render — before anything has arrived — is indistinguishable
    // from a note with no attachments at all: which is why waiting for something that first render
    // cannot produce settles a note that has any, and a note that has none needs no waiting, its final
    // state being the one it started in.
    if (attachments.length) {
        await vi.waitFor(() => expect(container.querySelector(".attachment-detail-widget, .attachment-system-group")).not.toBeNull());
    }
    return container;
}

function cards(container: HTMLElement) {
    return container.querySelectorAll(".attachment-detail-widget");
}

function dropOverlay(container: HTMLElement) {
    return container.querySelector(".attachment-list-drop-overlay");
}

/** Fires a drag event at `target` whose data has the given `types` and `files`. */
function drag(target: Element, type: string, types: string[], files: File[] = []) {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: { types, files, dropEffect: "none" } });
    act(() => {
        target.dispatchEvent(event);
    });
    return event;
}
