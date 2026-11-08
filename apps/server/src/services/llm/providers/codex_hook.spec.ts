import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";

import { resolveCurlPath } from "./acp_hook.js";
import { buildCodexHookCommand, codexSearchSources, decideCodexToolCall, describeWebrunInput, webrunFailure, writeCodexHooks } from "./codex_hook.js";

/** `PreToolUse` events as Codex 0.146.0 and 0.156.1 send them, less the session bookkeeping. */
const EVENTS = {
    shell: { tool_name: "Bash", tool_input: { command: "cat /etc/hostname" } },
    viewImage: { tool_name: "view_image", tool_input: { path: "/etc/hostname", detail: "high" } },
    noteTool: { tool_name: "mcp__trilium__read_note", tool_input: { noteId: "abc" } },
    otherMcp: { tool_name: "mcp__codex_apps__send_email", tool_input: { to: "x" } },
    search: { tool_name: "webrun", tool_input: { search_query: [ { q: "latest Linux kernel" } ], response_length: "short" } },
    open: (url: string) => ({ tool_name: "webrun", tool_input: { open: [ { ref_id: "https://example.com/" }, { ref_id: url } ], response_length: "short" } })
};

const denied = (reason: RegExp) => ({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: expect.stringMatching(reason) } });

describe("decideCodexToolCall", () => {
    const configs: Record<string, { enableWebSearch?: boolean }> = { web: { enableWebSearch: true }, offline: {} };
    // The web chat's searches returned two results: one on the public internet, one on the local network.
    const results: Record<string, string> = { turn1search0: "https://example.com/news", turn1search1: "http://router.lan/admin" };
    const turns = {
        configOf: (sessionId: string) => configs[sessionId],
        urlOf: (sessionId: string, ref: string) => (sessionId === "web" ? results[ref] : undefined)
    };
    // example.com resolves to a public address, everything else to a private one.
    const lookup = async (host: string) => (host === "example.com" ? [ "93.184.215.14" ] : [ "192.168.1.1" ]);
    const decide = (event: object, sessionId = "web") => decideCodexToolCall({ ...event, session_id: sessionId, hook_event_name: "PreToolUse" }, turns, lookup);

    it("lets Trilium's note tools through and denies every other tool, whatever the chat allows", async () => {
        expect(await decide(EVENTS.noteTool)).toEqual({});
        for (const event of [ EVENTS.shell, EVENTS.viewImage, EVENTS.otherMcp, { tool_name: "browser_use" }, {} ]) {
            expect(await decide(event)).toEqual(denied(/note tools/));
        }
        expect(await decideCodexToolCall(null, turns, lookup)).toEqual(denied(/note tools/));
    });

    it("lets the web search through only in a chat that allows it, and only to public addresses", async () => {
        expect(await decide(EVENTS.search)).toEqual({});
        expect(await decide(EVENTS.open("https://example.com/about"))).toEqual({});
        expect(await decide(EVENTS.open("http://router.lan/admin"))).toEqual(denied(/private addresses/));
        expect(await decide(EVENTS.search, "offline")).toEqual(denied(/turned off/));
        // A session no chat turn is attached to, such as the title's, has no web access.
        expect(await decide(EVENTS.search, "unknown")).toEqual(denied(/turned off/));
        expect(await decideCodexToolCall(EVENTS.search, turns, lookup)).toEqual(denied(/turned off/));
    });

    it("checks a page opened by a search result's id by that result's URL, and refuses an id it cannot check", async () => {
        const openResult = (ref: string) => ({ tool_name: "webrun", tool_input: { open: [ { ref_id: ref } ], response_length: "medium" } });
        expect(await decide(openResult("turn1search0"))).toEqual({});
        expect(await decide(openResult("turn1search1"))).toEqual(denied(/private addresses/));
        expect(await decide(openResult("turn9search9"))).toEqual(denied(/search results this chat/));
    });
});

describe("Codex hook", () => {
    it("writes a hook before and after every tool call to hooks.json in Codex's home", () => {
        const home = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "trilium-codex-hook-")), "home");
        try {
            writeCodexHooks(home, "before", "after");
            expect(JSON.parse(fs.readFileSync(path.join(home, "hooks.json"), "utf8"))).toEqual({
                hooks: {
                    PreToolUse: [ { matcher: ".*", hooks: [ { type: "command", command: "before", timeout: 10 } ] } ],
                    PostToolUse: [ { matcher: ".*", hooks: [ { type: "command", command: "after", timeout: 10 } ] } ]
                }
            });
        } finally {
            fs.rmSync(path.dirname(home), { recursive: true, force: true });
        }
    });

    it("builds on Antigravity's curl command and exits with 2, which Codex reads as a denial, when Trilium cannot be reached", async () => {
        expect(buildCodexHookCommand("/usr/bin/curl", "http://127.0.0.1:1/hook-x/codex"))
            .toBe("\"/usr/bin/curl\" --silent --show-error --fail --noproxy 127.0.0.1 --max-time 8 --data-binary @- http://127.0.0.1:1/hook-x/codex || exit 2");

        // Port 1 on the loopback refuses the connection, as a stopped Trilium would.
        const command = buildCodexHookCommand(await resolveCurlPath(), "http://127.0.0.1:1/hook-x/codex");
        const shell = process.platform === "win32" ? [ "cmd", [ "/c", command ] ] as const : [ "sh", [ "-c", command ] ] as const;
        const exitCode = await new Promise<number | null>(resolve => {
            const child = execFile(shell[0], [ ...shell[1] ], error => resolve(error ? (error as { code?: number }).code ?? null : 0));
            child.stdin?.end("{}");
        });
        expect(exitCode).toBe(2);
    });
});

