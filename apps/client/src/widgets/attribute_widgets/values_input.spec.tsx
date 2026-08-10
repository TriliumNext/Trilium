import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ValuesInput from "./values_input";

describe("ValuesInput", () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        render(null, container);
        container.remove();
    });

    async function mount(props: Parameters<typeof ValuesInput>[0]) {
        await act(async () => render(<ValuesInput {...props} />, container));
        return container.querySelector("input");
    }

    async function typeInto(input: HTMLInputElement | null, value: string) {
        await act(async () => {
            if (input) {
                input.value = value;
                input.dispatchEvent(new Event("input", { bubbles: true }));
            }
        });
    }

    async function press(input: HTMLInputElement | null, key: string) {
        await act(async () => {
            input?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
        });
    }

    it("commits nothing while disabled, whatever reaches it", async () => {
        // The box and the buttons are out of reach on the page, but a host may disable the field
        // while something is typed into it, and leaving the box hands over what it holds.
        const onCommit = vi.fn();
        const input = await mount({ labelType: "text", values: [ "one" ], onCommit, disabled: true });

        await typeInto(input, "two");
        await press(input, "Enter");
        await act(async () => { input?.dispatchEvent(new FocusEvent("blur", { bubbles: true })); });
        await act(async () => container.querySelector<HTMLElement>(".tn-chip-remove")?.click());
        await press(input, "Backspace");

        expect(onCommit).not.toHaveBeenCalled();
    });

    it("shows the values held as chips, and drops the one pressed", async () => {
        const onCommit = vi.fn();
        await mount({ labelType: "text", values: [ "one", "two" ], onCommit });

        const chips = [ ...container.querySelectorAll(".tn-chip") ];
        expect(chips.map((chip) => chip.textContent?.trim())).toEqual([ "one", "two" ]);

        await act(async () => chips[0]?.querySelector<HTMLElement>(".tn-chip-remove")?.click());
        expect(onCommit).toHaveBeenCalledWith([ "two" ]);
    });

    it("takes what was typed on Enter and empties the box, refusing a second of the same", async () => {
        const onCommit = vi.fn();
        const input = await mount({ labelType: "text", values: [ "one" ], onCommit });

        // Surrounding space goes with the typing, not into the value.
        await typeInto(input, "  two  ");
        await press(input, "Enter");
        expect(onCommit).toHaveBeenCalledWith([ "one", "two" ]);
        expect(input?.value).toBe("");

        // A value already held would come out as a second chip there is no telling apart.
        onCommit.mockClear();
        await typeInto(input, "one");
        await press(input, "Enter");
        expect(onCommit).not.toHaveBeenCalled();
        expect(input?.value).toBe("");
    });

    it("asks for a date rather than taking it as the field reports one", async () => {
        const onCommit = vi.fn();
        const input = await mount({ labelType: "date", values: [], onCommit });

        // A date and a time report a change per part of them, so a wheel spun through the minutes
        // says "settled" at every minute passed — a chip for each of them.
        await typeInto(input, "2026-07-29");
        await act(async () => {
            input?.dispatchEvent(new Event("change", { bubbles: true }));
        });
        expect(onCommit).not.toHaveBeenCalled();

        // The button beside the field is what asks for it, Enter doing as much from the keyboard.
        await act(async () => container.querySelector<HTMLElement>(".values-input-add")?.click());
        expect(onCommit).toHaveBeenCalledWith([ "2026-07-29" ]);
        // Emptied rather than left showing what is now a chip, so the next one can be entered.
        expect(input?.value).toBe("");
    });

    it("offers the button for a typed box only once it holds something to take", async () => {
        // Text is confirmed by the Enter it is already typed with — but nothing on the page says
        // so, so once there is something to take, the button shows the confirming instead of
        // standing empty-handed from the start.
        const onCommit = vi.fn();
        const input = await mount({ labelType: "text", values: [], onCommit });
        expect(container.querySelector(".values-input-add")).toBeNull();

        await typeInto(input, "one");
        await act(async () => container.querySelector<HTMLElement>(".values-input-add")?.click());
        expect(onCommit).toHaveBeenCalledWith([ "one" ]);
        // Taken and emptied, the box has nothing left to offer, and the button goes with it.
        expect(container.querySelector(".values-input-add")).toBeNull();

        // A colour settles in one gesture — a dialog opened, a colour chosen, the dialog gone — so
        // it is taken as it is reported and needs no asking either.
        await mount({ labelType: "color", values: [], onCommit: vi.fn() });
        expect(container.querySelector(".values-input-add")).toBeNull();
    });

    it("takes what was typed when the field is left, rather than throwing it away", async () => {
        // What is typed here is the value itself, so leaving with something in the box would lose it
        // — and a date is picked rather than typed, with no Enter to end it.
        const onCommit = vi.fn();
        const input = await mount({ labelType: "date", values: [], onCommit });

        expect(input?.type).toBe("date");
        await typeInto(input, "2026-07-29");
        await act(async () => {
            input?.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
        });
        expect(onCommit).toHaveBeenCalledWith([ "2026-07-29" ]);
    });

    it("takes a colour when the pick is settled, not through the drag, and shows it as given", async () => {
        const onCommit = vi.fn();
        const input = await mount({ labelType: "color", values: [ "#ff0000" ], onCommit });

        // Stored as text a picker cannot show, so the chip holds the value's own swatch — a swatch
        // rather than the chip's whole ground, this chip also holding the button removing it.
        expect(container.querySelector(".tn-chip .label-color-swatch")?.getAttribute("title"))
            .toBe("#ff0000");
        expect(input?.type).toBe("color");

        // Nothing may be written into the picker while the pick is being made: the browser takes its
        // value changing underneath an open dialog as reason to close it, losing the pick with it.
        const picker = watch(input);

        // A picker reports every shade the pointer passes through on its way to the one chosen.
        for (const shade of [ "#00ff00", "#00ee00" ]) {
            await act(async () => picker.dragTo(shade));
        }
        expect(onCommit).not.toHaveBeenCalled();

        await act(async () => {
            input?.dispatchEvent(new Event("change", { bubbles: true }));
        });
        expect(onCommit).toHaveBeenCalledWith([ "#ff0000", "#00ee00" ]);
        // Not once through the whole gesture, the settling included: a dialog can still be open when
        // it reports, and writing then is what closes it.
        expect(picker.writes()).toBe(0);
    });

    /**
     * A picker whose value can be moved as the user moves it, apart from anything the component
     * writes into it — which is what is being counted.
     */
    function watch(element: HTMLInputElement | null) {
        const own = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
        const read = own?.get;
        const write = own?.set;
        if (!element || !read || !write) throw new Error("expected a picker holding its own value");

        let written = 0;
        Object.defineProperty(element, "value", {
            get: read,
            set(value: string) {
                written++;
                write.call(this, value);
            },
            configurable: true
        });

        return {
            writes: () => written,
            dragTo(shade: string) {
                write.call(element, shade);
                element.dispatchEvent(new Event("input", { bubbles: true }));
            }
        };
    }

    it("drops the last chip on backspace in an empty box, and leaves a filled one alone", async () => {
        const onCommit = vi.fn();
        const input = await mount({ labelType: "text", values: [ "one", "two" ], onCommit });

        await press(input, "Backspace");
        expect(onCommit).toHaveBeenCalledWith([ "one" ]);

        // With something typed, backspace is the box's own to erase with.
        onCommit.mockClear();
        await typeInto(input, "th");
        await press(input, "Backspace");
        expect(onCommit).not.toHaveBeenCalled();
    });
});
