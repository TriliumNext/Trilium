import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildClassicToolbar, buildFloatingToolbar, buildMobileToolbar, buildToolbarConfig, usesClassicToolbar } from "./toolbar.js";

type ToolbarConfig = string | "|" | { items: ToolbarConfig[] };

// `buildToolbarConfig` reads the multiline preference via the options service; stub it so the
// classic/multiline branch is deterministic. `isMobile()`/`isDesktop()` read `window.glob.device`,
// which the per-test setup controls directly (no module mock needed for those).
const optionsState = vi.hoisted(() => ({ values: {} as Record<string, string | undefined> }));
vi.mock("../../../services/options.js", () => ({
    default: { get: (name: string) => optionsState.values[name] }
}));

// The group labels are translated when the toolbar is built (CKEditor renders a nested dropdown's
// `label` verbatim), so echo the key back to make the lookup visible to the assertions below.
vi.mock("../../../services/i18n.js", () => ({ t: (key: string) => key }));

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

        const classicToolbarConfig = buildClassicToolbar(false, true);
        const classicToolbarItems = new Set(
            traverseItems(classicToolbarConfig.toolbar).filter((item) => !FIXED_ONLY_ITEMS.has(item))
        );

        const floatingToolbarConfig = buildFloatingToolbar(true);
        const floatingToolbarItems = traverseItems(floatingToolbarConfig.toolbar);
        const floatingBlockToolbarItems = traverseItems({ items: floatingToolbarConfig.blockToolbar });
        const floatingToolbarAllItems = new Set([ ...floatingToolbarItems, ...floatingBlockToolbarItems ]);

        expect([ ...classicToolbarItems ].toSorted())
            .toStrictEqual([...floatingToolbarAllItems ].toSorted());
    });
});

describe("buildClassicToolbar", () => {
    it("reflects the multiline flag via shouldNotGroupWhenFull", () => {
        expect(buildClassicToolbar(false, true).toolbar.shouldNotGroupWhenFull).toBe(false);
        expect(buildClassicToolbar(true, true).toolbar.shouldNotGroupWhenFull).toBe(true);
    });
});

/**
 * An assistant that is switched off (or has no provider configured) has no transport, so its
 * command can never be enabled — the entries are left out rather than shown permanently disabled.
 */
describe("the AI assistant's entries", () => {
    it("are dropped from every toolbar when the assistant is unavailable", () => {
        expect(buildClassicToolbar(false, false).toolbar.items).not.toContain("aiAssistant");
        expect(buildMobileToolbar(false).toolbar.items).not.toContain("aiAssistant");

        const floating = buildFloatingToolbar(false);
        expect(floating.toolbar.items).not.toContain("aiAssistant");
        expect(floating.blockToolbar).not.toContain("aiAssistant");
    });

    // The assistant heads the block toolbar, so it takes the separator behind it along.
    it("leave the block toolbar opening on an item rather than on a separator", () => {
        expect(buildFloatingToolbar(true).blockToolbar.slice(0, 3)).toStrictEqual([ "aiAssistant", "|", "heading" ]);
        expect(buildFloatingToolbar(false).blockToolbar[0]).toBe("heading");
    });
});

describe("group labels", () => {
    // Each nested group carries a translated label; a hardcoded English one would reach the user
    // untranslated, since CKEditor passes it straight to the dropdown button.
    function groupLabels(items: unknown[]): string[] {
        return items
            .filter((item): item is { label: string } => typeof item === "object" && item !== null && "label" in item)
            .map((item) => item.label);
    }

    it("translates every group label, on both the classic and the floating toolbar", () => {
        expect(groupLabels(buildClassicToolbar(false, true).toolbar.items)).toStrictEqual([
            "text-editor.toolbar-groups.text-formatting",
            "text-editor.toolbar-groups.insert",
            "text-editor.toolbar-groups.alignment"
        ]);

        const floating = buildFloatingToolbar(true);
        expect(groupLabels(floating.toolbar.items)).toStrictEqual([ "text-editor.toolbar-groups.text-formatting" ]);
        expect(groupLabels(floating.blockToolbar)).toStrictEqual([
            "text-editor.toolbar-groups.insert",
            "text-editor.toolbar-groups.alignment"
        ]);
    });
});

describe("buildMobileToolbar", () => {
    it("flattens nested toolbar groups into a single flat item list", () => {
        const mobile = buildMobileToolbar(true);

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
        const config = buildToolbarConfig(true, true);
        expect(config.toolbar.items.every((item) => typeof item === "string")).toBe(true);
    });

    it("returns the multiline classic toolbar when on desktop and the option is enabled", () => {
        optionsState.values["textNoteEditorMultilineToolbar"] = "true";
        const config = buildToolbarConfig(true, true) as ReturnType<typeof buildClassicToolbar>;
        expect(config.toolbar.shouldNotGroupWhenFull).toBe(true);
    });

    it("returns the single-line classic toolbar when the multiline option is not enabled", () => {
        const config = buildToolbarConfig(true, true) as ReturnType<typeof buildClassicToolbar>;
        expect(config.toolbar.shouldNotGroupWhenFull).toBe(false);
    });

    it("returns the floating toolbar (with a block toolbar) when not in classic mode", () => {
        const config = buildToolbarConfig(false, true);
        expect("blockToolbar" in config).toBe(true);
    });
});

/**
 * Which of the two toolbars a text note is edited with. Three things have a say and they do not
 * carry equal weight, which is the whole of what this settles.
 */
describe("usesClassicToolbar", () => {
    it("follows the reader's option on a desktop that has asked for nothing else", () => {
        expect(usesClassicToolbar({ isMobile: false, textNoteEditorType: "ckeditor-classic" })).toBe(true);
        expect(usesClassicToolbar({ isMobile: false, textNoteEditorType: "ckeditor-balloon" })).toBe(false);
    });

    // A balloon is hard to reach around a virtual keyboard, so the option does not apply there.
    it("keeps the classic bar on a phone whatever the option says", () => {
        expect(usesClassicToolbar({ isMobile: true, textNoteEditorType: "ckeditor-balloon" })).toBe(true);
    });

    // A bar built for the width of a note fits no narrow view, on any device.
    it("gives way to a view that has asked for the floating toolbar, option and device alike", () => {
        expect(usesClassicToolbar({
            floatingToolbarRequested: true,
            isMobile: false,
            textNoteEditorType: "ckeditor-classic"
        })).toBe(false);

        expect(usesClassicToolbar({
            floatingToolbarRequested: true,
            isMobile: true,
            textNoteEditorType: "ckeditor-classic"
        })).toBe(false);
    });
});
