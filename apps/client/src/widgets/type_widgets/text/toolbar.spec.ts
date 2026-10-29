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

const experimentalState = vi.hoisted(() => ({ enabled: new Set<string>() }));
vi.mock("../../../services/experimental_features.js", () => ({
    isExperimentalFeatureEnabled: (id: string) => experimentalState.enabled.has(id)
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

describe("the Insert group", () => {
    it("offers the drawing canvas above the Mermaid diagram, on both toolbars", () => {
        const toolbars = [
            buildClassicToolbar(false, true).toolbar.items,
            buildFloatingToolbar(true).blockToolbar
        ];
        for (const items of toolbars) {
            const group = items.find((item) => typeof item === "object"
                && "label" in item && item.label === "text-editor.toolbar-groups.insert");
            const groupItems = (group as { items: string[] } | undefined)?.items ?? [];
            const index = groupItems.indexOf("drawingCanvas");
            expect(groupItems.slice(index, index + 2)).toEqual([ "drawingCanvas", "mermaid" ]);
            expect(items).not.toContain("drawingCanvas");
        }
    });
});

describe("the extended code block", () => {
    afterEach(() => experimentalState.enabled.clear());

    function getInsertGroups() {
        const toolbars = [
            buildClassicToolbar(false, true).toolbar.items,
            buildFloatingToolbar(true).blockToolbar,
            buildMobileToolbar(true).toolbar.items
        ];
        return toolbars.map((items) => {
            const group = items.find((item) => typeof item === "object"
                && "label" in item && item.label === "text-editor.toolbar-groups.insert");
            return (group as { items: string[] } | undefined)?.items ?? [];
        });
    }

    it("follows the columns in the Insert group of every toolbar, while its feature is on", () => {
        experimentalState.enabled.add("extendedCodeBlocks");
        for (const items of getInsertGroups()) {
            const index = items.indexOf("multicolumnLayout");
            expect(items.slice(index, index + 2))
                .toEqual([ "multicolumnLayout", "extendedCodeBlock" ]);
        }

        experimentalState.enabled.clear();
        for (const items of getInsertGroups()) {
            expect(items).toContain("multicolumnLayout");
            expect(items).not.toContain("extendedCodeBlock");
        }
    });
});

describe("the attach menu", () => {
    it("replaces the image and file uploads on every toolbar, with the camera only on a phone", () => {
        const classic = buildClassicToolbar(false, true);
        const floating = buildFloatingToolbar(true);
        for (const items of [ classic.toolbar.items, floating.blockToolbar ]) {
            expect(items).toContain("attachMenu");
            expect(items).not.toContain("imageUpload");
            expect(items).not.toContain("fileUpload");
        }
        expect("attachMenu" in classic || "attachMenu" in floating).toBe(false);
        expect(buildMobileToolbar(true).attachMenu).toStrictEqual({ camera: true });
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
        expect(buildMobileToolbar(false).toolbar.items).not.toContain("aiAssistantMenu");

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
    it("nests only the insert menu, which holds the least used insertions and the wrapping blocks", () => {
        const { toolbar, textFormattingToolbar } = buildMobileToolbar(true);
        const groups = (toolbar.items as unknown[]).filter((item) => typeof item !== "string");
        expect(groups).toStrictEqual([ {
            label: "text-editor.toolbar-groups.insert",
            icon: "plus",
            asMenu: { layout: "tiles" },
            items: [
                "addImage", "insertTableMenu", "todoList",
                "|",
                "codeBlock", "blockQuote", "admonition",
                "|",
                "collapsible", "tabs", "multicolumnLayout",
                "|",
                "horizontalLine", "pageBreak", "footnote",
                "|",
                "math", "drawingCanvas", "mermaid",
                "|",
                "bookmark", "linkEmbed", "contentEmbed",
                "|",
                "specialCharacters", "emoji", "insertIcon",
                "|",
                "dateTime", "insertTemplate", "markdownImport"
            ]
        } ]);
        expect((textFormattingToolbar as unknown[]).every((item) => typeof item === "string")).toBe(true);
        expect(toolbar.items.slice(10)).toStrictEqual([
            "|",
            "outdent", "indent", "moveBlockUp", "moveBlockDown",
            "|",
            "aiAssistantMenu"
        ]);
    });

    it("keeps text formatting on a row of its own, opened from the main row", () => {
        const { toolbar, textFormattingToolbar } = buildMobileToolbar(true);
        // What a phone shows without scrolling: the blocks, text formatting, links and attachments.
        expect(toolbar.items.slice(0, 10).map(itemName)).toStrictEqual([
            "undo", "redo", "contextToolbar", "|", "blockType", "text-editor.toolbar-groups.insert", "textFormatting",
            "|", "addLink", "attachMenu"
        ]);
        expect(textFormattingToolbar).toStrictEqual([
            "bold", "italic", "underline", "strikethrough", "code",
            "|",
            "addLink",
            "|",
            "superscript", "subscript", "kbd",
            "|",
            "fontSizeMenu", "colorMenu",
            "|",
            "removeFormat", "formatPainter",
            "|",
            "alignment:left", "alignment:center", "alignment:right", "alignment:justify",
            "|",
            // Acts on the selection, which brings this row up.
            "cuttonote"
        ]);
        // A link is made at the caret from the main row and from a selection here.
        expect(collectItems({ items: toolbar.items }).filter((item) => textFormattingToolbar.includes(item)))
            .toStrictEqual([ "addLink" ]);
        // Turned into from the block type menu instead.
        for (const item of [ "bulletedList", "numberedList", "todoList", "codeBlock", "blockQuote", "admonition" ]) {
            expect(toolbar.items).not.toContain(item);
        }
    });

    it("leads the list's own toolbar with the indentation and the moves, then the list properties", () => {
        expect(buildMobileToolbar(true).listToolbar).toStrictEqual([
            "outdent", "indent", "moveBlockUp", "moveBlockDown",
            "|",
            "listTypeMenu", "listStartAt", "listReversed"
        ]);
    });

    it("opens table sizes as tiles from the insert menu instead of the size grid", () => {
        const items = buildMobileToolbar(true).toolbar.items;
        expect(items).not.toContain("insertTableMenu");
        expect(collectItems({ items })).toContain("insertTableMenu");
        expect(collectItems({ items })).not.toContain("insertTable");
        expect(buildClassicToolbar(false, true).toolbar.items).toContain("insertTable");
    });

    it("opens with undo, redo and the toolbar of the widget at the selection, set apart by a separator", () => {
        const items = buildMobileToolbar(true).toolbar.items;
        expect(items.slice(0, 4)).toStrictEqual([ "undo", "redo", "contextToolbar", "|" ]);
        expect(items.filter((item) => item === "undo" || item === "redo")).toHaveLength(2);
    });

    it("offers every item of the classic toolbar", () => {
        // Variants of an item that suit a touch screen.
        const MOBILE_VARIANTS: Record<string, string> = {
            insertTable: "insertTableMenu",
            link: "addLink",
            internallink: "addLink",
            heading: "blockType",
            bulletedList: "blockType",
            numberedList: "blockType",
            todoList: "blockType",
            fontSize: "fontSizeMenu",
            fontColor: "colorMenu",
            fontBackgroundColor: "colorMenu",
            aiAssistant: "aiAssistantMenu"
        };
        // Alt+Up and Alt+Down move blocks on a keyboard, and the insert menu repeats the image upload
        // and the to-do list, where a reader might look for them.
        const MOBILE_ONLY = [ "moveBlockUp", "moveBlockDown", "contextToolbar", "addImage", "todoList" ];
        for (const aiAssistant of [ true, false ]) {
            const classicItems = collectItems({ items: buildClassicToolbar(false, aiAssistant).toolbar.items })
                .map((item) => MOBILE_VARIANTS[item] ?? item);
            const { toolbar, textFormattingToolbar } = buildMobileToolbar(aiAssistant);
            const mobileItems = collectItems({ items: [ ...toolbar.items, ...textFormattingToolbar ] })
                .filter((item) => item !== "textFormatting" && !MOBILE_ONLY.includes(item));
            expect([ ...new Set(mobileItems) ].toSorted()).toStrictEqual([ ...new Set(classicItems) ].toSorted());
        }
    });

    it("neither starts nor ends on a separator, nor doubles one, on either row", () => {
        for (const aiAssistant of [ true, false ]) {
            const { toolbar, textFormattingToolbar } = buildMobileToolbar(aiAssistant);
            for (const items of [ toolbar.items, textFormattingToolbar ]) {
                expect(items[0]).not.toBe("|");
                expect(items.at(-1)).not.toBe("|");
                expect(items.some((item, index) => item === "|" && items[index + 1] === "|")).toBe(false);
            }
        }
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

    it("returns the mobile toolbar on a mobile device", () => {
        setDevice("mobile");
        const config = buildToolbarConfig(true, true);
        expect("textFormattingToolbar" in config).toBe(true);
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

/** The name of a toolbar item, or the label of a group. */
function itemName(item: unknown) {
    return typeof item === "object" && item !== null && "label" in item ? item.label : item;
}

/** The item names of a toolbar configuration, its groups included, without separators. */
function collectItems(config: ToolbarConfig): string[] {
    if (typeof config === "object") {
        return config.items.flatMap(collectItems);
    }
    return config === "|" ? [] : [ config ];
}
