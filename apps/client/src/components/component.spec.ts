import { describe, expect, it, vi } from "vitest";

import Component from "./component.js";

type Handler = (data: unknown) => unknown;

/** Registers `handler` for the `entitiesReloaded` event, which every froca hook subscribes to. */
function register(component: Component, handler: Handler) {
    component.registerHandler("entitiesReloaded" as never, handler);
}

describe("Component handlers", () => {
    it("holds each handler once, drops the one removed, and keeps the rest", () => {
        const component = new Component();
        const first = vi.fn();
        const second = vi.fn();

        register(component, first);
        register(component, first);
        register(component, second);
        component.handleEvent("entitiesReloaded" as never, {} as never);
        expect(first).toHaveBeenCalledTimes(1);
        expect(second).toHaveBeenCalledTimes(1);

        component.removeHandler("entitiesReloaded" as never, first);
        component.handleEvent("entitiesReloaded" as never, {} as never);
        expect(first).toHaveBeenCalledTimes(1);
        expect(second).toHaveBeenCalledTimes(2);

        // Removing what was never registered, and removing the last one twice over, are both
        // no-ops rather than errors: a hook tears down whether or not it ever subscribed.
        expect(() => component.removeHandler("entitiesReloaded" as never, first)).not.toThrow();
        component.removeHandler("entitiesReloaded" as never, second);
        component.handleEvent("entitiesReloaded" as never, {} as never);
        expect(second).toHaveBeenCalledTimes(2);
    });

    it("distributes to the handlers standing when the event went out", () => {
        const component = new Component();
        const late = vi.fn();
        const removed = vi.fn();
        // A hook subscribes and unsubscribes from inside a handler when an event makes it
        // re-render, and neither can disturb the round the event arrived in.
        const first = vi.fn(() => {
            register(component, late);
            component.removeHandler("entitiesReloaded" as never, removed);
        });

        register(component, first);
        register(component, removed);
        component.handleEvent("entitiesReloaded" as never, {} as never);
        expect(removed).toHaveBeenCalledTimes(1);
        expect(late).not.toHaveBeenCalled();

        component.handleEvent("entitiesReloaded" as never, {} as never);
        expect(removed).toHaveBeenCalledTimes(1);
        expect(late).toHaveBeenCalledTimes(1);
    });
});
