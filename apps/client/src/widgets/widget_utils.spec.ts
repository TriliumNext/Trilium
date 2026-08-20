import { describe, expect, it } from "vitest";

import { tabWheelAction } from "./widget_utils.js";

function wheelEvent(delta: { deltaY?: number; deltaX?: number }, modifiers: { ctrl?: boolean; alt?: boolean; shift?: boolean } = {}) {
    return {
        deltaY: delta.deltaY ?? 0,
        deltaX: delta.deltaX ?? 0,
        ctrlKey: modifiers.ctrl ?? false,
        altKey: modifiers.alt ?? false,
        shiftKey: modifiers.shift ?? false,
    } as WheelEvent;
}

function container(scrollWidth: number, clientWidth: number) {
    return { scrollWidth, clientWidth } as HTMLElement;
}

describe("tabWheelAction", () => {
    it("switches tabs when the row has nothing to scroll", () => {
        const row = container(500, 500);

        expect(tabWheelAction(wheelEvent({ deltaY: -3 }), row)).toBe("previous");
        expect(tabWheelAction(wheelEvent({ deltaY: 3 }), row)).toBe("next");
    });

    it("honors a horizontal wheel the same as a vertical one", () => {
        const row = container(500, 500);

        expect(tabWheelAction(wheelEvent({ deltaX: -3 }), row)).toBe("previous");
        expect(tabWheelAction(wheelEvent({ deltaX: 3 }), row)).toBe("next");
    })

    it("keeps the wheel for horizontal scrolling while the row overflows", () => {
        const row = container(1200, 500);

        expect(tabWheelAction(wheelEvent({ deltaY: -3 }), row)).toBeNull();
        expect(tabWheelAction(wheelEvent({ deltaY: 3 }), row)).toBeNull();
    });

    it("leaves modifier-held wheels to their owners", () => {
        const row = container(500, 500);

        expect(tabWheelAction(wheelEvent({ deltaY: 3 }, { ctrl: true }), row)).toBeNull();
        expect(tabWheelAction(wheelEvent({ deltaY: 3 }, { alt: true }), row)).toBeNull();
        expect(tabWheelAction(wheelEvent({ deltaY: 3 }, { shift: true }), row)).toBeNull();
    });

    it("ignores momentum ticks with no meaningful delta", () => {
        const row = container(500, 500);

        expect(tabWheelAction(wheelEvent({ deltaY: 0.4 }), row)).toBeNull();
    });
});
