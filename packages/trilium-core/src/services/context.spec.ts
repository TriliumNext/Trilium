import type { EntityChange } from "@triliumnext/commons";
import { describe, expect, it, vi } from "vitest";

import {
    disableEntityEvents,
    enableEntityEvents,
    get,
    getAndClearEntityChangeIds,
    getComponentId,
    getContext,
    getHoistedNoteId,
    ignoreEntityChangeIds,
    init,
    isEntityEventsDisabled,
    isMigrationRunning,
    putEntityChange,
    set,
    setMigrationRunning,
    wrap
} from "./context.js";

/**
 * The real `ExecutionContext` is installed by `initializeCore` (run once in the
 * server spec `setup.ts`). It is backed by `cls-hooked`: each `init()` runs the
 * callback in a fresh namespace store, so state written inside one `init()`
 * block is isolated from other blocks — which keeps these tests independent
 * without needing `becca.reset()` or DB access.
 */

function makeEntityChange(id: string): EntityChange {
    return {
        id,
        entityName: "notes",
        entityId: "spec",
        hash: "h",
        isErased: false,
        utcDateChanged: "2026-01-01 00:00:00Z",
        isSynced: true
    } as unknown as EntityChange;
}

describe("context", () => {
    describe("getContext / init / get / set", () => {
        it("exposes the initialized context and round-trips values within an init scope", () => {
            const ctx = getContext();
            expect(typeof ctx.init).toBe("function");

            const returned = init(() => {
                set("specKey", 42);
                return get<number>("specKey");
            });

            // init returns whatever the callback returns.
            expect(returned).toBe(42);
        });

        it("isolates state between separate init scopes", () => {
            init(() => set("isolationKey", "first"));

            const seen = init(() => get<string>("isolationKey"));

            // cls-hooked starts a fresh store per init(), so the value set in
            // the previous scope must not leak into this one.
            expect(seen).toBeUndefined();
        });
    });

    describe("getHoistedNoteId", () => {
        it("defaults to 'root' and reflects an explicitly set value", () => {
            init(() => {
                expect(getHoistedNoteId()).toBe("root");
                set("hoistedNoteId", "noteABC");
                expect(getHoistedNoteId()).toBe("noteABC");
            });
        });
    });

    describe("getComponentId", () => {
        it("returns undefined by default and the stored component id once set", () => {
            init(() => {
                expect(getComponentId()).toBeUndefined();
                set("componentId", "comp-1");
                expect(getComponentId()).toBe("comp-1");
            });
        });
    });

    describe("entity event toggles", () => {
        it("are enabled by default and reflect disable/enable calls", () => {
            init(() => {
                expect(isEntityEventsDisabled()).toBe(false);

                disableEntityEvents();
                expect(isEntityEventsDisabled()).toBe(true);

                enableEntityEvents();
                expect(isEntityEventsDisabled()).toBe(false);
            });
        });
    });

    describe("migration flag", () => {
        it("is off by default and tracks setMigrationRunning, coercing to a boolean", () => {
            init(() => {
                expect(isMigrationRunning()).toBe(false);

                setMigrationRunning(true);
                expect(isMigrationRunning()).toBe(true);

                setMigrationRunning(false);
                expect(isMigrationRunning()).toBe(false);
            });
        });
    });

    describe("entity change tracking", () => {
        it("accumulates entity change ids and clears them on getAndClear", () => {
            init(() => {
                // No changes recorded yet -> empty list.
                expect(getAndClearEntityChangeIds()).toEqual([]);

                putEntityChange(makeEntityChange("ec-1"));
                putEntityChange(makeEntityChange("ec-2"));

                const ids = getAndClearEntityChangeIds();
                expect(ids).toEqual(["ec-1", "ec-2"]);

                // The list is cleared, so a second call returns nothing.
                expect(getAndClearEntityChangeIds()).toEqual([]);
            });
        });

        it("drops new entity changes once ignoreEntityChangeIds is set", () => {
            init(() => {
                putEntityChange(makeEntityChange("kept-1"));

                ignoreEntityChangeIds();

                // These must be ignored entirely.
                putEntityChange(makeEntityChange("ignored-1"));
                putEntityChange(makeEntityChange("ignored-2"));

                expect(getAndClearEntityChangeIds()).toEqual(["kept-1"]);
            });
        });
    });

    describe("wrap", () => {
        it("returns a thunk that runs the callback inside an init scope", () => {
            const callback = vi.fn(() => {
                set("wrappedKey", "wrapped-value");
            });

            const thunk = wrap(callback);
            expect(callback).not.toHaveBeenCalled();

            thunk();
            expect(callback).toHaveBeenCalledTimes(1);
        });

        it("swallows errors thrown by the callback instead of propagating them", () => {
            const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

            const thunk = wrap(() => {
                throw new Error("boom");
            });

            // wrap catches the error internally; the thunk must not throw.
            expect(() => thunk()).not.toThrow();
            expect(logSpy).toHaveBeenCalledTimes(1);
            expect(logSpy.mock.calls[0][0]).toContain("boom");

            logSpy.mockRestore();
        });
    });
});
