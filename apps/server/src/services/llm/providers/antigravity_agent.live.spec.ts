/**
 * Live integration test for the Antigravity keep-alive: drives the user's real
 * `agy_acp_server` and asserts that a second turn skips the server start and
 * the session handshake the first one paid for.
 *
 * Opt-in — it starts the server, needs a saved Google sign-in, and spends the
 * subscription's quota, so it never runs in CI:
 *
 *     TRILIUM_ANTIGRAVITY_LIVE_TEST=1 pnpm --filter server test antigravity_agent.live
 *
 * The sign-in is copied from TRILIUM_ANTIGRAVITY_LIVE_HOME (default: the dev
 * server's `data/antigravity-agent/home`) into a temporary data directory.
 */

import type { LlmStreamChunk } from "@triliumnext/commons";
import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it, vi } from "vitest";

import { resetAcpAgentStateForTests } from "./acp_agent.js";
import { AcpClient } from "./acp_client.js";
import { AntigravityAgentProvider } from "./antigravity_agent.js";

const live = process.env.TRILIUM_ANTIGRAVITY_LIVE_TEST === "1";

/** A data directory of the run's own, so the dev server's hooks and sessions are left alone. */
const dataDir = path.join(os.tmpdir(), "trilium-antigravity-live");
vi.mock("../../data_dir.js", async () => {
    const nodeOs = await import("os");
    const nodePath = await import("path");
    return { default: { TRILIUM_DATA_DIR: nodePath.join(nodeOs.tmpdir(), "trilium-antigravity-live") } };
});

describe.runIf(live)("AntigravityAgentProvider keep-alive (live server)", () => {
    it("answers a second turn without re-paying the server start and session handshake", async () => {
        const sourceHome = process.env.TRILIUM_ANTIGRAVITY_LIVE_HOME
            ?? path.resolve("data", "antigravity-agent", "home");
        const home = path.join(dataDir, "antigravity-agent", "home");
        fs.mkdirSync(path.join(home, "antigravity-acp"), { recursive: true });
        // The token, and the settings that name its sign-in method.
        for (const file of ["acp_token.json", "settings.json"]) {
            fs.copyFileSync(path.join(sourceHome, "antigravity-acp", file), path.join(home, "antigravity-acp", file));
        }

        const provider = new AntigravityAgentProvider();
        const chatNoteId = "live-keep-alive";

        // Record the ACP methods each turn issues, so the assertions describe
        // the protocol traffic rather than inferring it from wall-clock time.
        let methods: string[] = [];
        const originalRequest = AcpClient.prototype.request;
        vi.spyOn(AcpClient.prototype, "request").mockImplementation(function (this: AcpClient, method: string, params: unknown, timeoutMs?: number) {
            methods.push(method);
            return originalRequest.call(this, method, params, timeoutMs);
        } as never);

        async function turn(messages: { role: "user" | "assistant"; content: string }[]) {
            methods = [];
            const startedAt = Date.now();
            let firstTokenMs: number | undefined;
            let text = "";
            for await (const chunk of provider.chatChunks(messages, { chatNoteId, enableNoteTools: false })) {
                const typed = chunk as LlmStreamChunk;
                if (typed.type === "text") {
                    firstTokenMs ??= Date.now() - startedAt;
                    text += typed.content;
                } else if (typed.type === "error") {
                    throw new Error(`Live agent turn failed: ${typed.error}`);
                }
            }
            return { firstTokenMs, text, methods: [...methods] };
        }

        try {
            const cold = await turn([{ role: "user", content: "Reply with exactly the word: alpha" }]);
            const warm = await turn([
                { role: "user", content: "Reply with exactly the word: alpha" },
                { role: "assistant", content: cold.text },
                { role: "user", content: "Reply with exactly the word: beta" }
            ]);

            console.log(
                `live keep-alive: cold ${cold.firstTokenMs} ms [${cold.methods.join(", ")}]`
                + ` | warm ${warm.firstTokenMs} ms [${warm.methods.join(", ")}]`
                + ` | cold reply ${JSON.stringify(cold.text)} | warm reply ${JSON.stringify(warm.text)}`
            );

            expect(cold.text.toLowerCase()).toContain("alpha");
            expect(warm.text.toLowerCase()).toContain("beta");
            // The warm turn talks to a session that is already loaded.
            expect(warm.methods).toEqual(["session/prompt"]);
            expect(warm.firstTokenMs).toBeLessThan((cold.firstTokenMs ?? 0) - 1000);
        } finally {
            resetAcpAgentStateForTests();
            // The server can still hold files open for a moment after it is told to stop.
            await new Promise(resolve => setTimeout(resolve, 6000));
            fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 1000 });
        }
    }, 300_000);
});
