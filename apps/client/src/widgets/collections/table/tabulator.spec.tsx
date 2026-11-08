import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import Tabulator from "./tabulator";

const calls: string[] = [];

vi.mock("tabulator-tables", () => ({
    Tabulator: class {
        static registerModule() {}
        on(event: string, callback: () => void) {
            if (event === "tableBuilt") callback();
        }
        off() {}
        destroy() {}
        setColumns() { calls.push("setColumns"); }
        replaceData() { calls.push("replaceData"); }
    }
}));

describe("Tabulator", () => {
    const container = document.createElement("div");

    afterEach(() => {
        render(null, container);
        calls.length = 0;
    });

    it("sets new columns before new data, so the rows render after the scroll resets", async () => {
        await act(async () => render(<Tabulator columns={[ { title: "A", field: "a" } ]} data={[ { a: 1 } ]} />, container));
        calls.length = 0;

        // `setColumns()` scrolls to the top at once, while `replaceData()` renders in position a
        // microtask later: the other way round, it renders rows for a scroll offset since reset.
        await act(async () => render(<Tabulator columns={[ { title: "B", field: "b" } ]} data={[ { b: 1 } ]} />, container));

        expect(calls).toEqual([ "setColumns", "replaceData" ]);
    });
});
