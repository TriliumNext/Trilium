import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Toggleable flag backing the `isShare` named export of ./utils.js.
let isShareValue = false;

// Partially mock utils so we keep the real helpers but can flip `isShare` per test.
vi.mock("./utils.js", async (orig) => {
    const actual = (await orig()) as any;
    return {
        ...actual,
        default: {
            ...actual.default,
            localNowDateTime: () => "2026-05-29 12:00:00.000+0000"
        },
        get isShare() {
            return isShareValue;
        }
    };
});

// Keep i18n predictable (the test env never initialises i18next).
vi.mock("./i18n.js", () => ({
    t: (key: string, opts?: Record<string, unknown>) => (opts ? `${key}:${JSON.stringify(opts)}` : key)
}));

// Avoid pulling in app_context (toast → app_context → options → server) on the
// dynamic import inside reportError.
const toastMock = {
    showError: vi.fn(),
    showPersistent: vi.fn(),
    showErrorTitleAndMessage: vi.fn()
};
vi.mock("./toast.js", () => ({ default: toastMock }));

// The target file (server.ts) is GLOBALLY mocked by test/setup.ts. Import the
// REAL implementation so we exercise actual code rather than the canned stub.
const serverModule = (await vi.importActual("./server.js")) as {
    default: typeof import("./server.js").default;
};
const server = serverModule.default;

type AjaxOptions = JQueryAjaxSettings & {
    success: (body: unknown, textStatus: string, jqXhr: any) => void;
    error: (jqXhr: any) => void | Promise<void>;
};

function fakeJqXhr(headerLines: string) {
    return {
        getAllResponseHeaders: () => headerLines
    };
}

beforeEach(() => {
    isShareValue = false;
    vi.clearAllMocks();
    (window as any).glob = {
        isMainWindow: true,
        componentId: "comp-glob",
        csrfToken: "csrf-1",
        baseApiUrl: "/api/",
        appContext: undefined
    };
    (window as any).logError = vi.fn();
});

describe("getHeaders", () => {
    it("returns the full header set with active note context", async () => {
        (window as any).glob.appContext = {
            tabManager: { getActiveContext: () => ({ hoistedNoteId: "hoisted-1" }) }
        };
        const headers = await server.getHeaders({ "x-extra": "value", "x-empty": "" });
        expect(headers).toMatchObject({
            "trilium-component-id": "comp-glob",
            "trilium-local-now-datetime": "2026-05-29 12:00:00.000+0000",
            "trilium-hoisted-note-id": "hoisted-1",
            "x-csrf-token": "csrf-1",
            "x-extra": "value"
        });
        // falsy custom header values are skipped
        expect(headers).not.toHaveProperty("x-empty");
    });

    it("uses null hoisted note id when there is no active context", async () => {
        (window as any).glob.appContext = { tabManager: { getActiveContext: () => null } };
        const headers = await server.getHeaders();
        expect(headers["trilium-hoisted-note-id"]).toBeNull();
    });

    it("uses null hoisted note id when tabManager is absent", async () => {
        (window as any).glob.appContext = {};
        const headers = await server.getHeaders();
        expect(headers["trilium-hoisted-note-id"]).toBeNull();
    });

    it("returns an empty object in share mode", async () => {
        isShareValue = true;
        const headers = await server.getHeaders({ "x-extra": "value" });
        expect(headers).toEqual({});
    });
});

