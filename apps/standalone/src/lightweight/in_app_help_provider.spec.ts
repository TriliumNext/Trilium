import { describe, expect, it } from "vitest";

import StandaloneInAppHelpProvider from "./in_app_help_provider.js";

describe("StandaloneInAppHelpProvider", () => {
    it("returns the doc-note help subtree (same structure as server/desktop)", () => {
        const provider = new StandaloneInAppHelpProvider();
        const data = provider.getHelpHiddenSubtreeData();
        expect(Array.isArray(data)).toBe(true);
        expect(data.length).toBeGreaterThan(0);

        // After unifying the hidden subtree, standalone emits doc notes with docName labels (not the
        // old webView variant) so the synced _help structure is identical across platforms.
        function hasDocWithName(items: typeof data): boolean {
            return items.some((item) =>
                (item.type === "doc" && (item.attributes?.some((a) => a.name === "docName") ?? false))
                || (item.children ? hasDocWithName(item.children) : false));
        }
        expect(hasDocWithName(data)).toBe(true);
    });

    it("answers getDocContent from the bundled help-content index", () => {
        const provider = new StandaloneInAppHelpProvider();

        const content = provider.getDocContent("hidden");
        expect(typeof content).toBe("string");
        expect((content ?? "").length).toBeGreaterThan(0);

        expect(provider.getDocContent("definitely/not/a/real/doc")).toBeNull();
    });
});
