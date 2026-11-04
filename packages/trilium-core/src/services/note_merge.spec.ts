import { beforeAll, describe, expect, it } from "vitest";

import becca from "../becca/becca.js";
import BBranch from "../becca/entities/bbranch.js";
import { createTextNote } from "../test/api_fixtures.js";
import { CoreApiTester } from "../test/api_tester.js";
import config from "./config.js";
import * as cls from "./context.js";
import protectedSessionService from "./protected_session.js";
import { getSql } from "./sql/index.js";
import { decodeUtf8, encodeUtf8 } from "./utils/binary.js";
import { getZipProvider } from "./zip_provider.js";

let api: CoreApiTester;

function noteIdsMissingFromDatabase() {
    const stored = new Set(getSql().getColumn<string>("SELECT noteId FROM notes"));
    const missing: string[] = [];
    for (const noteId of Object.keys(becca.notes)) {
        if (noteId.startsWith("_") || stored.has(noteId)) {
            continue;
        }
        missing.push(noteId);
    }
    return missing;
}

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

const PROTECTED_KEY = encodeUtf8("0123456789abcdef");

async function createTypedNote(
    parentNoteId: string, title: string, type: string, mime: string, content: string
) {
    const res = await api.post<{ note: { noteId: string } }>(
        `/api/notes/${parentNoteId}/children?target=into`,
        { body: { title, type, mime, content } }
    );
    expect(res.status).toBe(200);
    return res.body.note.noteId;
}

/** Leaves `noteId` cloned only under `parentNoteId`, including a weak or search parent. */
function leaveOnlyUnder(noteId: string, parentNoteId: string) {
    cls.init(() => {
        const note = becca.getNoteOrThrow(noteId);
        new BBranch({
            noteId,
            parentNoteId,
            notePosition: 10,
            isExpanded: false
        }).save();
        for (const branch of note.parentBranches) {
            if (branch.parentNoteId === parentNoteId || !branch.branchId) {
                continue;
            }
            getSql().execute("DELETE FROM branches WHERE branchId = ?", [ branch.branchId ]);
            delete becca.branches[branch.branchId];
        }
        note.parentBranches = note.parentBranches
            .filter((branch) => branch.parentNoteId === parentNoteId);
    });
}

