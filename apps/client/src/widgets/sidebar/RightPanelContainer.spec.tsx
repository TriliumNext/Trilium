import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import FNote from "../../entities/fnote";

// The container follows whichever note is being read; the tests hand it one directly.
const shownNote = vi.hoisted(() => ({ current: null as FNote | null }));
// The tabs' names live in tooltips only; Bootstrap's own machinery is not what is under test here.
const useStaticTooltip = vi.hoisted(() => vi.fn());
vi.mock("../react/hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../react/hooks")>()),
    useActiveNoteContext: () => ({ note: shownNote.current }),
    useStaticTooltip
}));

// The tabs' bodies are widgets with specs of their own: bare boxes stand in for them, the strip and
// the choice between the tabs being what is under test here.
vi.mock("./AttributeList", () => stubWidget("attribute-list-stub"));
vi.mock("./TableOfContents", () => stubWidget("toc-stub"));
vi.mock("./HighlightsList", () => stubWidget("highlights-stub"));
vi.mock("./ChatHighlightsList", () => stubWidget("chat-highlights-stub"));
vi.mock("./pdf/PdfPages", () => stubWidget("pdf-pages-stub"));
vi.mock("./pdf/PdfAttachments", () => stubWidget("pdf-attachments-stub"));
vi.mock("./pdf/PdfLayers", () => stubWidget("pdf-layers-stub"));
vi.mock("./pdf/PdfAnnotations", () => stubWidget("pdf-annotations-stub"));
vi.mock("./RightPanePeekButton", () => stubWidget("peek-button-stub"));
vi.mock("../../services/keyboard_actions", () => ({
    default: { getAction: vi.fn().mockResolvedValue({ effectiveShortcuts: [] }) }
}));

async function stubWidget(className: string) {
    const { h } = await import("preact");
    return { default: () => h("div", { className }) };
}

import appContext from "../../components/app_context";
import type Component from "../../components/component";
import type LoadResults from "../../services/load_results";
import options from "../../services/options";
import { buildNote } from "../../test/easy-froca";
import { ParentComponent } from "../react/react_utils";
import RightPanelContainer, { groupIntoTabs, RightPanelWidgetDefinition } from "./RightPanelContainer";
import { RIGHT_PANE_TABS } from "./RightPaneTabs";

describe("groupIntoTabs", () => {
    it("keeps the enabled widgets only, in position order, and drops the tabs left empty", () => {
        const toc = widget("outline");
        const highlights = widget("outline");
        const attributes = widget("attributes");
        const chat = widget("chat", { position: 1000 });

        const tabs = groupIntoTabs([
            // Declared out of order, and with a widget of its own in a tab that ends up empty.
            highlights,
            widget("widgets", { enabled: false }),
            chat,
            attributes,
            toc
        ]);

        expect(tabs.map((tab) => tab.id)).toEqual([ "outline", "attributes", "chat" ]);
        // Positions are handed out in declaration order, so `highlights` precedes `toc`.
        expect(tabs[0].items).toEqual([ highlights.el, toc.el ]);
        expect(tabs[1].items).toEqual([ attributes.el ]);
        expect(tabs[2].items).toEqual([ chat.el ]);
    });

    it("has nothing to show when no widget is enabled", () => {
        expect(groupIntoTabs([ widget("outline", { enabled: false }) ])).toEqual([]);
    });

    it("keeps a tab that asks to stay, empty, so that reading another note does not move the strip", () => {
        const attributes = widget("attributes");
        const tabs = groupIntoTabs([ attributes, widget("outline", { enabled: false }) ], true);

        // The outline is the tab that asks; the chat and the widgets go as they did.
        expect(tabs.map((tab) => tab.id)).toEqual([ "outline", "attributes" ]);
        expect(tabs[0].items).toEqual([]);
        expect(tabs[1].items).toEqual([ attributes.el ]);
    });
});

