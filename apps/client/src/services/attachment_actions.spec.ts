import { beforeEach, describe, expect, it, vi } from "vitest";

import type FAttachment from "../entities/fattachment";

const mocks = vi.hoisted(() => ({
    open: {
        openAttachmentExternally: vi.fn(),
        openAttachmentCustom: vi.fn(),
        downloadAttachment: vi.fn()
    },
    dialog: { prompt: vi.fn(), confirm: vi.fn() },
    server: { upload: vi.fn(), put: vi.fn(), remove: vi.fn(), post: vi.fn() },
    toast: { showMessage: vi.fn(), showError: vi.fn() },
    utils: { isElectron: vi.fn(() => true), copyHtmlToClipboard: vi.fn() },
    createLink: vi.fn(),
    triggerCommand: vi.fn(),
    setNote: vi.fn(),
    showImageCompressionDialog: vi.fn()
}));

vi.mock("./i18n", () => ({ t: (key: string) => key }));
vi.mock("./open", () => ({ default: mocks.open }));
vi.mock("./dialog", () => ({ default: mocks.dialog }));
vi.mock("./server", () => ({ default: mocks.server }));
vi.mock("./toast", () => ({ default: mocks.toast }));
vi.mock("./utils", () => ({ default: mocks.utils }));
vi.mock("./ws", () => ({ default: { waitForMaxKnownEntityChangeId: vi.fn() } }));
vi.mock("./link", () => ({ default: { createLink: mocks.createLink } }));
vi.mock("../components/app_context", () => ({
    default: {
        triggerCommand: mocks.triggerCommand,
        tabManager: { getActiveContext: () => ({ setNote: mocks.setNote }) }
    }
}));
vi.mock("../widgets/dialogs/image_compression/image_compression_dialog", () => ({
    showImageCompressionDialog: mocks.showImageCompressionDialog
}));

const { copyAttachmentReference, getAttachmentActionGroups } = await import("./attachment_actions");

function attachmentOf(role: string, mime = "application/pdf") {
    const title = "report.pdf";
    return { attachmentId: "att1", ownerId: "owner1", role, mime, title } as FAttachment;
}

function titles(attachment: FAttachment) {
    const groups = getAttachmentActionGroups(attachment);
    return groups.map((group) => group.map((action) => action.title));
}

/** The actions keyed by their title, which the mocked `t()` leaves as the translation key. */
function actionsOf(attachment: FAttachment) {
    const actions = getAttachmentActionGroups(attachment).flat();
    return Object.fromEntries(actions.map((action) => [ action.title, action ]));
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.utils.isElectron.mockReturnValue(true);
});

