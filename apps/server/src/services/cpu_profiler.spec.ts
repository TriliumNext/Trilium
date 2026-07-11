import fs from "fs";
import type inspector from "inspector";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { startCpuProfiler, writeCpuProfile } from "./cpu_profiler.js";

// A fake inspector session so the V8 inspector is never actually attached. `post` is driven by the test to
// simulate the profiler stopping (with or without an error, or never at all).
type PostImpl = (method: string, callback: (err: Error | null, result: { profile: unknown }) => void) => void;

function fakeSession(post: PostImpl) {
    return {
        post: vi.fn(post),
        connect: vi.fn(),
        disconnect: vi.fn()
    };
}

const inspectorState = vi.hoisted(() => ({
    instances: [] as Array<{ connect: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }>
}));

vi.mock("inspector", () => {
    class Session {
        connect = vi.fn();
        post = vi.fn();
        disconnect = vi.fn();
        constructor() {
            inspectorState.instances.push(this);
        }
    }
    return { default: { Session } };
});

describe("writeCpuProfile", () => {
    beforeEach(() => {
        vi.spyOn(fs, "mkdirSync").mockImplementation(() => undefined);
        vi.spyOn(fs, "writeFileSync").mockImplementation(() => undefined);
        vi.spyOn(console, "log").mockImplementation(() => undefined);
        vi.spyOn(console, "error").mockImplementation(() => undefined);
    });

    afterEach(() => vi.restoreAllMocks());

    it("calls done immediately and writes nothing when profiling is disabled (null session)", () => {
        const done = vi.fn();
        writeCpuProfile(null, done);
        expect(done).toHaveBeenCalledOnce();
        expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it("stops the profiler, writes the .cpuprofile, disconnects and calls done", () => {
        const profile = { nodes: [1, 2, 3] };
        const session = fakeSession((method, cb) => {
            expect(method).toBe("Profiler.stop");
            cb(null, { profile });
        });
        const done = vi.fn();

        writeCpuProfile(session as unknown as inspector.Session, done);

        expect(fs.mkdirSync).toHaveBeenCalledWith(expect.stringContaining("profiles"), { recursive: true });
        expect(fs.writeFileSync).toHaveBeenCalledWith(expect.stringContaining(".cpuprofile"), JSON.stringify(profile));
        expect(session.disconnect).toHaveBeenCalledOnce();
        expect(done).toHaveBeenCalledOnce();
    });

    it("still disconnects and calls done when the profiler reports an error (no file written)", () => {
        const session = fakeSession((_method, cb) => cb(new Error("profiler failed"), { profile: {} }));
        const done = vi.fn();

        writeCpuProfile(session as unknown as inspector.Session, done);

        expect(fs.writeFileSync).not.toHaveBeenCalled();
        expect(console.error).toHaveBeenCalled();
        expect(session.disconnect).toHaveBeenCalledOnce();
        expect(done).toHaveBeenCalledOnce();
    });

    it("swallows a write failure but still disconnects and calls done", () => {
        vi.mocked(fs.writeFileSync).mockImplementation(() => {
            throw new Error("disk full");
        });
        const session = fakeSession((_method, cb) => cb(null, { profile: {} }));
        const done = vi.fn();

        writeCpuProfile(session as unknown as inspector.Session, done);

        expect(console.error).toHaveBeenCalled();
        expect(session.disconnect).toHaveBeenCalledOnce();
        expect(done).toHaveBeenCalledOnce();
    });

    it("falls back to calling done after a grace period when the profiler never responds", () => {
        vi.useFakeTimers();
        try {
            // post never invokes its callback, simulating a stuck profiler.
            const session = fakeSession(() => {});
            const done = vi.fn();

            writeCpuProfile(session as unknown as inspector.Session, done);
            expect(done).not.toHaveBeenCalled();

            vi.advanceTimersByTime(3000);
            expect(done).toHaveBeenCalledOnce();
        } finally {
            vi.useRealTimers();
        }
    });
});

describe("startCpuProfiler", () => {
    const original = process.env.TRILIUM_PROFILE;

    beforeEach(() => {
        inspectorState.instances.length = 0;
        vi.spyOn(console, "log").mockImplementation(() => undefined);
    });

    afterEach(() => {
        if (original === undefined) {
            delete process.env.TRILIUM_PROFILE;
        } else {
            process.env.TRILIUM_PROFILE = original;
        }
        vi.restoreAllMocks();
    });

    it("returns null and creates no session when TRILIUM_PROFILE is unset", () => {
        delete process.env.TRILIUM_PROFILE;
        expect(startCpuProfiler()).toBeNull();
        expect(inspectorState.instances).toHaveLength(0);
    });

    it("connects and starts the profiler when TRILIUM_PROFILE is set", () => {
        process.env.TRILIUM_PROFILE = "1";
        const session = startCpuProfiler();

        expect(session).not.toBeNull();
        expect(inspectorState.instances).toHaveLength(1);
        const created = inspectorState.instances[0];
        expect(created.connect).toHaveBeenCalledOnce();
        // Profiler.enable then Profiler.start.
        expect(created.post).toHaveBeenCalledWith("Profiler.enable", expect.any(Function));
    });

    it("drives Profiler.enable then Profiler.start in sequence", () => {
        process.env.TRILIUM_PROFILE = "1";
        // Make each post() invoke its callback so the nested start() call fires too.
        startCpuProfiler();
        const created = inspectorState.instances[0];
        created.post.mock.calls.find(([method]) => method === "Profiler.enable")?.[1]();
        expect(created.post).toHaveBeenCalledWith("Profiler.start", expect.any(Function));
    });
});
