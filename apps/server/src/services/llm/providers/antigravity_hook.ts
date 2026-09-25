/**
 * Keeps Google's Antigravity ACP server away from its own sign-in.
 *
 * The server's read tools (`view_file`, `list_directory`, `search_directory`,
 * `find_file`) run without asking permission, confined only to the agent cwd
 * and `<home>/antigravity-acp`. That folder also holds `acp_token.json`, so a
 * prompt injected through a note could have the agent read the token and copy
 * it into a note.
 *
 * The server runs `PreToolUse` hooks from `<home>/config/hooks.json` before
 * every tool call, and a hook's `deny` stops the call. A hook that fails also
 * stops it. Trilium writes a hook there that posts each call to its own
 * loopback listener (`getAcpHookEndpointUrl`) with `curl`, and
 * {@link decideAntigravityToolCall} answers.
 */

import { existsSync, mkdirSync, realpathSync, writeFileSync } from "fs";
import path from "path";

import { findOnPath } from "./binary_lookup.js";

export interface AntigravityHookDecision {
    decision: "allow" | "ask" | "deny";
    reason?: string;
}

/** The server's home (`GEMINI_HOME`) and the agent cwd. */
export interface AntigravityDirs {
    home: string;
    workspace: string;
}

/** The tools that read files without asking, by the names the hook receives. */
const READ_TOOLS = new Set([ "view_file", "list_directory", "search_directory", "find_file" ]);

const DENY_REASON = "Trilium does not allow access to this location. Use Trilium's note tools to read, search and edit the user's notes instead.";

/** How long the server waits for the hook, in seconds; `curl` gives up first. */
const HOOK_TIMEOUT_S = 10;
const CURL_MAX_TIME_S = 8;

/**
 * The answer to one `PreToolUse` call. `deny` when any path in the call's
 * arguments reaches `<home>/antigravity-acp` other than its `brain/` folder,
 * or a folder that contains it. Otherwise `allow` for the read tools and
 * `ask` for the rest: `ask` leaves a tool to the server's permission flow, so
 * the shell and file edits still reach {@link decideAntigravityPermission}.
 * `allow` cannot widen the server's own confinement.
 *
 * `brain/` stays readable because the agent reads the note tools'
 * descriptions and the output of long tool results there.
 */
export function decideAntigravityToolCall(
    payload: unknown,
    dirs: AntigravityDirs,
    { platform = process.platform, realpath = canonicalPath }: { platform?: NodeJS.Platform; realpath?: (candidate: string) => string } = {}
): AntigravityHookDecision {
    const toolCall = (payload as { toolCall?: { name?: unknown; args?: unknown } } | null)?.toolCall;
    const name = typeof toolCall?.name === "string" ? toolCall.name : undefined;

    const privateDir = realpath(path.join(dirs.home, "antigravity-acp"));
    const brainDir = path.join(privateDir, "brain");
    const reached = stringsIn(toolCall?.args)
        .filter(looksLikePath)
        .map(candidate => realpath(path.resolve(dirs.workspace, candidate)));
    const isInside = (child: string, parent: string) => isInsideOn(platform, child, parent);
    if (reached.some(candidate => (isInside(candidate, privateDir) && !isInside(candidate, brainDir)) || isInside(privateDir, candidate))) {
        return { decision: "deny", reason: DENY_REASON };
    }
    return { decision: name && READ_TOOLS.has(name) ? "allow" : "ask" };
}

/** Write the hook to `<home>/config/hooks.json`, replacing what an earlier run wrote. */
export function writeAntigravityHooks(home: string, command: string): void {
    const configDir = path.join(home, "config");
    mkdirSync(configDir, { recursive: true });
    const hooks = {
        "trilium-file-access": {
            PreToolUse: [ { matcher: ".*", hooks: [ { type: "command", command, timeout: HOOK_TIMEOUT_S } ] } ]
        }
    };
    writeFileSync(path.join(configDir, "hooks.json"), JSON.stringify(hooks, null, 2));
}

/**
 * The hook command: `curl` posts the call (the hook's stdin) to Trilium and
 * prints the decision. `--fail` turns an error response into a failed hook,
 * which the server treats as a denial. `--noproxy` keeps an `HTTP_PROXY`
 * from routing the loopback request away from Trilium. The server runs it
 * with `sh -c`, or `cmd /c` on Windows; the URL holds no character either
 * shell reads.
 */
export function buildHookCommand(curl: string, hookUrl: string): string {
    if (curl.includes("\"")) {
        throw new Error(`Cannot quote the path of curl for the Antigravity hook: ${curl}`);
    }
    return `"${curl}" --silent --show-error --fail --noproxy 127.0.0.1 --max-time ${CURL_MAX_TIME_S} --data-binary @- ${hookUrl}`;
}

/** The in-flight or successful lookup; a failed one is forgotten so a later install is found. */
let cachedCurl: Promise<string> | undefined;

/** The absolute path of `curl`, which the hook runs. The path makes it independent of the server's PATH. */
export function resolveCurlPath(): Promise<string> {
    if (!cachedCurl) {
        cachedCurl = findCurl().catch((err: unknown) => {
            cachedCurl = undefined;
            throw err;
        });
    }
    return cachedCurl;
}

/** For tests: forget the found `curl`. */
export function resetCurlCache(): void {
    cachedCurl = undefined;
}

async function findCurl(): Promise<string> {
    const curl = await findOnPath("curl");
    if (!curl) {
        throw new Error("Google Antigravity needs curl, which Trilium uses to control the agent's file access, and curl was not found. Install curl (it ships with Windows 10 and later and with macOS) and make sure it is on PATH.");
    }
    return curl;
}

function stringsIn(value: unknown): string[] {
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

function looksLikePath(value: string): boolean {
    return path.isAbsolute(value) || value.startsWith(".") || /[\\/]/.test(value);
}

/** Whether `child` is `parent` or lies below it, ignoring case where the platform's file systems do by default. */
function isInsideOn(platform: NodeJS.Platform, child: string, parent: string): boolean {
    const fold = (candidate: string) => (platform === "win32" || platform === "darwin" ? candidate.toLowerCase() : candidate);
    const relative = path.relative(fold(parent), fold(child));
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * The path with links and Windows short names (`ANTIGR~1`) resolved, so an
 * alias cannot hide where it leads. The part that does not exist yet is kept
 * as written below the nearest folder that does.
 */
function canonicalPath(candidate: string): string {
    const rest: string[] = [];
    let existing = candidate;
    while (!existsSync(existing)) {
        const parent = path.dirname(existing);
        /* v8 ignore next 3 -- only a root that does not exist, such as a missing Windows drive, ends here. */
        if (parent === existing) {
            return candidate;
        }
        rest.unshift(path.basename(existing));
        existing = parent;
    }
    try {
        return path.join(realpathSync.native(existing), ...rest);
    } catch {
        /* v8 ignore next -- the path existed a moment ago; it can only be removed or locked in between. */
        return candidate;
    }
}
