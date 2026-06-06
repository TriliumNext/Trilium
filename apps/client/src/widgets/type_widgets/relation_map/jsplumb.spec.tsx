import type { Defaults, jsPlumbInstance, OnConnectionBindInfo } from "jsplumb";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderComponent } from "../../../test/render";

// --- Module mocks (hoisted above the imports) ----------------------------------------------------

// The real jsplumb bundle is a heavy DOM library that does not behave under happy-dom; replace
// `jsPlumb.getInstance` with a factory returning a controllable fake instance recorded for assertions.
// Everything referenced inside the hoisted `vi.mock` factory must itself be hoisted.
const shared = vi.hoisted(() => {
    const makeFakeInstance = (config?: unknown): FakeInstance => ({
        config,
        bind: vi.fn(),
        unbind: vi.fn(),
        deleteEveryEndpoint: vi.fn(),
        cleanupListeners: vi.fn(),
        draggable: vi.fn(),
        makeSource: vi.fn(),
        makeTarget: vi.fn()
    });
    return { instances: [] as FakeInstance[], makeFakeInstance };
});
const makeFakeInstance = shared.makeFakeInstance;

interface FakeInstance {
    config: unknown;
    bind: ReturnType<typeof vi.fn>;
    unbind: ReturnType<typeof vi.fn>;
    deleteEveryEndpoint: ReturnType<typeof vi.fn>;
    cleanupListeners: ReturnType<typeof vi.fn>;
    draggable: ReturnType<typeof vi.fn>;
    makeSource: ReturnType<typeof vi.fn>;
    makeTarget: ReturnType<typeof vi.fn>;
}

vi.mock("jsplumb", () => ({
    jsPlumbInstance: class {},
    jsPlumb: {
        getInstance: vi.fn((config: unknown) => {
            const instance = shared.makeFakeInstance(config);
            shared.instances.push(instance);
            return instance;
        })
    }
}));

import { jsPlumb } from "jsplumb";

import { JsPlumb, JsPlumbItem } from "./jsplumb";

// --- Render helper -------------------------------------------------------------------------------

/** Returns the most recently created fake jsPlumb instance, throwing if none exists. */
function lastInstance() {
    const inst = shared.instances[shared.instances.length - 1];
    if (!inst) throw new Error("no jsPlumb instance created");
    return inst;
}

/** A non-empty Defaults object (the `container` key is omitted by the component's type). */
const baseProps: Omit<Defaults, "container"> = { Anchor: "Continuous" };

beforeEach(() => {
    shared.instances.length = 0;
    vi.clearAllMocks();
});

// --- JsPlumb wrapper -----------------------------------------------------------------------------

describe("JsPlumb", () => {
    it("renders the container, creates the instance with merged props and seeds the api/container refs", () => {
        const apiRef = { current: null as unknown as jsPlumbInstance };
        const containerRef = { current: null as unknown as HTMLElement };
        const onInstanceCreated = vi.fn();

        const { container: root } = renderComponent(
            <JsPlumb
                className="my-canvas"
                props={baseProps}
                apiRef={apiRef}
                containerRef={containerRef}
                onInstanceCreated={onInstanceCreated}
            >
                <span className="child" />
            </JsPlumb>
        );

        // The outer div carries the className and renders the children.
        const div = root.querySelector("div.my-canvas");
        expect(div).toBeTruthy();
        expect(div?.querySelector(".child")).toBeTruthy();

        // getInstance received the container + merged extra props.
        expect(jsPlumb.getInstance).toHaveBeenCalledTimes(1);
        const cfg = lastInstance().config as { Container: HTMLElement; Anchor: string };
        expect(cfg.Container).toBe(div);
        expect(cfg.Anchor).toBe("Continuous");

        // Both external refs and the instance-created callback received the new instance/container.
        expect(apiRef.current).toBe(lastInstance());
        expect(containerRef.current).toBe(div);
        expect(onInstanceCreated).toHaveBeenCalledWith(lastInstance());
    });

    it("works without optional refs/callbacks and tears the instance down on unmount", () => {
        const { unmount } = renderComponent(
            <JsPlumb props={baseProps}>
                <span />
            </JsPlumb>
        );
        const instance = lastInstance();
        expect(instance.deleteEveryEndpoint).not.toHaveBeenCalled();

        unmount();
        expect(instance.deleteEveryEndpoint).toHaveBeenCalledTimes(1);
        expect(instance.cleanupListeners).toHaveBeenCalledTimes(1);
    });

    it("binds the connection handler and unbinds it on unmount", () => {
        const onConnection = vi.fn();
        const { unmount } = renderComponent(
            <JsPlumb props={baseProps} onConnection={onConnection}>
                <span />
            </JsPlumb>
        );
        const instance = lastInstance();
        expect(instance.bind).toHaveBeenCalledWith("connection", onConnection);

        unmount();
        expect(instance.unbind).toHaveBeenCalledWith("connection", onConnection);
    });

    it("re-binds when the connection handler changes, unbinding the previous one", () => {
        const first = vi.fn();
        const second = vi.fn();
        const { rerender } = renderComponent(
            <JsPlumb props={baseProps} onConnection={first}>
                <span />
            </JsPlumb>
        );
        const instance = lastInstance();
        expect(instance.bind).toHaveBeenCalledWith("connection", first);

        // Re-render with a new handler → cleanup unbinds `first`, effect binds `second`.
        rerender(
            <JsPlumb props={baseProps} onConnection={second}>
                <span />
            </JsPlumb>
        );
        expect(instance.unbind).toHaveBeenCalledWith("connection", first);
        expect(instance.bind).toHaveBeenCalledWith("connection", second);
    });

    it("does not bind a connection handler when none is supplied", () => {
        renderComponent(
            <JsPlumb props={baseProps}>
                <span />
            </JsPlumb>
        );
        expect(lastInstance().bind).not.toHaveBeenCalled();
    });

    it("forwards the bound connection callback so it can be invoked with jsPlumb info", () => {
        const onConnection = vi.fn();
        renderComponent(
            <JsPlumb props={baseProps} onConnection={onConnection}>
                <span />
            </JsPlumb>
        );
        const bindCall = lastInstance().bind.mock.calls.find(c => c[0] === "connection");
        const handler = bindCall?.[1] as ((info: OnConnectionBindInfo, ev: Event) => void) | undefined;
        const info = {} as OnConnectionBindInfo;
        const ev = new Event("connection");
        handler?.(info, ev);
        expect(onConnection).toHaveBeenCalledWith(info, ev);
    });
});

