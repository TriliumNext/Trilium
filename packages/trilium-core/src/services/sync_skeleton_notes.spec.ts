import type { EntityChange, EntityChangeRecord, EntityRow, NoteRow } from "@triliumnext/commons";
import type { Request } from "express";
import { beforeAll, describe, expect, it } from "vitest";

import becca from "../becca/becca.js";
import "../becca/becca_loader.js";
import treeRoute from "../routes/api/tree.js";
import * as cls from "./context.js";
import { initMessaging } from "./messaging/index.js";
import { getSql } from "./sql/index.js";
import syncUpdateService from "./sync_update.js";
import dateUtils from "./utils/date.js";
import { randomString } from "./utils/index.js";
import ws from "./ws.js";

/**
 * Entities arrive from a sync partner in entity-change-id order, so a branch (or an attribute) can
 * be applied before the `notes` row it points at. becca covers that by materialising a "skeleton"
 * `BNote` carrying nothing but a noteId (see `BBranch.childNote` / `BAttribute.init`), meant to be
 * filled in once the real row shows up.
 *
 * Until it is, that skeleton is a fully typed `BNote` whose `mime`, `type` and `title` are all
 * `undefined`, and the two frontend-facing payloads (the ws frontend-update and the tree API) copy
 * it out verbatim. `JSON.stringify` then drops the undefined values, so the client receives a note
 * row with no `mime` key at all and cannot tell it apart from a complete one.
 *
 * Consumers are therefore the ones that have to hold: `isStringNote()` treats an unknown mime as
 * binary and `FNote.update()` defaults it to `""`, so the predicates degrade instead of throwing
 * `Cannot read properties of undefined (reading 'startsWith')`. These tests pin both the leak (so
 * it is not mistaken for correct behaviour) and the guards that make it survivable.
 */
describe("sync: skeleton notes created by out-of-order entities", () => {
    beforeAll(() => {
        initMessaging(fakeMessagingProvider);
        ws.init();
    });

    it("keeps becca's note predicates working on a branch synced ahead of its note", () => {
        const { noteId } = syncBranchAheadOfItsNote();

        const skeleton = becca.getNoteOrThrow(noteId);
        // mime/type/title are all unknown at this point; predicates must degrade, not throw.
        expect(() => skeleton.hasStringContent()).not.toThrow();
        expect(skeleton.hasStringContent()).toBe(false);
        expect(skeleton.isJavaScript()).toBe(false);
        expect(skeleton.getScriptEnv()).toBeNull();
    });

    it("ships the skeleton in the ws frontend-update as a row whose mime key is dropped entirely", () => {
        const { noteId } = syncBranchAheadOfItsNote();
        // Any transaction that queues an entity change for that noteId before the note row arrives
        // broadcasts whatever becca holds - `fillInAdditionalProperties` reads becca first.
        const entityChangeId = insertNoteEntityChange(noteId);

        const message = cls.init(() => {
            cls.set("entityChangeIds", [entityChangeId]);
            ws.sendTransactionEntityChangesToAllClients();
            return sentMessages[sentMessages.length - 1];
        });

        if (message.type !== "frontend-update") throw new Error("expected a frontend-update message");
        const change = message.data.entityChanges.find((ec) => ec.entityName === "notes" && ec.entityId === noteId);

        // Known leak: the payload goes out half-filled. Serialisation is what makes it undetectable
        // client-side - the row is not `{ mime: undefined }`, the key is simply not there.
        expect(change?.entity).toBeTruthy();
        const serialized = JSON.parse(JSON.stringify(change?.entity));
        expect(serialized.noteId).toBe(noteId);
        expect("mime" in serialized).toBe(false);
        expect("title" in serialized).toBe(false);
    });

    it("serves the skeleton from the tree API as a row whose mime key is dropped entirely", () => {
        const { noteId } = syncBranchAheadOfItsNote();

        // froca does exactly this when a synced branch references a note it doesn't have yet - so
        // this is the row `FNote.update()` has to survive.
        const response = treeRoute.load({ body: { noteIds: [noteId] } } as Request);
        const noteRow = response.notes.find((note: NoteRow) => note.noteId === noteId);

        expect(noteRow).toBeTruthy();
        const serialized = JSON.parse(JSON.stringify(noteRow));
        expect(serialized.noteId).toBe(noteId);
        expect("mime" in serialized).toBe(false);
        expect("title" in serialized).toBe(false);
    });

    it("fills the skeleton in once the note row arrives in a later batch", () => {
        const { noteId } = syncBranchAheadOfItsNote();

        applySync([{ entityChange: buildEC({ entityName: "notes", entityId: noteId }), entity: remoteNoteRow(noteId) }]);

        const filled = becca.getNoteOrThrow(noteId);
        expect(filled.mime).toBe("application/javascript;env=backend");
        expect(filled.hasStringContent()).toBe(true);

        // And now it is servable.
        const response = treeRoute.load({ body: { noteIds: [noteId] } } as Request);
        expect(response.notes.find((note: NoteRow) => note.noteId === noteId)?.mime).toBe("application/javascript;env=backend");
    });
});

