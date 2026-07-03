import type { WebSocketMessage } from "@triliumnext/commons";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { getBecca } from "../becca/becca.js";
import * as cls from "./context.js";
import { initMessaging } from "./messaging/index.js";
import type { ClientMessageHandler } from "./messaging/types.js";
import protectedSessionService from "./protected_session.js";
import { getSql } from "./sql/index.js";
import dateUtils from "./utils/date.js";
import { randomString } from "./utils/index.js";
import ws from "./ws.js";

const sentAll: WebSocketMessage[] = [];
const sentToClient: Array<{ clientId: string; message: WebSocketMessage }> = [];
let clientHandler: ClientMessageHandler | undefined;

const fakeProvider = {
    sendMessageToAllClients: vi.fn((message: WebSocketMessage) => {
        sentAll.push(message);
    }),
    sendMessageToClient: vi.fn((clientId: string, message: WebSocketMessage) => {
        sentToClient.push({ clientId, message });
        return true;
    }),
    setClientMessageHandler: vi.fn((handler: ClientMessageHandler) => {
        clientHandler = handler;
    })
};

function insertEntityChange(entityName: string, entityId: string, isErased = 0): number {
    return cls.init(() => {
        getSql().execute(
            `INSERT INTO entity_changes (entityName, entityId, hash, isErased, changeId, componentId, instanceId, isSynced, utcDateChanged)
             VALUES (?, ?, 'hash', ?, ?, 'NA', 'inst', 1, ?)`,
            [entityName, entityId, isErased, randomString(12), dateUtils.utcNowDateTime()]
        );
        return getSql().getValue<number>("SELECT last_insert_rowid()") ?? 0;
    });
}

function existingEntityChangeId(entityName: string, entityId: string): number {
    const id = getSql().getValue<number>(
        "SELECT id FROM entity_changes WHERE entityName = ? AND entityId = ?",
        [entityName, entityId]
    );
    if (id == null) throw new Error(`no entity_change for ${entityName}/${entityId}`);
    return id;
}

// All entity-change ids we drive through buildFrontendUpdateMessage.
const ecIds: number[] = [];

