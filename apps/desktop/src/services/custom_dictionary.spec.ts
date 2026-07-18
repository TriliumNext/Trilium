import { becca, becca_easy_mocking } from "@triliumnext/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { buildNote } = becca_easy_mocking;

// Mutable test state for the core stubs (db-initialised / spellcheck-enabled
// gates in `setupCustomDictionary`) plus captured IPC / app event handlers.
const state = vi.hoisted(() => ({
    dbInitialized: true,
    spellCheckEnabled: true,
    appHandlers: new Map<string, (...args: unknown[]) => unknown>(),
    ipcHandlers: new Map<string, (...args: unknown[]) => unknown>()
}));

// `getLog()` throws when the log service hasn't been initialised via
// `initializeCore` — and we don't want to spin up core in unit tests just to
// satisfy a logger. Partial-mock core so `getLog` returns no-op stubs while
// every other core export keeps its real implementation. `sql_init` and
// `options` are stubbed so the setup gates are controllable.
vi.mock("@triliumnext/core", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@triliumnext/core")>();
    return {
        ...actual,
        getLog: () => ({ info: vi.fn(), error: vi.fn() }),
        sql_init: { ...actual.sql_init, isDbInitialized: () => state.dbInitialized },
        options: { ...actual.options, getOptionBool: () => state.spellCheckEnabled }
    };
});

// `custom_dictionary.ts` does `import electron from "electron"` at module load
// to register IPC handlers. On CI the `electron` package's entry point throws
// ("Electron failed to install correctly") because the binary isn't materialized.
// Capture the registered handlers so the setup wiring can be exercised directly.
vi.mock("electron", () => ({
    default: {
        ipcMain: { on: (channel: string, fn: (...args: unknown[]) => unknown) => state.ipcHandlers.set(channel, fn) },
        app: { on: (event: string, fn: (...args: unknown[]) => unknown) => state.appHandlers.set(event, fn) }
    }
}));

const customDictionary = await import("./custom_dictionary.js");

function mockSession(localWords: string[] = []) {
    return {
        listWordsInSpellCheckerDictionary: vi.fn().mockResolvedValue(localWords),
        addWordToSpellCheckerDictionary: vi.fn(),
        removeWordFromSpellCheckerDictionary: vi.fn()
    } as any;
}

