import { render } from "preact";
import { afterEach, describe, expect, it } from "vitest";

import SlidePages from "./SlidePages";

type Page = "first" | "second" | "third";
const ORDER: Page[] = [ "first", "second", "third" ];

let container: HTMLDivElement;

function show(page: Page, props: { inFlow?: boolean } = {}) {
    container ??= document.body.appendChild(document.createElement("div"));
    render(
        <SlidePages current={page} order={ORDER} {...props}>
            {(shown) => <div class={`page-${shown}`}>{shown}</div>}
        </SlidePages>,
        container
    );
}

/** The page on its way out, which only exists while a slide is running. */
function leaving() {
    return container.querySelector("[class*=slide-out-]");
}

function arriving() {
    return container.querySelector("[class*=slide-in-], .slide-current");
}

/** Ends the animation the way the browser would, which is what tells the component to let go. */
async function finishSlide() {
    leaving()?.dispatchEvent(new Event("animationend", { bubbles: true }));
    // Letting go is the one part that needs a render of its own, which Preact schedules.
    await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
    render(null, container);
    container.remove();
    container = undefined as unknown as HTMLDivElement;
});

describe("sliding between pages", () => {
    it("shows only the current page until there is somewhere to slide from", () => {
        show("first");

        expect(leaving()).toBeFalsy();
        expect(arriving()?.className).toContain("slide-current");
        expect(container.textContent).toBe("first");
    });

    it("slides forwards towards a page later in the order, keeping both on screen meanwhile", () => {
        show("first");
        show("second");

        expect(leaving()?.className).toContain("slide-out-forward");
        expect(leaving()?.textContent).toBe("first");
        expect(arriving()?.className).toContain("slide-in-forward");
        expect(arriving()?.textContent).toBe("second");
    });

    it("slides backwards towards an earlier one, without being told which way it went", async () => {
        show("first");
        show("third");
        await finishSlide();

        show("second");

        expect(leaving()?.className).toContain("slide-out-backward");
        expect(arriving()?.className).toContain("slide-in-backward");
    });

    it("lets the page it was leaving go once the animation ends", async () => {
        show("first");
        show("second");
        expect(leaving()).toBeTruthy();

        await finishSlide();

        expect(leaving()).toBeFalsy();
        expect(container.textContent).toBe("second");
        expect(arriving()?.className).toContain("slide-current");
    });

    it("keeps sliding when something inside the page it is leaving finishes an animation of its own", async () => {
        show("first");
        show("second");

        // Animation events bubble, and a spinner or a field's own animation ending is not the slide
        // ending: acting on it would drop the page mid-flight and snap the other into place.
        container.querySelector(".page-first")?.dispatchEvent(new Event("animationend", { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(leaving()).toBeTruthy();
        expect(arriving()?.className).toContain("slide-in-forward");
    });

    it("takes only the page leaving out of the flow when the pages keep their place", () => {
        show("first", { inFlow: true });
        show("second", { inFlow: true });

        expect(container.querySelector(".slide-pages-in-flow")).toBeTruthy();
        // Which of them is positioned is settled in CSS; what matters here is that they are told
        // apart, so the height can follow the one arriving.
        expect(leaving()?.className).toContain("slide-out-forward");
        expect(arriving()?.className).not.toContain("slide-out-");
    });
});
