import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import { type ChannelHost, createParentChannel, serveJobs } from "./worker_channel.js";

/** A stand-in for `process` in a forked child: messages through `send` and the `message` event. */
function forkedHost(env: NodeJS.ProcessEnv = {}) {
    const emitter = new EventEmitter();
    const host = {
        pid: 77,
        env,
        send: vi.fn(),
        exit: vi.fn(),
        on: (event: string, listener: (...args: unknown[]) => void) => emitter.on(event, listener)
    };

    return { host: host as ChannelHost & typeof host, emitter };
}

/** A stand-in for `process` in an Electron utility process: messages through `parentPort`. */
function utilityHost() {
    const port = new EventEmitter();
    const host = {
        pid: 88,
        env: {},
        parentPort: {
            on: (event: "message", listener: (event: { data: unknown }) => void) => port.on(event, listener),
            postMessage: vi.fn()
        },
        send: vi.fn(),
        exit: vi.fn(),
        on: vi.fn()
    };

    return { host: host as ChannelHost & typeof host, port };
}

describe("createParentChannel", () => {
    it("uses process.send and exits when a forked child's parent disconnects", () => {
        const { host, emitter } = forkedHost();
        const channel = createParentChannel(host);
        const received: unknown[] = [];

        channel.onMessage((message) => received.push(message));
        channel.onMessage(() => {});
        emitter.emit("message", { id: 1 });
        channel.post({ id: 1, result: "x" });

        expect(received).toEqual([ { id: 1 } ]);
        expect(host.send).toHaveBeenCalledWith({ id: 1, result: "x" });

        expect(host.exit).not.toHaveBeenCalled();
        emitter.emit("disconnect");
        expect(host.exit).toHaveBeenCalledTimes(1);
        expect(host.exit).toHaveBeenCalledWith(0);
    });

    it("unwraps parentPort message events in a utility process", () => {
        const { host, port } = utilityHost();
        const channel = createParentChannel(host);
        const received: unknown[] = [];

        channel.onMessage((message) => received.push(message));
        port.emit("message", { data: { id: 2 }, ports: [] });
        channel.post({ id: 2, result: "y" });

        expect(received).toEqual([ { id: 2 } ]);
        expect(host.parentPort.postMessage).toHaveBeenCalledWith({ id: 2, result: "y" });
        expect(host.send).not.toHaveBeenCalled();
        expect(host.on).not.toHaveBeenCalled();
    });
});

describe("serveJobs", () => {
    it("announces itself, then answers each job with its result or its error", async () => {
        const { host, emitter } = forkedHost();
        const log = vi.spyOn(console, "log").mockImplementation(() => {});

        try {
            serveJobs<string, string>({ name: "test worker" }, async (request, logs) => {
                logs.push(`handled ${request}`);

                if (request === "bad") {
                    throw new Error("cannot");
                }

                return request.toUpperCase();
            }, host);

            expect(host.send).toHaveBeenCalledWith({ trace: expect.stringMatching(/^worker 77: loaded and listening; heap limit \d+ MB$/) });

            emitter.emit("message", { id: 1, request: "good" });
            emitter.emit("message", { id: 2, request: "bad" });
            await new Promise((resolve) => setImmediate(resolve));

            expect(host.send).toHaveBeenCalledWith({ id: 1, result: "GOOD", logs: [ "handled good" ] });
            expect(host.send).toHaveBeenCalledWith({
                id: 2,
                error: expect.stringContaining("cannot"),
                logs: [ "handled bad" ]
            });
            // Tracing is off unless its variable is set.
            expect(host.send).toHaveBeenCalledTimes(3);
        } finally {
            log.mockRestore();
        }
    });

    it("traces each job when its environment variable is set", async () => {
        const { host, emitter } = forkedHost({ TEST_WORKER_DEBUG: "1" });
        const log = vi.spyOn(console, "log").mockImplementation(() => {});

        try {
            serveJobs<string, string>({ name: "test worker", traceEnv: "TEST_WORKER_DEBUG" }, async (request) => request, host);
            emitter.emit("message", { id: 5, request: "x" });
            await new Promise((resolve) => setImmediate(resolve));

            expect(host.send).toHaveBeenCalledWith({ trace: "worker 77: received job #5" });
            expect(host.send).toHaveBeenCalledWith({ trace: expect.stringMatching(/^worker 77: job #5 done in \d+ms$/) });
        } finally {
            log.mockRestore();
        }
    });
});
