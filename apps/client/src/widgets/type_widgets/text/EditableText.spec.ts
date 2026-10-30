/**
 * Regression tests for https://github.com/TriliumNext/Trilium/issues/10859 ("Upload pic error").
 *
 * The warning handler used to read the listener arguments in the wrong order, so every CKEditor
 * warning threw inside `Notification#fire`. The watchdog reported that as an `unexpected-error`
 * crash and restarted the editor, which reverted the note to its last saved content — the images
 * being uploaded flickered and vanished instead of a "cannot upload" toast appearing.
 */
import type {
    CKEditorError, CKTextEditor, FileUploadData, LinkAtSelection
} from "@triliumnext/ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type FAttachment from "../../../entities/fattachment";
import froca from "../../../services/froca";
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

const showInfoDialog = vi.hoisted(() => vi.fn());
vi.mock("../../../services/dialog", () => ({ default: { info: showInfoDialog } }));

// Imported by EditableText for editor types and content styles; irrelevant (and heavy) here.
vi.mock("@triliumnext/ckeditor5", () => ({}));

const showsAttachmentSave =
    vi.hoisted(() => vi.fn((_root: HTMLElement, _attachment: object) => false));
vi.mock("./utils", async (importOriginal) => ({
    ...await importOriginal<typeof import("./utils")>(),
    showsAttachmentSave
}));

const {
    applyPendingAttachmentChanges,
    getEditLinkOpts,
    getBlockData,
    isCaretInFocus,
    notifyAttachmentChanges,
    onNotificationInfo,
    parseLinkHref,
    onNotificationWarning,
    reportEditorError,
    revealLinkTargetWhenReady,
    showFileUploadProgress,
    watchEditorBlocks
} = await import("./EditableText");

