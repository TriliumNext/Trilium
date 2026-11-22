import { act } from "preact/test-utils";
import { describe, expect, it } from "vitest";

import Component from "../../components/component";
import options from "../../services/options";
import { renderInto } from "../../test/render";
import { ParentComponent } from "../react/react_utils";
import LeftPaneToggle from "./left_pane_toggle";

describe("LeftPaneToggle", () => {
    it("rotates its icon only when the pane's mode changes after it is shown", async () => {
        options.load({ leftPaneVisible: "true" });
        const parent = new Component();
        const container = renderInto(
            <ParentComponent.Provider value={parent}>
                <LeftPaneToggle isHorizontalLayout={false} />
            </ParentComponent.Provider>
        );
        const button = container.querySelector(".left-pane-toggle-button");
        expect(button).not.toBeNull();
        expect(button?.classList.contains("action-collapse")).toBe(true);
        expect(button?.classList.contains("animated")).toBe(false);

        await act(async () => {
            await parent.handleEvent("paneModeChanged", { pane: "left", mode: "closed" });
        });
        expect(button?.classList.contains("action-expand")).toBe(true);
        expect(button?.classList.contains("animated")).toBe(true);
    });
});
