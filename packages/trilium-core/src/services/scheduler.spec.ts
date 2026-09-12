import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import becca from "../becca/becca.js";
import { buildNote } from "../test/becca_easy_mocking.js";
import attributeService from "./attributes.js";
import config from "./config.js";
import events from "./events.js";
import hiddenSubtreeService from "./hidden_subtree.js";
import options from "./options.js";
import protected_session from "./protected_session.js";
import { startScheduler } from "./scheduler.js";
import scriptService from "./script.js";
import sqlInit from "./sql_init.js";
import ws from "./ws.js";

// scheduler.ts is otherwise covered only incidentally (its timers rarely fire
// within a test's lifetime), which makes its coverage flaky. These tests drive
// startScheduler deterministically with fake timers instead.
//
// We spy on the real service singletons rather than vi.mock()-ing their modules:
// scheduler.js is already evaluated by the test setup's initializeCore(), so its
// internal imports are bound to the real modules — mocking them after the fact
// would not be picked up, but spying on the shared singleton objects is.

const SECOND = 1000;
const HOUR = 3600 * SECOND;

/**
 * startScheduler() registers all its timers inside `sqlInit.dbReady.then(...)`.
 * Awaiting the (already-resolved) dbReady promise lets those then-callbacks run
 * first, so the timers exist before we advance the fake clock.
 *
 * Several microtasks rather than one: the hidden-subtree callback reconciles the
 * language before it runs, and each `await` inside it costs another turn.
 */
async function settleDbReady() {
    await sqlInit.dbReady;
    for (let i = 0; i < 5; i++) {
        await Promise.resolve();
    }
}

function buildBackendScript() {
    return buildNote({ type: "code", mime: "application/javascript;env=backend", content: "" });
}

