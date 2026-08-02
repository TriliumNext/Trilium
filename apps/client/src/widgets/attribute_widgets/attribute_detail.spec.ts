import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The popup docks differently under the new layout, and the flag behind that is read once when the
// module loads — so the two are exercised by loading it twice.
const newLayout = vi.hoisted(() => ({ enabled: false }));
vi.mock("../../services/experimental_features", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../services/experimental_features")>()),
    isExperimentalFeatureEnabled: () => newLayout.enabled
}));

import type { AttributeDetailOpts } from "./attribute_detail";

const VIEWPORT = { width: 1200, height: 800 };
// Each test deliberately re-imports the popup module to exercise module-load feature flags.
// The cold import can exceed Vitest's default timeout when the complete client suite runs.
const MODULE_IMPORT_TIMEOUT = 60_000;

describe("attribute detail popup positioning", () => {
    beforeEach(() => {
        sizeViewport(VIEWPORT.width, VIEWPORT.height);
    });

    afterEach(() => {
        document.body.replaceChildren();
    });

    it("leaves a popup that has not been laid out where it is", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const popup = sized(document.createElement("div"), 0, 0);

        (await load()).positionPopup(popup, opts({ x: 100, y: 100 }), { top: 0, left: 0 });

        expect(popup.style.left).toBe("");
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("position popup"));
        warn.mockRestore();
    }, MODULE_IMPORT_TIMEOUT);

    it("puts an anchored popup on whichever side of its anchor has the room for it", async () => {
        const { positionPopup } = await load();
        const popup = sized(document.createElement("div"), 300, 400);

        // Room to the left of the anchor: 300 wide plus the gap and the margin fit before it.
        positionPopup(popup, opts({ anchor: anchoredAt({ left: 900, right: 1100, top: 120 }) }), NO_OFFSET);
        expect(popup.style.left).toBe("592px"); // 900 - 300 - 8
        expect(popup.style.top).toBe("120px");
        expect(popup.style.right).toBe("");
        expect(popup.style.maxHeight).toBe("780px"); // the viewport less a margin above and below

        // No room to the left, so it takes the right — and slides up to stay wholly on screen.
        positionPopup(popup, opts({ anchor: anchoredAt({ left: 40, right: 200, top: 700 }) }), NO_OFFSET);
        expect(popup.style.left).toBe("208px"); // 200 + 8
        expect(popup.style.top).toBe("390px"); // 800 - 400 - 10

        // Narrower than the popup on either side: it keeps to the viewport's left margin.
        sizeViewport(305, VIEWPORT.height);
        positionPopup(popup, opts({ anchor: anchoredAt({ left: 10, right: 300, top: 40 }) }), NO_OFFSET);
        expect(popup.style.left).toBe("10px");
    }, MODULE_IMPORT_TIMEOUT);

    it("places an unanchored popup below the click, against whichever edge it falls nearest", async () => {
        const { positionPopup } = await load();
        const popup = sized(document.createElement("div"), 300, 200);

        // A press far enough left that the popup would run off the edge is held against it.
        positionPopup(popup, opts({ x: 100, y: 100 }), { top: 30, left: 0 });
        expect(popup.style.left).toBe("10px");
        expect(popup.style.right).toBe("");
        expect(popup.style.top).toBe("140px"); // 100 - 30 + 70
        // Room enough below the click for the whole popup, so it is left uncapped.
        expect(popup.style.maxHeight).toBe("10000px");

        // Anywhere else the popup pins to the right edge, and a press low down caps its height.
        positionPopup(popup, opts({ x: 600, y: 700 }), NO_OFFSET);
        expect(popup.style.left).toBe("");
        expect(popup.style.right).toBe("10px");
        expect(popup.style.maxHeight).toBe("50px"); // 800 - 700 - 50
    }, MODULE_IMPORT_TIMEOUT);

    it("sits above the attributes pane under the new layout, and above the status bar without one", async () => {
        newLayout.enabled = true;
        const { positionPopup } = await load();
        const popup = sized(document.createElement("div"), 300, 200);
        sizeBody(VIEWPORT.height);

        const pane = document.createElement("div");
        pane.className = "bottom-panel attribute-list";
        pane.getBoundingClientRect = (() => ({ top: 600 })) as Element["getBoundingClientRect"];
        document.body.append(pane);

        positionPopup(popup, opts({ x: 500, y: 100 }), NO_OFFSET);
        expect(popup.style.top).toBe("unset");
        expect(popup.style.bottom).toBe("200px"); // the body's height down to the pane
        expect(popup.style.maxHeight).toBe("600px");
        expect(popup.style.left).toBe("350px"); // centred on the press

        // With the pane away, the status bar is what the popup docks to instead.
        pane.classList.add("hidden-ext");
        const statusBar = sized(document.createElement("div"), 1200, 40);
        statusBar.className = "component status-bar";
        document.body.append(statusBar);

        // A press near the left edge is held a margin away from it rather than centred.
        positionPopup(popup, opts({ x: 100, y: 100 }), NO_OFFSET);
        expect(popup.style.bottom).toBe("40px");
        expect(popup.style.maxHeight).toBe("760px");
        expect(popup.style.left).toBe("10px");

        newLayout.enabled = false;
    }, MODULE_IMPORT_TIMEOUT);

    /** Re-imports the module so the layout flag above is read afresh. */
    async function load() {
        vi.resetModules();
        return await import("./attribute_detail");
    }
});

