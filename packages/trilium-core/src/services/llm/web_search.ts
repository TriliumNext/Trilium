/**
 * Web search through a search provider the user configured (`kind: "search"` in the
 * `llmProviders` option), offered to the model as a `web_search` tool in place of the model's
 * built-in search, with a `read_web_page` tool to read what it finds.
 */

import { tool } from "ai";
import { parse as parseHtml } from "node-html-parser";
import { z } from "zod";

import markdownExport from "../export/markdown.js";
import request, { validateFetchableUrl } from "../request.js";
import { decodeUtf8 } from "../utils/binary.js";
import { trimTrailingSlashes } from "../utils/index.js";
import { llmFetch } from "./providers/fetch.js";

/** A configured search provider, as stored in the `llmProviders` option. */
export interface WebSearchSetup {
    provider: string;
    /** The name the user sees the provider by; the provider type stands in when absent. */
    name?: string;
    apiKey: string;
    baseURL?: string;
}

export interface WebSearchSource {
    title: string;
    url: string;
    snippet: string;
}

const MAX_RESULTS = 8;
const SEARCH_TIMEOUT_MS = 30_000;

/**
 * The `web_search` tool for `setup`. Its result has the `sources` the chat lists under the tool's
 * line and the `searchProvider` whose mark the line shows, and a failure is returned as
 * `{ error, instruction }`: the chat shows `error` on the tool's line, and `instruction` directs the
 * model to `read_web_page` and, for a {@link SearchSetupError}, to tell the user about it.
 */
export function createWebSearchTool(setup: WebSearchSetup) {
    return tool({
        description: "Search the web for current information. Returns the title, URL and a short excerpt of each matching page. "
            + "The excerpts rarely hold specific facts such as numbers, dates or versions, so before answering a factual "
            + "question, read the most promising results with read_web_page instead of answering from the excerpts.",
        inputSchema: z.object({
            query: z.string().describe("The search query")
        }),
        execute: async ({ query }, options) => {
            try {
                return {
                    query,
                    searchProvider: { type: setup.provider, name: setup.name ?? setup.provider },
                    sources: await searchWeb(setup, query, options.abortSignal)
                };
            } catch (e) {
                const error = e instanceof Error ? e.message : String(e);
                return {
                    error,
                    instruction: e instanceof SearchSetupError ? `${SETUP_ERROR_INSTRUCTION} ${READ_PAGE_INSTRUCTION}` : READ_PAGE_INSTRUCTION
                };
            }
        }
    });
}

const SETUP_ERROR_INSTRUCTION = "Only the user can fix this, in the search provider's settings or the search service itself. "
    + "Don't retry the search; tell the user what the error says and how to fix it.";
const READ_PAGE_INSTRUCTION = "The read_web_page tool fetches pages directly, without the search provider, "
    + "so you can still use it to read a page whose URL you know or the user gives.";

/** A search failure that only the user can fix, by changing the search provider or the service behind it. */
class SearchSetupError extends Error {}

/**
 * Run `query` against the search provider in `setup`. `signal` cancels the request along with the
 * chat turn that made it.
 *
 * A switch over literal cases, as `createProviderInstance()` is, because the provider type is
 * user-controlled.
 */
