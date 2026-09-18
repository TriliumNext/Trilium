import { type ComponentChildren, render } from "preact";
import { useEffect } from "preact/hooks";
import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SplitEditorProps } from "./SplitEditor";
import SvgSplitEditor from "./SvgSplitEditor";

// react-zoom-pan-pinch measures its boxes, which happy-dom cannot do. This fake keeps the parts the
// controls drive: `zoomIn`/`zoomOut` add their step to the current scale and clamp it to the given
// bounds, copying `handleCalculateButtonZoom`; `resetTransform` returns to the fitted view; and each
// change calls `onTransform`, which is what updates the readout. It also records the props, so the
// tests can assert what the component passes to the library.
const { transformWrapperSpy } = vi.hoisted(() => ({ transformWrapperSpy: vi.fn() }));

vi.mock("react-zoom-pan-pinch", async () => {
    const { forwardRef, useImperativeHandle, useRef } = await import("preact/compat");

    interface FakeProps {
        children?: ComponentChildren;
        minScale: number;
        maxScale: number;
        onTransform?: (ref: unknown, state: { scale: number }) => void;
    }

    return {
        TransformWrapper: forwardRef((props: FakeProps, ref) => {
            transformWrapperSpy(props);
            // One object, mutated in place: `useZoomPanPinch` reads `instance.state.scale` as a
            // button is pressed, so a fresh snapshot per render would be one step behind.
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
        TransformComponent: (props: { children?: ComponentChildren; wrapperClass?: string }) => (
            <div className={props.wrapperClass}>{props.children}</div>
        )
    };
});

// SplitEditor pulls in CodeMirror, Split.js and a Bootstrap ribbon that have nothing to do with
// the pan/zoom behavior under test; stub it down to just the preview pane and the controls over it,
// and fire the same `onContentChanged` callback the real editor would once content arrives.
vi.mock("./SplitEditor", () => ({
    default: ({ previewContent, previewButtons, onContentChanged }: SplitEditorProps) => {
        useEffect(() => {
            onContentChanged?.("gantt\nsection Test\nTask: 2024-01-01, 1d");
        }, []);
        return <div>{previewContent}{previewButtons}</div>;
    }
}));

// The bootstrap tooltip the control buttons wear needs real layout, which happy-dom hasn't.
vi.mock("../../react/hooks", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    useStaticTooltip: () => {}
}));

const ORIGINAL_VIEW_BOX = "0 0 1234 56";
const SVG_MARKUP = `<svg viewBox="${ORIGINAL_VIEW_BOX}" xmlns="http://www.w3.org/2000/svg">`
    + `<rect width="10" height="10"/></svg>`;

describe("SvgSplitEditor", () => {
    beforeEach(() => transformWrapperSpy.mockClear());

    it("renders the diagram inside the pan/zoom viewport, with its viewBox untouched", async () => {
        const { container, controls, unmount } = await mount();

        const svgEl = container.querySelector(".svg-preview-viewport .render-container svg");
        expect(svgEl).not.toBeNull();
        // The fit comes from the viewBox rather than from a measured scale, so nothing may strip it
        // — svg-pan-zoom used to, which shrank gantt charts to invisibility on a re-fit (#9749).
        expect(svgEl?.getAttribute("viewBox")).toBe(ORIGINAL_VIEW_BOX);

        expect(transformWrapperSpy).toHaveBeenCalledWith(
            expect.objectContaining({ minScale: 0.5, maxScale: 10 })
        );

        // Without a pointer the keys are the only way to pan, so the preview shows a hints button
        // alongside the three zoom steps.
        expect(controls().all.length).toBe(4);

        unmount();
        container.remove();
    });

    it("says the scale the diagram is drawn at, and fits it back to the pane when the readout is pressed", async () => {
        const { container, controls, unmount } = await mount();

        expect(controls().readout.textContent).toBe("100%");

        act(() => controls().zoomIn.click());
        expect(controls().readout.textContent).toBe("120%");

        act(() => controls().zoomIn.click());
        expect(controls().readout.textContent).toBe("144%");

        act(() => controls().readout.click());
        expect(controls().readout.textContent).toBe("100%");

        unmount();
        container.remove();
    });

    it("takes the keys on a press, in a split with the editor as much as on its own", async () => {
        // This matters most beside the editor: `smartIndentWithTab` consumes Tab, so a press on the
        // preview is the only way to reach the keys that pan the diagram.
        const modes: Record<string, string>[] = [ {}, { displayMode: "preview" } ];
        for (const labels of modes) {
            const { container, preview, unmount } = await mount(labels);

            expect(preview().tabIndex).toBe(0);
            expect(preview().className).toContain("tn-zoom-pan-viewport");

            act(() => { preview().dispatchEvent(new Event("pointerup", { bubbles: true })); });
            expect(document.activeElement).toBe(preview());

            unmount();
            container.remove();
        }
    });

    it("leaves a step with no room left to it disabled", async () => {
        const { container, controls, unmount } = await mount();

        expect(controls().zoomOut.disabled).toBe(false);

        // Far enough to be clamped at either end, so the readout sits exactly on the bound — which
        // is where the rounding the tolerance covers would otherwise leave the button live.
        for (let i = 0; i < 20; i++) act(() => controls().zoomOut.click());
        expect(controls().readout.textContent).toBe("50%");
        expect(controls().zoomOut.disabled).toBe(true);
        expect(controls().zoomIn.disabled).toBe(false);

        for (let i = 0; i < 30; i++) act(() => controls().zoomIn.click());
        expect(controls().readout.textContent).toBe("1000%");
        expect(controls().zoomIn.disabled).toBe(true);
        expect(controls().zoomOut.disabled).toBe(false);

        unmount();
        container.remove();
    });
});

/**
 * Mounts `SvgSplitEditor` and waits for the rendered diagram and its controls. `controls()` re-reads
 * the buttons on every call, because the group re-renders whenever the scale changes.
 */
async function mount(labels: Record<string, string> = {}) {
    const container = document.createElement("div");
    document.body.appendChild(container);

    await act(async () => {
        render(<SvgSplitEditor {...svgSplitEditorProps(SVG_MARKUP, labels)} />, container);
    });

    await vi.waitFor(() => expect(container.querySelectorAll(".svg-preview-controls button").length).toBeGreaterThanOrEqual(3));

    // The zoom steps are the last three on the group; the shortcut-hints button leads it.
    const controls = () => {
        const buttons = [ ...container.querySelectorAll<HTMLButtonElement>(".svg-preview-controls button") ];
        const [ zoomOut, readout, zoomIn ] = buttons.slice(-3);
        return { zoomOut, readout, zoomIn, all: buttons };
    };

    const preview = () => {
        const el = container.querySelector<HTMLDivElement>(".svg-preview-root");
        if (!el) throw new Error("Expected the preview viewport to be present.");
        return el;
    };

    return { container, controls, preview, unmount: () => act(() => render(null, container)) };
}

/**
 * Minimal props for `SvgSplitEditor`; SplitEditor is mocked away, so most of `SplitEditorProps`
 * is unused.
 */
function svgSplitEditorProps(svgMarkup: string, labels: Record<string, string> = {}) {
    const note = {
        noteId: "note1",
        title: "Gantt",
        getAttachments: async () => [],
        getLabelValue: (name: string) => labels[name] ?? null,
        isLabelTruthy: (name: string) => name in labels && labels[name] !== "false"
    };

    return {
        ntxId: "ntx1",
        note,
        noteContext: {},
        attachmentTitle: "gantt-export.svg",
        renderSvg: async () => svgMarkup
    } as unknown as Parameters<typeof SvgSplitEditor>[0];
}