describe("attribute detail popup naming", () => {
    it("edits a definition under its bare name and stores it back under its prefix", async () => {
        const { addDefinitionPrefix, stripDefinitionPrefix } = await import("./attribute_detail");

        expect(stripDefinitionPrefix("label:priority", "label-definition")).toBe("priority");
        expect(stripDefinitionPrefix("relation:author", "relation-definition")).toBe("author");
        expect(stripDefinitionPrefix("priority", "label")).toBe("priority");

        expect(addDefinitionPrefix("priority", "label-definition")).toBe("label:priority");
        expect(addDefinitionPrefix("author", "relation-definition")).toBe("relation:author");
        expect(addDefinitionPrefix("priority", "relation")).toBe("priority");
    });

    it("searches for every note carrying the attribute by name alone", async () => {
        const { formatAttributeForSearch } = await import("./attribute_detail");

        expect(formatAttributeForSearch({ type: "label", name: "author" })).toBe("#author");
        expect(formatAttributeForSearch({ type: "relation", name: "template" })).toBe("~template");
    });

    it("counts a show as new by what it would put in the form, not by the objects it arrives in", async () => {
        const { isSameShow } = await import("./attribute_detail");
        const shown = opts({ attribute: { type: "label", name: "author", value: "Tolkien" } });

        // The same row pressed again: a fresh opts object around an equal attribute is the same show,
        // whether or not the attribute object itself survived.
        expect(isSameShow(shown, { ...shown, x: 40, y: 90 })).toBe(true);
        expect(isSameShow(shown, opts({ attribute: { type: "label", name: "author", value: "Tolkien" } }))).toBe(true);

        // Anything the form would show differently is another show.
        expect(isSameShow(shown, opts({ attribute: { type: "label", name: "author", value: "Lewis" } }))).toBe(false);
        expect(isSameShow(shown, opts({ attribute: { type: "relation", name: "author", value: "Tolkien" } }))).toBe(false);
        expect(isSameShow(shown, opts({ ...shown, isOwned: false }))).toBe(false);
        expect(isSameShow(shown, opts({ ...shown, focus: "name" }))).toBe(false);

        // ...but the very same request handed back is the host re-rendering around an untouched
        // popup, which every keystroke does — rebuilding the form there costs the focus and, with a
        // request that asks for it, re-selects the field so the next character replaces the name.
        const focused = opts({ focus: "name" });
        expect(isSameShow(focused, focused)).toBe(true);

        // Opening and closing are shows of their own, so reopening rebuilds the form.
        expect(isSameShow(null, shown)).toBe(false);
        expect(isSameShow(shown, null)).toBe(false);
        expect(isSameShow(null, null)).toBe(true);
    });

    it("explains only the names Trilium attaches a meaning to, and points at a help page where there is one", async () => {
        const { lookupAttributeHelp } = await import("./attribute_detail");

        expect(lookupAttributeHelp("label", "customRequestHandler")).toMatchObject({ helpPage: "J5Ex1ZrMbyJ6" });
        expect(lookupAttributeHelp("label", "somethingInvented")).toBeUndefined();
        expect(lookupAttributeHelp(undefined, "customRequestHandler")).toBeUndefined();
    });

    it("explains every name Trilium reads for itself, and no name it does not", async () => {
        const { ATTR_HELP } = await import("./attr_help");
        const { default: BUILTIN_ATTRIBUTES } = await import("@triliumnext/commons/src/lib/builtin_attributes");

        // Asserted on the entry being declared rather than on what it reads: `t()` resolves to nothing
        // without the translations loaded, which is why the lookup below is checked by its help page.
        for (const { type, name } of BUILTIN_ATTRIBUTES) {
            expect(Object.hasOwn(ATTR_HELP[type] ?? {}, name), `${type} ${name} has no help`).toBe(true);
        }

        for (const type of [ "label", "relation" ] as const) {
            for (const name of Object.keys(ATTR_HELP[type] ?? {})) {
                expect(BUILTIN_ATTRIBUTES.some((attr) => attr.type === type && attr.name === name),
                    `${type} ${name} is explained but is not a builtin`).toBe(true);
            }
        }
    });

    it("marks the names Trilium reads for itself, a definition named after one excepted", async () => {
        const { isSystemAttribute } = await import("./attribute_detail");

        expect(isSystemAttribute("label", "archived")).toBe(true);
        expect(isSystemAttribute("relation", "template")).toBe(true);
        // Most system attributes have no help entry, which is what the mark is for.
        expect(isSystemAttribute("label", "dateNote")).toBe(true);
        expect(isSystemAttribute("label", "somethingInvented")).toBe(false);

        // A definition sets up a field named after a system attribute without being one, and the popup
        // edits it under the bare name -- so the name alone would wrongly say yes.
        expect(isSystemAttribute("label-definition", "archived")).toBe(false);
        expect(isSystemAttribute("relation-definition", "template")).toBe(false);
        expect(isSystemAttribute(undefined, "archived")).toBe(false);
    });
});

