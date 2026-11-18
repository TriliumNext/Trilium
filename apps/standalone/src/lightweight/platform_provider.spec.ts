import { PDF_TOC_READER } from "@triliumnext/commons";
import { cls, entity_changes, getSql, note_service as noteService } from "@triliumnext/core";
import {
    type GeneratedToc, getToc, readCachedToc, registerTocGenerator, TOC_CACHE_ROLE,
    unregisterTocGenerator
} from "@triliumnext/core/src/services/toc/index.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { dbLock } from "./db_lock.js";
import StandalonePlatformProvider from "./platform_provider.js";

describe("StandalonePlatformProvider", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("exposes the standalone platform flags", () => {
        const provider = new StandalonePlatformProvider("");
        expect(provider.isElectron).toBe(false);
        expect(provider.isStandalone).toBe(true);
        expect(provider.getDatabasePath()).toBeNull();
    });

    it.each([
        ["MacIntel", "Mozilla/5.0 (Macintosh)", { isMac: true, isWindows: false, isLinux: false }],
        ["Win32", "Mozilla/5.0 (Windows NT 10.0)", { isMac: false, isWindows: true, isLinux: false }],
        ["Linux x86_64", "Mozilla/5.0 (X11; Linux x86_64)", { isMac: false, isWindows: false, isLinux: true }],
        // Android reports a Linux platform, but is not desktop Linux.
        ["Linux armv8l", "Mozilla/5.0 (Linux; Android 14)", { isMac: false, isWindows: false, isLinux: false }],
        ["iPhone", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)", { isMac: false, isWindows: false, isLinux: false }]
    ])("reads the host OS from navigator.platform %s", (platform, userAgent, expected) => {
        vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
        vi.spyOn(navigator, "userAgent", "get").mockReturnValue(userAgent);

        const provider = new StandalonePlatformProvider("");
        expect({ isMac: provider.isMac, isWindows: provider.isWindows, isLinux: provider.isLinux }).toEqual(expected);
    });

    it("maps known query parameters to TRILIUM_ env vars", () => {
        const provider = new StandalonePlatformProvider("?safeMode=1&startNoteId=abc123");
        expect(provider.getEnv("TRILIUM_SAFE_MODE")).toBe("1");
        expect(provider.getEnv("TRILIUM_START_NOTE_ID")).toBe("abc123");
    });

    it("defaults a valueless query flag to \"true\"", () => {
        const provider = new StandalonePlatformProvider("?safeMode");
        expect(provider.getEnv("TRILIUM_SAFE_MODE")).toBe("true");
    });

    it("ignores unknown query parameters and returns undefined for unset env", () => {
        const provider = new StandalonePlatformProvider("?unknown=x");
        expect(provider.getEnv("TRILIUM_SAFE_MODE")).toBeUndefined();
        expect(provider.getEnv("TRILIUM_START_NOTE_ID")).toBeUndefined();
    });

    it("crash() logs and posts a FATAL_ERROR message", () => {
        const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        const postSpy = vi.spyOn(self, "postMessage").mockImplementation(() => {});

        const provider = new StandalonePlatformProvider("");
        provider.crash("boom");

        expect(consoleSpy).toHaveBeenCalledWith("[Standalone] FATAL:", "boom");
        expect(postSpy).toHaveBeenCalledWith({ type: "FATAL_ERROR", message: "boom" });
    });
});

describe("whenDatabaseFree", () => {
    afterEach(() => {
        unregisterTocGenerator("pdf");
        vi.restoreAllMocks();
    });

    it("saves a ToC build after an import that held the connection, and outside it", async () => {
        const committed = captureCommits();
        const { note } = cls.init(() => noteService.createNewNote({
            parentNoteId: "root", title: "gated-save", type: "file", mime: "application/pdf",
            content: "Alpha"
        }));
        const ref = { kind: "note", noteId: note.noteId } as const;
        const generator = deferred<GeneratedToc>();
        registerTocGenerator("pdf", () => generator.promise);

        const request = cls.init(() => getToc(ref));
        const importGate = deferred<void>();
        const failedImport = dbLock.runExclusive(() => cls.init(() => getSql().transactionalAsync(
            async () => {
                await importGate.promise;
                throw new Error("The import failed.");
            })));
        generator.resolve({
            headings: [ { title: "Alpha", level: 1, page: 1 } ],
            properties: { reader: PDF_TOC_READER }
        });
        await flush();
        expect(caches(note)).toHaveLength(0);

        importGate.resolve();
        await expect(failedImport).rejects.toThrow("The import failed.");
        expect(await request).toMatchObject({ status: "ready" });

        const [ cache ] = caches(note);
        expect(cache).toBeDefined();
        expect(cls.init(() => readCachedToc(ref))).toMatchObject({ status: "ready" });
        const changeId = getSql().getValue<number>(
            "SELECT id FROM entity_changes WHERE entityName = 'attachments' AND entityId = ?",
            [ String(cache?.attachmentId) ]);
        expect(committed).toContain(changeId);
        expect(entity_changes.getMaxEntityChangeId())
            .toBe(getSql().getValue<number>("SELECT MAX(id) FROM entity_changes"));
    });
});

/** The entity change ids that each committed transaction would broadcast to the clients. */
function captureCommits() {
    const committed: number[] = [];
    const { params } = getSql() as unknown as { params: { onTransactionCommit(): void } };
    vi.spyOn(params, "onTransactionCommit").mockImplementation(() => {
        committed.push(...cls.getAndClearEntityChangeIds());
    });
    return committed;
}

function caches(note: { noteId: string }) {
    return getSql().getRows<{ attachmentId: string }>(
        "SELECT attachmentId FROM attachments WHERE ownerId = ? AND role = ? AND isDeleted = 0",
        [ note.noteId, TOC_CACHE_ROLE ]);
}

function deferred<T>() {
    let resolve: (value: T) => void = () => {};
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

/** Lets every pending continuation run, the ones waiting on a timer's turn included. */
async function flush() {
    for (let turn = 0; turn < 5; turn++) {
        await new Promise((done) => setTimeout(done, 0));
    }
}
