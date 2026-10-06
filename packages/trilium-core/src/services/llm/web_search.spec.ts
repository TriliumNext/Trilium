import { afterEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("./providers/fetch.js", () => ({ llmFetch: fetchMock }));

const fetchResourceMock = vi.hoisted(() => vi.fn());
vi.mock("../request.js", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../request.js")>();
    return { ...actual, default: { ...actual.default, fetchResource: fetchResourceMock } };
});

import { createReadWebPageTool, createWebSearchTool, readWebPage, searchWeb } from "./web_search.js";

function respond(body: unknown, status = 200) {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
}

/** The URL and init of the one request the search made. */
function request() {
    expect(fetchMock).toHaveBeenCalledOnce();
    const [ url, init ] = fetchMock.mock.calls[0] as [ string, RequestInit ];
    return { url, init, headers: init.headers as Record<string, string>, body: init.body ? JSON.parse(init.body as string) : undefined };
}

const PAGE = { title: "Trilium", url: "https://triliumnotes.org" };

afterEach(() => {
    fetchMock.mockReset();
    fetchResourceMock.mockReset();
});

describe("searchWeb", () => {
    it("queries Brave with its subscription token and reads its descriptions", async () => {
        respond({ web: { results: [ { ...PAGE, description: "Notes" } ] } });
        const sources = await searchWeb({ provider: "brave", apiKey: "bk" }, "trilium notes");

        const { url, headers } = request();
        expect(url).toBe("https://api.search.brave.com/res/v1/web/search?q=trilium+notes&count=8");
        expect(headers["X-Subscription-Token"]).toBe("bk");
        expect(sources).toEqual([ { ...PAGE, snippet: "Notes" } ]);
    });

    it("posts to Tavily and Exa with their keys, honoring a base URL override", async () => {
        respond({ results: [ { ...PAGE, content: "From Tavily" } ] });
        expect(await searchWeb({ provider: "tavily", apiKey: "tk", baseURL: "https://proxy.example" }, "q"))
            .toEqual([ { ...PAGE, snippet: "From Tavily" } ]);
        const tavily = request();
        expect(tavily.url).toBe("https://proxy.example/search");
        expect(tavily.init.method).toBe("POST");
        expect(tavily.headers.Authorization).toBe("Bearer tk");
        expect(tavily.body).toEqual({ query: "q", max_results: 8 });

        fetchMock.mockReset();
        respond({ results: [ { ...PAGE, text: "From Exa" } ] });
        expect(await searchWeb({ provider: "exa", apiKey: "ek" }, "q")).toEqual([ { ...PAGE, snippet: "From Exa" } ]);
        const exa = request();
        expect(exa.url).toBe("https://api.exa.ai/search");
        expect(exa.headers["x-api-key"]).toBe("ek");
        expect(exa.body).toMatchObject({ query: "q", numResults: 8 });
    });

    it("posts to Serper with its key and reads Google's organic results by their link", async () => {
        respond({
            answerBox: { title: "Ignored" },
            organic: [ { title: PAGE.title, link: PAGE.url, snippet: "From Google", position: 1 } ]
        });
        const sources = await searchWeb({ provider: "serper", apiKey: "sk" }, "q");

        const { url, init, headers, body } = request();
        expect(url).toBe("https://google.serper.dev/search");
        expect(init.method).toBe("POST");
        expect(headers["X-API-KEY"]).toBe("sk");
        expect(body).toEqual({ q: "q", num: 8 });
        expect(sources).toEqual([ { ...PAGE, snippet: "From Google" } ]);
    });

    it("posts to Perplexity's Search API with its key and reads its snippets", async () => {
        respond({ id: "r1", results: [ { ...PAGE, snippet: "From Perplexity", date: "2026-10-01" } ] });
        const sources = await searchWeb({ provider: "perplexity", apiKey: "pk" }, "q");

        const { url, init, headers, body } = request();
        expect(url).toBe("https://api.perplexity.ai/search");
        expect(init.method).toBe("POST");
        expect(headers.Authorization).toBe("Bearer pk");
        expect(body).toEqual({ query: "q", max_results: 8 });
        expect(sources).toEqual([ { ...PAGE, snippet: "From Perplexity" } ]);
    });

    it("asks SearXNG for JSON, sends a key only when there is one, and keeps web URLs only", async () => {
        respond({ results: [ { ...PAGE, content: "Hit" }, { title: "Local", url: "file:///etc/passwd" }, { url: "https://untitled.example" } ] });
        const sources = await searchWeb({ provider: "searxng", apiKey: "", baseURL: "http://localhost:8888/" }, "q");

        const { url, headers } = request();
        expect(url).toBe("http://localhost:8888/search?q=q&format=json");
        expect(headers).not.toHaveProperty("Authorization");
        expect(sources).toEqual([
            { ...PAGE, snippet: "Hit" },
            { title: "https://untitled.example", url: "https://untitled.example", snippet: "" }
        ]);

        await expect(searchWeb({ provider: "searxng", apiKey: "" }, "q")).rejects.toThrow("has no address");
    });

    it("names a refused key, any other HTTP failure, and an unknown provider type", async () => {
        respond({}, 401);
        await expect(searchWeb({ provider: "brave", apiKey: "bad" }, "q")).rejects.toThrow("check its API key");
        respond({}, 500);
        await expect(searchWeb({ provider: "brave", apiKey: "bk" }, "q")).rejects.toThrow("HTTP 500");
        await expect(searchWeb({ provider: "bing", apiKey: "" }, "q")).rejects.toThrow("Unknown search provider type: bing");
    });

    it("names the SearXNG setting or the proxy behind a refusal, and the limiter behind a 429", async () => {
        const searxng = (apiKey: string) => searchWeb({ provider: "searxng", apiKey, baseURL: "http://localhost:8888" }, "q");
        const failure = async (status: number, apiKey: string) => {
            respond({}, status);
            const error = await searxng(apiKey).catch((e: unknown) => e);
            expect(error).toBeInstanceOf(Error);
            return (error as Error).message;
        };

        const formatsOnly = await failure(403, "");
        expect(formatsOnly).toContain("search.formats");
        expect(formatsOnly).not.toContain("API key");

        const either = await failure(403, "xk");
        expect(either).toContain("search.formats");
        expect(either).toContain("API key");

        const proxyOnly = await failure(401, "");
        expect(proxyOnly).toContain("proxy");
        expect(proxyOnly).not.toContain("search.formats");

        expect(await failure(429, "")).toContain("limiter");
        expect(await failure(500, "")).toBe("The search provider answered HTTP 500.");
    });
});

