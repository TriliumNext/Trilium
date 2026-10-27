import type { networkInterfaces } from "os";

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

/**
 * Lists the URLs the server answers on, for the startup banner. A wildcard host yields
 * `localhost` plus every LAN address (IPv4 only for `0.0.0.0`); any other host yields its own
 * address, as `local` when it is loopback and in `network` otherwise.
 */
export function listListeningUrls(
    protocol: string,
    host: string,
    port: number,
    interfaces: ReturnType<typeof networkInterfaces>
): { local: string | undefined; network: string[] } {
    const normalized = host.trim();

    if (normalized === "0.0.0.0" || normalized === "::" || normalized === "") {
        const addresses = collectNetworkAddresses(interfaces)
            .filter((addr) => normalized !== "0.0.0.0" || !addr.includes(":"));

        return {
            local: buildNetworkUrl(protocol, "localhost", port),
            network: addresses.map((addr) => buildNetworkUrl(protocol, addr, port))
        };
    }

    const url = buildNetworkUrl(protocol, normalized, port);

    return isHostReachableOnNetwork(normalized)
        ? { local: undefined, network: [url] }
        : { local: url, network: [] };
}

function networkScore(addr: string): number {
    if (addr.startsWith("192.168.")) return 0;
    if (addr.startsWith("10.")) return 1;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(addr)) return 2;
    if (addr.includes(":")) return 4; // IPv6
    return 3;
}
