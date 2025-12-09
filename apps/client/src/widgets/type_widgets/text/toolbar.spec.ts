import { describe, expect, it } from "vitest";
import { buildClassicToolbar, buildFloatingToolbar } from "./toolbar.js";

type ToolbarConfig = string | "|" | { items: ToolbarConfig[] };

describe("CKEditor config", () => {
    it("has same toolbar items for fixed and floating", () => {
        function traverseItems(config: ToolbarConfig): string[] {
            const result: (string | string[])[] = [];
            if (typeof config === "object") {
                for (const item of config.items) {
                    result.push(traverseItems(item));
                }
            } else if (config !== "|") {
                result.push(config);
            }
            return result.flat();
        }

        const classicToolbarConfig = buildClassicToolbar(false);
        const classicToolbarItems = new Set(traverseItems(classicToolbarConfig.toolbar));

        const floatingToolbarConfig = buildFloatingToolbar();
        const floatingToolbarItems = traverseItems(floatingToolbarConfig.toolbar);
        const floatingBlockToolbarItems = traverseItems({ items: floatingToolbarConfig.blockToolbar });
        const floatingToolbarAllItems = new Set([ ...floatingToolbarItems, ...floatingBlockToolbarItems ]);

        expect([ ...classicToolbarItems ].toSorted())
            .toStrictEqual([...floatingToolbarAllItems ].toSorted());
    });
});
