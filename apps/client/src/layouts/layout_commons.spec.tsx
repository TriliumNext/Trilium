import { h, type VNode } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import options from "../services/options.js";
import { renderInto } from "../test/render.js";
import { POPUP_EDITOR_NTX_ID } from "../widgets/react/react_utils.js";
import { LazyDialog, Modals, modals } from "./layout_commons.js";

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
        // Bootstrap's `_showElement()` puts a detached dialog back into the body, so wait for it to finish.
        await vi.waitFor(() => expect(document.querySelector(".modal.call-to-action.show")).not.toBeNull());

        document.body.innerHTML = "";
        options.load({ theme: "light", seenCallToActions: JSON.stringify([ "background_effects", "scripting_disabled", "next_theme" ]) });
        act(() => { renderInto(<Modals />); });
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
        expect(document.querySelector(".modal.call-to-action")).toBeNull();
    });
});

describe("modals", () => {
    it("loads a component for each dialog, and binds each popup editor to its note context and command", async () => {
        const loaded = await Promise.all(modals()
            .filter((modal) => modal.type === LazyDialog)
            .map(async (modal) => ({ key: modal.key, module: await (modal as VNode<LazyDialogProps>).props.loader() })));

        // All but the call to action and the toasts.
        expect(loaded).toHaveLength(modals().length - 2);
        for (const { module } of loaded) {
            expect(typeof module.default).toBe("function");
        }
        const popupEditors = loaded.filter(({ key }) => typeof key === "string" && key.startsWith("popup_editor"));
        expect(popupEditors.map(({ module }) => {
            const { props } = (h(module.default, null).type as () => VNode<{ ntxId: string, openCommand: string }>)();
            return [ props.ntxId, props.openCommand ];
        })).toEqual([
            [ POPUP_EDITOR_NTX_ID, "openInPopup" ],
            [ `${POPUP_EDITOR_NTX_ID}-nested`, "openInNestedPopup" ]
        ]);
    });
});

type LazyDialogProps = Parameters<typeof LazyDialog>[0];
