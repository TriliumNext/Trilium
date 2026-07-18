import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildClassicToolbar, buildFloatingToolbar, buildMobileToolbar, buildToolbarConfig } from "./toolbar.js";

type ToolbarConfig = string | "|" | { items: ToolbarConfig[] };

// `buildToolbarConfig` reads the multiline preference via the options service; stub it so the
// classic/multiline branch is deterministic. `isMobile()`/`isDesktop()` read `window.glob.device`,
// which the per-test setup controls directly (no module mock needed for those).
const optionsState = vi.hoisted(() => ({ values: {} as Record<string, string | undefined> }));
vi.mock("../../../services/options.js", () => ({
    default: { get: (name: string) => optionsState.values[name] }
}));

function setDevice(device: "mobile" | "desktop") {
    (window as unknown as { glob?: { device?: string } }).glob = { device };
}

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

        // Undo/redo live only on the fixed toolbar — they're always reachable via keyboard and
        // have no natural slot in the floating selection/block toolbar — so exclude them from the
        // fixed-vs-floating parity check.
        const FIXED_ONLY_ITEMS = new Set(["undo", "redo"]);

        const classicToolbarConfig = buildClassicToolbar(false);
        const classicToolbarItems = new Set(
            traverseItems(classicToolbarConfig.toolbar).filter((item) => !FIXED_ONLY_ITEMS.has(item))
        );

        const floatingToolbarConfig = buildFloatingToolbar();
        const floatingToolbarItems = traverseItems(floatingToolbarConfig.toolbar);
        const floatingBlockToolbarItems = traverseItems({ items: floatingToolbarConfig.blockToolbar });
        const floatingToolbarAllItems = new Set([ ...floatingToolbarItems, ...floatingBlockToolbarItems ]);

        expect([ ...classicToolbarItems ].toSorted())
            .toStrictEqual([...floatingToolbarAllItems ].toSorted());
    });
});

describe("buildClassicToolbar", () => {
    it("reflects the multiline flag via shouldNotGroupWhenFull", () => {
        expect(buildClassicToolbar(false).toolbar.shouldNotGroupWhenFull).toBe(false);
        expect(buildClassicToolbar(true).toolbar.shouldNotGroupWhenFull).toBe(true);
    });
});

describe("buildMobileToolbar", () => {
    it("flattens nested toolbar groups into a single flat item list", () => {
        const mobile = buildMobileToolbar();

        // Items nested inside group objects (text-formatting, alignment, ...) are hoisted up.
        expect(mobile.toolbar.items).toContain("underline");
        expect(mobile.toolbar.items).toContain("alignment:left");
        // No nested group objects survive the flattening.
        expect(mobile.toolbar.items.some((item) => typeof item === "object")).toBe(false);
    });
});

describe("buildToolbarConfig dispatch", () => {
    beforeEach(() => {
        optionsState.values = {};
        setDevice("desktop");
    });

    afterEach(() => {
        delete (window as unknown as { glob?: unknown }).glob;
        vi.clearAllMocks();
    });

    it("returns the flattened mobile toolbar on a mobile device", () => {
        setDevice("mobile");
        const config = buildToolbarConfig(true);
        expect(config.toolbar.items.every((item) => typeof item === "string")).toBe(true);
    });

    it("returns the multiline classic toolbar when on desktop and the option is enabled", () => {
        optionsState.values["textNoteEditorMultilineToolbar"] = "true";
        const config = buildToolbarConfig(true) as ReturnType<typeof buildClassicToolbar>;
        expect(config.toolbar.shouldNotGroupWhenFull).toBe(true);
    });

    it("returns the single-line classic toolbar when the multiline option is not enabled", () => {
        const config = buildToolbarConfig(true) as ReturnType<typeof buildClassicToolbar>;
        expect(config.toolbar.shouldNotGroupWhenFull).toBe(false);
    });

    it("returns the floating toolbar (with a block toolbar) when not in classic mode", () => {
        const config = buildToolbarConfig(false);
        expect("blockToolbar" in config).toBe(true);
    });
});
