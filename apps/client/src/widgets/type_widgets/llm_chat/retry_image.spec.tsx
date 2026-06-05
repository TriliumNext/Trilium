import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SafeImage } from "./retry_image";

let container: HTMLDivElement | undefined;

function renderInto(vnode: ReturnType<typeof SafeImage>) {
    container = document.createElement("div");
    document.body.appendChild(container);
    act(() => render(vnode, container ?? document.createElement("div")));
    return container;
}

function getImg(host: HTMLElement) {
    const img = host.querySelector("img");
    if (!img) {
        throw new Error("expected an <img> to be rendered");
    }
    return img;
}

function fireError(img: HTMLImageElement) {
    act(() => {
        img.dispatchEvent(new Event("error", { bubbles: true }));
    });
}

afterEach(() => {
    if (container) {
        act(() => render(null, container ?? document.createElement("div")));
        container.remove();
        container = undefined;
    }
    vi.restoreAllMocks();
    vi.useRealTimers();
});

describe("SafeImage", () => {
    it("renders the src and passes through other img attributes", () => {
        const img = getImg(renderInto(<SafeImage src="/foo.png" alt="A picture" className="chat-image" width={120} />));
        expect(img.getAttribute("src")).toBe("/foo.png");
        expect(img.getAttribute("alt")).toBe("A picture");
        expect(img.className).toBe("chat-image");
        expect(img.getAttribute("width")).toBe("120");
    });

    it("retries with a cache-busting query param using ? when the src has no query string", () => {
        vi.useFakeTimers();
        const host = renderInto(<SafeImage src="/img.png" />);
        const img = getImg(host);
        expect(img.getAttribute("src")).toBe("/img.png");

        fireError(img);
        // Timeout has not fired yet → src unchanged.
        expect(getImg(host).getAttribute("src")).toBe("/img.png");

        act(() => {
            vi.advanceTimersByTime(300);
        });
        expect(getImg(host).getAttribute("src")).toBe("/img.png?_retry=1");
    });

    it("retries using & when the src already contains a query string", () => {
        vi.useFakeTimers();
        const host = renderInto(<SafeImage src="/img.png?v=2" />);
        fireError(getImg(host));
        act(() => {
            vi.advanceTimersByTime(300);
        });
        expect(getImg(host).getAttribute("src")).toBe("/img.png?v=2&_retry=1");
    });

    it("uses exponential backoff and stops after three retries", () => {
        vi.useFakeTimers();
        const host = renderInto(<SafeImage src="/img.png" />);

        // Retry 1 — 300ms backoff.
        fireError(getImg(host));
        act(() => {
            vi.advanceTimersByTime(300);
        });
        expect(getImg(host).getAttribute("src")).toBe("/img.png?_retry=1");

        // Retry 2 — 600ms backoff (not fired after 300ms).
        fireError(getImg(host));
        act(() => {
            vi.advanceTimersByTime(300);
        });
        expect(getImg(host).getAttribute("src")).toBe("/img.png?_retry=1");
        act(() => {
            vi.advanceTimersByTime(300);
        });
        expect(getImg(host).getAttribute("src")).toBe("/img.png?_retry=2");

        // Retry 3 — 900ms backoff.
        fireError(getImg(host));
        act(() => {
            vi.advanceTimersByTime(900);
        });
        expect(getImg(host).getAttribute("src")).toBe("/img.png?_retry=3");

        // Fourth error is a no-op: retriesRef is already at the cap of 3.
        fireError(getImg(host));
        act(() => {
            vi.advanceTimersByTime(5000);
        });
        expect(getImg(host).getAttribute("src")).toBe("/img.png?_retry=3");
    });

    it("resets retries and clears the pending timeout when the src prop changes", () => {
        vi.useFakeTimers();
        const clearSpy = vi.spyOn(globalThis, "clearTimeout");

        // First render with a failing image that has a scheduled retry pending.
        const host = renderInto(<SafeImage src="/first.png" />);
        fireError(getImg(host));
        // Pending timeout exists but has not fired.
        expect(getImg(host).getAttribute("src")).toBe("/first.png");

        // Change the src — the effect cleanup clears the pending timeout and resets state.
        act(() => render(<SafeImage src="/second.png" />, host));
        expect(clearSpy).toHaveBeenCalled();
        expect(getImg(host).getAttribute("src")).toBe("/second.png");

        // The previously pending retry must not resurrect the old src.
        act(() => {
            vi.advanceTimersByTime(5000);
        });
        expect(getImg(host).getAttribute("src")).toBe("/second.png");

        // After a src change, retry counting starts over from 1.
        fireError(getImg(host));
        act(() => {
            vi.advanceTimersByTime(300);
        });
        expect(getImg(host).getAttribute("src")).toBe("/second.png?_retry=1");
    });

    it("clears the pending timeout on unmount", () => {
        vi.useFakeTimers();
        const clearSpy = vi.spyOn(globalThis, "clearTimeout");

        const host = renderInto(<SafeImage src="/img.png" />);
        fireError(getImg(host));

        act(() => render(null, host));
        expect(clearSpy).toHaveBeenCalled();
    });

    it("does not clear a timeout on unmount when no retry is pending", () => {
        vi.useFakeTimers();
        const clearSpy = vi.spyOn(globalThis, "clearTimeout");

        const host = renderInto(<SafeImage src="/img.png" />);
        // No error fired → no timeout was scheduled.
        act(() => render(null, host));
        expect(clearSpy).not.toHaveBeenCalled();
    });
});