describe("reportEditorError", () => {
    it("shows a toast that reloads the editor or opens the details, leaving the log to the global handler", () => {
        vi.clearAllMocks();
        const logError = vi.fn();
        vi.stubGlobal("logError", logError);
        const error = new Error("unexpected-error Original error: TypeError: boom") as CKEditorError;
        const reloadEditor = vi.fn();

        reportEditorError(error, reloadEditor);

        expect(logError).not.toHaveBeenCalled();
        expect(showPersistent).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
            id: "editor-error",
            title: "editable_text.editor_error_title",
            message: "editable_text.editor_error_content"
        }));

        const [ { buttons, timeout } ] = showPersistent.mock.calls[0];
        expect(timeout).toBeUndefined();
        expect(buttons.map((button: { text: string }) => button.text)).toEqual([
            "editable_text.editor_error_reload_button",
            "editable_text.editor_crashed_details_button"
        ]);

        const dismissReload = vi.fn();
        buttons[0].onClick({ dismissToast: dismissReload });
        expect(dismissReload).toHaveBeenCalledOnce();
        expect(reloadEditor).toHaveBeenCalledOnce();
        expect(showInfoDialog).not.toHaveBeenCalled();

        const dismissToast = vi.fn();
        buttons[1].onClick({ dismissToast });
        expect(dismissToast).toHaveBeenCalledOnce();
        expect(showInfoDialog).toHaveBeenCalledExactlyOnceWith(
            expect.anything(),
            expect.objectContaining({ title: "editable_text.editor_error_title", copyToClipboardButton: true })
        );
        expect(JSON.stringify(showInfoDialog.mock.calls[0][0])).toContain("TypeError: boom");
        vi.unstubAllGlobals();
    });

    it("shows the toast again once the details dialog closes, so the editor can still be reloaded", async () => {
        vi.clearAllMocks();
        let closeDialog = () => {};
        showInfoDialog.mockImplementationOnce(() => new Promise<void>((resolve) => {
            closeDialog = resolve;
        }));
        const reloadEditor = vi.fn();

        reportEditorError(new Error("unexpected-error") as CKEditorError, reloadEditor);
        const [ { buttons } ] = showPersistent.mock.calls[0];
        buttons[1].onClick({ dismissToast: vi.fn() });

        await Promise.resolve();
        expect(showPersistent).toHaveBeenCalledOnce();

        closeDialog();
        await vi.waitFor(() => expect(showPersistent).toHaveBeenCalledTimes(2));
        const [ { id, buttons: buttonsAgain } ] = showPersistent.mock.calls[1];
        expect(id).toBe("editor-error");
        buttonsAgain[0].onClick({ dismissToast: vi.fn() });
        expect(reloadEditor).toHaveBeenCalledOnce();
    });
});

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
    const root = document.createElement("div");
    const editor = {
        plugins: { get: () => ({ updateAttachmentLinks }) },
        editing: { view: { getDomRoot: () => root } }
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

    it("leaves out the saves that every embed of the attachment shows by itself", () => {
        const drawing = { attachmentId: "drawing" } as FAttachment;
        const renamed = { attachmentId: "renamed" } as FAttachment;
        froca.attachments.drawing = drawing;
        froca.attachments.renamed = renamed;
        showsAttachmentSave.mockImplementation((_root, attachment) => attachment === drawing);

        notify(loadResultsOf([
            { attachmentId: "drawing" },
            { attachmentId: "renamed" },
            { attachmentId: "drawing", isDeleted: true }
        ]), { current: undefined });

        expect(showsAttachmentSave).toHaveBeenCalledWith(root, drawing);
        expect(updateAttachmentLinks).toHaveBeenCalledExactlyOnceWith([
            { attachmentId: "renamed", isDeleted: false },
            { attachmentId: "drawing", isDeleted: true }
        ]);
        showsAttachmentSave.mockReset().mockReturnValue(false);
        delete froca.attachments.drawing;
        delete froca.attachments.renamed;
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

describe("getBlockData", () => {
    it("reads all of the content, with the blocks at its edges", () => {
        const getRange = vi.fn()
            .mockReturnValueOnce({ startId: "a", endId: "n" })
            .mockReturnValueOnce(null);
        const getData = vi.fn(() => "<p data-trilium-block-id=\"a\">&nbsp;</p>");
        const editor = {
            getData,
            plugins: { get: () => ({ getRange }) }
        } as unknown as CKTextEditor;

        expect(getBlockData(editor, "a:b")).toEqual({
            content: "<p data-trilium-block-id=\"a\">&nbsp;</p>",
            block: "a:n"
        });
        expect(getData).toHaveBeenCalledWith({ trim: "none" });
        expect(getRange).toHaveBeenCalledWith({ startId: "a", endId: "b" });
        expect(getBlockData(editor, "a").block).toBeUndefined();
    });
});

describe("watchEditorBlocks", () => {
    it("reports the blocks of the editor each time they change", () => {
        const getRange = vi.fn();
        const editor = { plugins: { get: () => ({ getRange }) } } as unknown as CKTextEditor;
        const onBlockChange = vi.fn();
        const report = watchEditorBlocks("a:b", onBlockChange);

        for (const range of [
            { startId: "a", endId: "b" },
            { startId: "a", endId: "n" },
            { startId: "a", endId: "n" },
            null,
            { startId: "a", endId: "b" }
        ]) {
            getRange.mockReturnValueOnce(range);
            report(editor);
        }

        expect(onBlockChange.mock.calls).toEqual([ [ "a:n" ], [ "a:b" ] ]);
        expect(getRange).toHaveBeenCalledWith({ startId: "a", endId: "b" });
    });
});

describe("revealLinkTargetWhenReady", () => {
    it("reveals a bookmark or blocks once the editor is ready, as in a new tab", async () => {
        vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
            callback(0);
            return 0;
        });
        const reveal = vi.fn();
        let markReady = () => {};
        const ready = new Promise<void>((resolve) => {
            markReady = resolve;
        });

        revealLinkTargetWhenReady({ block: "a:b" }, ready, reveal);
        revealLinkTargetWhenReady({ bookmark: "intro" }, ready, reveal);
        revealLinkTargetWhenReady({ viewMode: "default" }, ready, reveal);
        await Promise.resolve();
        expect(reveal).not.toHaveBeenCalled();

        markReady();
        await ready;
        await Promise.resolve();
        expect(reveal).toHaveBeenCalledTimes(2);
    });
});

describe("isCaretInFocus", () => {
    it("holds while focus stays in the editable element with the selection, not once a menu takes it", () => {
        const editable = document.createElement("div");
        editable.contentEditable = "true";
        editable.innerHTML = "<p>First paragraph</p>";
        const menu = document.createElement("div");
        menu.tabIndex = -1;
        document.body.append(editable, menu);
        const paragraph = editable.querySelector("p");
        expect(paragraph).toBeTruthy();

        editable.focus();
        window.getSelection()?.collapse(paragraph, 0);
        expect(isCaretInFocus(document.activeElement, window.getSelection())).toBe(true);

        // The selection stays in the editor while the menu holds focus.
        menu.focus();
        expect(window.getSelection()?.focusNode).toBe(paragraph);
        expect(isCaretInFocus(document.activeElement, window.getSelection())).toBe(false);

        editable.remove();
        menu.remove();
    });

    it("does not hold for the fake selection of a selected widget, which sits at the top of the viewport", () => {
        const editable = document.createElement("div");
        editable.contentEditable = "true";
        editable.innerHTML = "<figure class=\"image ck-widget ck-widget_selected\"></figure>"
            + "<div class=\"ck-fake-selection-container\" style=\"position: fixed; top: 0\"> </div>";
        document.body.append(editable);
        const container = editable.querySelector(".ck-fake-selection-container");
        expect(container?.firstChild).toBeTruthy();

        editable.focus();
        window.getSelection()?.selectAllChildren(container as Node);
        expect(isCaretInFocus(document.activeElement, window.getSelection())).toBe(false);

        editable.remove();
    });
});

describe("parseLinkHref", () => {
    it("reads a note link with its anchor, keeping its other parameters, or an address", () => {
        expect(parseLinkHref("#root/abc?bookmark=part")).toStrictEqual({
            currentLink: { notePath: "root/abc" }, currentBookmark: "part"
        });
        expect(parseLinkHref("#root/abc?viewMode=attachments&attachmentId=x")).toStrictEqual({
            currentLink: { notePath: "root/abc?viewMode=attachments&attachmentId=x" },
            currentBookmark: undefined
        });
        expect(parseLinkHref("https://example.com/#top")).toStrictEqual({
            currentLink: { externalLink: "https://example.com/#top" }, currentBookmark: undefined
        });
    });

    it("reads a link to one of the document's anchors as that anchor", () => {
        expect(parseLinkHref("#intro", [ "intro" ])).toStrictEqual({ currentAnchor: "intro" });
        expect(parseLinkHref("#intro", [ "outro" ])).toStrictEqual({
            currentLink: { notePath: "intro" }, currentBookmark: undefined
        });
        expect(parseLinkHref("https://example.com/#intro", [ "intro" ])).toStrictEqual({
            currentLink: { externalLink: "https://example.com/#intro" }, currentBookmark: undefined
        });
    });
});

describe("getEditLinkOpts", () => {
    function createApi(currentLink: LinkAtSelection | null, anchors: string[] = []) {
        return {
            hasSelection: vi.fn(() => true),
            getSelectedText: vi.fn(() => "chosen words"),
            getCurrentLink: vi.fn(() => currentLink),
            getAnchors: vi.fn(() => anchors),
            addLink: vi.fn(),
            updateLink: vi.fn(),
            addLinkPreview: vi.fn(),
            addLinkToEditor: vi.fn(),
            addHtmlToEditor: vi.fn(),
            addContentEmbed: vi.fn(),
            addImage: vi.fn(async () => {})
        };
    }
    const ready = async () => {};

    it("edits the link at the caret, rewriting it on save", async () => {
        const api = createApi({
            href: "#root/abc?bookmark=part", text: "See there", display: "plain"
        });
        const opts = getEditLinkOpts(api, ready);
        expect(opts).toMatchObject({
            text: "See there", hasSelection: false, currentTitle: "See there",
            currentLink: { notePath: "root/abc" }, currentBookmark: "part", display: "plain"
        });

        await opts.addLink("root/def", "Elsewhere");
        expect(api.updateLink).toHaveBeenCalledExactlyOnceWith("root/def", "Elsewhere", undefined);
        expect(api.addLink).not.toHaveBeenCalled();

        await opts.addLinkPreview?.("https://example.com", "card", "Example", "About");
        expect(api.addLinkPreview)
            .toHaveBeenCalledExactlyOnceWith("https://example.com", "card", "Example", "About");
    });

    it("edits a selected link preview as a web link titled by its title, shown as it is", () => {
        const api = createApi({
            href: "https://example.com", text: "Example", description: "About", display: "card"
        });
        expect(getEditLinkOpts(api, ready, { display: "inline" })).toMatchObject({
            currentLink: { externalLink: "https://example.com" }, currentTitle: "Example",
            currentDescription: "About", display: "card"
        });
    });

    it("adds a link from the selection outside one", async () => {
        const api = createApi(null);
        const opts = getEditLinkOpts(api, ready);
        expect(opts).toMatchObject({ text: "chosen words", hasSelection: true });
        expect(opts.currentLink).toBeUndefined();

        await opts.addLink("https://example.com", "Example", true);
        expect(api.addLink).toHaveBeenCalledExactlyOnceWith("https://example.com", "Example", true);
        expect(api.updateLink).not.toHaveBeenCalled();

        await opts.addLinkPreview?.("https://example.com", "inline", null, null);
        expect(api.addLinkPreview)
            .toHaveBeenCalledExactlyOnceWith("https://example.com", "inline", null, null);
    });

    it("offers the document's anchors, and edits a link to one of them as that anchor", () => {
        expect(getEditLinkOpts(createApi(null, [ "intro" ]), ready)).toMatchObject({
            anchors: [ "intro" ]
        });

        const api = createApi({ href: "#intro", text: "Start", display: "plain" }, [ "intro" ]);
        const opts = getEditLinkOpts(api, ready);
        expect(opts).toMatchObject({
            anchors: [ "intro" ], currentAnchor: "intro", currentTitle: "Start"
        });
        expect(opts.currentLink).toBeUndefined();
    });

    it("opens a new link on the side and with the display it is asked for", () => {
        const opts = getEditLinkOpts(createApi(null), ready, { target: "url", display: "embed" });
        expect(opts).toMatchObject({ target: "url", display: "embed" });
        expect(getEditLinkOpts(createApi(null), ready)).toMatchObject({
            target: undefined, display: undefined
        });
    });
});
