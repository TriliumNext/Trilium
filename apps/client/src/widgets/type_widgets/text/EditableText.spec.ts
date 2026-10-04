/**
 * Regression tests for https://github.com/TriliumNext/Trilium/issues/10859 ("Upload pic error").
 *
 * The warning handler used to read the listener arguments in the wrong order, so every CKEditor
 * warning threw inside `Notification#fire`. The watchdog reported that as an `unexpected-error`
 * crash and restarted the editor, which reverted the note to its last saved content — the images
 * being uploaded flickered and vanished instead of a "cannot upload" toast appearing.
 */
import type { CKTextEditor, FileUploadData } from "@triliumnext/ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type LoadResults from "../../../services/load_results";

const showError = vi.hoisted(() => vi.fn());
const showErrorTitleAndMessage = vi.hoisted(() => vi.fn());
const showMessage = vi.hoisted(() => vi.fn());
const showPersistent = vi.hoisted(() => vi.fn());
const closePersistent = vi.hoisted(() => vi.fn());
vi.mock("../../../services/toast", () => ({
    default: { showError, showErrorTitleAndMessage, showMessage, showPersistent, closePersistent }
}));
vi.mock("../../../services/i18n", async (importOriginal) => ({
    ...await importOriginal<typeof import("../../../services/i18n")>(),
    t: (key: string) => key
}));

// Imported by EditableText for editor types and content styles; irrelevant (and heavy) here.
vi.mock("@triliumnext/ckeditor5", () => ({}));

const {
    applyPendingAttachmentChanges,
    notifyAttachmentChanges,
    onNotificationInfo,
    onNotificationWarning,
    showFileUploadProgress
} = await import("./EditableText");

describe("onNotificationWarning", () => {
    /** The payload `Notification#_showNotification` builds, with the `EventInfo` before it. */
    function warn(data: { message: string; title: string }) {
        const evt = { stop: vi.fn() };
        onNotificationWarning(evt, { type: "warning", ...data });
        return evt;
    }

    it("reports a titled warning as a titled toast and stops the event", () => {
        // What a failed upload produces: FileUploadEditing passes the rejection reason as the
        // message and "Upload failed" as the title.
        const message = "Cannot upload file: pic.png.";
        const evt = warn({ message, title: "Upload failed" });

        expect(showErrorTitleAndMessage).toHaveBeenCalledWith("Upload failed", message);
        expect(showError).not.toHaveBeenCalled();
        // Stopping the event is what keeps the notification plugin's `window.alert` fallback away.
        expect(evt.stop).toHaveBeenCalledOnce();
    });

    it("reports an untitled warning as a plain toast rather than dropping it", () => {
        vi.clearAllMocks();
        // `showWarning` leaves the title an empty string when the caller supplies none.
        const evt = warn({ message: "Something went wrong.", title: "" });

        expect(showError).toHaveBeenCalledWith("Something went wrong.");
        expect(showErrorTitleAndMessage).not.toHaveBeenCalled();
        expect(evt.stop).toHaveBeenCalledOnce();
    });

    it("stops the event even when there is nothing to report", () => {
        vi.clearAllMocks();
        const evt = warn({ message: "", title: "" });

        expect(showError).not.toHaveBeenCalled();
        expect(showErrorTitleAndMessage).not.toHaveBeenCalled();
        expect(evt.stop).toHaveBeenCalledOnce();
    });
});

describe("onNotificationInfo", () => {
    it("shows the message as a toast and leaves the event running", () => {
        vi.clearAllMocks();
        const evt = { stop: vi.fn() };
        onNotificationInfo(evt, { type: "info", message: "Rows sorted.", title: "" });

        expect(showMessage).toHaveBeenCalledWith("Rows sorted.");
        expect(evt.stop).not.toHaveBeenCalled();
    });
});

