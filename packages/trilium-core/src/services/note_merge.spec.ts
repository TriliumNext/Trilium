import { beforeAll, describe, expect, it } from "vitest";

import becca from "../becca/becca.js";
import { createTextNote } from "../test/api_fixtures.js";
import { CoreApiTester } from "../test/api_tester.js";
import { getSql } from "./sql/index.js";
import { decodeUtf8 } from "./utils/binary.js";

let api: CoreApiTester;

function noteIsDeleted(noteId: string): number | null {
    const row = getSql().getRowOrNull<{ isDeleted: number }>(
        "SELECT isDeleted FROM notes WHERE noteId = ?",
        [ noteId ]
    );
    return row ? row.isDeleted : null;
}

async function createCodeNote(parentNoteId: string, title: string, mime: string, content: string) {
    const res = await api.post<{ note: { noteId: string } }>(
        `/api/notes/${parentNoteId}/children?target=into`,
        { body: { title, type: "code", mime, content } }
    );
    expect(res.status).toBe(200);
    return res.body.note.noteId;
}

async function mergeNotes(noteId: string, sourceNoteIds: string[], title?: string) {
    const res = await api.post<{ noteId: string; mergedCount: number }>(
        `/api/notes/${noteId}/merge`,
        { body: { sourceNoteIds, title } }
    );
    expect(res.status).toBe(200);
    return res.body.noteId;
}

