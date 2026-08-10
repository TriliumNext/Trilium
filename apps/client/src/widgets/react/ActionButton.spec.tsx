import { Tooltip } from "bootstrap";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ActionButton from "./ActionButton";

describe("ActionButton", () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        render(null, container);
        container.remove();
        for (const orphan of document.querySelectorAll(".tooltip")) {
            orphan.remove();
        }
    });

    it("dismisses its tooltip when pressed, so it cannot sit on top of what the press opened", async () => {
        const onClick = vi.fn();
        await act(async () => render(
            <ActionButton icon="bx bx-plus" text="Add a new attribute" onClick={onClick} />, container));

        const button = container.querySelector("button");
        expect(button).not.toBeNull();

        // The tooltip is shown by hovering/focusing in the real thing; neither is reliable under
        // happy-dom, so it is shown through the instance the hook registered.
        act(() => {
            if (button) Tooltip.getInstance(button)?.show();
        });
        expect(document.querySelector(".tooltip")).not.toBeNull();

        act(() => button?.click());

        expect(document.querySelector(".tooltip")).toBeNull();
        expect(onClick).toHaveBeenCalledOnce();
    });
});
