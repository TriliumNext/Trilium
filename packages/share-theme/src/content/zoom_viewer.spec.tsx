// @vitest-environment happy-dom
import { type ComponentChildren, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ZoomViewer } from "./zoom_viewer.js";

// The real modules reach `window.glob`, which only the app's boot script defines, and the
// Bootstrap tooltip needs real layout.
vi.mock("@triliumnext/client/src/widgets/react/hooks.js", () => ({ useStaticTooltip: () => {} }));
vi.mock("@triliumnext/client/src/services/i18n.js", () => ({ t: (key: string) => key }));

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

describe("ZoomViewer", () => {
    afterEach(() => {
        const host = document.getElementById("content");
        if (host) {
            act(() => render(null, host));
        }
        document.body.innerHTML = "";
        transformWrapperSpy.mockClear();
    });

    it("shows its content in a labelled viewer with the app's zoom controls", () => {
        const diagram = mountViewer();

        expect(document.querySelector("#content > .zoom-viewer")).not.toBeNull();
        const viewport = document.querySelector(".zoom-viewer > .zoom-viewer-viewport");
        expect(viewport?.getAttribute("aria-label")).toBe("Diagram");
        expect(viewport?.getAttribute("tabindex")).toBe("0");
        expect(viewport?.querySelector(".zoom-viewer-content")?.contains(diagram)).toBe(true);
        const group = document.querySelector(".zoom-viewer > .tn-overlay-control-group");
        expect(group?.classList.contains("zoom-viewer-controls")).toBe(true);
        expect(group?.getAttribute("data-placement")).toBe("bottom-end");
        expect(buttons().map((button) => button.getAttribute("aria-label")))
            .toEqual([ "zoom_controls.zoom_out", null, "zoom_controls.zoom_in" ]);
        expect(readout()).toBe("100%");
        expect(transformWrapperSpy).toHaveBeenLastCalledWith(expect.objectContaining({
            minScale: 0.5,
            maxScale: 10,
            wheel: { disabled: true },
            doubleClick: { mode: "reset" }
        }));
        expect(lastProps().panning).toBeUndefined();
    });

    it("zooms in steps and keeps the content it shows", () => {
        const diagram = mountViewer();
        const [ zoomOut, reset, zoomIn ] = buttons();

        act(() => zoomIn.click());
        expect(readout()).toBe("120%");
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
});

/** Mounts a viewer over a drawing in `#content` and returns the drawing. */
function mountViewer() {
    document.body.innerHTML = `<div id="content"></div>`;
    const host = document.getElementById("content");
    if (!host) {
        throw new Error("The host is missing.");
    }

    act(() => render(<ZoomViewer label="Diagram"><svg /></ZoomViewer>, host));
    const drawing = host.querySelector("svg");
    if (!drawing) {
        throw new Error("The drawing is missing.");
    }
    return drawing;
}

function buttons() {
    return [ ...document.querySelectorAll<HTMLButtonElement>(".zoom-viewer-controls button") ];
}

function readout() {
    return document.querySelector(".zoom-viewer-controls .tn-overlay-text-button")?.textContent;
}

function lastProps() {
    return transformWrapperSpy.mock.lastCall?.[0] as { panning?: { disabled: boolean } };
}
