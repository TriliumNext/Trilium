import { SpaceUsageNoteResponse, SpaceUsageOverviewResponse } from "@triliumnext/commons";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { getLog } from "../../services/log";
import { getSql } from "../../services/sql/index";
import { CoreApiTester } from "../../test/api_tester";
import { createTextNote, type CreatedNote } from "../../test/api_fixtures";

let api: CoreApiTester;
let parent: CreatedNote;
let child: CreatedNote;
let cloneTarget: CreatedNote;
let revisionHeavy: CreatedNote;

const PARENT_CONTENT = "<p>0123456789</p>";
const CHILD_CONTENT = `<p>${"x".repeat(5000)}</p>`;
const ATTACHMENT_CONTENT = "0123456789";
// Heavier than the child's body + attachment + revision combined, so that including revisions in
// the ranking demonstrably reorders the two.
const REVISION_HEAVY_CONTENT = `<p>${"r".repeat(12000)}</p>`;

async function getOverview(query: Record<string, string | number | boolean> = {}) {
    const res = await api.get<SpaceUsageOverviewResponse>("/api/space-usage/overview", { query });
    expect(res.status).toBe(200);
    return res.body;
}

async function getNoteUsage(noteId: string, query: Record<string, string | number | boolean> = {}) {
    const res = await api.get<SpaceUsageNoteResponse>(`/api/space-usage/note/${noteId}`, { query });
    expect(res.status).toBe(200);
    return res.body;
}