describe("Merging notes", () => {
    beforeAll(() => {
        api = CoreApiTester.build();
    });

    it("replaces the notes with one whose text is both, and moves clones, children, attributes and links", async () => {
        const first = await createTextNote(api, { title: "Alpha", content: "<p>alpha body</p>" });
        const second = await createTextNote(api, { title: "Beta", content: "<p>beta body</p>" });
        const otherParent = await createTextNote(api, { title: "Other place", content: "<p></p>" });
        const child = await createTextNote(api, {
            parentNoteId: second.noteId, title: "Beta child", content: "<p>child body</p>"
        });
        const linker = await createTextNote(api, {
            title: "Linker",
            content: `<p>See <a class="reference-link" href="#root/${second.noteId}">beta</a>.</p>`
        });
        const citer = await createTextNote(api, { title: "Citer", content: "<p></p>" });

        const attachment = await api.post(`/api/notes/${second.noteId}/attachments`, {
            body: { role: "file", mime: "text/plain", title: "clip.txt", content: "payload" }
        });
        expect(attachment.status).toBe(204);
        const listed = await api.get<{ attachmentId: string; title: string }[]>(
            `/api/notes/${second.noteId}/attachments`
        );
        const sourceAttachment = listed.body.find((item) => item.title === "clip.txt");
        expect(sourceAttachment).toBeTruthy();
        const sourceAttachmentId = sourceAttachment?.attachmentId ?? "";

        await api.put(`/api/notes/${second.noteId}/data`, {
            body: {
                content: `<p>beta body</p><p>File <a class="reference-link" href="#root/${second.noteId}?viewMode=attachments&attachmentId=${sourceAttachmentId}">clip</a>.</p>`
                    + `<figure class="include-note" data-note-id="${first.noteId}"></figure>`
            }
        });

        expect((await api.post(`/api/notes/${first.noteId}/attributes`, {
            body: { type: "label", name: "genre", value: "jazz", isInheritable: false }
        })).status).toBe(204);
        expect((await api.post(`/api/notes/${second.noteId}/attributes`, {
            body: { type: "label", name: "genre", value: "jazz", isInheritable: true }
        })).status).toBe(204);
        expect((await api.post(`/api/notes/${second.noteId}/attributes`, {
            body: { type: "label", name: "extra", value: "1" }
        })).status).toBe(204);
        expect((await api.post(`/api/notes/${second.noteId}/attributes`, {
            body: { type: "relation", name: "cites", value: linker.noteId }
        })).status).toBe(204);
        expect((await api.post(`/api/notes/${citer.noteId}/attributes`, {
            body: { type: "relation", name: "cites", value: second.noteId }
        })).status).toBe(204);
        expect((await api.put(
            `/api/notes/${second.noteId}/clone-to-note/${otherParent.noteId}`,
            { body: {} }
        )).status).toBe(200);

        const mergedId = await mergeNotes(first.noteId, [ second.noteId ]);
        const merged = becca.getNoteOrThrow(mergedId);
        const content = merged.getContent();
        expect(typeof content).toBe("string");
        if (typeof content !== "string") return;
        expect(content).toContain("alpha body");
        expect(content).toContain("<h2>Beta</h2>");
        expect(content).toContain("beta body");
        expect(content).not.toContain(sourceAttachmentId);
        expect(content).not.toContain(`data-note-id="${mergedId}"`);
        const copied = merged.getAttachments().find((item) => item.title === "clip.txt");
        expect(copied).toBeTruthy();
        expect(copied?.utcDateScheduledForErasureSince ?? null).toBeNull();

        expect(noteIsDeleted(first.noteId)).toBe(1);
        expect(noteIsDeleted(second.noteId)).toBe(1);
        expect(becca.getNote(first.noteId)).toBeNull();
        expect(becca.getNoteOrThrow(child.noteId).getParentNotes().map((note) => note.noteId))
            .toEqual([ mergedId ]);
        expect(merged.getParentNotes().map((note) => note.noteId)).toContain(otherParent.noteId);

        const genre = merged.getOwnedAttributes("label", "genre");
        expect(genre).toHaveLength(1);
        expect(genre[0]?.isInheritable).toBe(true);
        expect(merged.getOwnedAttributes("label", "extra").map((attr) => attr.value)).toEqual([ "1" ]);
        expect(merged.getOwnedAttributes("relation", "cites").map((attr) => attr.value))
            .toEqual([ linker.noteId ]);
        expect(becca.getNoteOrThrow(citer.noteId).getOwnedAttributes("relation", "cites")
            .map((attr) => attr.value)).toEqual([ mergedId ]);

        const linkerContent = becca.getNoteOrThrow(linker.noteId).getContent();
        expect(linkerContent).toContain(mergedId);
        expect(linkerContent).not.toContain(second.noteId);
        expect(becca.getNoteOrThrow(linker.noteId).getRelations("internalLink").map((rel) => rel.value))
            .toEqual([ mergedId ]);

        const descriptions = getSql().getColumn<string>(
            "SELECT description FROM revisions WHERE noteId = ?",
            [ first.noteId ]
        );
        expect(descriptions).toContain("Before merging notes");
    });

    it("appends several notes in the given order, including one nested in another, and names the result", async () => {
        const first = await createTextNote(api, { title: "Keep", content: "<p>keep</p>" });
        const outer = await createTextNote(api, { title: "Outer", content: "<p>outer body</p>" });
        const inner = await createTextNote(api, {
            parentNoteId: outer.noteId, title: "Inner", content: "<p>inner body</p>"
        });

        const mergedId = await mergeNotes(first.noteId, [ outer.noteId, inner.noteId ], "Combined");
        const merged = becca.getNoteOrThrow(mergedId);
        expect(merged.title).toBe("Combined");
        const content = String(merged.getContent());
        expect(content.indexOf("keep")).toBeGreaterThan(-1);
        expect(content.indexOf("keep")).toBeLessThan(content.indexOf("outer body"));
        expect(content.indexOf("outer body")).toBeLessThan(content.indexOf("inner body"));
        expect(content).toContain("<h2>Outer</h2>");
        expect(content).toContain("<h2>Inner</h2>");
        expect(noteIsDeleted(first.noteId)).toBe(1);
        expect(noteIsDeleted(outer.noteId)).toBe(1);
        expect(noteIsDeleted(inner.noteId)).toBe(1);
        expect(becca.getNote(inner.noteId)).toBeNull();
    });

    it("replaces a parent and its child with one note under the parent's parent", async () => {
        const parent = await createTextNote(api, { title: "Parent", content: "<p>parent body</p>" });
        const child = await createTextNote(api, {
            parentNoteId: parent.noteId, title: "Child", content: "<p>child body</p>"
        });

        const mergedId = await mergeNotes(parent.noteId, [ child.noteId ]);
        const merged = becca.getNoteOrThrow(mergedId);
        expect(String(merged.getContent())).toContain("parent body");
        expect(String(merged.getContent())).toContain("child body");
        expect(noteIsDeleted(parent.noteId)).toBe(1);
        expect(noteIsDeleted(child.noteId)).toBe(1);
        expect(merged.getParentNotes().map((note) => note.noteId)).toEqual([ "root" ]);

        const ancestor = await createTextNote(api, { title: "Ancestor", content: "<p>ancestor body</p>" });
        const descendant = await createTextNote(api, {
            parentNoteId: ancestor.noteId, title: "Descendant", content: "<p>descendant body</p>"
        });
        const replacedId = await mergeNotes(descendant.noteId, [ ancestor.noteId ]);
        const replaced = becca.getNoteOrThrow(replacedId);
        const replacedContent = String(replaced.getContent());
        expect(replacedContent).toContain("descendant body");
        expect(replacedContent).toContain("ancestor body");
        expect(replaced.getParentNotes().map((note) => note.noteId)).toEqual([ "root" ]);
        expect(noteIsDeleted(ancestor.noteId)).toBe(1);
        expect(noteIsDeleted(descendant.noteId)).toBe(1);

        const restored = await api.post(`/api/notes/${replacedId}/merge-undo`);
        expect(restored.status).toBe(200);
        expect(String(becca.getNoteOrThrow(replacedId).getContent())).toBe(replacedContent);
        expect(noteIsDeleted(ancestor.noteId)).toBe(0);
        expect(String(becca.getNoteOrThrow(ancestor.noteId).getContent())).toContain("ancestor body");
        expect(noteIsDeleted(descendant.noteId)).toBe(1);
    });

    it("appends Markdown of the same language and refuses a different language without deleting anything", async () => {
        const markdown = await createCodeNote("root", "Notes", "text/markdown", "alpha line");
        const other = await createCodeNote("root", "More", "text/markdown", "beta line");
        const plain = await createCodeNote("root", "Plain", "text/plain", "plain line");

        const mergedId = await mergeNotes(markdown, [ other ]);
        const content = String(becca.getNoteOrThrow(mergedId).getContent());
        expect(content).toContain("alpha line");
        expect(content).toContain("## More");
        expect(content).toContain("beta line");
        expect(noteIsDeleted(markdown)).toBe(1);
        expect(noteIsDeleted(other)).toBe(1);

        const refused = await api.post<{ message: string }>(`/api/notes/${mergedId}/merge`, {
            body: { sourceNoteIds: [ plain ] }
        });
        expect(refused.status).toBe(400);
        expect(refused.body.message).toContain("cannot be combined");
        expect(String(becca.getNoteOrThrow(mergedId).getContent())).toBe(content);
        expect(noteIsDeleted(plain)).toBe(0);
        expect(noteIsDeleted(mergedId)).toBe(0);
    });

    it("does not add a heading when the merged note has no content", async () => {
        const first = await createTextNote(api, { title: "Keep", content: "<p>keep</p>" });
        const second = await createTextNote(api, { title: "Empty", content: "<p></p>" });

        const mergedId = await mergeNotes(first.noteId, [ second.noteId ]);
        const content = String(becca.getNoteOrThrow(mergedId).getContent());
        expect(content).toContain("keep");
        expect(content).not.toContain("<h2>");
        expect(noteIsDeleted(first.noteId)).toBe(1);
        expect(noteIsDeleted(second.noteId)).toBe(1);
    });

    it("rejects a merge into itself, a system note, a missing note, and a malformed request", async () => {
        const note = await createTextNote(api, { title: "Solo", content: "<p>solo</p>" });

        const itself = await api.post<{ message: string }>(`/api/notes/${note.noteId}/merge`, {
            body: { sourceNoteIds: [ note.noteId ] }
        });
        expect(itself.status).toBe(400);
        expect(becca.getNote(note.noteId)).not.toBeNull();

        const root = await api.post<{ message: string }>(`/api/notes/root/merge`, {
            body: { sourceNoteIds: [ note.noteId ] }
        });
        expect(root.status).toBe(400);
        expect(noteIsDeleted(note.noteId)).toBe(0);

        const missing = await api.post(`/api/notes/missingNote123/merge`, {
            body: { sourceNoteIds: [ note.noteId ] }
        });
        expect(missing.status).toBe(404);

        const malformed = await api.post(`/api/notes/${note.noteId}/merge`, {
            body: { sourceNoteIds: "nope" }
        });
        expect(malformed.status).toBe(400);

        const emptyTitle = await api.post(`/api/notes/${note.noteId}/merge`, {
            body: { sourceNoteIds: [ (await createTextNote(api)).noteId ], title: "   " }
        });
        expect(emptyTitle.status).toBe(400);

        const noUndo = await api.post<{ message: string }>(`/api/notes/${note.noteId}/merge-undo`);
        expect(noUndo.status).toBe(400);
        expect(noUndo.body.message).toContain("no merge to undo");
    });

    it("restores either note without changing the merged text, in either order", async () => {
        const first = await createTextNote(api, { title: "Alpha", content: "<p>alpha body</p>" });
        const second = await createTextNote(api, { title: "Beta", content: "<p>beta body</p>" });
        const otherParent = await createTextNote(api, { title: "Other place", content: "<p></p>" });
        const child = await createTextNote(api, {
            parentNoteId: second.noteId, title: "Kid", content: "<p>kid</p>"
        });
        const linker = await createTextNote(api, {
            title: "Linker",
            content: `<p>See <a class="reference-link" href="#root/${first.noteId}">alpha</a>.</p>`
        });

        await api.post(`/api/notes/${second.noteId}/attachments`, {
            body: { role: "file", mime: "text/plain", title: "clip.txt", content: "payload" }
        });
        expect((await api.put(
            `/api/notes/${second.noteId}/clone-to-note/${otherParent.noteId}`,
            { body: {} }
        )).status).toBe(200);
        expect((await api.post(`/api/notes/${second.noteId}/attributes`, {
            body: { type: "label", name: "extra", value: "1" }
        })).status).toBe(204);

        const mergedId = await mergeNotes(first.noteId, [ second.noteId ]);
        const merged = becca.getNoteOrThrow(mergedId);
        const mergedContent = String(merged.getContent());
        expect(mergedContent).toContain("alpha body");
        expect(mergedContent).toContain("beta body");
        expect(becca.getNoteOrThrow(child.noteId).getParentNotes().map((note) => note.noteId))
            .toEqual([ mergedId ]);
        expect(merged.getParentNotes().map((note) => note.noteId)).toContain(otherParent.noteId);
        expect(merged.getOwnedAttributes("label", "extra").map((attr) => attr.value)).toEqual([ "1" ]);
        expect(merged.getAttachments().some((item) => item.title === "clip.txt")).toBe(true);
        expect(String(becca.getNoteOrThrow(linker.noteId).getContent())).toContain(mergedId);

        const journal = merged.getAttachments().find((item) => item.role === "mergeUndo");
        expect(journal).toBeTruthy();
        if (journal) {
            expect(decodeUtf8(journal.getContent())).not.toContain("beta body");
        }
        expect(merged.getAttachments().some((item) => item.role === "mergeUndoBlob")).toBe(false);

        const history = await api.get<{
            entries: { id: string; sourceTitle: string; sourceNoteId: string; undoable: boolean }[];
        }>(`/api/notes/${mergedId}/merge-history`);
        expect(history.status).toBe(200);
        expect(history.body.entries.map((entry) => entry.sourceTitle)).toEqual([ "Beta", "Alpha" ]);
        expect(history.body.entries.every((entry) => entry.undoable)).toBe(true);

        const alpha = history.body.entries.find((entry) => entry.sourceNoteId === first.noteId);
        const beta = history.body.entries.find((entry) => entry.sourceNoteId === second.noteId);
        expect(alpha && beta).toBeTruthy();
        if (!alpha || !beta) {
            return;
        }

        const restoreBeta = await api.post(`/api/notes/${mergedId}/merge-undo`, {
            body: { entryId: beta.id }
        });
        expect(restoreBeta.status).toBe(200);
        expect(String(becca.getNoteOrThrow(mergedId).getContent())).toBe(mergedContent);
        expect(noteIsDeleted(second.noteId)).toBe(0);
        expect(noteIsDeleted(first.noteId)).toBe(1);
        expect(becca.getNoteOrThrow(child.noteId).getParentNotes().map((note) => note.noteId))
            .toEqual([ second.noteId ]);
        expect(becca.getNoteOrThrow(mergedId).getParentNotes().map((note) => note.noteId))
            .toContain(otherParent.noteId);
        expect(becca.getNoteOrThrow(second.noteId).getParentNotes().map((note) => note.noteId))
            .toContain(otherParent.noteId);
        expect(becca.getNoteOrThrow(mergedId).getOwnedAttributes("label", "extra")).toHaveLength(0);
        expect(becca.getNoteOrThrow(second.noteId).getOwnedAttributes("label", "extra")
            .map((attr) => attr.value)).toEqual([ "1" ]);
        expect(becca.getNoteOrThrow(mergedId).getAttachments().some((item) => item.title === "clip.txt"))
            .toBe(true);
        expect(becca.getNoteOrThrow(second.noteId).getAttachments()
            .some((item) => item.title === "clip.txt")).toBe(true);
        expect(String(becca.getNoteOrThrow(second.noteId).getContent())).toContain("beta body");
        expect(String(becca.getNoteOrThrow(linker.noteId).getContent())).toContain(mergedId);

        const restoreAlpha = await api.post(`/api/notes/${mergedId}/merge-undo`, {
            body: { entryId: alpha.id }
        });
        expect(restoreAlpha.status).toBe(200);
        expect(String(becca.getNoteOrThrow(mergedId).getContent())).toBe(mergedContent);
        expect(noteIsDeleted(first.noteId)).toBe(0);
        expect(String(becca.getNoteOrThrow(first.noteId).getContent())).toContain("alpha body");
        expect(String(becca.getNoteOrThrow(linker.noteId).getContent())).toContain(first.noteId);
        expect(String(becca.getNoteOrThrow(linker.noteId).getContent())).not.toContain(mergedId);
        expect(becca.getNoteOrThrow(mergedId).getAttachments().some((item) => item.role === "mergeUndo"))
            .toBe(false);
    });

    it("keeps the merged text after an edit, and forgetting one note leaves the other", async () => {
        const first = await createTextNote(api, { title: "Keep", content: "<p>keep</p>" });
        const second = await createTextNote(api, { title: "Gone", content: "<p>gone</p>" });
        const mergedId = await mergeNotes(first.noteId, [ second.noteId ]);
        expect((await api.put(`/api/notes/${mergedId}/data`, {
            body: { content: "<p>edited</p>" }
        })).status).toBe(204);

        const afterEdit = await api.post(`/api/notes/${mergedId}/merge-undo`);
        expect(afterEdit.status).toBe(200);
        expect(String(becca.getNoteOrThrow(mergedId).getContent())).toContain("edited");
        expect(noteIsDeleted(second.noteId)).toBe(0);
        expect(String(becca.getNoteOrThrow(second.noteId).getContent())).toContain("gone");
        expect(noteIsDeleted(first.noteId)).toBe(1);

        const alpha = await createTextNote(api, { title: "Alpha", content: "<p>alpha</p>" });
        const beta = await createTextNote(api, { title: "Beta", content: "<p>beta</p>" });
        const later = await createTextNote(api, { title: "Later", content: "<p>later</p>" });
        const onceId = await mergeNotes(alpha.noteId, [ beta.noteId ]);
        const twiceId = await mergeNotes(onceId, [ later.noteId ], "Renamed");

        const history = await api.get<{
            entries: { id: string; sourceTitle: string; sourceNoteId: string; undoable: boolean }[];
        }>(`/api/notes/${twiceId}/merge-history`);
        expect(history.status).toBe(200);
        expect(history.body.entries.map((entry) => entry.sourceNoteId)).toEqual([
            later.noteId, onceId, beta.noteId, alpha.noteId
        ]);
        expect(history.body.entries.every((entry) => entry.undoable)).toBe(true);

        const betaEntry = history.body.entries.find((entry) => entry.sourceNoteId === beta.noteId);
        const alphaEntry = history.body.entries.find((entry) => entry.sourceNoteId === alpha.noteId);
        expect(betaEntry && alphaEntry).toBeTruthy();
        if (!betaEntry || !alphaEntry) {
            return;
        }
        const missing = await api.post<{ message: string }>(
            `/api/notes/${twiceId}/merge-history/forget`,
            { body: { entryId: "missing-merge" } }
        );
        expect(missing.status).toBe(400);
        expect(missing.body.message).toContain("no longer in the history");

        expect((await api.post(`/api/notes/${twiceId}/merge-history/forget`, {
            body: { entryId: betaEntry.id }
        })).status).toBe(200);
        const remaining = await api.get<{
            entries: { sourceNoteId: string }[];
        }>(`/api/notes/${twiceId}/merge-history`);
        expect(remaining.body.entries.map((entry) => entry.sourceNoteId)).toEqual([
            later.noteId, onceId, alpha.noteId
        ]);

        expect((await api.post(`/api/notes/${twiceId}/merge-undo`, {
            body: { entryId: alphaEntry.id }
        })).status).toBe(200);
        expect(becca.getNoteOrThrow(twiceId).title).toBe("Renamed");
        expect(String(becca.getNoteOrThrow(twiceId).getContent())).toContain("alpha");
        expect(String(becca.getNoteOrThrow(twiceId).getContent())).toContain("later");
        expect(noteIsDeleted(alpha.noteId)).toBe(0);
        expect(noteIsDeleted(beta.noteId)).toBe(1);
        expect(noteIsDeleted(later.noteId)).toBe(1);
    });
});
