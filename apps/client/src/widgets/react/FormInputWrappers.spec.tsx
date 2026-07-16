import { describe, expect, it, vi } from "vitest";

import { renderInto } from "../../test/render";
import FormDatetime from "./FormDatetime";
import FormNumber from "./FormNumber";
import FormTime from "./FormTime";

function typeInto(input: HTMLInputElement, value: string) {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("FormNumber / FormTime / FormDatetime wrappers", () => {
    it("render the correct native input type so the browser's picker is used", () => {
        const number = renderInto(<FormNumber currentValue="3" onChange={vi.fn()} />).querySelector("input");
        const time = renderInto(<FormTime currentValue="12:30" onChange={vi.fn()} />).querySelector("input");
        const datetime = renderInto(<FormDatetime currentValue="2026-07-16T12:30" onChange={vi.fn()} />).querySelector("input");

        expect(number?.getAttribute("type")).toBe("number");
        expect(time?.getAttribute("type")).toBe("time");
        expect(datetime?.getAttribute("type")).toBe("datetime-local");
        // Inherit FormTextBox's styling.
        expect(number?.className).toContain("form-control");
    });

    it("pass the current value through and emit changes with a validity state", () => {
        const onChange = vi.fn();
        const input = renderInto(<FormTime currentValue="09:00" onChange={onChange} />).querySelector("input");
        expect(input).not.toBeNull();
        if (!input) return;

        expect(input.value).toBe("09:00");
        typeInto(input, "17:45");
        expect(onChange).toHaveBeenLastCalledWith("17:45", expect.anything());
    });

    it("FormNumber inherits FormTextBox min/max clamping and forwards native attributes", () => {
        const onChange = vi.fn();
        const input = renderInto(<FormNumber currentValue="5" min={1} max={10} step={2} onChange={onChange} />).querySelector("input");
        expect(input).not.toBeNull();
        if (!input) return;

        expect(input.getAttribute("min")).toBe("1");
        expect(input.getAttribute("max")).toBe("10");
        expect(input.getAttribute("step")).toBe("2");

        typeInto(input, "999");
        expect(onChange).toHaveBeenLastCalledWith("10", expect.anything());
    });

    it("default the addon's \"not set\" placeholder for time and datetime", () => {
        const time = renderInto(<FormTime currentValue="" onChange={vi.fn()} />).querySelector("input");
        const datetime = renderInto(<FormDatetime currentValue="" onChange={vi.fn()} />).querySelector("input");
        expect(time?.getAttribute("placeholder")).toBe("not set");
        expect(datetime?.getAttribute("placeholder")).toBe("not set");
    });
});
