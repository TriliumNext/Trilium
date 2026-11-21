import type { SaveConflictResponse, SavedAttachmentRow } from "@triliumnext/commons";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type FAttachment from "../entities/fattachment";
import type FNote from "../entities/fnote";
import { buildNote } from "../test/easy-froca";
import {
    getLatestBlob, NoteSaver, parseConflict, recordReplacedBlob, type SaveData, type SavingEditor
} from "./note_save";
import server from "./server";
import toast from "./toast";

vi.mock("./i18n", () => ({ t: (key: string) => key }));

const PUT_OPTIONS = { silentConflict: true };

describe("NoteSaver", () => {
    let put: ReturnType<typeof vi.fn>;
    let post: ReturnType<typeof vi.fn>;
    let get: ReturnType<typeof vi.fn>;
    let showPersistent: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.restoreAllMocks();
        put = vi.fn();
        post = vi.fn(async () => ({ revisionId: "kept", isKept: true, isFragment: false }));
        get = vi.fn();
        server.put = put as typeof server.put;
        server.post = post as typeof server.post;
        server.get = get as typeof server.get;
        showPersistent = vi.spyOn(toast, "showPersistent").mockImplementation(() => {});
        vi.spyOn(toast, "closePersistent").mockImplementation(() => {});
    });

    function createEditor(resolveConflict?: SavingEditor<SaveData>["resolveConflict"]) {
        return {
            componentId: "editor",
            getLatestData: vi.fn<(noteId: string) => SaveData | undefined>(() => undefined),
            getLatestAttachment: vi.fn<
                (noteId: string, attachmentId: string) => SavedAttachmentRow | undefined
            >(() => undefined),
            loadVersion: vi.fn(),
            loadBlocks: vi.fn(),
            onPaused: vi.fn(),
            resolveConflict
        };
    }

    /** A saver of `note`, based on the blob `b0` of a text note. */
    function createSaver(note: FNote, editor = createEditor()) {
        const saver = new NoteSaver<SaveData>(editor);
        saver.setBase({
            noteId: note.noteId, blobId: "b0", content: "<p>0</p>", type: "text", mime: "text/html"
        });
        return { saver, editor };
    }

    function rejectWithConflict(conflict: Partial<SaveConflictResponse>) {
        put.mockRejectedValueOnce(JSON.stringify({
            message: "Changed", blobId: "theirs", type: "text", mime: "text/html",
            isVersioned: true, ...conflict
        }));
    }

    /** Waits for the question about a version, and answers it with its button `index`. */
    async function answer(index: number) {
        await vi.waitFor(() => expect(getQuestion()).toBeDefined());
        getQuestion()?.buttons?.[index].onClick({ dismissToast: () => {} });
    }

    function getQuestion() {
        return showPersistent.mock.calls.map(([ options ]) => options)
            .find((options) => options.id.startsWith("save-conflict-"));
    }

    it("saves on its base, and takes the answer as the next base", async () => {
        const note = buildNote({ title: "Saved" });
        const { saver } = createSaver(note);
        put.mockResolvedValueOnce({
            blobId: "b1", attachments: [], content: "<p>1, rewritten</p>"
        });

        expect(await saver.saveNote(note, { content: "<p>1</p>" }))
            .toStrictEqual({ content: "<p>1</p>" });
        expect(put).toHaveBeenCalledExactlyOnceWith(`notes/${note.noteId}/data`, {
            content: "<p>1</p>", attachments: undefined,
            base: { blobId: "b0", type: "text", mime: "text/html" }, keepOther: undefined
        }, "editor", PUT_OPTIONS);
        expect(saver.getBase(note.noteId))
            .toMatchObject({ blobId: "b1", content: "<p>1, rewritten</p>" });
        // `froca` still holds the blob that the save replaced until its entity change arrives.
        expect(getLatestBlob(note.noteId, "b0")).toBe("b1");
    });

    it("pauses a save on a version conflict, until the user keeps this version", async () => {
        const note = buildNote({ title: "Kept" });
        const { saver, editor } = createSaver(note);
        editor.getLatestData.mockReturnValue({ content: "<p>typed while asked</p>" });
        rejectWithConflict({ reason: "version" });
        put.mockResolvedValueOnce({ blobId: "b2", attachments: [] });

        const saving = saver.saveNote(note, { content: "<p>mine</p>" });
        await vi.waitFor(() => expect(getQuestion()).toBeDefined());
        expect(editor.onPaused).toHaveBeenCalledOnce();
        expect(saver.isPaused(note.noteId)).toBe(true);
        expect(getQuestion()).toMatchObject({ dismissible: false, notes: [ note.noteId ] });
        expect(put).toHaveBeenCalledOnce();

        await answer(0);
        expect(await saving).toStrictEqual({ content: "<p>typed while asked</p>" });
        expect(put).toHaveBeenLastCalledWith(`notes/${note.noteId}/data`, {
            content: "<p>typed while asked</p>", attachments: undefined,
            base: { blobId: "theirs", type: "text", mime: "text/html" }, keepOther: true
        }, "editor", PUT_OPTIONS);
        expect(saver.isPaused(note.noteId)).toBe(false);
        expect(post).not.toHaveBeenCalled();
    });

    it("keeps the draft as a revision, then loads the other version", async () => {
        const note = buildNote({ title: "Loaded" });
        const { saver, editor } = createSaver(note);
        rejectWithConflict({ reason: "version", isVersioned: false });
        get.mockResolvedValueOnce({ blobId: "theirs", content: "<p>theirs</p>" });

        const saving = saver.saveNote(note, { content: "<p>mine</p>" });
        await vi.waitFor(() => expect(getQuestion()).toBeDefined());
        expect(getQuestion()?.message).toBe("note_save.conflict_message_unversioned");
        await answer(1);

        expect(await saving).toBeUndefined();
        expect(post).toHaveBeenCalledExactlyOnceWith(`notes/${note.noteId}/revisions/draft`, {
            revisionId: expect.any(String), type: "text", mime: "text/html",
            content: "<p>mine</p>", attachments: undefined
        }, "editor");
        expect(get).toHaveBeenCalledExactlyOnceWith(`notes/${note.noteId}/blob`);
        expect(editor.loadVersion).toHaveBeenCalledExactlyOnceWith(
            note.noteId, { blobId: "theirs", content: "<p>theirs</p>" });
        expect(saver.getBase(note.noteId))
            .toMatchObject({ blobId: "theirs", content: "<p>theirs</p>" });
        expect(showPersistent).toHaveBeenLastCalledWith(
            expect.objectContaining({ message: "note_save.draft_kept" }));
    });

    it("keeps what is typed while the draft is kept and the other version loads", async () => {
        const note = buildNote({ title: "Typed during the requests" });
        const { saver, editor } = createSaver(note);
        const type = (content: string) => editor.getLatestData.mockReturnValue({ content });
        const kept = { revisionId: "kept", isKept: true, isFragment: false };
        rejectWithConflict({ reason: "version" });
        post.mockImplementationOnce(async () => {
            type("<p>mine, 2</p>");
            return kept;
        }).mockImplementationOnce(async () => {
            type("<p>mine, 4</p>");
            return kept;
        });
        get.mockImplementationOnce(async () => {
            type("<p>mine, 3</p>");
            return { blobId: "theirs", content: "<p>theirs</p>" };
        });

        const saving = saver.saveNote(note, { content: "<p>mine</p>" });
        await answer(1);
        expect(await saving).toBeUndefined();
        expect(post.mock.calls.map(([ , request ]) => request.content))
            .toStrictEqual([ "<p>mine</p>", "<p>mine, 3</p>", "<p>mine, 4</p>" ]);
        expect(new Set(post.mock.calls.map(([ , request ]) => request.revisionId)).size).toBe(3);
        expect(editor.loadVersion).toHaveBeenCalledExactlyOnceWith(
            note.noteId, { blobId: "theirs", content: "<p>theirs</p>" });
        expect(editor.loadVersion.mock.invocationCallOrder[0])
            .toBeGreaterThan(post.mock.invocationCallOrder[2]);
    });

    it("keeps the strokes drawn while asked as drafts of the attachment", async () => {
        const note = buildNote({ title: "Drawn during the question" });
        const { saver, editor } = createSaver(note);
        const row = {
            attachmentId: "drawing1", blobId: "read", role: "file",
            mime: "application/vnd.excalidraw+json", title: "Canvas.excalidraw"
        };
        const draw = (content: string) =>
            editor.getLatestAttachment.mockReturnValue({ ...row, content });
        post.mockRejectedValueOnce(JSON.stringify({
            reason: "version", message: "", blobId: "noteBlob", type: "text", mime: "text/html",
            isVersioned: true
        })).mockImplementationOnce(async () => {
            draw("stroke 3");
            return { revisionId: "kept", isKept: true, isFragment: false };
        });
        get.mockResolvedValue({ blobId: "noteBlob", content: "<p>note</p>" });

        const saving = saver.saveAttachment(note, { ...row, content: "stroke 1" });
        await vi.waitFor(() => expect(getQuestion()).toBeDefined());
        draw("stroke 2");
        await answer(1);
        expect(await saving).toBeUndefined();
        expect(post.mock.calls.slice(1).map(([ url, { content, attachments } ]) =>
            [ url, content, attachments ])).toStrictEqual([
            [ `notes/${note.noteId}/revisions/draft`, "<p>note</p>",
                [ { ...row, content: "stroke 2" } ] ],
            [ `notes/${note.noteId}/revisions/draft`, "<p>note</p>",
                [ { ...row, content: "stroke 3" } ] ]
        ]);
        expect(editor.getLatestAttachment).toHaveBeenCalledWith(note.noteId, "drawing1");
        expect(editor.loadVersion).toHaveBeenCalledExactlyOnceWith(
            note.noteId, { blobId: "noteBlob", content: "<p>note</p>" });
        expect(editor.loadVersion.mock.invocationCallOrder[0])
            .toBeGreaterThan(post.mock.invocationCallOrder[2]);
    });

    it("keeps the draft once the editor goes away, with one revision ID on a retry", async () => {
        const note = buildNote({ title: "Abandoned" });
        const { saver } = createSaver(note);
        rejectWithConflict({ reason: "version" });
        post.mockRejectedValueOnce("offline");

        const saving = saver.saveNote(note, { content: "<p>mine</p>" });
        await vi.waitFor(() => expect(getQuestion()).toBeDefined());
        saver.abandon(note.noteId);
        expect(saver.isPaused(note.noteId)).toBe(true);
        saver.abandon("anotherNote");
        await expect(saving).rejects.toBe("offline");
        // Still pending, so the window asks before it closes.
        expect(saver.isPaused(note.noteId)).toBe(true);

        expect(await saver.saveNote(note, { content: "<p>mine</p>" })).toBeUndefined();
        expect(put).toHaveBeenCalledOnce();
        expect(post).toHaveBeenCalledTimes(2);
        const [ first, second ] = post.mock.calls.map(([ , request ]) => request.revisionId);
        expect(second).toBe(first);
        expect(saver.isPaused(note.noteId)).toBe(false);
    });

    it("keeps a draft in its format after a conversion, found by either side", async () => {
        const note = buildNote({ title: "Converted" });
        const { saver } = createSaver(note);
        rejectWithConflict({ reason: "format", type: "code", mime: "text/x-markdown" });
        expect(await saver.saveNote(note, { content: "<p>mine</p>" })).toBeUndefined();
        expect(getQuestion()).toBeUndefined();
        expect(post).toHaveBeenLastCalledWith(`notes/${note.noteId}/revisions/draft`,
            expect.objectContaining({ type: "text", mime: "text/html", content: "<p>mine</p>" }),
            "editor");
        expect(showPersistent).toHaveBeenLastCalledWith(
            expect.objectContaining({ message: "note_save.draft_kept_after_conversion" }));

        // The client knows of the conversion first: the save goes to the revision directly.
        note.type = "code";
        note.mime = "text/x-markdown";
        post.mockResolvedValueOnce({ revisionId: "x", isKept: false, isFragment: false });
        expect(await saver.saveNote(note, { content: "<p>again</p>" })).toBeUndefined();
        expect(put).toHaveBeenCalledOnce();
        expect(showPersistent).toHaveBeenLastCalledWith(
            expect.objectContaining({ message: "note_save.draft_discarded_after_conversion" }));
    });

    it("lets the editor bring its changes onto the other version before asking", async () => {
        const note = buildNote({ title: "Rebased" });
        const resolveConflict = vi.fn(async () => true);
        const { saver, editor } = createSaver(note, createEditor(resolveConflict));
        editor.getLatestData.mockReturnValue({ content: "<p>rebased</p>" });
        rejectWithConflict({ reason: "version" });
        get.mockResolvedValueOnce({ blobId: "read", content: "<p>theirs</p>" });
        put.mockResolvedValueOnce({ blobId: "b3", attachments: [] });

        expect(await saver.saveNote(note, { content: "<p>mine</p>" }))
            .toStrictEqual({ content: "<p>rebased</p>" });
        expect(resolveConflict).toHaveBeenCalledExactlyOnceWith(
            note.noteId, { blobId: "read", content: "<p>theirs</p>" });
        expect(getQuestion()).toBeUndefined();
        expect(put).toHaveBeenLastCalledWith(`notes/${note.noteId}/data`, expect.objectContaining({
            content: "<p>rebased</p>", base: { blobId: "read", type: "text", mime: "text/html" },
            keepOther: undefined
        }), "editor", PUT_OPTIONS);

        // An editor that holds no data for the note any more sends the data of the save again.
        editor.getLatestData.mockReturnValue(undefined);
        rejectWithConflict({ reason: "version" });
        get.mockResolvedValueOnce({ blobId: "read2", content: "<p>theirs</p>" });
        put.mockResolvedValueOnce({ blobId: "b4", attachments: [] });
        expect(await saver.saveNote(note, { content: "<p>mine</p>" }))
            .toStrictEqual({ content: "<p>mine</p>" });
        expect(put).toHaveBeenLastCalledWith(`notes/${note.noteId}/data`, expect.objectContaining({
            content: "<p>mine</p>", base: { blobId: "read2", type: "text", mime: "text/html" }
        }), "editor", PUT_OPTIONS);

        // An editor that cannot bring its changes over leaves the choice to the user.
        resolveConflict.mockResolvedValueOnce(false);
        rejectWithConflict({ reason: "version" });
        get.mockResolvedValueOnce({ blobId: "read3", content: "<p>theirs</p>" });
        void saver.saveNote(note, { content: "<p>mine</p>" });
        await vi.waitFor(() => expect(getQuestion()).toBeDefined());
        saver.abandon();
    });

    it("saves without asking over a version that holds the content it read or saves", async () => {
        const note = buildNote({ title: "Same content" });
        const { saver, editor } = createSaver(note);
        // Protecting the note stores the content that the editor read under another blob.
        rejectWithConflict({ reason: "version", blobId: "protected", content: "<p>0</p>" });
        put.mockResolvedValueOnce({ blobId: "b1", attachments: [] });
        expect(await saver.saveNote(note, { content: "<p>mine</p>" }))
            .toStrictEqual({ content: "<p>mine</p>" });
        expect(put).toHaveBeenLastCalledWith(`notes/${note.noteId}/data`, expect.objectContaining({
            content: "<p>mine</p>", base: { blobId: "protected", type: "text", mime: "text/html" },
            keepOther: undefined
        }), "editor", PUT_OPTIONS);

        // Another editor of the note saved what this one saves.
        editor.getLatestData.mockReturnValue({ content: "<p>same</p>" });
        rejectWithConflict({ reason: "version", blobId: "other", content: "<p>same</p>" });
        put.mockResolvedValueOnce({ blobId: "b2", attachments: [] });
        expect(await saver.saveNote(note, { content: "<p>same</p>" }))
            .toStrictEqual({ content: "<p>same</p>" });
        expect(put).toHaveBeenLastCalledWith(`notes/${note.noteId}/data`, expect.objectContaining({
            base: { blobId: "other", type: "text", mime: "text/html" }
        }), "editor", PUT_OPTIONS);
        expect(getQuestion()).toBeUndefined();
        expect(get).not.toHaveBeenCalled();
    });

    it("asks over the same content when the blob or the attachments conflict", async () => {
        const note = buildNote({ title: "Same content, other attachments" });
        const { saver, editor } = createSaver(note);
        const row = {
            attachmentId: "att1", blobId: "ab1", role: "file", mime: "application/json",
            title: "drawing.excalidraw", content: "{}"
        };
        const asks = async (data: SaveData) => {
            showPersistent.mockClear();
            const saving = saver.saveNote(note, data);
            await vi.waitFor(() => expect(getQuestion()).toBeDefined());
            saver.abandon();
            await saving;
        };

        // The note keeps its blob, so the conflict is about an attachment.
        rejectWithConflict({ reason: "version", blobId: "b0", content: "<p>0</p>" });
        await asks({ content: "<p>mine</p>", attachments: [ row ] });

        editor.getLatestData.mockReturnValue({ content: "<p>same</p>", attachments: [ row ] });
        rejectWithConflict({ reason: "version", blobId: "other", content: "<p>same</p>" });
        await asks({ content: "<p>same</p>", attachments: [ row ] });
        expect(put).toHaveBeenCalledTimes(2);
    });

    it("sends each attachment row with the blob that it replaces", async () => {
        const note = buildNote({ title: "Attachments" });
        const { saver } = createSaver(note);
        const getAttachments = vi.fn(async () => [
            { attachmentId: "att1", title: "preview.svg", blobId: "ab1" } as FAttachment
        ]);
        note.getAttachments = getAttachments;
        const row = {
            role: "image", mime: "image/svg+xml", title: "preview.svg", content: "<svg/>"
        };
        put.mockResolvedValue({
            blobId: "b1",
            attachments: [ { attachmentId: "att1", title: "preview.svg", blobId: "ab2" } ]
        });

        await saver.saveNote(note, { content: "<p>x</p>", attachments: [ row ] });
        expect(put.mock.calls[0][1].attachments)
            .toStrictEqual([ { ...row, attachmentId: "att1", blobId: "ab1" } ]);

        await saver.saveNote(note, { content: "<p>x</p>", attachments: [ row ] });
        expect(put.mock.calls[1][1].attachments)
            .toStrictEqual([ { ...row, attachmentId: "att1", blobId: "ab2" } ]);
        expect(getAttachments).toHaveBeenCalledOnce();
        expect(getLatestBlob("att1", "ab1")).toBe("ab2");

        // A row read before a save of this saver, such as a drawing changed during it, follows it.
        const readBefore = { ...row, attachmentId: "att1", blobId: "ab1" };
        await saver.saveNote(note, { content: "<p>x</p>", attachments: [ readBefore ] });
        expect(put.mock.calls[2][1].attachments).toStrictEqual([ { ...readBefore, blobId: "ab2" } ]);
    });

    it("saves blocks on the hash they were read at, and keeps a draft as a fragment", async () => {
        const note = buildNote({ title: "Excerpt" });
        const editor = createEditor();
        const saver = new NoteSaver<SaveData & { block?: string }>(editor);
        saver.setBlockBase(note.noteId, "h0", "<p>note0</p>");
        const url = `notes/${note.noteId}/blocks?block=a%3Ab`;
        put.mockResolvedValueOnce({ hash: "h1", note: "<p>note1</p>", attachments: [] });

        await saver.saveBlocks(note, "a:b", { content: "<p>x</p>", block: "a:c" });
        expect(put).toHaveBeenLastCalledWith(url, {
            content: "<p>x</p>", attachments: undefined, base: { hash: "h0" }, keepOther: undefined,
            block: "a:c"
        }, "editor", PUT_OPTIONS);

        put.mockRejectedValueOnce(JSON.stringify(
            { reason: "version", hash: "h9", attachments: [], isVersioned: true }));
        get.mockResolvedValueOnce({ content: "<p>theirs</p>", hash: "h9", note: "<p>note9</p>" });
        const saving = saver.saveBlocks(note, "a:b", { content: "<p>y</p>" });
        await answer(1);
        expect(await saving).toBeUndefined();
        // The draft is based on the blocks as the last save left them.
        expect(post).toHaveBeenLastCalledWith(`notes/${note.noteId}/revisions/draft`, {
            revisionId: expect.any(String), type: "text", mime: "text/html",
            fragment: {
                content: "<p>y</p>", block: "a:b", base: { note: "<p>note1</p>", hash: "h1" }
            },
            attachments: undefined
        }, "editor");
        expect(editor.loadBlocks).toHaveBeenCalledExactlyOnceWith(note.noteId, "<p>theirs</p>");

        note.type = "code";
        expect(await saver.saveBlocks(note, "a:b", { content: "<p>z</p>" })).toBeUndefined();
        expect(put).toHaveBeenCalledTimes(2);
        expect(post).toHaveBeenLastCalledWith(`notes/${note.noteId}/revisions/draft`,
            expect.objectContaining({ fragment: {
                content: "<p>z</p>", block: "a:b", base: { note: "<p>note9</p>", hash: "h9" }
            } }), "editor");
    });

    it("keeps this version of blocks over the attachments that the conflict named", async () => {
        const note = buildNote({ title: "Excerpt with a drawing" });
        const saver = new NoteSaver<SaveData & { block?: string }>(createEditor());
        saver.setBlockBase(note.noteId, "h0", "<p>note0</p>");
        const row = {
            attachmentId: "att1", blobId: "ab1", role: "file", mime: "application/json",
            title: "drawing.excalidraw", content: "{}"
        };
        put.mockRejectedValueOnce(JSON.stringify({
            reason: "version", hash: "h5", isVersioned: true,
            attachments: [ { attachmentId: "att1", title: "drawing.excalidraw", blobId: "ab2" } ]
        }));
        put.mockResolvedValueOnce({ hash: "h6", note: "<p>note6</p>", attachments: [] });

        const saving = saver.saveBlocks(note, "a", { content: "<p>x</p>", attachments: [ row ] });
        await answer(0);
        await saving;
        expect(put).toHaveBeenLastCalledWith(`notes/${note.noteId}/blocks?block=a`, {
            content: "<p>x</p>", attachments: [ { ...row, blobId: "ab2" } ], base: { hash: "h5" },
            keepOther: true, block: undefined
        }, "editor", PUT_OPTIONS);
    });

    it("keeps a draft of blocks that the server finds gone, or of a converted note", async () => {
        const note = buildNote({ title: "Gone" });
        const saver = new NoteSaver<SaveData & { block?: string }>(createEditor());
        saver.setBlockBase(note.noteId, "h0", "<p>note0</p>");
        for (const [ reason, message ] of [
            [ "range", "note_save.draft_kept_blocks_gone" ],
            [ "format", "note_save.draft_kept_after_conversion" ]
        ]) {
            put.mockRejectedValueOnce(JSON.stringify({ reason, message: "Gone" }));
            expect(await saver.saveBlocks(note, "a:b", { content: "<p>x</p>" })).toBeUndefined();
            expect(getQuestion()).toBeUndefined();
            expect(post).toHaveBeenLastCalledWith(`notes/${note.noteId}/revisions/draft`,
                expect.objectContaining({ fragment: {
                    content: "<p>x</p>", block: "a:b", base: { note: "<p>note0</p>", hash: "h0" }
                } }), "editor");
            expect(showPersistent).toHaveBeenLastCalledWith(expect.objectContaining({ message }));
        }
    });

    it("keeps the changes made after a draft that failed to reach the server as well", async () => {
        const note = buildNote({ title: "Typed on" });
        const { saver, editor } = createSaver(note);
        rejectWithConflict({ reason: "version" });
        post.mockRejectedValueOnce("offline");
        const saving = saver.saveNote(note, { content: "<p>mine</p>" });
        await answer(1);
        await expect(saving).rejects.toBe("offline");
        expect(get).not.toHaveBeenCalled();

        // The editor shows its version until the draft is kept, and the user types on.
        editor.getLatestData.mockReturnValue({ content: "<p>mine, and more</p>" });
        get.mockResolvedValueOnce({ blobId: "theirs", content: "<p>theirs</p>" });
        expect(await saver.saveNote(note, { content: "<p>mine</p>" })).toBeUndefined();
        const drafts = post.mock.calls.map(([ , request ]) => request);
        expect(drafts.map(({ content }) => content))
            .toEqual([ "<p>mine</p>", "<p>mine</p>", "<p>mine, and more</p>" ]);
        expect(drafts[1].revisionId).toBe(drafts[0].revisionId);
        expect(drafts[2].revisionId).not.toBe(drafts[0].revisionId);
        expect(editor.loadVersion).toHaveBeenCalledExactlyOnceWith(
            note.noteId, { blobId: "theirs", content: "<p>theirs</p>" });
        expect(saver.isPaused(note.noteId)).toBe(false);

        // A repeated save of the same changes keeps them once.
        rejectWithConflict({ reason: "version" });
        post.mockRejectedValueOnce("offline");
        editor.getLatestData.mockReturnValue(undefined);
        const again = saver.saveNote(note, { content: "<p>again</p>" });
        await vi.waitFor(() => expect(saver.isAsking()).toBe(true));
        saver.abandon();
        await expect(again).rejects.toBe("offline");
        expect(await saver.saveNote(note, { content: "<p>again</p>" })).toBeUndefined();
        expect(post).toHaveBeenCalledTimes(5);
    });

    it("keeps a draft of blocks that did not reach the server, and the changes since", async () => {
        const note = buildNote({ title: "Excerpt typed on" });
        const editor = createEditor();
        const saver = new NoteSaver<SaveData & { block?: string }>(editor);
        saver.setBlockBase(note.noteId, "h0", "<p>note0</p>");
        put.mockRejectedValueOnce(JSON.stringify({ reason: "range", message: "Gone" }));
        post.mockRejectedValueOnce("offline");
        await expect(saver.saveBlocks(note, "a", { content: "<p>x</p>" })).rejects.toBe("offline");
        expect(saver.isPaused(note.noteId)).toBe(true);

        editor.getLatestData.mockReturnValue({ content: "<p>x, and more</p>" });
        expect(await saver.saveBlocks(note, "a", { content: "<p>x</p>" })).toBeUndefined();
        expect(put).toHaveBeenCalledOnce();
        const drafts = post.mock.calls.map(([ , request ]) => request);
        expect(drafts.map(({ fragment }) => fragment.content))
            .toStrictEqual([ "<p>x</p>", "<p>x</p>", "<p>x, and more</p>" ]);
        expect(drafts[1].revisionId).toBe(drafts[0].revisionId);
        expect(drafts[2]).toStrictEqual({
            revisionId: expect.any(String), type: "text", mime: "text/html",
            fragment: {
                content: "<p>x, and more</p>", block: "a",
                base: { note: "<p>note0</p>", hash: "h0" }
            },
            attachments: undefined
        });
        expect(drafts[2].revisionId).not.toBe(drafts[0].revisionId);
        expect(saver.isPaused(note.noteId)).toBe(false);
    });

    it("keeps the draft of a new attachment that failed to reach the server", async () => {
        const note = buildNote({ title: "New attachment" });
        const { saver, editor } = createSaver(note);
        note.getAttachments = vi.fn(async () => []);
        // A newer row of each attachment that the editor can name by its ID.
        editor.getLatestAttachment.mockImplementation((_noteId, attachmentId) => ({
            attachmentId, role: "file", mime: "text/plain", title: "new.txt", content: "newer"
        }));
        const row = { role: "file", mime: "text/plain", title: "new.txt", content: "mine" };
        post.mockRejectedValueOnce(JSON.stringify({
            reason: "version", message: "", blobId: "noteBlob", type: "text", mime: "text/html",
            isVersioned: true
        })).mockRejectedValueOnce("offline");
        get.mockResolvedValue({ blobId: "noteBlob", content: "<p>note</p>" });

        const saving = saver.saveAttachment(note, row);
        await answer(1);
        await expect(saving).rejects.toBe("offline");
        // Without an attachment of its title, the row creates one.
        expect(post.mock.calls[0][1]).toStrictEqual(row);

        expect(await saver.saveAttachment(note, row)).toBeUndefined();
        const drafts = post.mock.calls.slice(1).map(([ , request ]) => request);
        expect(drafts).toHaveLength(2);
        expect(drafts[0]).toMatchObject({ content: "<p>note</p>", attachments: [ row ] });
        expect(drafts[1]).toBe(drafts[0]);
        expect(editor.loadVersion).toHaveBeenCalledExactlyOnceWith(
            note.noteId, { blobId: "noteBlob", content: "<p>note</p>" });
        expect(saver.isPaused(note.noteId)).toBe(false);
    });

    it("saves blocks without a hash unconditionally, and drafts them without a base", async () => {
        const note = buildNote({ title: "Excerpt without a hash" });
        const saver = new NoteSaver<SaveData & { block?: string }>(createEditor());
        const url = `notes/${note.noteId}/blocks?block=a`;

        note.type = "code";
        expect(await saver.saveBlocks(note, "a", { content: "<p>x</p>" })).toBeUndefined();
        expect(post).toHaveBeenLastCalledWith(`notes/${note.noteId}/revisions/draft`,
            expect.objectContaining({
                fragment: { content: "<p>x</p>", block: "a", base: undefined }
            }), "editor");

        // A save answered without a hash leaves the next save without a base as well.
        note.type = "text";
        await saver.saveBlocks(note, "a", { content: "<p>y</p>" });
        await saver.saveBlocks(note, "a", { content: "<p>z</p>" });
        expect(put.mock.calls.map(([ sentUrl, { content, base } ]) => [ sentUrl, content, base ]))
            .toStrictEqual([ [ url, "<p>y</p>", undefined ], [ url, "<p>z</p>", undefined ] ]);
    });

    it("tells the user when the server discards a draft", async () => {
        const note = buildNote({ title: "Discarded" });
        const { saver } = createSaver(note);
        const discarded = { revisionId: "r", isKept: false, isFragment: false };
        rejectWithConflict({ reason: "version" });
        post.mockResolvedValueOnce(discarded);
        const saving = saver.saveNote(note, { content: "<p>mine</p>" });
        await vi.waitFor(() => expect(saver.isAsking()).toBe(true));
        saver.abandon();
        expect(await saving).toBeUndefined();
        expect(showPersistent).toHaveBeenLastCalledWith(expect.objectContaining({
            icon: "bx bx-error-circle", message: "note_save.draft_discarded"
        }));

        const blocks = new NoteSaver<SaveData & { block?: string }>(createEditor());
        put.mockRejectedValueOnce(JSON.stringify({ reason: "range", message: "Gone" }));
        post.mockResolvedValueOnce({ ...discarded, isFragment: true });
        expect(await blocks.saveBlocks(note, "a", { content: "<p>x</p>" })).toBeUndefined();
        expect(showPersistent).toHaveBeenLastCalledWith(expect.objectContaining({
            icon: "bx bx-error-circle", message: "note_save.draft_discarded_blocks_gone"
        }));
    });
});

