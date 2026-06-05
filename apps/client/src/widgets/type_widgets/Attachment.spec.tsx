import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the component import) --------------------------------------------

vi.mock("bootstrap", () => {
    class Tooltip {
        static instances = new Map<Element, Tooltip>();
        static getInstance(el: Element) { return Tooltip.instances.get(el) ?? null; }
        element: Element;
        constructor(el: Element) { this.element = el; Tooltip.instances.set(el, this); }
        dispose() { Tooltip.instances.delete(this.element); }
        show() {}
        hide() {}
    }
    class Dropdown {
        static getOrCreateInstance() { return new Dropdown(); }
        show() {}
        hide() {}
        toggle() {}
        dispose() {}
    }
    return { Tooltip, Dropdown, default: { Tooltip, Dropdown } };
});

// content_renderer pulls in heavy rendering machinery; stub it to a resolved empty fragment.
vi.mock("../../services/content_renderer", () => ({
    default: { getRenderedContent: vi.fn(async () => ({ $renderedContent: [] })) },
    getRenderedContent: vi.fn(async () => ({ $renderedContent: [] }))
}));

// NoteLink performs async link.createLink + jQuery DOM swaps; replace with a marker span.
vi.mock("../react/NoteLink", () => ({
    default: ({ notePath, title }: { notePath: string; title?: string }) => (
        <span className="note-link-mock" data-note-path={notePath}>{title ?? ""}</span>
    )
}));

vi.mock("../../services/dialog", () => ({
    default: { prompt: vi.fn(async () => undefined), confirm: vi.fn(async () => false) }
}));
vi.mock("../../services/toast", () => ({
    default: { showMessage: vi.fn(), showError: vi.fn() },
    showMessage: vi.fn(),
    showError: vi.fn()
}));
vi.mock("../../services/open", () => ({
    default: {
        openAttachmentExternally: vi.fn(),
        openAttachmentCustom: vi.fn(),
        downloadAttachment: vi.fn()
    }
}));
vi.mock("../../services/image", () => ({
    default: { copyImageReferenceToClipboard: vi.fn() },
    copyImageReferenceToClipboard: vi.fn()
}));
vi.mock("../../services/link", () => ({
    default: { createLink: vi.fn(async () => $("<a>link</a>")) }
}));

const setNoteMock = vi.fn((_noteId: string) => Promise.resolve());
const triggerCommandMock = vi.fn((_name: string, _data?: unknown) => Promise.resolve());
const getActiveContextMock = vi.fn(() => ({ setNote: setNoteMock }));
vi.mock("../../components/app_context", () => ({
    default: {
        triggerCommand: (name: string, data: unknown) => triggerCommandMock(name, data),
        tabManager: { getActiveContext: () => getActiveContextMock() }
    }
}));

import { ConvertAttachmentToNoteResponse } from "@triliumnext/commons";

import FAttachment, { FAttachmentRow } from "../../entities/fattachment";
import FNote from "../../entities/fnote";
import content_renderer from "../../services/content_renderer";
import dialog from "../../services/dialog";
import froca from "../../services/froca";
import image from "../../services/image";
import link from "../../services/link";
import open from "../../services/open";
import options from "../../services/options";
import server from "../../services/server";
import toast from "../../services/toast";
import utils from "../../services/utils";
import ws from "../../services/ws";
import { buildNote } from "../../test/easy-froca";
import Component from "../../components/component";
import { NoteContextContext, ParentComponent } from "../react/react_utils";
import { AttachmentDetail, AttachmentList, useAttachments } from "./Attachment";

// --- Render harness --------------------------------------------------------------------------------

let container: HTMLDivElement | undefined;
let parent: Component;

function renderWithProviders(vnode: any) {
    const root = document.createElement("div");
    container = root;
    document.body.appendChild(root);
    act(() => {
        render(
            <ParentComponent.Provider value={parent}>
                <NoteContextContext.Provider value={null}>
                    {vnode}
                </NoteContextContext.Provider>
            </ParentComponent.Provider>,
            root
        );
    });
    return root;
}

async function flush() {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}

