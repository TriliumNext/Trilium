// @vitest-environment happy-dom
import { type ComponentChildren, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import mountZoomPan, { ZoomViewer } from "./zoom_viewer.js";

// react-zoom-pan-pinch measures its boxes, which happy-dom cannot do. As in the client's
// `SvgSplitEditor.spec.tsx`, this fake keeps what the controls drive: `zoomIn`/`zoomOut` add their
// step to the scale within the bounds, `resetTransform` returns to the fitted view, and each change
// calls `onTransform`. It records the props the viewer passes to the library.
const { transformWrapperSpy } = vi.hoisted(() => ({ transformWrapperSpy: vi.fn() }));

vi.mock("react-zoom-pan-pinch", async () => {
    const { forwardRef, useImperativeHandle, useRef } = await import("preact/compat");

    interface FakeProps {
        children?: ComponentChildren;
        minScale: number;
        maxScale: number;
        onTransform?: (ref: unknown, state: { scale: number }) => void;
    }

    interface FakeComponentProps {
        children?: ComponentChildren;
        wrapperClass?: string;
        contentClass?: string;
    }

    return {
        TransformWrapper: forwardRef((props: FakeProps, ref) => {
            transformWrapperSpy(props);
            const state = useRef({ scale: 1 });
            const apply = (target: number) => {
                const rounded = Number(target.toFixed(3));
                state.current.scale = Math.min(props.maxScale, Math.max(props.minScale, rounded));
                props.onTransform?.(null, { scale: state.current.scale });
            };
            useImperativeHandle(ref, () => ({
                instance: { state: state.current },
                zoomIn: (step: number) => apply(state.current.scale + step),
                zoomOut: (step: number) => apply(state.current.scale - step),
                resetTransform: () => apply(1)
            }));
            return props.children;
        }),
        TransformComponent: (props: FakeComponentProps) => (
            <div className={props.wrapperClass}>
                <div className={props.contentClass}>{props.children}</div>
            </div>
        )
    };
});

describe("mountZoomPan", () => {
    afterEach(() => {
        const host = document.querySelector(".zoom-viewer")?.parentElement;
        if (host) {
            act(() => render(null, host));
        }
        document.body.innerHTML = "";
        transformWrapperSpy.mockClear();
    });

    it("moves the diagram into a labelled viewer in its place", () => {
        const diagram = mountDiagram();

        expect(document.querySelector("#content > div > .zoom-viewer:not(.fills-page)")).not.toBeNull();
        const viewport = document.querySelector(".zoom-viewer > .zoom-viewer-viewport");
        expect(viewport?.getAttribute("aria-label")).toBe("Diagram");
        expect(viewport?.getAttribute("tabindex")).toBe("0");
        expect(viewport?.querySelector(".zoom-viewer-content")?.contains(diagram)).toBe(true);
        expect(buttons().map((button) => button.title))
            .toEqual([ "Zoom out", "Reset zoom", "Zoom in" ]);
        expect(buttons().map((button) => button.getAttribute("aria-label")))
            .toEqual([ "Zoom out", null, "Zoom in" ]);
        expect(readout()).toBe("100%");
        expect(transformWrapperSpy).toHaveBeenLastCalledWith(expect.objectContaining({
            minScale: 0.5,
            maxScale: 10,
            wheel: { disabled: true },
            doubleClick: { mode: "reset" }
        }));
    });

    it("zooms in steps, pans only when zoomed in, and keeps the diagram it shows", () => {
        const diagram = mountDiagram();
        const [ zoomOut, reset, zoomIn ] = buttons();
        expect(lastProps().panning).toEqual({ disabled: true });

        act(() => zoomIn.click());
        expect(readout()).toBe("120%");
        expect(lastProps().panning).toEqual({ disabled: false });
        expect(document.querySelector(".zoom-viewer-content")?.contains(diagram)).toBe(true);

        act(() => reset.click());
        expect(readout()).toBe("100%");

        for (const expected of [ "83%", "69%", "58%", "50%" ]) {
            act(() => zoomOut.click());
            expect(readout()).toBe(expected);
        }
        expect(zoomOut.disabled).toBe(true);
        expect(zoomIn.disabled).toBe(false);
    });

    it("pans at any zoom when it takes the page", () => {
        document.body.innerHTML = `<div id="content"></div>`;
        const host = document.getElementById("content");
        if (!host) {
            throw new Error("The host is missing.");
        }

        act(() => render(<ZoomViewer labels={LABELS} fillsPage><svg /></ZoomViewer>, host));

        expect(document.querySelector("#content > .zoom-viewer.fills-page .zoom-viewer-content > svg"))
            .not.toBeNull();
        expect(lastProps().panning).toEqual({ disabled: false });
    });
});

const LABELS = {
    label: "Diagram",
    zoomIn: "Zoom in",
    zoomOut: "Zoom out",
    zoomReset: "Reset zoom"
};

/** Mounts a viewer over a drawn diagram in `#content` and returns the diagram. */
function mountDiagram() {
    document.body.innerHTML = `<div id="content"><div class="mermaid"><svg></svg></div></div>`;
    const diagram = document.querySelector<HTMLElement>(".mermaid");
    if (!diagram) {
        throw new Error("The diagram is missing.");
    }

    act(() => mountZoomPan(diagram, LABELS));
    return diagram;
}

function buttons() {
    return [ ...document.querySelectorAll<HTMLButtonElement>(".zoom-viewer-controls button") ];
}

function readout() {
    return document.querySelector(".zoom-viewer-reset")?.textContent;
}

function lastProps() {
    return transformWrapperSpy.mock.lastCall?.[0] as { panning?: { disabled: boolean } };
}
