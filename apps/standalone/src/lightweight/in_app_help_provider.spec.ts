import { describe, expect, it } from "vitest";

import StandaloneInAppHelpProvider from "./in_app_help_provider.js";

describe("StandaloneInAppHelpProvider", () => {
    it("returns help data from the imported meta", () => {
        const provider = new StandaloneInAppHelpProvider();
        const data = provider.getHelpHiddenSubtreeData();
        expect(Array.isArray(data)).toBe(true);
        expect(data.length).toBeGreaterThan(0);
    });

    it("all entries use webView or book type (no doc type with docName)", () => {
        const provider = new StandaloneInAppHelpProvider();
        const data = provider.getHelpHiddenSubtreeData();

        function assertNoDocWithContent(items: typeof data) {
            for (const item of items) {
                if (item.type === "doc") {
                    const hasDocName = item.attributes?.some(a => a.name === "docName");
                    expect(hasDocName, `${item.title} should not have docName`).toBe(false);
                }
                if (item.children) {
                    assertNoDocWithContent(item.children);
                }
            }
        }

        assertNoDocWithContent(data);
    });
});
