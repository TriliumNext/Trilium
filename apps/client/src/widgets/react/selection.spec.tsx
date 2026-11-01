import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SelectionContext, SelectionStore, useIsSelected, useSelectionCount } from "./selection";

const ITEMS = [ "a", "b", "c", "d", "e" ];

describe("SelectionStore", () => {
    let store: SelectionStore;

    beforeEach(() => {
        store = new SelectionStore();
    });

    const selected = () => [ ...store.keys ];

    it("starts holding nothing", () => {
        expect(selected()).toEqual([]);
        expect(store.size).toBe(0);
        expect(store.anchor).toBeNull();
        expect(store.has("a")).toBe(false);
    });

    it("adds and removes one item at a time, keeping the rest", () => {
        store.toggle("b");
        store.toggle("d");
        expect(selected()).toEqual([ "b", "d" ]);

        store.toggle("b");
        expect(selected()).toEqual([ "d" ]);
        expect(store.has("b")).toBe(false);
    });

    it("takes one item on its own, dropping what was picked before", () => {
        store.toggle("b");
        store.toggle("d");
        store.selectOnly("a");

        expect(selected()).toEqual([ "a" ]);
        expect(store.anchor).toBe("a");
    });

    it("takes a whole list at once, with the anchor on its first item", () => {
        store.toggle("e");
        store.selectAll([ "a", "b", "c" ]);

        expect(selected()).toEqual([ "a", "b", "c" ]);
        expect(store.anchor).toBe("a");

        // A column holding nothing leaves the selection empty rather than as it was.
        store.selectAll([]);
        expect(selected()).toEqual([]);
        expect(store.anchor).toBeNull();
    });

    it("gives up everything at once", () => {
        store.toggle("b");
        store.clear();

        expect(selected()).toEqual([]);
        expect(store.anchor).toBeNull();
    });

    describe("a range", () => {
        it("covers everything between the anchor and the item picked, either way round", () => {
            store.toggle("b");
            store.selectRange(ITEMS, "d");
            expect(selected()).toEqual([ "b", "c", "d" ]);

            store.selectRange(ITEMS, "a");
            expect(selected()).toEqual([ "a", "b" ]);
        });

        it("replaces what was picked rather than adding to it", () => {
            store.toggle("a");
            store.toggle("e");
            // The anchor moved to `e` with the second pick, so the range runs from there.
            store.selectRange(ITEMS, "c");

            expect(selected()).toEqual([ "c", "d", "e" ]);
        });

        it("leaves the anchor where it stands, so a second range moves one end", () => {
            store.toggle("b");
            store.selectRange(ITEMS, "e");
            store.selectRange(ITEMS, "c");

            expect(store.anchor).toBe("b");
            expect(selected()).toEqual([ "b", "c" ]);
        });

        it("takes the item alone where there is no anchor to measure from", () => {
            store.selectRange(ITEMS, "c");

            expect(selected()).toEqual([ "c" ]);
            expect(store.anchor).toBe("c");
        });

        /**
         * The caller decides what a range can cover, which is one column of a board. An anchor set
         * in another column is not in the list, and the press takes the item it landed on alone.
         */
        it("takes the item alone where the anchor stands outside the list", () => {
            store.toggle("elsewhere");
            store.selectRange(ITEMS, "c");

            expect(selected()).toEqual([ "c" ]);
            expect(store.anchor).toBe("c");
        });

        it("does nothing at all for an item the list does not hold", () => {
            store.toggle("b");
            store.selectRange(ITEMS, "gone");

            expect(selected()).toEqual([ "b" ]);
        });
    });

    describe("pruning", () => {
        it("drops what the collection no longer holds and keeps the rest", () => {
            store.toggle("a");
            store.toggle("b");
            store.toggle("c");

            store.retain(new Set([ "a", "c", "z" ]));
            expect(selected()).toEqual([ "a", "c" ]);
        });

        it("gives the anchor up with the item it named", () => {
            store.toggle("a");
            store.toggle("b");

            store.retain(new Set([ "a" ]));
            expect(store.anchor).toBeNull();

            store.toggle("a");
            store.retain(new Set([ "a" ]));
            expect(store.anchor).toBe("a");
        });
    });
});

describe("what a change wakes", () => {
    let container: HTMLElement;
    let store: SelectionStore;
    let renders: Record<string, number>;

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
        store = new SelectionStore();
        renders = {};
        act(() => {
            render(
                <SelectionContext.Provider value={store}>
                    {ITEMS.map((key) => <Watcher key={key} item={key} />)}
                    <Counter />
                </SelectionContext.Provider>,
                container);
        });
    });

    afterEach(() => {
        render(null, container);
        container.remove();
    });

    it("answers each item about itself alone", () => {
        act(() => store.toggle("b"));

        expect(read("a")).toBe("-");
        expect(read("b")).toBe("selected");
        expect(count()).toBe("1");
    });

    it("wakes the item picked and the one dropped, and no others", () => {
        act(() => store.toggle("b"));
        const afterFirst = { ...renders };

        act(() => store.selectOnly("e"));
        expect(drawnSince(afterFirst)).toEqual([ "b", "e" ]);

        // Picking what is already picked changes nothing, so nothing is drawn again.
        const afterSecond = { ...renders };
        act(() => store.selectOnly("e"));
        expect(drawnSince(afterSecond)).toEqual([]);
    });

    function read(item: string) {
        return container.querySelector(`[data-item="${item}"]`)?.textContent;
    }

    function count() {
        return container.querySelector("[data-count]")?.textContent;
    }

    function drawnSince(before: Record<string, number>) {
        return ITEMS.filter((item) => renders[item] !== before[item]);
    }

    function Watcher({ item }: { item: string }) {
        renders[item] = (renders[item] ?? 0) + 1;
        const isSelected = useIsSelected(item);
        return <div data-item={item}>{isSelected ? "selected" : "-"}</div>;
    }

    function Counter() {
        return <div data-count>{useSelectionCount()}</div>;
    }
});
