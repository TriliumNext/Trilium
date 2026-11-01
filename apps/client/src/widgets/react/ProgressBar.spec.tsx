import { describe, expect, it } from "vitest";

import { renderInto } from "../../test/render";
import ProgressBar from "./ProgressBar";

describe("ProgressBar", () => {
    it("fills as far as the value goes, within the bar, and says so to assistive technology", () => {
        const fill = (value: number, max: number) => {
            const bar = renderInto(<ProgressBar value={value} max={max} />)
                .querySelector<HTMLElement>("[role=progressbar]");
            expect(bar).not.toBeNull();
            return bar?.style.getPropertyValue("--tn-progress");
        };

        expect(fill(25, 200)).toBe("12.5%");
        expect(fill(300, 200)).toBe("100%");
        expect(fill(5, 0)).toBe("0%");

        const bar = renderInto(<ProgressBar value={25} max={200} />).querySelector("[role=progressbar]");
        expect(bar?.getAttribute("aria-valuenow")).toBe("25");
        expect(bar?.getAttribute("aria-valuemax")).toBe("200");
    });
});
