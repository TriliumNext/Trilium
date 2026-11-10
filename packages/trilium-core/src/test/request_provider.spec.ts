import { describe, expect, it } from "vitest";

import { fakeRequestProvider } from "./request_provider.js";

describe("fakeRequestProvider", () => {
    it("keeps the overrides and fails loudly on every method left unstubbed", () => {
        const getImage = async () => new ArrayBuffer(1);
        const provider = fakeRequestProvider({ getImage });

        expect(provider.getImage).toBe(getImage);
        expect(() => provider.exec({ proxy: null, method: "GET", url: "http://localhost", timeout: 1000 })).toThrow("without exec()");
        expect(() => provider.fetchResource("http://localhost", { maxBytes: 1 })).toThrow("without fetchResource()");
        expect(() => provider.fetchApi("http://localhost", {}, { allowPrivateNetwork: false })).toThrow("without fetchApi()");
        expect(() => fakeRequestProvider().getImage("http://localhost")).toThrow("without getImage()");
    });
});
