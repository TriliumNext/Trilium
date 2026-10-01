import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Popover from "./Popover";

/**
 * Growing an anchored card to fill the window (see `maximized` in Popover), which is a way the same
 * card is drawn and not a surface put up in its place. What that buys is the point of these: a note
 * being edited within the card lives across the change, where a dialog raised instead would tear
 * the editor down and build it again with whatever was typed still unsaved.
 */
describe("Popover, maximized", () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        render(null, container);
        container.remove();
        document.body.innerHTML = "";
    });

    const anchorRect = () => new DOMRect(100, 100, 50, 20);

    /** Renders the popover and runs its effects. `placeFloating()` resolves later. */
    async function mount(maximized: boolean) {
        await act(async () => {
            render(
                <Popover getAnchorRect={anchorRect} maximized={maximized}>
                    <div className="held-content" />
                </Popover>,
                container);
            await Promise.resolve();
        });
    }

    const popover = () => document.querySelector<HTMLElement>(".tn-popover");
    const backdrop = () => document.querySelector<HTMLElement>(".tn-popover-backdrop");
    const held = () => document.querySelector<HTMLElement>(".held-content");

    it("keeps what it holds across the change, rather than building it again", async () => {
        await mount(false);
        const before = held();
        expect(before).toBeTruthy();

        await mount(true);
        expect(held()).toBe(before);

        // And back down again: the card is anchored once more and what it holds has still never
        // been away.
        await mount(false);
        expect(held()).toBe(before);
    });

    it("lets go of the anchor as it grows, and takes hold again as it comes down", async () => {
        await mount(false);
        // A placed card has `data-placement`; the `.maximized` rules in Popover.css apply only
        // without it.
        await vi.waitFor(() => expect(popover()?.getAttribute("data-placement")).toBeTruthy());
        expect(popover()?.style.left).not.toBe("");

        await mount(true);
        expect(popover()?.classList.contains("maximized")).toBe(true);
        // Removed together with the inline position, so only the stylesheet positions the card.
        expect(popover()?.hasAttribute("data-placement")).toBe(false);
        expect(popover()?.style.left).toBe("");
        expect(popover()?.style.top).toBe("");
        expect(popover()?.style.visibility).toBe("");

        await mount(false);
        expect(popover()?.classList.contains("maximized")).toBe(false);
        await vi.waitFor(() => expect(popover()?.getAttribute("data-placement")).toBeTruthy());
    });

    it("dims the page only while it is grown", async () => {
        await mount(false);
        expect(backdrop()).toBeNull();

        await mount(true);
        // A sibling of the card and not a child: the card carries a backdrop filter, which would
        // make it the containing block of anything fixed within it (see Popover.css).
        expect(backdrop()).toBeTruthy();
        expect(backdrop()?.contains(popover() ?? null)).toBe(false);

        await mount(false);
        expect(backdrop()).toBeNull();
    });
});