function writeJournal(noteId: string, content: string) {
    cls.init(() => {
        const journal = becca.getNoteOrThrow(noteId).getAttachments()
            .find((item) => item.role === "mergeUndo");
        if (!journal) {
            throw new Error(`Note ${noteId} has no merge journal.`);
        }
        journal.setContent(content, { forceSave: true });
    });
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

        const badId = await api.post(`/api/notes/${note.noteId}/merge`, {
            body: { sourceNoteIds: [ 1 ] }
        });
        expect(badId.status).toBe(400);

        const badTitle = await api.post(`/api/notes/${note.noteId}/merge`, {
            body: { sourceNoteIds: [ note.noteId ], title: 1 }
        });
        expect(badTitle.status).toBe(400);

        const badUndo = await api.post(`/api/notes/${note.noteId}/merge-undo`, {
            body: { entryId: 1 }
        });
        expect(badUndo.status).toBe(400);

        const blankForget = await api.post(`/api/notes/${note.noteId}/merge-history/forget`, {
            body: { entryId: "" }
        });
        expect(blankForget.status).toBe(400);

        const missingForget = await api.post(`/api/notes/${note.noteId}/merge-history/forget`, {
            body: {}
        });
        expect(missingForget.status).toBe(400);

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

    it("refuses notes that cannot be merged or placed", async () => {
        const anchor = await createTextNote(api, { title: "Anchor", content: "<p>anchor</p>" });
        const extra = await createTextNote(api, { title: "Extra", content: "<p>extra</p>" });

        const hoisted = await api.post<{ message: string }>(`/api/notes/${anchor.noteId}/merge`, {
            headers: { "trilium-hoisted-note-id": anchor.noteId },
            body: { sourceNoteIds: [ extra.noteId ] }
        });
        expect(hoisted.status).toBe(400);
        expect(hoisted.body.message).toContain("narrowed");
        expect(noteIsDeleted(anchor.noteId)).toBe(0);

        const search = await createTypedNote(
            "root", "Saved search", "search", "application/json", ""
        );
        const launcher = await createTypedNote("root", "Launcher", "launcher", "text/html", "");
        for (const noteId of [ search, launcher ]) {
            const refused = await api.post<{ message: string }>(`/api/notes/${noteId}/merge`, {
                body: { sourceNoteIds: [ extra.noteId ] }
            });
            expect(refused.status).toBe(400);
            expect(refused.body.message).toContain("Search notes and launchers");
        }

        const repeated = await api.post<{ mergedCount: number }>(`/api/notes/${anchor.noteId}/merge`, {
            body: { sourceNoteIds: [ extra.noteId, extra.noteId ] }
        });
        expect(repeated.status).toBe(200);
        expect(repeated.body.mergedCount).toBe(2);

        const binary = await createTypedNote(
            "root", "Blob", "file", "application/octet-stream", ""
        );
        cls.init(() => {
            becca.getNoteOrThrow(binary).setContent(new Uint8Array([ 1, 2, 3 ]));
        });
        const text = await createTextNote(api, { title: "Plain", content: "<p>plain</p>" });
        const binaryRefused = await api.post<{ message: string }>(`/api/notes/${text.noteId}/merge`, {
            body: { sourceNoteIds: [ binary ] }
        });
        expect(binaryRefused.status).toBe(400);
        expect(binaryRefused.body.message).toContain("cannot be combined");

        const parked = await createTextNote(api, { title: "Parked", content: "<p>parked</p>" });
        const beside = await createTextNote(api, { title: "Beside", content: "<p>beside</p>" });
        leaveOnlyUnder(parked.noteId, "_lbBookmarks");
        leaveOnlyUnder(beside.noteId, "_lbBookmarks");
        const lost = await api.post<{ message: string }>(`/api/notes/${parked.noteId}/merge`, {
            body: { sourceNoteIds: [ beside.noteId ] }
        });
        expect(lost.status).toBe(400);
        expect(lost.body.message).toContain("should remain");

        const home = await createTextNote(api, { title: "Home", content: "<p>home</p>" });
        const guest = await createTextNote(api, { title: "Guest", content: "<p>guest</p>" });
        leaveOnlyUnder(guest.noteId, launcher);
        const misplaced = await api.post<{ message: string }>(`/api/notes/${home.noteId}/merge`, {
            body: { sourceNoteIds: [ guest.noteId ] }
        });
        expect(misplaced.status).toBe(400);
        expect(misplaced.body.message).toContain("cannot be placed");
        expect(noteIsDeleted(home.noteId)).toBe(0);

        const grand = await createTextNote(api, { title: "Grand", content: "<p>grand</p>" });
        const kid = await createTextNote(api, {
            parentNoteId: grand.noteId, title: "Kid", content: "<p>kid</p>"
        });
        const leaf = await createTextNote(api, {
            parentNoteId: kid.noteId, title: "Leaf", content: "<p>leaf</p>"
        });
        leaveOnlyUnder(grand.noteId, search);
        const stranded = await api.post<{ message: string }>(`/api/notes/${leaf.noteId}/merge`, {
            body: { sourceNoteIds: [ grand.noteId ] }
        });
        expect(stranded.status).toBe(400);
        expect(stranded.body.message).toContain("Kid");
        expect(noteIsDeleted(leaf.noteId)).toBe(0);
        expect(noteIdsMissingFromDatabase()).toEqual([]);

        protectedSessionService.setDataKey(PROTECTED_KEY);
        try {
            const locked = await createTextNote(api, { title: "Locked", content: "<p>secret</p>" });
            const open = await createTextNote(api, { title: "Open", content: "<p>open</p>" });
            expect((await api.put(`/api/notes/${locked.noteId}/protect/1`)).status).toBe(204);
            const mismatch = await api.post<{ message: string }>(`/api/notes/${locked.noteId}/merge`, {
                body: { sourceNoteIds: [ open.noteId ] }
            });
            expect(mismatch.status).toBe(400);
            expect(mismatch.body.message).toContain("not protected");

            protectedSessionService.resetDataKey();
            const stillLocked = await api.post<{ message: string }>(`/api/notes/${locked.noteId}/merge`, {
                body: { sourceNoteIds: [ open.noteId ] }
            });
            expect(stillLocked.status).toBe(400);
            expect(stillLocked.body.message).toContain("Unlock protected notes");

            const linked = await createTextNote(api, { title: "Linked", content: "<p>linked</p>" });
            const other = await createTextNote(api, { title: "Other", content: "<p>other</p>" });
            const holder = await createTextNote(api, {
                title: "Holder",
                content: `<p>See <a class="reference-link" href="#root/${linked.noteId}">it</a>.</p>`
            });
            protectedSessionService.setDataKey(PROTECTED_KEY);
            expect((await api.put(`/api/notes/${holder.noteId}/protect/1`)).status).toBe(204);
            protectedSessionService.resetDataKey();
            const referenced = await api.post<{ message: string }>(`/api/notes/${linked.noteId}/merge`, {
                body: { sourceNoteIds: [ other.noteId ] }
            });
            expect(referenced.status).toBe(400);
            expect(referenced.body.message).toContain("links to a note being merged");
        } finally {
            protectedSessionService.resetDataKey();
        }
    });

    it("joins code, adopts a prefix, and moves relations without touching the merged text", async () => {
        const left = await createCodeNote("root", "Left", "text/plain", "alpha line");
        const right = await createCodeNote("root", "Right", "text/plain", "beta line");
        const joinedId = await mergeNotes(left, [ right ]);
        expect(String(becca.getNoteOrThrow(joinedId).getContent())).toBe("alpha line\n\nbeta line");

        const labeled = await createTextNote(api, { title: "Labeled", content: "<p>labeled</p>" });
        expect((await api.post(`/api/notes/${labeled.noteId}/attributes`, {
            body: { type: "label", name: "disableVersioning" }
        })).status).toBe(204);
        const emptyFile = await createTypedNote("root", "Empty file", "file", "text/plain", "");
        const emptyImage = await createTextNote(api, { title: "Empty image", content: "" });
        expect((await api.put(`/api/notes/${emptyImage.noteId}/type`, {
            body: { type: "image", mime: "image/png" }
        })).status).toBe(204);
        const keptId = await mergeNotes(labeled.noteId, [ emptyFile, emptyImage.noteId ]);
        expect(String(becca.getNoteOrThrow(keptId).getContent())).toContain("labeled");
        const revisions = getSql().getRows<{ description: string | null }>(
            "SELECT description FROM revisions WHERE noteId = ?",
            [ labeled.noteId ]
        );
        expect(revisions.some((row) => row.description === "Before merging notes")).toBe(false);

        const first = await createTextNote(api, { title: "First", content: "<p>first body</p>" });
        const second = await createTextNote(api, { title: "Second", content: "<p>second body</p>" });
        const bystander = await createTextNote(api, { title: "Bystander", content: "<p></p>" });
        cls.init(() => {
            becca.getNoteOrThrow(first.noteId).children.push(becca.getNoteOrThrow(bystander.noteId));
        });
        const onlyInclude = await createTextNote(api, {
            title: "Only include",
            content: `<figure class="include-note" data-note-id="${first.noteId}">`
                + "<h4>Included</h4></figure>"
        });
        expect((await api.put(`/api/branches/${second.branchId}/set-prefix`, {
            body: { prefix: "Pre" }
        })).status).toBe(204);
        expect((await api.post(`/api/notes/${first.noteId}/attributes`, {
            body: { type: "label", name: "tone", value: "red", isInheritable: true }
        })).status).toBe(204);
        expect((await api.post(`/api/notes/${second.noteId}/attributes`, {
            body: { type: "label", name: "tone", value: "red", isInheritable: true }
        })).status).toBe(204);
        expect((await api.post(`/api/notes/${first.noteId}/attributes`, {
            body: { type: "label", name: "plain", value: "yes", isInheritable: true }
        })).status).toBe(204);
        expect((await api.post(`/api/notes/${second.noteId}/attributes`, {
            body: { type: "label", name: "plain", value: "yes", isInheritable: false }
        })).status).toBe(204);
        expect((await api.post(`/api/notes/${first.noteId}/attributes`, {
            body: { type: "relation", name: "see", value: second.noteId }
        })).status).toBe(204);
        expect((await api.post(`/api/notes/${bystander.noteId}/attributes`, {
            body: { type: "relation", name: "internalLink", value: first.noteId }
        })).status).toBe(204);
        expect((await api.post(`/api/notes/${bystander.noteId}/attributes`, {
            body: { type: "relation", name: "internalLink", value: second.noteId, isInheritable: true }
        })).status).toBe(204);
        expect((await api.post(`/api/notes/${bystander.noteId}/attributes`, {
            body: { type: "relation", name: "cites", value: first.noteId }
        })).status).toBe(204);

        const mergedId = await mergeNotes(first.noteId, [ second.noteId, onlyInclude.noteId ]);
        const merged = becca.getNoteOrThrow(mergedId);
        expect(merged.getParentBranches().some((branch) => branch.prefix === "Pre")).toBe(true);
        expect(merged.getOwnedAttributes("label", "tone", "red")
            .every((attr) => attr.isInheritable)).toBe(true);
        expect(merged.getOwnedRelations("see")).toHaveLength(0);
        expect(String(merged.getContent())).toContain("first body");
        expect(String(merged.getContent())).not.toContain("include-note");
        expect(becca.getNoteOrThrow(bystander.noteId).getOwnedRelations("cites")
            .map((attr) => attr.value)).toEqual([ mergedId ]);

        const history = await api.get<{
            entries: { id: string; sourceNoteId: string }[];
        }>(`/api/notes/${mergedId}/merge-history`);
        const secondEntry = history.body.entries.find((entry) => entry.sourceNoteId === second.noteId);
        const firstEntry = history.body.entries.find((entry) => entry.sourceNoteId === first.noteId);
        expect(secondEntry && firstEntry).toBeTruthy();
        if (!secondEntry || !firstEntry) {
            return;
        }

        expect((await api.post(`/api/notes/${mergedId}/merge-undo`, {
            body: { entryId: secondEntry.id }
        })).status).toBe(200);
        expect(becca.getNoteOrThrow(mergedId).getParentBranches()
            .some((branch) => branch.prefix === "Pre")).toBe(false);
        expect(becca.getNoteOrThrow(bystander.noteId).getOwnedRelations("internalLink")
            .some((attr) => attr.value === second.noteId)).toBe(true);

        expect((await api.post(`/api/notes/${mergedId}/merge-undo`, {
            body: { entryId: firstEntry.id }
        })).status).toBe(200);
        expect(becca.getNoteOrThrow(bystander.noteId).getOwnedRelations("cites")
            .map((attr) => attr.value)).toEqual([ first.noteId ]);
        expect(String(becca.getNoteOrThrow(mergedId).getContent())).toContain("first body");

        const grand = await createTextNote(api, { title: "Grand", content: "<p>grand</p>" });
        const kid = await createTextNote(api, {
            parentNoteId: grand.noteId, title: "Kid", content: "<p>kid</p>"
        });
        const leaf = await createTextNote(api, {
            parentNoteId: kid.noteId, title: "Leaf", content: "<p>leaf</p>"
        });
        const both = await createTextNote(api, {
            title: "Both",
            content: `<p><a class="reference-link" href="#root/${grand.noteId}">g</a>`
                + `<a class="reference-link" href="#root/${leaf.noteId}">l</a></p>`
        });
        const movedId = await mergeNotes(grand.noteId, [ leaf.noteId ]);
        expect(becca.getNoteOrThrow(kid.noteId).getParentNotes().map((note) => note.noteId))
            .toContain("root");
        const bothContent = String(becca.getNoteOrThrow(both.noteId).getContent());
        expect(bothContent).toContain(movedId);
        expect(bothContent).not.toContain(grand.noteId);
        expect(bothContent).not.toContain(leaf.noteId);
    });

    it("ignores a broken history record and restores around missing pieces", async () => {
        const first = await createTextNote(api, { title: "One", content: "<p>one</p>" });
        const second = await createTextNote(api, { title: "Two", content: "<p>two</p>" });
        const mergedId = await mergeNotes(first.noteId, [ second.noteId ]);

        const unknown = await api.post<{ message: string }>(`/api/notes/${mergedId}/merge-undo`, {
            body: { entryId: "missing-entry" }
        });
        expect(unknown.status).toBe(400);
        expect(unknown.body.message).toContain("no longer in the history");

        for (const content of [ "not-json", "{\"ok\":true}", "[{}]", "[null]" ]) {
            writeJournal(mergedId, content);
            const undone = await api.post<{ message: string }>(`/api/notes/${mergedId}/merge-undo`);
            expect(undone.status).toBe(400);
            expect(undone.body.message).toContain("no merge to undo");
        }

        const kept = await createTextNote(api, { title: "Kept", content: "<p>kept</p>" });
        const gone = await createTextNote(api, { title: "Gone", content: "<p>gone</p>" });
        const expiredId = await mergeNotes(kept.noteId, [ gone.noteId ]);
        cls.init(() => {
            getSql().execute("DELETE FROM notes WHERE noteId = ?", [ gone.noteId ]);
            getSql().execute("DELETE FROM notes WHERE noteId = ?", [ kept.noteId ]);
        });
        const expired = await api.post<{ message: string }>(`/api/notes/${expiredId}/merge-undo`);
        expect(expired.status).toBe(400);
        expect(expired.body.message).toContain("no longer be undone");

        const alpha = await createTextNote(api, { title: "Alpha", content: "<p>alpha</p>" });
        const beta = await createTextNote(api, { title: "Beta", content: "<p>beta</p>" });
        const child = await createTextNote(api, {
            parentNoteId: beta.noteId, title: "Child", content: "<p>child</p>"
        });
        const linker = await createTextNote(api, {
            title: "Linker",
            content: `<p>See <a class="reference-link" href="#root/${beta.noteId}">beta</a>.</p>`
        });
        const sealed = await createTextNote(api, {
            title: "Sealed",
            content: `<p>See <a class="reference-link" href="#root/${alpha.noteId}">alpha</a>.</p>`
        });
        const decoy = await createTextNote(api, { title: "Decoy", content: "<p>decoy</p>" });
        const restoredId = await mergeNotes(alpha.noteId, [ beta.noteId ]);
        expect((await api.put(`/api/notes/${linker.noteId}/data`, {
            body: { content: "<p>rewritten</p>" }
        })).status).toBe(204);
        cls.init(() => {
            getSql().execute(
                "UPDATE notes SET isProtected = 1 WHERE noteId = ?",
                [ sealed.noteId ]
            );
            const sealedNote = becca.getNote(sealed.noteId);
            if (sealedNote) {
                sealedNote.isProtected = true;
            }
            const journal = becca.getNoteOrThrow(restoredId).getAttachments()
                .find((item) => item.role === "mergeUndo");
            if (!journal) {
                throw new Error("missing merge journal");
            }
            const kid = becca.getNoteOrThrow(child.noteId);
            for (const branch of kid.parentBranches) {
                if (branch.parentNoteId !== beta.noteId || !branch.branchId) {
                    continue;
                }
                getSql().execute("DELETE FROM branches WHERE branchId = ?", [ branch.branchId ]);
                delete becca.branches[branch.branchId];
            }
            kid.parentBranches = kid.parentBranches
                .filter((branch) => branch.parentNoteId !== beta.noteId);
            const decoyNote = becca.getNoteOrThrow(decoy.noteId);
            decoyNote.isBeingDeleted = true;
            const stack = JSON.parse(decodeUtf8(journal.getContent())) as {
                createdBranchIds: string[];
                prefixRestores: { branchId: string; prefix: string | null }[];
                inheritableReverts: string[];
                relationRestores: { attributeId: string; value: string }[];
                deletedRelations: {
                    noteId: string;
                    name: string;
                    value: string;
                    isInheritable: boolean;
                    position: number;
                }[];
                linkPatches: { noteId: string; indices: number[] }[];
            }[];
            const newest = stack[stack.length - 1];
            if (newest) {
                newest.createdBranchIds.push("missing-branch", decoy.branchId);
                newest.prefixRestores.push({ branchId: "missing-prefix-branch", prefix: "x" });
                newest.inheritableReverts.push("missing-attribute");
                newest.relationRestores.push({ attributeId: "missing-relation", value: "root" });
                newest.deletedRelations.push({
                    noteId: "missing-owner",
                    name: "gone",
                    value: "root",
                    isInheritable: false,
                    position: 0
                });
                newest.linkPatches.push({ noteId: restoredId, indices: [ 0 ] });
                newest.linkPatches.push({ noteId: "missing-note", indices: [ 0 ] });
            }
            journal.setContent(JSON.stringify(stack), { forceSave: true });
        });
        expect((await api.post(`/api/notes/${restoredId}/merge-undo`)).status).toBe(200);
        expect(String(becca.getNoteOrThrow(linker.noteId).getContent())).toBe("<p>rewritten</p>");
        expect(noteIsDeleted(beta.noteId)).toBe(0);
        expect(becca.getNoteOrThrow(child.noteId).getParentNotes()
            .some((note) => note.noteId === beta.noteId)).toBe(true);
        expect(String(becca.getNoteOrThrow(restoredId).getContent())).toContain("alpha");

        const present = await createTextNote(api, { title: "Present", content: "<p>present</p>" });
        const absent = await createTextNote(api, { title: "Absent", content: "<p>absent</p>" });
        const presentId = await mergeNotes(present.noteId, [ absent.noteId ]);
        cls.init(() => {
            getSql().execute("UPDATE notes SET isDeleted = 0 WHERE noteId = ?", [ absent.noteId ]);
        });
        expect((await api.post(`/api/notes/${presentId}/merge-undo`)).status).toBe(200);
        expect(String(becca.getNoteOrThrow(presentId).getContent())).toContain("present");

        cls.init(() => {
            getSql().execute(
                "UPDATE attachments SET isProtected = 1 WHERE ownerId = ? AND role = ?",
                [ restoredId, "mergeUndo" ]
            );
        });
        const protectedJournal = await api.post<{ message: string }>(
            `/api/notes/${restoredId}/merge-undo`
        );
        expect(protectedJournal.status).toBe(400);
        expect(protectedJournal.body.message).toContain("Unlock protected notes");

        const origin = await createTextNote(api, { title: "Origin", content: "<p>origin</p>" });
        const follow = await createTextNote(api, { title: "Follow", content: "<p>follow</p>" });
        const templateId = await mergeNotes(origin.noteId, [ follow.noteId ]);
        expect((await api.post(`/api/notes/${templateId}/attachments`, {
            body: { role: "file", mime: "text/plain", title: "keep.txt", content: "kept" }
        })).status).toBe(204);
        expect((await api.post(`/api/notes/${templateId}/attachments`, {
            body: { role: "mergeUndoBlob", mime: "text/plain", title: "old copy", content: "old" }
        })).status).toBe(204);
        const created = await api.post<{ note: { noteId: string } }>(
            "/api/notes/root/children?target=into",
            {
                body: {
                    title: "From template",
                    type: "text",
                    content: "<p></p>",
                    templateNoteId: templateId
                }
            }
        );
        expect(created.status).toBe(200);
        const roles = becca.getNoteOrThrow(created.body.note.noteId).getAttachments()
            .map((item) => item.role);
        expect(roles).toContain("file");
        expect(roles).not.toContain("mergeUndo");
        expect(roles).not.toContain("mergeUndoBlob");
    });

    it("keeps an outside embed and a blank note's files, and refuses a binary note first", async () => {
        const source = await createTextNote(api, { title: "Source", content: "<p>source</p>" });
        const other = await createTextNote(api, { title: "Other", content: "<p>other</p>" });
        const host = await createTextNote(api, {
            title: "Host",
            content: `<figure class="include-note" data-note-id="${source.noteId}">`
                + "<h4>Included</h4></figure>"
        });
        const mergedId = await mergeNotes(source.noteId, [ other.noteId ]);
        const hostContent = String(becca.getNoteOrThrow(host.noteId).getContent());
        expect(hostContent).toContain("include-note");
        expect(hostContent).toContain(mergedId);
        expect(hostContent).not.toContain(source.noteId);

        const keeper = await createTextNote(api, { title: "Keeper", content: "<p>keeper</p>" });
        const blank = await createTextNote(api, { title: "Blank", content: "" });
        expect((await api.post(`/api/notes/${blank.noteId}/attachments`, {
            body: { role: "file", mime: "text/plain", title: "notes.txt", content: "attached" }
        })).status).toBe(204);
        const withFile = await mergeNotes(keeper.noteId, [ blank.noteId ]);
        expect(becca.getNoteOrThrow(withFile).getAttachments().some((item) => item.title === "notes.txt"))
            .toBe(true);

        const fileId = await createTypedNote("root", "Blob", "file", "application/octet-stream", "");
        cls.init(() => {
            becca.getNoteOrThrow(fileId).setContent(new Uint8Array([ 1, 2, 3 ]));
        });
        const empty = await createTextNote(api, { title: "Empty", content: "" });
        const refused = await api.post<{ message: string }>(`/api/notes/${fileId}/merge`, {
            body: { sourceNoteIds: [ empty.noteId ] }
        });
        expect(refused.status).toBe(400);
        expect(refused.body.message).toContain("cannot be combined");
        expect(noteIsDeleted(fileId)).toBe(0);
        expect(noteIsDeleted(empty.noteId)).toBe(0);
    });

    it("keeps a shared label and a shared child until every original is restored", async () => {
        const first = await createTextNote(api, { title: "First", content: "<p>first</p>" });
        const second = await createTextNote(api, { title: "Second", content: "<p>second</p>" });
        const child = await createTextNote(api, {
            parentNoteId: first.noteId, title: "Shared child", content: "<p>child</p>"
        });
        expect((await api.put(`/api/notes/${child.noteId}/clone-to-note/${second.noteId}`, {
            body: {}
        })).status).toBe(200);
        expect((await api.post(`/api/notes/${first.noteId}/attributes`, {
            body: { type: "label", name: "shared", value: "yes" }
        })).status).toBe(204);
        expect((await api.post(`/api/notes/${second.noteId}/attributes`, {
            body: { type: "label", name: "shared", value: "yes" }
        })).status).toBe(204);

        const mergedId = await mergeNotes(first.noteId, [ second.noteId ]);
        const history = await api.get<{
            entries: { id: string; sourceNoteId: string }[];
        }>(`/api/notes/${mergedId}/merge-history`);
        const firstEntry = history.body.entries.find((entry) => entry.sourceNoteId === first.noteId);
        const secondEntry = history.body.entries.find((entry) => entry.sourceNoteId === second.noteId);
        expect(firstEntry && secondEntry).toBeTruthy();
        if (!firstEntry || !secondEntry) {
            return;
        }

        expect((await api.post(`/api/notes/${mergedId}/merge-undo`, {
            body: { entryId: firstEntry.id }
        })).status).toBe(200);
        expect(becca.getNoteOrThrow(mergedId).getOwnedAttributes("label", "shared", "yes"))
            .toHaveLength(1);
        expect(becca.getNoteOrThrow(child.noteId).getParentNotes().map((note) => note.noteId))
            .toEqual(expect.arrayContaining([ mergedId, first.noteId ]));

        expect((await api.post(`/api/notes/${mergedId}/merge-undo`, {
            body: { entryId: secondEntry.id }
        })).status).toBe(200);
        expect(becca.getNoteOrThrow(mergedId).getOwnedAttributes("label", "shared")).toHaveLength(0);
        expect(becca.getNoteOrThrow(child.noteId).getParentNotes().map((note) => note.noteId))
            .not.toContain(mergedId);
    });

    it("keeps a shared label and child when one original is forgotten", async () => {
        const first = await createTextNote(api, { title: "First", content: "<p>first</p>" });
        const second = await createTextNote(api, { title: "Second", content: "<p>second</p>" });
        const child = await createTextNote(api, {
            parentNoteId: first.noteId, title: "Shared child", content: "<p>child</p>"
        });
        expect((await api.put(`/api/notes/${child.noteId}/clone-to-note/${second.noteId}`, {
            body: {}
        })).status).toBe(200);
        expect((await api.post(`/api/notes/${first.noteId}/attributes`, {
            body: { type: "label", name: "shared", value: "yes" }
        })).status).toBe(204);
        expect((await api.post(`/api/notes/${second.noteId}/attributes`, {
            body: { type: "label", name: "shared", value: "yes" }
        })).status).toBe(204);

        const mergedId = await mergeNotes(first.noteId, [ second.noteId ]);
        const history = await api.get<{
            entries: { id: string; sourceNoteId: string }[];
        }>(`/api/notes/${mergedId}/merge-history`);
        const firstEntry = history.body.entries.find((entry) => entry.sourceNoteId === first.noteId);
        const secondEntry = history.body.entries.find((entry) => entry.sourceNoteId === second.noteId);
        expect(firstEntry && secondEntry).toBeTruthy();
        if (!firstEntry || !secondEntry) {
            return;
        }
        expect((await api.post(`/api/notes/${mergedId}/merge-history/forget`, {
            body: { entryId: firstEntry.id }
        })).status).toBe(200);
        const forgotten = await api.post<{ message: string }>(`/api/notes/${mergedId}/merge-undo`, {
            body: { entryId: firstEntry.id }
        });
        expect(forgotten.status).toBe(400);
        expect(forgotten.body.message).toContain("no longer in the history");

        const third = await createTextNote(api, { title: "Third", content: "<p>third</p>" });
        const laterId = await mergeNotes(mergedId, [ third.noteId ]);
        const laterHistory = await api.get<{
            entries: { id: string; sourceNoteId: string }[];
        }>(`/api/notes/${laterId}/merge-history`);
        expect(laterHistory.body.entries.map((entry) => entry.sourceNoteId)).toEqual([
            third.noteId, mergedId, second.noteId
        ]);
        const carriedSecond = laterHistory.body.entries
            .find((entry) => entry.sourceNoteId === second.noteId);
        expect(carriedSecond).toBeTruthy();
        if (!carriedSecond) {
            return;
        }
        expect((await api.post(`/api/notes/${laterId}/merge-undo`, {
            body: { entryId: carriedSecond.id }
        })).status).toBe(200);
        expect(becca.getNoteOrThrow(laterId).getOwnedAttributes("label", "shared", "yes"))
            .toHaveLength(1);
        const parents = becca.getNoteOrThrow(child.noteId).getParentNotes()
            .map((note) => note.noteId);
        expect(parents.sort()).toEqual([ laterId, second.noteId ].sort());
        expect(noteIsDeleted(first.noteId)).toBe(1);
        expect(noteIsDeleted(second.noteId)).toBe(0);
    });

    it("moves a child and a label back from the note a later merge produced", async () => {
        const alpha = await createTextNote(api, { title: "Alpha", content: "<p>alpha</p>" });
        const child = await createTextNote(api, {
            parentNoteId: alpha.noteId, title: "Kid", content: "<p>kid</p>"
        });
        expect((await api.post(`/api/notes/${alpha.noteId}/attributes`, {
            body: { type: "label", name: "carried", value: "1" }
        })).status).toBe(204);
        const beta = await createTextNote(api, { title: "Beta", content: "<p>beta</p>" });
        const firstMerge = await mergeNotes(alpha.noteId, [ beta.noteId ]);
        const gamma = await createTextNote(api, { title: "Gamma", content: "<p>gamma</p>" });
        const secondMerge = await mergeNotes(firstMerge, [ gamma.noteId ]);
        expect(becca.getNoteOrThrow(child.noteId).getParentNotes().map((note) => note.noteId))
            .toEqual([ secondMerge ]);
        expect(becca.getNoteOrThrow(secondMerge).getOwnedAttributes("label", "carried", "1"))
            .toHaveLength(1);

        const history = await api.get<{
            entries: { id: string; sourceNoteId: string }[];
        }>(`/api/notes/${secondMerge}/merge-history`);
        const alphaEntry = history.body.entries.find((entry) => entry.sourceNoteId === alpha.noteId);
        expect(alphaEntry).toBeTruthy();
        if (!alphaEntry) {
            return;
        }
        expect((await api.post(`/api/notes/${secondMerge}/merge-undo`, {
            body: { entryId: alphaEntry.id }
        })).status).toBe(200);
        expect(becca.getNoteOrThrow(child.noteId).getParentNotes().map((note) => note.noteId))
            .toEqual([ alpha.noteId ]);
        expect(becca.getNoteOrThrow(secondMerge).getOwnedAttributes("label", "carried")).toHaveLength(0);
        expect(becca.getNoteOrThrow(alpha.noteId).getOwnedAttributes("label", "carried", "1"))
            .toHaveLength(1);
    });

    it("skips an erased original and restores an older note that is still there", async () => {
        const older = await createTextNote(api, { title: "Older", content: "<p>older</p>" });
        const newer = await createTextNote(api, { title: "Newer", content: "<p>newer</p>" });
        const mergedId = await mergeNotes(older.noteId, [ newer.noteId ]);
        cls.init(() => {
            getSql().execute("DELETE FROM notes WHERE noteId = ?", [ newer.noteId ]);
        });

        const history = await api.get<{
            entries: { id: string; sourceNoteId: string; undoable: boolean }[];
        }>(`/api/notes/${mergedId}/merge-history`);
        expect(history.body.entries.map((entry) => entry.undoable)).toEqual([ false, true ]);
        const newerEntry = history.body.entries.find((entry) => entry.sourceNoteId === newer.noteId);
        expect(newerEntry).toBeTruthy();
        if (!newerEntry) {
            return;
        }
        const expired = await api.post<{ message: string }>(`/api/notes/${mergedId}/merge-undo`, {
            body: { entryId: newerEntry.id }
        });
        expect(expired.status).toBe(400);
        expect(expired.body.message).toContain("no longer be undone");

        expect((await api.post(`/api/notes/${mergedId}/merge-undo`)).status).toBe(200);
        expect(noteIsDeleted(older.noteId)).toBe(0);
        expect(noteIsDeleted(newer.noteId)).toBeNull();
    });

    it("carries a prefix and an inheritable label, and skips a file's links", async () => {
        const earlier = await createTextNote(api, { title: "Earlier", content: "<p>earlier</p>" });
        const later = await createTextNote(api, { title: "Later", content: "<p>later</p>" });
        const host = await mergeNotes(earlier.noteId, [ later.noteId ]);
        const kid = await createTextNote(api, {
            parentNoteId: host, title: "Kid", content: "<p>kid</p>"
        });
        const next = await createTextNote(api, { title: "Next", content: "<p>next</p>" });
        expect((await api.put(`/api/notes/${kid.noteId}/clone-to-note/${next.noteId}`, {
            body: { prefix: "" }
        })).status).toBe(200);
        const hostBranch = becca.getNoteOrThrow(kid.noteId).getParentBranches()
            .find((branch) => branch.parentNoteId === host);
        expect(hostBranch?.branchId).toBeTruthy();
        expect((await api.put(`/api/branches/${hostBranch?.branchId}/set-prefix`, {
            body: { prefix: "Pre" }
        })).status).toBe(204);
        expect((await api.post(`/api/notes/${host}/attributes`, {
            body: { type: "label", name: "tone", value: "red", isInheritable: true }
        })).status).toBe(204);
        expect((await api.post(`/api/notes/${next.noteId}/attributes`, {
            body: { type: "label", name: "tone", value: "red", isInheritable: false }
        })).status).toBe(204);

        const journal = becca.getNoteOrThrow(host).getAttachments()
            .find((item) => item.role === "mergeUndo");
        const stack = JSON.parse(decodeUtf8(journal?.getContent() ?? "[]")) as {
            sourceNoteId: string;
            createdBranchIds: string[];
            prefixRestores: { branchId: string; prefix: string | null }[];
            linkPatches: { noteId: string; indices: number[] }[];
        }[];
        if (stack[0]) {
            stack[0].createdBranchIds.push("same-branch", "same-branch");
            const kept = hostBranch?.branchId;
            if (kept) {
                stack[0].prefixRestores.push(
                    { branchId: kept, prefix: "Old" },
                    { branchId: "unmapped-branch", prefix: null }
                );
            }
        }
        const fileNote = await createTypedNote(
            "root", "File note", "file", "application/octet-stream", ""
        );
        cls.init(() => {
            becca.getNoteOrThrow(fileNote).setContent(new Uint8Array([ 1 ]), { forceSave: true });
        });
        const earlierRecord = stack.find((item) => item.sourceNoteId === earlier.noteId);
        earlierRecord?.linkPatches.push({ noteId: fileNote, indices: [ 0 ] });
        writeJournal(host, JSON.stringify(stack));

        const carried = await mergeNotes(next.noteId, [ host ]);
        expect(becca.getNoteOrThrow(carried).getOwnedAttributes("label", "tone", "red")
            .some((attr) => attr.isInheritable)).toBe(true);
        expect(becca.getNoteOrThrow(kid.noteId).getParentBranches()
            .some((branch) => branch.prefix === "Pre")).toBe(true);

        const carriedHistory = await api.get<{ entries: { id: string; sourceNoteId: string }[] }>(
            `/api/notes/${carried}/merge-history`
        );
        const earlierEntry = carriedHistory.body.entries
            .find((item) => item.sourceNoteId === earlier.noteId);
        expect(earlierEntry).toBeTruthy();
        expect((await api.post(`/api/notes/${carried}/merge-undo`, {
            body: { entryId: earlierEntry?.id }
        })).status).toBe(200);

        cls.init(() => {
            becca.getNoteOrThrow(kid.noteId).markAsDeleted();
        });
        const hostEntry = carriedHistory.body.entries
            .find((item) => item.sourceNoteId === host);
        expect(hostEntry).toBeTruthy();
        expect((await api.post(`/api/notes/${carried}/merge-undo`, {
            body: { entryId: hostEntry?.id }
        })).status).toBe(200);
    });

    it("does not fill the merged note from a template", async () => {
        const template = await createTextNote(api, {
            title: "Stencil template", content: "<p>FROM TEMPLATE</p>"
        });
        await createTextNote(api, {
            parentNoteId: template.noteId, title: "Stencil", content: "<p>stencil</p>"
        });
        const parent = await createTextNote(api, { title: "Templated parent", content: "<p></p>" });
        expect((await api.post(`/api/notes/${parent.noteId}/attributes`, {
            body: {
                type: "relation",
                name: "child:template",
                value: template.noteId,
                isInheritable: false
            }
        })).status).toBe(204);

        const alpha = await createTextNote(api, {
            parentNoteId: parent.noteId, title: "Templated alpha", content: "<p>alpha body</p>"
        });
        const beta = await createTextNote(api, {
            parentNoteId: parent.noteId, title: "Templated beta", content: "<p>beta body</p>"
        });
        const merged = becca.getNoteOrThrow(await mergeNotes(alpha.noteId, [ beta.noteId ]));
        const content = String(merged.getContent());
        expect(content).toContain("alpha body");
        expect(content).toContain("beta body");
        expect(content).not.toContain("FROM TEMPLATE");
        expect(merged.getRelations("template").map((rel) => rel.value)).toContain(template.noteId);
        expect(merged.getChildNotes().filter((child) => child.title === "Stencil")).toHaveLength(2);

        const owned = await createTextNote(api, {
            title: "Owns template", content: "<p>owned body</p>"
        });
        expect((await api.post(`/api/notes/${owned.noteId}/attributes`, {
            body: {
                type: "relation", name: "template", value: template.noteId, isInheritable: false
            }
        })).status).toBe(204);
        const other = await createTextNote(api, {
            title: "Beside template", content: "<p>other body</p>"
        });
        const copied = becca.getNoteOrThrow(await mergeNotes(owned.noteId, [ other.noteId ]));
        const copiedContent = String(copied.getContent());
        expect(copiedContent).toContain("owned body");
        expect(copiedContent).toContain("other body");
        expect(copiedContent).not.toContain("FROM TEMPLATE");
        expect(copied.getChildNotes().filter((child) => child.title === "Stencil")).toHaveLength(1);
        expect(copied.getRelations("template").map((rel) => rel.value)).toContain(template.noteId);
    });

    it("still fills a note a script creates while the merge runs", async () => {
        const template = await createTextNote(api, {
            title: "Script stencil", content: "<p>FROM TEMPLATE</p>"
        });
        await createTextNote(api, {
            parentNoteId: template.noteId, title: "Stencil", content: "<p>stencil</p>"
        });
        const otherParent = await createTextNote(api, {
            title: "Script parent", content: "<p></p>"
        });
        expect((await api.post(`/api/notes/${otherParent.noteId}/attributes`, {
            body: {
                type: "relation",
                name: "child:template",
                value: template.noteId,
                isInheritable: false
            }
        })).status).toBe(204);

        const parent = await createTextNote(api, { title: "Merge parent", content: "<p></p>" });
        expect((await api.post(`/api/notes/${parent.noteId}/attributes`, {
            body: {
                type: "relation",
                name: "child:template",
                value: template.noteId,
                isInheritable: false
            }
        })).status).toBe(204);
        const alpha = await createTextNote(api, {
            parentNoteId: parent.noteId, title: "Script alpha", content: "<p>alpha body</p>"
        });
        const beta = await createTextNote(api, {
            parentNoteId: parent.noteId, title: "Script beta", content: "<p>beta body</p>"
        });
        const script = await createCodeNote(
            "root",
            "Create beside the merge",
            "application/javascript;env=backend",
            "api.createTextNote("
            + `${JSON.stringify(otherParent.noteId)}, "Scripted during merge", "");`
        );
        expect((await api.post(`/api/notes/${parent.noteId}/attributes`, {
            body: {
                type: "relation",
                name: "runOnChildNoteCreation",
                value: script,
                isInheritable: false
            }
        })).status).toBe(204);

        const previous = config.Security.backendScriptingEnabled;
        config.Security.backendScriptingEnabled = true;
        try {
            const merged = becca.getNoteOrThrow(await mergeNotes(alpha.noteId, [ beta.noteId ]));
            expect(String(merged.getContent())).toContain("alpha body");
            expect(String(merged.getContent())).not.toContain("FROM TEMPLATE");
            expect(merged.getChildNotes().filter((child) => child.title === "Stencil"))
                .toHaveLength(2);

            const scripted = Object.values(becca.notes).filter((note) =>
                !note.isDeleted && note.title === "Scripted during merge");
            expect(scripted.length).toBeGreaterThan(0);
            for (const created of scripted) {
                expect(String(created.getContent())).toContain("FROM TEMPLATE");
                expect(created.getChildNotes().filter((child) => child.title === "Stencil"))
                    .toHaveLength(1);
                expect(created.getRelations("template").map((rel) => rel.value))
                    .toContain(template.noteId);
            }
        } finally {
            config.Security.backendScriptingEnabled = previous;
        }
    });

    it("keeps a restored original when an intermediate note is restored later", async () => {
        async function chain() {
            const outsider = await createTextNote(api, { title: "Outsider", content: "<p>x</p>" });
            const first = await createTextNote(api, { title: "Linked", content: "<p>a</p>" });
            const second = await createTextNote(api, {
                title: "Beside linked", content: "<p>b</p>"
            });
            const third = await createTextNote(api, { title: "Later", content: "<p>c</p>" });
            expect((await api.post(`/api/notes/${outsider.noteId}/attributes`, {
                body: {
                    type: "relation", name: "refers", value: first.noteId, isInheritable: false
                }
            })).status).toBe(204);
            const intermediate = await mergeNotes(first.noteId, [ second.noteId ]);
            const result = await mergeNotes(intermediate, [ third.noteId ]);
            return { outsider: outsider.noteId, first: first.noteId, intermediate, result };
        }

        function refersTo(noteId: string) {
            return becca.getNoteOrThrow(noteId).getRelations("refers").map((rel) => rel.value);
        }

        async function undo(noteId: string, sourceNoteId: string) {
            const history = await api.get<{ entries: { id: string; sourceNoteId: string }[] }>(
                `/api/notes/${noteId}/merge-history`
            );
            const entry = history.body.entries.find((item) => item.sourceNoteId === sourceNoteId);
            expect(entry).toBeTruthy();
            expect((await api.post(`/api/notes/${noteId}/merge-undo`, {
                body: { entryId: entry?.id }
            })).status).toBe(200);
        }

        const forward = await chain();
        await undo(forward.result, forward.first);
        expect(refersTo(forward.outsider)).toEqual([ forward.first ]);
        await undo(forward.result, forward.intermediate);
        expect(refersTo(forward.outsider)).toEqual([ forward.first ]);

        const reverse = await chain();
        await undo(reverse.result, reverse.intermediate);
        expect(refersTo(reverse.outsider)).toEqual([ reverse.intermediate ]);
        await undo(reverse.result, reverse.first);
        expect(refersTo(reverse.outsider)).toEqual([ reverse.first ]);
    });

    it("does not give an imported copy the original merge's undo", async () => {
        const alpha = await createTextNote(api, { title: "Export alpha", content: "<p>alpha</p>" });
        const beta = await createTextNote(api, { title: "Export beta", content: "<p>beta</p>" });
        const merged = await mergeNotes(alpha.noteId, [ beta.noteId ]);
        const branch = becca.getNoteOrThrow(merged).getParentBranches()
            .find((item) => !item.isDeleted);
        if (!branch) {
            throw new Error("The merged note has no branch.");
        }

        const zip = await api.get<Buffer>(
            `/api/branches/${branch.branchId}/export/subtree/html/exportTask`
        );
        expect(zip.status).toBe(200);
        let meta = "";
        await getZipProvider().readZipFile(zip.body, async (entry, read) => {
            if (entry.fileName === "!!!meta.json") {
                meta = decodeUtf8(await read());
            }
        });
        expect(meta).not.toContain("mergeUndo");

        const imported = await api.post<{ noteId: string }>(`/api/notes/root/notes-import`, {
            body: {},
            file: {
                originalname: "merged.zip", mimetype: "application/zip", buffer: zip.body
            }
        });
        expect(imported.status).toBe(200);
        const copy = becca.getNoteOrThrow(imported.body.noteId);
        expect(copy.getAttachments().some((item) => item.role === "mergeUndo")).toBe(false);
        expect((await api.post(`/api/notes/${copy.noteId}/merge-undo`)).status).toBe(400);

        const history = await api.get<{ entries: { id: string; sourceNoteId: string }[] }>(
            `/api/notes/${merged}/merge-history`
        );
        const alphaEntry = history.body.entries.find((item) => item.sourceNoteId === alpha.noteId);
        expect(alphaEntry).toBeTruthy();
        expect((await api.post(`/api/notes/${merged}/merge-undo`, {
            body: { entryId: alphaEntry?.id }
        })).status).toBe(200);
        expect(noteIsDeleted(alpha.noteId)).toBe(0);
    });
});
