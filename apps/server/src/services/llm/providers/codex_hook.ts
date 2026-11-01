/**
 * Decides every tool call Codex makes.
 *
 * Codex's `read-only` mode confines writes and the network, not reads: its
 * shell and its image viewer (`view_image`, which opens any file) run without
 * asking permission, and its web search (`webrun`) is on by default. More tools
 * arrive with Codex's releases (apps, a browser), and the user brings their own
 * Codex, so a list of what to switch off cannot keep up.
 *
 * Codex runs `PreToolUse` hooks from `<CODEX_HOME>/hooks.json` before every tool
 * call, built-in and MCP alike, so Trilium writes one there that posts each
 * call to its loopback listener (`getAcpHookEndpointUrl`) with `curl`, and
 * {@link decideCodexToolCall} answers from an allow-list. Codex lets a call
 * through when its hook fails with any exit code but 2, so the hook command
 * turns a failed `curl` into exit 2.
 *
 * A `PostToolUse` hook posts each finished call too, so Trilium can read the
 * sources out of a web search (see {@link codexSearchSources}).
 */

import type { LlmCitation } from "@triliumnext/commons";
import type { LlmProviderConfig } from "@triliumnext/core/src/services/llm/types.js";
import { mkdirSync, writeFileSync } from "fs";
import path from "path";

import { type BuiltInToolDisplay, NOTE_TOOLS_MCP_SERVER_NAME } from "./acp_agent.js";
import { buildHookCommand, stringsIn } from "./acp_hook.js";
import { type HostLookup, isPublicHttpUrl } from "./public_url.js";

/** What the hook prints: no decision leaves the call to Codex, a `deny` stops it. */
export interface CodexHookAnswer {
    hookSpecificOutput?: {
        hookEventName: "PreToolUse";
        permissionDecision: "deny";
        permissionDecisionReason: string;
    };
}

/** The name Codex gives its web search in hook events. */
const WEB_TOOL = "webrun";

/** `webrun` arguments that tune every operation rather than name one. */
const WEBRUN_OPTIONS = new Set([ "response_length" ]);

/** How `webrun` answers a call it could not run, in place of results. */
const WEBRUN_NO_RESPONSE = "Found no tool response.";

/** `<title> (<url>)` and, on the next line, the result's citation marker, `U+E200 cite U+E202 <id> U+E201`. */
const SEARCH_RESULT_HEADER = /^(.*) \((https?:\/\/\S+)\)\n\uE200cite\uE202([^\uE201\uE202]+)\uE201/gm;

/** How long Codex waits for the hook, in seconds; `curl` (see `buildHookCommand`) gives up first. */
const HOOK_TIMEOUT_S = 10;

const NOTE_TOOLS_ONLY = "Trilium does not allow this tool. Use Trilium's note tools to read, search and edit the user's notes instead.";
const WEB_SEARCH_OFF = "Web search is turned off for this chat.";
const PRIVATE_ADDRESS = "Trilium does not allow opening local or private addresses.";
const UNKNOWN_RESULT = "Trilium can only open search results this chat's searches returned. Open the page by its URL instead.";

/** What the hook knows of the chat turn running in a session (the event's `session_id`, the ACP session id). */
export interface CodexTurns {
    /** The turn's configuration. */
    configOf(sessionId: string): LlmProviderConfig | undefined;
    /** The URL of a search result the turn's web searches returned, by its id (`turn1search0`). */
    urlOf(sessionId: string, ref: string): string | undefined;
}

/**
 * The answer to one `PreToolUse` call: Trilium's note tools pass, and the web
 * search passes in a chat that allows it when every URL it opens is on the
 * public internet. A page opened by a search result's id is checked by that
 * result's URL, and an id the turn's searches never returned is refused, as
 * its destination cannot be checked. Everything else is denied.
 */
export async function decideCodexToolCall(payload: unknown, turns: CodexTurns, lookup?: HostLookup): Promise<CodexHookAnswer> {
    const event = payload as { tool_name?: unknown; tool_input?: unknown; session_id?: unknown } | null;
    const toolName = typeof event?.tool_name === "string" ? event.tool_name : "";
    if (toolName.startsWith(`mcp__${NOTE_TOOLS_MCP_SERVER_NAME}__`)) {
        return {};
    }
    if (toolName !== WEB_TOOL) {
        return deny(NOTE_TOOLS_ONLY);
    }
    const sessionId = typeof event?.session_id === "string" ? event.session_id : undefined;
    if (sessionId === undefined || turns.configOf(sessionId)?.enableWebSearch !== true) {
        return deny(WEB_SEARCH_OFF);
    }
    const isUrl = (value: string) => /^https?:\/\//i.test(value);
    const opened = (event?.tool_input as { open?: unknown } | null | undefined)?.open;
    const urls = stringsIn(event?.tool_input).filter(isUrl);
    for (const ref of stringsIn(opened).filter(value => !isUrl(value))) {
        const url = turns.urlOf(sessionId, ref);
        if (url === undefined) {
            return deny(UNKNOWN_RESULT);
        }
        urls.push(url);
    }
    const allPublic = await Promise.all(urls.map(url => isPublicHttpUrl(url, lookup)));
    return allPublic.every(Boolean) ? {} : deny(PRIVATE_ADDRESS);
}

