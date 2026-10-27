import { render } from "preact";
import { act } from "preact/test-utils";
import { useRef } from "preact/hooks";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderInto } from "../../test/render";

vi.mock("../react/hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../react/hooks")>()),
    useStaticTooltip: vi.fn()
}));
const platform = vi.hoisted(() => ({ isMobileApp: false }));
vi.mock("../../services/utils", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../services/utils")>()),
    isIOS: () => true,
    isMobileApp: () => platform.isMobileApp
}));

import HideKeyboardButton, {
    HideKeyboardAction, holdVisibleBottom, usePositioningOniOS
} from "./hide_keyboard_button";

describe("HideKeyboardButton", () => {
    let input: HTMLInputElement | undefined;

    afterEach(() => {
        input?.remove();
    });

    it("blurs the focus when pressed, without taking it first", () => {
        input = document.createElement("input");
        document.body.append(input);
        let container: HTMLElement | undefined;
        act(() => { container = renderInto(<HideKeyboardButton />); });

        const button = container?.querySelector("button");
        expect(button).toBeInstanceOf(HTMLButtonElement);

        const press = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
        button?.dispatchEvent(press);
        expect(press.defaultPrevented).toBe(true);

        act(() => input?.focus());
        expect(document.activeElement).toBe(input);
        act(() => button?.click());
        expect(document.activeElement).not.toBe(input);
    });

    it("closes the menu instead, as an X, while it is given one to close", () => {
        input = document.createElement("input");
        document.body.append(input);
        const closeMenu = vi.fn();
        let container: HTMLElement | undefined;
        act(() => {
            container = renderInto(<HideKeyboardAction className="action" closeMenu={closeMenu} />);
        });

        const button = container?.querySelector("button");
        expect(button).toBeInstanceOf(HTMLButtonElement);
        expect(button?.classList.contains("bx-x")).toBe(true);
        expect(container?.querySelector(".action")?.classList.contains("closes-menu")).toBe(true);

        act(() => input?.focus());
        act(() => button?.click());
        expect(closeMenu).toHaveBeenCalledTimes(1);
        expect(document.activeElement).toBe(input);
    });
});