describe("searchWeb overrides and sparse answers", () => {
    it("sends every provider to its base URL override, and reads a payload without results as none", async () => {
        const base = "https://proxy.example";
        const cases: [ string, string ][] = [
            [ "brave", `${base}/web/search?q=q&count=8` ],
            [ "exa", `${base}/search` ],
            [ "serper", `${base}/search` ],
            [ "perplexity", `${base}/search` ]
        ];
        for (const [ provider, expectedUrl ] of cases) {
            fetchMock.mockReset();
            respond({});
            expect(await searchWeb({ provider, apiKey: "k", baseURL: base }, "q"), provider).toEqual([]);
            expect(request().url, provider).toBe(expectedUrl);
        }
    });

    it("sends SearXNG its key when it has one, and skips a result that is not an object", async () => {
        respond({ results: [ null, { ...PAGE, content: "Hit" } ] });
        expect(await searchWeb({ provider: "searxng", apiKey: "xk", baseURL: "http://searx.lan" }, "q"))
            .toEqual([ { ...PAGE, snippet: "Hit" } ]);
        expect(request().headers.Authorization).toBe("Bearer xk");
    });

    it("names the provider by its type when it has no name, and reports a failure that is not an Error", async () => {
        const tool = createWebSearchTool({ provider: "tavily", apiKey: "tk" });
        const run = () => tool.execute?.({ query: "q" }, { toolCallId: "1", messages: [], context: {} });

        respond({ results: [] });
        expect(await run()).toMatchObject({ searchProvider: { type: "tavily", name: "tavily" } });

        fetchMock.mockRejectedValueOnce("offline");
        expect(await run()).toMatchObject({ error: "offline" });
    });
});

describe("createWebSearchTool", () => {
    const run = (tool: ReturnType<typeof createWebSearchTool>, query: string) =>
        tool.execute?.({ query }, { toolCallId: "1", messages: [], context: {} });

    it("returns the query, the provider that ran it and its sources", async () => {
        const tool = createWebSearchTool({ provider: "tavily", name: "My Tavily", apiKey: "tk" });
        expect(tool.description).toContain("read_web_page");

        respond({ results: [ { ...PAGE, content: "Hit" } ] });
        expect(await run(tool, "trilium")).toEqual({
            query: "trilium",
            searchProvider: { type: "tavily", name: "My Tavily" },
            sources: [ { ...PAGE, snippet: "Hit" } ]
        });
    });

    it("points the model at read_web_page after any failure, and has it report one only the user can fix", async () => {
        const readPage = expect.stringContaining("read_web_page");
        const userFix = expect.stringMatching(/tell the user.*read_web_page/s);
        const failure = async (setup: Parameters<typeof createWebSearchTool>[0], status?: number) => {
            if (status) {
                respond({}, status);
            }
            return await run(createWebSearchTool(setup), "q");
        };

        expect(await failure({ provider: "brave", apiKey: "bad" }, 401)).toEqual({ error: expect.any(String), instruction: userFix });
        expect(await failure({ provider: "searxng", apiKey: "", baseURL: "http://localhost:8888" }, 403))
            .toEqual({ error: expect.stringContaining("search.formats"), instruction: userFix });
        expect(await failure({ provider: "searxng", apiKey: "" }))
            .toEqual({ error: expect.stringContaining("has no address"), instruction: userFix });

        const transient = await failure({ provider: "brave", apiKey: "bk" }, 500);
        expect(transient).toEqual({ error: expect.stringContaining("HTTP 500"), instruction: readPage });
        expect(transient).not.toEqual(expect.objectContaining({ instruction: expect.stringContaining("tell the user") }));
    });

    it("cancels the search request when the turn is stopped", async () => {
        const tool = createWebSearchTool({ provider: "tavily", apiKey: "tk" });
        const controller = new AbortController();
        respond({ results: [] });
        await tool.execute?.({ query: "q" }, { toolCallId: "1", messages: [], context: {}, abortSignal: controller.signal });

        const { signal } = request().init;
        expect(signal?.aborted).toBe(false);
        controller.abort();
        expect(signal?.aborted).toBe(true);
    });
});

