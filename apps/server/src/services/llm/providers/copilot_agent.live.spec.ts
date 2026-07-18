/**
 * Live integration test for the Copilot Agent keep-alive: drives the user's
 * real `copilot` CLI and asserts that a second turn skips the spawn and the
 * session handshake the first one paid for.
 *
 * Opt-in — it spawns a subprocess, needs `copilot login`, and spends the
 * subscription's premium-request budget, so it never runs in CI:
 *
 *     TRILIUM_COPILOT_LIVE_TEST=1 pnpm --filter server test copilot_agent.live
 */

import type { LlmStreamChunk } from "@triliumnext/commons";
import { describe, expect, it, vi } from "vitest";

import { AcpClient } from "./acp_client.js";
import { CopilotAgentProvider } from "./copilot_agent.js";
import { resetCopilotClientPoolForTests } from "./copilot_client_pool.js";

const live = process.env.TRILIUM_COPILOT_LIVE_TEST === "1";

/** The cheapest model on the subscription (0x premium multiplier). */
const MODEL = "gpt-5-mini";

describe.runIf(live)("CopilotAgentProvider keep-alive (live CLI)", () => {
    it("answers a second turn without re-paying the spawn and session handshake", async () => {
        const provider = new CopilotAgentProvider();
        const chatNoteId = "live-keep-alive";
        resetCopilotClientPoolForTests();

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
            for await (const chunk of provider.chatChunks(messages, { chatNoteId, model: MODEL, enableNoteTools: false })) {
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
        expect(warm.methods).toEqual(["session/set_model", "session/prompt"]);
        // The warm turn skips the spawn (~0.8 s) plus the cold session/new
        // (~2.4 s). Assert a conservative fraction of that so the test tracks
        // the behaviour rather than this machine's exact numbers.
        expect(warm.firstTokenMs).toBeLessThan((cold.firstTokenMs ?? 0) - 1000);
    }, 180_000);
});