describe("custom_dictionary", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        becca.reset();
        buildNote({
            id: "_customDictionary",
            title: "Custom Dictionary",
            type: "code",
            content: ""
        });
    });

    describe("loadForSession", () => {
        it("does nothing when note is empty and no local words", async () => {
            const session = mockSession();

            await customDictionary.loadForSession(session);

            expect(session.addWordToSpellCheckerDictionary).not.toHaveBeenCalled();
            expect(session.removeWordFromSpellCheckerDictionary).not.toHaveBeenCalled();
        });

        it("imports local words when note is empty (one-time import)", async () => {
            const session = mockSession(["hello", "world"]);

            await customDictionary.loadForSession(session);

            // Words are saved to the note; they're already in the local dictionary so no re-add needed.
            expect(session.addWordToSpellCheckerDictionary).not.toHaveBeenCalled();
        });

        it("does not remove or re-add local words after one-time import", async () => {
            const session = mockSession(["hello", "world"]);

            await customDictionary.loadForSession(session);

            // Words were imported from local, so they already exist — no remove, no re-add.
            expect(session.removeWordFromSpellCheckerDictionary).not.toHaveBeenCalled();
            expect(session.addWordToSpellCheckerDictionary).not.toHaveBeenCalled();
        });

        it("loads note words into session when no local words exist", async () => {
            becca.reset();
            buildNote({
                id: "_customDictionary",
                title: "Custom Dictionary",
                type: "code",
                content: "apple\nbanana"
            });
            const session = mockSession();

            await customDictionary.loadForSession(session);

            expect(session.addWordToSpellCheckerDictionary).toHaveBeenCalledTimes(2);
            expect(session.addWordToSpellCheckerDictionary).toHaveBeenCalledWith("apple");
            expect(session.addWordToSpellCheckerDictionary).toHaveBeenCalledWith("banana");
        });

        it("only adds note words not already in local dictionary", async () => {
            becca.reset();
            buildNote({
                id: "_customDictionary",
                title: "Custom Dictionary",
                type: "code",
                content: "apple\nbanana"
            });
            // "banana" is already local, so only "apple" needs adding.
            const session = mockSession(["banana", "cherry"]);

            await customDictionary.loadForSession(session);

            expect(session.addWordToSpellCheckerDictionary).toHaveBeenCalledTimes(1);
            expect(session.addWordToSpellCheckerDictionary).toHaveBeenCalledWith("apple");
        });

        it("only removes local words not in the note", async () => {
            becca.reset();
            buildNote({
                id: "_customDictionary",
                title: "Custom Dictionary",
                type: "code",
                content: "apple\nbanana"
            });
            // "cherry" is not in the note, so it should be removed. "banana" should stay.
            const session = mockSession(["banana", "cherry"]);

            await customDictionary.loadForSession(session);

            expect(session.removeWordFromSpellCheckerDictionary).toHaveBeenCalledTimes(1);
            expect(session.removeWordFromSpellCheckerDictionary).toHaveBeenCalledWith("cherry");
        });

        it("handles note with whitespace and blank lines", async () => {
            becca.reset();
            buildNote({
                id: "_customDictionary",
                title: "Custom Dictionary",
                type: "code",
                content: "  apple \n\n  banana  \n\n"
            });
            const session = mockSession();

            await customDictionary.loadForSession(session);

            expect(session.addWordToSpellCheckerDictionary).toHaveBeenCalledTimes(2);
            expect(session.addWordToSpellCheckerDictionary).toHaveBeenCalledWith("apple");
            expect(session.addWordToSpellCheckerDictionary).toHaveBeenCalledWith("banana");
        });

        it("does not re-add words removed from the note but present locally", async () => {
            becca.reset();
            buildNote({
                id: "_customDictionary",
                title: "Custom Dictionary",
                type: "code",
                content: "apple\nbanana"
            });
            // "cherry" was previously in the note but user removed it;
            // it still lingers in Electron's local dictionary.
            const session = mockSession(["apple", "banana", "cherry"]);

            await customDictionary.loadForSession(session);

            // "apple" and "banana" are already local — no re-add needed.
            expect(session.addWordToSpellCheckerDictionary).not.toHaveBeenCalled();
            // "cherry" should be removed from local dictionary.
            expect(session.removeWordFromSpellCheckerDictionary).toHaveBeenCalledTimes(1);
            expect(session.removeWordFromSpellCheckerDictionary).toHaveBeenCalledWith("cherry");
        });

        it("handles missing dictionary note gracefully", async () => {
            becca.reset(); // no note created
            const session = mockSession(["hello"]);

            await customDictionary.loadForSession(session);

            expect(session.addWordToSpellCheckerDictionary).not.toHaveBeenCalled();
        });
    });

    describe("setupCustomDictionary — web-contents-created gate", () => {
        beforeEach(() => {
            state.dbInitialized = true;
            state.spellCheckEnabled = true;
            state.appHandlers.clear();
            state.ipcHandlers.clear();
            customDictionary.setupCustomDictionary();
        });

        function fireWebContentsCreated(session: unknown) {
            const handler = state.appHandlers.get("web-contents-created");
            if (!handler) throw new Error("web-contents-created not registered");
            return handler({}, { session });
        }

        it("loads the dictionary into a new spellcheck-enabled session", async () => {
            buildNote({ id: "_customDictionary", title: "Custom Dictionary", type: "code", content: "apple" });
            const session = mockSession();

            fireWebContentsCreated(session);
            await new Promise((r) => setTimeout(r, 0));

            expect(session.addWordToSpellCheckerDictionary).toHaveBeenCalledWith("apple");
        });

        it("skips when the DB is not initialised", () => {
            state.dbInitialized = false;
            const session = mockSession();
            fireWebContentsCreated(session);
            expect(session.listWordsInSpellCheckerDictionary).not.toHaveBeenCalled();
        });

        it("skips when spellcheck is disabled", () => {
            state.spellCheckEnabled = false;
            const session = mockSession();
            fireWebContentsCreated(session);
            expect(session.listWordsInSpellCheckerDictionary).not.toHaveBeenCalled();
        });

        it("syncs each session only once", async () => {
            const session = mockSession();
            fireWebContentsCreated(session);
            fireWebContentsCreated(session); // same session, must be a no-op
            await new Promise((r) => setTimeout(r, 0));
            expect(session.listWordsInSpellCheckerDictionary).toHaveBeenCalledTimes(1);
        });

        it("swallows load failures", async () => {
            const session = mockSession();
            session.listWordsInSpellCheckerDictionary.mockRejectedValue(new Error("boom"));
            // Must not throw / reject.
            fireWebContentsCreated(session);
            await new Promise((r) => setTimeout(r, 0));
            expect(session.listWordsInSpellCheckerDictionary).toHaveBeenCalled();
        });
    });

    describe("setupCustomDictionary — add-word-to-dictionary IPC", () => {
        beforeEach(() => {
            state.ipcHandlers.clear();
            state.appHandlers.clear();
            becca.reset();
            buildNote({ id: "_customDictionary", title: "Custom Dictionary", type: "code", content: "apple" });
            customDictionary.setupCustomDictionary();
        });

        function addWord(word: unknown, session: unknown) {
            const handler = state.ipcHandlers.get("add-word-to-dictionary");
            if (!handler) throw new Error("add-word-to-dictionary not registered");
            return handler({ sender: { session } }, word);
        }

        it("persists a valid word to both the local session and the note", () => {
            const session = mockSession();
            // easy-mock's getContent is a fixed closure, so spy on setContent
            // to capture what gets written.
            const setContent = vi.spyOn(becca.getNoteOrThrow("_customDictionary"), "setContent");

            addWord("banana", session);

            expect(session.addWordToSpellCheckerDictionary).toHaveBeenCalledWith("banana");
            // Existing "apple" + new "banana", saved sorted, one word per line.
            expect(setContent).toHaveBeenCalledWith("apple\nbanana");
        });

        it("rejects non-string / empty payloads without side effects", () => {
            const session = mockSession();
            addWord(123, session);
            addWord("", session);
            expect(session.addWordToSpellCheckerDictionary).not.toHaveBeenCalled();
        });

        it("logs when the dictionary note is missing on save", () => {
            becca.reset(); // remove the note so saveWords hits its error path
            const session = mockSession();
            // Must not throw even though the note is gone.
            expect(() => addWord("banana", session)).not.toThrow();
            expect(session.addWordToSpellCheckerDictionary).toHaveBeenCalledWith("banana");
        });
    });
});
