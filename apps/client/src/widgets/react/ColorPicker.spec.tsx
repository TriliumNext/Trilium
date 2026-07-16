import { describe, expect, it, vi } from "vitest";

import { renderInto } from "../../test/render";

// ColorPicker's popover is a themed `Dropdown` whose children only exist in the DOM while open
// (Bootstrap-driven state that happy-dom can't flip). Stub it to render the trigger + menu content
// inline so we can exercise ColorPicker's own logic (swatches, native input, clear) directly.
vi.mock("./Dropdown", () => ({
    default: ({ text, children }: { text: unknown; children: unknown }) => (
        <div className="dropdown-stub">
            <div className="dropdown-stub-trigger">{text}</div>
            <div className="dropdown-stub-menu">{children}</div>
        </div>
    )
}));

import ColorPicker from "./ColorPicker";

describe("ColorPicker", () => {
    it("renders a preset swatch grid and marks the current value active", () => {
        const container = renderInto(<ColorPicker currentValue="#43a047" onChange={vi.fn()} />);
        const swatches = container.querySelectorAll(".tn-color-picker-swatch");
        expect(swatches.length).toBeGreaterThan(1);

        const active = container.querySelectorAll(".tn-color-picker-swatch.active");
        expect(active).toHaveLength(1);
        expect((active[0] as HTMLElement).getAttribute("title")).toBe("#43a047");
    });

    it("uses the provided presets and emits the picked color", () => {
        const onChange = vi.fn();
        const container = renderInto(<ColorPicker currentValue="" presets={[ "#111111", "#222222" ]} onChange={onChange} />);

        const swatches = container.querySelectorAll<HTMLButtonElement>(".tn-color-picker-swatch");
        expect(swatches).toHaveLength(2);

        swatches[1].click();
        expect(onChange).toHaveBeenCalledExactlyOnceWith("#222222");
    });

    it("offers the browser's native color input and emits its value", () => {
        const onChange = vi.fn();
        const container = renderInto(<ColorPicker currentValue="#ff8800" onChange={onChange} />);

        const nativeInput = container.querySelector<HTMLInputElement>(".tn-color-picker-custom input[type=\"color\"]");
        expect(nativeInput).not.toBeNull();
        if (!nativeInput) return;
        // A valid 6-digit hex is round-tripped into the native input's value.
        expect(nativeInput.value).toBe("#ff8800");

        nativeInput.value = "#00ccff";
        nativeInput.dispatchEvent(new Event("input", { bubbles: true }));
        expect(onChange).toHaveBeenLastCalledWith("#00ccff");
    });

    it("clears the value via the clear action", () => {
        const onChange = vi.fn();
        const container = renderInto(<ColorPicker currentValue="#ff8800" onChange={onChange} />);

        container.querySelector<HTMLButtonElement>(".tn-color-picker-clear")?.click();
        expect(onChange).toHaveBeenCalledExactlyOnceWith("");
    });
});
