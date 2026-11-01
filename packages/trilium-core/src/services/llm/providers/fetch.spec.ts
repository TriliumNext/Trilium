import { beforeEach, describe, expect, it, vi } from "vitest";

import { initRequest } from "../../request.js";
import { fakeRequestProvider } from "../../../test/request_provider.js";
import { llmFetch } from "./fetch.js";

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
