/**
 * Custom web search tools for LLM chat.
 * Provides Tavily and SearXNG search as alternatives to provider-built-in web search.
 */

import { tool } from "ai";
import type { ToolSet } from "ai";
import { z } from "zod";

import { getLog } from "@triliumnext/core";

const MAX_RESULTS = 5;
const DEFAULT_TIMEOUT_MS = 15_000;

/** Create an AbortSignal that times out after the given milliseconds. */
function timeoutSignal(ms: number): AbortSignal {
    return AbortSignal.timeout(ms);
}

interface TavilyResult {
    title: string;
    url: string;
    content: string;
}

interface SearxngResult {
    title: string;
    url: string;
    content: string;
}

/**
 * Add a Tavily web search tool to the tool set.
 * Tavily is an AI-optimized search API that returns clean, relevant results.
 * Free tier: 1000 queries/month at https://tavily.com
 */
export function addTavilySearchTool(tools: ToolSet, apiKey: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): void {
    tools.web_search = tool({
        description: "Search the web for current information using Tavily. Use this when the user asks about recent events, real-time data, or anything requiring up-to-date web information.",
        inputSchema: z.object({
            query: z.string().describe("The search query")
        }),
        execute: async ({ query }) => {
            try {
                const response = await fetch("https://api.tavily.com/search", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        // Tavily requires Bearer authentication; the api_key body field is deprecated
                        "Authorization": `Bearer ${apiKey}`
                    },
                    body: JSON.stringify({
                        query,
                        max_results: MAX_RESULTS,
                        include_answer: true
                    }),
                    signal: timeoutSignal(timeoutMs)
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    getLog().error(`Tavily search failed: ${response.status} ${errorText}`);
                    return { error: `Search failed: ${response.status}` };
                }

                const data = await response.json() as { answer?: string; results: TavilyResult[] };

                return {
                    answer: data.answer || undefined,
                    results: data.results.map((r: TavilyResult) => ({
                        title: r.title,
                        url: r.url,
                        snippet: r.content
                    }))
                };
            } catch (e) {
                getLog().error(`Tavily search error: ${e}`);
                return { error: `Search failed: ${e instanceof Error ? e.message : String(e)}` };
            }
        }
    });
}

/**
 * Add a SearXNG web search tool to the tool set.
 * SearXNG is a self-hosted metasearch engine that aggregates results from multiple sources.
 * No API key required — just a running SearXNG instance URL.
 */
export function addSearxngSearchTool(tools: ToolSet, instanceUrl: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): void {
    // Normalize the URL (remove trailing slash)
    const baseUrl = instanceUrl.replace(/\/+$/, "");

    tools.web_search = tool({
        description: "Search the web for current information using SearXNG. Use this when the user asks about recent events, real-time data, or anything requiring up-to-date web information.",
        inputSchema: z.object({
            query: z.string().describe("The search query")
        }),
        execute: async ({ query }) => {
            try {
                const params = new URLSearchParams({
                    q: query,
                    format: "json",
                    categories: "general",
                    language: "auto"
                });

                const response = await fetch(`${baseUrl}/search?${params}`, {
                    headers: { "Accept": "application/json" },
                    signal: timeoutSignal(timeoutMs)
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    getLog().error(`SearXNG search failed: ${response.status} ${errorText}`);
                    return { error: `Search failed: ${response.status}` };
                }

                const data = await response.json() as { results: SearxngResult[] };

                return {
                    results: (data.results || []).slice(0, MAX_RESULTS).map((r: SearxngResult) => ({
                        title: r.title,
                        url: r.url,
                        snippet: r.content
                    }))
                };
            } catch (e) {
                getLog().error(`SearXNG search error: ${e}`);
                return { error: `Search failed: ${e instanceof Error ? e.message : String(e)}` };
            }
        }
    });
}
