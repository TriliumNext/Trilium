import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

const setupLeftPaneResizer = vi.hoisted(() => vi.fn());
vi.mock("../../services/resizer.js", () => ({ default: { setupLeftPaneResizer } }));

import appContext from "../../components/app_context";
import options from "../../services/options";
import FlexContainer from "./flex_container";
import LeftPaneContainer from "./left_pane_container";

describe("LeftPaneContainer", () => {
    let container: LeftPaneContainer;
    let parent: FlexContainer<LeftPaneContainer>;
    let save: MockInstance<typeof options.save>;
    let triggerEvent: MockInstance<LeftPaneContainer["triggerEvent"]>;

    beforeEach(() => {
        setupLeftPaneResizer.mockClear();
        save = vi.spyOn(options, "save").mockResolvedValue(undefined);
        appContext.tabManager = { getActiveContext: () => null } as typeof appContext.tabManager;
    });

    afterEach(() => {
        // Closes any peek, which detaches its document listeners.
        container.setLeftPaneVisibilityEvent({ leftPaneVisible: false });
        document.body.innerHTML = "";
        vi.restoreAllMocks();
    });

    it("hosts the pane's children and moves between modes, persisting only docking", () => {
        mount(false);

        const host = container.$widget;
        expect(host.attr("id")).toBe("left-pane-host");
        expect(host.children("#left-pane.peek-pane").children(".tree-stub")).toHaveLength(1);
        expect(host.children(".peek-pane-spacer")).toHaveLength(1);
        expect(host.hasClass("hidden-int")).toBe(true);
        expect(parent.$widget.hasClass("left-pane-hidden")).toBe(true);
        expect(setupLeftPaneResizer).toHaveBeenLastCalledWith("closed");

        // A peek covers the content without reflowing it, and is not persisted.
        container.peekLeftPaneEvent();
        expect(host.hasClass("hidden-int")).toBe(false);
        expect(host.hasClass("peek")).toBe(true);
        expect(parent.$widget.hasClass("left-pane-hidden")).toBe(true);
        expect(setupLeftPaneResizer).toHaveBeenLastCalledWith("peek");
        expect(save).not.toHaveBeenCalled();
        expect(triggerEvent).toHaveBeenCalledWith("focusTree", {});
        expect(triggerEvent).toHaveBeenCalledWith(
            "paneModeChanged", { pane: "left", mode: "peek" }
        );

        // "Show panel" docks the peek.
        container.setLeftPaneVisibilityEvent({ leftPaneVisible: true });
        expect(host.hasClass("peek")).toBe(false);
        expect(parent.$widget.hasClass("left-pane-hidden")).toBe(false);
        expect(setupLeftPaneResizer).toHaveBeenLastCalledWith("docked");
        expect(save).toHaveBeenCalledWith("leftPaneVisible", "true");

        // The toggle closes it, and moves the focus to the note.
        triggerEvent.mockClear();
        container.setLeftPaneVisibilityEvent({ leftPaneVisible: null });
        expect(host.hasClass("hidden-int")).toBe(true);
        expect(save).toHaveBeenLastCalledWith("leftPaneVisible", "false");
        expect(triggerEvent).toHaveBeenCalledWith("focusOnDetail", { ntxId: undefined });
        expect(triggerEvent).toHaveBeenCalledWith(
            "paneModeChanged", { pane: "left", mode: "closed" }
        );
    });

    it("starts docked where the option says so, and its peek edge hides it", () => {
        mount(true);

        expect(container.$widget.hasClass("hidden-int")).toBe(false);
        expect(parent.$widget.hasClass("left-pane-hidden")).toBe(false);
        expect(setupLeftPaneResizer).toHaveBeenLastCalledWith("docked");

        container.peekLeftPaneEvent();
        expect(container.$widget.hasClass("hidden-int")).toBe(true);
        expect(save).toHaveBeenCalledWith("leftPaneVisible", "false");
    });

    it("peeks only a hidden pane in the vertical layout", () => {
        mount(true, false);

        container.peekLeftPaneEvent();
        expect(container.$widget.hasClass("hidden-int")).toBe(false);
        expect(container.$widget.hasClass("peek")).toBe(false);
        expect(triggerEvent).not.toHaveBeenCalled();

        container.setLeftPaneVisibilityEvent({ leftPaneVisible: false });
        container.peekLeftPaneEvent();
        expect(container.$widget.hasClass("peek")).toBe(true);
    });

    it("dismisses a peek on a press outside the tree and its buttons, or on Escape", () => {
        mount(false);
        document.body.insertAdjacentHTML("beforeend", `
            <button class="left-pane-peek-button"></button>
            <button class="left-pane-toggle-button"></button>
            <div class="tn-popup tree-settings"><input class="tree-settings-toggle" /></div>
            <div id="rest-pane"></div>
        `);
        const host = container.$widget;

        container.peekLeftPaneEvent();
        press(host.find(".tree-stub")[0]);
        press(document.querySelector(".left-pane-peek-button"));
        press(document.querySelector(".left-pane-toggle-button"));
        // The tree settings popup is portaled to the body, outside the pane.
        press(document.querySelector(".tree-settings-toggle"));
        expect(host.hasClass("peek")).toBe(true);

        // A press on the backdrop dismisses the peek without moving the focus.
        triggerEvent.mockClear();
        press(host.children(".peek-pane-spacer")[0]);
        expect(host.hasClass("hidden-int")).toBe(true);
        expect(triggerEvent).not.toHaveBeenCalledWith("focusOnDetail", expect.anything());
        expect(save).not.toHaveBeenCalled();

        container.peekLeftPaneEvent();
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        expect(host.hasClass("hidden-int")).toBe(true);
        expect(document.activeElement).toBe(document.querySelector(".left-pane-peek-button"));

        // A docked pane is not dismissed.
        container.setLeftPaneVisibilityEvent({ leftPaneVisible: true });
        press(document.querySelector("#rest-pane"));
        expect(host.hasClass("hidden-int")).toBe(false);
    });

    it("moves the focus to the note when its shortcut closes a peek from the tree", () => {
        mount(false);
        document.body.insertAdjacentHTML(
            "beforeend", `<button class="left-pane-peek-button"></button>`
        );
        const tree = container.$widget.find(".tree-stub")[0];
        const peekButton = document.querySelector<HTMLElement>(".left-pane-peek-button");
        tree.tabIndex = -1;

        container.peekLeftPaneEvent();
        tree.focus();
        expect(document.activeElement).toBe(tree);
        triggerEvent.mockClear();
        container.peekLeftPaneEvent();
        expect(container.$widget.hasClass("hidden-int")).toBe(true);
        expect(triggerEvent).toHaveBeenCalledWith("focusOnDetail", { ntxId: undefined });

        // The peek button closing it keeps the focus.
        container.peekLeftPaneEvent();
        peekButton?.focus();
        expect(document.activeElement).toBe(peekButton);
        triggerEvent.mockClear();
        container.peekLeftPaneEvent();
        expect(container.$widget.hasClass("hidden-int")).toBe(true);
        expect(triggerEvent).not.toHaveBeenCalledWith("focusOnDetail", expect.anything());
    });

    it("gives its peek up to another pane's, and stays docked", () => {
        mount(false);
        const host = container.$widget;

        container.peekLeftPaneEvent();
        container.paneModeChangedEvent({ pane: "left", mode: "peek" });
        container.paneModeChangedEvent({ pane: "right", mode: "docked" });
        expect(host.hasClass("peek")).toBe(true);

        container.paneModeChangedEvent({ pane: "right", mode: "peek" });
        expect(host.hasClass("hidden-int")).toBe(true);
        expect(triggerEvent).toHaveBeenLastCalledWith(
            "paneModeChanged", { pane: "left", mode: "closed" }
        );

        container.setLeftPaneVisibilityEvent({ leftPaneVisible: true });
        container.paneModeChangedEvent({ pane: "right", mode: "peek" });
        expect(host.hasClass("hidden-int")).toBe(false);
    });

    function mount(docked: boolean, isHorizontalLayout = true) {
        options.set("leftPaneVisible", docked.toString());
        container = new LeftPaneContainer(isHorizontalLayout);
        container.child(new FlexContainer("column").class("tree-stub"));
        parent = new FlexContainer<LeftPaneContainer>("row").child(container);
        document.body.append(parent.render()[0]);
        triggerEvent = vi.spyOn(container, "triggerEvent");
        container.initialRenderCompleteEvent();
    }
});

function press(target: Element | null | undefined) {
    expect(target).toBeTruthy();
    target?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
}
