import { EventEmitter } from "events";
import { PassThrough } from "stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const infoLogMock = vi.hoisted(() => vi.fn());
vi.mock("@triliumnext/core", () => ({ getLog: () => ({ info: infoLogMock, error: vi.fn() }) }));

// A fake ChildProcess: stdin captures what the client writes, stdout/stderr are
// streams the test pushes into, and it is an EventEmitter for exit/error.
class FakeProc extends EventEmitter {
    stdin = new PassThrough();
    stdout = new PassThrough();
    stderr = new PassThrough();
    killed = false;
    written: string[] = [];

    constructor() {
        super();
        this.stdin.on("data", (chunk: Buffer) => this.written.push(chunk.toString()));
    }

    kill() {
        this.killed = true;
        this.emit("exit", 0, null);
    }

    /** Simulate the agent writing a line to stdout. */
    send(obj: unknown) {
        this.stdout.write(`${JSON.stringify(obj)}\n`);
    }
}

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock("child_process", () => ({ spawn: spawnMock }));

const { AcpClient, AcpError } = await import("./acp_client.js");

function lastWritten(proc: FakeProc): Record<string, unknown> {
    return JSON.parse(proc.written[proc.written.length - 1]);
}

describe("AcpClient", () => {
    let proc: FakeProc;

    beforeEach(() => {
        proc = new FakeProc();
        spawnMock.mockReset();
        spawnMock.mockReturnValue(proc);
        infoLogMock.mockReset();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("spawns with --acp and the given args", () => {
        AcpClient.start("/usr/bin/copilot", { cwd: "/tmp", args: ["--no-color"] });
        expect(spawnMock).toHaveBeenCalledWith(
            "/usr/bin/copilot",
            ["--acp", "--no-color"],
            expect.objectContaining({ cwd: "/tmp" })
        );
    });

    it("quotes the binary path when launched through a shell", () => {
        AcpClient.start("C:\\npm\\copilot.cmd", { cwd: "/tmp", shell: true });
        expect(spawnMock).toHaveBeenCalledWith(
            `"C:\\npm\\copilot.cmd"`,
            ["--acp"],
            expect.objectContaining({ shell: true })
        );
    });

    it("logs the agent's stderr, skipping blank chunks", () => {
        AcpClient.start("/bin/copilot", { cwd: "/tmp" });

        proc.stderr.emit("data", Buffer.from("  \n"));
        expect(infoLogMock).not.toHaveBeenCalled();

        proc.stderr.emit("data", Buffer.from("warning: model is busy\n"));
        expect(infoLogMock).toHaveBeenCalledTimes(1);
        expect(infoLogMock).toHaveBeenCalledWith("ACP agent stderr: warning: model is busy");
    });

    it("correlates a response to its request by id", async () => {
        const client = AcpClient.start("/bin/copilot", { cwd: "/tmp" });
        const promise = client.request<{ ok: boolean }>("initialize", { v: 1 });

        const sent = lastWritten(proc);
        expect(sent).toMatchObject({ jsonrpc: "2.0", method: "initialize", params: { v: 1 } });

        proc.send({ jsonrpc: "2.0", id: sent.id, result: { ok: true } });
        await expect(promise).resolves.toEqual({ ok: true });
    });

    it("rejects with an AcpError when the response carries an error", async () => {
        const client = AcpClient.start("/bin/copilot", { cwd: "/tmp" });
        const promise = client.request("session/new", {});

        proc.send({ jsonrpc: "2.0", id: lastWritten(proc).id, error: { code: -32000, message: "no auth" } });
        await expect(promise).rejects.toBeInstanceOf(AcpError);
        await expect(promise).rejects.toMatchObject({ code: -32000, message: "no auth" });
    });

    it("rejects a request that outlives its timeout", async () => {
        vi.useFakeTimers();
        const client = AcpClient.start("/bin/copilot", { cwd: "/tmp" });
        const promise = client.request("session/prompt", {}, 5_000);

        vi.advanceTimersByTime(5_000);
        await expect(promise).rejects.toThrow(`ACP request "session/prompt" timed out after 5 s.`);
    });

    it("rejects and cleans up when the write to stdin fails synchronously", async () => {
        const client = AcpClient.start("/bin/copilot", { cwd: "/tmp" });
        const write = vi.spyOn(proc.stdin, "write").mockImplementation(() => {
            throw new Error("stdin closed");
        });
        await expect(client.request("initialize", {})).rejects.toThrow("stdin closed");

        // A non-Error thrown value is stringified rather than swallowed.
        write.mockImplementation(() => {
            throw "stdin vanished";
        });
        await expect(client.request("initialize", {})).rejects.toThrow("stdin vanished");

        // Neither failure poisoned the client: the next exchange still completes.
        write.mockRestore();
        const promise = client.request("session/new", {});
        proc.send({ jsonrpc: "2.0", id: lastWritten(proc).id, result: { sessionId: "s1" } });
        await expect(promise).resolves.toEqual({ sessionId: "s1" });
    });

    it("writes a notification without an id", () => {
        const client = AcpClient.start("/bin/copilot", { cwd: "/tmp" });
        client.notify("session/cancel", { sessionId: "s1" });

        expect(lastWritten(proc)).toEqual({
            jsonrpc: "2.0",
            method: "session/cancel",
            params: { sessionId: "s1" }
        });
    });

    it("routes notifications (no id) to onNotification", async () => {
        const onNotification = vi.fn();
        AcpClient.start("/bin/copilot", { cwd: "/tmp", onNotification });

        proc.send({ jsonrpc: "2.0", method: "session/update", params: { hello: 1 } });
        await vi.waitFor(() => expect(onNotification).toHaveBeenCalledWith("session/update", { hello: 1 }));
    });

    it("answers an agent request via onAgentRequest and writes the result", async () => {
        const onAgentRequest = vi.fn(async () => ({ outcome: "ok" }));
        AcpClient.start("/bin/copilot", { cwd: "/tmp", onAgentRequest });

        proc.send({ jsonrpc: "2.0", id: 7, method: "session/request_permission", params: {} });
        await vi.waitFor(() => expect(onAgentRequest).toHaveBeenCalled());
        await vi.waitFor(() => {
            const reply = lastWritten(proc);
            expect(reply).toMatchObject({ id: 7, result: { outcome: "ok" } });
        });
    });

    it("replies method-not-found to an agent request when no handler is set", async () => {
        AcpClient.start("/bin/copilot", { cwd: "/tmp" });

        proc.send({ jsonrpc: "2.0", id: 8, method: "fs/read_text_file", params: {} });
        await vi.waitFor(() => {
            const reply = lastWritten(proc);
            expect(reply).toMatchObject({ id: 8, error: { code: -32601 } });
        });
    });

    it("turns a thrown agent-request handler into a JSON-RPC error response", async () => {
        const onAgentRequest = vi.fn(() => { throw new Error("nope"); });
        AcpClient.start("/bin/copilot", { cwd: "/tmp", onAgentRequest });

        proc.send({ jsonrpc: "2.0", id: 9, method: "terminal/create", params: {} });
        await vi.waitFor(() => {
            const reply = lastWritten(proc);
            expect(reply).toMatchObject({ id: 9, error: { code: -32603, message: "nope" } });
        });
    });

    it("stringifies a non-Error rejection from the agent-request handler", async () => {
        const onAgentRequest = vi.fn(() => Promise.reject("permission backend offline"));
        AcpClient.start("/bin/copilot", { cwd: "/tmp", onAgentRequest });

        proc.send({ jsonrpc: "2.0", id: 10, method: "session/request_permission", params: {} });
        await vi.waitFor(() => {
            const reply = lastWritten(proc);
            expect(reply).toMatchObject({
                id: 10,
                error: { code: -32603, message: "permission backend offline" }
            });
        });
    });

    it("rejects in-flight requests when the subprocess exits unexpectedly", async () => {
        const client = AcpClient.start("/bin/copilot", { cwd: "/tmp" });
        const promise = client.request("session/prompt", {});

        proc.emit("exit", 1, null);
        await expect(promise).rejects.toThrow(/exited unexpectedly/);
    });

    it("fails in-flight requests when the subprocess cannot be started", async () => {
        const client = AcpClient.start("/bin/copilot", { cwd: "/tmp" });
        const promise = client.request("initialize", {});

        proc.emit("error", new Error("spawn ENOENT"));
        await expect(promise).rejects.toThrow("Failed to start the ACP agent: spawn ENOENT");
        // The failure is sticky: later requests short-circuit with the same error.
        await expect(client.request("session/new", {}))
            .rejects.toThrow(/Failed to start the ACP agent/);
    });

    it("does not treat a post-dispose exit as an unexpected failure", async () => {
        const client = AcpClient.start("/bin/copilot", { cwd: "/tmp" });
        client.dispose();
        expect(proc.killed).toBe(true);

        // A request after disposal fails with the disposal error, not a crash.
        await expect(client.request("initialize", {})).rejects.toThrow(/disposed/);
    });

    it("rejects in-flight requests on dispose and ignores a second dispose", async () => {
        const client = AcpClient.start("/bin/copilot", { cwd: "/tmp" });
        const promise = client.request("session/prompt", {});

        client.dispose();
        await expect(promise).rejects.toThrow("The ACP client was disposed.");

        proc.killed = false;
        client.dispose();
        expect(proc.killed).toBe(false);
    });

    it("ignores lines that are not JSON objects", async () => {
        const onNotification = vi.fn();
        AcpClient.start("/bin/copilot", { cwd: "/tmp", onNotification });

        proc.stdout.write("Welcome to Copilot!\n"); // not JSON at all
        proc.stdout.write("null\n"); // valid JSON, but no properties to read
        proc.stdout.write("42\n");
        proc.send({ jsonrpc: "2.0", method: "ping", params: {} });
        await vi.waitFor(() => expect(onNotification).toHaveBeenCalledWith("ping", {}));
        expect(onNotification).toHaveBeenCalledTimes(1);
    });

    it("ignores blank lines and messages with neither an id nor a method", async () => {
        const onNotification = vi.fn();
        AcpClient.start("/bin/copilot", { cwd: "/tmp", onNotification });

        proc.stdout.write("\n");
        proc.stdout.write("   \n");
        proc.send({ jsonrpc: "2.0" }); // neither a response nor a notification
        proc.send({ jsonrpc: "2.0", method: "session/update", params: { n: 1 } });
        await vi.waitFor(() =>
            expect(onNotification).toHaveBeenCalledWith("session/update", { n: 1 })
        );
        expect(onNotification).toHaveBeenCalledTimes(1);
    });

    it("drops a response with an unknown id and a notification with no handler", async () => {
        const client = AcpClient.start("/bin/copilot", { cwd: "/tmp" });
        const promise = client.request("initialize", {});
        const { id } = lastWritten(proc);

        proc.send({ jsonrpc: "2.0", id: 4242, result: { stray: true } }); // never requested
        proc.send({ jsonrpc: "2.0", method: "session/update", params: {} }); // no onNotification
        proc.send({ jsonrpc: "2.0", id, result: { ok: true } });
        await expect(promise).resolves.toEqual({ ok: true });

        // A duplicate response for an id that already settled is dropped too.
        proc.send({ jsonrpc: "2.0", id, result: { ok: false } });
        await expect(promise).resolves.toEqual({ ok: true });
    });

    it("survives an EPIPE on the subprocess's stdin", () => {
        AcpClient.start("/bin/copilot", { cwd: "/tmp" });

        // Node emits this when something writes to a subprocess that already
        // exited (a late session/cancel, or an agent-request reply resumed
        // after dispose()). An "error" event with no listener is re-thrown by
        // EventEmitter, which would take the server down.
        expect(() => proc.stdin.emit("error", new Error("write EPIPE"))).not.toThrow();
    });
});
