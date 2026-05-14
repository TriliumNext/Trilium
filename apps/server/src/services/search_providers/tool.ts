/**
 * AI-SDK tool wrapper that exposes a configured {@link SearchProvider} as the
 * {@code web_search} tool consumed by the LLM chat layer.
 */

import { tool, type ToolSet } from "ai";
import { z } from "zod";

import log from "../log.js";
import type { SearchProvider } from "./base_search_provider.js";

const MAX_REQUESTED_RESULTS = 20;

export function addConfiguredSearchTool(tools: ToolSet, provider: SearchProvider): void {
    tools.web_search = tool({
        description: `Search the web for current information using ${provider.name}. Use this when the user asks about recent events, real-time data, or anything requiring up-to-date web information.`,
        inputSchema: z.object({
            query: z.string().describe("The search query"),
            numResults: z
                .number()
                .int()
                .min(1)
                .max(MAX_REQUESTED_RESULTS)
                .optional()
                .describe("Maximum number of results to return")
        }),
        execute: async ({ query, numResults }) => {
            try {
                const results = await provider.search(query, { numResults });
                return {
                    results: results.map(r => ({
                        title: r.title,
                        url: r.url,
                        snippet: r.snippet,
                        ...(r.publishedDate && { publishedDate: r.publishedDate }),
                        ...(r.author && { author: r.author })
                    }))
                };
            } catch (e) {
                const message = e instanceof Error ? e.message : String(e);
                log.error(`${provider.name} search error: ${message}`);
                return { error: `Search failed: ${message}` };
            }
        }
    });
}
