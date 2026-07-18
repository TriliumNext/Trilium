import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

/**
 * Guards the vendored fix for Trilium issue #10493 (extends excalidraw/excalidraw#8562).
 *
 * Trilium relocates Excalidraw's properties panel (`.App-menu__left`) to the right edge of the
 * canvas (see `canvas.css`). Stock `getEditorUIOffsets()` assumes that panel is left-docked and
 * derives the left inset from its right edge, so once it's on the right the left inset balloons to
 * ~the full width, the zoom-to-fit viewport collapses, and creating a flowchart node (Cmd/Ctrl+
 * Arrow), Zoom-to-fit (Shift+1) etc. snap the canvas to minimum zoom.
 *
 * The patch replaces that with the layout-agnostic computation mirrored by `computeUIOffsets`
 * below. The first test guards that the patch is still applied to the installed bundle; the second
 * pins the geometry. Keep `computeUIOffsets` in sync with the patch body.
 */
describe("excalidraw getEditorUIOffsets patch (#10493)", () => {
    it("keeps the layout-agnostic offset patch applied to the installed bundle", () => {
        const require = createRequire(import.meta.url);
        const source = readFileSync(require.resolve("@excalidraw/excalidraw"), "utf8").replace(/\s+/g, "");

        // Unique to the patch: insets are derived from the container's horizontal center.
        expect(source).toContain("this.state.offsetLeft+this.state.width/2");
        // The original side-hardcoded left inset must be gone.
        expect(source).not.toContain("left:Math.max(n?.right??0,0)+i");
    });

    it("assigns a right-docked panel to the right inset instead of collapsing the viewport", () => {
        // Real values captured from a Trilium canvas note (#10493): container inset by offsetLeft,
        // properties panel relocated to the right edge (~[1431, 1642] in window coords).
        const offsetLeft = 380.9;
        const width = 1277;
        const propertiesPanel = { left: 1431, right: 1642 };

        const offsets = computeUIOffsets({ offsetLeft, width, toolbarBottom: 154, offsetTop: 94, propertiesPanel });
        const availableWidth = width - offsets.left - offsets.right;

        expect(offsets.right).toBeGreaterThan(offsets.left); // panel counted on the right, not the left
        expect(availableWidth).toBeGreaterThan(width * 0.75); // viewport not collapsed (was ~0 before)
    });

    it("still treats a default left-docked panel as a left inset", () => {
        // Fullscreen Excalidraw (excalidraw.com): container at origin, ~200px panel on the left.
        const offsets = computeUIOffsets({
            offsetLeft: 0,
            width: 1200,
            toolbarBottom: 60,
            offsetTop: 0,
            propertiesPanel: { left: 0, right: 200 }
        });

        expect(offsets.left).toBeGreaterThan(offsets.right);
    });
});

const PADDING = 16;

interface Rect {
    left: number;
    right: number;
}

interface OffsetInputs {
    offsetLeft: number;
    offsetTop: number;
    width: number;
    toolbarBottom: number;
    propertiesPanel?: Rect;
    sidebar?: Rect;
}

/** Pure mirror of the patched `getEditorUIOffsets` geometry — see the patch and file docblock. */
function computeUIOffsets({ offsetLeft, offsetTop, width, toolbarBottom, propertiesPanel, sidebar }: OffsetInputs) {
    const containerCenter = offsetLeft + width / 2;
    let left = 0;
    let right = 0;
    for (const rect of [propertiesPanel, sidebar]) {
        if (!rect) continue;
        if ((rect.left + rect.right) / 2 > containerCenter) {
            right = Math.max(right, offsetLeft + width - rect.left);
        } else {
            left = Math.max(left, rect.right - offsetLeft);
        }
    }
    return { top: (toolbarBottom - offsetTop) + PADDING, right: right + PADDING, bottom: PADDING, left: left + PADDING };
}