function makeAttachment(overrides: Partial<FAttachmentRow> = {}): FAttachment {
    const row: FAttachmentRow = {
        attachmentId: overrides.attachmentId ?? utils.randomString(8),
        ownerId: overrides.ownerId ?? "owner1",
        role: overrides.role ?? "file",
        mime: overrides.mime ?? "text/plain",
        title: overrides.title ?? "attachment.txt",
        dateModified: "2025-01-01 00:00:00",
        utcDateModified: "2025-01-01 00:00:00",
        utcDateScheduledForErasureSince: overrides.utcDateScheduledForErasureSince ?? "",
        contentLength: overrides.contentLength ?? 123
    };
    const att = new FAttachment(froca, row);
    att.getBlob = async () => ({ content: "blob text content" }) as any;
    return att;
}

function buildOwnerNote(attachments: FAttachment[], id = "owner1"): FNote {
    const note = buildNote({ id, title: "Owner" });
    note.getAttachments = async () => attachments;
    return note;
}

const TYPE_PROPS_EXTRA = {
    ntxId: "ntx1",
    parentComponent: undefined,
    noteContext: undefined
};

beforeEach(() => {
    parent = new Component();
    for (const key of Object.keys(froca.notes)) delete froca.notes[key];
    for (const key of Object.keys(froca.attributes)) delete froca.attributes[key];
    for (const key of Object.keys(froca.branches)) delete froca.branches[key];
    for (const key of Object.keys(froca.attachments)) delete froca.attachments[key];
    vi.clearAllMocks();
    Object.assign(server, {
        put: vi.fn(async () => undefined),
        remove: vi.fn(async () => undefined),
        upload: vi.fn(async () => ({ uploaded: true })),
        post: vi.fn(async () => ({ note: { noteId: "newNote1" } }))
    });
    Object.assign(ws, { logError: vi.fn(), waitForMaxKnownEntityChangeId: vi.fn(async () => undefined) });
    // Bootstrap jQuery plugins aren't loaded in the test env; stub them so component effects don't throw.
    ($.fn as any).tooltip = function () { return this; };
    ($.fn as any).dropdown = function () { return this; };
});

afterEach(() => {
    if (container) {
        act(() => { render(null, container as HTMLDivElement); });
        container.remove();
        container = undefined;
    }
    vi.restoreAllMocks();
});

// --- AttachmentList --------------------------------------------------------------------------------

describe("AttachmentList", () => {
    it("renders the header, owning-note link, and one detail row per attachment", async () => {
        const note = buildOwnerNote([
            makeAttachment({ attachmentId: "a1", title: "first.txt" }),
            makeAttachment({ attachmentId: "a2", title: "second.txt" })
        ], "owner1");

        const root = renderWithProviders(
            <AttachmentList note={note} viewScope={undefined} {...TYPE_PROPS_EXTRA} />
        );
        await flush();

        expect(root.querySelector(".links-wrapper")).toBeTruthy();
        expect(root.querySelector(".attachment-actions-toolbar")).toBeTruthy();
        expect(root.querySelector(".attachment-list-wrapper")).toBeTruthy();
        expect(root.querySelectorAll(".attachment-detail-widget").length).toBe(2);
    });

    it("renders the empty state when the note has no attachments", async () => {
        const note = buildOwnerNote([], "ownerEmpty");

        const root = renderWithProviders(
            <AttachmentList note={note} viewScope={undefined} {...TYPE_PROPS_EXTRA} />
        );
        await flush();

        expect(root.querySelector(".attachment-list-wrapper")).toBeNull();
        // NoItems renders an icon span with the provided icon class.
        expect(root.querySelector(".bx-unlink")).toBeTruthy();
    });

    it("fires the upload-attachments command from the toolbar button", async () => {
        const note = buildOwnerNote([], "ownerToolbar");
        const triggerSpy = vi.spyOn(parent, "triggerCommand").mockReturnValue(undefined as any);

        const root = renderWithProviders(
            <AttachmentList note={note} viewScope={undefined} {...TYPE_PROPS_EXTRA} />
        );
        await flush();

        const uploadBtn = root.querySelector(".attachment-actions-toolbar button");
        expect(uploadBtn).toBeTruthy();
        (uploadBtn as HTMLButtonElement).click();
        expect(triggerSpy).toHaveBeenCalledWith("showUploadAttachmentsDialog", { noteId: "ownerToolbar" });
    });
});

// --- useAttachments refresh on entitiesReloaded ----------------------------------------------------

