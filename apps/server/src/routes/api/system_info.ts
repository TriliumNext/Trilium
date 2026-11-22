import type { NetworkAddressesResponse } from "@triliumnext/commons";
import { execFile } from "child_process";
import { arch, cpus, networkInterfaces } from "os";

import config from "../../services/config.js";
import host from "../../services/host.js";
import {
    buildNetworkUrl, collectNetworkAddresses, isHostReachableOnNetwork
} from "../../services/network_addresses.js";
import port from "../../services/port.js";
import { isMac, isWindows } from "../../services/utils";

async function systemChecks() {
    return {
        isCpuArchMismatch: await checkCpuArchMismatch()
    };
}

/**
 * Returns the reachable URLs another device can use to sync with this host.
 * Consumed by the setup "sync from desktop" screen. This lives server-side
 * because the renderer can't reach Node's `os` module (node integration is
 * disabled in the Electron renderer), and because the desktop renderer's
 * `location` points at the internal `trilium-app://` protocol rather than the
 * real HTTP listener — so the protocol and port must be resolved here too.
 */
function getNetworkAddresses(): NetworkAddressesResponse {
    const protocol = config["Network"]["https"] ? "https" : "http";

    return {
        addresses: collectNetworkAddresses(networkInterfaces()).map((addr) => buildNetworkUrl(protocol, addr, port)),
        reachableOnNetwork: isHostReachableOnNetwork(host)
    };
}

/** The result of {@link checkCpuArchMismatch}, once known. */
let cpuArchMismatch: boolean | undefined;
let cpuArchCheck: Promise<boolean> | undefined;

/**
 * Runs {@link detectCpuArchMismatch} the first time it is called, and returns its result. The
 * process keeps its architecture for as long as it runs, so every later call shares that result.
 */
export function checkCpuArchMismatch() {
    cpuArchCheck ??= detectCpuArchMismatch().then((result) => (cpuArchMismatch = result));
    return cpuArchCheck;
}

/** The result of {@link checkCpuArchMismatch} if it has finished, for `/bootstrap` to pass on. */
export function getKnownCpuArchMismatch() {
    return cpuArchMismatch;
}

/**
 * Detects if the application is running under emulation on Apple Silicon or Windows on ARM.
 * This happens when an x64 version of the app is run on an M1/M2/M3 Mac or on a Windows Snapdragon chip.
 * On macOS it runs `sysctl` without waiting on it, so the server goes on answering meanwhile.
 * @returns true if running on x86 emulation on ARM, false otherwise.
 */
export async function detectCpuArchMismatch(): Promise<boolean> {
    if (isMac) {
        // `sysctl.proc_translated` is 1 while Rosetta 2 translates the process, 0 for native
        // execution, and missing on Intel Macs, where the call fails.
        const result = await new Promise<string>((resolve) => {
            execFile("sysctl", [ "-n", "sysctl.proc_translated" ], { encoding: "utf8", timeout: 1000 }, (error, stdout) => {
                resolve(error ? "" : String(stdout).trim());
            });
        });
        return result === "1";
    } else if (isWindows && arch() === "x64") {
        return cpus().some(cpu =>
            cpu.model.includes('Microsoft SQ') ||
            cpu.model.includes('Snapdragon'));
    }
    return false;
}

export default {
    systemChecks,
    getNetworkAddresses
};
