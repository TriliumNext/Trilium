import { type ChildProcess, spawn } from "child_process";
import { join } from "path";

/**
 * A real Trilium server instance (the production `dist/main.cjs` bundle, same as the e2e
 * webServer) spawned against its own data directory, plus the HTTP plumbing needed to drive
 * the sync protocol end-to-end: document setup, password, ETAPI seeding, sync-from-server and
 * completion polling.
 *
 * Reused by sync e2e specs; extend it rather than hand-rolling fetch calls in tests.
 */
export default class SyncInstance {
    readonly dataDir: string;
    readonly port: number;
    readonly baseUrl: string;

    private child?: ChildProcess;
    private etapiToken?: string;

    constructor(dataDir: string, port: number) {
        this.dataDir = dataDir;
        this.port = port;
        this.baseUrl = `http://127.0.0.1:${port}`;
    }

    /** Spawns the server and waits until it responds. Safe to call again after {@link stop}. */
    async start() {
        const serverDir = join(__dirname, "..", "..");

        this.child = spawn(process.execPath, ["dist/main.cjs"], {
            cwd: serverDir,
            env: {
                ...process.env,
                TRILIUM_DATA_DIR: this.dataDir,
                TRILIUM_PORT: String(this.port),
                TRILIUM_ENV: "production",
                // ensure the file-backed DB is used even if the caller's env says otherwise
                TRILIUM_INTEGRATION_TEST: ""
            },
            stdio: "ignore"
        });

        await this.waitFor(async () => {
            const res = await this.fetchJson<{ schemaExists: boolean }>("/api/setup/status");
            return res !== null;
        }, "server did not start", 120_000);
    }

    async stop() {
        const child = this.child;
        if (!child || child.exitCode !== null) {
            return;
        }

        await new Promise<void>((resolve) => {
            child.once("exit", () => resolve());
            child.kill("SIGTERM");
            // fallback if SIGTERM is ignored
            setTimeout(() => {
                if (child.exitCode === null) child.kill("SIGKILL");
            }, 10_000).unref();
        });
    }

    /**
     * Restarts the instance. On startup the sync timer schedules a sync cycle a few seconds
     * after load, so this doubles as a deterministic, auth-free "sync now" trigger.
     */
    async restart() {
        await this.stop();
        await this.start();
    }

    /** Initializes a brand-new document (schema + demo content) on a fresh instance. */
    async initNewDocument() {
        await this.postJson("/api/setup/new-document", {});
        await this.waitFor(async () => {
            const res = await this.fetchJson<{ isInitialized: boolean }>("/api/setup/status");
            return res?.isInitialized === true;
        }, "document was not initialized", 120_000);
    }

