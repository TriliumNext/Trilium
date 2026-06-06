import { describe, expect, it } from "vitest";

import { clampPan, codeToControl, getPanDelta } from "./image_viewer_keyboard";

describe("codeToControl", () => {
    it("maps zoom/reset keys (Equal/Minus/Slash, numpad, Q/E) regardless of modifiers", () => {
        expect(codeToControl("Equal")).toBe("zoomIn");
        expect(codeToControl("NumpadAdd")).toBe("zoomIn");
        expect(codeToControl("KeyE")).toBe("zoomIn");
        expect(codeToControl("Minus")).toBe("zoomOut");
        expect(codeToControl("NumpadSubtract")).toBe("zoomOut");
        expect(codeToControl("KeyQ")).toBe("zoomOut");
        expect(codeToControl("Slash")).toBe("reset");
        expect(codeToControl("NumpadDivide")).toBe("reset");
    });

    it("maps arrows and WASD to pan controls", () => {
        expect(codeToControl("ArrowUp")).toBe("panUp");
        expect(codeToControl("KeyW")).toBe("panUp");
        expect(codeToControl("ArrowDown")).toBe("panDown");
        expect(codeToControl("KeyS")).toBe("panDown");
        expect(codeToControl("ArrowLeft")).toBe("panLeft");
        expect(codeToControl("KeyA")).toBe("panLeft");
        expect(codeToControl("ArrowRight")).toBe("panRight");
        expect(codeToControl("KeyD")).toBe("panRight");
    });

    it("ignores unrelated keys", () => {
        expect(codeToControl("KeyZ")).toBeNull();
        expect(codeToControl("Space")).toBeNull();
    });
});

describe("getPanDelta", () => {
    it("translates the content opposite the viewed direction", () => {
        expect(getPanDelta([ "panRight" ], false, 1).dx).toBeLessThan(0);
        expect(getPanDelta([ "panLeft" ], false, 1).dx).toBeGreaterThan(0);
        expect(getPanDelta([ "panUp" ], false, 1).dy).toBeGreaterThan(0);
        expect(getPanDelta([ "panDown" ], false, 1).dy).toBeLessThan(0);
    });

    it("cancels opposing keys and scales by elapsed time", () => {
        expect(getPanDelta([ "panLeft", "panRight" ], false, 1)).toEqual({ dx: 0, dy: 0 });
        const slow = getPanDelta([ "panRight" ], false, 0.5).dx;
        const fast = getPanDelta([ "panRight" ], false, 1).dx;
        expect(fast).toBe(slow * 2);
    });

    it("speeds up while Shift is held", () => {
        const normal = Math.abs(getPanDelta([ "panRight" ], false, 1).dx);
        const fast = Math.abs(getPanDelta([ "panRight" ], true, 1).dx);
        expect(fast).toBeGreaterThan(normal);
    });
});

describe("clampPan", () => {
    const bounds = { minPositionX: -100, maxPositionX: 0, minPositionY: -50, maxPositionY: 0 };

    it("leaves an in-bounds position unchanged", () => {
        expect(clampPan(-40, -20, bounds)).toEqual({ x: -40, y: -20 });
    });

    it("clamps a position past either edge", () => {
        expect(clampPan(20, 20, bounds)).toEqual({ x: 0, y: 0 });
        expect(clampPan(-200, -200, bounds)).toEqual({ x: -100, y: -50 });
    });
});
