import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the component import) ---------------------------------------------

vi.mock("../../services/link", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../services/link")>();
    return {
        ...actual,
        default: {
            ...actual.default,
            createLink: vi.fn()
        }
    };
});

import Component from "../../components/component";
import type NoteContext from "../../components/note_context";
import link from "../../services/link";
import froca from "../../services/froca";
import { buildNote } from "../../test/easy-froca";
import { NoteContextContext, ParentComponent } from "./react_utils";
import NoteLink, { NewNoteLink } from "./NoteLink";

// --- Render harness (component inside the Trilium context providers) -------------------------------

interface RenderResult {
    container: HTMLDivElement;
    parent: Component;
    fireEvent: (name: string, data: unknown) => void;
    rerender: (vnode: preact.ComponentChild) => void;
    unmount: () => void;
}

function renderComponent(vnode: preact.ComponentChild, noteContext: NoteContext | null = null): RenderResult {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const parent = new Component();

    const wrap = (node: preact.ComponentChild) => (
        <ParentComponent.Provider value={parent}>
            <NoteContextContext.Provider value={noteContext}>
                {node}
            </NoteContextContext.Provider>
        </ParentComponent.Provider>
    );

    act(() => render(wrap(vnode), container));

    return {
        container,
        parent,
        fireEvent: (name, data) => act(() => {
            (parent.handleEventInChildren as (n: string, d: unknown) => void)(name, data);
        }),
        rerender: (next) => act(() => render(wrap(next), container)),
        unmount: () => act(() => { render(null, container); container.remove(); })
    };
}

