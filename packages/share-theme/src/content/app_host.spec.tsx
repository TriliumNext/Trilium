// @vitest-environment happy-dom
import { createContext, render } from "preact";
import { useContext } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ShareAppHost, { type AppPayload, type HostedApp } from "./app_host.js";

const mocks = vi.hoisted(() => ({
    appContext: {
        tabManager: undefined as unknown,
        child: vi.fn(),
        removeChild: vi.fn()
    },
    froca: {
        notes: new Map<string, { noteId: string }>(),
        setSource: vi.fn(),
        addResp: vi.fn(),
        getNoteFromCache: vi.fn(),
        reloadNotes: vi.fn()
    },
    loadOptions: vi.fn(),
    setImageUrlResolver: vi.fn(),
    setShareLinkResolver: vi.fn(),
    shareSource: {
        getNoteLink: (noteId: string) => (noteId === "unlinked" ? null : `./${noteId}`),
        loadNotes: vi.fn()
    },
    staticSource: {
        getNoteLink: (noteId: string) => `../pages/${noteId}.html`,
        getImageUrl: vi.fn(),
        loadNotes: vi.fn()
    },
    createStaticFrocaSource: vi.fn()
}));

vi.mock("@triliumnext/client/src/components/app_context.js", () => ({ default: mocks.appContext }));
vi.mock("@triliumnext/client/src/components/component.js", () => ({ default: class Component {} }));
vi.mock("@triliumnext/client/src/components/tab_manager.js", () => ({
    default: class TabManager {}
}));
vi.mock("@triliumnext/client/src/menus/link_context_menu.js", () => ({
    default: { setShareLinkResolver: mocks.setShareLinkResolver }
}));
vi.mock("@triliumnext/client/src/services/froca.js", () => ({ default: mocks.froca }));
vi.mock("@triliumnext/client/src/services/image_urls.js", () => ({
    setImageUrlResolver: mocks.setImageUrlResolver
}));
vi.mock("@triliumnext/client/src/services/link.js", () => ({
    parseNavigationStateFromUrl: (href: string | undefined) =>
        ({ notePath: href?.replace(/^#/, "") })
}));
vi.mock("@triliumnext/client/src/services/options.js", () => ({
    default: { load: mocks.loadOptions }
}));
vi.mock("@triliumnext/client/src/widgets/react/react_utils.js", () => ({
    ParentComponent: createContext<unknown>(null)
}));
vi.mock("./share_froca_source.js", () => ({
    createShareFrocaSource: () => mocks.shareSource,
    createStaticFrocaSource: mocks.createStaticFrocaSource
}));

const { ParentComponent } = await import("@triliumnext/client/src/widgets/react/react_utils.js");

describe("ShareAppHost", () => {
    let container: HTMLElement;
    let location: { href: string };

    beforeEach(() => {
        container = document.createElement("div");
        document.body.append(container);
        location = { href: "" };
        vi.spyOn(window, "location", "get").mockReturnValue(location as Location);
        mocks.froca.notes.clear();
        mocks.froca.getNoteFromCache.mockImplementation(
            (noteId: string) => mocks.froca.notes.get(noteId));
        mocks.createStaticFrocaSource.mockReturnValue(mocks.staticSource);
        mocks.appContext.tabManager = undefined;
    });

    afterEach(() => {
        act(() => render(null, container));
        container.remove();
        vi.restoreAllMocks();
        vi.clearAllMocks();
    });

    it("loads the payload into froca, read-only, with its orphans below a root", async () => {
        mocks.froca.notes.set("board", { noteId: "board" });
        let app: HostedApp | undefined;
        let parent: unknown;

        mount(buildPayload(), (hosted) => {
            app = hosted;
            return <ParentReader onRead={(value) => { parent = value; }} />;
        });

        expect(mocks.loadOptions).toHaveBeenCalledWith({ theme: "next" });
        expect(mocks.setImageUrlResolver).toHaveBeenCalledWith(undefined);
        expect(mocks.setShareLinkResolver).toHaveBeenCalledWith(mocks.shareSource.getNoteLink);
        const rows = mocks.froca.addResp.mock.calls[0][0];
        expect(rows.notes.map((note: { noteId: string }) => note.noteId))
            .toEqual([ "root", "board", "card", "_template_board" ]);
        expect(rows.branches.map((branch: { branchId: string }) => branch.branchId))
            .toEqual([ "card_board", "root_board" ]);
        expect(rows.attributes.at(-1)).toMatchObject({ noteId: "board", name: "readOnly" });
        expect(app?.note.noteId).toBe("board");
        expect(app?.parentNoteId).toBe("parent");
        expect(parent).toBe(mocks.appContext.child.mock.calls[1][0]);

        // The source anchors the notes it loads later the same way, now that froca has a root.
        mocks.froca.notes.set("root", { noteId: "root" });
        mocks.shareSource.loadNotes.mockResolvedValue({
            notes: [ { noteId: "later" } ], branches: [], attributes: []
        });
        const source = mocks.froca.setSource.mock.calls[0][0];
        expect(await source.loadNotes([ "later" ])).toMatchObject({
            notes: [ { noteId: "later" } ],
            branches: [ { branchId: "root_later", parentNoteId: "root" } ]
        });

        app?.openNote("card");
        expect(location.href).toBe("./card");
        app?.openNote("unlinked");
        expect(location.href).toBe("./card");
        expect(app?.hasLink("unlinked")).toBe(false);
    });

    it("starts one tab manager for the views and lets go of their component on unmount", () => {
        mocks.froca.notes.set("board", { noteId: "board" });

        mount(buildPayload(), () => null);
        const tabManager = mocks.appContext.tabManager;
        act(() => render(null, container));
        mount(buildPayload(), () => null);

        expect(tabManager).toBeDefined();
        expect(mocks.appContext.tabManager).toBe(tabManager);
        expect(mocks.appContext.removeChild).toHaveBeenCalledOnce();
    });

    it("opens a clicked link into the note tree on the note's shared page", () => {
        mocks.froca.notes.set("board", { noteId: "board" });
        mount(buildPayload(), () => (
            <>
                <span className="reference-link" data-href="#root/board/card"><b>Card</b></span>
                <a href="#root/unlinked">Unlinked</a>
                <a href="https://example.com">External</a>
            </>
        ));

        const click = (element: Element | null) => {
            const event = new MouseEvent("click", { bubbles: true, cancelable: true });
            element?.dispatchEvent(event);
            return event.defaultPrevented;
        };

        expect(click(container.querySelector("b"))).toBe(true);
        expect(location.href).toBe("./card");
        expect(click(container.querySelector("a[href^='#']"))).toBe(false);
        expect(click(container.querySelector("a[href^='https']"))).toBe(false);
    });

    it("reads a static export's notes before it mounts the views", async () => {
        mocks.froca.notes.set("board", { noteId: "board" });
        let resolveReload = () => {};
        mocks.froca.reloadNotes.mockReturnValue(
            new Promise<void>((resolve) => { resolveReload = resolve; }));

        mount({ ...buildPayload(), exportBasePath: "../" }, () => <p className="view" />);

        expect(mocks.createStaticFrocaSource).toHaveBeenCalledWith({ board: "./board" }, "../");
        expect(mocks.setImageUrlResolver).toHaveBeenCalledWith(mocks.staticSource.getImageUrl);
        expect(mocks.froca.reloadNotes).toHaveBeenCalledWith([ "board" ]);
        expect(container.querySelector(".view")).toBeNull();

        await act(async () => resolveReload());
        expect(container.querySelector(".view")).not.toBeNull();
    });

    it("mounts nothing, nor follows links, when froca has no note to show", () => {
        const children = vi.fn(() => null);

        mount(buildPayload(), children);
        const event = new MouseEvent("click", { bubbles: true, cancelable: true });
        document.body.dispatchEvent(event);

        expect(children).not.toHaveBeenCalled();
        expect(event.defaultPrevented).toBe(false);
    });

    function mount(payload: AppPayload, children: (app: HostedApp) => preact.ComponentChildren) {
        act(() => render(
            <ShareAppHost noteId="board" payload={payload}>{children}</ShareAppHost>,
            container
        ));
    }
});

function ParentReader({ onRead }: { onRead(value: unknown): void }) {
    onRead(useContext(ParentComponent));
    return null;
}

function buildPayload(): AppPayload {
    return {
        notes: [ { noteId: "board" }, { noteId: "card" }, { noteId: "_template_board" } ],
        branches: [ { branchId: "card_board", noteId: "card", parentNoteId: "board" } ],
        attributes: [],
        links: { board: "./board" },
        options: { theme: "next", locale: null },
        assetPath: "",
        parentNoteId: "parent"
    } as unknown as AppPayload;
}
