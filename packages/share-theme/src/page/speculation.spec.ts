// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import setupSpeculation, { whenActivated } from "./speculation.js";

describe("setupSpeculation", () => {
    afterEach(() => {
        document.head.innerHTML = "";
        delete window.glob;
        vi.restoreAllMocks();
    });

    it("prerenders the site's pages a visitor is about to open, leaving out files and the login", () => {
        stubSupport(true);
        window.glob = { isShare: true, isStatic: false, theme: "light" };

        setupSpeculation();

        const scripts = document.head.querySelectorAll("script[type=speculationrules]");
        expect(scripts).toHaveLength(1);
        expect(JSON.parse(scripts[0].textContent ?? "")).toStrictEqual({
            prerender: [ {
                where: {
                    and: [
                        { href_matches: "./*", relative_to: "document" },
                        { not: { href_matches: "./api/*", relative_to: "document" } },
                        { not: { selector_matches: "[target], [download], .login-link" } }
                    ]
                },
                eagerness: "moderate"
            } ]
        });
    });

    it("adds no rules to a static export or in a browser without speculation rules", () => {
        stubSupport(true);
        window.glob = { isShare: true, isStatic: true, theme: "light" };
        setupSpeculation();

        stubSupport(false);
        window.glob = { isShare: true, isStatic: false, theme: "light" };
        setupSpeculation();

        vi.stubGlobal("HTMLScriptElement", {});
        setupSpeculation();
        vi.unstubAllGlobals();

        expect(document.head.querySelector("script")).toBeNull();
    });
});

describe("whenActivated", () => {
    afterEach(() => {
        Reflect.deleteProperty(document, "prerendering");
    });

    it("runs at once on a page being shown, and on activation on a prerendered one", () => {
        const callback = vi.fn();
        whenActivated(callback);
        expect(callback).toHaveBeenCalledOnce();

        callback.mockClear();
        Object.defineProperty(document, "prerendering", { value: true, configurable: true });
        whenActivated(callback);
        expect(callback).not.toHaveBeenCalled();

        document.dispatchEvent(new Event("prerenderingchange"));
        document.dispatchEvent(new Event("prerenderingchange"));
        expect(callback).toHaveBeenCalledOnce();
    });
});

function stubSupport(isSupported: boolean) {
    vi.spyOn(HTMLScriptElement, "supports")
        .mockImplementation((type) => isSupported && type === "speculationrules");
}
