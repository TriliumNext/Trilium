import type VanillaCodeMirror from "@triliumnext/codemirror";
import { beforeEach, describe, expect, it, vi } from "vitest";

import appContext from "../../../components/app_context.js";
import type FNote from "../../../entities/fnote";
import froca from "../../../services/froca.js";
import { t } from "../../../services/i18n.js";
import server from "../../../services/server.js";
import toast from "../../../services/toast.js";
import type { EditLinkOpts } from "../../dialogs/edit_link.js";
import {
    insertText, replaceSelection, resolveWikilinkChip, showEditLinkDialog, toWikilink,
    uploadImageAndInsert
} from "./editor_utils.js";

const { loadBlockReferenceLabel } = vi.hoisted(() => ({
    loadBlockReferenceLabel: vi.fn(async (_note: FNote, block: string) => (
        block === "h1" ? { text: "Install", isBroken: false, isHeading: true } : null
    ))
}));
vi.mock("../../../services/block_excerpts.js", async (importOriginal) => ({
    ...await importOriginal<typeof import("../../../services/block_excerpts.js")>(),
    loadBlockReferenceLabel
}));

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

describe("toWikilink", () => {
    it("links the note of a path, with the heading or anchor its parameters point at", () => {
        expect(toWikilink("root/projects/abc123")).toBe("[[abc123]]");
        expect(toWikilink("root/abc123?block=h1%2Fa:h2")).toBe("[[abc123?block=h1%2Fa:h2]]");
        expect(toWikilink("abc123?bookmark=Set%20up")).toBe("[[abc123?bookmark=Set%20up]]");
    });
});

describe("resolveWikilinkChip", () => {
    it("draws a link as the note, followed by the heading or anchor it points at", async () => {
        const guide = { noteId: "abc123", title: "Guide", getIcon: () => "bx bx-book" } as FNote;
        vi.spyOn(froca, "getNoteFromCache").mockReturnValue(guide);
        vi.spyOn(froca, "getNote").mockResolvedValue(guide);

        expect(resolveWikilinkChip("abc123")).toEqual({ title: "Guide", icon: "bx bx-book" });
        await expect(resolveWikilinkChip("abc123", "block=h1"))
            .resolves.toEqual({ title: "Guide - Install", icon: "bx bx-book" });
        expect(loadBlockReferenceLabel).toHaveBeenCalledWith(guide, "h1");
        await expect(resolveWikilinkChip("abc123", "bookmark=Set%20up"))
            .resolves.toEqual({ title: "Guide - Set up", icon: "bx bx-book" });
        // A block that cannot be read leaves the title, and parameters naming neither change nothing.
        await expect(resolveWikilinkChip("abc123", "block=gone"))
            .resolves.toEqual({ title: "Guide", icon: "bx bx-book" });
        expect(resolveWikilinkChip("abc123", "ntxId=x")).toEqual({ title: "Guide", icon: "bx bx-book" });

        vi.spyOn(froca, "getNote").mockResolvedValue(null);
        await expect(resolveWikilinkChip("gone", "block=h1")).resolves.toBeNull();
    });
});

describe("showEditLinkDialog", () => {
    /** Opens the dialog over `selected` in `doc`, and returns its options and the editor. */
    function open(doc: string, selected = "") {
        const from = doc.indexOf(selected);
        const view = {
            state: {
                selection: { main: { from, to: from + selected.length } },
                sliceDoc: (start: number, end: number) => doc.slice(start, end)
            },
            dispatch: vi.fn(),
            focus: vi.fn()
        } as unknown as VanillaCodeMirror;
        const triggerCommand = vi.spyOn(appContext, "triggerCommand").mockResolvedValue(undefined);
        showEditLinkDialog(view);
        const opts = triggerCommand.mock.lastCall?.[1] as EditLinkOpts;
        return { opts, view };
    }

    it("puts a reference link as a Wikilink that keeps the heading or anchor it points at", async () => {
        const { opts, view } = open("See ");
        expect(opts).toMatchObject({ text: "", hasSelection: false });
        await opts.addLink("root/abc123?block=h1", null);
        expect(view.dispatch).toHaveBeenCalledWith({
            changes: { from: 0, to: 0, insert: "[[abc123?block=h1]]" },
            selection: { anchor: 19 }
        });
        expect(view.focus).toHaveBeenCalledOnce();

        // A link with a text of its own keeps the whole path, and a selection keeps its text.
        const titled = open("See Setup", "Setup");
        await titled.opts.addLink("root/abc123?bookmark=setup", "Setup guide");
        expect(titled.view.dispatch).toHaveBeenCalledWith(expect.objectContaining({
            changes: { from: 4, to: 9, insert: "[Setup](#root/abc123?bookmark=setup)" }
        }));
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
