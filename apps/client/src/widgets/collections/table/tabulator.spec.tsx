import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => {
    class FakeTabulator {
        static instances: FakeTabulator[] = [];
        static registerModule = vi.fn();

        handlers = new Map<string, () => void>();
        replaceData = vi.fn();
        setColumns = vi.fn();
        destroy = vi.fn();

        constructor(public element: HTMLElement) {
            FakeTabulator.instances.push(this);
        }

        on(name: string, callback: () => void) {
            this.handlers.set(name, callback);
        }

        off() {}
    }
    return { FakeTabulator };
});

vi.mock("tabulator-tables", () => ({ Tabulator: fake.FakeTabulator }));

import type Component from "../../../components/component";
import { ParentComponent } from "../../react/react_utils";
import Tabulator from "./tabulator";

interface Row {
    title: string;
}

describe("Tabulator", () => {
    let container: HTMLElement;

    beforeEach(() => {
        vi.useFakeTimers({ toFake: [ "setTimeout", "clearTimeout" ] });
        fake.FakeTabulator.instances = [];
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        render(null, container);
        container.remove();
        vi.useRealTimers();
    });

    function renderTable(data: Row[] | null) {
        const parent = { componentId: "table-cid" } as unknown as Component;
        act(() => {
            render(
                <ParentComponent.Provider value={parent}>
                    {data && <Tabulator data={data} columns={[]} />}
                </ParentComponent.Provider>,
                container
            );
        });
    }

    /** Mounts the table with a first set of rows and marks it built, as Tabulator does. */
    function mount() {
        renderTable([ { title: "first" } ]);
        const [ tabulator ] = fake.FakeTabulator.instances;
        expect(tabulator).toBeDefined();
        act(() => tabulator.handlers.get("tableBuilt")?.());
        return tabulator;
    }

    function cancelEdit(tabulator: InstanceType<typeof fake.FakeTabulator>) {
        const handler = tabulator.handlers.get("cellEditCancelled");
        expect(handler).toBeDefined();
        handler?.();
    }

    it("holds new rows while a cell editor is open and applies the latest once it closes", () => {
        const tabulator = mount();

        const second = [ { title: "second" } ];
        renderTable(second);
        expect(tabulator.replaceData).toHaveBeenCalledTimes(1);
        expect(tabulator.replaceData).toHaveBeenLastCalledWith(second);

        tabulator.element.classList.add("tabulator-editing");
        renderTable([ { title: "third" } ]);
        const fourth = [ { title: "fourth" } ];
        renderTable(fourth);
        expect(tabulator.replaceData).toHaveBeenCalledTimes(1);

        // The editor of the next cell is open by the time the timer runs.
        cancelEdit(tabulator);
        vi.runAllTimers();
        expect(tabulator.replaceData).toHaveBeenCalledTimes(1);

        tabulator.element.classList.remove("tabulator-editing");
        cancelEdit(tabulator);
        vi.runAllTimers();
        expect(tabulator.replaceData).toHaveBeenCalledTimes(2);
        expect(tabulator.replaceData).toHaveBeenLastCalledWith(fourth);

        cancelEdit(tabulator);
        vi.runAllTimers();
        expect(tabulator.replaceData).toHaveBeenCalledTimes(2);

        const fifth = [ { title: "fifth" } ];
        renderTable(fifth);
        expect(tabulator.replaceData).toHaveBeenCalledTimes(3);
        expect(tabulator.replaceData).toHaveBeenLastCalledWith(fifth);
    });

    it("reads the class that the installed EditModule sets while an editor is open", async () => {
        vi.useRealTimers();
        const { TabulatorFull } = await vi.importActual<typeof import("tabulator-tables")>("tabulator-tables");
        const table = new TabulatorFull(container, {
            data: [ { id: 1, title: "first" } ],
            columns: [ { title: "Title", field: "title", editor: "input" } ]
        });
        await new Promise<void>((resolve) => table.on("tableBuilt", resolve));

        const [ cell ] = table.getRows()[0].getCells();
        expect(table.element.classList.contains("tabulator-editing")).toBe(false);
        cell.edit(true);
        expect(table.element.classList.contains("tabulator-editing")).toBe(true);
        cell.cancelEdit();
        expect(table.element.classList.contains("tabulator-editing")).toBe(false);
        table.destroy();
    });

    it("does not apply held rows to a destroyed table", () => {
        const tabulator = mount();

        tabulator.element.classList.add("tabulator-editing");
        renderTable([ { title: "second" } ]);
        tabulator.element.classList.remove("tabulator-editing");
        cancelEdit(tabulator);

        renderTable(null);
        expect(tabulator.destroy).toHaveBeenCalledTimes(1);
        vi.runAllTimers();
        expect(tabulator.replaceData).not.toHaveBeenCalled();
    });
});
