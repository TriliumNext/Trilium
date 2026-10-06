import type { ExcalidrawImperativeAPI, ExcalidrawProps } from "@excalidraw/excalidraw/types";
import { type ComponentChildren, type RefObject, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CanvasEditorProps } from "./Canvas";

const excalidrawProps = vi.fn((_props: ExcalidrawProps) => undefined);
vi.mock("@excalidraw/excalidraw", () => ({
    Excalidraw: (props: ExcalidrawProps) => {
        excalidrawProps(props);
        return (
            <div className="mock-excalidraw excalidraw-container">
                {props.children as ComponentChildren}
            </div>
        );
    }
}));
vi.mock("../../react/hooks", async (importOriginal) => ({
    ...await importOriginal<typeof import("../../react/hooks")>(),
    useTriliumOption: () => [ "en" ]
}));

const { CanvasEditor } = await import("./Canvas");

describe("CanvasEditor", () => {
    let container: HTMLElement;
    let refresh: ReturnType<typeof vi.fn>;
    let apiRef: RefObject<ExcalidrawImperativeAPI | null>;
    /** The position of the container as Excalidraw last read it; happy-dom places it at 0, 0. */
    let offsets: { offsetLeft: number; offsetTop: number };

    beforeEach(() => {
        excalidrawProps.mockClear();
        offsets = { offsetLeft: 0, offsetTop: 0 };
        refresh = vi.fn(() => {
            offsets = { offsetLeft: 0, offsetTop: 0 };
        });
        apiRef = {
            current: { refresh, getAppState: () => offsets } as unknown as ExcalidrawImperativeAPI
        };
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        render(null, container);
        container.remove();
    });

    async function mount(props: Partial<CanvasEditorProps> = {}) {
        await act(async () => {
            render(
                <CanvasEditor
                    apiRef={apiRef}
                    isReadOnly={false}
                    colorScheme="light"
                    persistence={{}}
                    {...props}
                />,
                container
            );
        });
        const excalidraw = container.querySelector(".canvas-render .mock-excalidraw");
        expect(excalidraw).not.toBeNull();
        return excalidraw;
    }

    function point(target: Element | null) {
        for (const type of [ "pointerover", "pointermove" ]) {
            target?.dispatchEvent(new PointerEvent(type, { bubbles: true }));
        }
    }

    it("reads its position again before pointer input once the drawing moved", async () => {
        const excalidraw = await mount({ isEmbedded: true });
        point(excalidraw);
        expect(refresh).not.toHaveBeenCalled();

        // The note scrolled, so the position that Excalidraw read last is out of date.
        offsets = { offsetLeft: 0, offsetTop: 120 };
        point(excalidraw);
        expect(refresh).toHaveBeenCalledTimes(1);
        expect(excalidrawProps).toHaveBeenLastCalledWith(expect.objectContaining({ detectScroll: true }));
    });

    it("leaves the position to Excalidraw in a canvas note, which does not move", async () => {
        const excalidraw = await mount();
        offsets = { offsetLeft: 0, offsetTop: 120 };
        point(excalidraw);

        expect(refresh).not.toHaveBeenCalled();
        expect(excalidrawProps).toHaveBeenLastCalledWith(expect.objectContaining({ detectScroll: false }));
    });

    it("renders its children inside Excalidraw", async () => {
        const excalidraw = await mount({
            isEmbedded: true,
            children: <span className="excalidraw-child" />
        });

        expect(excalidraw?.querySelector(".excalidraw-child")).not.toBeNull();
    });

    it("keeps Excalidraw's desktop layout at any size only with `isDesktopLayout`", async () => {
        const getFormFactor = () => excalidrawProps.mock.lastCall?.[0].UIOptions?.getFormFactor;

        await mount({ isDesktopLayout: true });
        const desktopFormFactor = getFormFactor();
        expect(desktopFormFactor?.(320, 200)).toBe("desktop");

        // Excalidraw renders again when a function in `UIOptions` changes.
        await mount({ isDesktopLayout: true, isReadOnly: true });
        expect(getFormFactor()).toBe(desktopFormFactor);

        await mount();
        expect(getFormFactor()).toBeUndefined();
    });
});
