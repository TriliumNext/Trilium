/**
 * Regression tests for https://github.com/TriliumNext/Trilium/issues/10859 ("Upload pic error").
 *
 * The warning handler used to read the listener arguments in the wrong order, so every CKEditor
 * warning threw inside `Notification#fire`. The watchdog reported that as an `unexpected-error`
 * crash and restarted the editor, which reverted the note to its last saved content — the images
 * being uploaded flickered and vanished instead of a "cannot upload" toast appearing.
 */
import { describe, expect, it, vi } from "vitest";

const showError = vi.hoisted(() => vi.fn());
const showErrorTitleAndMessage = vi.hoisted(() => vi.fn());
vi.mock("../../../services/toast", () => ({ default: { showError, showErrorTitleAndMessage } }));

// Imported by EditableText for editor types and content styles; irrelevant (and heavy) here.
vi.mock("@triliumnext/ckeditor5", () => ({}));

const { onNotificationWarning } = await import("./EditableText");

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
