import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installIosInterceptors, setupFetchInterceptor, setupImageInterceptor, setupStylesheetInterceptor, setupXhrInterceptor } from "./ios-interceptors.js";

const mocks = vi.hoisted(() => ({
    localFetch: vi.fn(),
    isLocalApiRequest: vi.fn()
}));

vi.mock("./local-bridge.js", () => ({
    localFetch: (req: Request) => mocks.localFetch(req),
    isLocalApiRequest: (url: URL) => mocks.isLocalApiRequest(url)
}));

/** Same-origin URL against the happy-dom base (http://localhost:3000 by default). */
function localUrl(path: string) {
    return new URL(path, location.href).href;
}

function makeResponse(body: BodyInit | null, init: ResponseInit = {}) {
    return new Response(body, { status: 200, statusText: "OK", ...init });
}

const originalFetch = window.fetch;
const OriginalXHR = window.XMLHttpRequest;

// setupImageInterceptor installs a permanent MutationObserver on
// document.documentElement. Across tests those observers would pile up and each
// react to the same DOM mutations, so capture every observer and disconnect it
// after the test that created it.
let observers: MutationObserver[] = [];
let RealMutationObserver: typeof MutationObserver;

beforeEach(() => {
    mocks.localFetch.mockReset();
    mocks.isLocalApiRequest.mockReset();
    // By default, treat anything under /api/ as a local API request.
    mocks.isLocalApiRequest.mockImplementation((url: URL) => url.pathname.startsWith("/api/"));
    mocks.localFetch.mockResolvedValue(makeResponse("{}"));
    document.body.innerHTML = "";
    vi.spyOn(console, "warn").mockImplementation(() => {});

    observers = [];
    RealMutationObserver = window.MutationObserver;
    window.MutationObserver = class extends RealMutationObserver {
        constructor(callback: MutationCallback) {
            super(callback);
            observers.push(this);
        }
    };
});

afterEach(() => {
    observers.forEach((o) => o.disconnect());
    window.MutationObserver = RealMutationObserver;
    window.fetch = originalFetch;
    window.XMLHttpRequest = OriginalXHR;
    vi.restoreAllMocks();
});

describe("installIosInterceptors", () => {
    it("installs the fetch, XHR, and image interceptors together", () => {
        const original = window.fetch;
        installIosInterceptors();
        // fetch was replaced
        expect(window.fetch).not.toBe(original);
        // XHR was replaced with a subclass
        expect(window.XMLHttpRequest).not.toBe(OriginalXHR);
    });
});

describe("setupFetchInterceptor", () => {
    let passthrough: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        passthrough = vi.fn().mockResolvedValue(makeResponse("passthrough"));
        window.fetch = passthrough as unknown as typeof window.fetch;
        setupFetchInterceptor();
    });

    it("routes a local API string URL through localFetch", async () => {
        const resp = makeResponse("local");
        mocks.localFetch.mockResolvedValue(resp);
        const result = await window.fetch("/api/notes");
        expect(result).toBe(resp);
        expect(passthrough).not.toHaveBeenCalled();
        const [req] = mocks.localFetch.mock.calls[0];
        expect(req).toBeInstanceOf(Request);
        expect(req.url).toBe(localUrl("/api/notes"));
    });

    it("routes a URL object input through localFetch", async () => {
        await window.fetch(new URL(localUrl("/api/tree")));
        expect(mocks.localFetch).toHaveBeenCalledOnce();
        expect(passthrough).not.toHaveBeenCalled();
    });

    it("routes a Request object input through localFetch", async () => {
        await window.fetch(new Request(localUrl("/api/search")));
        expect(mocks.localFetch).toHaveBeenCalledOnce();
    });

    it("passes a same-origin non-API request straight to the original fetch", async () => {
        const result = await window.fetch("/not-api/page");
        expect(mocks.localFetch).not.toHaveBeenCalled();
        expect(passthrough).toHaveBeenCalledOnce();
        expect(await result.text()).toBe("passthrough");
    });

    it("passes a cross-origin request straight to the original fetch", async () => {
        await window.fetch("https://example.com/api/notes");
        expect(mocks.localFetch).not.toHaveBeenCalled();
        expect(passthrough).toHaveBeenCalledOnce();
    });
});

