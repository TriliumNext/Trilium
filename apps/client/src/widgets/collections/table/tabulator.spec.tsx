import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import Tabulator from "./tabulator";

const calls: string[] = [];
const eventHandlers = new Map<string, Function[]>();

vi.mock("tabulator-tables", () => ({
    Tabulator: class {
        static registerModule() {}
        on(event: string, callback: Function) {
            const handlers = eventHandlers.get(event) ?? [];
            handlers.push(callback);
            eventHandlers.set(event, handlers);
            if (event === "tableBuilt") callback();
        }
        off(event: string, callback: Function) {
            const handlers = eventHandlers.get(event);
            if (handlers) {
                const idx = handlers.indexOf(callback);
                if (idx !== -1) handlers.splice(idx, 1);
            }
        }
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
        eventHandlers.clear();
    });

    it("sets new columns before new data, so the rows render after the scroll resets", async () => {
        await act(async () => render(<Tabulator columns={[ { title: "A", field: "a" } ]} data={[ { a: 1 } ]} />, container));
        calls.length = 0;

        // `setColumns()` scrolls to the top at once, while `replaceData()` renders in position a
        // microtask later: the other way round, it renders rows for a scroll offset since reset.
        await act(async () => render(<Tabulator columns={[ { title: "B", field: "b" } ]} data={[ { b: 1 } ]} />, container));

        expect(calls).toEqual([ "setColumns", "replaceData" ]);
    });

    it("updates column definition width when a resizable column is resized", async () => {
        const columnDef = { title: "Number", field: "attributes.number" } as any;
        await act(async () => render(<Tabulator columns={[ columnDef ]} data={[]} />, container));

        const resizedColumn = {
            getDefinition: () => columnDef,
            getWidth: () => 218
        };

        const handlers = eventHandlers.get("columnResized") ?? [];
        for (const handler of handlers) {
            handler(resizedColumn);
        }

        expect(columnDef.width).toBe(218);
    });

    it("does not update column definition width when column is not resizable", async () => {
        const columnDef = { title: "#", resizable: false, width: 40 } as any;
        await act(async () => render(<Tabulator columns={[ columnDef ]} data={[]} />, container));

        const resizedColumn = {
            getDefinition: () => columnDef,
            getWidth: () => 100
        };

        const handlers = eventHandlers.get("columnResized") ?? [];
        for (const handler of handlers) {
            handler(resizedColumn);
        }

        expect(columnDef.width).toBe(40);
    });
});
