import { CKEditorError, Essentials, Paragraph } from "ckeditor5";
import { describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../test/editor-kit.js";
import { onTextEditorError } from "./editor_errors.js";

describe("onTextEditorError", () => {
    it("reports the errors of its editor, except the ignored ones, until it is stopped", async () => {
        const editor = await createTestEditor([Essentials, Paragraph]);
        const otherEditor = await createTestEditor([Essentials, Paragraph]);
        const callback = vi.fn();
        const stop = onTextEditorError(editor, callback);

        const reported = new CKEditorError("some-editor-error", editor);
        escape(reported);
        escape(new CKEditorError("other-editor-error", otherEditor));
        escape(new CKEditorError("model-nodelist-offset-out-of-bounds", editor));
        const unexpected = new Error("Cannot read properties of null (reading 'parent')");
        unexpected.name = "TypeError";
        escape(wrapUnexpectedError(unexpected, editor));

        expect(callback).toHaveBeenCalledExactlyOnceWith(reported);

        stop();
        escape(new CKEditorError("after-stop-error", editor));
        expect(callback).toHaveBeenCalledOnce();
    });
});

/**
 * Fires the `error` event a thrown error reaches `window` with, which `onEditorError()` listens to.
 * Vitest reports an `error` event as unhandled only while no other listener is registered.
 */
function escape(error: Error) {
    const listener = () => {};
    window.addEventListener("error", listener);
    window.dispatchEvent(new ErrorEvent("error", { error }));
    window.removeEventListener("error", listener);
}

/** The `unexpected-error` that CKEditor wraps a native error in before it leaves the editor. */
function wrapUnexpectedError(error: Error, context: object) {
    try {
        CKEditorError.rethrowUnexpectedError(error, context);
    } catch (wrapped) {
        return wrapped as CKEditorError;
    }
    throw new Error("rethrowUnexpectedError() did not throw");
}