describe("useAttachments", () => {
    it("re-fetches when an entitiesReloaded event references the note's attachments", async () => {
        const att = makeAttachment({ attachmentId: "a1", ownerId: "ownerHook" });
        const note = buildOwnerNote([att], "ownerHook");
        const getSpy = vi.spyOn(note, "getAttachments");

        const result: { current: FAttachment[] } = { current: [] };
        function Harness() { result.current = useAttachments(note); return null; }
        const host = document.createElement("div");
        document.body.appendChild(host);
        act(() => {
            render(
                <ParentComponent.Provider value={parent}>
                    <Harness />
                </ParentComponent.Provider>,
                host
            );
        });
        await flush();
        expect(result.current.length).toBe(1);
        const callsAfterInit = getSpy.mock.calls.length;

        // Matching row → refresh.
        act(() => {
            (parent.handleEventInChildren as any)("entitiesReloaded", {
                loadResults: { getAttachmentRows: () => [ { attachmentId: "a1", ownerId: "ownerHook" } ] }
            });
        });
        await flush();
        expect(getSpy.mock.calls.length).toBeGreaterThan(callsAfterInit);

        // Non-matching owner → no extra refresh.
        const before = getSpy.mock.calls.length;
        act(() => {
            (parent.handleEventInChildren as any)("entitiesReloaded", {
                loadResults: { getAttachmentRows: () => [ { attachmentId: "x", ownerId: "someoneElse" } ] }
            });
        });
        await flush();
        expect(getSpy.mock.calls.length).toBe(before);

        act(() => { render(null, host); });
        host.remove();
    });
});

// --- AttachmentDetail ------------------------------------------------------------------------------

describe("AttachmentDetail", () => {
    it("renders the full-detail attachment when found via froca.getAttachment", async () => {
        const att = makeAttachment({ attachmentId: "det1", ownerId: "ownerDet", role: "file" });
        const note = buildOwnerNote([att], "ownerDet");
        froca.attachments[att.attachmentId] = att;
        vi.spyOn(froca, "getAttachment").mockResolvedValue(att);

        const root = renderWithProviders(
            <AttachmentDetail note={note} viewScope={{ viewMode: "attachments", attachmentId: "det1" }} {...TYPE_PROPS_EXTRA} />
        );
        await flush();

        expect(root.querySelector(".attachment-wrapper")).toBeTruthy();
        expect(root.querySelector(".attachment-detail-wrapper.full-detail")).toBeTruthy();
        // role==="file" → text preview is rendered from the blob content.
        expect(root.querySelector(".file-preview-content")).toBeTruthy();
    });

    it("shows the deleted message when the attachment resolves to null", async () => {
        const note = buildOwnerNote([], "ownerNull");
        vi.spyOn(froca, "getAttachment").mockResolvedValue(null as any);

        const root = renderWithProviders(
            <AttachmentDetail note={note} viewScope={{ viewMode: "attachments", attachmentId: "missing" }} {...TYPE_PROPS_EXTRA} />
        );
        await flush();

        expect(root.querySelector(".attachment-wrapper strong")).toBeTruthy();
        expect(root.querySelector(".attachment-detail-wrapper")).toBeNull();
    });

    it("does not fetch when there is no attachmentId in the view scope", async () => {
        const note = buildOwnerNote([], "ownerNoScope");
        const getSpy = vi.spyOn(froca, "getAttachment").mockResolvedValue(null as any);

        renderWithProviders(
            <AttachmentDetail note={note} viewScope={{ viewMode: "attachments" }} {...TYPE_PROPS_EXTRA} />
        );
        await flush();

        expect(getSpy).not.toHaveBeenCalled();
    });
});

// --- AttachmentInfo: deletion alert + roles --------------------------------------------------------

