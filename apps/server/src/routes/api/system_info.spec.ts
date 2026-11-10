import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
    isMac: false,
    isWindows: false,
    arch: "x64",
    cpuModel: "Intel",
    execResult: "0",
    execThrows: false,
    https: false
}));

vi.mock("../../services/config.js", () => ({
    default: { Network: { get https() { return state.https; } } }
}));
vi.mock("../../services/host.js", () => ({ default: "0.0.0.0" }));
vi.mock("../../services/port.js", () => ({ default: 8080 }));

vi.mock("../../services/utils", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../services/utils.js")>()),
    get isMac() { return state.isMac; },
    get isWindows() { return state.isWindows; }
}));

vi.mock("child_process", () => ({
    execSync: () => {
        if (state.execThrows) throw new Error("sysctl missing");
        return state.execResult;
    }
}));

vi.mock("os", () => ({
    arch: () => state.arch,
    cpus: () => [{ model: state.cpuModel }],
    networkInterfaces: () => ({
        eth0: [
            { address: "192.168.1.20", family: "IPv4", internal: false },
            { address: "127.0.0.1", family: "IPv4", internal: true }
        ],
        wlan0: [ { address: "fe80::1", family: "IPv6", internal: false, scopeid: 0 } ]
    })
}));

import systemInfoRoute, { isCpuArchMismatch } from "./system_info.js";

describe("System info API", () => {
    afterEach(() => {
        Object.assign(state, { isMac: false, isWindows: false, arch: "x64", cpuModel: "Intel", execResult: "0", execThrows: false, https: false });
    });

    it("reports no mismatch on a native (non-mac, non-windows) platform", () => {
        expect(systemInfoRoute.systemChecks()).toEqual({ isCpuArchMismatch: false });
    });

    it("detects Rosetta 2 translation on macOS", () => {
        state.isMac = true;
        state.execResult = "1";
        expect(isCpuArchMismatch()).toBe(true);

        state.execResult = "0";
        expect(isCpuArchMismatch()).toBe(false);
    });

    it("treats a failing sysctl on macOS as native", () => {
        state.isMac = true;
        state.execThrows = true;
        expect(isCpuArchMismatch()).toBe(false);
    });

    it("detects ARM emulation on Windows x64", () => {
        state.isWindows = true;
        state.arch = "x64";
        state.cpuModel = "Snapdragon (TM) 8cx";
        expect(isCpuArchMismatch()).toBe(true);

        state.cpuModel = "Intel";
        expect(isCpuArchMismatch()).toBe(false);

        state.arch = "arm64";
        state.cpuModel = "Snapdragon (TM) 8cx";
        expect(isCpuArchMismatch()).toBe(false);
    });

    it("lists the LAN URLs of the server with the configured protocol", () => {
        expect(systemInfoRoute.getNetworkAddresses()).toEqual({
            addresses: [ "http://192.168.1.20:8080", "http://[fe80::1]:8080" ],
            reachableOnNetwork: true
        });

        state.https = true;
        expect(systemInfoRoute.getNetworkAddresses().addresses)
            .toEqual([ "https://192.168.1.20:8080", "https://[fe80::1]:8080" ]);
    });
});
