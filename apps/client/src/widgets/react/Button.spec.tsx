import { render } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SplitButton } from "./Button";
import { FormListItem } from "./FormList";

vi.mock("../../services/i18n", () => ({ t: (key: string) => key }));
// A dialog's focus trap would pull focus out of a menu portaled over it.
vi.mock("./modal_focustrap", () => ({ suspendModalFocusTraps: () => () => {} }));

describe("SplitButton", () => {
    const host = document.createElement("div");
    document.body.append(host);
    afterEach(() => render(null, host));

    /** Dispatches a press and its click. */
    const press = (element: Element) => {
        element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
        element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    };

    it("runs its action from the main button, and opens the rest from the toggle", async () => {
        const calls: string[] = [];
        render((
            <SplitButton text="Search" icon="bx bx-search" onClick={() => calls.push("search")}>
                <FormListItem icon="bx bxs-zap" onClick={() => calls.push("execute")}>Search and execute</FormListItem>
            </SplitButton>
        ), host);
        const [ main, toggle ] = host.querySelectorAll<HTMLButtonElement>(".btn-group button");
        if (!main || !toggle) throw new Error("expected both halves to render");

        expect(main.querySelector(".tn-icon")?.className).toContain("bx bx-search");
        expect(main.querySelector(".tn-icon")?.className).not.toContain("bx bx bx-search");
        press(main);
        expect(calls).toEqual([ "search" ]);
        expect(document.querySelector("[role=menu]")).toBeNull();

        // The app's own menu, not one opened by Bootstrap's data API.
        expect(toggle.hasAttribute("data-bs-toggle")).toBe(false);
        expect(toggle.getAttribute("aria-label")).toBe("split_button.more_actions");
        expect(toggle.getAttribute("aria-haspopup")).toBe("menu");
        press(toggle);
        const menu = await vi.waitFor(() => {
            const found = document.querySelector<HTMLElement>(".tn-popup.tn-menu");
            if (!found) throw new Error("expected the menu to open");
            return found;
        });
        const row = menu.querySelector<HTMLElement>("li.dropdown-item");
        expect(row?.textContent).toBe("Search and execute");

        if (row) press(row);
        expect(calls).toEqual([ "search", "execute" ]);
        await vi.waitFor(() => expect(document.querySelector(".tn-popup.tn-menu")).toBeNull());
    });
});
