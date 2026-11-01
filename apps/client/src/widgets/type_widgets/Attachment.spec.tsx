import { useEffect } from "preact/hooks";
import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";

import Component from "../../components/component";
import FAttachment from "../../entities/fattachment";
import froca from "../../services/froca";
import LoadResults from "../../services/load_results";
import options from "../../services/options";
import { renderInto } from "../../test/render";
import { ParentComponent } from "../react/react_utils";

const CANVAS_MIME = "application/vnd.excalidraw+json";
const { getRenderedContent, drawingMounts, uploadFiles } = vi.hoisted(() => ({
    getRenderedContent: vi.fn(async () => ({ $renderedContent: [] })),
    drawingMounts: vi.fn(),
    uploadFiles: vi.fn(async () => {})
}));

// Nothing initialises i18next in a unit test, and an uninitialised one answers every lookup with an
// empty string — which would make the two placeholder messages indistinguishable. Answering with the
// key instead is enough to tell which of them the list reached for.
vi.mock("i18next", () => {
    const t = (key: string) => key;
    return { default: { t }, t };
});

// The cards' content is drawn imperatively; nothing here asks what a preview looks like, only how many
// were built at all.
vi.mock("../../services/content_renderer", () => ({
    default: {
        getRenderedContent,
        disposeInteractiveContent: () => {}
    },
    hasRenderedPreview: (attachment: FAttachment) => attachment.mime === CANVAS_MIME
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

    it("previews a file as text only where the renderer draws nothing of it", async () => {
        const drawingBlob = vi.fn(async () => ({ content: "{}" }));
        const drawing = { ...role("file"), mime: CANVAS_MIME, getBlob: drawingBlob };
        const text = { ...role("file"), mime: "text/plain", getBlob: async () => ({ content: "hi" }) };
        const container = await mount([ drawing, text ] as FAttachment[]);

        await vi.waitFor(() => expect(container.querySelector(".file-preview-content")).not.toBeNull());
        expect(container.querySelectorAll(".file-preview-content")).toHaveLength(1);
        expect(drawingBlob).not.toHaveBeenCalled();
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
});

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
async function mount(attachments: FAttachment[]) {
    const props = {
        note: {
            noteId: "note1",
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
