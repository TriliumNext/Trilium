import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import options from "../../services/options";
import server from "../../services/server";
import RightPanelWidget, { CollapsibleWidgets, ExpandWidgetRequest, ExpandWidgetRequests } from "./RightPanelWidget";

describe("RightPanelWidget", () => {
    let container: HTMLElement;

    beforeEach(() => {
        // Both widgets below are remembered as collapsed, which only one of them is free to honour.
        options.set("rightPaneCollapsedItems", JSON.stringify([ "solitary", "shared" ]));
        server.put = vi.fn(async () => ({})) as typeof server.put;
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        render(null, container);
        container.remove();
    });

    it("offers no collapsing when it is the only widget of its tab, remembered collapse and all", async () => {
        await act(async () => render(
            <CollapsibleWidgets.Provider value={false}>
                <RightPanelWidget id="solitary" title="Attributes">the body</RightPanelWidget>
            </CollapsibleWidgets.Provider>, container));

        expect(container.querySelector(".card-header > .icon-action")).toBeNull();
        expect(container.querySelector(".card")?.className).toContain("not-collapsible");
        // Expanded despite being remembered as collapsed: with no chevron there is no way back.
        expect(container.querySelector(".card-body")?.textContent).toBe("the body");

        // And its header is not something to press.
        await act(async () => container.querySelector<HTMLElement>(".card-header")?.click());
        expect(container.querySelector(".card-body")).not.toBeNull();
    });

    it("collapses, and expands again, on a press of its header when it shares its tab", async () => {
        await act(async () => render(
            <CollapsibleWidgets.Provider value={true}>
                <RightPanelWidget id="shared" title="Table of Contents">the body</RightPanelWidget>
            </CollapsibleWidgets.Provider>, container));

        // Starts collapsed, as it was remembered.
        expect(container.querySelector(".card")?.className).toContain("collapsed");
        expect(container.querySelector(".card-body")).toBeNull();
        expect(container.querySelector(".card-header > .icon-action")).not.toBeNull();

        await act(async () => container.querySelector<HTMLElement>(".card-header")?.click());
        expect(container.querySelector(".card")?.className).not.toContain("collapsed");
        expect(container.querySelector(".card-body")?.textContent).toBe("the body");

        await act(async () => container.querySelector<HTMLElement>(".card-header")?.click());
        expect(container.querySelector(".card-body")).toBeNull();
    });

    it("expands on a request for it by name, and remembers it, but leaves the other widgets alone", async () => {
        const renderWith = async (request: ExpandWidgetRequest | null) => act(async () => render(
            <ExpandWidgetRequests.Provider value={request}>
                <RightPanelWidget id="shared" title="Note Paths">the body</RightPanelWidget>
                <RightPanelWidget id="solitary" title="Backlinks">the other body</RightPanelWidget>
            </ExpandWidgetRequests.Provider>, container));
        const card = (id: string) => container.querySelector(`#${id}`);

        // Asked for on the very first render, i.e. mounted along with the tab it was asked from.
        await renderWith({ id: "shared", counter: 1 });
        expect(card("shared")?.className).not.toContain("collapsed");
        expect(card("solitary")?.className).toContain("collapsed");
        // Remembered, so the widget is open again the next time its tab is built.
        expect(server.put).toHaveBeenCalledWith("options", { rightPaneCollapsedItems: JSON.stringify([ "solitary" ]) });

        // Collapsed again by the user, then asked for a second time: the fresh request opens it again.
        await act(async () => container.querySelector<HTMLElement>("#shared .card-header")?.click());
        expect(card("shared")?.className).toContain("collapsed");
        await renderWith({ id: "shared", counter: 2 });
        expect(card("shared")?.className).not.toContain("collapsed");

        // A widget the request opens is scrolled to and flashed once the body it opened is laid out;
        // one that was open all along gets both on the spot, which is all such a press amounts to.
        const scrollIntoView = vi.fn();
        const solitary = card("solitary");
        if (solitary) solitary.scrollIntoView = scrollIntoView;
        await renderWith({ id: "solitary", counter: 3 });
        expect(card("solitary")?.className).not.toContain("collapsed");
        expect(scrollIntoView).toHaveBeenCalledTimes(1);
        expect(card("solitary")?.className).toContain("highlighted");

        // The flash lasts as long as its animation, and the card's own — not one from within it.
        await act(async () => { card("solitary")?.querySelector(".card-body")?.dispatchEvent(animationEnd()); });
        expect(card("solitary")?.className).toContain("highlighted");
        await act(async () => { card("solitary")?.dispatchEvent(animationEnd()); });
        expect(card("solitary")?.className).not.toContain("highlighted");

        await renderWith({ id: "solitary", counter: 4 });
        expect(scrollIntoView).toHaveBeenCalledTimes(2);
        expect(card("solitary")?.className).toContain("highlighted");
    });
});

function animationEnd() {
    return new Event("animationend", { bubbles: true });
}