const REMOTE_INSTANCE_ID = "skeletonSpecRemote";

const sentMessages: any[] = [];

const fakeMessagingProvider = {
    sendMessageToAllClients: (message: any) => void sentMessages.push(message),
    sendMessageToClient: () => true,
    setClientMessageHandler: () => {}
};

let counter = 0;

/** Applies a sync batch containing only a branch, whose child note is not in becca yet. */
function syncBranchAheadOfItsNote() {
    counter++;
    const noteId = `skelSpecNote${counter}`;
    const branchId = `skelSpecBranch${counter}`;

    expect(becca.getNote(noteId)).toBeNull();
    applySync([{ entityChange: buildEC({ entityName: "branches", entityId: branchId }), entity: remoteBranchRow(branchId, noteId) }]);

    return { noteId, branchId };
}

function applySync(records: EntityChangeRecord[]) {
    return cls.init(() => syncUpdateService.updateEntities(records, REMOTE_INSTANCE_ID));
}

function buildEC(overrides: Partial<EntityChange>): EntityChange {
    return {
        entityName: "notes",
        entityId: "x",
        hash: `remote-hash-${randomString(6)}`,
        isErased: false,
        isSynced: true,
        changeId: randomString(12),
        utcDateChanged: "2099-01-01 00:00:00.000Z",
        ...overrides
    } as EntityChange;
}

function remoteBranchRow(branchId: string, noteId: string): EntityRow {
    const now = dateUtils.utcNowDateTime();

    return {
        branchId,
        noteId,
        parentNoteId: "root",
        notePosition: 10,
        prefix: null,
        isExpanded: 0,
        isDeleted: 0,
        utcDateModified: now
    } as unknown as EntityRow;
}

function remoteNoteRow(noteId: string): EntityRow {
    const now = dateUtils.utcNowDateTime();

    return {
        noteId,
        title: "arrived late",
        isProtected: 0,
        type: "code",
        mime: "application/javascript;env=backend",
        blobId: null,
        isDeleted: 0,
        dateCreated: now,
        dateModified: now,
        utcDateCreated: now,
        utcDateModified: now
    } as unknown as EntityRow;
}

function insertNoteEntityChange(noteId: string): number {
    return cls.init(() => {
        getSql().execute(
            /*sql*/`INSERT INTO entity_changes (entityName, entityId, hash, isErased, changeId, componentId, instanceId, isSynced, utcDateChanged)
                    VALUES ('notes', ?, 'hash', 0, ?, 'NA', ?, 1, ?)`,
            [noteId, randomString(12), REMOTE_INSTANCE_ID, dateUtils.utcNowDateTime()]
        );

        return getSql().getValue<number>("SELECT last_insert_rowid()") ?? 0;
    });
}
