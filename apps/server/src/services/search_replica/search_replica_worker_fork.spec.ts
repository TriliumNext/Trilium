import {
    becca,
    becca_loader,
    branches,
    cls,
    events,
    getLog,
    getSql,
    inProcessSearchExecutor,
    note_service,
    options,
    password_encryption,
    runSearchQuery,
    type SearchQueryArgs,
    type SearchQueryKind,
    setBeccaReplicaSink,
    tree,
    ws
} from "@triliumnext/core";
import protectedSessionService from "@triliumnext/core/src/services/protected_session.js";
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createReplicaSearchExecutor, type ReplicaSearchExecutor } from "./replica_client.js";

/**
 * The real replica process against a real database file, checked query by query against the same
 * queries run in this process on the same file, before and after the writes it is fed.
 *
 * This process stands in for the main one: core is attached to a WAL copy of the fixture, and its
 * commits reach the replica through the genuine feed (`ws.sendTransactionEntityChangesToAllClients()`
 * → `BeccaReplicaSink`).
 */
const PROTECTED_NOTE_ID = "uOCKdcqOhDF5";
const WORKSPACES_NOTE_ID = "OSHZj7srpbdn";
const SHARED_NOTES_ID = "y0AFOwgOgkWO";

let dataDir: string;
let replica: ReplicaSearchExecutor;
let previousNodeOptions: string | undefined;
let savedSearchNoteId: string | undefined;
const replicaErrors: string[] = [];

beforeAll(async () => {
    previousNodeOptions = process.env.NODE_OPTIONS;
    process.env.NODE_OPTIONS = [ previousNodeOptions, "--import tsx" ].filter(Boolean).join(" ");

    dataDir = mkdtempSync(join(tmpdir(), "trilium-replica-"));
    const documentPath = join(dataDir, "document.db");
    // The fixture as this process holds it, i.e. already migrated: the replica refuses a database
    // at another version than the build's.
    await getSql().copyDatabase(documentPath);

    const integrationTest = process.env.TRILIUM_INTEGRATION_TEST;
    delete process.env.TRILIUM_INTEGRATION_TEST;
    getSql().attachFromFile(documentPath, false);
    process.env.TRILIUM_INTEGRATION_TEST = integrationTest;
    cls.init(() => becca_loader.load());

    const log = getLog();
    const logError = log.error.bind(log);
    vi.spyOn(log, "error").mockImplementation((message: unknown) => {
        replicaErrors.push(String(message));
        logError(message);
    });

    replica = createReplicaSearchExecutor({ enabled: true, documentPath, totalMemoryBytes: 8 * 1024 ** 3 });
    setBeccaReplicaSink(replica);
    replica.start();
    await vi.waitFor(() => expect(replica.state).toBe("ready"), { timeout: 60000, interval: 50 });
}, 90000);

afterAll(() => {
    setBeccaReplicaSink(null);
    replica?.shutdown();
    vi.restoreAllMocks();

    if (previousNodeOptions === undefined) {
        delete process.env.NODE_OPTIONS;
    } else {
        process.env.NODE_OPTIONS = previousNodeOptions;
    }

    rmSync(dataDir, { recursive: true, force: true });
});