describe("call / ajax success paths", () => {
    it("parses response headers and tracks the max entity change id (GET)", async () => {
        const ajaxSpy = vi.fn((opts: AjaxOptions) => {
            opts.success(
                { ok: true },
                "success",
                fakeJqXhr("trilium-max-entity-change-id: 42\r\nContent-Type: application/json: charset=utf-8\r\nBad-Line-Without-Colon")
            );
        });
        (window as any).$.ajax = ajaxSpy;

        const result = await server.get<{ ok: boolean }>("some/url", "comp-x");
        expect(result).toEqual({ ok: true });
        expect(ajaxSpy.mock.calls[0][0].url).toBe("/api/some/url");
        expect(ajaxSpy.mock.calls[0][0].type).toBe("GET");
        expect(server.getMaxKnownEntityChangeId()).toBeGreaterThanOrEqual(42);
    });

    it("does not advance the max entity change id for a blank header", async () => {
        const before = server.getMaxKnownEntityChangeId();
        (window as any).$.ajax = (opts: AjaxOptions) => {
            opts.success({}, "success", fakeJqXhr("trilium-max-entity-change-id:   "));
        };
        await server.get("blank/header");
        expect(server.getMaxKnownEntityChangeId()).toBe(before);
    });

    it("sets dataType=text for raw GET and serialises POST data with content type", async () => {
        let rawOpts: AjaxOptions | undefined;
        let postOpts: AjaxOptions | undefined;

        (window as any).$.ajax = (opts: AjaxOptions) => {
            if (opts.type === "GET") {
                rawOpts = opts;
            } else {
                postOpts = opts;
            }
            opts.success("body", "success", fakeJqXhr(""));
        };

        await server.get("raw/url", undefined, true);
        await server.post("post/url", { a: 1 });

        expect(rawOpts?.dataType).toBe("text");
        expect(postOpts?.data).toBe(JSON.stringify({ a: 1 }));
        expect(postOpts?.contentType).toBe("application/json");
    });

    it("logs and skips data when it cannot be stringified", async () => {
        const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        const circular: any = {};
        circular.self = circular; // JSON.stringify throws on circular refs

        let captured: AjaxOptions | undefined;
        (window as any).$.ajax = (opts: AjaxOptions) => {
            captured = opts;
            opts.success({}, "success", fakeJqXhr(""));
        };

        await server.post("post/url", circular);
        expect(captured?.data).toBeUndefined();
        expect(captured?.contentType).toBe("application/json");
        expect(logSpy).toHaveBeenCalled();
        logSpy.mockRestore();
    });

    it("supports put, patch and remove verbs", async () => {
        const seen: string[] = [];
        (window as any).$.ajax = (opts: AjaxOptions) => {
            seen.push(opts.type as string);
            opts.success({}, "success", fakeJqXhr(""));
        };

        await server.put("put/url", { x: 1 });
        await server.patch("patch/url", { x: 1 });
        await server.remove("del/url");

        expect(seen).toEqual(["PUT", "PATCH", "DELETE"]);
    });
});

