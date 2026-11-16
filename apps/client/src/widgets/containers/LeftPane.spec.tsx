import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

const setupLeftPaneResizer = vi.hoisted(() => vi.fn());
const focusTree = vi.hoisted(() => vi.fn());
/** What the stub tree's `firstRender` returns; `renderTree()` settles it. */
const treeRender = vi.hoisted(() => {
    const state = { firstRender: Promise.resolve(), renderTree: () => {} };
    return state;
});
vi.mock("../../services/resizer", () => ({ default: { setupLeftPaneResizer } }));
vi.mock("../note_tree", async () => {
    const { default: NoteContextAwareWidget } = await import("../note_context_aware_widget");
    return {
        default: class extends NoteContextAwareWidget {
            readonly firstRender = treeRender.firstRender;

            doRender() {
                this.$widget = $(`<div class="tree-stub" tabindex="-1">`);
            }

            isEnabled() {
                return !!this.noteContext;
            }

            focusTreeEvent() {
                focusTree();
            }
        }
    };
});
vi.mock("../quick_search", async () => {
    const { h } = await import("preact");
    return { default: () => h("div", { className: "quick-search-stub" }) };
});

import appContext, { type EventNames } from "../../components/app_context";
import options from "../../services/options";
import { ParentComponent } from "../react/react_utils";
import LeftPane, { useLeftPane } from "./LeftPane";

