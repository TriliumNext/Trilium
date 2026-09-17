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
        fake.FakeTabulator.instances = [];
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        render(null, container);
        container.remove();
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

    function startEditing(tabulator: InstanceType<typeof fake.FakeTabulator>) {
        tabulator.element.classList.add("tabulator-editing");
    }

    /** Waits for the class MutationObserver's microtask and its deferred flush timer to run. */
    async function flush() {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
    }

    it("applies rows held during editing once the editor closes without a committed change", async () => {
        // Custom editors like SelectEditor can call success() with an unchanged value: Tabulator
        // clears the "tabulator-editing" class but fires neither "cellEdited" nor "cellEditCancelled".
        const tabulator = mount();
        startEditing(tabulator);

        const pending = [ { title: "pending" } ];
        renderTable(pending);
        expect(tabulator.replaceData).not.toHaveBeenCalled();

        tabulator.element.classList.remove("tabulator-editing");
        await flush();
        expect(tabulator.replaceData).toHaveBeenCalledTimes(1);
        expect(tabulator.replaceData).toHaveBeenLastCalledWith(pending);
    });

    it("applies held rows after a cancelled edit and ignores a stale cellEditCancelled trigger", async () => {
        const tabulator = mount();
        startEditing(tabulator);

        const pending = [ { title: "pending" } ];
        renderTable(pending);

        tabulator.element.classList.remove("tabulator-editing");
        await flush();
        expect(tabulator.replaceData).toHaveBeenCalledTimes(1);
        expect(tabulator.replaceData).toHaveBeenLastCalledWith(pending);

        // The component no longer subscribes to this event; a leftover call must not reapply.
        tabulator.handlers.get("cellEditCancelled")?.();
        await flush();
        expect(tabulator.replaceData).toHaveBeenCalledTimes(1);
    });

    it("skips the held snapshot on a committed change, applying the next update once idle", async () => {
        const tabulator = mount();
        startEditing(tabulator);

        const pending = [ { title: "pending" } ];
        renderTable(pending);

        // Tabulator dispatches "cellEdited" synchronously in the same task as the class removal.
        tabulator.element.classList.remove("tabulator-editing");
        tabulator.handlers.get("cellEdited")?.();
        await flush();
        expect(tabulator.replaceData).not.toHaveBeenCalled();

        const next = [ { title: "next" } ];
        renderTable(next);
        expect(tabulator.replaceData).toHaveBeenCalledTimes(1);
        expect(tabulator.replaceData).toHaveBeenLastCalledWith(next);
    });

    it("keeps rows held across a same-task Tab close-then-open of the editor", async () => {
        const tabulator = mount();
        startEditing(tabulator);

        renderTable([ { title: "pending" } ]);

        tabulator.element.classList.remove("tabulator-editing");
        tabulator.element.classList.add("tabulator-editing");
        await flush();
        expect(tabulator.replaceData).not.toHaveBeenCalled();
    });

    it("applies rows held in the next cell after Tab committed the previous one", async () => {
        const tabulator = mount();
        startEditing(tabulator);

        // Tab: the first cell commits and the editor of the next cell opens in the same task.
        tabulator.element.classList.remove("tabulator-editing");
        tabulator.handlers.get("cellEdited")?.();
        tabulator.element.classList.add("tabulator-editing");
        await flush();

        const pending = [ { title: "pending" } ];
        renderTable(pending);

        tabulator.element.classList.remove("tabulator-editing");
        await flush();
        expect(tabulator.replaceData).toHaveBeenCalledTimes(1);
        expect(tabulator.replaceData).toHaveBeenLastCalledWith(pending);
    });

    it("reads the class that the installed EditModule sets while an editor is open", async () => {
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

    it("does not apply held rows to a destroyed table", async () => {
        const disconnectSpy = vi.spyOn(MutationObserver.prototype, "disconnect");
        const tabulator = mount();
        startEditing(tabulator);

        renderTable([ { title: "second" } ]);
        tabulator.element.classList.remove("tabulator-editing");

        renderTable(null);
        expect(tabulator.destroy).toHaveBeenCalledTimes(1);
        expect(disconnectSpy).toHaveBeenCalled();

        await flush();
        expect(tabulator.replaceData).not.toHaveBeenCalled();
        disconnectSpy.mockRestore();
    });
});
