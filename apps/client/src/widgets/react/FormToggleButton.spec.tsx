import { describe, expect, it, vi } from "vitest";

import { renderInto } from "../../test/render";
import FormToggleButton from "./FormToggleButton";

describe("FormToggleButton", () => {
    it("uses the theme's btn classes and reflects the on-state via active + aria-pressed", () => {
        const off = renderInto(<FormToggleButton label="Bold" currentValue={false} onChange={vi.fn()} />).querySelector("button");
        const on = renderInto(<FormToggleButton label="Bold" currentValue={true} onChange={vi.fn()} />).querySelector("button");

        expect(off?.className).toContain("btn");
        expect(off?.className).toContain("btn-primary");
        expect(off?.className).not.toContain("active");
        expect(off?.getAttribute("aria-pressed")).toBe("false");

        expect(on?.className).toContain("active");
        expect(on?.getAttribute("aria-pressed")).toBe("true");
    });

    it("toggles the value on click", () => {
        const onChange = vi.fn();
        renderInto(<FormToggleButton label="Bold" currentValue={false} onChange={onChange} />).querySelector("button")?.click();
        expect(onChange).toHaveBeenCalledExactlyOnceWith(true);
    });

    it("does not fire when disabled", () => {
        const onChange = vi.fn();
        renderInto(<FormToggleButton label="Bold" currentValue={false} disabled onChange={onChange} />).querySelector("button")?.click();
        expect(onChange).not.toHaveBeenCalled();
    });

    it("applies the secondary kind and size variants", () => {
        const secondary = renderInto(<FormToggleButton label="A" kind="secondary" size="small" currentValue={false} onChange={vi.fn()} />).querySelector("button");
        expect(secondary?.className).toContain("btn-secondary");
        expect(secondary?.className).not.toContain("btn-primary");
        expect(secondary?.className).toContain("btn-sm");
    });

    it("renders an icon before the label when given", () => {
        const button = renderInto(<FormToggleButton label="A" icon="bx bx-check" currentValue={false} onChange={vi.fn()} />).querySelector("button");
        expect(button?.querySelector(".bx.bx-check")).not.toBeNull();
    });
});
