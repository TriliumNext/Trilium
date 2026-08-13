import { describe, expect, it, vi } from "vitest";

import StandaloneInAppHelpProvider from "./in_app_help_provider.js";

describe("StandaloneInAppHelpProvider", () => {
    it("returns help data from the imported meta", () => {
        const provider = new StandaloneInAppHelpProvider();
        const data = provider.getHelpHiddenSubtreeData();
        expect(Array.isArray(data)).toBe(true);
        expect(data.length).toBeGreaterThan(0);
    });

    it("serves the fetched page content, keyed by note ID", async () => {
        const provider = new StandaloneInAppHelpProvider();
        expect(provider.getHelpContent()).toEqual({});

        const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
            new Response(JSON.stringify({ _help_page: "<p>Body</p>" }), { status: 200 })
        );
        await provider.load();

        expect(fetchSpy).toHaveBeenCalledWith("/server-assets/help/help_content.json");
        expect(provider.getHelpContent()).toEqual({ _help_page: "<p>Body</p>" });
        fetchSpy.mockRestore();
    });

    it("keeps the tree usable when the content cannot be fetched", async () => {
        const provider = new StandaloneInAppHelpProvider();
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 404 }));

        // Pages lose their bodies; the titles and the navigation do not depend on this.
        await expect(provider.load()).resolves.toBeUndefined();
        expect(provider.getHelpContent()).toEqual({});
        expect(provider.getHelpHiddenSubtreeData().length).toBeGreaterThan(0);
        expect(warn).toHaveBeenCalled();

        fetchSpy.mockRestore();
        warn.mockRestore();
    });

    it("points assets at the copy the build makes", () => {
        expect(new StandaloneInAppHelpProvider().getHelpAssetBase()).toBe("server-assets/help");
    });
});