describe("getAttachmentActionGroups", () => {
    it("groups the actions, offering text extraction and compression only where they apply", () => {
        expect(titles(attachmentOf("file"))).toEqual([
            [
                "attachments_actions.open_externally",
                "attachments_actions.open_custom",
                "attachments_actions.download",
                "ocr.view_extracted_text"
            ],
            [
                "attachments_actions.upload_new_revision",
                "attachments_actions.rename_attachment",
                "attachments_actions.delete_attachment"
            ],
            [ "attachments_actions.convert_attachment_into_note" ]
        ]);

        const image = titles(attachmentOf("image", "image/png"));
        expect(image[0]).toContain("ocr.view_extracted_text");
        expect(image[2]).toEqual([
            "compress-image",
            "attachments_actions.convert_attachment_into_note"
        ]);

        // A link preview's picture belongs to the preview, not to the note.
        const favicon = titles(attachmentOf("favicon", "image/png"));
        expect(favicon[0]).not.toContain("ocr.view_extracted_text");
        expect(favicon[2]).toEqual([ "attachments_actions.convert_attachment_into_note" ]);
    });

    it("disables custom opening outside the desktop app, saying why", () => {
        expect(actionsOf(attachmentOf("file"))["attachments_actions.open_custom"].disabledReason)
            .toBeUndefined();

        mocks.utils.isElectron.mockReturnValue(false);
        expect(actionsOf(attachmentOf("file"))["attachments_actions.open_custom"].disabledReason)
            .toBe("attachments_actions.open_custom_client_only");
    });

    it("opens, downloads, extracts text from and compresses the attachment", async () => {
        const actions = actionsOf(attachmentOf("image", "image/png"));

        await actions["attachments_actions.open_externally"].run();
        await actions["attachments_actions.open_custom"].run();
        await actions["attachments_actions.download"].run();
        await actions["ocr.view_extracted_text"].run();
        await actions["compress-image"].run();

        expect(mocks.open.openAttachmentExternally).toHaveBeenCalledWith("att1", "image/png");
        expect(mocks.open.openAttachmentCustom).toHaveBeenCalledWith("att1", "image/png");
        expect(mocks.open.downloadAttachment).toHaveBeenCalledWith("att1");
        expect(mocks.triggerCommand).toHaveBeenCalledWith("showOcrTextDialog", {
            textUrl: "ocr/attachments/att1/text",
            processUrl: "ocr/process-attachment/att1"
        });
        expect(mocks.showImageCompressionDialog).toHaveBeenCalledWith({
            type: "attachment",
            attachmentId: "att1",
            mime: "image/png"
        });
    });

    it("offers copying a reference only to a caller that supplies the copy", async () => {
        const copyReference = vi.fn();
        const [ first ] = getAttachmentActionGroups(attachmentOf("file"), { copyReference });

        expect(first.map((action) => action.title)).toEqual([
            "attachments_actions.open_externally",
            "attachments_actions.open_custom",
            "attachments_actions.download",
            "attachments_actions.copy_link_to_clipboard",
            "ocr.view_extracted_text"
        ]);

        await first[3].run();
        expect(copyReference).toHaveBeenCalledOnce();
    });

    it("offers only the actions leaving the attachment unchanged for a read-only note", () => {
        const image = attachmentOf("image", "image/png");
        const groups = getAttachmentActionGroups(image, { isReadOnly: true });

        expect(groups.map((group) => group.map((action) => action.title))).toEqual([ [
            "attachments_actions.open_externally",
            "attachments_actions.open_custom",
            "attachments_actions.download",
            "ocr.view_extracted_text"
        ] ]);
    });

    it("renames, deletes and converts only once the user has agreed", async () => {
        const actions = actionsOf(attachmentOf("file"));
        mocks.dialog.prompt.mockResolvedValueOnce("  ").mockResolvedValueOnce("Renamed");
        mocks.dialog.confirm.mockResolvedValue(false);

        await actions["attachments_actions.rename_attachment"].run();
        await actions["attachments_actions.delete_attachment"].run();
        await actions["attachments_actions.convert_attachment_into_note"].run();
        expect(mocks.server.put).not.toHaveBeenCalled();
        expect(mocks.server.remove).not.toHaveBeenCalled();
        expect(mocks.server.post).not.toHaveBeenCalled();

        mocks.dialog.confirm.mockResolvedValue(true);
        mocks.server.post.mockResolvedValue({ note: { noteId: "newNote" } });

        await actions["attachments_actions.rename_attachment"].run();
        await actions["attachments_actions.delete_attachment"].run();
        await actions["attachments_actions.convert_attachment_into_note"].run();
        expect(mocks.server.put)
            .toHaveBeenCalledWith("attachments/att1/rename", { title: "Renamed" });
        expect(mocks.server.remove).toHaveBeenCalledWith("attachments/att1");
        expect(mocks.server.post).toHaveBeenCalledWith("attachments/att1/convert-to-note");
        expect(mocks.setNote).toHaveBeenCalledWith("newNote");
    });

    it("uploads the picked file as a new revision, reporting the outcome", async () => {
        const click = vi.spyOn(HTMLInputElement.prototype, "click").mockReturnValue(undefined);
        const file = new File([ "new" ], "report.pdf", { type: "application/pdf" });

        const outcomes = [
            [ true, mocks.toast.showMessage ],
            [ false, mocks.toast.showError ]
        ] as const;

        for (const [ uploaded, report ] of outcomes) {
            click.mockClear();
            mocks.server.upload.mockResolvedValue({ uploaded });
            await actionsOf(attachmentOf("file"))["attachments_actions.upload_new_revision"].run();

            const input = click.mock.instances[0] as unknown as HTMLInputElement;
            expect(input.type).toBe("file");
            Object.defineProperty(input, "files", { value: { item: () => file } });
            input.dispatchEvent(new Event("change"));

            await vi.waitFor(() => expect(report).toHaveBeenCalled());
            expect(mocks.server.upload).toHaveBeenLastCalledWith("attachments/att1/file", file);
        }
    });
});

describe("copyAttachmentReference", () => {
    it("puts a reference link to the attachment on the clipboard", async () => {
        const html = "<a class=\"reference-link\">x</a>";
        mocks.createLink.mockResolvedValue([ { outerHTML: html } ]);

        await copyAttachmentReference(attachmentOf("file"));

        expect(mocks.createLink).toHaveBeenCalledWith("owner1", {
            referenceLink: true,
            viewScope: { viewMode: "attachments", attachmentId: "att1" }
        });
        expect(mocks.utils.copyHtmlToClipboard).toHaveBeenCalledWith(html);
        expect(mocks.toast.showMessage).toHaveBeenCalledWith("attachment_detail_2.link_copied");
    });
});