/** Settle async effects (the createLink promise) and the resulting re-render. */
async function flush() {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

/** A jQuery `<span><a>...</a></span>` so the component's `.find("a")`/`.css`/`.attr` calls work. */
function makeLinkEl() {
    return $("<span>").append($("<a>", { href: "#root/abc", text: "Link" }));
}

const createLinkMock = link.createLink as ReturnType<typeof vi.fn>;

beforeEach(() => {
    for (const key of Object.keys(froca.notes)) delete froca.notes[key];
    for (const key of Object.keys(froca.attributes)) delete froca.attributes[key];
    for (const key of Object.keys(froca.branches)) delete froca.branches[key];
    vi.clearAllMocks();
    createLinkMock.mockResolvedValue(makeLinkEl());
});

afterEach(async () => {
    await act(async () => {});
    vi.restoreAllMocks();
});

// --- NoteLink (jQuery-backed link) ----------------------------------------------------------------

describe("NoteLink", () => {
    it("creates the link, mounts it into the span and applies default tn-link class", async () => {
        const r = renderComponent(<NoteLink notePath="root/abc" containerClassName="my-container" />);

        expect(createLinkMock).toHaveBeenCalledWith("root/abc", expect.objectContaining({
            title: undefined,
            showNotePath: undefined,
            showNoteIcon: undefined,
            viewScope: undefined
        }));

        await flush();

        const span = r.container.querySelector("span");
        expect(span?.className).toBe("my-container");
        const a = r.container.querySelector("a");
        expect(a).not.toBeNull();
        // Default behaviour adds tn-link, and no opt-out flags were set.
        expect(a?.classList.contains("tn-link")).toBe(true);
        expect(a?.classList.contains("no-tooltip-preview")).toBe(false);
        expect(a?.getAttribute("data-no-context-menu")).toBeNull();
    });

    it("joins an array notePath and derives the noteId from the last segment", async () => {
        renderComponent(<NoteLink notePath={[ "root", "parent", "child" ]} />);
        expect(createLinkMock).toHaveBeenCalledWith("root/parent/child", expect.any(Object));
        await flush();
    });

    it("applies all opt-in/opt-out modifiers and custom className/style to the anchor", async () => {
        const el = makeLinkEl();
        const cssSpy = vi.spyOn(el, "css");
        createLinkMock.mockResolvedValue(el);

        const r = renderComponent(
            <NoteLink
                notePath="root/abc"
                className="extra-cls"
                noPreview
                noTnLink
                noContextMenu
                style={{ color: "red" }}
            />
        );
        await flush();

        const a = r.container.querySelector("a");
        expect(a?.classList.contains("no-tooltip-preview")).toBe(true);
        expect(a?.classList.contains("tn-link")).toBe(false); // noTnLink suppresses it
        expect(a?.classList.contains("extra-cls")).toBe(true);
        expect(a?.getAttribute("data-no-context-menu")).toBe("true");
        expect(cssSpy).toHaveBeenCalledWith({ color: "red" });
    });

    it("registers and removes a contextmenu listener on the created anchor element", async () => {
        // createLink returns a span whose [0] is the element the contextmenu listener attaches to.
        const el = makeLinkEl();
        createLinkMock.mockResolvedValue(el);
        const onContextMenu = vi.fn();

        const r = renderComponent(<NoteLink notePath="root/abc" onContextMenu={onContextMenu} />);
        await flush();

        const outer = el[0];
        outer.dispatchEvent(new Event("contextmenu", { bubbles: true }));
        expect(onContextMenu).toHaveBeenCalledTimes(1);

        // Unmount removes the listener (no further calls after dispatching again).
        r.unmount();
        outer.dispatchEvent(new Event("contextmenu", { bubbles: true }));
        expect(onContextMenu).toHaveBeenCalledTimes(1);
    });

    it("reacts to entitiesReloaded by updating the title when no explicit title is set", async () => {
        const r = renderComponent(<NoteLink notePath="root/abc" />);
        await flush();
        createLinkMock.mockClear();

        r.fireEvent("entitiesReloaded", {
            loadResults: { getEntityRow: (entity: string, id: string) => entity === "notes" && id === "abc" ? { title: "Renamed" } : undefined }
        });
        await flush();

        // The title change triggers a re-create of the link.
        expect(createLinkMock).toHaveBeenCalled();
    });

    it("does NOT react to entitiesReloaded when an explicit title is provided", async () => {
        const r = renderComponent(<NoteLink notePath="root/abc" title="Fixed Title" />);
        await flush();
        createLinkMock.mockClear();

        r.fireEvent("entitiesReloaded", {
            loadResults: { getEntityRow: () => ({ title: "Renamed" }) }
        });
        await flush();

        expect(createLinkMock).not.toHaveBeenCalled();
    });

    it("ignores entitiesReloaded rows that do not match the link's noteId", async () => {
        const r = renderComponent(<NoteLink notePath="root/abc" />);
        await flush();
        createLinkMock.mockClear();

        r.fireEvent("entitiesReloaded", {
            loadResults: { getEntityRow: () => undefined }
        });
        await flush();

        expect(createLinkMock).not.toHaveBeenCalled();
    });

    it("highlights matched tokens passed via highlightedTokens", async () => {
        const el = $("<span>").append($("<a>", { href: "#root/abc", text: "please find this" }));
        createLinkMock.mockResolvedValue(el);

        const r = renderComponent(<NoteLink notePath="root/abc" highlightedTokens={[ "find" ]} />);
        await flush();

        // The anchor was mounted into the container's span.
        expect(r.container.querySelector("a")).not.toBeNull();
    });
});

// --- NewNoteLink (pure Preact anchor) -------------------------------------------------------------

describe("NewNoteLink", () => {
    it("renders an anchor with tn-link, the note title and a hash href", async () => {
        buildNote({ id: "root", title: "Root", children: [ { id: "abcd1234", title: "My Note" } ] });

        const r = renderComponent(<NewNoteLink notePath="root/abcd1234" />);
        await flush();

        const a = r.container.querySelector("a");
        expect(a?.classList.contains("tn-link")).toBe(true);
        expect(a?.getAttribute("href")).toBe("#root/abcd1234");
        expect(a?.textContent).toContain("My Note");
        expect(a?.classList.contains("no-tooltip-preview")).toBe(false);
    });

    it("adds no-tooltip-preview, archived class and the note icon when requested", async () => {
        buildNote({
            id: "root",
            title: "Root",
            children: [ { id: "iconnote12", title: "Icon Note", "#iconClass": "bx bx-star", "#archived": "true" } ]
        });

        const r = renderComponent(<NewNoteLink notePath="root/iconnote12" showNoteIcon noPreview />);
        await flush();

        const a = r.container.querySelector("a");
        expect(a?.classList.contains("no-tooltip-preview")).toBe(true);
        expect(a?.classList.contains("archived")).toBe(true);
        // The icon span is rendered inside the anchor.
        expect(a?.querySelector("span.bx")).not.toBeNull();
    });

    it("encodes a viewScope into the href and forwards data-no-context-menu", async () => {
        buildNote({ id: "root", title: "Root", children: [ { id: "scopednote", title: "Scoped" } ] });

        const r = renderComponent(
            <NewNoteLink notePath="root/scopednote" viewScope={{ viewMode: "source" }} noContextMenu />
        );
        await flush();

        const a = r.container.querySelector("a");
        expect(a?.getAttribute("href")).toContain("viewMode=source");
        expect(a?.getAttribute("data-no-context-menu")).toBe("true");
    });

    it("does not render an icon span when showNoteIcon is omitted", async () => {
        buildNote({ id: "root", title: "Root", children: [ { id: "noiconnote", title: "Plain", "#iconClass": "bx bx-star" } ] });

        const r = renderComponent(<NewNoteLink notePath="root/noiconnote" />);
        await flush();

        const a = r.container.querySelector("a");
        expect(a?.querySelector("span.bx")).toBeNull();
    });
});