describe("ajax error handling", () => {
    it("rejects browser-cancelled requests (status 0) without reporting", async () => {
        (window as any).$.ajax = (opts: AjaxOptions) => {
            opts.error({ status: 0, responseText: "" });
        };
        await expect(server.get("url")).rejects.toBe("rejected by browser");
        expect(toastMock.showError).not.toHaveBeenCalled();
    });

    it("stays silent on 404 when silentNotFound is set", async () => {
        (window as any).$.ajax = (opts: AjaxOptions) => {
            opts.error({ status: 404, responseText: "{}" });
        };
        await expect(server.getWithSilentNotFound("url")).rejects.toBeDefined();
        expect(toastMock.showError).not.toHaveBeenCalled();
        expect((window as any).logError).not.toHaveBeenCalled();
    });

    it("stays silent on 500 when silentInternalServerError is set", async () => {
        (window as any).$.ajax = (opts: AjaxOptions) => {
            opts.error({ status: 500, responseText: "boom" });
        };
        await expect(server.postWithSilentInternalServerError("url", {})).rejects.toBeDefined();
        expect((window as any).logError).not.toHaveBeenCalled();
    });

    it("stays silent on 401 when silentUnauthorized is set, still rejecting with the body", async () => {
        (window as any).$.ajax = (opts: AjaxOptions) => {
            opts.error({ status: 401, responseText: "The OneNote connection was lost." });
        };
        // The caller presents the failure itself, so it must still receive the server's reason.
        await expect(server.getWithSilentUnauthorized("url")).rejects.toBe("The OneNote connection was lost.");
        expect(toastMock.showError).not.toHaveBeenCalled();
        expect((window as any).logError).not.toHaveBeenCalled();
    });

    it("reports validation errors (400) and still rejects when reportError throws", async () => {
        (window as any).$.ajax = (opts: AjaxOptions) => {
            opts.error({ status: 400, responseText: JSON.stringify({ message: "Bad input" }) });
        };
        // The ValidationError thrown inside reportError is swallowed by the catch in ajax();
        // the request must still reject with the raw responseText, NOT the ValidationError instance.
        await expect(server.post("url", {})).rejects.toBe(JSON.stringify({ message: "Bad input" }));
        expect(toastMock.showError).toHaveBeenCalledWith("Bad input");
    });

    it("shows a reverse-proxy-blocked toast for encoded-character 400s", async () => {
        (window as any).$.ajax = (opts: AjaxOptions) => {
            // string response (not an object) -> falls through to the else branch
            opts.error({ status: 400, responseText: "plain error" });
        };
        await expect(server.get("notes/foo%23bar")).rejects.toBeDefined();
        expect(toastMock.showPersistent).toHaveBeenCalledWith(
            expect.objectContaining({ id: "reverse-proxy-blocked" })
        );
        expect((window as any).logError).toHaveBeenCalled();
    });

    it("shows a reverse-proxy-blocked toast for %2F-encoded 400s", async () => {
        (window as any).$.ajax = (opts: AjaxOptions) => {
            opts.error({ status: 400, responseText: "plain error" });
        };
        await expect(server.get("notes/foo%2Fbar")).rejects.toBeDefined();
        expect(toastMock.showPersistent).toHaveBeenCalledWith(
            expect.objectContaining({ id: "reverse-proxy-blocked" })
        );
    });

    it("falls back to the '-' placeholder when the message is an empty string", async () => {
        (window as any).$.ajax = (opts: AjaxOptions) => {
            // valid JSON object with an empty message -> messageStr resolves to "-"
            opts.error({ status: 400, responseText: JSON.stringify({ message: "" }) });
        };
        await expect(server.post("url", {})).rejects.toBeDefined();
        expect(toastMock.showError).toHaveBeenCalledWith("-");
    });

    it("shows a generic error toast for other status codes", async () => {
        (window as any).$.ajax = (opts: AjaxOptions) => {
            opts.error({ status: 503, responseText: JSON.stringify({ message: "Down" }) });
        };
        await expect(server.get("plain/url")).rejects.toBeDefined();
        expect(toastMock.showErrorTitleAndMessage).toHaveBeenCalled();
        expect((window as any).logError).toHaveBeenCalled();
    });

    it("falls back to a JSON-stringified message when the response is not a string", async () => {
        (window as any).$.ajax = (opts: AjaxOptions) => {
            // object responseText with no message -> messageStr derives from JSON.stringify
            opts.error({ status: 503, responseText: { detail: "object-body" } });
        };
        await expect(server.get("obj/url")).rejects.toBeDefined();
        expect(toastMock.showErrorTitleAndMessage).toHaveBeenCalled();
    });
});

