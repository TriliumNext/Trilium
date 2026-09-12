import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createdOption, isCreateEntry, selectEntriesFor, SelectValuesInput } from "./select_input";

describe("SelectValuesInput", () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        render(null, container);
        container.remove();
    });

    async function mount(props: Parameters<typeof SelectValuesInput>[0]) {
        await act(async () => render(<SelectValuesInput {...props} />, container));
        return container;
    }

    /** Lets the debounced fetch run; the list is portaled to the body. */
    async function settleDropdown() {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 200));
        });
        return [ ...document.querySelectorAll(".form-autocomplete-dropdown li") ];
    }

    async function typeInto(input: HTMLInputElement | null, value: string) {
        await act(async () => {
            if (input) {
                input.value = value;
                input.dispatchEvent(new Event("input", { bubbles: true }));
            }
        });
    }

    const options = [ "Todo", "In progress", "Done" ];

    it("shows the values held as chips inside the field, and drops the one pressed", async () => {
        const onCommit = vi.fn();
        await mount({ options, values: [ "Todo", "Done" ], onCommit });

        const chips = [ ...container.querySelectorAll(".select-values-chip") ];
        expect(chips.map((chip) => chip.textContent?.trim())).toEqual([ "Todo", "Done" ]);
        // The chips sit within the field's frame, ahead of the box typed into.
        expect(chips[0]?.closest(".form-autocomplete-field")).not.toBeNull();

        await act(async () => chips[0]?.querySelector<HTMLElement>(".tn-chip-remove")?.click());
        expect(onCommit).toHaveBeenCalledWith([ "Done" ]);
    });

    it("offers only what is not held yet, and adds the entry picked to the set", async () => {
        const onCommit = vi.fn();
        await mount({ options, values: [ "Todo" ], onCommit });

        const input = container.querySelector("input");
        await act(async () => input?.focus());

        // "Todo" is a chip already, so the list is what is left to take.
        const items = await settleDropdown();
        expect(items.map((item) => item.textContent)).toEqual([ "In progress", "Done" ]);

        await act(async () => (items[1] as HTMLElement | undefined)?.click());
        expect(onCommit).toHaveBeenCalledWith([ "Todo", "Done" ]);
    });

    it("creates an option the definition lacks, taking it as a value in the same breath", async () => {
        const onCommit = vi.fn();
        const onCreateOption = vi.fn();
        await mount({ options, values: [], onCommit, onCreateOption });

        const input = container.querySelector("input");
        await act(async () => input?.focus());
        await typeInto(input, "Blocked");

        const items = await settleDropdown();
        expect(items[0]?.querySelector(".select-create-option")).not.toBeNull();

        await act(async () => (items[0] as HTMLElement | undefined)?.click());
        expect(onCreateOption).toHaveBeenCalledWith("Blocked");
        expect(onCommit).toHaveBeenCalledWith([ "Blocked" ]);
        // The box goes back to being empty: what it held was a filter, and the value is a chip now.
        expect(input?.value).toBe("");
    });

    it("builds a second quick pick on the first, before the host has rendered it", async () => {
        const finish: Array<() => void> = [];
        const onCommit = vi.fn(() => new Promise<void>((resolve) => finish.push(resolve)));
        await mount({ options, values: [], onCommit });

        const input = container.querySelector("input");
        await act(async () => input?.focus());
        const first = await settleDropdown();
        await act(async () => (first[0] as HTMLElement | undefined)?.click());
        expect(onCommit).toHaveBeenCalledWith([ "Todo" ]);

        // The host has not rendered the commit back as `values`. The refreshed list already leaves
        // the taken value out, and the next pick builds on it instead of the stale prop.
        const second = await settleDropdown();
        expect(second.map((item) => item.textContent)).toEqual([ "In progress", "Done" ]);
        await act(async () => (second[0] as HTMLElement | undefined)?.click());
        expect(onCommit).toHaveBeenLastCalledWith([ "Todo", "In progress" ]);

        await act(async () => {
            for (const resolve of finish) {
                resolve();
            }
        });
    });

    it("restores the accepted values after an async commit fails", async () => {
        let rejectFirst: (error: Error) => void = () => {};
        const onCommit = vi.fn()
            .mockImplementationOnce(() => new Promise<void>((_resolve, reject) => {
                rejectFirst = reject;
            }))
            .mockResolvedValue(undefined);
        await mount({ options, values: [], onCommit });

        const input = container.querySelector("input");
        await act(async () => input?.focus());
        const first = await settleDropdown();
        await act(async () => (first[0] as HTMLElement | undefined)?.click());
        expect(onCommit).toHaveBeenCalledWith([ "Todo" ]);
        await act(async () => rejectFirst(new Error("write refused")));

        // The failed pick is not built upon: the edits follow the prop again, so the next pick
        // starts from the set the host accepted.
        const second = await settleDropdown();
        await act(async () => (second[1] as HTMLElement | undefined)?.click());
        expect(onCommit).toHaveBeenLastCalledWith([ "In progress" ]);
    });

    it("offers a failed pick again, even on a list that already refreshed without it", async () => {
        let rejectFirst: (error: Error) => void = () => {};
        const onCommit = vi.fn(() => new Promise<void>((_resolve, reject) => {
            rejectFirst = reject;
        }));
        await mount({ options, values: [], onCommit });

        const input = container.querySelector("input");
        await act(async () => input?.focus());
        const first = await settleDropdown();
        await act(async () => (first[0] as HTMLElement | undefined)?.click());

        // The list has already refreshed without the pick when the write fails...
        expect((await settleDropdown()).map((item) => item.textContent))
            .toEqual([ "In progress", "Done" ]);
        await act(async () => rejectFirst(new Error("write refused")));

        // ...so the failure itself has to put the value back on offer.
        expect((await settleDropdown()).map((item) => item.textContent))
            .toEqual([ "Todo", "In progress", "Done" ]);
    });

    it("takes a value only once, however quickly it is picked", async () => {
        // Between a pick and the list refreshing, the old entries still take clicks.
        const finish: Array<() => void> = [];
        const onCommit = vi.fn(() => new Promise<void>((resolve) => finish.push(resolve)));
        await mount({ options, values: [], onCommit });

        const input = container.querySelector("input");
        await act(async () => input?.focus());
        const items = await settleDropdown();
        await act(async () => {
            (items[0] as HTMLElement | undefined)?.click();
            (items[0] as HTMLElement | undefined)?.click();
        });

        expect(onCommit).toHaveBeenCalledOnce();
        expect(onCommit).toHaveBeenCalledWith([ "Todo" ]);
        await act(async () => {
            for (const resolve of finish) {
                resolve();
            }
        });
    });

    it("observes an async commit result", async () => {
        // The test environment swallows unhandled rejections silently, so ownership is asserted
        // structurally: the field must assimilate what `onCommit` returns, which a fire-and-forget
        // call would never touch. A rejecting host (the promoted-attribute grid) otherwise leaks
        // every failed write as an unhandled rejection.
        let subscribed = 0;
        const write = {
            then() {
                subscribed++;
                return Promise.resolve();
            }
        };
        const onCommit = vi.fn(() => write as unknown as Promise<void>);
        await mount({ options, values: [], onCommit });

        const input = container.querySelector("input");
        await act(async () => input?.focus());
        const items = await settleDropdown();
        await act(async () => (items[0] as HTMLElement | undefined)?.click());

        expect(onCommit).toHaveBeenCalledWith([ "Todo" ]);
        expect(subscribed).toBeGreaterThan(0);
    });

    it("drops the last chip on backspace in an empty box, and leaves a filled one alone", async () => {
        const onCommit = vi.fn();
        await mount({ options, values: [ "Todo", "Done" ], onCommit });

        const input = container.querySelector("input");
        await act(async () => {
            input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }));
        });
        expect(onCommit).toHaveBeenCalledWith([ "Todo" ]);

        // With something typed, backspace is the box's own to erase with.
        onCommit.mockClear();
        await typeInto(input, "Do");
        await act(async () => {
            input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }));
        });
        expect(onCommit).not.toHaveBeenCalled();
    });
});

