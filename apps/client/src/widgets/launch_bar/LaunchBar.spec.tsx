import { act } from "preact/test-utils";
import { describe, expect, it } from "vitest";

import { buildNote } from "../../test/easy-froca.js";
import { renderInto } from "../../test/render.js";
import LaunchBar from "./LaunchBar.js";

describe("LaunchBar", () => {
    it("reserves a slot per visible launcher and sizes spacers from their labels", async () => {
        buildNote({
            id: "_lbVisibleLaunchers",
            title: "Visible Launchers",
            children: [
                { id: "_lbTestCommand", title: "Command", type: "launcher", "#launcherType": "command" },
                {
                    id: "_lbTestSpacer", title: "Spacer", type: "launcher",
                    "#launcherType": "builtinWidget", "#builtinWidget": "spacer",
                    "#baseSize": "0", "#growthFactor": "7"
                },
                { id: "lbTestClone", title: "Cloned note", type: "text" }
            ]
        });

        const container = renderInto(<LaunchBar />);
        const launcherContainer = container.querySelector("#launcher-container");
        expect(launcherContainer).not.toBeNull();
        expect(launcherContainer?.children.length).toBe(0);

        // The root note and its children resolve in two async steps.
        for (let i = 0; i < 3; i++) {
            await act(async () => { await new Promise((resolve) => setTimeout(resolve)); });
        }

        const slots = [ ...launcherContainer?.children ?? [] ] as HTMLElement[];
        expect(slots.map((slot) => slot.dataset.launcherId)).toEqual([ "_lbTestCommand", "_lbTestSpacer", "lbTestClone" ]);
        expect(slots.map((slot) => slot.className)).toEqual([
            "launcher-button launcher-placeholder",
            "spacer",
            "launcher-button launcher-placeholder"
        ]);
        expect(slots[1].style.flexBasis).toBe("0px");
        expect(slots[1].style.flexGrow).toBe("7");
    });
});
