import type { CursorPosition } from "@triliumnext/codemirror";
import type { NoteType } from "@triliumnext/commons";
import { Tooltip } from "bootstrap";
import { render, type VNode } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import FNote from "../../entities/fnote";

// The bar follows whichever note is being read; the tests hand it one directly, along with the tab it
// is read in — neither of which a rendered widget brings with it.
const shownNote = vi.hoisted(() => ({ current: null as FNote | null }));
const contextData = vi.hoisted(() => new Map<string, unknown>());
vi.mock("../react/hooks", async (importOriginal) => {
    const noteContext = { ntxId: "ntx1", getContextData: (key: string) => contextData.get(key) };
    return {
        ...(await importOriginal<typeof import("../react/hooks")>()),
        useActiveNoteContext: () => ({
            note: shownNote.current,
            noteContext,
            hoistedNoteId: "root"
        })
    };
});

// i18next is not initialized under test, so `t()` returns the key and the stub renders the
// components of `Trans` in order.
vi.mock("../../services/i18n", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../services/i18n")>()),
    t: (key: string) => key
}));
vi.mock("react-i18next", async (importOriginal) => ({
    ...(await importOriginal<typeof import("react-i18next")>()),
    Trans: ({ i18nKey, components }: { i18nKey: string; components: Record<string, VNode> }) => (
        <span data-i18n-key={i18nKey}>{Object.values(components)}</span>
    )
}));

// The attributes panel builds its editor on CKEditor, which is a legacy widget wanting a real parent
// component to be a child of. What the panel is here is a panel that is up or is not.
const editorProps = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
vi.mock("../attribute_widgets/AttributeEditor", async () => {
    const { h } = await import("preact");

    return {
        default: (props: Record<string, unknown>) => {
            editorProps.current = props;
            return h("div", { class: "attribute-editor-stub" });
        }
    };
});

import appContext from "../../components/app_context";
import type Component from "../../components/component";
import server from "../../services/server";
import { buildNote } from "../../test/easy-froca";
import { ParentComponent } from "../react/react_utils";
import StatusBar, { useAttributeCount } from "./StatusBar";

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
        contextData.clear();
    });

    it("opens the similar notes panel on the keyboard action, and puts it away on a second press", () => {
        renderBar();
        expect(container.querySelector(".similar-notes-pane")).toBeNull();

        fire("toggleRibbonTabSimilarNotes");
        // The panel carries the list, which is the whole point of the action reaching the bar at all.
        expect(container.querySelector(".similar-notes-pane .similar-notes-widget")).not.toBeNull();
        expect(document.body.classList.contains("status-bar-panel-open")).toBe(true);

        fire("toggleRibbonTabSimilarNotes");
        expect(container.querySelector(".similar-notes-pane")).toBeNull();
        expect(document.body.classList.contains("status-bar-panel-open")).toBe(false);
    });

    it("removes the body class when unmounted with a panel open", () => {
        renderBar();
        fire("toggleRibbonTabSimilarNotes");
        expect(document.body.classList.contains("status-bar-panel-open")).toBe(true);

        act(() => render(null, container));
        expect(document.body.classList.contains("status-bar-panel-open")).toBe(false);
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

    it("hands the shortcut that opens the attributes panel to the editor it mounts", () => {
        renderBar();
        fire("addNewRelation");

        expect(isShown(".attribute-list")).toBe(true);
        expect(editorProps.current?.initialCommand).toBe("addNewRelation");
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

    it("offers no attributes panel for a note that cannot be edited, not even on the shortcut", () => {
        renderBar(false);
        expect(container.querySelector(".attributes-button")).toBeNull();

        fire("addNewLabel");
        expect(container.querySelector(".attribute-editor-stub")).toBeNull();
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

    it("shows the cursor position of a code note first in the row, and follows the cursor", () => {
        let report: ((position: CursorPosition) => void) | undefined;
        const unsubscribe = vi.fn();
        contextData.set("codeEditor", {
            addCursorPositionListener(listener: (position: CursorPosition) => void) {
                report = listener;
                listener({ line: 12, column: 32, selectionLength: 0 });
                return unsubscribe;
            }
        });
        // Each part is an element of its own, so the gap of the row falls between the parts.
        const getParts = () => {
            const parts = container.querySelectorAll(".cursor-position > * > [data-i18n-key]");
            return [ ...parts ].map((part) => [
                part.getAttribute("data-i18n-key"),
                part.querySelector(".value")?.textContent
            ]);
        };
        const getTooltip = (index: number) => {
            const part = container.querySelectorAll(".cursor-position > *")[index];
            return part ? Tooltip.getInstance(part) : null;
        };
        const getTooltipText = (index: number) => {
            const tooltip = getTooltip(index);
            tooltip?.show();
            const text = document.querySelector(".tooltip-inner")?.textContent;
            tooltip?.hide();
            return text;
        };

        renderBar(true, "code");
        const position = container.querySelector(".actions-row > .cursor-position");
        expect(position).not.toBeNull();
        expect(position?.previousElementSibling).toBeNull();
        expect(getParts()).toEqual([
            [ "status_bar.cursor_line", "12" ],
            [ "status_bar.cursor_column", "32" ]
        ]);

        const lineTooltip = getTooltip(0);
        expect(lineTooltip).not.toBeNull();
        act(() => report?.({ line: 3, column: 1, selectionLength: 120 }));
        expect(getParts()).toEqual([
            [ "status_bar.cursor_line", "3" ],
            [ "status_bar.cursor_column", "1" ],
            [ "status_bar.cursor_selection", "120" ]
        ]);
        expect(getTooltip(0)).toBe(lineTooltip);
        expect([ 0, 1, 2 ].map(getTooltipText)).toEqual([
            "status_bar.cursor_line_title",
            "status_bar.cursor_column_title",
            "status_bar.cursor_selection_title"
        ]);
        act(() => report?.({ line: 3, column: 1, selectionLength: 0 }));
        expect(getParts().map(([ key ]) => key)).not.toContain("status_bar.cursor_selection");

        act(() => render(null, container));
        expect(unsubscribe).toHaveBeenCalled();
        renderBar(true, "text");
        expect(container.querySelector(".actions-row")).not.toBeNull();
        expect(container.querySelector(".cursor-position")).toBeNull();
    });

    function renderBar(isContentWritable = true, type: NoteType = "text") {
        shownNote.current = buildNote({ id: "note1", title: "A note", type });
        shownNote.current.isContentWritable = isContentWritable;
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

    it("counts the attributes of a note, leaving out the links its content makes", () => {
        const target = buildNote({ title: "Target" });
        const note = buildNote({ title: "Counted", "#color": "red", "~template": target.noteId, "~internalLink": target.noteId });
        function Count() {
            return <span className="count">{useAttributeCount(note)}</span>;
        }
        const parent = { registerHandler: () => {}, removeHandler: () => {} } as unknown as Component;
        act(() => render(<ParentComponent.Provider value={parent}><Count /></ParentComponent.Provider>, container));
        expect(container.querySelector(".count")?.textContent).toBe("2");
    });

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