describe("selectEntriesFor", () => {
    const options = [ "Todo", "In progress", "Done" ];

    it("offers every option unfiltered, and narrows to what the filter matches", () => {
        expect(selectEntriesFor({ options, filter: "" })).toEqual(options);
        // Matched anywhere in the option, ignoring case and surrounding space.
        expect(selectEntriesFor({ options, filter: " o " })).toEqual([ "Todo", "In progress", "Done" ]);
        expect(selectEntriesFor({ options, filter: "do" })).toEqual([ "Todo", "Done" ]);
        expect(selectEntriesFor({ options, filter: "PROG" })).toEqual([ "In progress" ]);
    });

    it("offers to create a filter that names no option, but only when asked", () => {
        const entries = selectEntriesFor({ options, filter: "Blocked", canCreate: true });
        expect(entries).toHaveLength(1);
        expect(isCreateEntry(entries[0])).toBe(true);
        expect(createdOption(entries[0])).toBe("Blocked");

        // Without the offer the list is simply empty, rather than inviting what cannot be done.
        expect(selectEntriesFor({ options, filter: "Blocked" })).toEqual([]);
        // An option named exactly is picked, not created — whatever its casing.
        expect(selectEntriesFor({ options, filter: "done", canCreate: true })).toEqual([ "Done" ]);
    });

    it("leaves out what is spoken for, without offering to create it afresh", () => {
        // The values a multi field holds are shown as chips, so offering them again invites a
        // duplicate it could not tell from the first.
        expect(selectEntriesFor({ options, filter: "", exclude: [ "Todo" ] }))
            .toEqual([ "In progress", "Done" ]);

        // Excluded, "Todo" no longer matches the list — but it is still an option that exists, so
        // typing it out must not offer to make a second one.
        expect(selectEntriesFor({ options, filter: "Todo", exclude: [ "Todo" ], canCreate: true }))
            .toEqual([]);
    });

    it("offers to create a value held but never declared, which is an option nowhere yet", () => {
        // A value left behind by an option since renamed away is held without being offered.
        const entries = selectEntriesFor({ options, filter: "Archived", exclude: [], canCreate: true });
        expect(entries.map(createdOption)).toEqual([ "Archived" ]);
    });
});
