/**
 * Live integration tests for the Claude Agent keep-alive: drive the user's real
 * `claude` CLI and assert that a second chat turn, and a later chat title, reuse
 * the warm subprocess instead of re-paying the spawn.
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

describe.runIf(live)("ClaudeAgentProvider titles (live CLI)", () => {
    it("names each chat after its own message in one warm session, emptied by /clear", async () => {
        const provider = new ClaudeAgentProvider();
        resetClaudeSessionPoolForTests();

        async function title(message: string) {
            const startedAt = Date.now();
            const text = await provider.generateTitle(message);
            return { text, ms: Date.now() - startedAt };
        }

        // Titles arrive far apart in use, so each `/clear` has finished before the next title.
        const pause = () => new Promise(resolve => setTimeout(resolve, 2000));
        const cold = await title("Give me a sourdough bread recipe with a long cold proof.");
        const warm: { text: string; ms: number }[] = [];
        for (const message of [
            "How do I change the oil on a 2015 Honda Civic?",
            "Explain how photosynthesis works in plants.",
            "Plan a week in Lisbon."
        ]) {
            await pause();
            warm.push(await title(message));
        }

        console.log(`live titles: ${JSON.stringify([cold, ...warm])}`);

        expect(cold.text.toLowerCase()).toMatch(/sourdough|bread/);
        expect(warm.map(t => t.text.toLowerCase())).toEqual([
            expect.stringMatching(/oil|civic|honda/),
            expect.stringMatching(/photosynthesis|plant|sunlight|light/),
            expect.stringMatching(/lisbon/)
        ]);
        for (const later of warm) {
            expect(later.text.toLowerCase()).not.toMatch(/sourdough|bread/);
        }
        // The model overshoots the five-word limit now and then; without the
        // examples in the system prompt it did so for about a third of titles.
        expect([cold, ...warm].filter(({ text }) => text.split(/\s+/).length > 5).length).toBeLessThanOrEqual(1);
        // A warm title skips the spawn, but the model's own latency varies by
        // about as much, so only the fastest one is held to the margin.
        expect(Math.min(...warm.map(t => t.ms))).toBeLessThan(cold.ms - 500);
    }, 180_000);
});