describe("Space usage API (core)", () => {
    beforeAll(async () => {
        api = CoreApiTester.build();

        parent = await createTextNote(api, { title: "Space usage parent", content: PARENT_CONTENT });
        child = await createTextNote(api, {
            parentNoteId: parent.noteId,
            title: "Space usage child",
            content: CHILD_CONTENT
        });
        cloneTarget = await createTextNote(api, { title: "Space usage clone target", content: "<p>tiny</p>" });

        const attachmentRes = await api.post(`/api/notes/${child.noteId}/attachments`, {
            body: { role: "file", mime: "text/plain", title: "Space usage attachment", content: ATTACHMENT_CONTENT }
        });
        expect(attachmentRes.status).toBe(204);

        const revisionRes = await api.post(`/api/notes/${child.noteId}/revision`);
        expect(revisionRes.status).toBe(200);

        const cloneRes = await api.put(`/api/notes/${child.noteId}/clone-to-note/${cloneTarget.noteId}`, { body: {} });
        expect(cloneRes.status).toBe(200);

        // A note whose weight sits almost entirely in its revision: big content revisioned away,
        // then replaced by a small body.
        revisionHeavy = await createTextNote(api, { title: "Space usage revision heavy", content: REVISION_HEAVY_CONTENT });
        const heavyRevisionRes = await api.post(`/api/notes/${revisionHeavy.noteId}/revision`);
        expect(heavyRevisionRes.status).toBe(200);
        const shrinkRes = await api.put(`/api/notes/${revisionHeavy.noteId}/data`, {
            body: { content: "<p>s</p>" }
        });
        expect(shrinkRes.status).toBe(204);
    });

    it("lists a large note with its size components and canonical path", async () => {
        const overview = await getOverview({ limit: 1000 });
        const entry = overview.notes.find((note) => note.noteId === child.noteId);

        expect(entry?.ownSize).toBe(CHILD_CONTENT.length);
        expect(entry?.attachmentsSize).toBe(ATTACHMENT_CONTENT.length);
        expect(entry?.revisionsSize).toBeGreaterThanOrEqual(CHILD_CONTENT.length);
        // Canonical placement is the original parent, not the later clone target.
        expect(entry?.notePath).toEqual([ parent.noteId, child.noteId ]);
    });

    it("orders by size, respects the limit and buckets the rest", async () => {
        const overview = await getOverview({ limit: 1000 });
        const noteIds = overview.notes.map((note) => note.noteId);
        expect(noteIds.indexOf(child.noteId)).toBeLessThan(noteIds.indexOf(parent.noteId));

        // The hidden subtree exists in every database, so it always has notes to aggregate.
        expect(overview.hiddenNotes.noteCount).toBeGreaterThan(0);
        expect(overview.total.noteCount).toBe(overview.notes.length + overview.otherNotes.noteCount);

        const limited = await getOverview({ limit: 1 });
        expect(limited.notes.length).toBe(1);
        expect(limited.otherNotes.noteCount).toBe(limited.total.noteCount - 1);
    });

    it("counts deduplicated content once in the content figure, but per entity in the note sizes", async () => {
        const duplicated = `<p>${"space-usage-dedup-".repeat(300)}</p>`;
        const before = await getOverview({ limit: 1 });

        await createTextNote(api, { title: "Space usage dedup 1", content: duplicated });
        await createTextNote(api, { title: "Space usage dedup 2", content: duplicated });

        const after = await getOverview({ limit: 1 });
        // Two notes, one shared blob: the visible-tree total grows twice, the deduplicated
        // database-content figure only once.
        expect(after.total.size - before.total.size).toBe(2 * duplicated.length);
        expect(after.content.size - before.content.size).toBe(duplicated.length);
        expect(after.content.noteCount - before.content.noteCount).toBe(2);
    });

    it("attributes each blob to exactly one content tier: bodies, then attachments, then revisions", async () => {
        const { content } = await getOverview({ limit: 1 });

        // The fixture attachment shares no blob with any body, so its tier holds at least it; the
        // revision-heavy note's snapshot no longer matches its shrunken body, so the revisions tier
        // holds at least that. The child's unchanged revision shares its body's blob and thus
        // belongs to the bodies tier — invisible here.
        expect(content.attachmentsSize).toBeGreaterThanOrEqual(ATTACHMENT_CONTENT.length);
        expect(content.revisionsSize).toBeGreaterThanOrEqual(REVISION_HEAVY_CONTENT.length);
        expect(content.size).toBeGreaterThanOrEqual(content.attachmentsSize + content.revisionsSize);
    });

    it("keeps zero-sized notes out of the individual listing", async () => {
        const empty = await createTextNote(api, { title: "Space usage empty", content: "" });
        const overview = await getOverview({ limit: 1000 });

        expect(overview.notes.some((note) => note.noteId === empty.noteId)).toBe(false);
    });

    it("moves revision weight into the ranking only when asked to", async () => {
        const withoutRevisions = await getOverview({ limit: 1000 });
        const heavyEntry = withoutRevisions.notes.find((note) => note.noteId === revisionHeavy.noteId);
        expect(heavyEntry?.revisionsSize).toBeGreaterThanOrEqual(REVISION_HEAVY_CONTENT.length);

        const rankWithout = withoutRevisions.notes.map((note) => note.noteId);
        expect(rankWithout.indexOf(child.noteId)).toBeLessThan(rankWithout.indexOf(revisionHeavy.noteId));

        const withRevisions = await getOverview({ limit: 1000, includeRevisions: true });
        const rankWith = withRevisions.notes.map((note) => note.noteId);
        expect(rankWith.indexOf(revisionHeavy.noteId)).toBeLessThan(rankWith.indexOf(child.noteId));
    });

    it("returns a note's children with whole-subtree totals", async () => {
        const usage = await getNoteUsage(parent.noteId);

        expect(usage.ownSize).toBe(PARENT_CONTENT.length);
        expect(usage.deletedNotes).toBeUndefined();

        const childEntry = usage.children.find((entry) => entry.noteId === child.noteId);
        expect(childEntry?.subtreeSize).toBe(CHILD_CONTENT.length + ATTACHMENT_CONTENT.length);
        expect(childEntry?.subtreeNoteCount).toBe(1);
    });

    it("measures a subtree's history by what erasing it would reclaim, not by snapshot sizes", async () => {
        // This note's revision holds the content its shrunken body no longer does, so erasing the
        // history really would free it.
        const heavyUsage = await getNoteUsage(revisionHeavy.noteId);
        expect(heavyUsage.subtreeRevisionsContentSize).toBeGreaterThanOrEqual(REVISION_HEAVY_CONTENT.length);

        // The child's revision snapshots an unchanged body and attachment, so it shares their blobs:
        // it weighs plenty per entity, yet erasing it would reclaim nothing at all.
        const childUsage = await getNoteUsage(child.noteId);
        expect(childUsage.revisionsSize).toBeGreaterThan(0);
        expect(childUsage.subtreeRevisionsContentSize).toBe(0);

        // The root's subtree covers both, and cannot exceed the database-wide revisions tier — the
        // figure the overview's own revisions bucket draws, which is what makes the two comparable.
        const rootUsage = await getNoteUsage("root");
        const overview = await getOverview({ limit: 1 });
        expect(rootUsage.subtreeRevisionsContentSize).toBeGreaterThanOrEqual(heavyUsage.subtreeRevisionsContentSize);
        expect(rootUsage.subtreeRevisionsContentSize).toBeLessThanOrEqual(overview.content.revisionsSize);
    });

    it("reports deduplicated note and subtree content sizes", async () => {
        const childUsage = await getNoteUsage(child.noteId);
        // The revision snapshots the unchanged body and attachment, sharing their blobs — so it
        // adds nothing to the deduplicated figures, unlike the per-entity revisionsSize.
        expect(childUsage.noteContentSize).toBe(CHILD_CONTENT.length + ATTACHMENT_CONTENT.length);
        expect(childUsage.subtreeContentSize).toBe(childUsage.noteContentSize);
        expect(childUsage.revisionsSize).toBeGreaterThan(0);

        const parentUsage = await getNoteUsage(parent.noteId);
        expect(parentUsage.noteContentSize).toBe(PARENT_CONTENT.length);
        expect(parentUsage.subtreeContentSize)
            .toBe(PARENT_CONTENT.length + CHILD_CONTENT.length + ATTACHMENT_CONTENT.length);

        // The root's canonical subtree is the whole live tree, so its figure can only stay within
        // the database-content total (which additionally sweeps up unreachable leftovers).
        const overview = await getOverview({ limit: 1 });
        const rootUsage = await getNoteUsage("root");
        expect(rootUsage.subtreeContentSize).toBeGreaterThan(0);
        expect(rootUsage.subtreeContentSize).toBeLessThanOrEqual(overview.content.size);
    });

    it("counts a cloned note only under its canonical parent", async () => {
        const usage = await getNoteUsage(cloneTarget.noteId);

        expect(usage.children.some((entry) => entry.noteId === child.noteId)).toBe(false);
    });

    it("lists a note's attachments individually", async () => {
        const usage = await getNoteUsage(child.noteId);
        const attachment = usage.attachments.find((entry) => entry.title === "Space usage attachment");

        expect(attachment?.role).toBe("file");
        expect(attachment?.size).toBe(ATTACHMENT_CONTENT.length);
        expect(usage.children).toEqual([]);
    });

    it("reports space held by deleted notes, at the root only", async () => {
        const doomed = await createTextNote(api, {
            title: "Space usage doomed",
            content: `<p>${"space-usage-doomed-".repeat(200)}</p>`
        });
        const doomedSize = `<p>${"space-usage-doomed-".repeat(200)}</p>`.length;

        const deleteRes = await api.delete(`/api/notes/${doomed.noteId}`, {
            query: { taskId: "space-usage-spec", last: true }
        });
        expect([ 200, 204 ]).toContain(deleteRes.status);

        const overview = await getOverview({ limit: 1000 });
        expect(overview.notes.some((note) => note.noteId === doomed.noteId)).toBe(false);
        expect(overview.deletedNotes.size).toBeGreaterThanOrEqual(doomedSize);
        expect(overview.deletedNotes.noteCount).toBeGreaterThanOrEqual(1);

        const rootUsage = await getNoteUsage("root");
        expect(rootUsage.deletedNotes?.size).toBeGreaterThanOrEqual(doomedSize);
    });

    it("counts a deleted attachment, which holds space with no note being deleted at all", async () => {
        const content = "space-usage-doomed-attachment-".repeat(100);
        const createRes = await api.post(`/api/notes/${parent.noteId}/attachments`, {
            body: { role: "file", mime: "text/plain", title: "Space usage doomed attachment", content }
        });
        expect(createRes.status).toBe(204);

        const usage = await getNoteUsage(parent.noteId);
        const attachmentId = usage.attachments
            .find((entry) => entry.title === "Space usage doomed attachment")?.attachmentId ?? "";
        expect(attachmentId).not.toBe("");

        const before = await getOverview({ limit: 1 });
        const deleteRes = await api.delete(`/api/attachments/${attachmentId}`);
        expect([ 200, 204 ]).toContain(deleteRes.status);
        const after = await getOverview({ limit: 1 });

        // The owning note is untouched, so the count that used to stand alone cannot describe this
        // at all: only the attachment count moves, and the space is real.
        expect(after.deletedNotes.attachmentCount).toBe(before.deletedNotes.attachmentCount + 1);
        expect(after.deletedNotes.noteCount).toBe(before.deletedNotes.noteCount);
        expect(after.deletedNotes.size - before.deletedNotes.size).toBeGreaterThanOrEqual(content.length);
    });

    it("reports attachments a live note no longer references, and what erasing them would free", async () => {
        const content = "space-usage-unused-attachment-".repeat(100);
        const host = await createTextNote(api, { title: "Space usage unused host", content: "<p>host</p>" });

        const createRes = await api.post(`/api/notes/${host.noteId}/attachments`, {
            body: { role: "file", mime: "text/plain", title: "Space usage unused attachment", content }
        });
        expect(createRes.status).toBe(204);

        const before = await getOverview({ limit: 1 });

        // Nothing in the body links to it, so saving the note schedules the attachment for erasure.
        const saveRes = await api.put(`/api/notes/${host.noteId}/data`, {
            body: { content: "<p>host, edited</p>" }
        });
        expect(saveRes.status).toBe(204);

        const after = await getOverview({ limit: 1 });
        const { unusedAttachments } = after;
        expect(unusedAttachments.attachmentCount).toBe(before.unusedAttachments.attachmentCount + 1);
        expect(unusedAttachments.size - before.unusedAttachments.size)
            .toBeGreaterThanOrEqual(content.length);
        // Awaiting cleanup is not being deleted: the attachment is still live content, and the
        // deleted figure beside it must not move.
        expect(after.deletedNotes.attachmentCount).toBe(before.deletedNotes.attachmentCount);

        // Database-wide, like the deleted figure, so it surfaces at the root and nowhere else.
        const rootUsage = await getNoteUsage("root");
        expect(rootUsage.unusedAttachments?.size).toBeGreaterThanOrEqual(content.length);
        expect((await getNoteUsage(host.noteId)).unusedAttachments).toBeUndefined();
    });

    it("counts an unused attachment's space only where nothing live still holds it", async () => {
        const shared = "space-usage-shared-attachment-".repeat(100);
        // A live note whose body is that very content, so both end up on one deduplicated blob.
        await createTextNote(api, { title: "Space usage shared body", content: shared });
        const host = await createTextNote(api, { title: "Space usage shared host", content: "<p>host</p>" });

        const createRes = await api.post(`/api/notes/${host.noteId}/attachments`, {
            body: { role: "file", mime: "text/plain", title: "Space usage shared attachment", content: shared }
        });
        expect(createRes.status).toBe(204);

        const before = await getOverview({ limit: 1 });
        const saveRes = await api.put(`/api/notes/${host.noteId}/data`, {
            body: { content: "<p>host, edited</p>" }
        });
        expect(saveRes.status).toBe(204);

        const { unusedAttachments } = await getOverview({ limit: 1 });
        // One more attachment to erase, yet erasing it would free nothing at all: the blob it holds
        // is the live note's body too.
        expect(unusedAttachments.attachmentCount).toBe(before.unusedAttachments.attachmentCount + 1);
        expect(unusedAttachments.size).toBe(before.unusedAttachments.size);
    });

    describe("the reclaimable-history estimate", () => {
        /**
         * A note whose snapshots hold the given contents, oldest first, with a final body none of
         * them shares — so every snapshot holds a blob of its own that only it keeps alive. Their
         * creation times are spaced a day apart: trimming takes the oldest first, and snapshots
         * saved within the same millisecond would leave that order up to the database.
         */
        async function createNoteWithSnapshots(title: string, snapshots: { content: string, name?: string }[]) {
            const { noteId } = await createTextNote(api, { title, content: snapshots[0].content });

            for (const [ index, { content, name } ] of snapshots.entries()) {
                if (index > 0) {
                    const update = await api.put(`/api/notes/${noteId}/data`, { body: { content } });
                    expect(update.status).toBe(204);
                }

                const saved = await api.post<{ revisionId: string }>(`/api/notes/${noteId}/revision`, {
                    body: { description: name }
                });
                expect(saved.status).toBe(200);

                getSql().execute("UPDATE revisions SET utcDateCreated = ? WHERE revisionId = ?", [
                    `2026-03-${String(index + 1).padStart(2, "0")} 00:00:00.000Z`,
                    saved.body.revisionId
                ]);
            }

            // Leaves the live body sharing nothing with the history, and confirms no extra snapshot
            // slipped in along the way — the figures below are exact, not approximate.
            const update = await api.put(`/api/notes/${noteId}/data`, { body: { content: `<p>${title} now</p>` } });
            expect(update.status).toBe(204);
            expect(getSql().getValue<number>(
                "SELECT COUNT(*) FROM revisions WHERE noteId = ?", [ noteId ])).toBe(snapshots.length);

            return noteId;
        }

        // Content is deduplicated database-wide, so every fixture below needs a filler of its own:
        // sharing one would leave the notes holding a single blob that no one of them can free.
        const bodyOf = (filler: string, length: number) => `<p>${filler.repeat(length)}</p>`;

        it("counts only the snapshots the given limit would actually erase", async () => {
            const [ OLDEST, MIDDLE, NEWEST ] =
                [ bodyOf("la", 1100), bodyOf("lb", 1200), bodyOf("lc", 1300) ];
            const noteId = await createNoteWithSnapshots("Estimate limited",
                [ { content: OLDEST }, { content: MIDDLE }, { content: NEWEST } ]);
            const sizeOf = async (query: Record<string, string | number>) =>
                (await getNoteUsage(noteId, query)).subtreeRevisionsContentSize;

            // No options: the whole history, exactly as before they existed.
            expect((await getNoteUsage(noteId)).subtreeRevisionsContentSize)
                .toBe(OLDEST.length + MIDDLE.length + NEWEST.length);
            expect(await sizeOf({ snapshotsToKeep: 0 })).toBe(OLDEST.length + MIDDLE.length + NEWEST.length);

            // Keeping the newest snapshots takes their weight out of the estimate, oldest first.
            expect(await sizeOf({ snapshotsToKeep: 1 })).toBe(OLDEST.length + MIDDLE.length);
            expect(await sizeOf({ snapshotsToKeep: 2 })).toBe(OLDEST.length);
            expect(await sizeOf({ snapshotsToKeep: 3 })).toBe(0);
            // More room than there are snapshots, and the limit that spares every one of them.
            expect(await sizeOf({ snapshotsToKeep: 99 })).toBe(0);
            expect(await sizeOf({ snapshotsToKeep: -1 })).toBe(0);
        });

        it("leaves named snapshots out of both the estimate and the count when they are spared", async () => {
            const [ OLDEST, NAMED, NEWEST ] =
                [ bodyOf("na", 1100), bodyOf("nb", 1200), bodyOf("nc", 1300) ];
            const noteId = await createNoteWithSnapshots("Estimate named",
                [ { content: OLDEST }, { content: NAMED, name: "release" }, { content: NEWEST } ]);
            const sizeOf = async (query: Record<string, string | number | boolean>) =>
                (await getNoteUsage(noteId, query)).subtreeRevisionsContentSize;

            // Spared, the named snapshot's weight is never on offer...
            expect(await sizeOf({ keepNamedSnapshots: true })).toBe(OLDEST.length + NEWEST.length);
            // ...and it does not eat into the allowance either: keeping one still keeps the newest
            // automatic snapshot, leaving only the oldest to go.
            expect(await sizeOf({ snapshotsToKeep: 1, keepNamedSnapshots: true })).toBe(OLDEST.length);
            // Not spared, it is weighed and counted like any other snapshot.
            expect(await sizeOf({ snapshotsToKeep: 1 })).toBe(OLDEST.length + NAMED.length);
        });

        it("promises nothing back for content a surviving snapshot still holds", async () => {
            const SHARED = bodyOf("sa", 1400);
            // Both snapshots were taken of the same body, so they share the one blob.
            const noteId = await createNoteWithSnapshots("Estimate shared",
                [ { content: SHARED }, { content: SHARED } ]);

            // Erasing both frees that blob once — never twice, for all that two rows point at it.
            expect((await getNoteUsage(noteId)).subtreeRevisionsContentSize).toBe(SHARED.length);
            // Erasing one frees nothing at all: the survivor still holds the very same content.
            expect((await getNoteUsage(noteId, { snapshotsToKeep: 1 })).subtreeRevisionsContentSize).toBe(0);

            // Nor does a snapshot of another note let go of it — content is deduplicated across the
            // whole database, so erasing this note's entire history now frees nothing either.
            await createNoteWithSnapshots("Estimate shared elsewhere", [ { content: SHARED } ]);
            expect((await getNoteUsage(noteId)).subtreeRevisionsContentSize).toBe(0);
        });

        it("400s on an estimate it cannot make, rather than quoting the whole history instead", async () => {
            for (const query of [
                { snapshotsToKeep: -2 },
                { snapshotsToKeep: 1.5 },
                { snapshotsToKeep: "many" },
                { snapshotsToKeep: "" },
                { keepNamedSnapshots: "of course" }
            ]) {
                const res = await api.get(`/api/space-usage/note/${parent.noteId}`, { query });
                expect(res.status).toBe(400);
            }
        });
    });

    it("defaults and clamps the overview limit", async () => {
        // No limit → the server default applies and the request just works.
        const defaulted = await getOverview();
        expect(defaulted.notes.length).toBeGreaterThan(0);

        // Below the floor → clamped up to a single note, not zero.
        const floored = await getOverview({ limit: 0 });
        expect(floored.notes.length).toBe(1);

        // Absurdly high and non-numeric values are tolerated too.
        const ceiled = await getOverview({ limit: 999999 });
        expect(ceiled.notes.length).toBeGreaterThan(0);
        const garbage = await getOverview({ limit: "abc" });
        expect(garbage.notes.length).toBeGreaterThan(0);
    });

    describe("recording a finished cleanup", () => {
        afterEach(() => vi.restoreAllMocks());

        it("logs what was reclaimed, in the log's own words", async () => {
            const logged = vi.spyOn(getLog(), "info");

            const res = await api.post("/api/space-usage/cleanup-completed", {
                body: { reclaimedBytes: 2 * 1024 * 1024 }
            });
            expect([ 200, 204 ]).toContain(res.status);
            expect(logged).toHaveBeenCalledWith("Clean Up Tool: reclaimed 2 MiB.");
        });

        it("400s on a figure it cannot have measured, writing nothing", async () => {
            const logged = vi.spyOn(getLog(), "info");

            for (const body of [ {}, { reclaimedBytes: -1 }, { reclaimedBytes: "lots" } ]) {
                const res = await api.post("/api/space-usage/cleanup-completed", { body });
                expect(res.status).toBe(400);
            }

            expect(logged).not.toHaveBeenCalled();
        });
    });

    it("404s for a missing note", async () => {
        const res = await api.get("/api/space-usage/note/spaceUsageMissing");
        expect(res.status).toBe(404);
    });
});
