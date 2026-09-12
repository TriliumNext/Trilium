import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";

import { renderInto } from "../../../../test/render";

const mocks = vi.hoisted(() => ({
    stored: {} as Record<string, string>,
    saved: [] as [ string, string | number ][],
    showError: vi.fn()
}));

vi.mock("../../../../services/i18n", () => ({ t: (key: string) => key }));

vi.mock("../../../../services/toast", () => ({
    default: { showError: mocks.showError, showMessage: vi.fn() }
}));

vi.mock("../../../react/hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../react/hooks")>()),
    useTriliumOption: (name: string) => [
        mocks.stored[name] ?? "",
        (value: string | number) => void mocks.saved.push([ name, value ])
    ]
}));

import TimeSelector from "./TimeSelector";

/**
 * The option holds seconds; the box shows them in whatever scale is chosen beside it. Both are
 * stored, so the pair round-trips without the user's chosen unit being lost.
 */
function selector(seconds: string, scale: string, minimumSeconds?: number) {
    mocks.stored = { theValue: seconds, theScale: scale };
    mocks.saved = [];
    mocks.showError.mockClear();

    // The figure is put into the box by an effect rather than at first render, so the tree has to be
    // let settle before it can be read.
    let container!: HTMLElement;
    act(() => {
        container = renderInto(
            <TimeSelector
                name="timeout"
                optionValueId={"theValue" as never}
                optionTimeScaleId={"theScale" as never}
                minimumSeconds={minimumSeconds}
            />
        );
    });

    return {
        box: container.querySelector<HTMLInputElement>("input[type='number']"),
        scaleSelect: container.querySelector<HTMLSelectElement>("select")
    };
}

/** Types a figure and commits it, which for a number box rides on the native change event. */
function enter(box: HTMLInputElement | null, value: string) {
    if (!box) return;
    box.value = value;
    box.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("TimeSelector", () => {
    it("reads the stored seconds out in the scale chosen beside them", () => {
        // 7200 seconds shown as 2, with hours chosen.
        expect(selector("7200", "3600").box?.value).toBe("2");
        expect(selector("7200", "60").box?.value).toBe("120");
    });

    it("stores what was typed back as seconds, whatever scale it was typed in", () => {
        const { box } = selector("3600", "3600");
        enter(box, "3");

        expect(mocks.saved).toContainEqual([ "theValue", 10800 ]);
    });

    it("offers every scale from seconds up to days", () => {
        const { scaleSelect } = selector("60", "1");
        expect([ ...(scaleSelect?.options ?? []) ].map((option) => option.value)).toEqual([ "1", "60", "3600", "86400" ]);
    });

    it("holds a figure below the floor up to it, and says so rather than storing it", () => {
        const { box } = selector("600", "1", 60);
        enter(box, "10");

        expect(mocks.showError).toHaveBeenCalled();
        expect(mocks.saved).toContainEqual([ "theValue", 60 ]);
    });

    it("stores nothing at all for a figure that is no figure, rather than guessing at one", () => {
        const { box } = selector("600", "1", 60);
        enter(box, "");

        expect(mocks.showError).toHaveBeenCalled();
        expect(mocks.saved).toEqual([]);
    });

    it("draws a row whose option has never been written, rather than taking the page down", () => {
        // An unset option answers with an empty string, which is no duration at all.
        const { box, scaleSelect } = selector("", "");

        expect(box?.value).toBe("0");
        // Seconds: the scale a bare figure is read at until one has been chosen.
        expect(scaleSelect?.value).toBe("1");
        expect(mocks.showError).not.toHaveBeenCalled();
    });

    it("falls back on a stored scale that could never divide anything", () => {
        expect(selector("120", "0").box?.value).toBe("120");
        expect(selector("120", "nonsense").box?.value).toBe("120");
    });

    it("keeps the figure as it stands when only the scale changes, so the stored seconds move with it", () => {
        const { scaleSelect } = selector("3600", "3600");

        if (scaleSelect) {
            scaleSelect.value = "60";
            scaleSelect.dispatchEvent(new Event("change", { bubbles: true }));
        }

        expect(mocks.saved).toContainEqual([ "theScale", "60" ]);
    });
});