describe("scheduler", () => {
    const originalScriptingEnabled = config.Security.backendScriptingEnabled;
    const originalInstanceName = config.General.instanceName;
    const originalSafeMode = process.env.TRILIUM_SAFE_MODE;

    let getNotesWithLabel: ReturnType<typeof vi.spyOn>;
    let executeNoteNoException: ReturnType<typeof vi.spyOn>;
    let checkHiddenSubtree: ReturnType<typeof vi.spyOn>;
    let isDbInitialized: ReturnType<typeof vi.spyOn>;
    let isProtectedSessionAvailable: ReturnType<typeof vi.spyOn>;
    let getLastProtectedSessionOperationDate: ReturnType<typeof vi.spyOn>;
    let resetDataKey: ReturnType<typeof vi.spyOn>;
    let getOptionInt: ReturnType<typeof vi.spyOn>;
    let reloadFrontend: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        becca.reset();
        vi.useFakeTimers();
        vi.spyOn(console, "log").mockImplementation(() => {});

        config.Security.backendScriptingEnabled = true;
        config.General.instanceName = "";
        delete process.env.TRILIUM_SAFE_MODE;

        getNotesWithLabel = vi.spyOn(attributeService, "getNotesWithLabel").mockReturnValue([]);
        executeNoteNoException = vi.spyOn(scriptService, "executeNoteNoException").mockImplementation(() => {});
        checkHiddenSubtree = vi.spyOn(hiddenSubtreeService, "checkHiddenSubtree").mockImplementation(() => {});
        isDbInitialized = vi.spyOn(sqlInit, "isDbInitialized").mockReturnValue(false);
        isProtectedSessionAvailable = vi.spyOn(protected_session, "isProtectedSessionAvailable").mockReturnValue(false);
        getLastProtectedSessionOperationDate = vi.spyOn(protected_session, "getLastProtectedSessionOperationDate").mockReturnValue(null);
        resetDataKey = vi.spyOn(protected_session, "resetDataKey").mockImplementation(() => {});
        getOptionInt = vi.spyOn(options, "getOptionInt").mockReturnValue(600);
        reloadFrontend = vi.spyOn(ws, "reloadFrontend").mockImplementation(() => {});
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.restoreAllMocks();
        config.Security.backendScriptingEnabled = originalScriptingEnabled;
        config.General.instanceName = originalInstanceName;
        if (originalSafeMode === undefined) {
            delete process.env.TRILIUM_SAFE_MODE;
        } else {
            process.env.TRILIUM_SAFE_MODE = originalSafeMode;
        }
    });

    it("runs backendStartup, hourly and daily scripts on their timers when scripting is enabled", async () => {
        isDbInitialized.mockReturnValue(true);
        const scriptNote = buildBackendScript();
        getNotesWithLabel.mockReturnValue([scriptNote]);

        startScheduler();
        await settleDbReady();

        // The hidden subtree is checked as soon as there is a database, via dbReady.
        expect(checkHiddenSubtree).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(10 * SECOND);
        expect(getNotesWithLabel).toHaveBeenCalledWith("run", "backendStartup");
        expect(executeNoteNoException).toHaveBeenCalledWith(scriptNote, expect.objectContaining({ originEntity: scriptNote }));

        getNotesWithLabel.mockClear();
        await vi.advanceTimersByTimeAsync(HOUR);
        expect(getNotesWithLabel).toHaveBeenCalledWith("run", "hourly");

        getNotesWithLabel.mockClear();
        await vi.advanceTimersByTimeAsync(24 * HOUR);
        expect(getNotesWithLabel).toHaveBeenCalledWith("run", "daily");
    });

    it("still checks the hidden subtree where the database was opened after the scheduler started", async () => {
        // Which is every path through the setup wizard: the instance has nothing to open when this
        // runs, and the database it goes on to open — restored from a backup, or pulled from a sync
        // server — was written by an older version that knows nothing of whatever has been added to
        // the subtree since. Asking whether the database was initialized at the moment the scheduler
        // started answered for the wrong moment, and left those instances unchecked until a restart.
        isDbInitialized.mockReturnValue(false);

        startScheduler();
        await settleDbReady();

        expect(checkHiddenSubtree).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(7 * HOUR);
        expect(checkHiddenSubtree).toHaveBeenCalledTimes(2);
    });

    it("does not schedule script timers when backend scripting is disabled, but still runs maintenance", async () => {
        config.Security.backendScriptingEnabled = false;

        startScheduler();
        await settleDbReady();
        await vi.advanceTimersByTimeAsync(7 * HOUR);

        expect(getNotesWithLabel).not.toHaveBeenCalled();
        expect(checkHiddenSubtree).toHaveBeenCalled();
    });

    it("does not schedule script timers in safe mode", async () => {
        process.env.TRILIUM_SAFE_MODE = "1";

        startScheduler();
        await settleDbReady();
        await vi.advanceTimersByTimeAsync(HOUR);

        expect(getNotesWithLabel).not.toHaveBeenCalled();
    });

    it("expires the protected session once it has timed out", async () => {
        isProtectedSessionAvailable.mockReturnValue(true);
        // Non-zero (the source guards on the date being truthy) but far in the past.
        getLastProtectedSessionOperationDate.mockReturnValue(1);
        getOptionInt.mockReturnValue(10); // 10s timeout
        const emit = vi.spyOn(events, "emit").mockImplementation(() => {});

        startScheduler();
        await settleDbReady();

        await vi.advanceTimersByTimeAsync(30 * SECOND);
        expect(resetDataKey).toHaveBeenCalled();
        // The event triggers the becca reload that re-encrypts in-memory titles;
        // manual logout emits it too, and the two paths must stay symmetric.
        expect(emit).toHaveBeenCalledWith(events.LEAVE_PROTECTED_SESSION);
        expect(reloadFrontend).toHaveBeenCalledWith(expect.any(String));
    });

    it("honors runOnInstance / runAtHour filters and tolerates malformed runAtHour", async () => {
        const runnable = buildBackendScript(); // no filters → always runs

        const wrongInstance = buildBackendScript();
        wrongInstance.getLabelValues = (name) => (name === "runOnInstance" ? ["some-other-instance"] : []);

        const malformed = buildBackendScript();
        malformed.getLabelValues = (name) => {
            if (name === "runAtHour") {
                throw new Error("not a number");
            }
            return [];
        };

        getNotesWithLabel.mockReturnValue([runnable, wrongInstance, malformed]);

        startScheduler();
        await settleDbReady();
        await vi.advanceTimersByTimeAsync(10 * SECOND); // backendStartup

        // runnable + malformed (its bad runAtHour is swallowed → treated as "no hour filter") run;
        // wrongInstance is filtered out because instanceName ("") is not in its runOnInstance list.
        expect(executeNoteNoException).toHaveBeenCalledTimes(2);
        expect(executeNoteNoException).toHaveBeenCalledWith(runnable, expect.anything());
        expect(executeNoteNoException).toHaveBeenCalledWith(malformed, expect.anything());
        expect(executeNoteNoException).not.toHaveBeenCalledWith(wrongInstance, expect.anything());
    });
});
