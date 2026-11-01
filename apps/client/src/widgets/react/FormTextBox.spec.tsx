import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import FormTextBox, { FormTextBoxProps } from "./FormTextBox";

describe("FormTextBox", () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        render(null, container);
        container.remove();
    });

    function renderBox(props: FormTextBoxProps) {
        act(() => render(<FormTextBox {...props} />, container));
        const input = container.querySelector("input");
        expect(input).not.toBeNull();
        return input as HTMLInputElement;
    }

    /** As leaving a box fires it, under either name the handler may be bound to (preact/compat
     *  remaps `onBlur` to focusout when it is loaded, and the suite must not care whether it is). */
    function leave(input: HTMLInputElement) {
        input.dispatchEvent(new Event("change", { bubbles: true }));
        input.dispatchEvent(new Event("focusout", { bubbles: true }));
        input.dispatchEvent(new Event("blur"));
    }

    it("commits a number box on the spinner's own change event, no focus ever having arrived", () => {
        const onBlur = vi.fn();
        const input = renderBox({ type: "number", min: 1, currentValue: "1", onBlur });

        // A spinner step: the value moves and change fires, but focus — and so blur — never does.
        input.value = "2";
        act(() => { input.dispatchEvent(new Event("change", { bubbles: true })); });

        expect(onBlur).toHaveBeenCalledTimes(1);
        expect(onBlur).toHaveBeenCalledWith("2");
    });

    it("commits a typed-in number box once, though leaving it fires change and blur together", () => {
        const onBlur = vi.fn();
        const input = renderBox({ type: "number", min: 1, currentValue: "1", onBlur });

        input.value = "7";
        act(() => leave(input));

        expect(onBlur).toHaveBeenCalledTimes(1);
        expect(onBlur).toHaveBeenCalledWith("7");
    });

    it("clamps a number box's commit to its floor, the spinner not being the only way in", () => {
        const onBlur = vi.fn();
        const input = renderBox({ type: "number", min: 1, currentValue: "5", onBlur });

        input.value = "0";
        act(() => { input.dispatchEvent(new Event("change", { bubbles: true })); });

        expect(onBlur).toHaveBeenCalledWith("1");
        expect(input.value).toBe("1");
    });

    it("still commits a text box as the focus leaves it", () => {
        const onBlur = vi.fn();
        const input = renderBox({ currentValue: "before", onBlur });

        input.value = "after";
        act(() => leave(input));

        expect(onBlur).toHaveBeenCalledTimes(1);
        expect(onBlur).toHaveBeenCalledWith("after");
    });
});