    /** Sets the initial password (needed for the sync seed exchange and ETAPI logins). */
    async setPassword(password: string) {
        const res = await fetch(`${this.baseUrl}/set-password`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ password1: password, password2: password }),
            redirect: "manual"
        });
        if (res.status >= 400) {
            throw new Error(`set-password failed: ${res.status} ${await res.text()}`);
        }
    }

    /** Points this (uninitialized) instance at a sync server and starts the initial sync. */
    async setupSyncFromServer(sourceUrl: string, password: string) {
        const res = await this.postJson<{ result: string; error?: string }>("/api/setup/sync-from-server", {
            syncServerHost: sourceUrl,
            syncProxy: "",
            password
        });
        if (res?.result !== "success") {
            throw new Error(`sync-from-server failed: ${res?.error}`);
        }
    }

    /** Polls /api/sync/stats (auth-free) until the initial sync has fully converged. */
    async waitForInitialSyncDone(timeoutMs = 180_000) {
        await this.waitFor(async () => {
            const stats = await this.fetchJson<{ initialized: boolean; outstandingPullCount: number }>("/api/sync/stats");
            return stats?.initialized === true && stats?.outstandingPullCount === 0;
        }, "initial sync did not converge", timeoutMs);
    }

    async etapiLogin(password: string) {
        const res = await this.postJson<{ authToken: string }>("/etapi/auth/login", { password });
        if (!res?.authToken) {
            throw new Error("ETAPI login failed");
        }
        this.etapiToken = res.authToken;
    }

    async createNote(opts: { parentNoteId?: string; title: string; content: string; type?: string }) {
        const res = await this.etapi<{ note: { noteId: string } }>("POST", "/etapi/create-note", {
            parentNoteId: opts.parentNoteId ?? "root",
            title: opts.title,
            type: opts.type ?? "text",
            content: opts.content
        });
        return res.note.noteId;
    }

    async createLabel(noteId: string, name: string, value: string) {
        await this.etapi("POST", "/etapi/attributes", { noteId, type: "label", name, value });
    }

    /** Returns the noteId of a note with the exact title, or null. */
    async findNoteByTitle(title: string): Promise<string | null> {
        const res = await this.etapi<{ results: Array<{ noteId: string; title: string }> }>(
            "GET", `/etapi/notes?search=${encodeURIComponent(`note.title = '${title}'`)}`);
        return res.results.find((n) => n.title === title)?.noteId ?? null;
    }

    async getNoteContent(noteId: string): Promise<string> {
        const res = await fetch(`${this.baseUrl}/etapi/notes/${noteId}/content`, {
            headers: { Authorization: this.requireToken() }
        });
        if (!res.ok) {
            throw new Error(`get content failed: ${res.status}`);
        }
        return await res.text();
    }

    /**
     * Seeds a metadata-and-content fixture through the real write path (ETAPI): `parents`
     * top-level notes each holding `childrenPerParent` labelled children with unique content,
     * plus one large note of `largeContentBytes` (exercises a byte-cap-crossing sync record).
     * Sized so the seeded entity changes cross the server's 1000-row fetch batches many times.
     */
    async seedFixture({ parents = 15, childrenPerParent = 60, largeContentBytes = 2_500_000 } = {}) {
        const parentIds: string[] = [];
        for (let p = 0; p < parents; p++) {
            parentIds.push(await this.createNote({ title: `sync-fixture parent ${p}`, content: `<p>parent ${p}</p>` }));
        }

        const tasks: Array<() => Promise<void>> = [];
        for (let p = 0; p < parents; p++) {
            for (let c = 0; c < childrenPerParent; c++) {
                tasks.push(async () => {
                    const noteId = await this.createNote({
                        parentNoteId: parentIds[p],
                        title: `sync-fixture note ${p}-${c}`,
                        content: `<p>unique content ${p}-${c} ${"x".repeat(100 + ((p * childrenPerParent + c) % 400))}</p>`
                    });
                    await this.createLabel(noteId, "syncFixture", `${p}-${c}`);
                });
            }
        }
        await runConcurrently(tasks, 8);

        await this.createNote({
            title: "sync-fixture large note",
            content: `<p>${"L".repeat(largeContentBytes)}</p>`
        });

        return { parents, childrenPerParent, totalNotes: parents * childrenPerParent + parents + 1 };
    }

    private requireToken(): string {
        if (!this.etapiToken) throw new Error("etapiLogin() must be called first");
        return this.etapiToken;
    }

    private async etapi<T>(method: string, path: string, body?: unknown): Promise<T> {
        const res = await fetch(`${this.baseUrl}${path}`, {
            method,
            headers: {
                Authorization: this.requireToken(),
                ...(body ? { "Content-Type": "application/json" } : {})
            },
            body: body ? JSON.stringify(body) : undefined
        });
        if (!res.ok) {
            throw new Error(`ETAPI ${method} ${path} failed: ${res.status} ${await res.text()}`);
        }
        return (await res.json()) as T;
    }

    private async postJson<T>(path: string, body: unknown): Promise<T | null> {
        try {
            const res = await fetch(`${this.baseUrl}${path}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body)
            });
            return (await res.json()) as T;
        } catch {
            return null;
        }
    }

    private async fetchJson<T>(path: string): Promise<T | null> {
        try {
            const res = await fetch(`${this.baseUrl}${path}`);
            if (!res.ok) return null;
            return (await res.json()) as T;
        } catch {
            return null;
        }
    }

    private async waitFor(condition: () => Promise<boolean>, message: string, timeoutMs: number) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            if (await condition()) return;
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        throw new Error(`Timed out after ${timeoutMs}ms: ${message}`);
    }
}

/** Runs async tasks with bounded concurrency (seeding hundreds of notes serially is slow). */
async function runConcurrently(tasks: Array<() => Promise<void>>, concurrency: number) {
    const queue = [...tasks];
    await Promise.all(
        Array.from({ length: concurrency }, async () => {
            for (let task = queue.shift(); task; task = queue.shift()) {
                await task();
            }
        })
    );
}