describe("setupImageInterceptor", () => {
    /** Wait until the image's src has been rewritten to a blob: URL. */
    async function waitForBlobSrc(img: HTMLImageElement) {
        await vi.waitFor(() => expect(img.getAttribute("src")).toMatch(/^blob:/));
    }

    beforeEach(() => {
        // Deterministic blob URL so assertions don't depend on the environment.
        vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fake-url");
    });

    it("swaps an <img> already in the document pointing at a local API path", async () => {
        mocks.localFetch.mockResolvedValue(makeResponse("img-bytes"));
        const img = document.createElement("img");
        img.setAttribute("src", "/api/images/1");
        document.body.appendChild(img);

        setupImageInterceptor();

        await waitForBlobSrc(img);
        expect(mocks.localFetch).toHaveBeenCalledOnce();
    });

    it("swaps an <img> appended after setup (childList observer)", async () => {
        setupImageInterceptor();
        const img = document.createElement("img");
        img.setAttribute("src", "/api/images/2");
        document.body.appendChild(img);
        await waitForBlobSrc(img);
    });

    it("swaps <img> nested inside an appended container (querySelectorAll path)", async () => {
        setupImageInterceptor();
        const container = document.createElement("div");
        const img = document.createElement("img");
        img.setAttribute("src", "/api/images/3");
        container.appendChild(img);
        document.body.appendChild(container);
        await waitForBlobSrc(img);
    });

    it("swaps when the src attribute of an existing image changes to a local API path", async () => {
        const img = document.createElement("img");
        img.setAttribute("src", "https://example.com/remote.png");
        document.body.appendChild(img);
        setupImageInterceptor();

        img.setAttribute("src", "/api/images/4");
        await waitForBlobSrc(img);
    });

    it("ignores blob:, data:, empty, and non-API sources", async () => {
        for (const src of ["", "data:image/png;base64,AAAA", "blob:existing", "/other/x.png"]) {
            const img = document.createElement("img");
            if (src) img.setAttribute("src", src);
            document.body.appendChild(img);
        }
        setupImageInterceptor();
        // Give the async swap a chance to (not) run.
        await new Promise((r) => setTimeout(r, 20));
        expect(mocks.localFetch).not.toHaveBeenCalled();
    });

    it("treats an unparseable src as non-matching without throwing", async () => {
        const img = document.createElement("img");
        img.setAttribute("src", "https://exa mple.com/api/x");
        document.body.appendChild(img);
        setupImageInterceptor();
        await new Promise((r) => setTimeout(r, 20));
        expect(mocks.localFetch).not.toHaveBeenCalled();
    });

    it("leaves the src untouched and allows a retry when the fetch is not ok", async () => {
        mocks.localFetch.mockResolvedValue(makeResponse("nope", { status: 404, statusText: "Not Found" }));
        const img = document.createElement("img");
        img.setAttribute("src", "/api/images/5");
        document.body.appendChild(img);
        setupImageInterceptor();

        await vi.waitFor(() => expect(mocks.localFetch).toHaveBeenCalledOnce());
        expect(img.getAttribute("src")).toBe("/api/images/5");

        // Because the dedup entry was cleared, the same src can be retried. Bounce
        // through a non-API src so the attribute genuinely changes value (happy-dom
        // only fires a mutation on a real change) before returning to the API path.
        mocks.localFetch.mockResolvedValue(makeResponse("ok-now"));
        img.setAttribute("src", "/not-api/placeholder.png");
        img.setAttribute("src", "/api/images/5");
        await vi.waitFor(() => expect(mocks.localFetch).toHaveBeenCalledTimes(2));
    });

    it("logs a warning and clears dedup when the fetch throws", async () => {
        mocks.localFetch.mockRejectedValue(new Error("boom"));
        const img = document.createElement("img");
        img.setAttribute("src", "/api/images/6");
        document.body.appendChild(img);
        setupImageInterceptor();

        await vi.waitFor(() => expect(console.warn).toHaveBeenCalled());
        expect(img.getAttribute("src")).toBe("/api/images/6");
    });

    it("does not re-fetch when the same src is processed twice (dedup)", async () => {
        mocks.localFetch.mockResolvedValue(makeResponse("bytes"));
        const img = document.createElement("img");
        img.setAttribute("src", "/api/images/7");
        document.body.appendChild(img);
        setupImageInterceptor();

        // First pass swaps to the (mocked) blob URL.
        await waitForBlobSrc(img);
        expect(mocks.localFetch).toHaveBeenCalledOnce();

        // Point the same element back at the already-processed API path. The
        // attribute genuinely changes (blob: → /api/…), so the observer fires,
        // but the dedup WeakMap short-circuits before a second fetch.
        img.setAttribute("src", "/api/images/7");
        await new Promise((r) => setTimeout(r, 20));
        expect(mocks.localFetch).toHaveBeenCalledOnce();
    });

    it("revokes the previous blob URL when an image is repointed to another API image", async () => {
        let counter = 0;
        vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:url-${++counter}`);
        const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
        // Fresh Response per call — a body can only be read once, and this image
        // is swapped twice.
        mocks.localFetch.mockImplementation(async () => makeResponse("bytes"));

        const img = document.createElement("img");
        img.setAttribute("src", "/api/images/1");
        document.body.appendChild(img);
        setupImageInterceptor();
        await vi.waitFor(() => expect(img.getAttribute("src")).toBe("blob:url-1"));

        // Repoint the same element at a different API image; the first blob URL is
        // now orphaned and must be revoked, otherwise it leaks for the page's life.
        img.setAttribute("src", "/api/images/2");
        await vi.waitFor(() => expect(img.getAttribute("src")).toBe("blob:url-2"));

        expect(revoke).toHaveBeenCalledWith("blob:url-1");
    });

    it("revokes the blob URL when an intercepted image is removed from the DOM", async () => {
        vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:removed-url");
        const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
        mocks.localFetch.mockResolvedValue(makeResponse("bytes"));

        const img = document.createElement("img");
        img.setAttribute("src", "/api/images/1");
        document.body.appendChild(img);
        setupImageInterceptor();
        await vi.waitFor(() => expect(img.getAttribute("src")).toBe("blob:removed-url"));

        // Navigating away removes the <img>; its blob URL must be revoked or it
        // leaks — the dominant "every note you open adds memory" case.
        img.remove();
        await vi.waitFor(() => expect(revoke).toHaveBeenCalledWith("blob:removed-url"));
    });

    it("revokes blob URLs of images inside a removed container subtree", async () => {
        vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:subtree-url");
        const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
        mocks.localFetch.mockResolvedValue(makeResponse("bytes"));

        const container = document.createElement("div");
        const img = document.createElement("img");
        img.setAttribute("src", "/api/images/1");
        container.appendChild(img);
        document.body.appendChild(container);
        setupImageInterceptor();
        await vi.waitFor(() => expect(img.getAttribute("src")).toBe("blob:subtree-url"));

        // Removing the wrapper detaches the nested <img> too; its URL must be freed.
        container.remove();
        await vi.waitFor(() => expect(revoke).toHaveBeenCalledWith("blob:subtree-url"));
    });

    it("ignores removed non-element nodes", async () => {
        const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
        const text = document.createTextNode("text");
        document.body.appendChild(text);
        setupImageInterceptor();

        text.remove(); // removedNodes contains a text node — neither <img> nor Element
        await new Promise((r) => setTimeout(r, 20));
        expect(revoke).not.toHaveBeenCalled();
    });

    it("ignores src mutations on non-image elements", async () => {
        const span = document.createElement("span");
        span.setAttribute("src", "/api/images/a");
        document.body.appendChild(span);
        setupImageInterceptor();

        span.setAttribute("src", "/api/images/b"); // attributes record whose target is not an <img>
        await new Promise((r) => setTimeout(r, 20));
        expect(mocks.localFetch).not.toHaveBeenCalled();
    });

    it("ignores appended non-element nodes", async () => {
        setupImageInterceptor();
        document.body.appendChild(document.createComment("comment"));
        document.body.appendChild(document.createTextNode("text"));
        await new Promise((r) => setTimeout(r, 20));
        expect(mocks.localFetch).not.toHaveBeenCalled();
    });

    it("defers observation until DOMContentLoaded when documentElement is not ready", async () => {
        const realDocEl = document.documentElement;
        let docEl: HTMLElement | null = null;
        Object.defineProperty(document, "documentElement", { configurable: true, get: () => docEl });

        setupImageInterceptor(); // documentElement null → registers a DOMContentLoaded listener

        docEl = realDocEl; // restore before the deferred start() observes it
        const img = document.createElement("img");
        img.setAttribute("src", "/api/images/8");
        document.body.appendChild(img);
        document.dispatchEvent(new Event("DOMContentLoaded"));

        await vi.waitFor(() => expect(mocks.localFetch).toHaveBeenCalledOnce());
        Object.defineProperty(document, "documentElement", { configurable: true, value: realDocEl });
    });
});

describe("setupStylesheetInterceptor", () => {
    function addStyle(css: string) {
        const styleEl = document.createElement("style");
        styleEl.textContent = css;
        document.body.appendChild(styleEl);
        return styleEl;
    }

    it("rewrites local API url() refs in an existing <style> to blob URLs, fetching each unique URL once", async () => {
        let counter = 0;
        vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:font-${++counter}`);
        mocks.localFetch.mockImplementation(async () => makeResponse("font-bytes"));

        // Same URL referenced with two quoting styles + a second URL unquoted; the
        // bundled relative ref and the data: URI must stay untouched.
        const styleEl = addStyle(`
            @font-face { src: url('api/attachments/download/f1') format('woff2'); }
            .a { background: url("api/attachments/download/f1"); }
            .b { background: url(api/attachments/download/f2); }
            .c { background: url('./fonts/bundled.woff2'); }
            .d { background: url(data:font/woff2;base64,AAAA); }
        `);
        setupStylesheetInterceptor();

        await vi.waitFor(() => expect(styleEl.textContent).toContain("blob:"));
        const css = styleEl.textContent ?? "";
        expect(css).not.toContain("api/attachments/download");
        // Both f1 refs collapse to the same blob URL; f2 gets its own.
        expect(css.match(/blob:font-1/g)).toHaveLength(2);
        expect(css).toContain("blob:font-2");
        expect(css).toContain("./fonts/bundled.woff2");
        expect(css).toContain("data:font/woff2;base64,AAAA");
        expect(mocks.localFetch).toHaveBeenCalledTimes(2);
        const fetchedUrls = mocks.localFetch.mock.calls.map(([req]) => (req as Request).url);
        expect(fetchedUrls).toEqual([
            localUrl("/api/attachments/download/f1"),
            localUrl("/api/attachments/download/f2")
        ]);
    });

    it("rewrites a <style> appended after setup without reprocessing its own rewrite", async () => {
        vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:font-url");
        mocks.localFetch.mockImplementation(async () => makeResponse("font-bytes"));
        setupStylesheetInterceptor();

        const styleEl = addStyle(".x { src: url('api/attachments/download/f1'); }");
        await vi.waitFor(() => expect(styleEl.textContent).toContain("blob:font-url"));

        // The rewrite itself mutates the style; the second pass must find nothing to do.
        await new Promise((r) => setTimeout(r, 20));
        expect(mocks.localFetch).toHaveBeenCalledOnce();
    });

    it("rewrites when a style's text is replaced later and shares the asset cache across styles", async () => {
        vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:shared-font");
        mocks.localFetch.mockImplementation(async () => makeResponse("font-bytes"));
        const plain = addStyle(".plain { color: red; }");
        setupStylesheetInterceptor();

        plain.textContent = ".x { src: url('api/attachments/download/f1'); }";
        await vi.waitFor(() => expect(plain.textContent).toContain("blob:shared-font"));

        // A second stylesheet referencing the same asset reuses the cached blob URL.
        const second = addStyle(".y { src: url('api/attachments/download/f1'); }");
        await vi.waitFor(() => expect(second.textContent).toContain("blob:shared-font"));
        expect(mocks.localFetch).toHaveBeenCalledOnce();
    });

    it("leaves the style unchanged when the asset fetch fails, then allows a retry", async () => {
        mocks.localFetch.mockRejectedValue(new Error("worker down"));
        const css = ".x { src: url('api/attachments/download/f1'); }";
        const styleEl = addStyle(css);
        setupStylesheetInterceptor();

        await vi.waitFor(() => expect(console.warn).toHaveBeenCalled());
        expect(styleEl.textContent).toBe(css);

        // The failure is dropped from the cache, so the next stylesheet retries the fetch.
        vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:retried");
        mocks.localFetch.mockImplementation(async () => makeResponse("font-bytes"));
        const second = addStyle(css);
        await vi.waitFor(() => expect(second.textContent).toContain("blob:retried"));
    });

    it("swaps a local API stylesheet <link> to a blob URL and rewrites the fetched CSS", async () => {
        const themeCss = `
            @font-face { src: url('api/attachments/download/themefont'); }
            .bg { background: url(../../../fonts/asset.png); }
        `;
        mocks.localFetch.mockImplementation(async (req: Request) =>
            makeResponse(req.url.includes("notes/download") ? themeCss : "font-bytes"));
        const cssBlobs: Blob[] = [];
        vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
            if ((blob as Blob).type === "text/css") {
                cssBlobs.push(blob as Blob);
                return `blob:css-${cssBlobs.length}`;
            }
            return "blob:theme-font";
        });
        setupStylesheetInterceptor();

        const link = document.createElement("link");
        link.setAttribute("rel", "stylesheet");
        link.setAttribute("href", "api/notes/download/theme1");
        document.body.appendChild(link);

        await vi.waitFor(() => expect(link.getAttribute("href")).toBe("blob:css-1"));
        const rewritten = await cssBlobs[0].text();
        // The api font ref becomes a blob URL; the bundled relative ref is absolutized
        // (relative paths would otherwise resolve against the blob: origin and break).
        expect(rewritten).toContain('url("blob:theme-font")');
        expect(rewritten).toContain(`url("${localUrl("/fonts/asset.png")}")`);
    });

    it("ignores non-stylesheet links, cross-origin stylesheets, and styles without url() refs", async () => {
        setupStylesheetInterceptor();

        const icon = document.createElement("link");
        icon.setAttribute("rel", "icon");
        icon.setAttribute("href", "api/notes/download/x");
        document.body.appendChild(icon);

        const remote = document.createElement("link");
        remote.setAttribute("rel", "stylesheet");
        remote.setAttribute("href", "https://example.com/api/theme.css");
        document.body.appendChild(remote);

        addStyle(".plain { color: red; }");

        await new Promise((r) => setTimeout(r, 20));
        expect(mocks.localFetch).not.toHaveBeenCalled();
    });

    it("revokes the CSS blob when the link is repointed or removed", async () => {
        let counter = 0;
        vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:css-${++counter}`);
        const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
        mocks.localFetch.mockImplementation(async () => makeResponse(".theme {}"));
        setupStylesheetInterceptor();

        const link = document.createElement("link");
        link.setAttribute("rel", "stylesheet");
        link.setAttribute("href", "api/notes/download/theme1");
        document.body.appendChild(link);
        await vi.waitFor(() => expect(link.getAttribute("href")).toBe("blob:css-1"));

        // Repointing at another theme replaces the blob and frees the old one.
        link.setAttribute("href", "api/notes/download/theme2");
        await vi.waitFor(() => expect(link.getAttribute("href")).toBe("blob:css-2"));
        expect(revoke).toHaveBeenCalledWith("blob:css-1");

        // Removing the link frees the current one.
        link.remove();
        await vi.waitFor(() => expect(revoke).toHaveBeenCalledWith("blob:css-2"));
    });
});

describe("setupXhrInterceptor", () => {
    function openXhr(method: string, url: string) {
        setupXhrInterceptor();
        const xhr = new window.XMLHttpRequest();
        xhr.open(method, url);
        return xhr;
    }

    /** Resolve once the intercepted request finishes (load or error). */
    function done(xhr: XMLHttpRequest) {
        return new Promise<void>((resolve) => xhr.addEventListener("loadend", () => resolve()));
    }

    it("routes an intercepted GET through localFetch and exposes the response", async () => {
        mocks.localFetch.mockResolvedValue(makeResponse("hello", { headers: { "content-type": "text/plain", "x-foo": "bar" } }));
        const xhr = openXhr("GET", "/api/notes");
        const finished = done(xhr);
        xhr.send();
        await finished;

        expect(xhr.readyState).toBe(4);
        expect(xhr.status).toBe(200);
        expect(xhr.statusText).toBe("OK");
        expect(xhr.responseText).toBe("hello");
        expect(xhr.response).toBe("hello");
        expect(xhr.responseURL).toBe(localUrl("/api/notes"));
        expect(xhr.getResponseHeader("x-foo")).toBe("bar");
        expect(xhr.getAllResponseHeaders()).toContain("x-foo: bar");
    });

    it("accepts a URL object as the open() target", async () => {
        mocks.localFetch.mockResolvedValue(makeResponse("ok"));
        setupXhrInterceptor();
        const xhr = new window.XMLHttpRequest();
        xhr.open("GET", new URL(localUrl("/api/thing")));
        const finished = done(xhr);
        xhr.send();
        await finished;
        expect(xhr.responseURL).toBe(localUrl("/api/thing"));
    });

    it("parses a JSON responseType", async () => {
        mocks.localFetch.mockResolvedValue(makeResponse(JSON.stringify({ ok: true })));
        const xhr = openXhr("GET", "/api/tree");
        xhr.responseType = "json";
        const finished = done(xhr);
        xhr.send();
        await finished;
        expect(xhr.response).toEqual({ ok: true });
    });

    it("yields null for an invalid JSON responseType body", async () => {
        mocks.localFetch.mockResolvedValue(makeResponse("not json"));
        const xhr = openXhr("GET", "/api/tree");
        xhr.responseType = "json";
        const finished = done(xhr);
        xhr.send();
        await finished;
        expect(xhr.response).toBeNull();
    });

    it("returns an ArrayBuffer for the arraybuffer responseType", async () => {
        mocks.localFetch.mockResolvedValue(makeResponse("abc"));
        const xhr = openXhr("GET", "/api/blob");
        xhr.responseType = "arraybuffer";
        const finished = done(xhr);
        xhr.send();
        await finished;
        expect(xhr.response).toBeInstanceOf(ArrayBuffer);
        expect(new TextDecoder().decode(xhr.response as ArrayBuffer)).toBe("abc");
    });

    it("returns a typed Blob for the blob responseType", async () => {
        mocks.localFetch.mockResolvedValue(makeResponse("xyz", { headers: { "content-type": "image/png" } }));
        const xhr = openXhr("GET", "/api/image");
        xhr.responseType = "blob";
        const finished = done(xhr);
        xhr.send();
        await finished;
        expect(xhr.response).toBeInstanceOf(Blob);
        expect((xhr.response as Blob).type).toBe("image/png");
    });

    it("defaults the Blob type to empty when no content-type is present", async () => {
        // A null body carries no content-type header (a string body would make
        // happy-dom synthesize "text/plain"), exercising the `?? ""` fallback.
        mocks.localFetch.mockResolvedValue(makeResponse(null));
        const xhr = openXhr("GET", "/api/image");
        xhr.responseType = "blob";
        const finished = done(xhr);
        xhr.send();
        await finished;
        expect((xhr.response as Blob).type).toBe("");
    });

    it("throws when responseText is read for a non-text responseType", async () => {
        mocks.localFetch.mockResolvedValue(makeResponse("{}"));
        const xhr = openXhr("GET", "/api/tree");
        xhr.responseType = "json";
        const finished = done(xhr);
        xhr.send();
        await finished;
        expect(() => xhr.responseText).toThrow(/responseText is only available/);
    });

    it("forwards a request body for a POST and reads the intercept responseType", async () => {
        mocks.localFetch.mockResolvedValue(makeResponse("created", { status: 201, statusText: "Created" }));
        const xhr = openXhr("POST", "/api/notes");
        xhr.setRequestHeader("content-type", "application/json");
        expect(xhr.responseType).toBe(""); // intercept getter returns the stored value
        const finished = done(xhr);
        xhr.send(JSON.stringify({ title: "n" }));
        await finished;

        expect(xhr.status).toBe(201);
        const [req] = mocks.localFetch.mock.calls[0];
        expect(req.method).toBe("POST");
        expect(await req.text()).toBe(JSON.stringify({ title: "n" }));
        expect(req.headers.get("content-type")).toBe("application/json");
    });

    it("dispatches an error when the local fetch fails", async () => {
        mocks.localFetch.mockRejectedValue(new Error("worker down"));
        const xhr = openXhr("GET", "/api/notes");
        const onError = vi.fn();
        xhr.addEventListener("error", onError);
        const finished = done(xhr);
        xhr.send();
        await finished;

        expect(xhr.status).toBe(0);
        expect(xhr.readyState).toBe(4);
        expect(onError).toHaveBeenCalledOnce();
    });

    it("does not intercept a non-local request and delegates to the native XHR", () => {
        mocks.isLocalApiRequest.mockReturnValue(false);
        const openSpy = vi.spyOn(OriginalXHR.prototype, "open").mockImplementation(() => {});
        const headerSpy = vi.spyOn(OriginalXHR.prototype, "setRequestHeader").mockImplementation(() => {});
        const sendSpy = vi.spyOn(OriginalXHR.prototype, "send").mockImplementation(() => {});

        setupXhrInterceptor();
        const xhr = new window.XMLHttpRequest();
        xhr.open("GET", "https://example.com/api/notes");
        xhr.setRequestHeader("x-a", "b");
        xhr.send();

        expect(openSpy).toHaveBeenCalledOnce();
        expect(headerSpy).toHaveBeenCalledWith("x-a", "b");
        expect(sendSpy).toHaveBeenCalledOnce();
        expect(mocks.localFetch).not.toHaveBeenCalled();
    });

    it("delegates responseType get/set to the native XHR when not intercepting", () => {
        mocks.isLocalApiRequest.mockReturnValue(false);
        vi.spyOn(OriginalXHR.prototype, "open").mockImplementation(() => {});
        const setSpy = vi.fn();
        const getSpy = vi.fn().mockReturnValue("text");
        Object.defineProperty(OriginalXHR.prototype, "responseType", {
            configurable: true,
            get: getSpy,
            set: setSpy
        });

        setupXhrInterceptor();
        const xhr = new window.XMLHttpRequest();
        xhr.open("GET", "https://example.com/x");
        xhr.responseType = "text";
        expect(setSpy).toHaveBeenCalledWith("text");
        expect(xhr.responseType).toBe("text");
        expect(getSpy).toHaveBeenCalled();
    });
});
