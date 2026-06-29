import type VanillaCodeMirror from "@triliumnext/codemirror";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type FNote from "../../../entities/fnote";
import { t } from "../../../services/i18n.js";
import server from "../../../services/server.js";
import toast from "../../../services/toast.js";
import { insertText, replaceSelection, uploadImageAndInsert } from "./editor_utils.js";

// A minimal CodeMirror view stand-in: the helpers only read the cursor head and
// call dispatch(), so we capture the dispatched transaction to assert against it.
function makeView(head = 0) {
    return {
        state: { selection: { main: { head } } },
        dispatch: vi.fn()
    } as unknown as VanillaCodeMirror;
}

const note = { noteId: "note123" } as FNote;
const file = new File([ "x" ], "picture.png", { type: "image/png" });

const uploadMock = vi.fn();
const showErrorMock = vi.fn();

beforeEach(() => {
    vi.clearAllMocks();
    server.upload = uploadMock as typeof server.upload;
    toast.showError = showErrorMock as typeof toast.showError;
});

describe("insertText", () => {
    it("inserts at an explicit position and moves the cursor to the end of the inserted text", () => {
        const view = makeView();
        insertText(view, "hello", 3);
        expect(view.dispatch).toHaveBeenCalledWith({
            changes: { from: 3, insert: "hello" },
            selection: { anchor: 8 }
        });
    });

    it("falls back to the current cursor head when no position is given", () => {
        const view = makeView(10);
        insertText(view, "ab");
        expect(view.dispatch).toHaveBeenCalledWith({
            changes: { from: 10, insert: "ab" },
            selection: { anchor: 12 }
        });
    });
});

describe("replaceSelection", () => {
    it("replaces the range with text and moves the cursor to the end", () => {
        const view = makeView();
        replaceSelection(view, "new", 4, 9);
        expect(view.dispatch).toHaveBeenCalledWith({
            changes: { from: 4, to: 9, insert: "new" },
            selection: { anchor: 7 }
        });
    });
});

describe("uploadImageAndInsert", () => {
    it("inserts a markdown image reference on a successful upload and shows no error", async () => {
        const view = makeView(5);
        uploadMock.mockResolvedValue({ uploaded: true, url: "/img/abc.png" });

        await uploadImageAndInsert(view, note, file, 5);

        expect(uploadMock).toHaveBeenCalledWith("notes/note123/attachments/upload", file, undefined, "POST");
        const markdownRef = "![picture.png](/img/abc.png)";
        expect(view.dispatch).toHaveBeenCalledWith({
            changes: { from: 5, insert: markdownRef },
            selection: { anchor: 5 + markdownRef.length }
        });
        expect(showErrorMock).not.toHaveBeenCalled();
    });

    it("surfaces the server's message (and inserts nothing) when the upload reports failure", async () => {
        const view = makeView();
        uploadMock.mockResolvedValue({ uploaded: false, message: "Disk full" });

        await uploadImageAndInsert(view, note, file);

        expect(view.dispatch).not.toHaveBeenCalled();
        expect(showErrorMock).toHaveBeenCalledTimes(1);
        // i18next is uninitialised in the test env so t() returns the key; we only
        // assert the server detail is appended to whatever base message was built.
        expect(showErrorMock).toHaveBeenCalledWith(expect.stringContaining("Disk full"));
    });

    it("falls back to a network Error's message when the upload throws", async () => {
        const view = makeView();
        uploadMock.mockRejectedValue(new Error("Network down"));

        await uploadImageAndInsert(view, note, file);

        expect(showErrorMock).toHaveBeenCalledWith(expect.stringContaining("Network down"));
    });

    it("shows the bare base message when the upload throws a non-Error value", async () => {
        const view = makeView();
        // A thrown string carries no `.message`, so no detail is appended.
        uploadMock.mockRejectedValue("just a string");

        await uploadImageAndInsert(view, note, file);

        expect(showErrorMock).toHaveBeenCalledWith(t("markdown_editor.image_upload_failed", { name: "picture.png" }));
    });

    it("shows the bare base message when no detail is available", async () => {
        const view = makeView();
        // A resolved-but-unsuccessful result carrying no message yields no detail.
        uploadMock.mockResolvedValue({ uploaded: false });

        await uploadImageAndInsert(view, note, file);

        // With no detail, the toast is exactly the base message and nothing is appended.
        expect(showErrorMock).toHaveBeenCalledWith(t("markdown_editor.image_upload_failed", { name: "picture.png" }));
        expect(showErrorMock).toHaveBeenCalledTimes(1);
    });
});