describe("ws service (real DB)", () => {
    beforeAll(() => {
        const now = dateUtils.utcNowDateTime();
        const blobId = getSql().getValue<string>("SELECT blobId FROM blobs LIMIT 1");

        cls.init(() => {
            // Protected + plain note rows that becca does not know about (inserted via raw SQL).
            getSql().execute(
                `INSERT INTO notes (noteId, title, isProtected, type, mime, isDeleted, dateCreated, dateModified, utcDateCreated, utcDateModified)
                 VALUES ('wsProtNote', 'secret', 1, 'text', 'text/html', 0, ?, ?, ?, ?)`,
                [now, now, now, now]
            );
            getSql().execute(
                `INSERT INTO notes (noteId, title, isProtected, type, mime, isDeleted, dateCreated, dateModified, utcDateCreated, utcDateModified)
                 VALUES ('wsPlainNote', 'plain', 0, 'text', 'text/html', 0, ?, ?, ?, ?)`,
                [now, now, now, now]
            );
            // Attachments need a matching blob for the JOIN to return a row. They are
            // marked deleted so getBecca().getAttachment() (which filters isDeleted=0) misses
            // them, forcing the DB-fallback path in fillInAdditionalProperties (whose
            // query has no isDeleted filter).
            getSql().execute(
                `INSERT INTO attachments (attachmentId, ownerId, role, mime, title, isProtected, position, blobId, dateModified, utcDateModified, isDeleted)
                 VALUES ('wsProtAtt', 'root', 'file', 'text/plain', 'secret', 1, 0, ?, ?, ?, 1)`,
                [blobId, now, now]
            );
            getSql().execute(
                `INSERT INTO attachments (attachmentId, ownerId, role, mime, title, isProtected, position, blobId, dateModified, utcDateModified, isDeleted)
                 VALUES ('wsPlainAtt', 'root', 'file', 'text/plain', 'plain', 0, 0, ?, ?, ?, 1)`,
                [blobId, now, now]
            );
        });

        // becca-hit changes (reuse the existing fixture rows).
        const branchId = getBecca().getNote("root")?.getChildBranches()[0]?.branchId ?? "root_root";
        const attrEC = getSql().getRow<{ id: number; entityId: string }>(
            `SELECT ec.id, ec.entityId FROM entity_changes ec
             JOIN attributes a ON a.attributeId = ec.entityId
             WHERE ec.entityName = 'attributes' AND a.isDeleted = 0 LIMIT 1`
        );

        ecIds.push(
            existingEntityChangeId("notes", "root"), // becca-hit note
            existingEntityChangeId("branches", branchId), // becca-hit branch
            existingEntityChangeId("options", "theme"), // becca-hit option
            attrEC.id, // becca-hit attribute
            insertEntityChange("notes", "wsProtNote"), // miss -> protected note row
            insertEntityChange("notes", "wsPlainNote"), // miss -> plain note row
            insertEntityChange("notes", "wsMissingNote"), // miss -> no row
            insertEntityChange("branches", "wsFakeBranch"), // miss
            insertEntityChange("attributes", "wsFakeAttr"), // miss
            insertEntityChange("options", "wsFakeOption"), // miss
            insertEntityChange("attachments", "wsProtAtt"), // miss -> protected attachment row
            insertEntityChange("attachments", "wsPlainAtt"), // miss -> plain attachment row
            insertEntityChange("revisions", "wsRev"), // revisions: only sets noteId
            existingEntityChangeId("note_reordering", "root"), // becca-hit parent with children
            insertEntityChange("note_reordering", "wsFakeParent"), // miss parent
            insertEntityChange("notes", "wsErasedNote", 1) // erased -> early return in fillIn
        );
    });

    afterEach(() => vi.restoreAllMocks());

    it("broadcasts are no-ops before init() wires a provider", () => {
        const lengthBefore = sentAll.length;
        ws.syncFinished();
        cls.init(() => ws.sendTransactionEntityChangesToAllClients());
        expect(sentAll.length).toBe(lengthBefore);
    });

    it("init() registers a client message handler routing each message type", async () => {
        initMessaging(fakeProvider);
        ws.init();
        expect(fakeProvider.setClientMessageHandler).toHaveBeenCalled();
        expect(clientHandler).toBeTypeOf("function");

        const handler = clientHandler;
        if (!handler) throw new Error("handler not registered");

        await handler("client-1", { type: "log-error", error: "e", stack: "s" });
        await handler("client-1", { type: "log-info", info: "i" });
        await handler("client-1", { type: "ping" });
        await handler("client-1", { type: "totally-unknown" });

        expect(sentToClient).toContainEqual({ clientId: "client-1", message: { type: "ping" } });
    });

    it("sync status helpers broadcast the matching message types with lastSyncedPush", () => {
        ws.setLastSyncedPush(42);
        ws.syncPushInProgress();
        ws.syncPullInProgress();
        ws.syncFinished();
        ws.syncFailed();
        ws.reloadFrontend("because");

        const types = sentAll.map((m) => m.type);
        expect(types).toEqual(expect.arrayContaining([
            "sync-push-in-progress",
            "sync-pull-in-progress",
            "sync-finished",
            "sync-failed",
            "reload-frontend"
        ]));
        const pull = sentAll.find((m) => m.type === "sync-pull-in-progress");
        expect(pull).toMatchObject({ lastSyncedPush: 42 });
    });

    it("sends a ping frontend-update when there are no pending entity changes", () => {
        const before = sentAll.length;
        cls.init(() => ws.sendTransactionEntityChangesToAllClients());
        expect(sentAll[sentAll.length - 1]).toEqual({ type: "ping" });
        expect(sentAll.length).toBe(before + 1);
    });

    it("builds a frontend-update message filling in properties for every entity type", () => {
        cls.init(() => {
            cls.set("entityChangeIds", [...ecIds]);
            ws.sendTransactionEntityChangesToAllClients();
        });

        const message = sentAll[sentAll.length - 1];
        expect(message.type).toBe("frontend-update");
        if (message.type !== "frontend-update") throw new Error("expected frontend-update");

        const changes = message.data.entityChanges;
        // Every entity type should have been processed.
        const byName = new Map<string, unknown>();
        for (const c of changes) byName.set(c.entityName, c);
        expect(byName.has("notes")).toBe(true);
        expect(byName.has("branches")).toBe(true);
        expect(byName.has("attributes")).toBe(true);
        expect(byName.has("options")).toBe(true);
        expect(byName.has("attachments")).toBe(true);
        expect(byName.has("note_reordering")).toBe(true);

        // becca-hit note got its full pojo (title present).
        const rootChange = changes.find((c) => c.entityName === "notes" && c.entityId === "root");
        expect(rootChange?.entity).toMatchObject({ noteId: "root" });

        // note_reordering for root carries the child branch positions map.
        const reorder = changes.find((c) => c.entityName === "note_reordering" && c.entityId === "root");
        expect(reorder?.positions).toBeTypeOf("object");
    });

    it("swallows errors thrown while filling in a single entity change", () => {
        vi.spyOn(protectedSessionService, "decryptString").mockImplementation(() => {
            throw new Error("decrypt failed");
        });
        const protId = existingEntityChangeId("notes", "wsProtNote");

        const before = sentAll.length;
        expect(() =>
            cls.init(() => {
                cls.set("entityChangeIds", [protId]);
                ws.sendTransactionEntityChangesToAllClients();
            })
        ).not.toThrow();
        // The message is still sent despite the per-entity error.
        expect(sentAll.length).toBe(before + 1);
    });

    it("does not send when the entity changes query yields no rows", () => {
        const sql = getSql();
        vi.spyOn(sql, "getManyRows").mockReturnValueOnce(undefined as never);

        const before = sentAll.length;
        cls.init(() => {
            cls.set("entityChangeIds", [ecIds[0]]);
            ws.sendTransactionEntityChangesToAllClients();
        });
        expect(sentAll.length).toBe(before);
    });
});
