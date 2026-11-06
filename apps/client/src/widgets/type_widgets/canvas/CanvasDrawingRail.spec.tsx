import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { render } from "preact";
import { useRef } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RAIL_EXIT_MS } from "../../react/OverlayRail";

const translate = vi.hoisted(() => (key: string) => `t:${key}`);
vi.mock("@excalidraw/excalidraw", () => ({
    useI18n: () => ({ t: translate, langCode: "en" })
}));

const { default: CanvasDrawingRail } = await import("./CanvasDrawingRail");

/** A footer button of Excalidraw's phone layout, by the key of its label. */
interface FooterButton {
    label: string;
    isShown: boolean;
    isSelected?: boolean;
}

class MockIntersectionObserver {
    static instances: MockIntersectionObserver[] = [];
    observe = vi.fn();
    disconnect = vi.fn();

    constructor(readonly callback: IntersectionObserverCallback) {
        MockIntersectionObserver.instances.push(this);
    }

    report(isIntersecting: boolean) {
        this.callback(
            [ { isIntersecting } as IntersectionObserverEntry ],
            this as unknown as IntersectionObserver);
    }
}

describe("CanvasDrawingRail", () => {
    let container: HTMLElement;
    let realIntersectionObserver: typeof IntersectionObserver;
    const clicked: string[] = [];
    const api = {
        getAppState: vi.fn<() => Pick<AppState, "openMenu">>(),
        updateScene: vi.fn()
    };

    beforeEach(() => {
        vi.useFakeTimers();
        api.getAppState.mockReset().mockReturnValue({ openMenu: null });
        api.updateScene.mockReset();
        MockIntersectionObserver.instances = [];
        realIntersectionObserver = window.IntersectionObserver;
        window.IntersectionObserver =
            MockIntersectionObserver as unknown as typeof IntersectionObserver;
        container = document.createElement("div");
        document.body.appendChild(container);
        clicked.length = 0;
    });

    afterEach(() => {
        render(null, container);
        container.remove();
        window.IntersectionObserver = realIntersectionObserver;
        vi.useRealTimers();
    });

    /** A drawing whose footer has `buttons`, as Excalidraw renders them. */
    function Drawing({ buttons }: { buttons: FooterButton[] }) {
        const rootRef = useRef<HTMLDivElement>(null);
        const apiRef = useRef(api as unknown as ExcalidrawImperativeAPI);
        return (
            <div ref={rootRef}>
                <div className="excalidraw-container" tabIndex={0} />
                <div className="App-toolbar-content">
                    {buttons.map(({ label, isShown, isSelected }) => (
                        <button
                            key={label}
                            type="button"
                            aria-label={translate(label)}
                            className={[
                                "ToolIcon_type_button",
                                `ToolIcon_type_button--${isShown ? "show" : "hide"}`,
                                isSelected ? "ToolIcon--selected" : ""
                            ].join(" ")}
                            onClick={() => clicked.push(label)}
                        />
                    ))}
                </div>
                <CanvasDrawingRail rootRef={rootRef} apiRef={apiRef} />
            </div>
        );
    }

    async function show(buttons: FooterButton[]) {
        await act(async () => render(<Drawing buttons={buttons} />, container));
        // The rail reads the footer in a `MutationObserver` callback.
        await act(async () => { await Promise.resolve(); });
    }

    async function focusDrawing() {
        await act(async () => {
            container.querySelector<HTMLElement>(".excalidraw-container")?.focus();
        });
    }

    async function blurDrawing() {
        await act(async () => {
            container.querySelector<HTMLElement>(".excalidraw-container")?.blur();
            vi.advanceTimersByTime(0);
        });
    }

    const rail = () => document.body.querySelector<HTMLElement>(".canvas-drawing-rail");
    const railButtons = () => [ ...rail()?.querySelectorAll("button") ?? [] ];

    /** A selected shape with its properties open, in Excalidraw's order of the footer. */
    const SELECTION: FooterButton[] = [
        { label: "buttons.edit", isShown: true, isSelected: true },
        { label: "labels.duplicateSelection", isShown: true },
        { label: "labels.delete", isShown: true }
    ];

    it("shows the footer buttons that Excalidraw shows while the drawing is focused", async () => {
        await show(SELECTION);
        expect(rail()).toBeNull();

        await focusDrawing();
        expect(rail()?.parentElement).toBe(document.body);
        const buttons = railButtons();
        expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
            "t:buttons.edit", "t:labels.duplicateSelection", "t:labels.delete"
        ]);
        expect(buttons.map((button) => button.classList.contains("active")))
            .toEqual([ true, false, false ]);
        expect(buttons[0].classList.contains("bx-palette")).toBe(true);
        expect(buttons[2].classList.contains("tn-overlay-rail-destructive")).toBe(true);
        // Clicks Excalidraw's own hidden button.
        await act(async () => buttons[0].click());
        expect(clicked).toEqual([ "buttons.edit" ]);

        await blurDrawing();
        expect(rail()?.classList.contains("leaving")).toBe(true);
        await act(async () => { vi.advanceTimersByTime(RAIL_EXIT_MS); });
        expect(rail()).toBeNull();
    });

    it("leaves once Excalidraw hides the buttons, or the drawing scrolls away", async () => {
        await show(SELECTION);
        await focusDrawing();
        expect(railButtons()).toHaveLength(3);

        // Done replaces Duplicate while a line is drawn, as in Excalidraw's footer.
        await show([
            { label: "buttons.edit", isShown: true },
            { label: "buttons.done", isShown: true },
            { label: "labels.delete", isShown: false }
        ]);
        expect(railButtons().map((button) => button.getAttribute("aria-label")))
            .toEqual([ "t:buttons.edit", "t:buttons.done" ]);

        await show(SELECTION.map((button) => ({ ...button, isShown: false })));
        expect(rail()?.classList.contains("leaving")).toBe(true);
        expect(railButtons()).toHaveLength(2);
        await act(async () => { vi.advanceTimersByTime(RAIL_EXIT_MS); });
        expect(rail()).toBeNull();

        await show(SELECTION);
        expect(rail()?.classList.contains("leaving")).toBe(false);
        const observer = MockIntersectionObserver.instances.at(-1);
        expect(observer).toBeDefined();
        await act(async () => observer?.report(false));
        expect(rail()?.classList.contains("leaving")).toBe(true);
    });

    it("closes the properties when the selection is cleared, until Edit opens them", async () => {
        api.getAppState.mockReturnValue({ openMenu: "shape" });
        await show(SELECTION);
        expect(api.updateScene).not.toHaveBeenCalled();

        await show(SELECTION.map((button) => ({ ...button, isShown: false })));
        expect(api.updateScene).toHaveBeenCalledExactlyOnceWith({ appState: { openMenu: null } });

        // Closed, the properties stay closed as Excalidraw renders the footer again.
        api.getAppState.mockReturnValue({ openMenu: null });
        await show([ { label: "buttons.edit", isShown: false } ]);
        await show(SELECTION.map((button) => ({ ...button, isSelected: false })));
        expect(api.updateScene).toHaveBeenCalledOnce();
    });
});
