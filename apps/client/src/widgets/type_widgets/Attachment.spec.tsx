import { useEffect } from "preact/hooks";
import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";

import Component from "../../components/component";
import FAttachment from "../../entities/fattachment";
import froca from "../../services/froca";
import LoadResults from "../../services/load_results";
import { renderInto } from "../../test/render";
import { ParentComponent } from "../react/react_utils";

const CANVAS_MIME = "application/vnd.excalidraw+json";
const { getRenderedContent, drawingMounts, drawingProps } = vi.hoisted(() => ({
    getRenderedContent: vi.fn(async () => ({ $renderedContent: [] })),
    drawingMounts: vi.fn(),
    drawingProps: vi.fn()
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
    CanvasDrawingDetail: (props: { revision?: number }) => {
        drawingProps(props);
        useEffect(() => drawingMounts(), []);
        return <div className="drawing-detail-stub" />;
    }
}));
// Bootstrap's dropdown and the note link both reach well past this widget; the compression dialog only
// exists to be opened from a menu that is stubbed out anyway.
vi.mock("../react/Dropdown", () => ({ default: () => <div class="dropdown-stub" /> }));
vi.mock("../react/NoteLink", () => ({ default: () => <span class="note-link-stub" /> }));
vi.mock("../dialogs/image_compression/image_compression_dialog", () => ({ showImageCompressionDialog: vi.fn() }));

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

    it("says plainly that there is nothing where a note carries nothing at all", async () => {
        const container = await mount([]);

        // Nothing here is qualified by anything: the full-size placeholder fills the pane as it always
        // did, with no row underneath to leave room for and nothing to correct about the word it uses.
        expect(container.querySelector(".attachment-system-group")).toBeNull();
        expect(container.querySelector(".no-items")?.textContent).toBe("attachment_list.no_attachments");
        expect(container.querySelector(".no-items-small, .beside-folded-away")).toBeNull();
    });
});

describe("AttachmentDetail", () => {
    it("edits a canvas drawing, loading again only what another component saved", async () => {
        const getRevision = () =>
            (drawingProps.mock.lastCall?.[0] as { revision?: number }).revision;
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

        // Its own save, and a change to another attachment, keep the editor as it is.
        await reloadAttachment(component, drawing.attachmentId, component.componentId);
        await reloadAttachment(component, "otherAttachment", "otherComponent");
        expect(drawingMounts).toHaveBeenCalledOnce();
        expect(getRevision()).toBe(0);

        // The detail stays mounted, so that its unsaved changes carry over to the drawing.
        await reloadAttachment(component, drawing.attachmentId, "otherComponent");
        await vi.waitFor(() => expect(getRevision()).toBe(1));
        expect(drawingMounts).toHaveBeenCalledOnce();
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
