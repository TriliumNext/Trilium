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
        render(null, container);
        container.remove();
    });

    const textarea = () => container.querySelector<HTMLTextAreaElement>("textarea");

    it("reflects an updated currentValue prop when re-rendered", () => {
        act(() => render(<FormTextArea currentValue="first" />, container));
        expect(textarea()?.value).toBe("first");

        act(() => render(<FormTextArea currentValue="second" />, container));
        expect(textarea()?.value).toBe("second");
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
