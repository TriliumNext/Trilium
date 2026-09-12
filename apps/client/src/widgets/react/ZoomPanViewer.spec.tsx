import { type ComponentChildren } from "preact";
import { forwardRef } from "preact/compat";
import { useImperativeHandle } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Component from "../../components/component";
import { collectShortcutHints } from "../../services/shortcut_hints";
import { renderInto } from "../../test/render";
import { ParentComponent } from "./react_utils";

// Capture the props handed to the zoom library without mounting it (it needs real layout), and stand
// in for the instance it exposes, whose content box the viewer measures in fit="measure".
const { transformWrapperSpy, contentRef } = vi.hoisted(() => ({
    transformWrapperSpy: vi.fn(),
    contentRef: { current: null as HTMLDivElement | null }
}));

vi.mock("react-zoom-pan-pinch", () => ({
    TransformWrapper: forwardRef((props: { children?: ComponentChildren }, ref) => {
        transformWrapperSpy(props);
        useImperativeHandle(ref, () => ({
            instance: { contentComponent: contentRef.current },
            resetTransform: () => {}
        }));
        return props.children;
    }),
    // Mirror the library's wrapper and content boxes so both class names can be observed.
    TransformComponent: (props: { children?: ComponentChildren; wrapperClass?: string; contentClass?: string }) => (
        <div className={props.wrapperClass}>
            <div ref={contentRef} className={props.contentClass}>{props.children}</div>
        </div>
    )
}));

// Keep the real hooks, but stub the bootstrap-Tooltip one, which needs real layout.
vi.mock("./hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./hooks")>()),
    useStaticTooltip: () => {}
}));

import ZoomPanViewer, { computeFitScale, ZOOM_PAN_HINTS } from "./ZoomPanViewer";

