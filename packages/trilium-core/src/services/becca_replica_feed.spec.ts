import type { WebSocketMessage } from "@triliumnext/commons";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import becca_loader from "../becca/becca_loader.js";
import { type BeccaReplicaSink, type EntityChangeRef, setBeccaReplicaSink } from "./becca_replica_feed.js";
import * as cls from "./context.js";
import eventService from "./events.js";
import { initMessaging } from "./messaging/index.js";
import noteService from "./notes.js";
import protectedSession from "./protected_session.js";
import { getSql } from "./sql/index.js";
import type { SqlServiceParams } from "./sql/sql.js";
import ws from "./ws.js";

const sent: WebSocketMessage[] = [];
const fakeProvider = {
    sendMessageToAllClients: (message: WebSocketMessage) => {
        sent.push(message);
    },
    sendMessageToClient: () => true,
    setClientMessageHandler: () => {}
};

interface RecordingSink extends BeccaReplicaSink {
    calls: [ string, unknown ][];
}

describe("becca replica feed", () => {
    let sink: RecordingSink;
    let counter = 0;

    beforeEach(() => {
        sink = {
            calls: [],
            onCommit(changes) { this.calls.push([ "commit", changes ]); },
            onReload() { this.calls.push([ "reload", null ]); },
            onProtectedSession(dataKey) { this.calls.push([ "protectedSession", dataKey ]); }
        };
        setBeccaReplicaSink(sink);
        wireTransactionHooks();
        sent.length = 0;
    });

    afterEach(() => {
        setBeccaReplicaSink(null);
        vi.restoreAllMocks();
    });

    function createNote() {
        counter++;
        return noteService.createNewNote({
            parentNoteId: "root", title: `replica-feed-${counter}`, content: "<p>x</p>", type: "text"
        }).note;
    }

    it("feeds the sink on commit when no client is connected", () => {
        const getManyRows = vi.spyOn(getSql(), "getManyRows");
        const note = cls.init(() => getSql().transactional(() => createNote()));

        expect(getManyRows).toHaveBeenCalledTimes(1);
        expect(sent).toHaveLength(0);
        expect(sink.calls).toHaveLength(1);
        const [ kind, changes ] = sink.calls[0];
        expect(kind).toBe("commit");
        expect(changes).toContainEqual({ entityName: "notes", entityId: note.noteId, isErased: false });
        expect(changes).toContainEqual({ entityName: "branches", entityId: `root_${note.noteId}`, isErased: false });
    });

    it("drains the changes once and sends them to the clients and the sink", () => {
        initMessaging(fakeProvider);
        ws.init();
        const getManyRows = vi.spyOn(getSql(), "getManyRows");

        const note = cls.init(() => getSql().transactional(() => createNote()));

        expect(getManyRows).toHaveBeenCalledTimes(1);
        const changes = sink.calls[0][1] as EntityChangeRef[];
        expect(sink.calls.map(([ kind ]) => kind)).toEqual([ "commit" ]);
        expect(changes).toContainEqual({ entityName: "notes", entityId: note.noteId, isErased: false });

        const update = sent.find((message) => message.type === "frontend-update");
        const sentChanges = (update as { data: { entityChanges: { entityName: string; entityId: string }[] } }).data.entityChanges;
        expect(sentChanges.map(({ entityName, entityId }) => `${entityName}/${entityId}`).sort())
            .toEqual(changes.map(({ entityName, entityId }) => `${entityName}/${entityId}`).sort());

        // Nothing is left over for the next commit.
        cls.init(() => getSql().transactional(() => {}));
        expect(sink.calls).toHaveLength(1);
    });

    it("feeds a nested transaction once, when the outermost one commits", () => {
        cls.init(() => getSql().transactional(() => {
            createNote();
            getSql().transactional(() => createNote());
            expect(sink.calls).toHaveLength(0);
        }));

        expect(sink.calls).toHaveLength(1);
        const notes = (sink.calls[0][1] as EntityChangeRef[]).filter((change) => change.entityName === "notes");
        expect(notes).toHaveLength(2);
    });

    it("feeds no changes for a rollback, and signals the reload that follows", () => {
        expect(() => cls.init(() => getSql().transactional(() => {
            createNote();
            throw new Error("rolled back");
        }))).toThrow("rolled back");

        expect(sink.calls).toEqual([ [ "reload", null ] ]);
    });

    it("holds a reload inside a transaction back until the commit, in place of its changes", () => {
        cls.init(() => getSql().transactional(() => {
            createNote();
            becca_loader.load();
            expect(sink.calls).toHaveLength(0);
        }));

        expect(sink.calls).toEqual([ [ "reload", null ] ]);

        cls.init(() => becca_loader.load());
        expect(sink.calls).toEqual([ [ "reload", null ], [ "reload", null ] ]);
    });

    it("passes the protected session on, standing in for the reload on leaving it", () => {
        const dataKey = new Uint8Array([ 1, 2, 3, 4 ]);
        protectedSession.setDataKey(dataKey);
        eventService.emit(eventService.ENTER_PROTECTED_SESSION);

        protectedSession.resetDataKey();
        eventService.emit(eventService.LEAVE_PROTECTED_SESSION);

        expect(sink.calls).toEqual([ [ "protectedSession", dataKey ], [ "protectedSession", null ] ]);
    });

    it("keeps feeding after a sink throws, and stops once the sink is removed", () => {
        sink.onReload = () => {
            throw new Error("sink broke");
        };
        expect(() => cls.init(() => becca_loader.load())).not.toThrow();

        setBeccaReplicaSink(null);
        cls.init(() => getSql().transactional(() => createNote()));
        cls.init(() => becca_loader.load());
        expect(sink.calls).toEqual([]);
    });
});

/** Wires the commit and rollback hooks the way the server's `core_init.ts` does. */
function wireTransactionHooks() {
    const params = Reflect.get(getSql(), "params") as Omit<SqlServiceParams, "provider">;
    vi.spyOn(params, "onTransactionCommit").mockImplementation(() => ws.sendTransactionEntityChangesToAllClients());
    vi.spyOn(params, "onTransactionRollback").mockImplementation(() => {
        if (cls.getAndClearEntityChangeIds().length > 0) {
            becca_loader.load();
        }
    });
}
