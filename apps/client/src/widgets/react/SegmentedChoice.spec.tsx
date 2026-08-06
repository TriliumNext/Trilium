import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import SegmentedChoice from "./SegmentedChoice";

describe("SegmentedChoice", () => {
    let container: HTMLDivElement;

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        render(null, container);
        container.remove();
    });

    const options = (extra?: { count?: number }) => [
        { value: "user" as const, label: "Yours", ...extra },
        { value: "system" as const, label: "System", count: extra?.count === undefined ? undefined : 7 }
    ];

    it("offers one button per option, marking the current one", () => {
        render(<SegmentedChoice options={options()} currentValue="system" onChange={() => {}} />, container);

        const buttons = [ ...container.querySelectorAll("button") ];
        expect(buttons.map((button) => button.textContent?.trim())).toStrictEqual([ "Yours", "System" ]);
        expect(buttons.map((button) => button.classList.contains("active"))).toStrictEqual([ false, true ]);
    });

    it("shows a count as a badge beside the name rather than inside it", () => {
        render(<SegmentedChoice options={options({ count: 3 })} currentValue="user" onChange={() => {}} />, container);

        const badges = [ ...container.querySelectorAll(".tn-segmented-choice-count") ];
        expect(badges.map((badge) => badge.textContent)).toStrictEqual([ "3", "7" ]);
        // The name is the label alone: a caller that has moved its count out of the string should not
        // find it written back into one.
        expect(badges[0]?.parentElement?.textContent?.trim()).toBe("Yours3");
    });

    it("shows a count of zero, and no badge at all where there is no count", () => {
        // An option offering nothing is worth saying so — and a badge that came and went with the last
        // item would resize the group under the pointer.
        render(<SegmentedChoice options={options({ count: 0 })} currentValue="user" onChange={() => {}} />, container);
        expect(container.querySelector(".tn-segmented-choice-count")?.textContent).toBe("0");

        render(<SegmentedChoice options={options()} currentValue="user" onChange={() => {}} />, container);
        expect(container.querySelectorAll(".tn-segmented-choice-count")).toHaveLength(0);
    });

    it("reports the option that was pressed", () => {
        const onChange = vi.fn();
        render(<SegmentedChoice options={options({ count: 3 })} currentValue="user" onChange={onChange} />, container);

        container.querySelectorAll("button")[1].click();
        expect(onChange).toHaveBeenCalledWith("system");
    });
});