describe("RightPanelContainer", () => {
    let container: HTMLElement;
    /** What the pane subscribed to, when rendered under a parent component that can tell it. */
    let eventHandlers: Map<string, Set<(data: unknown) => void>>;

    beforeEach(() => {
        vi.clearAllMocks();
        options.set("rightPaneVisible", "true");
        options.set("rightPaneWidth", "25");
        options.set("rightPaneSelectedTab", "attributes");
        options.set("highlightsList", "[]");
        options.set("aiEnabled", "false");
        appContext.tabManager = { getActiveContext: () => null } as typeof appContext.tabManager;
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        render(null, container);
        container.remove();
    });

    it("treats the tab as the window's own: a press writes the choice back, another window's is not followed", () => {
        shownNote.current = buildNote({ title: "Read" });
        renderContainer();

        // A text note offers the outline and the attributes; the pane is on the tab last chosen here.
        expect(shownTabIcons()).toEqual([ icon("outline"), icon("attributes") ]);
        expect(activeTabIcon()).toBe(icon("attributes"));

        // A press of this window's own switches the pane and writes the choice back, which is what
        // a window opened later starts from.
        act(() => {
            tabButton(icon("outline"))?.click();
        });
        expect(activeTabIcon()).toBe(icon("outline"));
        expect(options.get("rightPaneSelectedTab")).toBe("outline");

        // Another window picking a tab of its own arrives as the shared option's change: the cache
        // is rewritten first and the reload announced after, as the sync updater delivers it.
        act(() => {
            options.set("rightPaneSelectedTab", "attributes");
            fireEntitiesReloaded([ "rightPaneSelectedTab" ]);
        });

        // The choice belongs to the window it was made in: this pane stays where it was put.
        expect(activeTabIcon()).toBe(icon("outline"));
    });

    function renderContainer() {
        eventHandlers = new Map();
        const parent = {
            componentId: "pane-cid",
            registerHandler: (name: string, callback: (data: unknown) => void) => {
                if (!eventHandlers.has(name)) {
                    eventHandlers.set(name, new Set());
                }
                eventHandlers.get(name)?.add(callback);
            },
            removeHandler: (name: string, callback: (data: unknown) => void) => {
                eventHandlers.get(name)?.delete(callback);
            }
        } as unknown as Component;
        const widgetsByParent = {
            getLegacyWidgets: () => [],
            getPreactWidgets: () => []
        } as unknown as Parameters<typeof RightPanelContainer>[0]["widgetsByParent"];

        act(() => render(
            <ParentComponent.Provider value={parent}>
                <RightPanelContainer widgetsByParent={widgetsByParent} />
            </ParentComponent.Provider>,
            container
        ));
    }

    /** Hands the pane a reload naming the given options, as a change made in another window arrives. */
    function fireEntitiesReloaded(optionNames: string[]) {
        const loadResults = {
            getOptionNames: () => optionNames,
            isNoteReloaded: () => false
        } as unknown as LoadResults;
        for (const handler of eventHandlers.get("entitiesReloaded") ?? []) {
            handler({ loadResults });
        }
    }

    function tabButton(iconClass: string) {
        return [ ...container.querySelectorAll<HTMLButtonElement>("[role=tab]") ]
            .find((button) => button.querySelector("span")?.className.includes(iconClass));
    }

    /** The strip names no tab in words, so the icon is what tells them apart here. */
    function icon(tabId: string) {
        const tab = RIGHT_PANE_TABS.find((definition) => definition.id === tabId);
        expect(tab, tabId).toBeDefined();
        return tab?.icon ?? "";
    }

    function shownTabIcons() {
        return [ ...container.querySelectorAll("[role=tab] span") ]
            .map((span) => span.className.replace("right-pane-tab-icon tn-icon ", ""));
    }

    function activeTabIcon() {
        const active = container.querySelector("[role=tab][aria-selected=true] span");
        expect(active).not.toBeNull();
        return (active?.className ?? "").replace("right-pane-tab-icon tn-icon ", "");
    }
});

function widget(tab: RightPanelWidgetDefinition["tab"], overrides: Partial<RightPanelWidgetDefinition> = {}) {
    return { el: <div class={tab} />, enabled: true, tab, ...overrides };
}
