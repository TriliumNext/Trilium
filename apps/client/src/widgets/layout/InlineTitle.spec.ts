import { afterEach, describe, expect, it, vi } from "vitest";

import { buildNote } from "../../test/easy-froca";
import { observeTitleInView, shouldShowInlineTitle } from "./InlineTitle";

describe("shouldShowInlineTitle", () => {
    const viewScope = { viewMode: "default" } as const;

    it("carries text notes only, since a code note fills the pane and scrolls its own editor", () => {
        const textNote = buildNote({ title: "Note", type: "text" });
        const codeNote = buildNote({ title: "Script", type: "code", mime: "application/javascript;env=backend" });

        expect(shouldShowInlineTitle(textNote, "text", viewScope)).toBe(true);
        expect(shouldShowInlineTitle(codeNote, "code", viewScope)).toBe(false);
    });
});

describe("observeTitleInView", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        document.body.innerHTML = "";
    });

    it("measures the title against its scrolling container, which a sliding note carries along", () => {
        const observers: { options?: IntersectionObserverInit; callback: IntersectionObserverCallback; disconnect: ReturnType<typeof vi.fn> }[] = [];
        vi.stubGlobal("IntersectionObserver", class {
            disconnect = vi.fn();
            observe = vi.fn();
            constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
                observers.push({ callback, options, disconnect: this.disconnect });
            }
        });
        const container = document.body.appendChild(document.createElement("div"));
        container.className = "scrolling-container";
        const title = container.appendChild(document.createElement("div"));
        const onChange = vi.fn();

        const stop = observeTitleInView(title, onChange);
        const [ observer ] = observers;
        expect(observer.options?.root).toBe(container);

        const report = (isIntersecting: boolean, width: number, height: number) => observer.callback(
            [ { isIntersecting, boundingClientRect: { width, height } } as IntersectionObserverEntry ],
            {} as IntersectionObserver);
        report(false, 300, 40);
        expect(onChange).toHaveBeenLastCalledWith(false);
        report(true, 300, 40);
        expect(onChange).toHaveBeenLastCalledWith(true);

        // The title of a hidden tab has no box; it keeps the state it was left in.
        report(false, 0, 0);
        expect(onChange).toHaveBeenCalledTimes(2);

        stop();
        expect(observer.disconnect).toHaveBeenCalled();
    });
});
