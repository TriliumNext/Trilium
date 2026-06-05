import { render } from "preact";
import type { RefObject } from "preact/compat";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import FormTextBox, { FormTextBoxWithUnit } from "./FormTextBox";

// --- Render helper -------------------------------------------------------------------------------

let container: HTMLDivElement | undefined;
function renderInto(vnode: unknown) {
    container = document.createElement("div");
    document.body.appendChild(container);
    // act() flushes the autoFocus useEffect synchronously (Preact runs effects after commit).
    act(() => render(vnode as never, container as HTMLDivElement));
    return container;
}

afterEach(() => {
    if (container) {
        render(null, container);
        container.remove();
        container = undefined;
    }
    vi.restoreAllMocks();
});

function typeInto(input: HTMLInputElement, value: string) {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
}

function blur(input: HTMLInputElement) {
    // Preact delegates blur -> focusout; a "blur" event does nothing.
    input.dispatchEvent(new Event("focusout", { bubbles: true }));
}

// --- FormTextBox ---------------------------------------------------------------------------------

describe("FormTextBox", () => {
    it("defaults to type=text with form-control class and renders the current value", () => {
        const input = renderInto(<FormTextBox currentValue="hello" />).querySelector("input");
        expect(input?.getAttribute("type")).toBe("text");
        expect(input?.className).toBe("form-control ");
        expect(input?.value).toBe("hello");
    });

    it("appends a custom className and forwards an explicit type plus rest props", () => {
        const input = renderInto(
            <FormTextBox type="email" className="extra" placeholder="ph" name="myField" />
        ).querySelector("input");
        expect(input?.className).toBe("form-control extra");
        expect(input?.getAttribute("type")).toBe("email");
        expect(input?.getAttribute("placeholder")).toBe("ph");
        expect(input?.getAttribute("name")).toBe("myField");
    });

    it("forwards inputRef to the rendered element and focuses it when autoFocus is set", () => {
        // Effects run after Preact assigns the ref, so spy on the prototype before mount to capture
        // the focus() call the autoFocus useEffect makes on inputRef.current.
        const focusSpy = vi.spyOn(HTMLInputElement.prototype, "focus");
        const ref: RefObject<HTMLInputElement> = { current: null };
        renderInto(<FormTextBox inputRef={ref} autoFocus />);
        expect(ref.current).toBeInstanceOf(HTMLInputElement);
        expect(focusSpy).toHaveBeenCalledTimes(1);
    });

    it("does not focus when autoFocus is unset and tolerates a missing inputRef", () => {
        const focusSpy = vi.spyOn(HTMLInputElement.prototype, "focus");
        expect(() => renderInto(<FormTextBox autoFocus />)).not.toThrow();
        // No inputRef -> inputRef?.current?.focus() short-circuits, so focus is never called.
        expect(focusSpy).not.toHaveBeenCalled();

        const ref: RefObject<HTMLInputElement> = { current: null };
        renderInto(<FormTextBox inputRef={ref} />);
        // autoFocus falsy -> effect body skipped entirely.
        expect(focusSpy).not.toHaveBeenCalled();
    });

    it("text inputs pass the value through unchanged on input (applyLimits non-number branch)", () => {
        const onChange = vi.fn();
        const input = renderInto(<FormTextBox currentValue="" onChange={onChange} />).querySelector("input");
        if (!input) throw new Error("input not rendered");
        typeInto(input, "abc");
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenLastCalledWith("abc", expect.anything());
    });

    it("does not attach an input handler when no onChange is provided", () => {
        const input = renderInto(<FormTextBox currentValue="x" />).querySelector("input");
        if (!input) throw new Error("input not rendered");
        // Without an onChange, the onInput prop is undefined; dispatching must be a no-op.
        expect(() => typeInto(input, "y")).not.toThrow();
    });

    it("clamps number inputs above max on change", () => {
        const onChange = vi.fn();
        const input = renderInto(
            <FormTextBox type="number" min={1} max={10} currentValue="5" onChange={onChange} />
        ).querySelector("input");
        if (!input) throw new Error("input not rendered");
        typeInto(input, "999");
        expect(onChange).toHaveBeenLastCalledWith("10", expect.anything());
    });

    it("clamps number inputs below min on change", () => {
        const onChange = vi.fn();
        const input = renderInto(
            <FormTextBox type="number" min={3} max={10} currentValue="5" onChange={onChange} />
        ).querySelector("input");
        if (!input) throw new Error("input not rendered");
        typeInto(input, "1");
        expect(onChange).toHaveBeenLastCalledWith("3", expect.anything());
    });

    it("leaves number inputs untouched when within [min,max]", () => {
        const onChange = vi.fn();
        const input = renderInto(
            <FormTextBox type="number" min={1} max={10} currentValue="5" onChange={onChange} />
        ).querySelector("input");
        if (!input) throw new Error("input not rendered");
        typeInto(input, "7");
        expect(onChange).toHaveBeenLastCalledWith("7", expect.anything());
    });

    it("returns min as a string when a number input is non-finite (e.g. empty/NaN)", () => {
        const onChange = vi.fn();
        const input = renderInto(
            <FormTextBox type="number" min={4} max={10} currentValue="5" onChange={onChange} />
        ).querySelector("input");
        if (!input) throw new Error("input not rendered");
        // happy-dom keeps a non-numeric value off the DOM, so drive applyLimits via the raw value.
        input.setAttribute("value", "");
        typeInto(input, "");
        expect(onChange).toHaveBeenLastCalledWith("4", expect.anything());
    });

    it("returns an empty string for a non-finite number input when no min is given", () => {
        const onChange = vi.fn();
        const input = renderInto(
            <FormTextBox type="number" max={10} currentValue="5" onChange={onChange} />
        ).querySelector("input");
        if (!input) throw new Error("input not rendered");
        typeInto(input, "");
        expect(onChange).toHaveBeenLastCalledWith("", expect.anything());
    });

    it("fires onBlur with the clamped value and writes it back to the element", () => {
        const onBlur = vi.fn();
        const input = renderInto(
            <FormTextBox type="number" min={2} max={8} onBlur={onBlur} />
        ).querySelector("input");
        if (!input) throw new Error("input not rendered");
        input.value = "0";
        blur(input);
        expect(onBlur).toHaveBeenCalledWith("2");
        expect(input.value).toBe("2");
    });

    it("blur on a text input passes the value through and tolerates no onBlur handler", () => {
        const input = renderInto(<FormTextBox currentValue="keep" />).querySelector("input");
        if (!input) throw new Error("input not rendered");
        input.value = "edited";
        expect(() => blur(input)).not.toThrow();
        expect(input.value).toBe("edited");
    });
});

// --- FormTextBoxWithUnit -------------------------------------------------------------------------

describe("FormTextBoxWithUnit", () => {
    it("wraps the input in an input-group label and renders the unit text", () => {
        const root = renderInto(<FormTextBoxWithUnit unit="mm" type="number" currentValue="3" />);
        const label = root.querySelector("label");
        expect(label?.className).toContain("input-group");
        expect(label?.className).toContain("tn-number-unit-pair");
        expect(root.querySelector("input")?.getAttribute("type")).toBe("number");
        expect(root.querySelector("span.input-group-text")?.textContent).toBe("mm");
    });
});
