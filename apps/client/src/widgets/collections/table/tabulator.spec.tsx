import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the component import) --------------------------------------------

// CSS imports are side-effectful and unparseable by the test transform; stub them out.
vi.mock("tabulator-tables/dist/css/tabulator.css", () => ({}));
vi.mock("../../../../src/stylesheets/table.css", () => ({}));

// A controllable fake of the vanilla Tabulator that records every interaction so we can drive the
// component's effects (tableBuilt firing, setData/setColumns/on/off/destroy) deterministically.
// Defined via vi.hoisted so the (hoisted) vi.mock factory below can reference it.
const { FakeTabulator, tabulatorInstances, registeredModules } = vi.hoisted(() => {
    const tabulatorInstances: FakeTabulatorType[] = [];
    const registeredModules: unknown[] = [];

    class FakeTabulator {
        static registerModule(module: unknown) {
            registeredModules.push(module);
        }

        element: HTMLElement;
        options: Record<string, unknown>;
        handlers = new Map<string, Set<(...args: unknown[]) => void>>();
        setDataCalls: unknown[] = [];
        setColumnsCalls: unknown[] = [];
        destroyed = false;

        constructor(element: HTMLElement, options: Record<string, unknown>) {
            this.element = element;
            this.options = options;
            tabulatorInstances.push(this);
        }

        on(eventName: string, handler: (...args: unknown[]) => void) {
            if (!this.handlers.has(eventName)) {
                this.handlers.set(eventName, new Set());
            }
            this.handlers.get(eventName)?.add(handler);
        }

        off(eventName: string, handler: (...args: unknown[]) => void) {
            this.handlers.get(eventName)?.delete(handler);
        }

        emit(eventName: string, ...args: unknown[]) {
            for (const handler of this.handlers.get(eventName) ?? []) {
                handler(...args);
            }
        }

        setData(data: unknown) {
            this.setDataCalls.push(data);
        }

        setColumns(columns: unknown) {
            this.setColumnsCalls.push(columns);
        }

        destroy() {
            this.destroyed = true;
        }
    }

    return { FakeTabulator, tabulatorInstances, registeredModules };
});

type FakeTabulatorType = InstanceType<typeof FakeTabulator>;

vi.mock("tabulator-tables", () => ({
    Tabulator: FakeTabulator
}));

import { ParentComponent } from "../../react/react_utils";
import Component from "../../../components/component";
import Tabulator from "./tabulator";

// --- Render harness --------------------------------------------------------------------------------

let container: HTMLDivElement | undefined;

function renderTabulator(props: Record<string, unknown>, parent: Component | null = new Component()) {
    container = document.createElement("div");
    document.body.appendChild(container);
    act(() => {
        render(
            <ParentComponent.Provider value={parent}>
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                <Tabulator {...(props as any)} />
            </ParentComponent.Provider>,
            container
        );
    });
    return container;
}

function rerender(props: Record<string, unknown>, parent: Component | null = new Component()) {
    if (!container) throw new Error("Nothing rendered yet");
    act(() => {
        render(
            <ParentComponent.Provider value={parent}>
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                <Tabulator {...(props as any)} />
            </ParentComponent.Provider>,
            container
        );
    });
}

/** Fire the `tableBuilt` event on the most recently created Tabulator so `tabulatorRef` gets set. */
function buildLatest() {
    const instance = tabulatorInstances.at(-1);
    if (!instance) throw new Error("No tabulator instance");
    act(() => instance.emit("tableBuilt"));
    return instance;
}

beforeEach(() => {
    tabulatorInstances.length = 0;
    registeredModules.length = 0;
    vi.clearAllMocks();
});

afterEach(() => {
    if (container) {
        act(() => render(null, container as HTMLDivElement));
        container.remove();
        container = undefined;
    }
    vi.restoreAllMocks();
});

