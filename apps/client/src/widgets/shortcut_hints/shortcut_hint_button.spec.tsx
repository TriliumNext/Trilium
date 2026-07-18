import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../services/i18n.js", () => ({ t: (key: string) => key }));
vi.mock("../../services/keyboard_actions.js", () => ({
    default: { getAction: vi.fn().mockResolvedValue({ effectiveShortcuts: ["Alt+F1"] }) }
}));
vi.mock("../react/hooks.js", () => ({ useStaticTooltip: () => {} }));

import appContext from "../../components/app_context.js";
import Component from "../../components/component.js";
import type { ShortcutHintSection } from "../../services/shortcut_hints.js";
import { ParentComponent } from "../react/react_utils.js";
import ShortcutHintButton, { ShortcutHintOverlayButton } from "./shortcut_hint_button.js";

let container: HTMLDivElement;

afterEach(() => {
    act(() => render(null, container));
    container.remove();
    vi.restoreAllMocks();
});

function mountButton(host: Component) {
    container = document.createElement("div");
    document.body.appendChild(container);
    act(() => render(
        <ParentComponent.Provider value={host}><ShortcutHintButton className="my-position" /></ParentComponent.Provider>,
        container
    ));
    return container.querySelector("button");
}

describe("ShortcutHintButton", () => {
    it("renders the overlay button with a '?' keycap and the position class", () => {
        const button = mountButton(new Component());

        expect(container.querySelector(".tn-overlay-control-group.my-position")).not.toBeNull();
        expect(button?.classList.contains("tn-overlay-text-button")).toBe(true);
        expect(button?.getAttribute("aria-label")).toBe("shortcut_hints.show_button");
        expect(button?.querySelector("kbd")?.textContent).toBe("?");
        expect(button?.querySelector(".shortcut-hint-button-key")).not.toBeNull();
    });

    it("exposes a bare overlay button (no group wrapper) for existing overlay groups", () => {
        container = document.createElement("div");
        document.body.appendChild(container);
        act(() => render(
            <ParentComponent.Provider value={new Component()}><ShortcutHintOverlayButton /></ParentComponent.Provider>,
            container
        ));

        expect(container.querySelector(".tn-overlay-control-group")).toBeNull();
        const button = container.querySelector("button");
        expect(button?.classList.contains("tn-overlay-text-button")).toBe(true);
        expect(button?.querySelector("kbd")?.textContent).toBe("?");
    });

    it("collects its context's hints and opens the pane anchored to itself on click", () => {
        const section: ShortcutHintSection = { hints: [{ keys: ["A"], labelKey: "a" }] };
        const host = new Component();
        host.getContextualShortcutHints = (collector) => collector.add(section);
        const triggerEvent = vi.spyOn(appContext, "triggerEvent").mockReturnValue(undefined);

        const button = mountButton(host);
        button?.click();

        expect(triggerEvent).toHaveBeenCalledWith("shortcutHintsRequested", {
            sections: [section],
            anchor: button
        });
    });
});
