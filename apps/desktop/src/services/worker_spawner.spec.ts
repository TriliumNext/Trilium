import { EventEmitter } from "events";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { utilityProcessSpawner } from "./worker_spawner";

const h = vi.hoisted(() => ({ fork: vi.fn() }));

vi.mock("electron", () => ({ utilityProcess: { fork: h.fork } }));

class FakeUtilityProcess extends EventEmitter {
    pid: number | undefined = 321;
    postMessage = vi.fn();
    kill = vi.fn(() => true);
}

const ENV = {
    PATH: "/bin",
    NODE_OPTIONS: "--import tsx",
    TRILIUM_SAFE_MODE: "1",
    TRILIUM_START_NOTE_ID: "root"
};

let child: FakeUtilityProcess;

beforeEach(() => {
    h.fork.mockReset();
    child = new FakeUtilityProcess();
    h.fork.mockReturnValue(child);
});

describe("utilityProcessSpawner", () => {
    it("forks a bundled entry without loader flags, NODE_OPTIONS or the boot-writing variables", () => {
        utilityProcessSpawner("/app.asar/image_worker.cjs", {
            execArgv: [ "--import", "tsx", "--require=hook.cjs", "--max-old-space-size=2048" ],
            env: ENV,
            serviceName: "Trilium image worker"
        });

        expect(h.fork).toHaveBeenCalledWith("/app.asar/image_worker.cjs", [], {
            execArgv: [ "--js-flags=--max-old-space-size=2048" ],
            env: { PATH: "/bin" },
            serviceName: "Trilium image worker"
        });
    });

    it("keeps the tsx loader for a source entry, which only exists in development", () => {
        utilityProcessSpawner("/src/image_worker.ts", {
            execArgv: [ "--max-old-space-size=2048" ],
            env: ENV,
            serviceName: "Trilium image worker"
        });

        expect(h.fork).toHaveBeenCalledWith("/src/image_worker.ts", [], {
            execArgv: [ "--js-flags=--max-old-space-size=2048" ],
            env: { PATH: "/bin", NODE_OPTIONS: "--import tsx" },
            serviceName: "Trilium image worker"
        });
    });

    it("passes V8 heap flags through --js-flags, the only form a utility process applies", () => {
        utilityProcessSpawner("/app.asar/content_job_worker.cjs", {
            execArgv: [ "--max-old-space-size=1024", "--trace-warnings", "--max-semi-space-size=16" ],
            env: {},
            serviceName: "w"
        });

        expect(h.fork).toHaveBeenCalledWith("/app.asar/content_job_worker.cjs", [], {
            execArgv: [ "--trace-warnings", "--js-flags=--max-old-space-size=1024 --max-semi-space-size=16" ],
            env: {},
            serviceName: "w"
        });
    });

    it("adapts messages, exits, errors and posting to a WorkerHandle", () => {
        const handle = utilityProcessSpawner("/app.asar/image_worker.cjs", { execArgv: [], env: {}, serviceName: "w" });
        const messages: unknown[] = [];
        const exits: unknown[][] = [];
        const errors: Error[] = [];

        handle.on("message", (message) => messages.push(message));
        handle.on("exit", (...args) => exits.push(args));
        handle.on("error", (error) => errors.push(error));

        expect(handle.pid).toBe(321);

        // The parent side of a utility process receives the data itself, not a MessageEvent.
        child.emit("message", { id: 1, result: "x" });
        expect(messages).toEqual([ { id: 1, result: "x" } ]);

        child.emit("error", "FatalError", "worker.cjs:10", "{}");
        expect(errors).toHaveLength(1);
        expect(errors[0]).toBeInstanceOf(Error);
        expect(errors[0].message).toBe("FatalError at worker.cjs:10");

        handle.postMessage({ id: 2 });
        expect(child.postMessage).toHaveBeenCalledWith({ id: 2 });

        child.postMessage.mockImplementationOnce(() => {
            throw "not an Error";
        });
        expect(() => handle.postMessage({ id: 3 })).toThrow("not an Error");

        handle.unref();
        handle.kill();
        expect(child.kill).toHaveBeenCalled();

        child.emit("exit", 9);
        expect(exits).toEqual([ [ 9 ] ]);
        expect(() => handle.postMessage({ id: 4 })).toThrow("exited");
        expect(child.postMessage).toHaveBeenCalledTimes(2);
    });
});
