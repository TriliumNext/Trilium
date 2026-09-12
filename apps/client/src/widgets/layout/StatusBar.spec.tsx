import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import FNote from "../../entities/fnote";

// The bar follows whichever note is being read; the tests hand it one directly, along with the tab it
// is read in — neither of which a rendered widget brings with it.
const shownNote = vi.hoisted(() => ({ current: null as FNote | null }));
vi.mock("../react/hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../react/hooks")>()),
    useActiveNoteContext: () => ({
        note: shownNote.current,
        noteContext: { ntxId: "ntx1" },
        hoistedNoteId: "root"
    })
}));

// The attributes panel builds its editor on CKEditor, which is a legacy widget wanting a real parent
// component to be a child of. What the panel is here is a panel that is up or is not.
vi.mock("../ribbon/components/AttributeEditor", async () => {
    const { h } = await import("preact");

    return { default: () => h("div", { class: "attribute-editor-stub" }) };
});

import appContext from "../../components/app_context";
import type Component from "../../components/component";
import server from "../../services/server";
import { buildNote } from "../../test/easy-froca";
import { ParentComponent } from "../react/react_utils";
import StatusBar from "./StatusBar";

describe("StatusBar panels", () => {
    let container: HTMLElement;
    let eventHandlers: Map<string, (data: unknown) => void>;

    beforeEach(() => {
        // The badges count what they stand for as the bar is built — attachments, similar notes — and
        // a note with none of either is one fewer thing standing between the panels and the assertion.
        server.get = (async () => []) as unknown as typeof server.get;
        appContext.tabManager = { getActiveContext: () => null } as typeof appContext.tabManager;
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        render(null, container);
        container.remove();
    });

    it("opens the similar notes panel on the keyboard action, and puts it away on a second press", () => {
        renderBar();
        expect(container.querySelector(".similar-notes-pane")).toBeNull();

        fire("toggleRibbonTabSimilarNotes");
        // The panel carries the list, which is the whole point of the action reaching the bar at all.
        expect(container.querySelector(".similar-notes-pane .similar-notes-widget")).not.toBeNull();
        expect(container.querySelector(".status-bar")?.className).toContain("status-bar-panel-open");

        fire("toggleRibbonTabSimilarNotes");
        expect(container.querySelector(".similar-notes-pane")).toBeNull();
        expect(container.querySelector(".status-bar")?.className).not.toContain("status-bar-panel-open");
    });

    it("shows one panel at a time, the newer taking the place of the one already open", () => {
        renderBar();

        fire("toggleRibbonTabOwnedAttributes");
        expect(isShown(".attribute-list")).toBe(true);
        expect(container.querySelector(".similar-notes-pane")).toBeNull();

        fire("toggleRibbonTabSimilarNotes");
        expect(container.querySelector(".similar-notes-pane")).not.toBeNull();
        expect(isShown(".attribute-list")).toBe(false);
    });

    it("offers the attributes panel a way to the sidebar's own, and steps aside once taken", () => {
        const triggerEvent = vi.spyOn(appContext, "triggerEvent").mockResolvedValue(undefined);
        renderBar();
        fire("toggleRibbonTabOwnedAttributes");

        const sidebarLink = container.querySelector<HTMLElement>(".attribute-list .bottom-panel-title-bar .status-bar-sidebar-link");
        expect(sidebarLink).not.toBeNull();

        act(() => sidebarLink?.click());
        expect(triggerEvent).toHaveBeenCalledWith("selectRightPaneTab", { tabId: "attributes", peek: true });
        // Two attribute editors over the one note is what the way across is for the reader to avoid.
        expect(isShown(".attribute-list")).toBe(false);
    });

    it("closes the similar notes panel from its own title bar", () => {
        renderBar();
        fire("toggleRibbonTabSimilarNotes");

        // Looked up and vouched for before the press: a panel that never opened has no close button
        // either, and the assertion below would then hold for the wrong reason.
        const closeButton = container.querySelector<HTMLElement>(".similar-notes-pane .bottom-panel-title-bar .bx-x");
        expect(closeButton).not.toBeNull();

        act(() => closeButton?.click());
        expect(container.querySelector(".similar-notes-pane")).toBeNull();
    });

    function renderBar() {
        shownNote.current = buildNote({ id: "note1", title: "A note" });
        eventHandlers = new Map();
        const parent = {
            componentId: "status-bar-cid",
            registerHandler: (name: string, callback: (data: unknown) => void) => eventHandlers.set(name, callback),
            removeHandler: () => {}
        } as unknown as Component;

        act(() => render(
            <ParentComponent.Provider value={parent}>
                <StatusBar />
            </ParentComponent.Provider>,
            container
        ));
    }

    /** Hands the bar one of the keyboard actions it listens for, as the app's event bus would. */
    function fire(eventName: string) {
        act(() => eventHandlers.get(eventName)?.({}));
    }

    /** A panel that is always rendered says whether it is up through a class rather than by absence. */
    function isShown(selector: string) {
        const panel = container.querySelector(selector);
        expect(panel).not.toBeNull();
        return !panel?.className.includes("hidden-ext");
    }
});