// --- JsPlumbItem ---------------------------------------------------------------------------------

describe("JsPlumbItem", () => {
    function renderItem(itemProps: Parameters<typeof JsPlumbItem>[0]) {
        // JsPlumbItem reads the jsPlumb instance from context (provided by JsPlumb via apiRef) and runs
        // its config effects on mount. Preact runs child effects before parent effects, so the wrapper's
        // mount effect hasn't seeded `apiRef.current` yet by the time the item's effects fire. Pre-seed
        // the ref with a fake instance so the item's draggable/source/target effects have a target.
        const seeded = makeFakeInstance();
        const apiRef = { current: seeded as unknown as jsPlumbInstance };
        const { container: root } = renderComponent(
            <JsPlumb props={baseProps} apiRef={apiRef}>
                <JsPlumbItem {...itemProps} />
            </JsPlumb>
        );
        return { root, apiRef, instance: seeded };
    }

    it("renders an absolutely positioned div with passthrough props and children", () => {
        const onContextMenu = vi.fn();
        const { root } = renderItem({
            x: 12,
            y: 34,
            id: "item-1",
            className: "note-box",
            onContextMenu,
            children: <span className="inner" />
        });

        const item = root.querySelector("#item-1");
        expect(item).toBeTruthy();
        expect(item?.classList.contains("note-box")).toBe(true);
        expect(item?.querySelector(".inner")).toBeTruthy();
        const style = (item as HTMLElement | null)?.style;
        expect(style?.left).toBe("12px");
        expect(style?.top).toBe("34px");

        // The context-menu handler is wired through.
        item?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
        expect(onContextMenu).toHaveBeenCalledTimes(1);
    });

    it("registers draggable, source and target configs against the instance element", () => {
        const draggable = { cursor: "move", zIndex: 5 };
        const sourceConfig = { isSource: true };
        const targetConfig = { isTarget: true };
        const { root, instance } = renderItem({
            x: 0,
            y: 0,
            id: "item-cfg",
            draggable,
            sourceConfig,
            targetConfig,
            children: null
        });

        const item = root.querySelector("#item-cfg");
        expect(instance.draggable).toHaveBeenCalledWith(item, draggable);
        expect(instance.makeSource).toHaveBeenCalledWith(item, sourceConfig);
        expect(instance.makeTarget).toHaveBeenCalledWith(item, targetConfig);
    });

    it("skips configuration when no draggable/source/target options are given", () => {
        const { instance } = renderItem({ x: 1, y: 2, id: "item-bare", children: null });
        expect(instance.draggable).not.toHaveBeenCalled();
        expect(instance.makeSource).not.toHaveBeenCalled();
        expect(instance.makeTarget).not.toHaveBeenCalled();
    });

    it("does nothing when rendered without a jsPlumb context provider", () => {
        // No surrounding <JsPlumb> → useContext returns undefined and the config effects bail out.
        const { container: root } = renderComponent(
            <JsPlumbItem
                x={5}
                y={6}
                id="orphan"
                draggable={{ cursor: "move" }}
                sourceConfig={{ isSource: true }}
                targetConfig={{ isTarget: true }}
            >
                <span className="orphan-child" />
            </JsPlumbItem>
        );
        const item = root.querySelector("#orphan");
        expect(item).toBeTruthy();
        expect(item?.querySelector(".orphan-child")).toBeTruthy();
        // No instance is created at all without the wrapper.
        expect(shared.instances.length).toBe(0);
    });
});
