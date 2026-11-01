import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import FormTextArea from "./FormTextArea";

describe("FormTextArea", () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        act(() => render(null, container));
        container.remove();
    });

    const textarea = () => container.querySelector<HTMLTextAreaElement>("textarea");

    it("reflects an updated currentValue prop after a user edit", () => {
        act(() => render(<FormTextArea currentValue="note A" />, container));

        const el = textarea();
        if (!el) throw new Error("textarea not found");

        // Simulate the user typing, which dirties the DOM value without updating currentValue.
        el.value = "user edit";
        act(() => { el.dispatchEvent(new Event("input", { bubbles: true })); });

        // Now re-render with a new prop, as if the parent switched to a different note.
        act(() => render(<FormTextArea currentValue="note B" />, container));
        expect(textarea()?.value).toBe("note B");
    });

    it("fires onChange with the new value when the user types", () => {
        const values: string[] = [];
        act(() => render(
            <FormTextArea currentValue="init" onChange={(v) => values.push(v)} />,
            container
        ));

        const el = textarea();
        if (!el) throw new Error("textarea not found");
        el.value = "edited";
        act(() => { el.dispatchEvent(new Event("input", { bubbles: true })); });
        act(() => { el.dispatchEvent(new Event("change", { bubbles: true })); });

        expect(values).toContain("edited");
    });

    it("fires onBlur with the current value when the field loses focus", () => {
        const blurred: string[] = [];
        act(() => render(
            <FormTextArea currentValue="hello" onBlur={(v) => blurred.push(v)} />,
            container
        ));

        const el = textarea();
        if (!el) throw new Error("textarea not found");
        // Preact maps onBlur to the native focusout event (bubbling) in its event delegation.
        act(() => { el.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });

        expect(blurred).toEqual(["hello"]);
    });
});
