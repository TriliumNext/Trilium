/**
 * What the ACP providers whose agents run `PreToolUse` hooks share (Google
 * Antigravity, OpenAI Codex): the `curl` command that posts a tool call to
 * Trilium's loopback hook endpoint (`getAcpHookEndpointUrl`), where `curl` is,
 * and the strings inside a call's arguments. Each provider writes its own hook
 * file and decides its own calls (see `antigravity_hook.ts`, `codex_hook.ts`).
 */

import { cachedProbe, findOnPath } from "./binary_lookup.js";

/** How long `curl` waits for Trilium's decision, in seconds; each agent's hook timeout is longer. */
const CURL_MAX_TIME_S = 8;

/**
 * The hook command: `curl` posts the call (the hook's stdin) to Trilium and
 * prints the decision. `--fail` turns an error response into a failed hook.
 * `--noproxy` keeps an `HTTP_PROXY` from routing the loopback request away
 * from Trilium. Agents run it with `sh -c`, or `cmd /c` on Windows; the URL
 * holds no character either shell reads.
 */
export function buildHookCommand(curl: string, hookUrl: string): string {
    if (curl.includes("\"")) {
        throw new Error(`Cannot quote the path of curl for the agent hook: ${curl}`);
    }
    return `"${curl}" --silent --show-error --fail --noproxy 127.0.0.1 --max-time ${CURL_MAX_TIME_S} --data-binary @- ${hookUrl}`;
}

/** The found `curl`, shared by concurrent first calls (see {@link cachedProbe}). */
const curl = cachedProbe(findCurl);

/** The absolute path of `curl`, which the hook runs. The path makes it independent of the server's PATH. */
export function resolveCurlPath(): Promise<string> {
    return curl.resolve();
}

/** For tests: forget the found `curl`. */
export function resetCurlCache(): void {
    curl.reset();
}

/** Every string inside a hook call's arguments, however deeply nested. */
export function stringsIn(value: unknown): string[] {
    if (typeof value === "string") {
        return [ value ];
    }
    if (Array.isArray(value)) {
        return value.flatMap(stringsIn);
    }
    if (value && typeof value === "object") {
        return Object.values(value).flatMap(stringsIn);
    }
    return [];
}

async function findCurl(): Promise<string> {
    const found = await findOnPath("curl");
    if (!found) {
        throw new Error("The Google Antigravity and OpenAI Codex providers need curl, which Trilium uses to control what the agent can access, and curl was not found. Install curl (it ships with Windows 10 and later and with macOS) and make sure it is on PATH.");
    }
    return found;
}