describe("the blobs that a save replaced", () => {
    it("follows the saves of an entity, also back to an earlier blob", () => {
        recordReplacedBlob("chain", "a", "b");
        recordReplacedBlob("chain", "b", "c");
        expect(getLatestBlob("chain", "a")).toBe("c");
        recordReplacedBlob("chain", "c", "a");
        expect(getLatestBlob("chain", "a")).toBe("a");
        expect(getLatestBlob("chain", "b")).toBe("a");
        expect(getLatestBlob("other", "a")).toBe("a");
    });

    it("keeps the latest 1,000 replacements", () => {
        for (let index = 0; index <= 1000; index++) {
            recordReplacedBlob("many", `old${index}`, `new${index}`);
        }
        expect(getLatestBlob("many", "old0")).toBe("old0");
        expect(getLatestBlob("many", "old1")).toBe("new1");
        expect(getLatestBlob("many", "old1000")).toBe("new1000");
    });
});

describe("parseConflict", () => {
    it("reads the answer of a 409 with a reason, and nothing else", () => {
        expect(parseConflict(JSON.stringify({ reason: "listing", message: "x" })))
            .toStrictEqual({ reason: "listing", message: "x" });
        expect(parseConflict(JSON.stringify({ message: "Server error" }))).toBeNull();
        expect(parseConflict("rejected by browser")).toBeNull();
        expect(parseConflict(new Error("offline"))).toBeNull();
    });
});
