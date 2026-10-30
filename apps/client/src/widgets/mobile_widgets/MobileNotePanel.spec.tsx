import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type FNote from "../../entities/fnote";

const shownNote = vi.hoisted(() => ({ current: null as FNote | null }));
const shownContext = vi.hoisted(() => ({ current: null as { isCommandTarget: (ntxId?: string | null) => boolean } | null }));
vi.mock("../react/hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../react/hooks")>()),
    useActiveNoteContext: () => ({ note: shownNote.current }),
    useNoteContext: () => ({ note: shownNote.current, noteContext: shownContext.current }),
    useStaticTooltip: vi.fn()
}));

// Renders its children by `Modal`'s own rule (`show || keepInDom`) and hands out `onHidden`, so that
// closing the panel needs no Bootstrap.
const modal = vi.hoisted(() => ({ onHidden: null as (() => void) | null }));
vi.mock("../react/master_detail", async () => {
    const { h } = await import("preact");
    return {
        MasterDetailModal: ({ show, keepInDom, onHidden, children }: {
            show: boolean, keepInDom?: boolean, onHidden: () => void, children: preact.ComponentChildren
        }) => {
            modal.onHidden = onHidden;
            return (show || keepInDom) ? h("div", { className: "modal-stub" }, children) : null;
        }
    };
});

vi.mock("../sidebar/AttributeList", () => stubWidget("attribute-list-stub"));
vi.mock("../sidebar/TableOfContents", () => stubWidget("toc-stub"));
vi.mock("../sidebar/HighlightsList", () => stubWidget("highlights-stub"));
vi.mock("../sidebar/NoteMap", () => stubWidget("note-map-stub"));
vi.mock("../sidebar/NotePaths", () => stubWidget("note-paths-stub"));
vi.mock("../sidebar/Backlinks", () => stubWidget("backlinks-stub"));
vi.mock("../sidebar/BoardColumns", () => stubWidget("board-columns-stub"));
vi.mock("../sidebar/ChatHighlightsList", () => stubWidget("chat-highlights-stub"));
vi.mock("../sidebar/pdf/PdfPages", () => stubWidget("pdf-pages-stub"));
vi.mock("../sidebar/pdf/PdfAttachments", () => stubWidget("pdf-attachments-stub"));
vi.mock("../sidebar/pdf/PdfLayers", () => stubWidget("pdf-layers-stub"));
vi.mock("../sidebar/pdf/PdfAnnotations", () => stubWidget("pdf-annotations-stub"));

async function stubWidget(className: string) {
    const { h } = await import("preact");
    return { default: () => h("div", { className }) };
}

import appContext from "../../components/app_context";
import type Component from "../../components/component";
import options from "../../services/options";
import { buildNote } from "../../test/easy-froca";
import { ParentComponent } from "../react/react_utils";
import NoteMap from "../sidebar/NoteMap";
import PdfPages from "../sidebar/pdf/PdfPages";
import type { RightPaneTabContents } from "../sidebar/RightPanelContainer";
import MobileNotePanel, { withFixedHeightWidgetsLast } from "./MobileNotePanel";

describe("withFixedHeightWidgetsLast", () => {
    it("moves the note map and the PDF pages last, keeping the order within each group", () => {
        const first = <div key="first" />;
        const second = <div key="second" />;
        const map = <NoteMap key="map" />;
        const pages = <PdfPages key="pages" />;
        const tab = (items: RightPaneTabContents["items"]) => ({ id: "outline", items } as RightPaneTabContents);

        expect(withFixedHeightWidgetsLast(tab([ pages, first, map, second ])).items)
            .toEqual([ first, second, pages, map ]);
        expect(withFixedHeightWidgetsLast(tab([ map ])).items).toEqual([ map ]);
        expect(withFixedHeightWidgetsLast(tab([])).items).toEqual([]);
    });
});

describe("MobileNotePanel", () => {
    let container: HTMLElement;

    beforeEach(() => {
        options.set("highlightsList", "[]");
        options.set("aiEnabled", "false");
        appContext.tabManager = { getActiveContext: () => null } as typeof appContext.tabManager;
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        shownContext.current = null;
        act(() => render(null, container));
        container.remove();
        for (const stub of document.body.querySelectorAll(".modal-stub")) stub.remove();
    });

    it("mounts the tabs on the first open and keeps them mounted once closed", () => {
        shownNote.current = buildNote({ title: "Read" });
        renderPanel();
        expect(document.body.querySelector(".toc-stub")).toBeNull();

        const button = container.querySelector("button");
        expect(button).not.toBeNull();
        act(() => button?.click());
        expect(document.body.querySelector(".toc-stub")).not.toBeNull();

        act(() => modal.onHidden?.());
        expect(document.body.querySelector(".toc-stub")).not.toBeNull();
    });

    it("opens on the attributes tab when the attributes are asked for in its own note context only", () => {
        shownNote.current = buildNote({ title: "Read" });
        shownContext.current = { isCommandTarget: (ntxId) => ntxId === "ntx1" };
        const handlers = renderPanel();
        const showNoteAttributes = handlers.get("showNoteAttributes");
        expect(showNoteAttributes).toBeDefined();

        act(() => showNoteAttributes?.({ ntxId: "ntx2" }));
        expect(document.body.querySelector(".modal-stub")).toBeNull();

        act(() => showNoteAttributes?.({ ntxId: "ntx1" }));
        const attributesTab = document.body.querySelector(".right-pane-flat-tab-body[data-tab-id='attributes']");
        expect(attributesTab?.classList.contains("hidden-ext")).toBe(false);
        expect(attributesTab?.querySelector(".attribute-list-stub")).not.toBeNull();
        expect(document.body.querySelector(".toc-stub")).toBeNull();
    });

    /** Renders the panel, returning the event handlers it registers by event name. */
    function renderPanel() {
        const handlers = new Map<string, (data: unknown) => void>();
        const parent = {
            componentId: "cid",
            registerHandler: (name: string, handler: (data: unknown) => void) => handlers.set(name, handler),
            removeHandler: (name: string, handler: (data: unknown) => void) => {
                if (handlers.get(name) === handler) handlers.delete(name);
            }
        } as unknown as Component;
        const widgetsByParent = { getLegacyWidgets: () => [], getPreactWidgets: () => [] };
        act(() => {
            render((
                <ParentComponent.Provider value={parent}>
                    <MobileNotePanel widgetsByParent={widgetsByParent as never} />
                </ParentComponent.Provider>
            ), container);
        });
        return handlers;
    }
});
