/**
 * What the AI SDK does when it is *not* running under Node — the standalone
 * build, whose backend lives in a browser worker.
 *
 * The tests here deliberately use the real SDK rather than the `ai` mock the
 * other provider specs install: the behaviour under test is the SDK's own, and a
 * stub would assert nothing about it.
 */

import type { LlmStreamChunk } from "@triliumnext/commons";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { streamToChunks } from "../stream.js";
import { AnthropicProvider } from "./anthropic.js";

/** Collected while a case runs; asserted empty at the end of each. */
const leaked: unknown[] = [];
const collectLeak = (reason: unknown) => { leaked.push(reason); };

const realRelease = process.release;

describe("a failing completion outside Node", () => {
    beforeEach(() => {
        leaked.length = 0;
        process.on("unhandledRejection", collectLeak);
        // The SDK decides whether it can trace by looking here, and everything it
        // does differently in a browser follows from the answer being "no".
        Object.defineProperty(process, "release", { value: { name: "browser" }, configurable: true });
    });

    afterEach(() => {
        process.off("unhandledRejection", collectLeak);
        Object.defineProperty(process, "release", { value: realRelease, configurable: true });
        vi.unstubAllGlobals();
    });

    it("leaves no rejection unhandled when the provider rejects the request", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => new Response(
            JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low" } }),
            { status: 400, headers: { "content-type": "application/json" } }
        )));

        const provider = new AnthropicProvider("sk-fake", "https://example.invalid/v1");
        const chunks: LlmStreamChunk[] = [];
        for await (const chunk of streamToChunks(provider.chat([{ role: "user", content: "hi" }], {}))) {
            chunks.push(chunk);
        }

        expect(chunks).toEqual([expect.objectContaining({ type: "error", error: expect.stringContaining("credit balance") })]);

        // A rejection escaping here is not cosmetic: standalone reports every one
        // of them to the user, so a routine API error would look like a crash.
        await new Promise(resolve => setTimeout(resolve, 300));
        expect(leaked.map(l => (l as Error)?.name)).toEqual([]);
    });
});
