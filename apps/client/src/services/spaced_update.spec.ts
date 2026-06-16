import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import SpacedUpdate from "./spaced_update";

// Mock logError which is a global in Trilium
vi.stubGlobal("logError", vi.fn());

describe("SpacedUpdate", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("should only call updater once per interval even with multiple pending callbacks", async () => {
        const updater = vi.fn(async () => {
            // Simulate a slow network request - this is where the race condition occurs
            await new Promise((resolve) => setTimeout(resolve, 100));
        });

        const spacedUpdate = new SpacedUpdate(updater, 50);

        // Simulate rapid typing - each keystroke calls scheduleUpdate()
        // This queues multiple setTimeout callbacks due to recursive scheduleUpdate() calls
        for (let i = 0; i < 10; i++) {
            spacedUpdate.scheduleUpdate();
            // Small delay between keystrokes
            await vi.advanceTimersByTimeAsync(5);
        }

        // Advance time past the update interval to trigger the update
        await vi.advanceTimersByTimeAsync(100);

        // Let the "network request" complete and any pending callbacks run
        await vi.advanceTimersByTimeAsync(200);

        // The updater should have been called only ONCE, not multiple times
        // With the bug, multiple pending setTimeout callbacks would all pass the time check
        // during the async updater call and trigger multiple concurrent requests
        expect(updater).toHaveBeenCalledTimes(1);
    });

    it("should call updater again if changes occur during the update", async () => {
        const updater = vi.fn(async () => {
            await new Promise((resolve) => setTimeout(resolve, 50));
        });

        const spacedUpdate = new SpacedUpdate(updater, 30);

        // First update
        spacedUpdate.scheduleUpdate();
        await vi.advanceTimersByTimeAsync(40);

        // Schedule another update while the first one is in progress
        spacedUpdate.scheduleUpdate();

        // Let first update complete
        await vi.advanceTimersByTimeAsync(60);

        // Advance past the interval again for the second update
        await vi.advanceTimersByTimeAsync(100);

        // Should have been called twice - once for each distinct change period
        expect(updater).toHaveBeenCalledTimes(2);
    });

    it("should restore changed flag on error so retry can happen", async () => {
        const updater = vi.fn()
            .mockRejectedValueOnce(new Error("Network error"))
            .mockResolvedValue(undefined);

        const spacedUpdate = new SpacedUpdate(updater, 50);

        spacedUpdate.scheduleUpdate();

        // Advance to trigger first update (which will fail)
        await vi.advanceTimersByTimeAsync(60);

        // The error should have restored the changed flag, so scheduling again should work
        spacedUpdate.scheduleUpdate();
        await vi.advanceTimersByTimeAsync(60);

        expect(updater).toHaveBeenCalledTimes(2);
    });

    describe("updateNowIfNecessary", () => {
        it("calls updater and emits saving/saved states when there are pending changes", async () => {
            const states: string[] = [];
            const updater = vi.fn(async () => {});
            const spacedUpdate = new SpacedUpdate(updater, 50, (s) => states.push(s));

            // Mark as changed without triggering the timer-based update.
            spacedUpdate.scheduleUpdate();

            await spacedUpdate.updateNowIfNecessary();

            expect(updater).toHaveBeenCalledTimes(1);
            expect(states).toEqual(["unsaved", "saving", "saved"]);
        });

        it("does nothing when there are no pending changes", async () => {
            const updater = vi.fn(async () => {});
            const spacedUpdate = new SpacedUpdate(updater, 50);

            await spacedUpdate.updateNowIfNecessary();

            expect(updater).not.toHaveBeenCalled();
        });

        it("re-marks changed, emits error and rethrows when the updater fails", async () => {
            const states: string[] = [];
            let shouldFail = true;
            const updater = vi.fn(async () => {
                if (shouldFail) {
                    throw new Error("boom");
                }
            });
            const spacedUpdate = new SpacedUpdate(updater, 50, (s) => states.push(s));

            spacedUpdate.scheduleUpdate();

            await expect(spacedUpdate.updateNowIfNecessary()).rejects.toThrow("boom");
            expect(states).toEqual(["unsaved", "saving", "error"]);

            // changed flag restored -> a subsequent successful flush runs the updater again
            shouldFail = false;
            await spacedUpdate.updateNowIfNecessary();
            expect(updater).toHaveBeenCalledTimes(2);
        });
    });

    describe("isAllSavedAndTriggerUpdate", () => {
        it("returns false and flushes pending changes when there are changes", async () => {
            const updater = vi.fn(async () => {});
            const spacedUpdate = new SpacedUpdate(updater, 50);

            spacedUpdate.scheduleUpdate();

            expect(spacedUpdate.isAllSavedAndTriggerUpdate()).toBe(false);

            await vi.runAllTimersAsync();
            expect(updater).toHaveBeenCalledTimes(1);
        });

        it("returns true when nothing is pending", () => {
            const updater = vi.fn(async () => {});
            const spacedUpdate = new SpacedUpdate(updater, 50);

            expect(spacedUpdate.isAllSavedAndTriggerUpdate()).toBe(true);
            expect(updater).not.toHaveBeenCalled();
        });

        it("returns the pre-flush saved state synchronously and kicks off the un-awaited flush", () => {
            const updater = vi.fn(async () => {});
            const spacedUpdate = new SpacedUpdate(updater, 50);

            spacedUpdate.scheduleUpdate(); // pending change

            // `allSaved` is computed from `changed` BEFORE the (un-awaited) updateNowIfNecessary()
            // flush runs, so the call returns false for a pending change and never throws.
            let result: boolean;
            expect(() => {
                result = spacedUpdate.isAllSavedAndTriggerUpdate();
            }).not.toThrow();
            expect(result!).toBe(false);

            // The flush was started synchronously (updater invoked) rather than awaited.
            expect(updater).toHaveBeenCalledTimes(1);
        });

        it("restores the changed flag when an update fails so a later flush retries", async () => {
            const states: string[] = [];
            let shouldFail = true;
            const updater = vi.fn(async () => {
                if (shouldFail) {
                    throw new Error("flush boom");
                }
            });
            const spacedUpdate = new SpacedUpdate(updater, 50, (s) => states.push(s));

            spacedUpdate.scheduleUpdate();

            // Await the flush directly (the same code path isAllSavedAndTriggerUpdate fires
            // and forgets) so the rejection is observed here instead of floating.
            await expect(spacedUpdate.updateNowIfNecessary()).rejects.toThrow("flush boom");
            expect(states).toContain("error");

            // The catch restored `changed`, so a subsequent flush retries the updater and saves.
            shouldFail = false;
            await spacedUpdate.updateNowIfNecessary();
            expect(updater).toHaveBeenCalledTimes(2);
            expect(states).toContain("saved");
        });
    });

    describe("resetUpdateTimer / setUpdateInterval", () => {
        it("resetUpdateTimer defers the update past the new last-updated time", async () => {
            const updater = vi.fn(async () => {});
            const spacedUpdate = new SpacedUpdate(updater, 50);

            spacedUpdate.scheduleUpdate();
            // Keep resetting the timer so the interval never elapses.
            await vi.advanceTimersByTimeAsync(40);
            spacedUpdate.resetUpdateTimer();
            await vi.advanceTimersByTimeAsync(40);
            spacedUpdate.resetUpdateTimer();
            await vi.advanceTimersByTimeAsync(40);

            // Still within the interval since the last reset -> no update yet.
            expect(updater).not.toHaveBeenCalled();

            // Now let the interval fully elapse.
            await vi.advanceTimersByTimeAsync(60);
            expect(updater).toHaveBeenCalledTimes(1);
        });

        it("setUpdateInterval changes how long before the update fires", async () => {
            const updater = vi.fn(async () => {});
            const spacedUpdate = new SpacedUpdate(updater, 50);

            spacedUpdate.setUpdateInterval(500);
            spacedUpdate.scheduleUpdate();

            // Past the old interval but not the new one.
            await vi.advanceTimersByTimeAsync(100);
            expect(updater).not.toHaveBeenCalled();

            await vi.advanceTimersByTimeAsync(500);
            expect(updater).toHaveBeenCalledTimes(1);
        });
    });

    describe("keyed bindings (prepare/commit)", () => {
        function setupKeyedHarness() {
            // Stand-in for a reused editor: holds whichever note's content was last loaded.
            const editor = { content: "A content" };
            const commits: { key: string; data: string }[] = [];
            const makeBinding = (key: string) => ({
                key,
                prepare: () => editor.content,
                commit: async (data: string) => {
                    commits.push({ key, data });
                }
            });
            return { editor, commits, makeBinding };
        }

        it("commits a pending change under the binding that scheduled it, even after rebinding", async () => {
            const { editor, commits, makeBinding } = setupKeyedHarness();
            const spacedUpdate = new SpacedUpdate<string>(makeBinding("A"), 50);

            // A change is pending against A when the consumer rebinds to B; the snapshot is
            // taken with A's binding before the swap, so it can never be saved under B.
            spacedUpdate.scheduleUpdate();
            const b = makeBinding("B");
            spacedUpdate.rebind(b.key, b.prepare, b.commit);
            editor.content = "B content"; // B's content arrives only after the rebind

            await vi.runAllTimersAsync();
            expect(commits).toEqual([{ key: "A", data: "A content" }]);

            // A change made after the rebind saves under the new binding.
            spacedUpdate.scheduleUpdate();
            await vi.runAllTimersAsync();
            expect(commits).toEqual([
                { key: "A", data: "A content" },
                { key: "B", data: "B content" }
            ]);
        });

        it("retries a failed commit with the frozen snapshot, not the live state", async () => {
            const editor = { content: "typed into A" };
            const commits: string[] = [];
            let failuresLeft = 1;
            const spacedUpdate = new SpacedUpdate<string>({
                key: "A",
                prepare: () => editor.content,
                commit: async (data) => {
                    if (failuresLeft > 0) {
                        failuresLeft--;
                        throw new Error("offline");
                    }
                    commits.push(data);
                }
            }, 50);

            spacedUpdate.scheduleUpdate();
            await vi.advanceTimersByTimeAsync(60); // first attempt fails

            // The live state moves on (e.g. another note's content is loaded into the editor),
            // but the retry must persist the snapshot taken when the change was flushed.
            editor.content = "now showing B";
            await vi.advanceTimersByTimeAsync(200); // backoff retry fires

            expect(commits).toEqual(["typed into A"]);
        });

        it("supersedes a queued failed snapshot with a newer one for the same key", async () => {
            const editor = { content: "v1" };
            const commits: string[] = [];
            let failuresLeft = 1;
            const spacedUpdate = new SpacedUpdate<string>({
                key: "A",
                prepare: () => editor.content,
                commit: async (data) => {
                    if (failuresLeft > 0) {
                        failuresLeft--;
                        throw new Error("offline");
                    }
                    commits.push(data);
                }
            }, 50);

            spacedUpdate.scheduleUpdate();
            await vi.advanceTimersByTimeAsync(60); // "v1" fails and stays queued

            editor.content = "v2";
            spacedUpdate.scheduleUpdate();
            await vi.advanceTimersByTimeAsync(300);

            // The newer snapshot replaced the queued one: a single save with the latest data,
            // not a stale "v1" overwriting "v2".
            expect(commits).toEqual(["v2"]);
        });

        it("does not report all-saved while an asynchronous snapshot from rebind is still being captured", async () => {
            let resolvePrepare: (value: string) => void = () => {};
            const commits: { key: string; data: string }[] = [];
            const spacedUpdate = new SpacedUpdate<string>({
                key: "A",
                prepare: () => new Promise<string>((resolve) => {
                    resolvePrepare = resolve;
                }),
                commit: async (data) => {
                    commits.push({ key: "A", data });
                }
            }, 50);

            spacedUpdate.scheduleUpdate();
            spacedUpdate.rebind("B", () => "B content", async (data) => {
                commits.push({ key: "B", data });
            });

            // The old binding's snapshot is still being captured, so nothing may be
            // reported as saved yet (relevant for the beforeunload warning).
            expect(spacedUpdate.isAllSavedAndTriggerUpdate()).toBe(false);

            resolvePrepare("typed into A");
            await spacedUpdate.updateNowIfNecessary();

            expect(commits).toEqual([{ key: "A", data: "typed into A" }]);
        });

        it("schedules a retry when an asynchronous snapshot rejects, so the change is not stranded", async () => {
            let rejectPrepare: (e: Error) => void = () => {};
            const commits: { key: string; data: string }[] = [];
            const spacedUpdate = new SpacedUpdate<string>({
                key: "A",
                prepare: () => new Promise<string>((_, reject) => {
                    rejectPrepare = reject;
                }),
                commit: async (data) => {
                    commits.push({ key: "A", data });
                }
            }, 50);

            spacedUpdate.scheduleUpdate();
            spacedUpdate.rebind("B", () => "B content", async (data) => {
                commits.push({ key: "B", data });
            });

            // The debounce timer fires while the snapshot is still being captured and goes idle.
            await vi.advanceTimersByTimeAsync(60);
            expect(commits).toEqual([]);

            // The capture fails: the restored change must be retried (under the current
            // binding), not stranded until the next keystroke.
            rejectPrepare(new Error("editor crashed"));
            await vi.advanceTimersByTimeAsync(100);

            expect(commits).toEqual([{ key: "B", data: "B content" }]);
        });

        it("keeps growing the retry backoff while a commit keeps failing, even if a sibling key succeeds", async () => {
            const failingAttempts: number[] = [];
            const spacedUpdate = new SpacedUpdate<string>({
                key: "A",
                prepare: () => "A content",
                commit: async () => {
                    failingAttempts.push(Date.now());
                    throw new Error("offline");
                }
            }, 50);

            // First attempt fails at ~50ms and schedules a retry.
            spacedUpdate.scheduleUpdate();
            await vi.advanceTimersByTimeAsync(60);
            expect(failingAttempts).toHaveLength(1);

            // A change for another note succeeds within the same retry pass.
            spacedUpdate.rebind("B", () => "B content", async () => {});
            spacedUpdate.scheduleUpdate();

            await vi.advanceTimersByTimeAsync(1000);

            // The sibling success must not reset the failing key's backoff: the gaps
            // between consecutive failing attempts keep doubling.
            expect(failingAttempts.length).toBeGreaterThanOrEqual(3);
            const gaps = failingAttempts.slice(1).map((t, i) => t - failingAttempts[i]);
            for (let i = 1; i < gaps.length; i++) {
                expect(gaps[i]).toBeGreaterThan(gaps[i - 1]);
            }
        });

        it("supports an asynchronous prepare", async () => {
            const commits: string[] = [];
            const spacedUpdate = new SpacedUpdate<string>({
                key: "A",
                prepare: () => Promise.resolve("async snapshot"),
                commit: async (data) => {
                    commits.push(data);
                }
            }, 50);

            spacedUpdate.scheduleUpdate();
            await spacedUpdate.updateNowIfNecessary();

            expect(commits).toEqual(["async snapshot"]);
        });
    });

    describe("allowUpdateWithoutChange", () => {
        it("suppresses scheduleUpdate while the callback runs and re-enables it afterwards", async () => {
            const updater = vi.fn(async () => {});
            const spacedUpdate = new SpacedUpdate(updater, 50);

            await spacedUpdate.allowUpdateWithoutChange(async () => {
                // scheduleUpdate is a no-op while change is forbidden.
                spacedUpdate.scheduleUpdate();
            });

            await vi.runAllTimersAsync();
            expect(updater).not.toHaveBeenCalled();

            // After the callback, scheduling works again.
            spacedUpdate.scheduleUpdate();
            await vi.runAllTimersAsync();
            expect(updater).toHaveBeenCalledTimes(1);
        });

        it("re-enables scheduling even when the callback throws", async () => {
            const updater = vi.fn(async () => {});
            const spacedUpdate = new SpacedUpdate(updater, 50);

            await expect(
                spacedUpdate.allowUpdateWithoutChange(async () => {
                    throw new Error("callback failed");
                })
            ).rejects.toThrow("callback failed");

            // changeForbidden was reset in finally -> scheduling works.
            spacedUpdate.scheduleUpdate();
            await vi.runAllTimersAsync();
            expect(updater).toHaveBeenCalledTimes(1);
        });
    });
});
