import { beforeEach, describe, expect, it, vi } from "vitest";

import { initRequest } from "../../request.js";
import { fakeRequestProvider } from "../../../test/request_provider.js";
import { fetchFailureReason, llmFetch } from "./fetch.js";

describe("llmFetch", () => {
    const fetchApi = vi.fn(async () => new Response("{}"));

    beforeEach(() => {
        fetchApi.mockClear();
        initRequest(fakeRequestProvider({ fetchApi }));
    });

    it("goes through the request provider rather than the global fetch", async () => {
        const globalFetch = vi.fn();
        vi.stubGlobal("fetch", globalFetch);

        await llmFetch("https://api.example.com/v1/models", { headers: { Authorization: "Bearer sk-x" } });

        expect(globalFetch).not.toHaveBeenCalled();
        expect(fetchApi).toHaveBeenCalledWith(
            "https://api.example.com/v1/models",
            { headers: { Authorization: "Bearer sk-x" } },
            expect.anything()
        );

        vi.unstubAllGlobals();
    });

    it("asks for private addresses to be reachable, which is what makes a local model server work", async () => {
        // The one thing about this call that is a policy decision rather than plumbing: refusing
        // these would leave Ollama and LM Studio — both of which default to loopback — unreachable.
        await llmFetch("http://localhost:11434/v1/models");

        expect(fetchApi).toHaveBeenCalledWith(expect.anything(), expect.anything(), { allowPrivateNetwork: true });
    });

    it("accepts a URL object, and an absent init, as the SDKs may pass either", async () => {
        await llmFetch(new URL("https://api.example.com/v1/models"));

        expect(fetchApi).toHaveBeenCalledWith("https://api.example.com/v1/models", {}, expect.anything());
    });

    it("refuses a Request, whose body it would have to consume to read", async () => {
        await expect(llmFetch(new Request("https://api.example.com/v1/models"))).rejects.toThrow(/does not accept a Request/);
        expect(fetchApi).not.toHaveBeenCalled();
    });
});

describe("fetchFailureReason", () => {
    const fetchFailed = (cause?: unknown) => new TypeError("fetch failed", { cause });

    it("reads the network error behind undici's generic \"fetch failed\"", () => {
        expect(fetchFailureReason(fetchFailed(new Error("connect ECONNREFUSED 192.168.1.10:8080"))))
            .toBe("connect ECONNREFUSED 192.168.1.10:8080");
        const bothFamilies = Object.assign(new AggregateError([
            new Error("connect ECONNREFUSED ::1:11434"),
            new Error("connect ECONNREFUSED 127.0.0.1:11434")
        ], ""), { code: "ECONNREFUSED" });
        expect(fetchFailureReason(fetchFailed(bothFamilies)))
            .toBe("connect ECONNREFUSED ::1:11434; connect ECONNREFUSED 127.0.0.1:11434");
        expect(fetchFailureReason(fetchFailed(Object.assign(new Error(""), { code: "ECONNRESET" })))).toBe("ECONNRESET");
    });

    it("falls back to the error itself when nothing more is known", () => {
        expect(fetchFailureReason(fetchFailed())).toBe("fetch failed");
        expect(fetchFailureReason(fetchFailed(new AggregateError([], "")))).toBe("fetch failed");
        expect(fetchFailureReason(new TypeError("Failed to fetch"))).toBe("Failed to fetch");
        expect(fetchFailureReason("offline")).toBe("offline");
    });
});