describe("search replica against a real database", () => {
    it("answers every query exactly as this process does, and writes nothing", { timeout: 60000 }, async () => {
        const before = databaseChecksum();

        await expectSameResults(battery());
        await expectSameResults(protectedTitleQueries());

        expect(databaseChecksum()).toBe(before);
        expect(replica.state).toBe("ready");
    });

    it("follows renames, labels, moves, reorders, deletions, options and saved searches", { timeout: 60000 }, async () => {
        const renamed = becca.getNoteOrThrow("bKMn5EFv9KS2");
        const created = commit(() => {
            renamed.title = "Zebracorn child";
            renamed.save();
            becca.getNoteOrThrow("xdJlUUmPXht0").setLabel("replicaLabel", "lemon");
            const search = note_service.createNewNote({
                parentNoteId: "root",
                title: "Saved replica search",
                type: "search",
                mime: "application/json",
                content: ""
            }).note;
            search.setLabel("searchString", "note");
            return search.noteId;
        });
        savedSearchNoteId = created;

        await expectSameResults([
            [ "quickSearch", { hoistedNoteId: "root", searchString: "zebracorn" } ],
            [ "search", { hoistedNoteId: "root", searchString: "#replicaLabel=lemon" } ],
            ...battery()
        ]);
        expect(runSearchQuery("search", { hoistedNoteId: "root", searchString: "zebracorn" })).toContain("bKMn5EFv9KS2");

        commit(() => {
            const branch = becca.getNoteOrThrow("v8ZW4gPAK7Yp").getParentBranches()[0];
            branches.moveBranchToNote(branch, SHARED_NOTES_ID);
            tree.sortNotes(WORKSPACES_NOTE_ID, "title", true);
            becca.getNoteOrThrow("RfrzQxuVmz8a").deleteNote();
            becca.getNoteOrThrow("xdJlUUmPXht0").getLabel("replicaLabel")?.markAsDeleted();
            options.setOption("searchEnableFuzzyMatching", "false");
        });

        const afterWrites = databaseChecksum();
        await expectSameResults([
            [ "search", { hoistedNoteId: "root", searchString: "#replicaLabel" } ],
            [ "search", { hoistedNoteId: "root", searchString: "flowchart" } ],
            [ "search", { hoistedNoteId: "root", searchString: "personal", ancestorNoteId: SHARED_NOTES_ID } ],
            ...battery()
        ]);
        expect(databaseChecksum()).toBe(afterWrites);
    });

    it("loads again on a reload signal and still agrees", { timeout: 60000 }, async () => {
        const quokka: Query = [ "search", { hoistedNoteId: "root", searchString: "quokkaplex" } ];
        cls.init(() => {
            getSql().transactional(() => {
                const note = becca.getNoteOrThrow("00x8w05mCA3i");
                note.title = "Quokkaplex work note";
                note.save();
            });
            // Written as an import does, with nothing fed to the replica.
            cls.getAndClearEntityChangeIds();
        });
        expect(await replica.run(...quokka)).toEqual([]);
        expect(runSearchQuery(...quokka)).toEqual([ "00x8w05mCA3i" ]);

        const before = databaseChecksum();
        replica.onReload();
        await expectSameResults([ quokka, ...battery() ]);
        expect(databaseChecksum()).toBe(before);
    });

    it("searches protected titles only while the protected session is open", { timeout: 60000 }, async () => {
        const dataKey = await password_encryption.getDataKey("demo1234");

        if (!dataKey) {
            throw new Error("the fixture's password did not open the protected session");
        }

        protectedSessionService.setDataKey(dataKey);
        cls.init(() => events.emit(events.ENTER_PROTECTED_SESSION));

        const title = becca.getNoteOrThrow(PROTECTED_NOTE_ID).title;
        expect(becca.getNoteOrThrow(PROTECTED_NOTE_ID).isDecrypted).toBe(true);

        const open = await replica.run("search", { hoistedNoteId: "root", searchString: title });
        expect(open).toContain(PROTECTED_NOTE_ID);
        await expectSameResults([ ...protectedTitleQueries(), ...battery() ]);

        protectedSessionService.resetDataKey();
        cls.init(() => events.emit(events.LEAVE_PROTECTED_SESSION));

        const closed = await replica.run("search", { hoistedNoteId: "root", searchString: title });
        expect(closed).not.toContain(PROTECTED_NOTE_ID);
        await expectSameResults([ ...protectedTitleQueries(), ...battery() ]);
    });

    it("never logged an error and never fell back to this process", () => {
        expect(replicaErrors).toEqual([]);
        expect(replica.state).toBe("ready");
    });
});

type Query = { [K in SearchQueryKind]: [ K, SearchQueryArgs[K] ] }[SearchQueryKind];

