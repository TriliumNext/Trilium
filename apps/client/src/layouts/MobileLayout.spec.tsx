import { afterEach, beforeEach, describe, expect, it } from "vitest";

import appContext from "../components/app_context.js";
import options from "../services/options.js";
import { buildNote } from "../test/easy-froca.js";
import { renderInto } from "../test/render.js";
import { ParentComponent } from "../widgets/react/react_utils.js";
import MobileLayout from "./MobileLayout.js";

describe("MobileLayout", () => {
    let device: typeof window.glob.device;
    beforeEach(() => {
        device = window.glob.device;
        window.glob.device = "mobile";
    });
    afterEach(() => {
        window.glob.device = device;
    });

    it("ends with the bottom bar, holding the launchers and then the global menu", () => {
        buildNote({ id: "_lbMobileVisibleLaunchers", title: "Visible Launchers" });
        options.set("experimentalFeatures", "[]");
        const container = renderInto(
            <ParentComponent.Provider value={appContext}>
                <MobileLayout />
            </ParentComponent.Provider>
        );
        const root = container.querySelector("#root-widget.mobile-layout");

        const bottomBar = root?.lastElementChild;
        expect(bottomBar?.id).toBe("mobile-bottom-bar");
        const launcherPane = bottomBar?.querySelector(":scope > #launcher-pane.horizontal");
        expect(launcherPane?.firstElementChild?.id).toBe("launcher-container");
        expect(launcherPane?.lastElementChild?.classList.contains("global-menu")).toBe(true);
        // The panes above it fill the rest of the screen.
        expect(bottomBar?.previousElementSibling?.id).toBe("mobile-rest-container");
    });
});
