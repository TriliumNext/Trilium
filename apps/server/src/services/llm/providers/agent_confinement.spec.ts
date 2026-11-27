import path from "path";
import { afterEach, describe, expect, it } from "vitest";

import { decideAntigravityToolCall } from "./antigravity_hook.js";
import { getAgentEnvironment } from "./binary_lookup.js";
import { decideCodexToolCall } from "./codex_hook.js";

/**
 * Checks what keeps an agent program away from the files next to its working folder in the data
 * directory, such as the second factor key and the session secret, and from the server's
 * environment. The live specs of each program check what its own tools do.
 */
const dataDir = path.resolve("/trilium-data");
const dirs = {
    home: path.join(dataDir, "antigravity-agent", "home"),
    workspace: path.join(dataDir, "antigravity-agent", "workspace")
};

/** Each file, by a path outside the working folder, in every form the program could expand. */
const OUTSIDE = [
    "../../second_factor_key.txt",
    path.join(dataDir, "second_factor_key.txt"),
    "../../session_secret.txt",
    "../../notification-channel-secrets.json",
    path.join(dataDir, "notification-channel-secrets.json"),
    "../../notification-deliveries.json",
    "~/notification-deliveries.json",
    `/proc/${process.pid}/environ`,
    "~/second_factor_key.txt",
    "$HOME/session_secret.txt",
    "${TRILIUM_DATA_DIR}/second_factor_key.txt",
    "%USERPROFILE%\\session_secret.txt",
    "file:///trilium-data/second_factor_key.txt",
    "FILE:second_factor_key.txt"
];

const identity = (candidate: string) => candidate;

describe("the confinement of the agent programs", () => {
    afterEach(() => {
        delete process.env.TRILIUM_RESET_SECOND_FACTOR;
        delete process.env.trilium_oauth_client_secret;
    });

    it("has Antigravity's hook refuse a read outside the working folder, in every form", () => {
        for (const name of [ "view_file", "list_directory", "search_directory", "find_file" ]) {
            for (const target of OUTSIDE) {
                const decision = decideAntigravityToolCall(
                    { toolCall: { name, args: { path: target } } }, dirs, { realpath: identity });
                expect(decision.decision, `${name} ${target}`).toBe("deny");
            }
        }
    });

    it("has Antigravity's hook pass a read inside the working folder or the brain folder", () => {
        for (const target of [
            "notes/plan.md",
            path.join(dirs.workspace, "x.md"),
            path.join(dirs.home, "antigravity-acp", "brain", "tools.md")
        ]) {
            const decision = decideAntigravityToolCall(
                { toolCall: { name: "view_file", args: { path: target, pattern: "Note: TODO" } } },
                dirs, { realpath: identity });
            expect(decision.decision, target).toBe("allow");
        }
    });

    it("leaves other Antigravity tools to its permission flow, denying the private folder", () => {
        const ask = decideAntigravityToolCall(
            { toolCall: { name: "run_command", args: { command: "ls ../../" } } },
            dirs, { realpath: identity });
        expect(ask.decision).toBe("ask");

        const token = path.join(dirs.home, "antigravity-acp", "acp_token.json");
        const deny = decideAntigravityToolCall(
            { toolCall: { name: "run_command", args: { command: token } } },
            dirs, { realpath: identity });
        expect(deny.decision).toBe("deny");
    });

    it("has Codex's hook refuse every tool but the note tools and the web search", async () => {
        const turns = { configOf: () => undefined, urlOf: () => undefined };
        for (const target of OUTSIDE) {
            for (const tool of [ "shell", "read_file", "view_image" ]) {
                const answer = await decideCodexToolCall(
                    { tool_name: tool, tool_input: { path: target }, session_id: "s" }, turns);
                expect(answer.hookSpecificOutput?.permissionDecision, `${tool} ${target}`)
                    .toBe("deny");
            }
        }
    });

    it("starts every program without the server's TRILIUM_ variables", () => {
        process.env.TRILIUM_RESET_SECOND_FACTOR = "the owner's long words of reset";
        process.env.trilium_oauth_client_secret = "secret";

        const env = getAgentEnvironment({ CODEX_HOME: "/home" });

        expect(Object.keys(env).filter((name) => /^trilium_/i.test(name))).toEqual([]);
        expect(env.CODEX_HOME).toBe("/home");
        expect(env.PATH ?? env.Path).toBe(process.env.PATH ?? process.env.Path);
    });
});
