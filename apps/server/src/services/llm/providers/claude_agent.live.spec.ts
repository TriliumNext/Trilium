/**
 * Live integration test for the Claude Agent keep-alive: drives the user's real
 * `claude` CLI and asserts a second turn reuses the warm subprocess instead of
 * re-paying the spawn.
 *
 * Opt-in — it spawns a subprocess, needs `claude /login`, and spends the
 * subscription's budget, so it never runs in CI:
 *
 *     TRILIUM_CLAUDE_LIVE_TEST=1 pnpm --filter server test claude_agent.live
 */

import type { LlmStreamChunk } from "@triliumnext/commons";
import { describe, expect, it } from "vitest";

import { ClaudeAgentProvider } from "./claude_agent.js";
import { resetClaudeSessionPoolForTests } from "./claude_session_pool.js";

const live = process.env.TRILIUM_CLAUDE_LIVE_TEST === "1";

/** The cheapest model on the subscription. */
const MODEL = "claude-haiku-4-5-20251001";

describe.runIf(live)("ClaudeAgentProvider keep-alive (live CLI)", () => {
    it("answers a second turn on the warm subprocess, without re-paying the spawn", async () => {
        const provider = new ClaudeAgentProvider();
        const chatNoteId = "live-keep-alive";
        resetClaudeSessionPoolForTests();

        async function turn(messages: { role: "user" | "assistant"; content: string }[]) {
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
            return { firstTokenMs, text };
        }

        const cold = await turn([{ role: "user", content: "Reply with exactly the word: alpha" }]);
        const warm = await turn([
            { role: "user", content: "Reply with exactly the word: alpha" },
            { role: "assistant", content: cold.text },
            { role: "user", content: "Reply with exactly the word: beta" }
        ]);

        console.log(`live keep-alive: cold first token ${cold.firstTokenMs} ms, warm ${warm.firstTokenMs} ms`);

        expect(cold.text.toLowerCase()).toContain("alpha");
        expect(warm.text.toLowerCase()).toContain("beta");
        // The warm turn skips the ~1.3 s subprocess spawn. Assert a fraction of
        // that so the test tracks the behaviour, not this machine's numbers.
        expect(warm.firstTokenMs).toBeLessThan((cold.firstTokenMs ?? 0) - 500);
    }, 180_000);
});
