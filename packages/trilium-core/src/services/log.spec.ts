import { afterEach, describe, expect, it, vi } from "vitest";

import LogService from "./log.js";

describe("LogService (base)", () => {
    // The server/standalone hosts override LogService with file-based loggers, so
    // the base implementation is never exercised by the bootstrap. Instantiate it
    // directly and assert it forwards to the console.
    afterEach(() => vi.restoreAllMocks());

    it("forwards log/info/error to the console", () => {
        const service = new LogService();
        const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        service.log("hello");
        service.info("info-msg");
        service.error("boom");

        expect(logSpy).toHaveBeenCalledWith("hello");
        expect(infoSpy).toHaveBeenCalledWith("info-msg");
        expect(errorSpy).toHaveBeenCalledWith("ERROR: ", "boom");
    });

    it("getLogContents returns null and request() is a no-op by default", () => {
        const service = new LogService();
        expect(service.getLogContents()).toBeNull();
        // Should not throw.
        service.request({ url: "/x", method: "GET" }, { statusCode: 200 }, 5, 123);
    });

    it("banner ignores empty messages but renders a box for content (incl. word wrapping)", () => {
        const service = new LogService();
        const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

        service.banner(undefined);
        expect(logSpy).not.toHaveBeenCalled();

        // Single short word: exercises the no-wrap path.
        service.banner("ready");
        expect(logSpy).toHaveBeenCalledOnce();
        const shortBox = logSpy.mock.calls[0][0] as string;
        expect(shortBox).toContain("ready");
        expect(shortBox).toContain("╔");
        expect(shortBox).toContain("╝");

        logSpy.mockClear();

        // A leading word longer than the terminal width forces the wrap branches:
        // an oversized first word (empty `current`) followed by more words that
        // overflow and flush the accumulated line.
        const longWord = "x".repeat(120);
        service.banner(`${longWord} some additional words that will wrap onto another line here`);
        const wrappedBox = logSpy.mock.calls[0][0] as string;
        expect(wrappedBox).toContain(longWord);
        expect(wrappedBox.split("\n").length).toBeGreaterThan(4);
    });
});

describe("log module singleton", () => {
    it("getLog throws before init and initLog() falls back to a default LogService", async () => {
        vi.resetModules();
        const mod = await import("./log.js");

        expect(() => mod.getLog()).toThrow(/not initialized/);

        mod.initLog();
        expect(mod.getLog()).toBeInstanceOf(mod.default);
    });
});
