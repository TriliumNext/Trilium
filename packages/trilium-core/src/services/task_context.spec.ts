import type { TaskData, TaskResult } from "@triliumnext/commons";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

import TaskContext from "./task_context.js";
import ws from "./ws.js";

// task_context's only runtime side effect is ws.sendMessageToAllClients, which we
// spy on so we can assert the WebSocket messages it emits without a real server.
let sendMessageToAllClients: MockInstance;

const importData: TaskData<"importNotes"> = { safeImport: true };
const importResult: TaskResult<"importNotes"> = { importedNoteId: "abc123" };

describe("TaskContext", () => {
    beforeEach(() => {
        sendMessageToAllClients = vi
            .spyOn(ws, "sendMessageToAllClients")
            .mockImplementation(() => {});
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    describe("construction", () => {
        it("emits an initial progress message on creation with the task metadata", () => {
            new TaskContext("ctor-1", "importNotes", importData);

            expect(sendMessageToAllClients).toHaveBeenCalledTimes(1);
            expect(sendMessageToAllClients).toHaveBeenCalledWith({
                type: "taskProgressCount",
                taskId: "ctor-1",
                taskType: "importNotes",
                data: importData,
                // progressCount starts at -1 and is incremented immediately on construction.
                progressCount: 0
            });
        });

        it("exposes the provided data and a default noteDeletionHandlerTriggered flag", () => {
            const ctx = new TaskContext("ctor-2", "importNotes", importData);

            expect(ctx.data).toBe(importData);
            expect(ctx.noteDeletionHandlerTriggered).toBe(false);
        });

        it("does not emit any message for the reserved no-progress-reporting task id", () => {
            new TaskContext("no-progress-reporting", "importNotes", importData);

            expect(sendMessageToAllClients).not.toHaveBeenCalled();
        });
    });

    describe("increaseProgressCount", () => {
        it("throttles progress messages to at most once per 300ms window", () => {
            vi.useFakeTimers();
            // lastSentCountTs starts at 0, so the constructor's first send only fires
            // when the clock is already >= 300ms past the epoch (always true with the
            // real wall clock); anchor the fake clock past that boundary to match.
            vi.setSystemTime(1_000);

            // Construction sends the first message (progressCount 0).
            const ctx = new TaskContext("throttle-1", "importNotes", importData);
            expect(sendMessageToAllClients).toHaveBeenCalledTimes(1);

            // Still inside the 300ms window since the last send: increments are coalesced.
            vi.setSystemTime(1_100);
            ctx.increaseProgressCount();
            vi.setSystemTime(1_299);
            ctx.increaseProgressCount();
            expect(sendMessageToAllClients).toHaveBeenCalledTimes(1);

            // Crossing the window boundary flushes a message carrying the accumulated count.
            vi.setSystemTime(1_300);
            ctx.increaseProgressCount();
            expect(sendMessageToAllClients).toHaveBeenCalledTimes(2);
            expect(sendMessageToAllClients).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    type: "taskProgressCount",
                    taskId: "throttle-1",
                    // 0 (ctor) + 3 increments = 3.
                    progressCount: 3
                })
            );
        });

        it("never sends progress messages for the reserved no-progress-reporting id", () => {
            vi.useFakeTimers();
            vi.setSystemTime(0);

            const ctx = new TaskContext("no-progress-reporting", "importNotes", importData);
            vi.setSystemTime(10_000);
            ctx.increaseProgressCount();
            ctx.increaseProgressCount();

            expect(sendMessageToAllClients).not.toHaveBeenCalled();
        });

        it("includes the total once set, and omits it until then", () => {
            vi.useFakeTimers();
            vi.setSystemTime(1_000);

            const ctx = new TaskContext("total-1", "importNotes", importData);
            // The constructor's first message has no total yet.
            expect(sendMessageToAllClients).toHaveBeenLastCalledWith(expect.not.objectContaining({ totalCount: expect.anything() }));

            ctx.setTotalCount(10);
            vi.setSystemTime(1_300);
            ctx.increaseProgressCount();

            expect(sendMessageToAllClients).toHaveBeenLastCalledWith(expect.objectContaining({ progressCount: 1, totalCount: 10 }));
        });
    });

    describe("setPhase", () => {
        it("tags subsequent progress messages with the phase and flushes the next one immediately", () => {
            vi.useFakeTimers();
            vi.setSystemTime(1_000);

            const ctx = new TaskContext("phase-1", "importNotes", importData);
            // The constructor's first message carries no phase.
            expect(sendMessageToAllClients).toHaveBeenLastCalledWith(expect.not.objectContaining({ phase: expect.anything() }));

            // setPhase resets the throttle, so the very next increment sends even within the 300ms window.
            ctx.setPhase("extracting");
            vi.setSystemTime(1_100);
            ctx.increaseProgressCount();
            expect(sendMessageToAllClients).toHaveBeenLastCalledWith(expect.objectContaining({ phase: "extracting" }));

            ctx.setPhase("processing");
            vi.setSystemTime(1_200);
            ctx.increaseProgressCount();
            expect(sendMessageToAllClients).toHaveBeenLastCalledWith(expect.objectContaining({ phase: "processing" }));
        });
    });

    describe("reportError", () => {
        it("broadcasts a taskError message with the failure text and task metadata", () => {
            const ctx = new TaskContext("err-1", "importNotes", importData);
            sendMessageToAllClients.mockClear();

            ctx.reportError("something broke");

            expect(sendMessageToAllClients).toHaveBeenCalledTimes(1);
            expect(sendMessageToAllClients).toHaveBeenCalledWith({
                type: "taskError",
                taskId: "err-1",
                taskType: "importNotes",
                data: importData,
                message: "something broke"
            });
        });
    });

    describe("taskSucceeded", () => {
        it("broadcasts a taskSucceeded message carrying the result payload", () => {
            const ctx = new TaskContext("ok-1", "importNotes", importData);
            sendMessageToAllClients.mockClear();

            ctx.taskSucceeded(importResult);

            expect(sendMessageToAllClients).toHaveBeenCalledTimes(1);
            expect(sendMessageToAllClients).toHaveBeenCalledWith({
                type: "taskSucceeded",
                taskId: "ok-1",
                taskType: "importNotes",
                data: importData,
                result: importResult
            });
        });
    });

    describe("getInstance", () => {
        it("creates a single cached context per task id and reuses it on later lookups", () => {
            const first = TaskContext.getInstance("singleton-1", "importNotes", { safeImport: true });
            // Creating the instance emits its initial progress message.
            expect(sendMessageToAllClients).toHaveBeenCalledTimes(1);

            // A second lookup with the same id returns the cached instance without
            // constructing a new one (no additional initial-progress message), and
            // the originally cached data is preserved (the new data arg is ignored).
            const second = TaskContext.getInstance("singleton-1", "importNotes", { safeImport: false });
            expect(second).toBe(first);
            expect(second.data).toEqual({ safeImport: true });
            expect(sendMessageToAllClients).toHaveBeenCalledTimes(1);

            // A different id yields a distinct instance with its own initial message.
            const other = TaskContext.getInstance("singleton-2", "importNotes", { safeImport: true });
            expect(other).not.toBe(first);
            expect(sendMessageToAllClients).toHaveBeenCalledTimes(2);
        });
    });
});
