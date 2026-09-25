/**
 * Decides whether an agent can fetch a URL: only `http(s)` URLs whose host is
 * on the public internet. A fetch runs on the device hosting Trilium, so a
 * local or private address would reach services that are not meant to be
 * reachable from outside, such as a router or a cloud metadata endpoint.
 *
 * The host is resolved when the fetch is approved. A server that redirects to
 * a local address, or a name whose DNS answer changes before the agent
 * fetches it, is not caught here.
 */

import { lookup as dnsLookup } from "dns/promises";
import { BlockList, isIP } from "net";

/** Every address a host name resolves to. */
export type HostLookup = (hostname: string) => Promise<string[]>;

export async function isPublicHttpUrl(url: string, lookup: HostLookup = lookupAll): Promise<boolean> {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return false;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return false;
    }

    // The URL parser writes an IPv6 host in brackets and any IPv4 form as a dotted quad.
    const host = parsed.hostname.replace(/^\[(.*)\]$/, "$1");
    let addresses: string[];
    if (isIP(host)) {
        addresses = [ host ];
    } else {
        try {
            addresses = await lookup(host);
        } catch {
            return false;
        }
    }
    return addresses.length > 0 && addresses.every(isPublicAddress);
}

async function lookupAll(hostname: string): Promise<string[]> {
    const records = await dnsLookup(hostname, { all: true, verbatim: true });
    return records.map(record => record.address);
}

/** `BlockList` also checks an IPv4-mapped IPv6 address against the IPv4 ranges. */
function isPublicAddress(address: string): boolean {
    return !nonPublicAddresses().check(address, isIP(address) === 6 ? "ipv6" : "ipv4");
}

let cachedBlockList: BlockList | undefined;

/** Loopback, private, link-local, shared, multicast and reserved ranges (RFC 6890). */
function nonPublicAddresses(): BlockList {
    if (!cachedBlockList) {
        const list = new BlockList();
        for (const [ network, prefix ] of [
            [ "0.0.0.0", 8 ], [ "10.0.0.0", 8 ], [ "100.64.0.0", 10 ], [ "127.0.0.0", 8 ],
            [ "169.254.0.0", 16 ], [ "172.16.0.0", 12 ], [ "192.0.0.0", 24 ], [ "192.168.0.0", 16 ],
            [ "198.18.0.0", 15 ], [ "224.0.0.0", 4 ], [ "240.0.0.0", 4 ]
        ] as const) {
            list.addSubnet(network, prefix, "ipv4");
        }
        for (const [ network, prefix ] of [
            [ "::", 128 ], [ "::1", 128 ], [ "fc00::", 7 ], [ "fe80::", 10 ], [ "ff00::", 8 ]
        ] as const) {
            list.addSubnet(network, prefix, "ipv6");
        }
        cachedBlockList = list;
    }
    return cachedBlockList;
}
