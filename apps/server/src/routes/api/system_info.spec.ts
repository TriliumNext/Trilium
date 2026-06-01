import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
    isMac: false,
    isWindows: false,
    arch: "x64",
    cpuModel: "Intel",
    execResult: "0",
    execThrows: false
}));

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
    cpus: () => [{ model: state.cpuModel }]
}));

import systemInfoRoute, { isCpuArchMismatch } from "./system_info.js";

describe("System info API", () => {
    afterEach(() => {
        Object.assign(state, { isMac: false, isWindows: false, arch: "x64", cpuModel: "Intel", execResult: "0", execThrows: false });
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
    });
});
