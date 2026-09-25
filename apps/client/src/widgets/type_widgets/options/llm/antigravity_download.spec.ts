import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { type AntigravityDownload, findAntigravityDownload, registryPlatformKey, useAntigravityDownload } from "./antigravity_download";

/** The registry's agent.json for antigravity-acp 1.1.1, trimmed to two platforms. */
const ENTRY = {
    id: "antigravity-acp",
    version: "1.1.1",
    distribution: {
        binary: {
            "linux-x86_64": {
                archive: "https://dl.google.com/agy-extensions/releases/linux/agy-acp-server-agy_acp_server_1.1.1-linux-x86_64.zip",
                cmd: "./agy_acp_server.par"
            },
            "windows-aarch64": {
                archive: "https://example.com/agy_acp_server-windows-arm64.zip",
                cmd: "./agy_acp_server.exe"
            }
        }
    }
};

function respondWith(body: unknown, ok = true) {
    return vi.fn(async () => ({ ok, status: ok ? 200 : 503, json: async () => body }) as Response);
}

describe("registryPlatformKey", () => {
    it("names the platforms the registry lists, and nothing else", () => {
        expect(registryPlatformKey("linux", "x64")).toBe("linux-x86_64");
        expect(registryPlatformKey("linux", "arm64")).toBe("linux-aarch64");
        expect(registryPlatformKey("darwin", "arm64")).toBe("darwin-aarch64");
        expect(registryPlatformKey("win32", "x64")).toBe("windows-x86_64");
        expect(registryPlatformKey("freebsd", "x64")).toBeUndefined();
        expect(registryPlatformKey("linux", "ia32")).toBeUndefined();
        // Standalone reports "web" and no architecture.
        expect(registryPlatformKey("web", undefined)).toBeUndefined();
    });
});

describe("findAntigravityDownload", () => {
    it("returns the archive the registry lists for the server's platform", async () => {
        const fetchMock = respondWith(ENTRY);
        await expect(findAntigravityDownload("linux", "x64", fetchMock)).resolves.toEqual({
            version: "1.1.1",
            url: "https://dl.google.com/agy-extensions/releases/linux/agy-acp-server-agy_acp_server_1.1.1-linux-x86_64.zip"
        });
        expect(fetchMock).toHaveBeenCalledWith(
            "https://raw.githubusercontent.com/agentclientprotocol/registry/main/antigravity-acp/agent.json",
            expect.anything()
        );
    });

    it("returns no link when there is none to trust", async () => {
        // A platform the registry has no name for is not looked up at all.
        const unnamed = respondWith(ENTRY);
        await expect(findAntigravityDownload("freebsd", "x64", unnamed)).resolves.toEqual({});
        expect(unnamed).not.toHaveBeenCalled();
        // Google builds nothing for Intel Macs.
        await expect(findAntigravityDownload("darwin", "x64", respondWith(ENTRY))).resolves.toEqual({});
        // Listed, but not on Google's download host.
        await expect(findAntigravityDownload("win32", "arm64", respondWith(ENTRY))).resolves.toEqual({});
        // The registry is unreachable or answers with an error.
        await expect(findAntigravityDownload("linux", "x64", vi.fn(async () => { throw new Error("offline"); }))).resolves.toEqual({});
        await expect(findAntigravityDownload("linux", "x64", respondWith(ENTRY, false))).resolves.toEqual({});
        // The entry changed shape.
        await expect(findAntigravityDownload("linux", "x64", respondWith({ version: "2.0.0" }))).resolves.toEqual({});
        // The archive is not a URL at all.
        const broken = { ...ENTRY, distribution: { binary: { "linux-x86_64": { archive: "not a url" } } } };
        await expect(findAntigravityDownload("linux", "x64", respondWith(broken))).resolves.toEqual({});
    });

    it("leaves out a version that is not a string", async () => {
        await expect(findAntigravityDownload("linux", "x64", respondWith({ ...ENTRY, version: 2 })))
            .resolves.toEqual({ version: undefined, url: ENTRY.distribution.binary["linux-x86_64"].archive });
    });
});

describe("useAntigravityDownload", () => {
    const originalGlob = window.glob;
    let host: HTMLElement | undefined;

    afterEach(() => {
        window.glob = originalGlob;
        vi.unstubAllGlobals();
        if (host) {
            render(null, host);
            host.remove();
            host = undefined;
        }
    });

    /** Mounts the hook for the server's platform and returns what it held after each render. */
    function mountHook() {
        window.glob = { ...originalGlob, platform: "linux", arch: "x64" } as typeof window.glob;
        const seen: AntigravityDownload[] = [];
        function Probe() {
            seen.push(useAntigravityDownload());
            return null;
        }
        host = document.body.appendChild(document.createElement("div"));
        const target = host;
        act(() => render(h(Probe, null), target));
        return seen;
    }

    it("starts empty and then holds the download for the server's platform", async () => {
        vi.stubGlobal("fetch", respondWith(ENTRY));
        const seen = mountHook();
        expect(seen[0]).toEqual({});
        await vi.waitFor(() => expect(seen.at(-1)?.url).toBe(ENTRY.distribution.binary["linux-x86_64"].archive));
    });

    it("drops a lookup that finishes after the checklist is gone", async () => {
        let answer: (value: Response) => void = () => {};
        vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => { answer = resolve; })));
        const seen = mountHook();
        const target = host;
        if (target) {
            act(() => render(null, target));
        }
        await act(async () => answer({ ok: true, status: 200, json: async () => ENTRY } as Response));
        expect(seen).toEqual([ {} ]);
    });
});
