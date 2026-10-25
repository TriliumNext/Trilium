import {
    getLog,
    initSearchExecutor,
    inProcessSearchExecutor,
    runSearchQuery,
    type SearchQueryKind,
    serializeSearchQueryError
} from "@triliumnext/core";
import { HttpError, ValidationError } from "@triliumnext/core/src/errors.js";
import { CoreApiTester } from "@triliumnext/core/src/test/api_tester.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setWorkerSpawner, type WorkerHandle, type WorkerSpawnOptions } from "../workers/worker_host.js";
import {
    createReplicaSearchExecutor, MIN_TOTAL_MEMORY_BYTES, type ReplicaSearchOptions, replicaHeapMb
} from "./replica_client.js";
import type { ReplicaReply, ReplicaRequest } from "./replica_protocol.js";

const h = vi.hoisted(() => ({ searchWorker: true }));

vi.mock("../config.js", () => ({ default: { General: { get searchWorker() { return h.searchWorker; } } } }));

type Listener = (...args: never[]) => void;

class FakeReplica implements WorkerHandle {
    sent: ReplicaRequest[] = [];
    killed = false;
    postError?: Error;
    /** Answers each query the way the replica process would, when set. */
    answerQueries = false;
    private listeners = new Map<string, Listener[]>();

    constructor(readonly pid: number) {}

    postMessage(message: unknown) {
        if (this.postError) {
            throw this.postError;
        }

        const request = structuredClone(message) as ReplicaRequest;
        this.sent.push(request);

        if (this.answerQueries && request.type === "query") {
            queueMicrotask(() => this.emit("message", answer(request)));
        }
    }

    on(event: string, listener: Listener) {
        this.listeners.set(event, [ ...(this.listeners.get(event) ?? []), listener ]);
    }

    emit(event: string, ...args: unknown[]) {
        for (const listener of this.listeners.get(event) ?? []) {
            (listener as (...values: unknown[]) => void)(...args);
        }
    }

    reply(message: ReplicaReply) {
        this.emit("message", message);
    }

    ready() {
        this.reply({ type: "ready", noteCount: 10, heapUsedMb: 20, bootMs: 5 });
    }

    lastQueryId() {
        const query = this.sent.findLast((message) => message.type === "query");

        if (!query || query.type !== "query") {
            throw new Error(`replica ${this.pid} was sent no query`);
        }

        return query.id;
    }

    kill() {
        this.killed = true;
    }

    unref() {}
}

const ROOT = { hoistedNoteId: "root" };
const IN_PROCESS = { searchResultNoteIds: [ "in-process" ] };

let replicas: FakeReplica[];
let spawns: WorkerSpawnOptions[];
let logs: string[];

beforeEach(() => {
    replicas = [];
    spawns = [];
    logs = [];
    h.searchWorker = true;
    setWorkerSpawner((_file, options) => {
        const replica = new FakeReplica(100 + replicas.length);
        replicas.push(replica);
        spawns.push(options);
        return replica;
    });
    const log = getLog();
    vi.spyOn(log, "info").mockImplementation((line) => {
        logs.push(String(line));
    });
    vi.spyOn(log, "error").mockImplementation((line) => {
        logs.push(`ERROR ${String(line)}`);
    });
    vi.spyOn(inProcessSearchExecutor, "run").mockResolvedValue(IN_PROCESS as never);
});

afterEach(() => {
    setWorkerSpawner(null);
    vi.restoreAllMocks();
    vi.useRealTimers();
});