describe("codexSearchSources", () => {
    /** The start of a `webrun` response as Codex 0.156.1 sent it after a search. */
    const RESPONSE = [ { type: "input_text", text: [
        "Vremea în Sibiu pe 26 septembrie 2026 (Prognoza) (https://www.celsium.ro/vremea-sibiu/2026-09-26)",
        "\uE200cite\uE202turn1search0\uE201 [wordlim: 200] Crawled: 2 days ago; # Vremea în Sibiu",
        "some page text (https://example.com/not-a-header)",
        "Sibiu (https://en.wikipedia.org/wiki/Sibiu_(city))",
        "\uE200cite\uE202turn1search13\uE201 [wordlim: 200] Crawled: 4 months ago; Sibiu"
    ].join("\n") } ];
    const post = (extra: object) => ({ hook_event_name: "PostToolUse", session_id: "sess-1", tool_name: "webrun", tool_response: RESPONSE, ...extra });

    it("maps each search result's citation id to its title and URL", () => {
        expect(codexSearchSources(post({}))).toEqual({
            sessionId: "sess-1",
            sources: new Map([
                [ "turn1search0", { title: "Vremea în Sibiu pe 26 septembrie 2026 (Prognoza)", url: "https://www.celsium.ro/vremea-sibiu/2026-09-26" } ],
                [ "turn1search13", { title: "Sibiu", url: "https://en.wikipedia.org/wiki/Sibiu_(city)" } ]
            ])
        });
    });

    it("reads only a finished web search", () => {
        expect(codexSearchSources(post({ hook_event_name: "PreToolUse" }))).toBeUndefined();
        expect(codexSearchSources(post({ tool_name: "mcp__trilium__read_note" }))).toBeUndefined();
        expect(codexSearchSources(post({ session_id: undefined }))).toBeUndefined();
        expect(codexSearchSources(null)).toBeUndefined();
    });
});

describe("webrun calls", () => {
    it("shows a search and any other operation as a web search, with its query", () => {
        // Inputs as Codex 0.156.1 sent them.
        expect(describeWebrunInput({ search_query: [ { q: "Sibiu weather" }, { q: "Sibiu forecast" } ], response_length: "short" }))
            .toEqual({ toolName: "web_search", toolInput: { query: "Sibiu weather, Sibiu forecast" } });
        expect(describeWebrunInput({ weather: [ { location: "Romania, Sibiu", duration: 3 } ], response_length: "short" }))
            .toEqual({ toolName: "web_search", toolInput: { query: "weather: Romania, Sibiu" } });
        // Two operations at once are both named, and a call naming none shows no detail.
        expect(describeWebrunInput({ search_query: [ { q: "a" } ], open: [ { ref_id: "https://b.example/" } ] }))
            .toEqual({ toolName: "web_search", toolInput: { query: "a; open: https://b.example/" } });
        expect(describeWebrunInput({ response_length: "short" })).toEqual({ toolName: "web_search", toolInput: {} });
        expect(describeWebrunInput(undefined)).toEqual({ toolName: "web_search", toolInput: {} });
    });

    it("shows opening a page as reading it, by its URL or the URL of the result it opens", () => {
        const urlOf = (ref: string) => (ref === "turn2search0" ? "https://www.celsium.ro/vremea-sibiu" : undefined);
        expect(describeWebrunInput({ open: [ { ref_id: "https://example.com/" } ], response_length: "short" }, urlOf))
            .toEqual({ toolName: "read_web_page", toolInput: { url: "https://example.com/" } });
        expect(describeWebrunInput({ open: [ { ref_id: "turn2search0" } ], response_length: "medium" }, urlOf))
            .toEqual({ toolName: "read_web_page", toolInput: { url: "https://www.celsium.ro/vremea-sibiu" } });
        // A result this turn never saw has no URL to show; its id means nothing to the user.
        expect(describeWebrunInput({ open: [ { ref_id: "turn9search9" } ] }, urlOf)).toEqual({ toolName: "read_web_page", toolInput: {} });
    });

    it("finds a call webrun could not run, by the message it answers with", () => {
        const failure = "Found no tool response. This likely means the arguments you provided were not valid.";
        const post = (text: string, extra: object = {}) => ({
            hook_event_name: "PostToolUse", session_id: "sess-1", tool_name: "webrun", tool_use_id: "exec-1",
            tool_response: [ { type: "input_text", text } ], ...extra
        });
        expect(webrunFailure(post(failure))).toEqual({ sessionId: "sess-1", toolCallId: "exec-1", reason: failure });
        expect(webrunFailure(post("Weather in Sibiu (https://example.com)"))).toBeUndefined();
        expect(webrunFailure(post(failure, { hook_event_name: "PreToolUse" }))).toBeUndefined();
        expect(webrunFailure(post(failure, { tool_use_id: undefined }))).toBeUndefined();
    });
});
