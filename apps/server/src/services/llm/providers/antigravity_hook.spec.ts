import fs from "fs";
import os from "os";
import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const findOnPathMock = vi.hoisted(() => vi.fn<(binary: string) => Promise<string | undefined>>());
vi.mock("./binary_lookup.js", () => ({ findOnPath: findOnPathMock }));

const { buildHookCommand, decideAntigravityToolCall, resetCurlCache, resolveCurlPath, writeAntigravityHooks } = await import("./antigravity_hook.js");

const ROOT = path.join(os.tmpdir(), "trilium-antigravity-hook-spec");
const HOME = path.join(ROOT, "home");
const WORKSPACE = path.join(ROOT, "workspace");
const PRIVATE = path.join(HOME, "antigravity-acp");
const DIRS = { home: HOME, workspace: WORKSPACE };

/** Canonical paths are the paths themselves, except for the aliases a test maps. */
function realpathWith(aliases: Record<string, string> = {}) {
    return (candidate: string) => aliases[candidate] ?? candidate;
}

function decide(name: string, args: unknown, aliases?: Record<string, string>, platform: NodeJS.Platform = process.platform) {
    return decideAntigravityToolCall({ toolCall: { name, args } }, DIRS, { platform, realpath: realpathWith(aliases) }).decision;
}

describe("decideAntigravityToolCall", () => {
    it("denies any path that reaches the server's private folder outside brain/", () => {
        expect(decide("view_file", { AbsolutePath: path.join(PRIVATE, "acp_token.json") })).toBe("deny");
        expect(decide("search_directory", { Query: "CANARY", SearchPath: PRIVATE })).toBe("deny");
        expect(decide("list_directory", { DirectoryPath: path.join(PRIVATE, "conversations") })).toBe("deny");
        // A folder above it, which a recursive search or listing would cover.
        expect(decide("find_file", { Pattern: "*.json", SearchDirectory: HOME })).toBe("deny");
        expect(decide("search_directory", { SearchPath: ROOT })).toBe("deny");
        // Relative to the workspace, and climbing back out of brain/.
        expect(decide("list_directory", { DirectoryPath: "../home/antigravity-acp" })).toBe("deny");
        expect(decide("view_file", { AbsolutePath: path.join(PRIVATE, "brain", "..", "acp_token.json") })).toBe("deny");
        // However deep the argument sits, and whatever tool carries it.
        expect(decide("run_command", { CommandLine: "echo", Cwd: PRIVATE })).toBe("deny");
        expect(decide("search_directory", { SearchPath: WORKSPACE, Includes: [ path.join(PRIVATE, "settings.json") ] })).toBe("deny");
    });

    it("sees through a link or a short name that leads into the private folder", () => {
        const alias = path.join(WORKSPACE, "shortcut");
        expect(decide("view_file", { AbsolutePath: path.join(alias, "acp_token.json") }, { [path.join(alias, "acp_token.json")]: path.join(PRIVATE, "acp_token.json") })).toBe("deny");
    });

    it("compares paths case-insensitively where the file system does", () => {
        const shouted = path.join(HOME, "ANTIGRAVITY-ACP", "acp_token.json");
        expect(decide("view_file", { AbsolutePath: shouted }, undefined, "win32")).toBe("deny");
        expect(decide("view_file", { AbsolutePath: shouted }, undefined, "darwin")).toBe("deny");
        // Case-sensitive file systems: the exact spelling is still refused.
        expect(decide("view_file", { AbsolutePath: path.join(PRIVATE, "acp_token.json") }, undefined, "linux")).toBe("deny");
    });

    it("allows the read tools elsewhere and leaves every other tool to the permission flow", () => {
        // brain/ holds the note tools' descriptions and the output of long tool results.
        expect(decide("view_file", { AbsolutePath: path.join(PRIVATE, "brain", "06ad", "mcp", "trilium", "search_notes.json") })).toBe("allow");
        expect(decide("search_directory", { Query: "a/b", SearchPath: "." })).toBe("allow");
        expect(decide("find_file", { Pattern: "*.md", SearchDirectory: WORKSPACE })).toBe("allow");
        expect(decide("run_command", { CommandLine: "echo hello", Cwd: WORKSPACE })).toBe("ask");
        expect(decide("search_notes", { Arguments: { query: "Trilium" }, ServerName: "trilium", ToolName: "search_notes" })).toBe("ask");
        expect(decideAntigravityToolCall("not a tool call", DIRS).decision).toBe("ask");
    });

    it("tells the agent why it was refused", () => {
        expect(decideAntigravityToolCall({ toolCall: { name: "view_file", args: { AbsolutePath: PRIVATE } } }, DIRS, { realpath: realpathWith() }))
            .toEqual({ decision: "deny", reason: expect.stringContaining("note tools") });
    });
});

describe("writeAntigravityHooks", () => {
    beforeEach(() => fs.rmSync(ROOT, { recursive: true, force: true }));

    it("writes a hook that runs the command for every tool, replacing any earlier file", () => {
        writeAntigravityHooks(HOME, "old");
        writeAntigravityHooks(HOME, "\"/usr/bin/curl\" --fail");

        const written = JSON.parse(fs.readFileSync(path.join(HOME, "config", "hooks.json"), "utf8"));
        expect(written).toEqual({
            "trilium-file-access": {
                PreToolUse: [ { matcher: ".*", hooks: [ { type: "command", command: "\"/usr/bin/curl\" --fail", timeout: 10 } ] } ]
            }
        });
    });
});

describe("buildHookCommand", () => {
    it("posts the tool call to Trilium and fails on anything but a decision", () => {
        expect(buildHookCommand("C:\\Windows\\System32\\curl.exe", "http://127.0.0.1:5000/hook-abc"))
            .toBe("\"C:\\Windows\\System32\\curl.exe\" --silent --show-error --fail --noproxy 127.0.0.1 --max-time 8 --data-binary @- http://127.0.0.1:5000/hook-abc");
        expect(() => buildHookCommand("/opt/\"odd\"/curl", "http://127.0.0.1:5000/hook-abc")).toThrow(/quote/);
    });
});

describe("resolveCurlPath", () => {
    beforeEach(() => {
        resetCurlCache();
        findOnPathMock.mockReset();
    });

    it("finds curl once, and explains what to install when it is missing", async () => {
        findOnPathMock.mockResolvedValueOnce(undefined);
        await expect(resolveCurlPath()).rejects.toThrow(/Google Antigravity needs curl.*Install curl/s);

        findOnPathMock.mockResolvedValue("/usr/bin/curl");
        await expect(resolveCurlPath()).resolves.toBe("/usr/bin/curl");
        await expect(resolveCurlPath()).resolves.toBe("/usr/bin/curl");
        expect(findOnPathMock).toHaveBeenCalledTimes(2);
        expect(findOnPathMock).toHaveBeenCalledWith("curl");
    });
});