export async function searchWeb(setup: WebSearchSetup, query: string, signal?: AbortSignal): Promise<WebSearchSource[]> {
    switch (setup.provider) {
        case "brave": {
            const base = setup.baseURL ?? "https://api.search.brave.com/res/v1";
            const params = new URLSearchParams({ q: query, count: String(MAX_RESULTS) });
            const payload = await requestJson(`${base}/web/search?${params}`, {
                headers: { "Accept": "application/json", "X-Subscription-Token": setup.apiKey }
            }, signal) as { web?: { results?: unknown[] } };
            return toSources(payload.web?.results, "description");
        }
        case "tavily": {
            const payload = await requestJson(`${setup.baseURL ?? "https://api.tavily.com"}/search`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${setup.apiKey}` },
                body: JSON.stringify({ query, max_results: MAX_RESULTS })
            }, signal) as { results?: unknown[] };
            return toSources(payload.results, "content");
        }
        case "exa": {
            const payload = await requestJson(`${setup.baseURL ?? "https://api.exa.ai"}/search`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-api-key": setup.apiKey },
                body: JSON.stringify({ query, numResults: MAX_RESULTS, contents: { text: { maxCharacters: 1000 } } })
            }, signal) as { results?: unknown[] };
            return toSources(payload.results, "text");
        }
        case "serper": {
            const payload = await requestJson(`${setup.baseURL ?? "https://google.serper.dev"}/search`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "X-API-KEY": setup.apiKey },
                body: JSON.stringify({ q: query, num: MAX_RESULTS })
            }, signal) as { organic?: unknown[] };
            return toSources(payload.organic, "snippet", "link");
        }
        case "perplexity": {
            const payload = await requestJson(`${setup.baseURL ?? "https://api.perplexity.ai"}/search`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${setup.apiKey}` },
                body: JSON.stringify({ query, max_results: MAX_RESULTS })
            }, signal) as { results?: unknown[] };
            return toSources(payload.results, "snippet");
        }
        case "searxng": {
            if (!setup.baseURL) {
                throw new SearchSetupError("The SearXNG search provider has no address.");
            }
            const params = new URLSearchParams({ q: query, format: "json" });
            const payload = await requestJson(`${trimTrailingSlashes(setup.baseURL)}/search?${params}`, {
                headers: { "Accept": "application/json", ...(setup.apiKey && { "Authorization": `Bearer ${setup.apiKey}` }) }
            }, signal, (status) => describeSearxngFailure(status, !!setup.apiKey)) as { results?: unknown[] };
            return toSources(payload.results, "content").slice(0, MAX_RESULTS);
        }
        default:
            throw new Error(`Unknown search provider type: ${setup.provider}`);
    }
}

const MAX_PAGE_BYTES = 5 * 1024 * 1024;
const MAX_PAGE_CHARS = 20_000;
const HTML_TYPES = new Set([ "text/html", "application/xhtml+xml" ]);
const TEXT_TYPES = new Set([ "text/plain", "text/markdown" ]);
/** Elements that are page furniture rather than content. */
const NON_CONTENT = "script, style, noscript, template, svg, iframe, nav, header, footer, aside, form";

/**
 * The `read_web_page` tool. Its result is the page as Markdown, which the chat previews under the
 * tool's line; a failure is returned as `{ error }` so the model can tell the user about it.
 */
export function createReadWebPageTool() {
    return tool({
        description: "Read a web page, such as a web search result or a link the user gave, as Markdown. Long pages are cut off.",
        inputSchema: z.object({
            url: z.string().describe("The http(s) URL of the page")
        }),
        execute: async ({ url }) => {
            try {
                return await readWebPage(url);
            } catch (e) {
                return { error: e instanceof Error ? e.message : String(e) };
            }
        }
    });
}

/**
 * The page at `url` as Markdown, cut off at {@link MAX_PAGE_CHARS}.
 *
 * The URL is the model's to choose, and a note or a search result can steer it, so the page is
 * fetched with `fetchResource()`: the policy for addresses that arrive in content, which refuses
 * private networks, vets each redirect and caps the body. The mobile app's `fetchResource()` has no
 * resolver to make that check, so {@link isLocalHost} refuses the hosts it can recognize by name
 * first.
 */
export async function readWebPage(url: string): Promise<string> {
    const parsed = validateFetchableUrl(url);
    if (isLocalHost(parsed.hostname)) {
        throw new Error("URLs pointing to private/internal networks are not allowed");
    }
    const response = await request.fetchResource(parsed.toString(), {
        maxBytes: MAX_PAGE_BYTES,
        headers: { "Accept": "text/html, application/xhtml+xml, text/plain;q=0.9" }
    });
    if (!response.ok) {
        throw new Error(`The page answered HTTP ${response.status}.`);
    }
    const contentType = response.contentType || "text/html";
    let content: string;
    if (HTML_TYPES.has(contentType)) {
        content = htmlToMarkdown(decodeUtf8(response.bytes));
    } else if (TEXT_TYPES.has(contentType)) {
        content = decodeUtf8(response.bytes).trim();
    } else {
        throw new Error(`The page is ${contentType}, which can't be read as text.`);
    }
    return content.length > MAX_PAGE_CHARS
        ? `${content.slice(0, MAX_PAGE_CHARS)}\n\n[The page continues; only its first ${MAX_PAGE_CHARS} characters are shown.]`
        : content;
}

/** Name suffixes that only resolve on a local network. */
const LOCAL_NAME = /(^|\.)(localhost|local|lan|internal|home\.arpa)$/;
/** IPv4 ranges a public page is never served from: this host, private, CGNAT, link-local, multicast and reserved. */
const LOCAL_IPV4 = /^(0|10|127|169\.254|172\.(1[6-9]|2\d|3[01])|192\.168|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])|22[4-9]|2[3-5]\d)\./;

