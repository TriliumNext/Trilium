import { describe, expect, it, vi } from "vitest";

import requestService, {
    type ExecOpts,
    getRequestProvider,
    initRequest,
    isRequestInitialized,
    type RequestProvider
} from "./request.js";

describe("request provider (core)", () => {
    // The core test bootstrap does not register a request provider, so the module
    // starts uninitialized. Fork-per-file isolation keeps the mutation local.
    it("throws and reports uninitialized until a provider is installed", () => {
        expect(isRequestInitialized()).toBe(false);
        expect(() => getRequestProvider()).toThrow(/not initialized/);
    });

    it("delegates exec/getImage to the installed provider", async () => {
        const image = new ArrayBuffer(8);
        const execMock = vi.fn(async (_opts: ExecOpts) => ({ ok: true }));
        const fake: RequestProvider = {
            exec: execMock as unknown as RequestProvider["exec"],
            getImage: vi.fn(async () => image)
        };

        initRequest(fake);
        expect(isRequestInitialized()).toBe(true);
        expect(getRequestProvider()).toBe(fake);

        const opts: ExecOpts = { proxy: null, method: "GET", url: "http://localhost/x", timeout: 1000 };
        await expect(requestService.exec(opts)).resolves.toEqual({ ok: true });
        expect(execMock).toHaveBeenCalledWith(opts);

        await expect(requestService.getImage("http://localhost/img.png")).resolves.toBe(image);
        expect(fake.getImage).toHaveBeenCalledWith("http://localhost/img.png");
    });
});
