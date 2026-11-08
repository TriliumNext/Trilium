import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ExecFileCallback = (err: Error | null, stdout: string, stderr: string) => void;
const fakeChild = vi.hoisted(() => ({ stdin: { end: vi.fn() } }));
const execFileMock = vi.hoisted(() => vi.fn<(binary: string, args: string[], options: object, cb: ExecFileCallback) => typeof fakeChild>());
vi.mock("child_process", () => ({ execFile: execFileMock }));

const existsSyncMock = vi.hoisted(() => vi.fn((_path: string) => true));
vi.mock("fs", () => ({ existsSync: existsSyncMock }));

const infoLogMock = vi.hoisted(() => vi.fn());
vi.mock("@triliumnext/core", () => ({ getLog: () => ({ info: infoLogMock, error: vi.fn() }) }));
vi.mock("../../resource_dir.js", () => ({ RESOURCE_DIR: "/opt/trilium/assets" }));

const { resetCodexBinaryCache, resolveCodexAcpScript, resolveCodexBinaryPath } = await import("./codex_binary.js");
const { resetLoginShellPathCache } = await import("./binary_lookup.js");

describe("resolveCodexBinaryPath", () => {
    const originalOverride = process.env.TRILIUM_CODEX_PATH;
    const originalPath = process.env.PATH;
    const originalShell = process.env.SHELL;

    beforeEach(() => {
        resetCodexBinaryCache();
        resetLoginShellPathCache();
        // No $SHELL: the login-shell fallback is a no-op (binary_lookup.spec.ts covers it).
        delete process.env.SHELL;
        execFileMock.mockReset();
        infoLogMock.mockReset();
        existsSyncMock.mockReset();
        existsSyncMock.mockReturnValue(true);
        process.env.TRILIUM_CODEX_PATH = "/opt/codex/codex";
    });

    afterEach(() => {
        for (const [ name, value ] of [ [ "TRILIUM_CODEX_PATH", originalOverride ], [ "PATH", originalPath ], [ "SHELL", originalShell ] ] as const) {
            if (value === undefined) {
                delete process.env[name];
            } else {
                process.env[name] = value;
            }
        }
    });

    /** Answer the `--version` probe with `stdout`, or fail it with `err`. */
    function probe(stdout: string, err: Error | null = null) {
        execFileMock.mockImplementation((_binary, _args, _options, cb) => {
            cb(err, stdout, "");
            return fakeChild;
        });
    }

    it("probes the binary once, with stdin closed, and logs the version it reports", async () => {
        probe("codex-cli 0.156.1\n");

        await expect(Promise.all([ resolveCodexBinaryPath(), resolveCodexBinaryPath() ])).resolves.toEqual([ "/opt/codex/codex", "/opt/codex/codex" ]);
        expect(execFileMock).toHaveBeenCalledOnce();
        expect(execFileMock.mock.calls[0].slice(0, 2)).toEqual([ "/opt/codex/codex", [ "--version" ] ]);
        expect(fakeChild.stdin.end).toHaveBeenCalled();
        expect(infoLogMock).toHaveBeenCalledWith(expect.stringContaining("(0.156.1)"));
    });

    it("names what went wrong with an install, and probes again once it is fixed", async () => {
        probe("", new Error("spawn EACCES"));
        await expect(resolveCodexBinaryPath()).rejects.toThrow(/failed to run \(spawn EACCES\).*npm install -g @openai\/codex/s);

        probe("usage: codex [OPTIONS]\n");
        await expect(resolveCodexBinaryPath()).rejects.toThrow(/did not report a version \(it printed: usage: codex \[OPTIONS\]\)/);

        probe("codex-cli 0.146.0\n");
        await expect(resolveCodexBinaryPath()).resolves.toBe("/opt/codex/codex");
    });

    it("finds codex on PATH, and says how to install it when it is nowhere", async () => {
        delete process.env.TRILIUM_CODEX_PATH;
        process.env.PATH = [ "/usr/local/bin", "/usr/bin" ].join(path.delimiter);
        existsSyncMock.mockImplementation(candidate => candidate === path.join("/usr/bin", "codex"));
        probe("codex-cli 0.156.1\n");
        await expect(resolveCodexBinaryPath()).resolves.toBe(path.join("/usr/bin", "codex"));

        resetCodexBinaryCache();
        existsSyncMock.mockReturnValue(false);
        await expect(resolveCodexBinaryPath()).rejects.toThrow(/Codex CLI \(codex\) was not found/);

        process.env.TRILIUM_CODEX_PATH = "/nowhere/codex";
        await expect(resolveCodexBinaryPath()).rejects.toThrow(`TRILIUM_CODEX_PATH is set to "/nowhere/codex", but no file exists there.`);
    });
});

describe("resolveCodexAcpScript", () => {
    it("runs the copy the build placed under RESOURCE_DIR, else the installed package", () => {
        existsSyncMock.mockReturnValue(true);
        expect(resolveCodexAcpScript()).toBe(path.join("/opt/trilium/assets", "codex-acp.mjs"));

        existsSyncMock.mockReturnValue(false);
        expect(resolveCodexAcpScript()).toMatch(/@agentclientprotocol[\\/]codex-acp[\\/]dist[\\/]index\.js$/);
    });
});