describe("CSRF token handling", () => {
    it("isCsrfError returns true only for 403 with the invalid-token message", async () => {
        // Drive isCsrfError through the retry path: a 403 that IS a csrf error triggers refresh + retry.
        const fetchMock = vi.fn(async () => ({
            ok: true,
            json: async () => ({ csrfToken: "fresh-token" })
        }));
        (window as any).fetch = fetchMock;
        (window as any).location = { search: "?x=1" } as any;

        let attempt = 0;
        (window as any).$.ajax = (opts: AjaxOptions) => {
            attempt++;
            if (attempt === 1) {
                opts.error({ status: 403, responseText: JSON.stringify({ message: "Invalid CSRF token" }) });
            } else {
                opts.success({ retried: true }, "success", fakeJqXhr(""));
            }
        };

        const result = await server.get<{ retried: boolean }>("retry/url");
        expect(result).toEqual({ retried: true });
        expect(fetchMock).toHaveBeenCalledWith("./bootstrap?x=1", { cache: "no-store" });
        expect((window as any).glob.csrfToken).toBe("fresh-token");
        expect(attempt).toBe(2);
    });

    it("does not retry when the 403 is not a csrf error (bad json / wrong message)", async () => {
        (window as any).$.ajax = (opts: AjaxOptions) => {
            // unparseable body -> isCsrfError catch -> false
            opts.error({ status: 403, responseText: "<<not json>>" });
        };
        await expect(server.get("noretry/url")).rejects.toBeDefined();
        expect(toastMock.showErrorTitleAndMessage).toHaveBeenCalled();
    });

    it("rejects when the retried request itself fails", async () => {
        (window as any).fetch = vi.fn(async () => ({ ok: false, json: async () => ({}) }));
        (window as any).location = { search: "" } as any;

        let attempt = 0;
        (window as any).$.ajax = (opts: AjaxOptions) => {
            attempt++;
            if (attempt === 1) {
                opts.error({ status: 403, responseText: JSON.stringify({ message: "Invalid CSRF token" }) });
            } else {
                // retried request rejects via browser-cancel (status 0 short-circuit)
                opts.error({ status: 0, responseText: "" });
            }
        };

        await expect(server.get("retry-fail/url")).rejects.toBe("rejected by browser");
        expect(attempt).toBe(2);
    });

    it("coalesces concurrent csrf refreshes into a single bootstrap fetch", async () => {
        let resolveFetch: (v: any) => void = () => {};
        const fetchMock = vi.fn(
            () =>
                new Promise((res) => {
                    resolveFetch = res;
                })
        );
        (window as any).fetch = fetchMock;
        (window as any).location = { search: "" } as any;

        const ajaxCalls: AjaxOptions[] = [];
        (window as any).$.ajax = (opts: AjaxOptions) => {
            ajaxCalls.push(opts);
            if (ajaxCalls.length <= 2) {
                opts.error({ status: 403, responseText: JSON.stringify({ message: "Invalid CSRF token" }) });
            } else {
                opts.success({ done: true }, "success", fakeJqXhr(""));
            }
        };

        const p1 = server.get("c1");
        const p2 = server.get("c2");
        // wait until both requests have errored and triggered the (single) in-flight bootstrap
        while (fetchMock.mock.calls.length === 0) {
            await new Promise((r) => setTimeout(r, 0));
        }
        resolveFetch({ ok: true, json: async () => ({ csrfToken: "shared" }) });
        await Promise.all([p1, p2]);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect((window as any).glob.csrfToken).toBe("shared");
    });
});

describe("upload", () => {
    function makeFile() {
        return new File(["data"], "f.txt", { type: "text/plain" });
    }

    it("uploads via $.ajax with the default PUT method and component header", async () => {
        const ajaxSpy = vi.fn(async (opts: any) => ({ uploaded: true, opts }));
        (window as any).$.ajax = ajaxSpy;

        const res = (await server.upload("upload/url", makeFile(), "comp-up")) as any;
        expect(res.uploaded).toBe(true);
        const opts = ajaxSpy.mock.calls[0][0];
        expect(opts.url).toBe("/api/upload/url");
        expect(opts.type).toBe("PUT");
        expect(opts.contentType).toBe(false);
        expect(opts.processData).toBe(false);
        expect(opts.headers["trilium-component-id"]).toBe("comp-up");
    });

    it("uploads with default headers when no componentId is given", async () => {
        const ajaxSpy = vi.fn(async (opts: any) => ({ ok: true, opts }));
        (window as any).$.ajax = ajaxSpy;
        await server.upload("upload/url", makeFile(), undefined, "POST");
        const opts = ajaxSpy.mock.calls[0][0];
        expect(opts.type).toBe("POST");
        // default headers fall back to glob.componentId
        expect(opts.headers["trilium-component-id"]).toBe("comp-glob");
    });

    it("refreshes the csrf token and retries once on a csrf upload failure", async () => {
        (window as any).fetch = vi.fn(async () => ({ ok: true, json: async () => ({ csrfToken: "up-fresh" }) }));
        (window as any).location = { search: "" } as any;

        let attempt = 0;
        (window as any).$.ajax = vi.fn(async () => {
            attempt++;
            if (attempt === 1) {
                const err: any = { status: 403, responseText: JSON.stringify({ message: "Invalid CSRF token" }) };
                throw err;
            }
            return { retried: true };
        });

        const res = (await server.upload("upload/url", makeFile())) as any;
        expect(res.retried).toBe(true);
        expect(attempt).toBe(2);
        expect((window as any).glob.csrfToken).toBe("up-fresh");
    });

    it("rethrows non-csrf upload failures", async () => {
        (window as any).$.ajax = vi.fn(async () => {
            const err: any = { status: 500, responseText: "server error" };
            throw err;
        });
        await expect(server.upload("upload/url", makeFile())).rejects.toMatchObject({ status: 500 });
    });

    it("rethrows when the rejection carries no status", async () => {
        (window as any).$.ajax = vi.fn(async () => {
            throw "string failure";
        });
        await expect(server.upload("upload/url", makeFile())).rejects.toBe("string failure");
    });
});

