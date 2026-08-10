import { describe, expect, it } from "vitest";

import { isWithinFloatingLayer } from "./floating_layers";

/** Builds an element of the given class inside another, and answers with the innermost one — what a
 *  press actually lands on being a control deep inside the layer rather than the layer itself. */
function elementIn(...classNames: string[]) {
    let element = document.createElement("div");
    for (const className of classNames) {
        const child = document.createElement("div");
        child.className = className;
        element.appendChild(child);
        element = child;
    }
    return element;
}

describe("isWithinFloatingLayer", () => {
    it("recognises a press on one of the app's portaled layers", () => {
        // One of each family named in the selector: a menu, a modal, an editor balloon, a picker,
        // the context menu (matched by id rather than class), and an autocomplete.
        for (const className of [ "dropdown-menu", "modal", "modal-backdrop", "popover", "tooltip", "gutter",
            "ck-balloon-panel", "ck-body", "flatpickr-calendar", "attr-detail", "form-autocomplete-dropdown", "aa-dropdown-menu" ]) {
            expect(isWithinFloatingLayer(elementIn(className)), className).toBe(true);
        }
    });

    it("recognises the context menu, which the selector names by its id", () => {
        const container = document.createElement("div");
        container.id = "context-menu-container";
        const item = document.createElement("a");
        container.appendChild(item);

        expect(isWithinFloatingLayer(item)).toBe(true);
    });

    it("looks past the element pressed to the layer enclosing it", () => {
        // What a press lands on is a control several levels inside the menu, not the menu itself.
        expect(isWithinFloatingLayer(elementIn("dropdown-menu", "dropdown-item", "bx bx-check"))).toBe(true);
    });

    it("says no for ordinary content, which is exactly what should dismiss a surface", () => {
        expect(isWithinFloatingLayer(elementIn("note-detail", "some-widget"))).toBe(false);
    });

    it("says no for anything that is not an element at all", () => {
        // A press heard on the document or the window carries a target that cannot be asked about
        // ancestors; it must not read as a layer and hold a surface open.
        expect(isWithinFloatingLayer(null)).toBe(false);
        expect(isWithinFloatingLayer(document)).toBe(false);
        expect(isWithinFloatingLayer(document.createTextNode("text"))).toBe(false);
    });
});
