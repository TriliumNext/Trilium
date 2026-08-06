import { describe, expect, it, vi } from "vitest";

import FAttachment from "../../entities/fattachment";
import { renderInto } from "../../test/render";

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
        getRenderedContent: async () => ({ $renderedContent: [] }),
        disposeInteractiveContent: () => {}
    }
}));
// Bootstrap's dropdown and the note link both reach well past this widget; the compression dialog only
// exists to be opened from a menu that is stubbed out anyway.
vi.mock("../react/Dropdown", () => ({ default: () => <div class="dropdown-stub" /> }));
vi.mock("../react/NoteLink", () => ({ default: () => <span class="note-link-stub" /> }));
vi.mock("../dialogs/image_compression/image_compression_dialog", () => ({ showImageCompressionDialog: vi.fn() }));

const { AttachmentList } = await import("./Attachment");

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

    it("says plainly that there is nothing where a note carries nothing at all", async () => {
        const container = await mount([]);

        // Nothing here is qualified by anything: the full-size placeholder fills the pane as it always
        // did, with no row underneath to leave room for and nothing to correct about the word it uses.
        expect(container.querySelector(".attachment-system-group")).toBeNull();
        expect(container.querySelector(".no-items")?.textContent).toBe("attachment_list.no_attachments");
        expect(container.querySelector(".no-items-small, .beside-folded-away")).toBeNull();
    });
});

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
