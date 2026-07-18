import type { NetworkAddressesResponse } from "@triliumnext/commons";
import { execSync } from "child_process";
import { arch, cpus, networkInterfaces } from "os";

import config from "../../services/config.js";
import host from "../../services/host.js";
import port from "../../services/port.js";
import { isMac, isWindows } from "../../services/utils";

function systemChecks() {
    return {
        isCpuArchMismatch: isCpuArchMismatch()
    }
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

/**
 * Detects if the application is running under emulation on Apple Silicon or Windows on ARM.
 * This happens when an x64 version of the app is run on an M1/M2/M3 Mac or on a Windows Snapdragon chip.
 * @returns true if running on x86 emulation on ARM, false otherwise.
 */
export const isCpuArchMismatch = () => {
    if (isMac) {
        try {
            // Use child_process to check sysctl.proc_translated
            // This is the proper way to detect Rosetta 2 translation
            const result = execSync("sysctl -n sysctl.proc_translated 2>/dev/null", {
                encoding: "utf8",
                timeout: 1000
            }).trim();

            // 1 means the process is being translated by Rosetta 2
            // 0 means native execution
            // If the sysctl doesn't exist (on Intel Macs), this will return empty/error
            return result === "1";
        } catch (error) {
            // If sysctl fails or doesn't exist (Intel Macs), not running under Rosetta 2
            return false;
        }
    } else if (isWindows && arch() === "x64") {
        return cpus().some(cpu =>
            cpu.model.includes('Microsoft SQ') ||
            cpu.model.includes('Snapdragon'));
    } else {
        return false;
    }
};

/**
 * Collects this host's non-internal network addresses, sorted by how likely
 * each is to be the reachable LAN address. Pure and exported so it can be
 * unit-tested without touching the real OS interfaces.
 */
export function collectNetworkAddresses(interfaces: ReturnType<typeof networkInterfaces>): string[] {
    const addresses: string[] = [];

    for (const nets of Object.values(interfaces)) {
        if (!nets) continue;
        for (const net of nets) {
            if (net.internal) continue;
            if (net.family === "IPv6" && net.scopeid !== 0) continue;
            addresses.push(net.address);
        }
    }

    addresses.sort((a, b) => networkScore(a) - networkScore(b));

    return addresses;
}

function networkScore(addr: string): number {
    if (addr.startsWith("192.168.")) return 0;
    if (addr.startsWith("10.")) return 1;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(addr)) return 2;
    if (addr.includes(":")) return 4; // IPv6
    return 3;
}

/**
 * Builds a connectable URL from a host address, wrapping IPv6 literals in
 * brackets as required by the URL authority syntax. Pure and exported for
 * unit testing.
 */
export function buildNetworkUrl(protocol: string, address: string, port: number): string {
    const host = address.includes(":") ? `[${address}]` : address;
    return `${protocol}://${host}:${port}`;
}

/**
 * Whether the configured listening host is reachable from other devices.
 * Returns `false` for loopback-only bindings (the Electron desktop default),
 * where the advertised LAN addresses can't actually be connected to. Pure and
 * exported for unit testing.
 */
export function isHostReachableOnNetwork(host: string): boolean {
    const normalized = host.trim().toLowerCase();
    return normalized !== "localhost" && normalized !== "::1" && !normalized.startsWith("127.");
}

export default {
    systemChecks,
    getNetworkAddresses
};
