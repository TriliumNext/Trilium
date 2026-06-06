import { Fragment, h } from "preact";
import { describe, expect, it } from "vitest";

import { preactAPI } from "./frontend_script_api_preact.js";

describe("preactAPI", () => {
    it("re-exports the core preact primitives and is frozen", () => {
        expect(preactAPI.h).toBe(h);
        expect(preactAPI.Fragment).toBe(Fragment);
        expect(typeof preactAPI.createContext).toBe("function");
        expect(Object.isFrozen(preactAPI)).toBe(true);
    });

    it("exposes the bundled widgets and the spread hooks", () => {
        // A representative widget from each block must be present and a function/component.
        for (const key of ["ActionButton", "Modal", "FormTextBox", "RightPanelWidget"]) {
            expect(preactAPI[key as keyof typeof preactAPI]).toBeDefined();
        }
        // Spread preact hooks land directly on the object.
        expect(typeof (preactAPI as Record<string, unknown>).useState).toBe("function");
        expect(typeof (preactAPI as Record<string, unknown>).useEffect).toBe("function");
    });

    it("defineWidget tags the definition with the preact-widget type and preserves fields", () => {
        const render = () => h(Fragment, null);
        const result = preactAPI.defineWidget({ parent: "right-pane", render, position: 42 });

        expect(result).toEqual({
            type: "preact-widget",
            parent: "right-pane",
            render,
            position: 42
        });
        expect(result.render).toBe(render);
    });

    it("defineLauncherWidget tags the definition with the preact-launcher-widget type", () => {
        const render = () => h(Fragment, null);
        const result = preactAPI.defineLauncherWidget({ render });

        expect(result).toEqual({
            type: "preact-launcher-widget",
            render
        });
        expect(result.render).toBe(render);
    });
});
