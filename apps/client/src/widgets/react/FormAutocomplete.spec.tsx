import { useState } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderInto } from "../../test/render";
import FormAutocomplete, { stepOver } from "./FormAutocomplete";

describe("stepping through a list with headings in it", () => {
    const items = [ "Nearby", "a", "b", "Far away", "c" ];
    const isHeading = (item: string) => item === "Nearby" || item === "Far away";

    it("steps over the headings, in either direction, wrapping at the ends", () => {
        // Opening the list lands on the first entry that can be taken, not on the heading over it.
        expect(stepOver(items, -1, 1, isHeading)).toBe(1);
        expect(stepOver(items, 1, 1, isHeading)).toBe(2);
        // Past the last of one group is the first of the next, the heading between them stepped over.
        expect(stepOver(items, 2, 1, isHeading)).toBe(4);
        // And round the end, back to the top.
        expect(stepOver(items, 4, 1, isHeading)).toBe(1);
        expect(stepOver(items, 1, -1, isHeading)).toBe(4);
    });

    it("goes up to the last entry from a list with nothing highlighted", () => {
        expect(stepOver(items, -1, -1, isHeading)).toBe(4);
        expect(stepOver([ "a", "b", "c" ], -1, -1)).toBe(2);
    });

    it("highlights nothing in a list that is headings alone", () => {
        expect(stepOver([ "Nearby" ], -1, 1, isHeading)).toBe(-1);
    });
});

describe("the dropdown", () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    async function open(dropdownMinWidth?: number) {
        vi.useFakeTimers();
        const container = renderInto(<FormAutocomplete currentValue="" onChange={() => {}} openOnFocus
            source={async () => [ "a", "b" ]} dropdownMinWidth={dropdownMinWidth} />);
        const input = container.querySelector("input");
        if (!input) throw new Error("no input rendered");
        input.getBoundingClientRect = () => DOMRect.fromRect({ x: 20, y: 100, width: 240, height: 30 });

        await act(async () => { input.focus(); });
        await act(async () => { await vi.advanceTimersByTimeAsync(300); });
        const dropdowns = document.querySelectorAll<HTMLElement>(".tn-popup.form-autocomplete-dropdown");
        return dropdowns[dropdowns.length - 1];
    }

    it("is a popup under the field, as wide as the field or as the minimum asked for where that is more", async () => {
        const atField = await open();
        expect(atField.querySelectorAll(".form-autocomplete-list > .form-autocomplete-item")).toHaveLength(2);
        expect(atField.style.width).toBe("240px");

        expect((await open(440)).style.width).toBe("440px");
        expect((await open(100)).style.width).toBe("240px");
    });
});

describe("Enter pressed before the newer query's suggestions", () => {
    it("reaches the host where the newer list will open with nothing highlighted", async () => {
        vi.useFakeTimers();
        const onPick = vi.fn();
        const reachedDocument = vi.fn();
        function Field() {
            const [ value, setValue ] = useState("");
            return <FormAutocomplete currentValue={value} onChange={setValue} onPick={onPick}
                source={async (query) => [ `${query}!` ]} />;
        }
        const found = renderInto(<Field />).querySelector("input");
        if (!found) throw new Error("no input rendered");
        const input: HTMLInputElement = found;

        await act(async () => {
            input.value = "a";
            input.dispatchEvent(new Event("input", { bubbles: true }));
        });
        await act(async () => { await vi.advanceTimersByTimeAsync(300); });
        await act(async () => {
            input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
        });
        expect(document.querySelector(".form-autocomplete-item.active")?.textContent).toBe("a!");

        await act(async () => {
            input.value = "ab";
            input.dispatchEvent(new Event("input", { bubbles: true }));
        });
        const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
        document.addEventListener("keydown", reachedDocument);
        await act(async () => { input.dispatchEvent(enter); });
        document.removeEventListener("keydown", reachedDocument);
        await act(async () => { await vi.advanceTimersByTimeAsync(300); });

        expect(enter.defaultPrevented).toBe(false);
        expect(reachedDocument).toHaveBeenCalledWith(enter);
        expect(onPick).not.toHaveBeenCalled();
        vi.useRealTimers();
    });
});

describe("Enter pressed between typing and the render it causes", () => {
    it("is held for the text just typed, and picks among its suggestions", async () => {
        vi.useFakeTimers();
        const onPick = vi.fn();
        function Field() {
            const [ value, setValue ] = useState("");
            return <FormAutocomplete currentValue={value} onChange={setValue} onPick={onPick} autoActivate
                source={async (query) => [ `${query}!` ]} />;
        }
        const found = renderInto(<Field />).querySelector("input");
        if (!found) throw new Error("no input rendered");
        const input: HTMLInputElement = found;

        await act(async () => {
            input.value = "a";
            input.dispatchEvent(new Event("input", { bubbles: true }));
        });
        await act(async () => { await vi.advanceTimersByTimeAsync(300); });

        // Outside `act`, the render for "ab" comes after the Enter.
        input.value = "ab";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
        // The first flushes the render and its effects, the second the lookup they debounce.
        await act(async () => { await vi.advanceTimersByTimeAsync(300); });
        await act(async () => { await vi.advanceTimersByTimeAsync(300); });

        expect(onPick).toHaveBeenCalledExactlyOnceWith("ab!");
        vi.useRealTimers();
    });
});

describe("an input method composing in the field", () => {
    it("looks up what the input method commits, not what it is composing, and passes the events on", async () => {
        vi.useFakeTimers();
        const source = vi.fn(async (query: string) => [ `${query}!` ]);
        const onCompositionStart = vi.fn();
        const onCompositionEnd = vi.fn();
        function Field() {
            const [ value, setValue ] = useState("");
            return <FormAutocomplete currentValue={value} onChange={setValue} source={source}
                onCompositionStart={onCompositionStart} onCompositionEnd={onCompositionEnd} />;
        }
        const found = renderInto(<Field />).querySelector("input");
        if (!found) throw new Error("no input rendered");
        const input: HTMLInputElement = found;

        async function type(text: string) {
            await act(async () => {
                input.value = text;
                input.dispatchEvent(new Event("input", { bubbles: true }));
            });
            await act(async () => { await vi.advanceTimersByTimeAsync(300); });
        }

        await act(async () => { input.dispatchEvent(new Event("compositionstart", { bubbles: true })); });
        await type("n");
        await type("ni");
        expect(source).not.toHaveBeenCalled();

        await act(async () => { input.dispatchEvent(new Event("compositionend", { bubbles: true })); });
        await act(async () => { await vi.advanceTimersByTimeAsync(300); });
        expect(source.mock.calls).toEqual([ [ "ni" ] ]);
        expect(onCompositionStart).toHaveBeenCalledOnce();
        expect(onCompositionEnd).toHaveBeenCalledOnce();
        vi.useRealTimers();
    });
});