/**
 * Whether `hostname`, as `URL.hostname` serializes it, names this machine or a private network: a
 * single-label or local-only name, or an address in a non-public range. A name that resolves to a
 * private address passes, since no resolver is available on every runtime.
 */
function isLocalHost(hostname: string): boolean {
    const host = hostname.replace(/\.$/, "").toLowerCase();
    if (host.startsWith("[")) {
        const ipv6 = host.slice(1, -1);
        const mapped = /^::ffff:([\da-f]{1,4}):([\da-f]{1,4})$/.exec(ipv6);
        if (mapped) {
            const [ high, low ] = [ parseInt(mapped[1], 16), parseInt(mapped[2], 16) ];
            return isLocalHost(`${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`);
        }
        return ipv6 === "::" || ipv6 === "::1" || /^(f[cd][\da-f]{2}|fe[89ab][\da-f]|ff[\da-f]{2}):/.test(ipv6);
    }
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
        return LOCAL_IPV4.test(host);
    }
    return !host.includes(".") || LOCAL_NAME.test(host);
}

/** The content of a page as Markdown, headed by its title: its `main` or `article` where it has one. */
function htmlToMarkdown(html: string): string {
    const root = parseHtml(html);
    const title = root.querySelector("title")?.textContent.trim();
    for (const element of root.querySelectorAll(NON_CONTENT)) {
        element.remove();
    }
    const content = root.querySelector("main, article, [role=main]") ?? root.querySelector("body") ?? root;
    const markdown = markdownExport.toMarkdown(content.innerHTML, { headerlessTables: "emptyHeader" }).trim();
    return title ? `# ${title}\n\n${markdown}` : markdown;
}

/**
 * `describeFailure` names the cause of an HTTP error status the provider's API documents, which the
 * user must fix; when it returns `undefined`, the generic message for the status applies.
 */
async function requestJson(
    url: string,
    init: RequestInit,
    signal: AbortSignal | undefined,
    describeFailure?: (status: number) => string | undefined
): Promise<unknown> {
    const timeout = AbortSignal.timeout(SEARCH_TIMEOUT_MS);
    const response = await llmFetch(url, { ...init, signal: signal ? AbortSignal.any([ signal, timeout ]) : timeout });
    if (!response.ok) {
        const description = describeFailure?.(response.status);
        if (description) {
            throw new SearchSetupError(description);
        }
        if (response.status === 401 || response.status === 403) {
            throw new SearchSetupError(`The search provider refused the request (HTTP ${response.status}); check its API key in the AI settings.`);
        }
        throw new Error(`The search provider answered HTTP ${response.status}.`);
    }
    return await response.json();
}

/**
 * The cause of a SearXNG error status. SearXNG has no authentication: on `/search` it answers 403
 * only for a format missing from `search.formats` and 429 from its limiter, so a 401, or a 403
 * when an API key is set, can also come from a proxy in front of the instance.
 */
function describeSearxngFailure(status: number, hasApiKey: boolean): string | undefined {
    if (status === 403 && !hasApiKey) {
        return "The SearXNG instance doesn't allow JSON results (HTTP 403); add `json` to `search.formats` in its settings.yml.";
    }
    if (status === 403) {
        return "The SearXNG instance refused the request (HTTP 403). Either `json` is missing from `search.formats` in its settings.yml, or a proxy in front of it refused the API key set in the AI settings.";
    }
    if (status === 401) {
        return "A proxy in front of the SearXNG instance asked for credentials (HTTP 401); check the API key set for it in the AI settings.";
    }
    if (status === 429) {
        return "The SearXNG instance's limiter blocked the request (HTTP 429); turn off `server.limiter` in its settings.yml, or add Trilium's address to the limiter's `pass_ip` list.";
    }
    return undefined;
}

/** The results that carry a web URL, read from `urlField`, with the excerpt read from `snippetField`. */
function toSources(results: unknown[] | undefined, snippetField: string, urlField = "url"): WebSearchSource[] {
    const sources: WebSearchSource[] = [];
    for (const result of results ?? []) {
        const { title, [urlField]: url, [snippetField]: snippet } = (result ?? {}) as Record<string, unknown>;
        if (typeof url === "string" && /^https?:\/\//i.test(url)) {
            sources.push({
                title: typeof title === "string" ? title : url,
                url,
                snippet: typeof snippet === "string" ? snippet : ""
            });
        }
    }
    return sources;
}
