import { beforeEach, describe, expect, it, vi } from "vitest";

const { getLogMock, crashMock, sendMessageToAllClientsMock } = vi.hoisted(() => ({
    getLogMock: { error: vi.fn() },
    crashMock: vi.fn(),
    sendMessageToAllClientsMock: vi.fn()
}));

vi.mock("@triliumnext/core", async () => {
    // the real extractor, so the tests cover how non-Error throws actually get rendered
    const { safeExtractMessageAndStackFromError } = await vi.importActual<typeof import("@triliumnext/core/src/services/utils/index.js")>(
        "@triliumnext/core/src/services/utils/index.js"
    );

    return {
        getLog: () => getLogMock,
        getPlatform: () => ({ crash: crashMock }),
        utils: { safeExtractMessageAndStackFromError },
        ws: { sendMessageToAllClients: sendMessageToAllClientsMock }
    };
});

import { createErrorThrottle } from "./process_errors.js";

/**
 * Both the readiness flag and the throttle are module-level state, so each case gets its own instance of
 * the module rather than inheriting whatever the previous one left behind.
 */
async function freshModule() {
    vi.resetModules();
    return await import("./process_errors.js");
}

describe("createErrorThrottle", () => {
    const options = { maxPerMessage: 3, windowMs: 60_000, maxTrackedMessages: 3 };

    it("reports up to the cap, flags the last one, then goes quiet until the window rolls over", () => {
        const throttle = createErrorThrottle(options);

        expect(throttle.check("boom", 0)).toEqual({ report: true, lastBeforeSuppression: false });
        expect(throttle.check("boom", 10)).toEqual({ report: true, lastBeforeSuppression: false });
        expect(throttle.check("boom", 20)).toEqual({ report: true, lastBeforeSuppression: true });
        expect(throttle.check("boom", 30)).toEqual({ report: false, lastBeforeSuppression: false });
        expect(throttle.check("boom", 59_999)).toEqual({ report: false, lastBeforeSuppression: false });

        // a fresh window starts once the old one has fully elapsed
        expect(throttle.check("boom", 60_000)).toEqual({ report: true, lastBeforeSuppression: false });
    });

    it("throttles each message independently and flags the last one when the cap is 1", () => {
        const throttle = createErrorThrottle(options);
        const single = createErrorThrottle({ ...options, maxPerMessage: 1 });

        throttle.check("first", 0);
        throttle.check("first", 1);
        throttle.check("first", 2);
        expect(throttle.check("first", 3).report).toBe(false);
        expect(throttle.check("second", 3).report).toBe(true);

        expect(single.check("only-once", 0)).toEqual({ report: true, lastBeforeSuppression: true });
        expect(single.check("only-once", 1).report).toBe(false);
    });

    it("drops its bookkeeping once too many distinct messages are tracked", () => {
        const throttle = createErrorThrottle(options);

        // Messages embedding entity ids are all distinct, so the table would otherwise grow without bound.
        throttle.check("Note 'a' doesn't exist.", 0);
        throttle.check("Note 'b' doesn't exist.", 0);
        throttle.check("Note 'c' doesn't exist.", 0);

        // The fourth distinct message clears the table, which also resets the earlier windows.
        expect(throttle.check("Note 'd' doesn't exist.", 0).report).toBe(true);
        expect(throttle.check("Note 'a' doesn't exist.", 0)).toEqual({ report: true, lastBeforeSuppression: false });
    });
});

describe("reportProcessError", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, "error").mockImplementation(() => {});
    });

    it("crashes while the app is still starting, and only informs once it is up", async () => {
        const { markAppReady, reportProcessError, UNCAUGHT_EXCEPTION } = await freshModule();

        reportProcessError(UNCAUGHT_EXCEPTION, new Error("db is locked"));

        expect(crashMock).toHaveBeenCalledOnce();
        expect(crashMock.mock.calls[0][0]).toContain("Uncaught exception: db is locked");
        expect(sendMessageToAllClientsMock).not.toHaveBeenCalled();

        markAppReady();
        reportProcessError(UNCAUGHT_EXCEPTION, new Error("Note 'XvA0rKdu1238' doesn't exist."));

        // no second crash, and the failure reaches the user with the stack for a bug report
        expect(crashMock).toHaveBeenCalledOnce();
        expect(sendMessageToAllClientsMock).toHaveBeenCalledWith({
            type: "unhandled-error",
            message: "Note 'XvA0rKdu1238' doesn't exist.",
            stack: expect.stringContaining("Note 'XvA0rKdu1238' doesn't exist.")
        });
        expect(getLogMock.error).toHaveBeenCalledTimes(2);
        expect(getLogMock.error.mock.calls[1][0]).toContain("Note 'XvA0rKdu1238' doesn't exist.");
    });

    it("keeps a startup unhandled rejection non-fatal, as it has always been", async () => {
        const { reportProcessError, UNHANDLED_REJECTION } = await freshModule();

        reportProcessError(UNHANDLED_REJECTION, new Error("some floating promise"));

        // logged, but neither fatal (the app still boots) nor surfaced (nobody is connected yet)
        expect(getLogMock.error).toHaveBeenCalledOnce();
        expect(crashMock).not.toHaveBeenCalled();
        expect(sendMessageToAllClientsMock).not.toHaveBeenCalled();
    });

    it("survives a thrown non-Error and a logger that is not usable yet", async () => {
        const { markAppReady, reportProcessError, UNHANDLED_REJECTION } = await freshModule();
        markAppReady();
        getLogMock.error.mockImplementationOnce(() => {
            throw new Error("log service not initialized");
        });

        expect(() => reportProcessError(UNHANDLED_REJECTION, "just a string")).not.toThrow();

        // a thrown string carries no stack, so the client gets nothing to put behind the details step
        expect(sendMessageToAllClientsMock).toHaveBeenCalledWith({
            type: "unhandled-error",
            message: "just a string",
            stack: undefined
        });
    });

    it("stops reporting a message that keeps failing, warning once that it will", async () => {
        const { markAppReady, reportProcessError, UNCAUGHT_EXCEPTION } = await freshModule();
        markAppReady();

        for (let i = 0; i < 10; i++) {
            reportProcessError(UNCAUGHT_EXCEPTION, new Error("every second"));
        }

        expect(sendMessageToAllClientsMock).toHaveBeenCalledTimes(3);
        expect(getLogMock.error.mock.calls[2][0]).toContain("will not be reported");
    });
});
