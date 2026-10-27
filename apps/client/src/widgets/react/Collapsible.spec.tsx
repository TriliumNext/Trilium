import type { ComponentChild } from "preact";
import { act } from "preact/test-utils";
import { describe, expect, it } from "vitest";

import { renderInto } from "../../test/render";
import Collapsible from "./Collapsible";

async function render(vnode: ComponentChild) {
    let container: HTMLElement | undefined;
    await act(async () => {
        container = renderInto(vnode);
    });
    if (!container) {
        throw new Error("nothing rendered");
    }
    return container;
}

describe("Collapsible", () => {
    it("shows its body from the title's toggle", async () => {
        const container = await render(<Collapsible title="Options" initiallyExpanded={false}>body</Collapsible>);
        const title = container.querySelector<HTMLButtonElement>(".collapsible-title");

        expect(title?.getAttribute("aria-expanded")).toBe("false");
        act(() => title?.click());
        expect(title?.getAttribute("aria-expanded")).toBe("true");
    });

    it("puts the body on a card only when asked", async () => {
        const plain = await render(<Collapsible title="Plain">body</Collapsible>);
        const card = await render(<Collapsible title="Card" card>body</Collapsible>);

        expect(plain.querySelector(".collapsible")?.classList.contains("collapsible-card")).toBe(false);
        expect(card.querySelector(".collapsible")?.classList.contains("collapsible-card")).toBe(true);
    });
});