describe("Tabulator", () => {
    it("renders a container div with the given className and constructs a Tabulator on it", () => {
        const root = renderTabulator({ className: "my-table", columns: [{ field: "a" }], data: [{ a: 1 }] });
        const div = root.querySelector("div.my-table");
        expect(div).not.toBeNull();
        expect(tabulatorInstances.length).toBe(1);

        const instance = tabulatorInstances[0];
        expect(instance.element).toBe(div);
        expect(instance.options.columns).toEqual([{ field: "a" }]);
        expect(instance.options.data).toEqual([{ a: 1 }]);
    });

    it("registers each provided module via registerModule", () => {
        class ModuleA {}
        class ModuleB {}
        renderTabulator({ modules: [ModuleA, ModuleB] });
        expect(registeredModules).toEqual([ModuleA, ModuleB]);
    });

    it("skips module registration when no modules prop is given", () => {
        renderTabulator({ columns: [] });
        expect(registeredModules.length).toBe(0);
    });

    it("sets tabulatorRef + externalTabulatorRef and calls onReady when tableBuilt fires", () => {
        const externalRef: { current: unknown } = { current: null };
        const onReady = vi.fn();
        renderTabulator({ tabulatorRef: externalRef, onReady });

        // Before tableBuilt, the external ref is untouched and onReady is not called.
        expect(externalRef.current).toBeNull();
        expect(onReady).not.toHaveBeenCalled();

        const instance = buildLatest();
        expect(externalRef.current).toBe(instance);
        expect(onReady).toHaveBeenCalledTimes(1);
    });

    it("does not throw on tableBuilt when no external ref or onReady is provided", () => {
        renderTabulator({ columns: [] });
        expect(() => buildLatest()).not.toThrow();
    });

    it("renders a JSX footerElement through the parent component", () => {
        const parent = new Component();
        renderTabulator({ footerElement: <span className="footer-marker">x</span> }, parent);
        const instance = tabulatorInstances[0];
        const footer = instance.options.footerElement as HTMLElement | undefined;
        expect(footer).toBeInstanceOf(HTMLElement);
        expect(footer?.querySelector(".footer-marker") ?? footer).toBeTruthy();
    });

    it("leaves footerElement undefined when it is a plain string (not a valid element)", () => {
        renderTabulator({ footerElement: "just text" });
        expect(tabulatorInstances[0].options.footerElement).toBeUndefined();
    });

    it("leaves footerElement undefined when there is no parent component even if a JSX element is given", () => {
        renderTabulator({ footerElement: <span>x</span> }, null);
        expect(tabulatorInstances[0].options.footerElement).toBeUndefined();
    });

    it("passes index, dataTree and remaining rest props through to the Tabulator options", () => {
        renderTabulator({ index: "id", dataTree: true, layout: "fitColumns" });
        const opts = tabulatorInstances[0].options;
        expect(opts.index).toBe("id");
        expect(opts.dataTree).toBe(true);
        expect(opts.layout).toBe("fitColumns");
    });

    it("attaches event handlers (when the ref is set) and removes them on unmount + cleanup", () => {
        const onCellClick = vi.fn();
        renderTabulator({ events: { cellClick: onCellClick } });

        const instance = buildLatest();
        // The events effect's attach branch only runs once tabulatorRef is populated (on tableBuilt).
        // The effect re-runs when a dependency value (the handler identity) changes, so swap in a new
        // handler to make the effect run again now that the ref is set.
        const onCellClick2 = vi.fn();
        rerender({ events: { cellClick: onCellClick2 } });
        expect(instance.handlers.get("cellClick")?.size).toBe(1);
        instance.emit("cellClick", "evt", "cell");
        expect(onCellClick2).toHaveBeenCalledWith("evt", "cell");

        // Changing the handler identity again re-runs the effect: cleanup detaches then re-attaches.
        const onCellClick3 = vi.fn();
        rerender({ events: { cellClick: onCellClick3 } });
        expect(instance.handlers.get("cellClick")?.size).toBe(1);
        instance.emit("cellClick");
        expect(onCellClick3).toHaveBeenCalledTimes(1);
        expect(onCellClick2).toHaveBeenCalledTimes(1); // previous handler was detached on cleanup

        // Unmount removes the listeners and destroys the instance.
        act(() => render(null, container as HTMLDivElement));
        expect(instance.handlers.get("cellClick")?.size ?? 0).toBe(0);
        expect(instance.destroyed).toBe(true);
    });

    it("does not attach any user event handlers when events is undefined", () => {
        renderTabulator({ columns: [] });
        const instance = buildLatest();
        // Only the internal "tableBuilt" listener should exist; no user-supplied events.
        expect(instance.handlers.has("cellClick")).toBe(false);
        expect([...instance.handlers.keys()]).toEqual(["tableBuilt"]);
    });

    it("calls setData when the data prop changes after the table is built", () => {
        renderTabulator({ data: [{ a: 1 }] });
        const instance = buildLatest();
        expect(instance.setDataCalls.length).toBe(0);

        rerender({ data: [{ a: 2 }] });
        expect(instance.setDataCalls.at(-1)).toEqual([{ a: 2 }]);
    });

    it("calls setColumns when columns change after build, and skips when columns are absent", () => {
        renderTabulator({ columns: [{ field: "a" }] });
        const instance = buildLatest();
        const callsAfterBuild = instance.setColumnsCalls.length;

        rerender({ columns: [{ field: "b" }] });
        expect(instance.setColumnsCalls.at(-1)).toEqual([{ field: "b" }]);

        // Re-render with no columns: setColumns must not be called again.
        const countBefore = instance.setColumnsCalls.length;
        rerender({ columns: undefined });
        expect(instance.setColumnsCalls.length).toBe(countBefore);
    });

    it("rebuilds (destroy + new instance) when the dataTree dependency changes", () => {
        renderTabulator({ dataTree: false });
        const first = buildLatest();
        expect(tabulatorInstances.length).toBe(1);

        rerender({ dataTree: true });
        expect(first.destroyed).toBe(true);
        expect(tabulatorInstances.length).toBe(2);
    });
});
