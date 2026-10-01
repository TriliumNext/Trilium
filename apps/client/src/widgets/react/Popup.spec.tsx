import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Popup, { placeFloating, type PopupProps } from "./Popup";

describe("Popup", () => {
    const host = document.createElement("div");
    document.body.append(host);
    let anchor: HTMLButtonElement;

    beforeEach(() => {
        anchor = document.createElement("button");
        document.body.append(anchor);
        // Floating UI reads the viewport from the root element's client size, and the popup's own
        // size from its offset size; happy-dom lays out nothing.
        vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(1000);
        vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(800);
        vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(200);
        vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(100);
    });

    afterEach(() => {
        render(null, host);
        anchor.remove();
        vi.restoreAllMocks();
        Object.defineProperty(document, "fullscreenElement", { value: null, configurable: true });
    });

    function anchorAt(x: number, y: number) {
        vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue(DOMRect.fromRect({ x, y, width: 80, height: 30 }));
    }

    /** Renders the popup and waits for it to be placed, which is when it shows. */
    async function open(props: Partial<PopupProps> = {}) {
        render(<Popup anchor={anchor} onDismiss={() => {}} {...props}><span>content</span></Popup>, host);
        const popup = document.querySelector<HTMLElement>(".tn-popup");
        if (!popup) throw new Error("expected the popup to render");
        await vi.waitFor(() => expect(popup.style.visibility).toBe("visible"));
        return popup;
    }

    it("stands in the page's body, below its anchor and lined up with its start", async () => {
        anchorAt(100, 50);
        const popup = await open({ className: "dropdown-menu", role: "menu" });

        expect(popup.parentElement).toBe(document.body);
        expect([ ...popup.classList ]).toEqual([ "tn-popup", "dropdown-menu" ]);
        expect(popup.getAttribute("role")).toBe("menu");
        expect(popup.textContent).toBe("content");
        expect([ popup.style.left, popup.style.top ]).toEqual([ "100px", "80px" ]);
    });

    it("keeps the gap it is given from its anchor", async () => {
        anchorAt(100, 50);
        const popup = await open({ offset: 2 });

        expect(popup.style.top).toBe("82px");
    });

    it("offsets an arrow along the edge facing the anchor, clear of the corners", async () => {
        const card = document.createElement("div");
        const pointer = document.createElement("div");
        Object.defineProperty(pointer, "offsetWidth", { value: 12 });
        Object.defineProperty(pointer, "offsetHeight", { value: 12 });
        card.append(pointer);
        document.body.append(card);
        const arrow = { element: pointer, padding: 10 };

        // Right of the anchor: the arrow's offset is along the card's left edge, and the
        // stylesheet sets the other axis.
        anchorAt(100, 350);
        expect(await placeFloating(card, anchor, { placement: "right-start", offset: 10, arrow })).toBe("right-start");
        expect(card.style.left).toBe("190px");
        const top = parseFloat(pointer.style.top);
        expect(top).toBeGreaterThanOrEqual(10);
        expect(top).toBeLessThanOrEqual(100 - 12 - 10);
        expect(pointer.style.left).toBe("");

        // Below the anchor: along the top edge, and the stylesheet sets the other axis.
        expect(await placeFloating(card, anchor, { placement: "bottom-start", offset: 10, arrow })).toBe("bottom-start");
        expect(pointer.style.left).not.toBe("");
        expect(pointer.style.top).toBe("");
        card.remove();
    });

    it("flips above its anchor where there is no room below, and caps its height to the room it has", async () => {
        anchorAt(100, 740);
        const popup = await open();
        // 740 - 100: it ends where the anchor starts.
        expect(popup.style.top).toBe("640px");

        render(null, host);
        vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(1000);
        anchorAt(100, 300);
        const tall = await open();
        // The side with the most room, less the gap it keeps from the viewport's edges.
        expect(tall.style.maxHeight).toBe(`${800 - 330 - 5}px`);
    });

    it("grows past the viewport without its height cap, stands in a wrapper it is given, and says when it is placed", async () => {
        vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(1000);
        anchorAt(100, 300);
        const onPlaced = vi.fn();
        const popup = await open({ capHeight: false, portalClassName: "tn-dropdown-portal note-actions", onPlaced });

        expect(popup.style.maxHeight).toBe("");
        expect(popup.parentElement?.className).toBe("tn-dropdown-portal note-actions");
        expect(popup.parentElement?.parentElement).toBe(document.body);
        expect(onPlaced).toHaveBeenCalledTimes(1);
    });

    it("says nothing of a placement that settles once it has closed", async () => {
        anchorAt(100, 50);
        const onPlaced = vi.fn();
        render(<Popup anchor={anchor} onPlaced={onPlaced}>content</Popup>, host);
        // Closed before the placement it started has settled, as a row picked at once closes a menu.
        render(null, host);

        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(onPlaced).not.toHaveBeenCalled();
    });

    it("opens at a point, as a menu opened where a right-click landed does", async () => {
        const popup = await open({ anchor: { x: 300, y: 200 }, placement: "right-start" });

        expect([ popup.style.left, popup.style.top ]).toEqual([ "300px", "200px" ]);
    });

    it("stands inside whatever has the screen, which is all a browser paints then", async () => {
        const fullscreen = document.createElement("div");
        document.body.append(fullscreen);
        Object.defineProperty(document, "fullscreenElement", { value: fullscreen, configurable: true });
        anchorAt(100, 50);

        const popup = await open();
        expect(popup.parentElement).toBe(fullscreen);
        fullscreen.remove();
    });

    it("is dismissed by a press outside it and its anchor, and by Escape, which goes no further", async () => {
        anchorAt(100, 50);
        const onDismiss = vi.fn();
        const popup = await open({ onDismiss });
        const pressOn = (target: Element) => target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
        // As the note tree stops its own presses.
        const outside = document.createElement("div");
        outside.addEventListener("pointerdown", (e) => e.stopPropagation());
        document.body.append(outside);

        pressOn(popup.firstElementChild ?? popup);
        // The anchor is a dropdown's toggle, which opens and closes the popup itself.
        pressOn(anchor);
        expect(onDismiss).not.toHaveBeenCalled();

        pressOn(outside);
        expect(onDismiss).toHaveBeenCalledWith("outside");

        const dialogHeard = vi.fn();
        document.addEventListener("keydown", dialogHeard);
        popup.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        expect(onDismiss).toHaveBeenLastCalledWith("escape");
        expect(dialogHeard).not.toHaveBeenCalled();
        document.removeEventListener("keydown", dialogHeard);
        outside.remove();
    });

    it("drops the click after a dismissing press unless it lands on what was pressed", async () => {
        anchorAt(100, 50);
        const popup = await open({ onDismiss: vi.fn() });
        const press = (target: Element) => target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
        const click = (target: Element) => target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        // A phone's cover, hidden with the popup before the tap's click, and an icon under it.
        const cover = document.createElement("div");
        const icon = document.createElement("button");
        const iconClicked = vi.fn();
        icon.addEventListener("click", iconClicked);
        document.body.append(cover, icon);

        press(cover);
        click(icon);
        expect(iconClicked).not.toHaveBeenCalled();
        // Only the first click is dropped.
        click(icon);
        expect(iconClicked).toHaveBeenCalledTimes(1);

        press(icon);
        click(icon);
        expect(iconClicked).toHaveBeenCalledTimes(2);

        // A press inside the popup does not dismiss it, so its click is kept.
        press(popup);
        click(icon);
        expect(iconClicked).toHaveBeenCalledTimes(3);
        cover.remove();
        icon.remove();
    });

    it("counts a popup opened inside it as inside, and leaves Escape to that popup", async () => {
        anchorAt(100, 50);
        const onOuterDismiss = vi.fn();
        const onInnerDismiss = vi.fn();
        const pressOn = (target: Element) => target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
        // As the calendar's month list opens from inside the calendar's panel.
        render((
            <Popup anchor={anchor} className="outer" onDismiss={onOuterDismiss}>
                <Popup anchor={{ x: 300, y: 200 }} className="inner" onDismiss={onInnerDismiss}>month</Popup>
            </Popup>
        ), host);
        // A popup of another tree, which is not the outer one's.
        const unrelatedHost = document.createElement("div");
        document.body.append(unrelatedHost);
        render(<Popup anchor={{ x: 0, y: 0 }} className="unrelated">other</Popup>, unrelatedHost);
        const inner = document.querySelector(".tn-popup.inner");
        const unrelated = document.querySelector(".tn-popup.unrelated");
        if (!inner || !unrelated) throw new Error("expected both popups to render");
        // Portaled to the body, not into the outer popup.
        expect(document.querySelector(".tn-popup.outer")?.contains(inner)).toBe(false);

        pressOn(inner);
        expect(onOuterDismiss).not.toHaveBeenCalled();
        expect(onInnerDismiss).not.toHaveBeenCalled();

        inner.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        expect(onInnerDismiss).toHaveBeenCalledWith("escape");
        expect(onOuterDismiss).not.toHaveBeenCalled();

        pressOn(unrelated);
        expect(onOuterDismiss).toHaveBeenCalledWith("outside");

        // Once the inner one is gone, Escape reaches the outer one again.
        render((
            <Popup anchor={anchor} className="outer" onDismiss={onOuterDismiss}>content</Popup>
        ), host);
        document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        expect(onOuterDismiss).toHaveBeenLastCalledWith("escape");

        render(null, unrelatedHost);
        unrelatedHost.remove();
    });
});