describe("AttachmentInfo deletion alert", () => {
    it("renders a deletion warning admonition when scheduled for erasure (far future)", async () => {
        vi.spyOn(options, "getInt").mockReturnValue(2592000);
        const att = makeAttachment({
            attachmentId: "del1",
            ownerId: "ownerDel",
            role: "file",
            utcDateScheduledForErasureSince: new Date().toISOString()
        });
        const note = buildOwnerNote([att], "ownerDel");

        const root = renderWithProviders(
            <AttachmentList note={note} viewScope={undefined} {...TYPE_PROPS_EXTRA} />
        );
        await flush();

        expect(root.querySelector(".attachment-deletion-warning")).toBeTruthy();
        expect(root.querySelector(".attachment-detail-wrapper.scheduled-for-deletion")).toBeTruthy();
    });

    it("renders the soon-deletion branch and falls back to default interval when getInt returns null", async () => {
        // erasure scheduled long ago → willBeDeletedInMs is negative (< 60000) → "soon" branch.
        vi.spyOn(options, "getInt").mockReturnValue(null as any);
        const att = makeAttachment({
            attachmentId: "del2",
            ownerId: "ownerDel2",
            role: "image",
            mime: "image/png",
            utcDateScheduledForErasureSince: "2000-01-01 00:00:00"
        });
        const note = buildOwnerNote([att], "ownerDel2");

        const root = renderWithProviders(
            <AttachmentList note={note} viewScope={undefined} {...TYPE_PROPS_EXTRA} />
        );
        await flush();

        expect(root.querySelector(".attachment-deletion-warning")).toBeTruthy();
    });
});

// --- AttachmentActions dropdown items --------------------------------------------------------------

function openActionsDropdown(root: HTMLElement) {
    // The Dropdown only mounts its children once Bootstrap fires `show.bs.dropdown`.
    const dropdown = root.querySelector(".attachment-actions");
    if (dropdown) {
        act(() => { $(dropdown).trigger("show.bs.dropdown"); });
    }
    return Array.from(root.querySelectorAll(".attachment-actions li.dropdown-item")) as HTMLElement[];
}

