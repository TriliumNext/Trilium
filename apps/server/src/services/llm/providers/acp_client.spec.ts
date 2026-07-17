import { EventEmitter } from "events";
import { PassThrough } from "stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@triliumnext/core", () => ({ getLog: () => ({ info: vi.fn(), error: vi.fn() }) }));

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

    it("rejects in-flight requests when the subprocess exits unexpectedly", async () => {
        const client = AcpClient.start("/bin/copilot", { cwd: "/tmp" });
        const promise = client.request("session/prompt", {});

        proc.emit("exit", 1, null);
        await expect(promise).rejects.toThrow(/exited unexpectedly/);
    });

    it("does not treat a post-dispose exit as an unexpected failure", async () => {
        const client = AcpClient.start("/bin/copilot", { cwd: "/tmp" });
        client.dispose();
        expect(proc.killed).toBe(true);

        // A request after disposal fails with the disposal error, not a crash.
        await expect(client.request("initialize", {})).rejects.toThrow(/disposed/);
    });

    it("ignores non-JSON lines on stdout", async () => {
        const onNotification = vi.fn();
        AcpClient.start("/bin/copilot", { cwd: "/tmp", onNotification });

        proc.stdout.write("Welcome to Copilot!\n");
        proc.send({ jsonrpc: "2.0", method: "ping", params: {} });
        await vi.waitFor(() => expect(onNotification).toHaveBeenCalledWith("ping", {}));
        expect(onNotification).toHaveBeenCalledTimes(1);
    });
});