/**
 * The sources a web search returned, by the id the model cites them with
 * (`turn1search0`), from a `PostToolUse` event for `webrun`; undefined for any
 * other event. Each result in the tool's response opens with a line
 * `<title> (<url>)` followed by the result's citation marker.
 */
export function codexSearchSources(payload: unknown): { sessionId: string; sources: Map<string, LlmCitation> } | undefined {
    const event = payload as { hook_event_name?: unknown; tool_name?: unknown; tool_response?: unknown; session_id?: unknown } | null;
    if (event?.hook_event_name !== "PostToolUse" || event.tool_name !== WEB_TOOL || typeof event.session_id !== "string") {
        return undefined;
    }
    const sources = new Map<string, LlmCitation>();
    for (const text of stringsIn(event.tool_response)) {
        for (const [ , title, url, ref ] of text.matchAll(SEARCH_RESULT_HEADER)) {
            sources.set(ref, { title, url });
        }
    }
    return { sessionId: event.session_id, sources };
}

/**
 * How the chat shows a `webrun` call. `webrun` runs several operations —
 * `search_query` (`[{ q }]`), `open` (`[{ ref_id }]`, a URL or the id of an
 * earlier result, which `urlOf` resolves), and others such as `weather`
 * (`[{ location }]`) — which the adapter reports as a web search with an empty
 * query unless it is a search. A call that only opens a page is the chat's
 * `read_web_page`; the rest are `web_search`, with the query or operation.
 */
export function describeWebrunInput(toolInput: unknown, urlOf: (ref: string) => string | undefined = () => undefined): BuiltInToolDisplay {
    const operations = Object.entries(toolInput && typeof toolInput === "object" ? toolInput : {})
        .filter(([ operation ]) => !WEBRUN_OPTIONS.has(operation));
    if (operations.length === 1 && operations[0][0] === "open") {
        const ref = stringsIn(operations[0][1])[0];
        const url = ref && (/^https?:\/\//i.test(ref) ? ref : urlOf(ref));
        return { toolName: "read_web_page", toolInput: url ? { url } : {} };
    }
    const parts = operations.map(([ operation, value ]) => {
        const values = stringsIn(value).join(", ");
        return operation === "search_query" ? values : `${operation}: ${values}`;
    }).filter(Boolean);
    return { toolName: "web_search", toolInput: parts.length > 0 ? { query: parts.join("; ") } : {} };
}

/**
 * The `webrun` call a `PostToolUse` event reports as failed although Codex
 * reported it done: its response then says so in place of results, as for a
 * `weather` call whose location it could not read. Undefined for any other
 * event.
 */
export function webrunFailure(payload: unknown): { sessionId: string; toolCallId: string; reason: string } | undefined {
    const event = payload as { hook_event_name?: unknown; tool_name?: unknown; session_id?: unknown; tool_use_id?: unknown; tool_response?: unknown } | null;
    if (event?.hook_event_name !== "PostToolUse" || event.tool_name !== WEB_TOOL
        || typeof event.session_id !== "string" || typeof event.tool_use_id !== "string") {
        return undefined;
    }
    const reason = stringsIn(event.tool_response).find(text => text.startsWith(WEBRUN_NO_RESPONSE));
    return reason ? { sessionId: event.session_id, toolCallId: event.tool_use_id, reason } : undefined;
}

/**
 * Write the hooks to `<home>/hooks.json`, replacing what an earlier run wrote:
 * `preCommand` before every tool call, `postCommand` after, which reads the
 * sources out of a web search (see {@link codexSearchSources}).
 */
export function writeCodexHooks(home: string, preCommand: string, postCommand: string): void {
    mkdirSync(home, { recursive: true });
    const hook = (command: string) => [ { matcher: ".*", hooks: [ { type: "command", command, timeout: HOOK_TIMEOUT_S } ] } ];
    const hooks = { hooks: { PreToolUse: hook(preCommand), PostToolUse: hook(postCommand) } };
    writeFileSync(path.join(home, "hooks.json"), JSON.stringify(hooks, null, 2));
}

/**
 * Antigravity's `curl` command, failing closed: Codex blocks a call only on
 * exit code 2, so any failure (Trilium unreachable, an error response, the
 * time limit) becomes one. `||` reads the same under `sh -c` and `cmd /c`.
 */
export function buildCodexHookCommand(curl: string, hookUrl: string): string {
    return `${buildHookCommand(curl, hookUrl)} || exit 2`;
}

function deny(reason: string): CodexHookAnswer {
    return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } };
}