describe("AttachmentActions", () => {
    async function renderListWith(att: FAttachment, ownerId: string) {
        const note = buildOwnerNote([att], ownerId);
        const root = renderWithProviders(
            <AttachmentList note={note} viewScope={undefined} {...TYPE_PROPS_EXTRA} />
        );
        await flush();
        return root;
    }

    it("renders the OCR action only for ocr-capable roles (image/file)", async () => {
        const root = await renderListWith(makeAttachment({ attachmentId: "ocr1", ownerId: "ocrOwner", role: "file" }), "ocrOwner");
        const items = openActionsDropdown(root);
        // 9 items including OCR: open externally, open custom, download, copy link, OCR, upload revision, rename, delete, convert.
        expect(items.length).toBe(9);
    });

    it("omits the OCR action for non-ocr roles", async () => {
        const root = await renderListWith(makeAttachment({ attachmentId: "noocr", ownerId: "noOcrOwner", role: "audio" }), "noOcrOwner");
        const items = openActionsDropdown(root);
        expect(items.length).toBe(8);
    });

    it("invokes open/download services from the menu items", async () => {
        const root = await renderListWith(makeAttachment({ attachmentId: "act1", ownerId: "actOwner", role: "file", mime: "text/plain" }), "actOwner");
        const items = openActionsDropdown(root);

        items[0].click(); // open externally
        items[1].click(); // open custom
        items[2].click(); // download

        expect(open.openAttachmentExternally).toHaveBeenCalledWith("act1", "text/plain");
        expect(open.openAttachmentCustom).toHaveBeenCalledWith("act1", "text/plain");
        expect(open.downloadAttachment).toHaveBeenCalledWith("act1");
    });

    it("copies an image reference to clipboard for an image attachment", async () => {
        const root = await renderListWith(makeAttachment({ attachmentId: "img1", ownerId: "imgOwner", role: "image", mime: "image/png" }), "imgOwner");
        const items = openActionsDropdown(root);
        // copy-link is the 4th item (index 3) for image (OCR present).
        items[3].click();
        await flush();
        expect(image.copyImageReferenceToClipboard).toHaveBeenCalled();
    });

    it("copies a file link to clipboard for a file attachment", async () => {
        const fakeLink = $("<a href='#'>link</a>");
        (link.createLink as ReturnType<typeof vi.fn>).mockResolvedValue(fakeLink);
        const copySpy = vi.spyOn(utils, "copyHtmlToClipboard").mockImplementation(() => {});

        const root = await renderListWith(makeAttachment({ attachmentId: "file2", ownerId: "fileOwner", role: "file" }), "fileOwner");
        const items = openActionsDropdown(root);
        items[3].click(); // copy link (file, OCR present)
        await flush();

        expect(link.createLink).toHaveBeenCalledWith("fileOwner", expect.objectContaining({ referenceLink: true }));
        expect(copySpy).toHaveBeenCalled();
        expect(toast.showMessage).toHaveBeenCalled();
    });

    it("triggers the OCR dialog command through appContext", async () => {
        const root = await renderListWith(makeAttachment({ attachmentId: "ocr2", ownerId: "ocr2Owner", role: "file" }), "ocr2Owner");
        const items = openActionsDropdown(root);
        items[4].click(); // OCR item
        expect(triggerCommandMock).toHaveBeenCalledWith("showOcrTextDialog", expect.objectContaining({
            textUrl: "ocr/attachments/ocr2/text",
            processUrl: "ocr/process-attachment/ocr2"
        }));
    });

    it("aborts rename when the prompt is cancelled and renames when confirmed", async () => {
        const root = await renderListWith(makeAttachment({ attachmentId: "ren1", ownerId: "renOwner", role: "file" }), "renOwner");
        let items = openActionsDropdown(root);
        // rename item index: open(0) custom(1) download(2) copy(3) ocr(4) upload(5) rename(6) delete(7) convert(8)
        (dialog.prompt as ReturnType<typeof vi.fn>).mockResolvedValueOnce("   ");
        items[6].click();
        await flush();
        expect(server.put).not.toHaveBeenCalled();

        (dialog.prompt as ReturnType<typeof vi.fn>).mockResolvedValueOnce("New Name");
        items = openActionsDropdown(root);
        items[6].click();
        await flush();
        expect(server.put).toHaveBeenCalledWith("attachments/ren1/rename", { title: "New Name" });
    });

    it("aborts delete when not confirmed and deletes when confirmed", async () => {
        const root = await renderListWith(makeAttachment({ attachmentId: "del9", ownerId: "del9Owner", role: "file" }), "del9Owner");
        let items = openActionsDropdown(root);
        (dialog.confirm as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
        items[7].click();
        await flush();
        expect(server.remove).not.toHaveBeenCalled();

        (dialog.confirm as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
        items = openActionsDropdown(root);
        items[7].click();
        await flush();
        expect(server.remove).toHaveBeenCalledWith("attachments/del9");
        expect(toast.showMessage).toHaveBeenCalled();
    });

    it("aborts convert when not confirmed and converts (switching note) when confirmed", async () => {
        (server.post as ReturnType<typeof vi.fn>).mockResolvedValue({ note: { noteId: "converted1" } } as ConvertAttachmentToNoteResponse);

        const root = await renderListWith(makeAttachment({ attachmentId: "conv1", ownerId: "convOwner", role: "file" }), "convOwner");
        let items = openActionsDropdown(root);
        (dialog.confirm as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
        items[8].click();
        await flush();
        expect(server.post).not.toHaveBeenCalled();

        (dialog.confirm as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
        items = openActionsDropdown(root);
        items[8].click();
        await flush();
        expect(server.post).toHaveBeenCalledWith("attachments/conv1/convert-to-note");
        expect(ws.waitForMaxKnownEntityChangeId).toHaveBeenCalled();
        expect(setNoteMock).toHaveBeenCalledWith("converted1");
    });

    it("uploads a new revision via the hidden file input (success + failure)", async () => {
        const root = await renderListWith(makeAttachment({ attachmentId: "up1", ownerId: "upOwner", role: "file" }), "upOwner");
        openActionsDropdown(root); // mount the dropdown children (incl. the file input)
        const fileInput = root.querySelector(".attachment-actions input[type=file]") as HTMLInputElement;
        expect(fileInput).toBeTruthy();

        const file = new File([ "data" ], "rev.txt", { type: "text/plain" });
        Object.defineProperty(fileInput, "files", { value: { item: (i: number) => (i === 0 ? file : null) }, configurable: true });

        (server.upload as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ uploaded: true });
        fileInput.dispatchEvent(new Event("change", { bubbles: true }));
        await flush();
        expect(server.upload).toHaveBeenCalledWith("attachments/up1/file", file);
        expect(toast.showMessage).toHaveBeenCalled();

        (server.upload as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ uploaded: false });
        fileInput.dispatchEvent(new Event("change", { bubbles: true }));
        await flush();
        expect(toast.showError).toHaveBeenCalled();
    });

    it("triggers the hidden file input click from the 'upload revision' menu item", async () => {
        const root = await renderListWith(makeAttachment({ attachmentId: "up2", ownerId: "up2Owner", role: "file" }), "up2Owner");
        const items = openActionsDropdown(root);
        const fileInput = root.querySelector(".attachment-actions input[type=file]") as HTMLInputElement;
        const clickSpy = vi.spyOn(fileInput, "click").mockImplementation(() => {});
        items[5].click(); // "upload new revision" → fileUploadRef.current?.click()
        expect(clickSpy).toHaveBeenCalled();
    });

    it("throws for an unrecognized role when copying the link to clipboard", async () => {
        const rejections: unknown[] = [];
        const onRejection = (reason: unknown) => rejections.push(reason);
        process.on("unhandledRejection", onRejection);

        // role "video" is neither image nor file → the else branch throws.
        const root = await renderListWith(makeAttachment({ attachmentId: "vid1", ownerId: "vidOwner", role: "video", mime: "video/mp4" }), "vidOwner");
        const items = openActionsDropdown(root);
        // No OCR for "video" → copy-link is index 3.
        items[3].click();
        await flush();

        expect(image.copyImageReferenceToClipboard).not.toHaveBeenCalled();
        expect(link.createLink).not.toHaveBeenCalled();
        process.off("unhandledRejection", onRejection);
    });
});

// --- AttachmentInfo refresh on entitiesReloaded ---------------------------------------------------

describe("AttachmentInfo refresh", () => {
    it("re-renders content when an attachment entitiesReloaded event arrives", async () => {
        const att = makeAttachment({ attachmentId: "ref1", ownerId: "refOwner", role: "file" });
        const note = buildOwnerNote([att], "refOwner");

        renderWithProviders(
            <AttachmentList note={note} viewScope={undefined} {...TYPE_PROPS_EXTRA} />
        );
        await flush();

        const callsBefore = (content_renderer.getRenderedContent as ReturnType<typeof vi.fn>).mock.calls.length;
        act(() => {
            (parent.handleEventInChildren as any)("entitiesReloaded", {
                loadResults: { getAttachmentRows: () => [ { attachmentId: "anything" } ] }
            });
        });
        await flush();
        expect((content_renderer.getRenderedContent as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(callsBefore);
    });

    it("does not refresh when no attachment row has an attachmentId", async () => {
        const att = makeAttachment({ attachmentId: "ref2", ownerId: "ref2Owner", role: "file" });
        const note = buildOwnerNote([att], "ref2Owner");

        renderWithProviders(
            <AttachmentList note={note} viewScope={undefined} {...TYPE_PROPS_EXTRA} />
        );
        await flush();

        const callsBefore = (content_renderer.getRenderedContent as ReturnType<typeof vi.fn>).mock.calls.length;
        act(() => {
            (parent.handleEventInChildren as any)("entitiesReloaded", {
                loadResults: { getAttachmentRows: () => [ { attachmentId: "" } ] }
            });
        });
        await flush();
        expect((content_renderer.getRenderedContent as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBefore);
    });

    it("falls back to null text content when a file attachment blob is empty", async () => {
        const att = makeAttachment({ attachmentId: "blobnull", ownerId: "blobOwner", role: "file" });
        att.getBlob = async () => null as any;
        const note = buildOwnerNote([att], "blobOwner");

        const root = renderWithProviders(
            <AttachmentList note={note} viewScope={undefined} {...TYPE_PROPS_EXTRA} />
        );
        await flush();

        // No blob content → no text-preview is rendered.
        expect(root.querySelector(".file-preview-content")).toBeNull();
    });
});

describe("AttachmentActions electron branch", () => {
    it("enables the 'open custom' item when running under Electron", async () => {
        vi.spyOn(utils, "isElectron").mockReturnValue(true);
        const att = makeAttachment({ attachmentId: "el1", ownerId: "elOwner", role: "file" });
        const note = buildOwnerNote([att], "elOwner");

        const root = renderWithProviders(
            <AttachmentList note={note} viewScope={undefined} {...TYPE_PROPS_EXTRA} />
        );
        await flush();
        const items = openActionsDropdown(root);
        // open custom (index 1) is enabled under Electron (the `!isElectron` disabled branch is false).
        expect(items[1]?.classList.contains("disabled")).toBe(false);
    });
});