describe("showFileUploadProgress", () => {
    it("shows the progress of an upload in a toast until the upload ends", async () => {
        vi.clearAllMocks();
        let finish = () => {};
        const done = new Promise<void>((resolve) => {
            finish = () => resolve();
        });
        const listeners = new Map<string, () => void>();
        const loader = {
            id: "loader1",
            uploadedPercent: 0,
            on: vi.fn((event: string, callback: () => void) => listeners.set(event, callback)),
            off: vi.fn()
        };

        const upload = { fileName: "report.pdf", loader, done } as unknown as FileUploadData;

        showFileUploadProgress({}, upload);
        expect(showPersistent).toHaveBeenLastCalledWith(expect.objectContaining({
            id: "file-upload-loader1",
            title: "editable_text.uploading_attachment",
            message: "report.pdf",
            progress: 0,
            dismissible: false
        }));

        loader.uploadedPercent = 40;
        listeners.get("change:uploadedPercent")?.();
        expect(showPersistent).toHaveBeenLastCalledWith(expect.objectContaining({
            id: "file-upload-loader1",
            progress: 0.4
        }));
        expect(closePersistent).not.toHaveBeenCalled();

        finish();
        await done;
        expect(closePersistent).toHaveBeenCalledWith("file-upload-loader1");
        expect(loader.off).toHaveBeenCalledWith(
            "change:uploadedPercent",
            listeners.get("change:uploadedPercent")
        );
    });
});

describe("notifyAttachmentChanges", () => {
    type Row = { attachmentId?: string; isDeleted?: boolean };

    const updateAttachmentLinks = vi.fn();
    const editor = {
        plugins: { get: () => ({ updateAttachmentLinks }) }
    } as unknown as CKTextEditor;

    function loadResultsOf(rows: Row[], isContentReloaded = false) {
        return {
            getAttachmentRows: vi.fn(() => rows),
            isNoteContentReloaded: vi.fn(() => isContentReloaded)
        };
    }

    function notify(loadResults: ReturnType<typeof loadResultsOf>, pending: PendingRef) {
        notifyAttachmentChanges(
            editor, loadResults as unknown as LoadResults, "note1", "component1", pending
        );
    }

    type PendingRef = Parameters<typeof notifyAttachmentChanges>[4];

    beforeEach(() => updateAttachmentLinks.mockClear());

    it("passes the changed attachments to the editor's reference links", () => {
        const loadResults = loadResultsOf([
            { attachmentId: "renamed" },
            { attachmentId: "deleted", isDeleted: true }
        ]);

        notify(loadResults, { current: undefined });

        expect(loadResults.isNoteContentReloaded).toHaveBeenCalledWith("note1", "component1");
        // Without the attachments that this editor saved, such as a canvas drawing.
        expect(loadResults.getAttachmentRows).toHaveBeenCalledWith("component1");
        expect(updateAttachmentLinks).toHaveBeenCalledWith([
            { attachmentId: "renamed", isDeleted: false },
            { attachmentId: "deleted", isDeleted: true }
        ]);
    });

    it("leaves the links alone when no attachment changed", () => {
        const pending: PendingRef = { current: undefined };

        notify(loadResultsOf([]), pending);

        expect(updateAttachmentLinks).not.toHaveBeenCalled();
        expect(pending.current).toBeUndefined();
    });

    it("holds the changes while the note content reloads, until the editor takes it", () => {
        const pending: PendingRef = { current: undefined };

        notify(loadResultsOf([ { attachmentId: "renamed" } ], true), pending);
        notify(loadResultsOf([ { attachmentId: "deleted", isDeleted: true } ], true), pending);
        expect(updateAttachmentLinks).not.toHaveBeenCalled();

        applyPendingAttachmentChanges(editor, "note1", pending);
        expect(updateAttachmentLinks).toHaveBeenCalledExactlyOnceWith([
            { attachmentId: "renamed", isDeleted: false },
            { attachmentId: "deleted", isDeleted: true }
        ]);

        applyPendingAttachmentChanges(editor, "note1", pending);
        expect(updateAttachmentLinks).toHaveBeenCalledOnce();
    });

    it("drops the held changes when the editor takes another note's content", () => {
        const pending: PendingRef = { current: undefined };
        notify(loadResultsOf([ { attachmentId: "renamed" } ], true), pending);

        applyPendingAttachmentChanges(editor, "note2", pending);
        applyPendingAttachmentChanges(editor, "note1", pending);

        expect(updateAttachmentLinks).not.toHaveBeenCalled();
    });
});