describe("LeftPane", () => {
    let container: HTMLDivElement;
    let save: MockInstance<typeof options.save>;
    let triggerEvent: MockInstance<typeof appContext.triggerEvent>;

    beforeEach(() => {
        setupLeftPaneResizer.mockClear();
        focusTree.mockClear();
        save = vi.spyOn(options, "save").mockResolvedValue(undefined);
        triggerEvent = vi.spyOn(appContext, "triggerEvent");
        appContext.tabManager = { getActiveContext: () => null } as typeof appContext.tabManager;
    });

    afterEach(async () => {
        // Closes any peek, which detaches its document listeners.
        await trigger("setLeftPaneVisibility", { leftPaneVisible: false });
        act(() => render(null, container));
        document.body.replaceChildren();
        appContext.noteTreeWidget = undefined;
        vi.restoreAllMocks();
    });

    it("moves between modes, persisting only docking, and loads the tree once first shown", async () => {
        await mount(false);
        const host = getHost();
        expect(host.querySelector("#left-pane.peek-pane")).not.toBeNull();
        expect(host.querySelector(":scope > .peek-pane-spacer")).not.toBeNull();
        expect(host.classList.contains("hidden-int")).toBe(true);
        expect(getMainContainer().classList.contains("left-pane-hidden")).toBe(true);
        expect(setupLeftPaneResizer).toHaveBeenLastCalledWith("closed");
        expect(host.querySelector(".tree-stub")).toBeNull();

        // A peek covers the content without reflowing it, and is not persisted.
        await trigger("peekLeftPane", {});
        expect(host.classList.contains("hidden-int")).toBe(false);
        expect(host.classList.contains("peek")).toBe(true);
        expect(getMainContainer().classList.contains("left-pane-hidden")).toBe(true);
        expect(setupLeftPaneResizer).toHaveBeenLastCalledWith("peek");
        expect(save).not.toHaveBeenCalled();
        expect(triggerEvent).toHaveBeenCalledWith("focusTree", {});
        expect(triggerEvent).toHaveBeenCalledWith("paneModeChanged", { pane: "left", mode: "peek" });
        await vi.waitFor(() => expect(host.querySelector("#left-pane .tree-stub")).not.toBeNull());
        expect(appContext.noteTreeWidget).toBeDefined();
        // The tree loads after the peek asked for its focus, and takes it once it has.
        await vi.waitFor(() => expect(focusTree).toHaveBeenCalledTimes(1));

        // "Show panel" docks the peek.
        await trigger("setLeftPaneVisibility", { leftPaneVisible: true });
        expect(host.classList.contains("peek")).toBe(false);
        expect(getMainContainer().classList.contains("left-pane-hidden")).toBe(false);
        expect(setupLeftPaneResizer).toHaveBeenLastCalledWith("docked");
        expect(save).toHaveBeenCalledWith("leftPaneVisible", "true");

        // The toggle closes it, keeps the tree, and moves the focus to the note.
        triggerEvent.mockClear();
        await trigger("setLeftPaneVisibility", { leftPaneVisible: null });
        expect(host.classList.contains("hidden-int")).toBe(true);
        expect(host.querySelector(".tree-stub")).not.toBeNull();
        expect(save).toHaveBeenLastCalledWith("leftPaneVisible", "false");
        expect(triggerEvent).toHaveBeenCalledWith("focusOnDetail", { ntxId: undefined });
        expect(triggerEvent).toHaveBeenCalledWith("paneModeChanged", { pane: "left", mode: "closed" });
    });

    it("starts docked where the option says so, and its peek edge hides it", async () => {
        // The tabs are restored before the tree has loaded, so it missed `activeContextChanged`.
        const activeContext = { ntxId: "main" };
        appContext.tabManager = { getActiveContext: () => activeContext } as unknown as typeof appContext.tabManager;
        await mount(true);
        expect(getHost().classList.contains("hidden-int")).toBe(false);
        expect(getMainContainer().classList.contains("left-pane-hidden")).toBe(false);
        expect(setupLeftPaneResizer).toHaveBeenLastCalledWith("docked");
        await vi.waitFor(() => expect(getHost().querySelector(".tree-stub")).not.toBeNull());
        expect(appContext.noteTreeWidget?.noteContext).toBe(activeContext);
        expect(getHost().querySelector(".tree-stub")?.classList.contains("hidden-int")).toBe(false);
        expect(getHost().querySelector(".quick-search-stub")).toBeNull();

        await trigger("peekLeftPane", {});
        expect(getHost().classList.contains("hidden-int")).toBe(true);
        expect(save).toHaveBeenCalledWith("leftPaneVisible", "false");
    });

    it("peeks only a hidden pane in the vertical layout, which has the quick search", async () => {
        await mount(true, false, false);
        // The box is drawn at once, and the real one takes its place.
        expect(getHost().querySelector("#left-pane .quick-search .search-string-placeholder")).not.toBeNull();
        await vi.waitFor(() => expect(getHost().querySelector("#left-pane .quick-search-stub")).not.toBeNull());
        expect(getHost().querySelector(".search-string-placeholder")).toBeNull();

        triggerEvent.mockClear();
        await trigger("peekLeftPane", {});
        expect(getHost().classList.contains("hidden-int")).toBe(false);
        expect(getHost().classList.contains("peek")).toBe(false);
        expect(triggerEvent).toHaveBeenCalledTimes(1);

        await trigger("setLeftPaneVisibility", { leftPaneVisible: false });
        await trigger("peekLeftPane", {});
        expect(getHost().classList.contains("peek")).toBe(true);
    });

    it("follows the left pane commands that reach it as events", async () => {
        await mount(false);
        await trigger("showLeftPane", {});
        expect(getHost().classList.contains("hidden-int")).toBe(false);
        await trigger("toggleLeftPane", {});
        expect(getHost().classList.contains("hidden-int")).toBe(true);
        await trigger("toggleLeftPane", {});
        await trigger("hideLeftPane", {});
        expect(getHost().classList.contains("hidden-int")).toBe(true);
    });

    it("dismisses a peek on a press outside the tree and its buttons, or on Escape", async () => {
        await mount(false);
        document.body.insertAdjacentHTML("beforeend", `
            <button class="left-pane-peek-button"></button>
            <button class="left-pane-toggle-button"></button>
            <div class="tn-popup tree-settings"><input class="tree-settings-toggle" /></div>
            <div id="rest-pane"></div>
        `);
        const host = getHost();

        await trigger("peekLeftPane", {});
        await vi.waitFor(() => expect(host.querySelector(".tree-stub")).not.toBeNull());
        press(host.querySelector(".tree-stub"));
        press(document.querySelector(".left-pane-peek-button"));
        press(document.querySelector(".left-pane-toggle-button"));
        // The tree settings popup is portaled to the body, outside the pane.
        press(document.querySelector(".tree-settings-toggle"));
        expect(host.classList.contains("peek")).toBe(true);

        // A press on the backdrop dismisses the peek without moving the focus.
        triggerEvent.mockClear();
        press(host.querySelector(".peek-pane-spacer"));
        expect(host.classList.contains("hidden-int")).toBe(true);
        expect(triggerEvent).not.toHaveBeenCalledWith("focusOnDetail", expect.anything());
        expect(save).not.toHaveBeenCalled();

        await trigger("peekLeftPane", {});
        act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
        expect(host.classList.contains("hidden-int")).toBe(true);
        expect(document.activeElement).toBe(document.querySelector(".left-pane-peek-button"));

        // A docked pane is not dismissed.
        await trigger("setLeftPaneVisibility", { leftPaneVisible: true });
        press(document.querySelector("#rest-pane"));
        expect(host.classList.contains("hidden-int")).toBe(false);
    });

    it("moves the focus to the note when its shortcut closes a peek from the tree", async () => {
        await mount(false);
        document.body.insertAdjacentHTML("beforeend", `<button class="left-pane-peek-button"></button>`);
        const peekButton = document.querySelector<HTMLElement>(".left-pane-peek-button");

        await trigger("peekLeftPane", {});
        const tree = await vi.waitFor(() => {
            const tree = getHost().querySelector<HTMLElement>(".tree-stub");
            expect(tree).not.toBeNull();
            return tree;
        });
        tree?.focus();
        expect(document.activeElement).toBe(tree);
        triggerEvent.mockClear();
        await trigger("peekLeftPane", {});
        expect(getHost().classList.contains("hidden-int")).toBe(true);
        expect(triggerEvent).toHaveBeenCalledWith("focusOnDetail", { ntxId: undefined });

        // The peek button closing it keeps the focus.
        await trigger("peekLeftPane", {});
        peekButton?.focus();
        expect(document.activeElement).toBe(peekButton);
        triggerEvent.mockClear();
        await trigger("peekLeftPane", {});
        expect(getHost().classList.contains("hidden-int")).toBe(true);
        expect(triggerEvent).not.toHaveBeenCalledWith("focusOnDetail", expect.anything());
    });

    it("gives its peek up to another pane's, and stays docked", async () => {
        await mount(false);

        await trigger("peekLeftPane", {});
        await trigger("paneModeChanged", { pane: "right", mode: "docked" });
        expect(getHost().classList.contains("peek")).toBe(true);

        await trigger("paneModeChanged", { pane: "right", mode: "peek" });
        expect(getHost().classList.contains("hidden-int")).toBe(true);
        expect(triggerEvent).toHaveBeenLastCalledWith("paneModeChanged", { pane: "left", mode: "closed" });

        await trigger("setLeftPaneVisibility", { leftPaneVisible: true });
        await trigger("paneModeChanged", { pane: "right", mode: "peek" });
        expect(getHost().classList.contains("hidden-int")).toBe(false);
    });

    /** @param settle whether to wait for the lazy modules the first render starts loading. */
    async function mount(docked: boolean, isHorizontalLayout = true, settle = true) {
        options.set("leftPaneVisible", docked.toString());
        container = document.createElement("div");
        document.body.append(container);
        const vnode = (
            <ParentComponent.Provider value={appContext}>
                <Host isHorizontalLayout={isHorizontalLayout} />
            </ParentComponent.Provider>
        );
        if (settle) {
            await act(async () => { render(vnode, container); });
        } else {
            act(() => { render(vnode, container); });
        }
    }
});

