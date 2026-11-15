import { afterEach, describe, expect, it } from "vitest";

import { renderInto } from "../test/render.js";
import DesktopLayout from "./DesktopLayout.js";

describe("DesktopLayout", () => {
    const originalOrientation = window.glob.layoutOrientation;

    afterEach(() => {
        window.glob.layoutOrientation = originalOrientation;
    });

    it("puts the launch bar beside the main container in the vertical layout", () => {
        window.glob.layoutOrientation = "vertical";
        const root = renderInto(<DesktopLayout />).querySelector("#root-widget");

        expect(root?.classList.contains("vertical-layout")).toBe(true);
        const launcherPane = root?.querySelector("#launcher-pane");
        expect(launcherPane?.classList.contains("vertical")).toBe(true);
        expect(launcherPane?.parentElement?.id).toBe("horizontal-main-container");
    });

    it("puts the launch bar above the main container in the horizontal layout", () => {
        window.glob.layoutOrientation = "horizontal";
        const root = renderInto(<DesktopLayout />).querySelector("#root-widget");

        expect(root?.classList.contains("horizontal-layout")).toBe(true);
        const launcherPane = root?.querySelector("#launcher-pane");
        expect(launcherPane?.classList.contains("horizontal")).toBe(true);
        expect(launcherPane?.parentElement).toBe(root);
        expect(launcherPane?.nextElementSibling?.id).toBe("horizontal-main-container");
    });
});
