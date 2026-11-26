/**
 * @module
 *
 * Instances that sync inside one process, for specs. Each instance is a copy of the database of the
 * spec. Running code on an instance swaps its database in, reloads becca and sets the fake clock to
 * the instance's time. Pushes and pulls go through `updateEntities()` as `sync.ts` and the sync
 * routes drive it, with cursors that skip the changes an instance received from the other side.
 */
import type { EntityChange } from "@triliumnext/commons";
import { vi } from "vitest";

import becca_loader from "../becca/becca_loader.js";
import * as cls from "../services/context.js";
import entityChangesService from "../services/entity_changes.js";
import { getSql } from "../services/sql/index.js";
import syncService from "../services/sync.js";
import syncUpdateService from "../services/sync_update.js";

export interface SyncInstance {
    readonly name: string;
    database: Uint8Array;
    clockOffsetMs: number;
    lastSyncedPush: number;
    lastSyncedPull: number;
}

export interface TransferOptions {
    /** The number of entity changes per request. */
    batchSize?: number;
    /** Stops after this many requests, as a sync that is interrupted does. */
    maxBatches?: number;
}

/** The most rounds of `settle()`. A spec then finds the instances apart. */
const MAX_ROUNDS = 10;

export default class SyncInstances {

    readonly server: SyncInstance;
    private readonly original: Uint8Array;
    private readonly originalMaxId: number;
    private active: SyncInstance | null = null;
    private timeMs: number;

    /** Starts the fake clock at `startMs` and makes the sync server. */
    constructor(startMs: number) {
        vi.useFakeTimers({ toFake: [ "Date" ] });
        this.timeMs = startMs;
        this.original = getSql().serialize();
        this.originalMaxId = getMaxEntityChangeId();
        this.server = this.create("server");
    }

    /** A new instance: a copy of the database of the spec, with nothing to push or pull. */
    create(name: string): SyncInstance {
        return {
            name,
            database: this.original,
            clockOffsetMs: 0,
            lastSyncedPush: this.originalMaxId,
            lastSyncedPull: this.originalMaxId
        };
    }

    /** Runs `fn` on the instance, in a CLS context, at the instance's time. */
    run<T>(instance: SyncInstance, fn: () => T): T {
        if (this.active !== instance) {
            if (this.active) {
                this.active.database = getSql().serialize();
            }
            getSql().rebuildFromBuffer(instance.database);
            this.active = instance;
            cls.init(() => becca_loader.load());
            entityChangesService.recalculateMaxEntityChangeId();
        }

        vi.setSystemTime(this.timeMs + instance.clockOffsetMs);
        return cls.init(fn);
    }

    advance(ms: number) {
        this.timeMs += ms;
    }

    /** Pushes the changes of a client to the server, and returns the number of records sent. */
    push(client: SyncInstance, options: TransferOptions = {}) {
        return this.transfer(client, this.server, "lastSyncedPush", options);
    }

    /** Pulls the changes of the server to a client, and returns the number of records sent. */
    pull(client: SyncInstance, options: TransferOptions = {}) {
        return this.transfer(this.server, client, "lastSyncedPull", options);
    }

    /** One sync run of a client: the login, a push, a pull and a push again. */
    sync(client: SyncInstance) {
        // At login, a client lowers a pull cursor beyond the server's newest change to it.
        client.lastSyncedPull = Math.min(client.lastSyncedPull,
            this.run(this.server, getMaxEntityChangeId));
        return this.push(client) + this.pull(client) + this.push(client);
    }

    /** Syncs every client, round after round, until a round sends nothing. */
    settle(clients: SyncInstance[]) {
        let isMoving = true;
        for (let round = 0; round < MAX_ROUNDS && isMoving; round++) {
            isMoving = clients.reduce((sent, client) => sent + this.sync(client), 0) > 0;
        }
    }

    /** Puts the database of the spec back and stops the fake clock. */
    dispose() {
        getSql().rebuildFromBuffer(this.original);
        this.active = null;
        cls.init(() => becca_loader.load());
        entityChangesService.recalculateMaxEntityChangeId();
        vi.useRealTimers();
    }

    /**
     * Sends the entity changes of `from` after the cursor, except those it received from `to`.
     * Local changes have the instance ID of the process, received ones the sender's name.
     */
    private transfer(
        from: SyncInstance,
        to: SyncInstance,
        cursor: "lastSyncedPush" | "lastSyncedPull",
        { batchSize = 1000, maxBatches = Infinity }: TransferOptions
    ) {
        const client = from === this.server ? to : from;
        let sent = 0;
        for (let batch = 0; batch < maxBatches; batch++) {
            const records = this.run(from, () => {
                const changes = getSql().getRows<EntityChange>(/*sql*/`SELECT * FROM entity_changes
                    WHERE isSynced = 1 AND id > ? ORDER BY id LIMIT ?`,
                [ client[cursor], batchSize ]);
                const lastId = changes.at(-1)?.id;
                if (lastId) {
                    client[cursor] = lastId;
                }
                return lastId
                    ? syncService.getEntityChangeRecords(
                        changes.filter((change) => change.instanceId !== to.name))
                    : null;
            });
            if (!records) {
                break;
            }

            this.run(to, () => getSql().transactional(() =>
                syncUpdateService.updateEntities(records, from.name)));
            sent += records.length;
        }
        return sent;
    }

}

function getMaxEntityChangeId() {
    return getSql().getValue<number>("SELECT COALESCE(MAX(id), 0) FROM entity_changes");
}