/** At least one query of every kind, across the search features the routes reach. */
function battery(): Query[] {
    const root = { hoistedNoteId: "root" };
    const queries: Query[] = [
        [ "quickSearch", { ...root, searchString: "note" } ],
        [ "quickSearch", { ...root, searchString: "1a" } ],
        [ "quickSearch", { ...root, searchString: "flowchrt" } ],
        [ "quickSearch", { ...root, searchString: "#workspace" } ],
        [ "quickSearch", { hoistedNoteId: WORKSPACES_NOTE_ID, searchString: "note" } ],
        [ "quickSearch", { ...root, searchString: "" } ],
        [ "search", { ...root, searchString: "note" } ],
        [ "search", { ...root, searchString: "note", includeTokens: "true" } ],
        [ "search", { ...root, searchString: "#workspace" } ],
        [ "search", { ...root, searchString: "~template" } ],
        [ "search", { ...root, searchString: "note", ancestorNoteId: WORKSPACES_NOTE_ID } ],
        [ "search", { ...root, searchString: "note.title *= 'note' orderBy note.title desc limit 5" } ],
        [ "search", { ...root, searchString: "#iconClass", includeArchivedNotes: "false" } ],
        [ "search", { ...root, searchString: "note.type = code" } ],
        [ "search", { ...root, searchString: "note.parents.title = Workspaces" } ],
        [ "search", { ...root, searchString: "mindmp" } ],
        [ "relatedNotes", { ...root, attribute: { type: "label", name: "workspace" } } ],
        [ "relatedNotes", { ...root, attribute: { type: "label", name: "status", value: "Done" } } ],
        [ "searchFromNote", { ...root, noteId: "root" } ],
        [ "searchResultDetails", { ...root, noteId: "root", body: { noteIds: [] } } ],
        [ "autocomplete", { ...root, query: "note" } ],
        [ "autocomplete", { ...root, query: "1", fastSearch: "true", limit: "5" } ],
        [ "autocomplete", { ...root, query: "work", fastSearch: "false" } ],
        [ "autocomplete", { ...root, query: "", activeNoteId: "root" } ],
        [ "autocomplete", { ...root, query: "", filter: "#workspace" } ],
        [ "autocomplete", { ...root, query: "note", filter: "note.type = text" } ],
        [ "autocomplete", { hoistedNoteId: WORKSPACES_NOTE_ID, query: "" } ],
        [ "autocomplete", { ...root, query: 42 } ]
    ];

    if (savedSearchNoteId) {
        queries.push(
            [ "searchFromNote", { ...root, noteId: savedSearchNoteId } ],
            [ "searchResultDetails", { ...root, noteId: savedSearchNoteId, body: { noteIds: [ "bKMn5EFv9KS2", "xdJlUUmPXht0" ] } } ]
        );
    }

    return queries;
}

function protectedTitleQueries(): Query[] {
    const title = becca.getNoteOrThrow(PROTECTED_NOTE_ID).title;

    return [
        [ "quickSearch", { hoistedNoteId: "root", searchString: title } ],
        [ "search", { hoistedNoteId: "root", searchString: title } ],
        [ "autocomplete", { hoistedNoteId: "root", query: title } ]
    ];
}

/** Runs each query in the replica and here, and expects the same answer, or the same error. */
async function expectSameResults(queries: Query[]) {
    const inProcess = vi.spyOn(inProcessSearchExecutor, "run");

    try {
        for (const [ kind, args ] of queries) {
            const label = `${kind} ${JSON.stringify(args)}`;
            const fromReplica = await settle(() => replica.run(kind, args));
            const local = await settle(async () => runSearchQuery(kind, args, { deferScripts: true }));

            expect(fromReplica, label).toEqual(local);
        }

        expect(inProcess).not.toHaveBeenCalled();
    } finally {
        inProcess.mockRestore();
    }
}

async function settle(run: () => Promise<unknown>) {
    try {
        return { result: await run() };
    } catch (e: unknown) {
        const error = e as Error & { statusCode?: number };
        return { error: { class: error.constructor.name, message: error.message, statusCode: error.statusCode } };
    }
}

/** Commits `mutate` in one transaction and feeds its entity changes to the replica. */
function commit<T>(mutate: () => T): T {
    return cls.init(() => {
        const result = getSql().transactional(mutate);
        ws.sendTransactionEntityChangesToAllClients();
        return result;
    });
}

function databaseChecksum() {
    const db = new Database(join(dataDir, "document.db"), { readonly: true });

    try {
        const hash = createHash("sha256");
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").pluck().all() as string[];

        for (const table of tables) {
            hash.update(table);
            for (const row of db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).iterate()) {
                hash.update(JSON.stringify(row, (_key, value: unknown) =>
                    value instanceof Uint8Array ? Buffer.from(value).toString("base64") : value));
            }
        }

        return hash.digest("hex");
    } finally {
        db.close();
    }
}