describe("replica search executor", () => {
    it("searches in this process until the replica is ready, then forwards feed and queries in order", async () => {
        const executor = started();
        const [ replica ] = replicas;

        expect(executor.state).toBe("booting");
        await expect(executor.run("quickSearch", { ...ROOT, searchString: "a" })).resolves.toBe(IN_PROCESS);
        expect(replica.sent).toEqual([]);

        replica.ready();
        expect(executor.state).toBe("ready");
        expect(logs.some((line) => line.includes("ready in") && line.includes("10 notes"))).toBe(true);

        const changes = [ { entityName: "notes", entityId: "n1", isErased: false } ];
        executor.onCommit(changes);
        const pending = executor.run("search", { ...ROOT, searchString: "b" });

        expect(replica.sent.map((message) => message.type)).toEqual([ "commit", "query" ]);
        expect(replica.sent[0]).toEqual({ type: "commit", changes });
        expect(replica.sent[1]).toMatchObject({ kind: "search", args: { searchString: "b" } });

        replica.reply({ type: "result", id: replica.lastQueryId(), result: [ "n1" ] });
        await expect(pending).resolves.toEqual([ "n1" ]);
        expect(inProcessSearchExecutor.run).toHaveBeenCalledTimes(1);
    });

    it("sends one reload after the boot when the feed moved during it, then the protected session", () => {
        const idle = createReplicaSearchExecutor(testOptions());
        idle.onCommit([ { entityName: "notes", entityId: "n0", isErased: false } ]);
        idle.start();

        const executor = idle;
        const [ replica ] = replicas;
        const dataKey = new Uint8Array([ 1, 2, 3 ]);

        executor.onCommit([ { entityName: "notes", entityId: "n1", isErased: false } ]);
        executor.onReload();
        executor.onProtectedSession(dataKey);
        expect(replica.sent).toEqual([]);

        replica.ready();
        expect(replica.sent).toEqual([ { type: "reload" }, { type: "protectedSession", dataKey } ]);

        executor.onProtectedSession(null);
        expect(replica.sent.at(-1)).toEqual({ type: "protectedSession", dataKey: null });
    });

    it("sends nothing extra after a quiet boot, and a reload once becca here has loaded again", () => {
        const executor = started();
        replicas[0].ready();

        expect(replicas[0].sent).toEqual([]);
        expect(executor.state).toBe("ready");

        const reloaded = createReplicaSearchExecutor(testOptions());
        reloaded.onReload();
        reloaded.start();
        replicas[1].ready();
        expect(replicas[1].sent).toEqual([ { type: "reload" } ]);
    });

    it("answers a query that times out in this process, and replaces the replica", async () => {
        vi.useFakeTimers();
        const executor = started({ queryTimeoutMs: 1000 });
        replicas[0].ready();

        const pending = executor.run("autocomplete", { ...ROOT, query: "x" });
        await vi.advanceTimersByTimeAsync(1000);

        await expect(pending).resolves.toBe(IN_PROCESS);
        expect(inProcessSearchExecutor.run).toHaveBeenCalledWith("autocomplete", { ...ROOT, query: "x" });
        expect(replicas[0].killed).toBe(true);
        expect(replicas).toHaveLength(2);
        expect(executor.state).toBe("booting");

        replicas[0].reply({ type: "result", id: 1, result: [ "late" ] });
        replicas[0].emit("exit", 0);
        expect(executor.state).toBe("booting");
        expect(replicas).toHaveLength(2);
    });

    it("replaces a replica that dies once, and searches in this process for good after a second death", async () => {
        const executor = started();
        replicas[0].ready();

        const first = executor.run("search", { ...ROOT, searchString: "a" });
        replicas[0].emit("exit", 1);
        await expect(first).resolves.toBe(IN_PROCESS);
        expect(replicas).toHaveLength(2);
        expect(executor.state).toBe("booting");

        replicas[1].ready();
        const second = executor.run("search", { ...ROOT, searchString: "b" });
        replicas[1].emit("exit", null, "SIGKILL");
        await expect(second).resolves.toBe(IN_PROCESS);

        expect(executor.state).toBe("disabled");
        expect(replicas).toHaveLength(2);
        expect(logs.filter((line) => line.includes("searching in this process"))).toHaveLength(1);
        await expect(executor.run("search", { ...ROOT, searchString: "c" })).resolves.toBe(IN_PROCESS);

        executor.onCommit([ { entityName: "notes", entityId: "n1", isErased: false } ]);
        expect(replicas[1].sent.filter((message) => message.type === "commit")).toEqual([]);
    });

    it("treats a replica that cannot be sent a message or errors as dead", async () => {
        const executor = started();
        replicas[0].ready();
        replicas[0].postError = new Error("channel closed");

        await expect(executor.run("quickSearch", { ...ROOT, searchString: "a" })).resolves.toBe(IN_PROCESS);
        expect(replicas[0].killed).toBe(true);
        expect(replicas).toHaveLength(2);

        replicas[1].ready();
        replicas[1].emit("error", new Error("EPIPE"));
        expect(executor.state).toBe("disabled");
    });

    it("rethrows a query's error as the class the route maps to its status", async () => {
        const executor = started();
        const [ replica ] = replicas;
        replica.ready();

        const invalid = executor.run("autocomplete", { ...ROOT, query: 1 });
        replica.reply({
            type: "error",
            id: replica.lastQueryId(),
            error: serializeSearchQueryError(new ValidationError("Invalid query data type."))
        });
        const error = await invalid.catch((e: unknown) => e);
        expect(error).toBeInstanceOf(ValidationError);
        expect(error).toMatchObject({ statusCode: 400, message: "Invalid query data type." });

        const teapot = executor.run("search", { ...ROOT, searchString: "a" });
        replica.reply({ type: "error", id: replica.lastQueryId(), error: { name: "Teapot", message: "no", statusCode: 418 } });
        const other = await teapot.catch((e: unknown) => e);
        expect(other).toBeInstanceOf(HttpError);
        expect(other).toMatchObject({ statusCode: 418, name: "Teapot" });
        expect(executor.state).toBe("ready");
    });

    it("stops for good when the replica refuses to start, and relays its log lines", () => {
        const executor = started();
        replicas[0].reply({ type: "log", level: "info", message: "loading" });
        replicas[0].reply({ type: "log", level: "error", message: "bad" });
        replicas[0].reply({ type: "failed", reason: "the database is at version 1" });

        expect(executor.state).toBe("disabled");
        expect(replicas).toHaveLength(1);
        expect(replicas[0].killed).toBe(true);
        expect(logs).toContain("Search replica: loading");
        expect(logs).toContain("ERROR Search replica: bad");
        expect(logs.at(-1)).toContain("the database is at version 1");
    });

    it("gives up on a replica that never comes up", async () => {
        vi.useFakeTimers();
        const executor = started({ bootTimeoutMs: 500 });

        await vi.advanceTimersByTimeAsync(500);
        expect(replicas[0].killed).toBe(true);
        expect(replicas).toHaveLength(2);

        await vi.advanceTimersByTimeAsync(500);
        expect(executor.state).toBe("disabled");
    });

    it("answers pending queries in this process on shutdown", async () => {
        const executor = started();
        replicas[0].ready();

        const pending = executor.run("search", { ...ROOT, searchString: "a" });
        executor.shutdown();

        await expect(pending).resolves.toBe(IN_PROCESS);
        expect(replicas[0].killed).toBe(true);
        expect(executor.state).toBe("disabled");
    });

    it("does not start where it is turned off, memory is short or the database is not a file", () => {
        const integrationTest = process.env.TRILIUM_INTEGRATION_TEST;

        try {
            expect(started({ enabled: undefined }).state).toBe("disabled");

            delete process.env.TRILIUM_INTEGRATION_TEST;
            h.searchWorker = false;
            expect(started({ enabled: undefined }).state).toBe("disabled");
            h.searchWorker = true;
            expect(started({ enabled: undefined }).state).toBe("booting");
        } finally {
            process.env.TRILIUM_INTEGRATION_TEST = integrationTest;
        }

        expect(started({ enabled: false }).state).toBe("disabled");
        expect(started({ totalMemoryBytes: MIN_TOTAL_MEMORY_BYTES - 1 }).state).toBe("disabled");
        expect(started({ documentPath: null }).state).toBe("disabled");
        expect(replicas).toHaveLength(1);
        expect(logs.filter((line) => line.includes("searching in this process"))).toHaveLength(5);
    });

    it("sizes the heap at a quarter of the memory, up to 4 GiB, and passes the boot options", () => {
        expect(replicaHeapMb(8 * 1024 ** 3)).toBe(2048);
        expect(replicaHeapMb(64 * 1024 ** 3)).toBe(4096);

        started({ totalMemoryBytes: 8 * 1024 ** 3 });
        const [ options ] = spawns;

        expect(options.execArgv).toContain("--max-old-space-size=2048");
        expect(options.env.TRILIUM_INTEGRATION_TEST).toBeUndefined();
        expect(options.env.TRILIUM_RESOURCE_DIR).toBeTruthy();
        expect(JSON.parse(options.env.TRILIUM_SEARCH_REPLICA_OPTIONS ?? "{}")).toMatchObject({
            documentPath: "/data/document.db",
            config: { General: expect.any(Object) }
        });
    });
});