describe("related notes menu", () => {
    it("lists the notes and the search entry as the dropdown does, titles escaped for the menu", async () => {
        const { showRelatedNotesMenu } = await import("./attribute_detail");
        const { default: contextMenu } = await import("../../menus/context_menu");
        const { default: appContext } = await import("../../components/app_context");

        const show = vi.spyOn(contextMenu, "show").mockResolvedValue();
        const triggerCommand = vi.spyOn(appContext, "triggerCommand").mockResolvedValue(undefined);
        // The tab manager only exists once the app has started, so the stub stands it in whole.
        const setNote = vi.fn();
        const previousTabManager = appContext.tabManager;
        appContext.tabManager = { getActiveContext: () => ({ setNote }) } as unknown as typeof appContext.tabManager;

        showRelatedNotesMenu({ pageX: 12, pageY: 34 } as MouseEvent, {
            notes: [{ notePath: "root/abc", icon: "tn-icon bx bx-file", title: "Tolkien & <sons>" }],
            otherCount: 5
        }, { type: "label", name: "author", value: "" });

        expect(show).toHaveBeenCalledOnce();
        const options = show.mock.calls[0][0];
        expect(options).toMatchObject({ x: 12, y: 34 });

        const [ noteItem, separator, searchItem ] = options.items;
        // The menu reads a title as HTML, which the note's own is not.
        expect(noteItem).toMatchObject({
            title: "Tolkien &amp; &lt;sons&gt;",
            uiIcon: "tn-icon bx bx-file"
        });
        expect(separator).toEqual({ kind: "separator" });
        expect(searchItem).toMatchObject({ uiIcon: "bx bx-search-alt" });

        // A note entry navigates to it; the search entry searches for every carrier of the name.
        const pressEvent = {} as JQuery.MouseDownEvent<HTMLElement, undefined, HTMLElement, HTMLElement>;
        if ("handler" in noteItem) {
            noteItem.handler?.(noteItem, pressEvent);
        }
        expect(setNote).toHaveBeenCalledWith("root/abc");

        if ("handler" in searchItem) {
            searchItem.handler?.(searchItem, pressEvent);
        }
        expect(triggerCommand).toHaveBeenCalledWith("searchNotes", { searchString: "#author" });

        appContext.tabManager = previousTabManager;
        vi.restoreAllMocks();
    });
});

const NO_OFFSET = { top: 0, left: 0 };

function opts(overrides: Partial<AttributeDetailOpts>): AttributeDetailOpts {
    return {
        attribute: { type: "label", name: "author", value: "" },
        isOwned: true,
        x: 0,
        y: 0,
        ...overrides
    };
}

/** happy-dom lays nothing out, so the sizes the positioning reads are given to it directly. */
function sized(el: HTMLElement, width: number, height: number) {
    Object.defineProperty(el, "offsetWidth", { value: width, configurable: true });
    Object.defineProperty(el, "offsetHeight", { value: height, configurable: true });
    return el;
}

function anchoredAt({ left, right, top }: { left: number; right: number; top: number }) {
    const anchor = document.createElement("div");
    anchor.getBoundingClientRect = (() => ({ left, right, top })) as Element["getBoundingClientRect"];
    return anchor;
}

function sizeViewport(width: number, height: number) {
    Object.defineProperty(document.documentElement, "clientWidth", { value: width, configurable: true });
    Object.defineProperty(document.documentElement, "clientHeight", { value: height, configurable: true });
}

function sizeBody(height: number) {
    Object.defineProperty(document.body, "clientHeight", { value: height, configurable: true });
}
