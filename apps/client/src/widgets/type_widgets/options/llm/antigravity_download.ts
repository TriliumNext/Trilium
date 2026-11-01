/**
 * Finds the download of Google's Antigravity ACP server for the device running
 * Trilium, which the setup checklist links.
 *
 * The archive must match the server, not the browser, so the platform and CPU
 * come from `window.glob`, which the server fills in at startup. The archive
 * URLs carry the version, so they are read from Google's entry in the ACP
 * registry rather than written here.
 */

import { useEffect, useState } from "preact/hooks";

/** A download of the server; empty when there is none to offer. */
export interface AntigravityDownload {
    version?: string;
    url?: string;
}

/** The download for the device running Trilium, looked up once per mount. `{}` until then, and when there is none. */
export function useAntigravityDownload(): AntigravityDownload {
    const [ download, setDownload ] = useState<AntigravityDownload>({});
    useEffect(() => {
        let active = true;
        void findAntigravityDownload(window.glob.platform, window.glob.arch).then(found => {
            if (active) setDownload(found);
        });
        return () => { active = false; };
    }, []);
    return download;
}

/**
 * The archive of the current release for a platform. Never rejects: without
 * one, the checklist points at the registry entry instead.
 */
export async function findAntigravityDownload(
    platform: string | undefined,
    arch: string | undefined,
    fetchImpl: typeof fetch = fetch
): Promise<AntigravityDownload> {
    const key = registryPlatformKey(platform, arch);
    if (!key) {
        return {};
    }
    try {
        const response = await fetchImpl(REGISTRY_ENTRY_URL, { signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS) });
        if (!response.ok) {
            return {};
        }
        const entry = await response.json() as RegistryEntry;
        const archive = entry.distribution?.binary?.[key]?.archive;
        if (typeof archive !== "string" || !isGoogleDownload(archive)) {
            return {};
        }
        return { version: typeof entry.version === "string" ? entry.version : undefined, url: archive };
    } catch {
        return {};
    }
}

/** The registry's name for a platform, such as `linux-x86_64`, from Node's names for it; undefined for one it does not list. */
export function registryPlatformKey(platform: string | undefined, arch: string | undefined): string | undefined {
    const os = platform === "linux" ? "linux" : platform === "darwin" ? "darwin" : platform === "win32" ? "windows" : undefined;
    const cpu = arch === "x64" ? "x86_64" : arch === "arm64" ? "aarch64" : undefined;
    return os && cpu ? `${os}-${cpu}` : undefined;
}

/** Google's entry in the ACP registry, which Google updates with each release. */
const REGISTRY_ENTRY_URL = "https://raw.githubusercontent.com/agentclientprotocol/registry/main/antigravity-acp/agent.json";

const REGISTRY_TIMEOUT_MS = 10_000;

/** The part of the registry's `agent.json` that names the archives. */
interface RegistryEntry {
    version?: unknown;
    distribution?: { binary?: Record<string, { archive?: unknown } | undefined> };
}

/**
 * Whether a URL is one of Google's downloads. The registry is a third-party
 * repository, and the checklist opens whatever link it finds there.
 */
function isGoogleDownload(url: string): boolean {
    try {
        const parsed = new URL(url);
        return parsed.protocol === "https:" && parsed.hostname === "dl.google.com";
    } catch {
        return false;
    }
}