describe("noteTreeFirstRender", () => {
    let container: HTMLDivElement;

    afterEach(() => {
        act(() => render(null, container));
        document.body.replaceChildren();
        treeRender.firstRender = Promise.resolve();
        vi.restoreAllMocks();
    });

    /**
     * Renders the pane from fresh modules, as each load of `LeftPane` has its own
     * `noteTreeFirstRender`, and returns that promise, wrapped so that awaiting the call
     * does not wait for it.
     */
    async function mountFresh(docked: boolean) {
        vi.resetModules();
        const [ leftPane, { default: freshAppContext }, { default: freshOptions }, { ParentComponent: FreshParent } ] = await Promise.all([
            import("./LeftPane"),
            import("../../components/app_context"),
            import("../../services/options"),
            import("../react/react_utils")
        ]);
        vi.spyOn(freshOptions, "save").mockResolvedValue(undefined);
        freshOptions.set("leftPaneVisible", docked.toString());
        freshAppContext.tabManager = { getActiveContext: () => null } as typeof freshAppContext.tabManager;
        function FreshHost() {
            const pane = leftPane.useLeftPane(true);
            return <leftPane.default pane={pane} />;
        }
        container = document.createElement("div");
        document.body.append(container);
        await act(async () => {
            render(<FreshParent.Provider value={freshAppContext}><FreshHost /></FreshParent.Provider>, container);
        });
        return { firstRender: leftPane.noteTreeFirstRender };
    }

    /** Whether `promise` has settled by the time the pending tasks have run. */
    async function hasSettled(promise: Promise<void>) {
        return Promise.race([ promise.then(() => true), new Promise((resolve) => setTimeout(() => resolve(false))) ]);
    }

    it("settles as soon as the pane renders closed, since no tree renders then", async () => {
        treeRender.firstRender = new Promise(() => {});
        const { firstRender } = await mountFresh(false);
        expect(await hasSettled(firstRender)).toBe(true);
    });

    it("follows the first render of the tree in a pane that starts open", async () => {
        treeRender.firstRender = new Promise((resolve) => { treeRender.renderTree = resolve; });
        const { firstRender } = await mountFresh(true);
        await vi.waitFor(() => expect(container.querySelector(".tree-stub")).not.toBeNull());
        expect(await hasSettled(firstRender)).toBe(false);

        treeRender.renderTree();
        expect(await hasSettled(firstRender)).toBe(true);
    });

    it("waits for the built tree to be attached to the page, where its entrance animation starts", async () => {
        treeRender.firstRender = Promise.resolve();
        const { firstRender } = await mountFresh(true);
        let attachedAtSettle: boolean | undefined;
        void firstRender.then(() => { attachedAtSettle = !!container.querySelector(".tree-stub"); });
        await vi.waitFor(() => expect(attachedAtSettle).toBeDefined());
        expect(attachedAtSettle).toBe(true);
    });
});

/** Stands in for `DesktopLayout`, which marks the main container while the pane is not docked. */
function Host({ isHorizontalLayout }: { isHorizontalLayout: boolean }) {
    const pane = useLeftPane(isHorizontalLayout);
    return (
        <div id="horizontal-main-container" className={pane.mode !== "docked" ? "left-pane-hidden" : ""}>
            <LeftPane pane={pane} />
        </div>
    );
}

async function trigger<T extends EventNames>(name: T, data: Parameters<typeof appContext.triggerEvent<T>>[1]) {
    await act(async () => { await appContext.triggerEvent(name, data); });
}

function getHost() {
    const host = document.getElementById("left-pane-host");
    if (!host) throw new Error("expected the left pane to render");
    return host;
}

function getMainContainer() {
    const main = document.getElementById("horizontal-main-container");
    if (!main) throw new Error("expected the main container to render");
    return main;
}

function press(target: Element | null | undefined) {
    expect(target).toBeTruthy();
    act(() => { target?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })); });
}