describe("localFetch transport", () => {
    let localFetch: ReturnType<typeof vi.fn>;

    function answerWith(body: string, init: { status?: number; headers?: Record<string, string> } = {}) {
        localFetch.mockResolvedValue(
            new Response(body, {
                status: init.status ?? 200,
                headers: init.headers ?? { "content-type": "application/json" }
            })
        );
    }

    beforeEach(() => {
        localFetch = vi.fn();
        (window as any).standaloneApi = { localFetch };
        // Every test in here must reach the worker directly. Failing loudly beats asserting
        // `not.toHaveBeenCalled()` in each one, and names what went wrong.
        (window as any).$.ajax = () => {
            throw new Error("$.ajax was used even though a tab owns the worker");
        };
    });

    afterEach(() => {
        delete (window as any).standaloneApi;
    });

    it("answers from the worker and tracks the max entity change id", async () => {
        answerWith(JSON.stringify({ ok: true }), {
            headers: { "content-type": "application/json", "trilium-max-entity-change-id": "99" }
        });

        const result = await server.get<{ ok: boolean }>("some/url", "comp-x");

        expect(result).toEqual({ ok: true });
        expect(server.getMaxKnownEntityChangeId()).toBeGreaterThanOrEqual(99);

        const request = localFetch.mock.calls[0][0] as Request;
        expect(request.method).toBe("GET");
        expect(request.url).toMatch(/\/api\/some\/url$/);
        expect(request.headers.get("trilium-component-id")).toBe("comp-x");
        expect(request.headers.get("x-csrf-token")).toBe("csrf-1");
    });

    it("sends a JSON body for POST and hands back text for a raw GET", async () => {
        answerWith(JSON.stringify({ saved: true }));
        await server.post("post/url", { title: "hello" });

        const request = localFetch.mock.calls[0][0] as Request;
        expect(request.method).toBe("POST");
        expect(request.headers.get("content-type")).toBe("application/json");
        expect(await request.text()).toBe(JSON.stringify({ title: "hello" }));

        // `raw` asks for the body as it arrived, whatever the content type claims.
        answerWith(JSON.stringify({ parsed: false }));
        const raw = await server.get("raw/url", undefined, true);
        expect(raw).toBe(JSON.stringify({ parsed: false }));
    });

    it("stays silent on the statuses the caller presents itself, still rejecting with the body", async () => {
        answerWith("{}", { status: 404 });
        await expect(server.getWithSilentNotFound("url")).rejects.toBeDefined();

        answerWith("boom", { status: 500 });
        await expect(server.postWithSilentInternalServerError("url", {})).rejects.toBeDefined();

        answerWith("The OneNote connection was lost.", { status: 401 });
        await expect(server.getWithSilentUnauthorized("url")).rejects.toBe("The OneNote connection was lost.");

        expect(toastMock.showError).not.toHaveBeenCalled();
        expect((window as any).logError).not.toHaveBeenCalled();
    });

    it("reports a validation error and rejects with the raw body", async () => {
        const responseText = JSON.stringify({ message: "Bad input" });
        answerWith(responseText, { status: 400 });

        await expect(server.post("url", {})).rejects.toBe(responseText);
        expect(toastMock.showError).toHaveBeenCalledWith("Bad input");
    });

    it("refreshes a stale csrf token and retries once, over the same transport", async () => {
        (window as any).fetch = vi.fn(async () => ({
            ok: true,
            json: async () => ({ csrfToken: "fresh-token" })
        }));
        (window as any).location = { search: "?x=1" } as any;

        localFetch
            .mockResolvedValueOnce(new Response(JSON.stringify({ message: "Invalid CSRF token" }), {
                status: 403,
                headers: { "content-type": "application/json" }
            }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ retried: true }), {
                status: 200,
                headers: { "content-type": "application/json" }
            }));

        const result = await server.get<{ retried: boolean }>("retry/url");

        expect(result).toEqual({ retried: true });
        expect(localFetch).toHaveBeenCalledTimes(2);
        expect((window as any).glob.csrfToken).toBe("fresh-token");
        // The retry carries the token the refresh just fetched, which is the point of retrying.
        expect((localFetch.mock.calls[1][0] as Request).headers.get("x-csrf-token")).toBe("fresh-token");
    });

    it("gives up on a worker that never answers", async () => {
        localFetch.mockReturnValue(new Promise(() => {}));

        await expect(server.getWithTimeout("stuck/url", 20)).rejects.toThrow(/Timed out after 20ms/);
    });

    it("uses the XHR transport when no tab owns the worker", async () => {
        delete (window as any).standaloneApi;
        const ajaxSpy = vi.fn((opts: AjaxOptions) => {
            opts.success({ viaXhr: true }, "success", fakeJqXhr(""));
        });
        (window as any).$.ajax = ajaxSpy;

        await expect(server.get("url")).resolves.toEqual({ viaXhr: true });
        expect(localFetch).not.toHaveBeenCalled();
    });

    it("answers an empty body with null rather than parsing it", async () => {
        // What a DELETE returns, and what `JSON.parse("")` would throw on.
        localFetch.mockResolvedValue(new Response(null, {
            status: 204,
            headers: { "content-type": "application/json" }
        }));

        await expect(server.remove("del/url")).resolves.toBeNull();
    });

    it("hands back a body the response does not call json as it arrived", async () => {
        answerWith("plain words", { headers: { "content-type": "text/plain" } });

        await expect(server.get("text/url")).resolves.toBe("plain words");
    });

    it("drops the headers that have no value", async () => {
        // No active context, so `trilium-hoisted-note-id` is null. Left in, it would reach the
        // worker as the string "null".
        answerWith(JSON.stringify({}));
        await server.get("url");

        const request = localFetch.mock.calls[0][0] as Request;
        expect(request.headers.has("trilium-hoisted-note-id")).toBe(false);
    });

    it("refreshes the csrf token only once, however many times the retry is refused", async () => {
        (window as any).fetch = vi.fn(async () => ({
            ok: true,
            json: async () => ({ csrfToken: "fresh-token" })
        }));
        (window as any).location = { search: "" } as any;

        const refusal = JSON.stringify({ message: "Invalid CSRF token" });
        localFetch.mockImplementation(async () => new Response(refusal, {
            status: 403,
            headers: { "content-type": "application/json" }
        }));

        await expect(server.get("retry-forever/url")).rejects.toBe(refusal);
        // The retry carries `csrfRetried`, so its own refusal reports rather than retrying again.
        expect(localFetch).toHaveBeenCalledTimes(2);
    });

    it("lets a worker failure through instead of reading a response out of it", async () => {
        // What local-bridge.ts rejects every in-flight request with when the worker dies.
        localFetch.mockRejectedValue(new Error("Worker error: boom"));

        await expect(server.get("url")).rejects.toThrow("Worker error: boom");
    });
});
