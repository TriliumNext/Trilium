import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import options from "../services/options.js";
import { renderInto } from "../test/render.js";
import { Modals } from "./layout_commons.js";

vi.mock("../services/keyboard_actions", () => ({
    default: { getAction: vi.fn().mockResolvedValue({ effectiveShortcuts: [] }), updateDisplayedShortcuts: vi.fn() }
}));

describe("Modals", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("shows the call to action once the layout has rendered, only while one applies", async () => {
        options.load({ theme: "light", seenCallToActions: "[]", backendScriptingEnabled: "true" });
        act(() => { renderInto(<Modals />); });
        await vi.waitFor(() => expect(document.querySelector(".modal.call-to-action")).not.toBeNull());

        document.body.innerHTML = "";
        options.load({ theme: "light", seenCallToActions: JSON.stringify([ "background_effects", "scripting_disabled", "next_theme" ]) });
        act(() => { renderInto(<Modals />); });
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
        expect(document.querySelector(".modal.call-to-action")).toBeNull();
    });
});