describe("ZoomPanViewer", () => {
    beforeEach(() => {
        transformWrapperSpy.mockClear();
    });

    it("renders its children in the content box and puts each class name on its own element", () => {
        const container = renderInto(
            <ZoomPanViewer
                viewportClassName="my-viewport"
                contentClassName="my-content"
                controlsClassName="my-controls"
            >
                <span className="payload">content</span>
            </ZoomPanViewer>
        );

        expect(container.querySelector(".my-content .payload")).not.toBeNull();
        expect(container.querySelector(".my-viewport .my-content")).not.toBeNull();
        expect(container.querySelector(".zoom-pan-viewer-root")).not.toBeNull();
        expect(container.querySelector(".my-controls")).not.toBeNull();
    });

    it("holds back the controls until the caller says it is ready", () => {
        const ready = renderInto(<ZoomPanViewer controlsClassName="my-controls"><span /></ZoomPanViewer>);
        expect(ready.querySelector(".my-controls")).not.toBeNull();

        const notReady = renderInto(
            <ZoomPanViewer ready={false} controlsClassName="my-controls"><span /></ZoomPanViewer>
        );
        expect(notReady.querySelector(".my-controls")).toBeNull();
    });

    it("wires up the interactive zoom behavior", () => {
        renderInto(<ZoomPanViewer><span /></ZoomPanViewer>);

        const props = transformWrapperSpy.mock.calls[0][0];
        expect(props.centerOnInit).toBe(true);
        expect(props.centerZoomedOut).toBe(true);
        expect(props.autoAlignment).toEqual({ disabled: true });
        expect(props.doubleClick).toEqual({ mode: "reset" });
        expect(props.initialScale).toBe(1);
        expect(props.wheel.step).toBe(0.0085);
        // The scale envelope is caller-tunable — assert the relationship, not exact values.
        expect(props.maxScale).toBeGreaterThan(props.minScale);
    });

    it("leaves the caller's minScale alone in css mode, where the content fits itself", () => {
        renderInto(<ZoomPanViewer minScale={2}><span /></ZoomPanViewer>);

        expect(transformWrapperSpy.mock.calls[0][0].minScale).toBe(2);
    });

    it("registers its hints on the host component, and no provider at all when given none", () => {
        const withHints = new Component();
        act(() => {
            renderInto(
                <ParentComponent.Provider value={withHints}>
                    <ZoomPanViewer hints={ZOOM_PAN_HINTS}><span /></ZoomPanViewer>
                </ParentComponent.Provider>
            );
        });
        expect(collectShortcutHints(withHints).map((section) => section.titleKey)).toEqual([
            "image_viewer.hints.zoom",
            "image_viewer.hints.pan"
        ]);

        // A viewer given no hints must leave the host's own provider in place, rather than displacing
        // it with an empty one.
        const withoutHints = new Component();
        withoutHints.getContextualShortcutHints = (collector) => collector.add({ titleKey: "host.section", hints: [] });
        act(() => {
            renderInto(
                <ParentComponent.Provider value={withoutHints}>
                    <ZoomPanViewer><span /></ZoomPanViewer>
                </ParentComponent.Provider>
            );
        });
        expect(collectShortcutHints(withoutHints).map((section) => section.titleKey)).toEqual([ "host.section" ]);
    });

    it("reports the on-screen size through nativeScale and hands the raw scale to onScaleChange", () => {
        const onScaleChange = vi.fn();
        const container = renderInto(
            <ZoomPanViewer nativeScale={(scale) => scale * 0.25} onScaleChange={onScaleChange}>
                <span />
            </ZoomPanViewer>
        );

        const { onTransform } = transformWrapperSpy.mock.calls[0][0];
        act(() => {
            onTransform(null, { scale: 2 });
        });

        expect(container.querySelector(".tn-overlay-text-button")?.textContent).toBe("50%");
        expect(onScaleChange).toHaveBeenCalledWith(2);
    });

    describe("with a measured viewport", () => {
        // happy-dom's ResizeObserver never fires and every box measures zero, so the viewport gets a
        // size here while the content keeps the 0x0 of content that renders after mount.
        beforeEach(() => {
            vi.stubGlobal("ResizeObserver", class {
                constructor(private readonly callback: () => void) {}
                observe() { this.callback(); }
                unobserve() {}
                disconnect() {}
            });
            vi.spyOn(HTMLElement.prototype, "getBoundingClientRect")
                .mockReturnValue({ width: 800, height: 600 } as DOMRect);
        });
        afterEach(() => {
            vi.unstubAllGlobals();
            vi.restoreAllMocks();
        });

        it("keeps content that has no size yet hidden, rather than showing it at scale 1", () => {
            let container: HTMLElement | undefined;
            act(() => {
                container = renderInto(
                    <ZoomPanViewer fit="measure" viewportClassName="my-viewport"><span /></ZoomPanViewer>
                );
            });

            expect(container?.querySelector(".my-viewport")?.classList.contains("fitting")).toBe(true);
        });

        it("never hides content that fits itself, which needs no measurement", () => {
            let container: HTMLElement | undefined;
            act(() => {
                container = renderInto(<ZoomPanViewer viewportClassName="my-viewport"><span /></ZoomPanViewer>);
            });

            expect(container?.querySelector(".my-viewport")?.classList.contains("fitting")).toBe(false);
        });
    });
});

describe("computeFitScale", () => {
    const viewport = (width: number, height: number) => ({ width, height });

    it("shrinks content larger than the viewport and grows content smaller than it", () => {
        // Both axes overflow by 2x, so the fit is the tighter (equal) of the two.
        expect(computeFitScale(viewport(800, 300), { width: 1600, height: 600 }, 0.5, 50)).toBe(0.5);
        // A small formula grows until the first axis fills: 400/100 = 4 before 300/20 = 15.
        expect(computeFitScale(viewport(400, 300), { width: 100, height: 20 }, 0.5, 50)).toBe(4);
    });

    it("stays within the caller's scale envelope", () => {
        expect(computeFitScale(viewport(400, 300), { width: 10, height: 10 }, 0.5, 8)).toBe(8);
        expect(computeFitScale(viewport(400, 300), { width: 8000, height: 6000 }, 0.2, 50)).toBe(0.2);
    });

    it("falls back to 1 for content that has no measured size", () => {
        expect(computeFitScale(viewport(400, 300), { width: 0, height: 0 }, 0.5, 50)).toBe(1);
        expect(computeFitScale(viewport(0, 0), { width: 100, height: 100 }, 0.5, 50)).toBe(1);
    });
});