describe("readWebPage", () => {
    function serve(body: string, contentType = "text/html", status = 200) {
        fetchResourceMock.mockResolvedValueOnce({ status, ok: status < 400, contentType, bytes: new TextEncoder().encode(body) });
    }

    it("reads a page's main content as Markdown, headed by its title, without its furniture", async () => {
        serve(`<html><head><title>Trilium</title><script>alert(1)</script></head><body>
            <nav><a href="/">Home</a></nav>
            <main><h2>Notes</h2><p>A <a href="https://triliumnotes.org/docs">hierarchical</a> note app.</p><style>p{}</style></main>
            <footer>Copyright</footer>
        </body></html>`);
        const page = await readWebPage("https://triliumnotes.org");

        // Fetched under the policy for addresses from content, with a ceiling on the body.
        expect(fetchResourceMock).toHaveBeenCalledExactlyOnceWith("https://triliumnotes.org/", expect.objectContaining({ maxBytes: 5 * 1024 * 1024 }));
        expect(page).toBe("# Trilium\n\n## Notes\n\nA [hierarchical](https://triliumnotes.org/docs) note app.");
    });

    it("passes plain text through, and cuts a long page off with a note saying so", async () => {
        serve("  just text  ", "text/plain");
        expect(await readWebPage("https://a.example/t.txt")).toBe("just text");

        serve("x".repeat(25_000), "text/plain");
        const long = await readWebPage("https://a.example/long.txt");
        expect(long.startsWith("x".repeat(20_000) + "\n\n[The page continues")).toBe(true);
    });

    it("refuses what isn't a web page: another scheme, an error status, a binary type", async () => {
        await expect(readWebPage("file:///etc/passwd")).rejects.toThrow();
        expect(fetchResourceMock).not.toHaveBeenCalled();

        serve("Not found", "text/html", 404);
        await expect(readWebPage("https://a.example/missing")).rejects.toThrow("HTTP 404");
        serve("%PDF", "application/pdf");
        await expect(readWebPage("https://a.example/doc.pdf")).rejects.toThrow("application/pdf");
    });

    it("refuses a local or private-network host before fetching, on every runtime", async () => {
        const local = [
            "http://localhost:8080/", "http://app.localhost/", "http://router/", "http://nas.local/",
            "http://box.lan/", "http://db.internal/", "http://printer.home.arpa/", "http://localhost./",
            "http://127.0.0.1/", "http://2130706433/", "http://0.0.0.0/", "http://10.1.2.3/",
            "http://172.16.0.1/", "http://172.31.255.255/", "http://192.168.1.1/", "http://169.254.169.254/",
            "http://100.64.0.1/", "http://[::1]/", "http://[::]/", "http://[fd00::1]/", "http://[fe80::1]/",
            "http://[::ffff:127.0.0.1]/", "http://[::ffff:192.168.0.1]/"
        ];
        for (const url of local) {
            await expect(readWebPage(url), url).rejects.toThrow("private/internal networks");
        }
        expect(fetchResourceMock).not.toHaveBeenCalled();

        for (const url of [ "http://172.32.0.1/", "http://100.128.0.1/", "http://8.8.8.8/", "http://[2606:4700::1111]/", "http://[fc::1]/", "https://example.com/" ]) {
            serve("ok", "text/plain");
            expect(await readWebPage(url), url).toBe("ok");
        }
    });

    it("reads a page without a title or a main element, or without a content type, as HTML", async () => {
        serve("<html><body><p>Only <b>body</b></p></body></html>");
        expect(await readWebPage("https://a.example/")).toBe("Only **body**");

        serve("<p>A fragment</p>", "");
        expect(await readWebPage("https://a.example/fragment")).toBe("A fragment");
    });

    it("hands the model a refused address as an error to report", async () => {
        fetchResourceMock.mockRejectedValueOnce(new Error("URLs pointing to private/internal networks are not allowed"));
        const tool = createReadWebPageTool();
        expect(await tool.execute?.({ url: "http://169.254.169.254/" }, { toolCallId: "1", messages: [], context: {} }))
            .toEqual({ error: "URLs pointing to private/internal networks are not allowed" });
    });
});