describe("usePositioningOniOS", () => {
    const originalViewport = Object.getOwnPropertyDescriptor(window, "visualViewport");
    const originalInnerHeight = Object.getOwnPropertyDescriptor(window, "innerHeight");
    const originalScrollY = Object.getOwnPropertyDescriptor(window, "scrollY");

    afterEach(() => {
        platform.isMobileApp = false;
        for (const [ key, descriptor ] of [
            [ "visualViewport", originalViewport ],
            [ "innerHeight", originalInnerHeight ],
            [ "scrollY", originalScrollY ]
        ] as const) {
            if (descriptor) {
                Object.defineProperty(window, key, descriptor);
            } else {
                Reflect.deleteProperty(window, key);
            }
        }
    });

    it("lifts a fixed element above the keyboard, also when Safari pans the viewport", () => {
        const viewport = fakeViewport(800);
        const { element, unmount } = renderPositioned(false);

        act(() => viewport.set({ height: 500, offsetTop: 0 }, "resize"));
        expect(element().style.bottom).toBe("300px");

        // Safari pans the visual viewport towards the caret without resizing it.
        act(() => viewport.set({ height: 500, offsetTop: 120 }, "scroll"));
        expect(element().style.bottom).toBe("180px");

        act(() => viewport.set({ height: 800, offsetTop: 0 }, "resize"));
        expect(element().style.bottom).toBe("");

        unmount();
        act(() => viewport.set({ height: 500, offsetTop: 0 }, "resize"));
        expect(viewport.listenerCount()).toBe(0);
    });

    it("lifts an element by what the keyboard covers of its anchor, not of the window", () => {
        const viewport = fakeViewport(800);
        const { element, anchor } = renderPositioned(true);

        // The anchor ends mid-screen, as the top note split does, above the keyboard.
        anchor().getBoundingClientRect = () => new DOMRect(0, 0, 400, 400);
        act(() => viewport.set({ height: 500, offsetTop: 0 }, "resize"));
        expect(element().style.bottom).toBe("");

        // The anchor ends 53px above the window's bottom, as above a bottom bar left in place.
        anchor().getBoundingClientRect = () => new DOMRect(0, 0, 400, 747);
        act(() => viewport.set({ height: 500, offsetTop: 0 }, "resize"));
        expect(element().style.bottom).toBe("247px");
    });

    it("lifts to the visible bottom while Safari scrolls the fixed page for the keyboard", () => {
        // As logged in Safari: the page scrolls by 118px, `innerHeight` shrinks by as much, and
        // the visual viewport starts where the scroll does, at the top of the client area.
        const viewport = fakeViewport(754);
        const { element, anchor } = renderPositioned(true);
        anchor().getBoundingClientRect = () => new DOMRect(0, -118, 400, 754);
        Object.defineProperty(window, "innerHeight", { configurable: true, value: 636 });
        Object.defineProperty(window, "scrollY", { configurable: true, value: 118 });
        act(() => viewport.set({ height: 405, offsetTop: 118, pageTop: 118 }, "scroll"));
        expect(element().style.bottom).toBe("231px");
    });

    it("holds the visible bottom while a menu takes the keyboard's place", () => {
        // As logged in Safari: the keyboard is up and the page scrolled by 139px.
        const viewport = fakeViewport(754);
        const { element, anchor } = renderPositioned(true);
        const layout = (innerHeight: number, scrollY: number) => {
            Object.defineProperty(window, "innerHeight", {
                configurable: true, value: innerHeight
            });
            Object.defineProperty(window, "scrollY", { configurable: true, value: scrollY });
            anchor().getBoundingClientRect = () => new DOMRect(0, innerHeight - 754, 400, 754);
        };
        layout(615, 139);
        act(() => viewport.set({ height: 405, offsetTop: 138.7, pageTop: 138.7 }, "resize"));
        expect(element().style.bottom).toBe("210px");

        // A menu takes the keyboard's place. Safari undoes the scroll at once, but reports the
        // visual viewport of the keyboard for another 300ms or so, with no event of its own.
        act(() => holdVisibleBottom(true));
        layout(754, 0);
        act(() => {
            window.dispatchEvent(new Event("scroll"));
        });
        expect(element().style.bottom).toBe("349px");

        act(() => viewport.set({ height: 754, offsetTop: 0, pageTop: 0 }, "resize"));
        expect(element().style.bottom).toBe("349px");

        act(() => holdVisibleBottom(false));
        expect(element().style.bottom).toBe("");
    });

    it("leaves the element to CSS in the iOS app, which resizes the page for the keyboard", () => {
        // As logged in the app: `visualViewport` and `innerHeight` shrink to 549px before the
        // layout does, so the anchor still ends at 896px as the resize event fires.
        platform.isMobileApp = true;
        const viewport = fakeViewport(896);
        const { element, anchor } = renderPositioned(true);
        anchor().getBoundingClientRect = () => new DOMRect(0, 0, 414, 896);
        Object.defineProperty(window, "innerHeight", { configurable: true, value: 549 });
        act(() => viewport.set({ height: 549, offsetTop: 0 }, "resize"));
        expect(element().style.bottom).toBe("");
        expect(viewport.listenerCount()).toBe(0);
    });
});

function fakeViewport(innerHeight: number) {
    const target = new EventTarget();
    let listeners = 0;
    const viewport = Object.assign(target, { height: innerHeight, offsetTop: 0, pageTop: 0 });
    const add = target.addEventListener.bind(target);
    const remove = target.removeEventListener.bind(target);
    viewport.addEventListener = (...args: Parameters<typeof add>) => {
        listeners++;
        add(...args);
    };
    viewport.removeEventListener = (...args: Parameters<typeof remove>) => {
        listeners--;
        remove(...args);
    };
    Object.defineProperty(window, "innerHeight", { configurable: true, value: innerHeight });
    Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport });
    return {
        set(
            values: { height: number; offsetTop: number; pageTop?: number },
            event: "resize" | "scroll"
        ) {
            // Outside Safari's keyboard scrolling, the visual viewport's page offset is its offset.
            Object.assign(viewport, { pageTop: values.offsetTop }, values);
            viewport.dispatchEvent(new Event(event));
        },
        listenerCount: () => listeners
    };
}

function renderPositioned(withAnchor: boolean) {
    const host = document.createElement("div");
    document.body.append(host);
    function Harness() {
        const anchorRef = useRef<HTMLDivElement>(null);
        const elementRef = useRef<HTMLDivElement>(null);
        usePositioningOniOS(elementRef, withAnchor ? anchorRef : undefined);
        return (
            <div ref={anchorRef} className="anchor">
                <div ref={elementRef} className="element" />
            </div>
        );
    }
    act(() => render(<Harness />, host));

    const find = (selector: string) => {
        const found = host.querySelector<HTMLElement>(selector);
        if (!found) throw new Error(`${selector} is not rendered`);
        return found;
    };
    return {
        element: () => find(".element"),
        anchor: () => find(".anchor"),
        unmount: () => {
            act(() => render(null, host));
            host.remove();
        }
    };
}
