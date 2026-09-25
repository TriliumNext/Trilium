import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { BoardDropStateContext, DropStateStore, useDropIndex, useIsDropTarget } from "./drop_state";

const COLUMNS = [ "a", "b", "c", "d", "e" ];

describe("where the gap stands", () => {
    let container: HTMLElement;
    let store: DropStateStore;
    let renders: Record<string, number>;

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
        store = new DropStateStore();
        renders = {};
        draw();
    });

    afterEach(() => {
        render(null, container);
        container.remove();
    });

    it("answers each column about itself alone", () => {
        expect(read("b")).toBe("- -");

        set({ column: "b", index: 2 });
        expect(read("a")).toBe("- -");
        expect(read("b")).toBe("2 target");
        expect(read("c")).toBe("- -");

        set(null);
        expect(read("b")).toBe("- -");
    });

    it("wakes the column the gap left and the one it arrived in, and no others", () => {
        set({ column: "b", index: 0 });
        const afterFirst = { ...renders };

        // Across the board in one step, which a fast pointer does: only the two columns whose own
        // answer changed are drawn again, however far apart they stand.
        set({ column: "e", index: 0 });
        expect(drawnSince(afterFirst)).toEqual([ "b", "e" ]);

        // A place in the same column moves the gap without changing any other column's answer.
        const afterSecond = { ...renders };
        set({ column: "e", index: 1 });
        expect(drawnSince(afterSecond)).toEqual([ "e" ]);
    });

    /** What one column holds, as a line, so a single assertion covers both answers. */
    function read(column: string) {
        return container.querySelector(`[data-column="${column}"]`)?.textContent;
    }

    function drawnSince(before: Record<string, number>) {
        return COLUMNS.filter(column => renders[column] !== before[column]);
    }

    function set(position: { column: string, index: number } | null) {
        act(() => { store.set({ position, target: position?.column ?? null }); });
    }

    function draw() {
        act(() => {
            render(
                <BoardDropStateContext.Provider value={store}>
                    {COLUMNS.map(column => <Watcher key={column} column={column} />)}
                </BoardDropStateContext.Provider>,
                container);
        });
    }

    function Watcher({ column }: { column: string }) {
        renders[column] = (renders[column] ?? 0) + 1;
        const index = useDropIndex(column);
        const isTarget = useIsDropTarget(column);
        return (
            <div data-column={column}>
                {`${index ?? "-"} ${isTarget ? "target" : "-"}`}
            </div>
        );
    }
});
