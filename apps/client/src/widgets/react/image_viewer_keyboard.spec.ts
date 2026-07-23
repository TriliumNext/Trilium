import { describe, expect, it } from "vitest";

import { claimsKeystroke, clampPan, codeToControl, getPanDelta, zoomToPointPosition } from "./image_viewer_keyboard";

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

describe("claimsKeystroke", () => {
    const keystroke = (code: string, modifiers: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) =>
        ({ code, ctrlKey: false, metaKey: false, altKey: false, ...modifiers });

    it("takes bare keys, which are the viewer's own", () => {
        expect(claimsKeystroke(keystroke("KeyW"))).toBe(true);
        expect(claimsKeystroke(keystroke("ArrowLeft"))).toBe(true);
        expect(claimsKeystroke(keystroke("Equal"))).toBe(true);
    });

    it("leaves chords to the application, so Ctrl+W still closes the tab", () => {
        expect(claimsKeystroke(keystroke("KeyW", { ctrlKey: true }))).toBe(false);
        expect(claimsKeystroke(keystroke("ArrowUp", { ctrlKey: true }))).toBe(false);
        expect(claimsKeystroke(keystroke("Slash", { altKey: true }))).toBe(false);
        // The letter aliases for zoom are ordinary letters as far as the app is concerned (Ctrl+Q quits).
        expect(claimsKeystroke(keystroke("KeyE", { ctrlKey: true }))).toBe(false);
        expect(claimsKeystroke(keystroke("KeyQ", { ctrlKey: true }))).toBe(false);
    });

    it("keeps the zoom gesture, where the modifier is the point", () => {
        // Looking at an image, Ctrl+= zooms the image rather than the whole UI.
        expect(claimsKeystroke(keystroke("Equal", { ctrlKey: true }))).toBe(true);
        expect(claimsKeystroke(keystroke("Minus", { metaKey: true }))).toBe(true);
        expect(claimsKeystroke(keystroke("NumpadAdd", { ctrlKey: true }))).toBe(true);
        expect(claimsKeystroke(keystroke("NumpadSubtract", { ctrlKey: true }))).toBe(true);
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

describe("zoomToPointPosition", () => {
    it("leaves the position unchanged when the cursor sits on the content origin", () => {
        // Cursor at (posX0, posY0) → content point 0, so scaling moves nothing.
        expect(zoomToPointPosition(1, 50, 50, 3, 50, 50)).toEqual({ x: 50, y: 50 });
    });

    it("shifts the position so the cursor's content point stays under the cursor when zooming in", () => {
        // scale 1→2 at cursor (100,100) over origin: content point 100 must stay put → pos = 100 - 100*2.
        expect(zoomToPointPosition(1, 0, 0, 2, 100, 100)).toEqual({ x: -100, y: -100 });
    });

    it("shifts the other way when zooming out, from a non-zero starting transform", () => {
        // content point = (120-20)/2 = 50; new pos = 120 - 50*1 = 70 (x), (90-(-10))/2=50 → 90-50=40 (y).
        expect(zoomToPointPosition(2, 20, -10, 1, 120, 90)).toEqual({ x: 70, y: 40 });
    });

    it("keeps the cursor's content point invariant across the scale change", () => {
        const [ scale0, posX0, posY0, scale1, cursorX, cursorY ] = [ 1.5, 12, -8, 4.2, 230, 70 ];
        const { x, y } = zoomToPointPosition(scale0, posX0, posY0, scale1, cursorX, cursorY);
        expect((cursorX - x) / scale1).toBeCloseTo((cursorX - posX0) / scale0);
        expect((cursorY - y) / scale1).toBeCloseTo((cursorY - posY0) / scale0);
    });
});