describe("search routes through the replica", () => {
    it("answer with the same status and JSON as in this process", async () => {
        vi.mocked(inProcessSearchExecutor.run).mockRestore();
        const api = CoreApiTester.build();
        const created = await api.post<{ noteId: string }>("/api/special-notes/search-note", {
            body: { searchString: "note" }
        });
        const searchNoteId = created.body.noteId;
        const requests: [ "get" | "post", string, { query?: Record<string, string>; body?: unknown } ][] = [
            [ "get", "/api/quick-search", { query: { searchString: "note" } } ],
            [ "get", "/api/search", { query: { searchString: "#workspace" } } ],
            [ "get", "/api/search", { query: { searchString: "note", includeTokens: "true" } } ],
            [ "get", "/api/search", { query: {} } ],
            [ "post", "/api/search-related", { body: { type: "label", name: "workspace" } } ],
            [ "get", `/api/search-note/${searchNoteId}`, {} ],
            [ "get", "/api/search-note/root", {} ],
            [ "post", `/api/search-note/${searchNoteId}/result-details`, { body: { noteIds: [ "root" ] } } ],
            [ "get", "/api/autocomplete", { query: { query: "work" } } ],
            [ "get", "/api/autocomplete", { query: { query: "", activeNoteId: "root" } } ]
        ];
        const send = async () => {
            const responses: string[] = [];
            for (const [ method, url, options ] of requests) {
                const res = await api[method](url, options);
                responses.push(`${res.status} ${JSON.stringify(res.body)}`);
            }
            return responses;
        };

        const inProcess = await send();

        const executor = started();
        replicas[0].answerQueries = true;
        replicas[0].ready();
        initSearchExecutor(executor);

        try {
            expect(await send()).toEqual(inProcess);
            expect(replicas[0].sent.filter((message) => message.type === "query")).toHaveLength(requests.length);
            expect(inProcess.map((line) => line.split(" ")[0])).toEqual(
                [ "200", "200", "200", "400", "200", "200", "400", "200", "200", "200" ]
            );
        } finally {
            initSearchExecutor();
            executor.shutdown();
        }
    });
});

function started(overrides: ReplicaSearchOptions = {}) {
    const executor = createReplicaSearchExecutor(testOptions(overrides));
    executor.start();
    return executor;
}

function testOptions(overrides: ReplicaSearchOptions = {}): ReplicaSearchOptions {
    return {
        enabled: true,
        documentPath: "/data/document.db",
        totalMemoryBytes: 16 * 1024 ** 3,
        ...overrides
    };
}

/** The replica's answer to a query: the same function, across a structured-clone boundary. */
function answer(request: Extract<ReplicaRequest, { type: "query" }>): ReplicaReply {
    const kind = request.kind as SearchQueryKind;

    try {
        const result = runSearchQuery(kind, request.args as never, { deferScripts: true });
        return { type: "result", id: request.id, result: structuredClone(result) };
    } catch (e: unknown) {
        return { type: "error", id: request.id, error: serializeSearchQueryError(e) };
    }
}
