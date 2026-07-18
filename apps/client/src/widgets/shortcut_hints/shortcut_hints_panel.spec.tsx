import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../services/i18n.js", () => ({ t: (key: string) => key }));
vi.mock("../../services/keyboard_actions.js", () => ({
    default: { getAction: vi.fn().mockResolvedValue({ effectiveShortcuts: ["Ctrl+K"], friendlyName: "Jump to note" }) }
}));

import Component from "../../components/component.js";
import type { ShortcutHintSection } from "../../services/shortcut_hints.js";
import { ParentComponent } from "../react/react_utils.js";
import ShortcutHintsPanel, { ShortcutHintsSections } from "./shortcut_hints_panel.js";

let container: HTMLDivElement;

afterEach(() => {
    act(() => render(null, container));
    container.remove();
});

function mount(vnode: preact.ComponentChild) {
    container = document.createElement("div");
    document.body.appendChild(container);
    act(() => render(vnode, container));
    return container;
}

function mountPanel() {
    const host = new Component();
    mount(<ParentComponent.Provider value={host}><ShortcutHintsPanel /></ParentComponent.Provider>);
    return host;
}

const SECTIONS: ShortcutHintSection[] = [{ hints: [{ keys: ["A"], labelKey: "act.a" }] }];

describe("ShortcutHintsSections", () => {
    it("renders a section title, literal keys and the description", () => {
        mount(<ShortcutHintsSections sections={[
            { titleKey: "grp.nav", hints: [{ keys: ["Page Down", "Ctrl+>"], labelKey: "act.next" }] }
        ]} />);

        expect(container.querySelector(".shortcut-hints-section-title")?.textContent).toBe("grp.nav");
        expect(container.querySelector(".shortcut-hint-description")?.textContent).toBe("act.next");
        expect(container.querySelectorAll(".shortcut-hint-keys kbd").length).toBeGreaterThan(0);
    });

    it("resolves an action hint's keys and falls back to its friendly name", async () => {
        mount(<ShortcutHintsSections sections={[{ hints: [{ action: "jumpToNote" }] }]} />);
        await act(async () => { await Promise.resolve(); });

        expect(container.querySelector(".shortcut-hint-description")?.textContent).toBe("Jump to note");
        expect(container.querySelectorAll(".shortcut-hint-keys kbd").length).toBeGreaterThan(0);
    });
});

describe("ShortcutHintsPanel", () => {
    const request = (host: Component, sections: ShortcutHintSection[]) =>
        act(() => { host.handleEvent("shortcutHintsRequested", { sections }); });

    it("stays closed until summoned, opens on the event, and toggles closed on the next", () => {
        const host = mountPanel();
        expect(document.querySelector(".shortcut-hints-panel")).toBeNull();

        request(host, SECTIONS);
        expect(document.querySelector(".shortcut-hints-panel")).not.toBeNull();

        request(host, SECTIONS);
        expect(document.querySelector(".shortcut-hints-panel")).toBeNull();
    });

    it("shows the Esc footer only when opened by keyboard (no anchor)", () => {
        const host = mountPanel();
        request(host, SECTIONS);
        expect(document.querySelector(".shortcut-hints-footer")).not.toBeNull();
    });

    it("does not open when there are no sections", () => {
        const host = mountPanel();
        request(host, []);
        expect(document.querySelector(".shortcut-hints-panel")).toBeNull();
    });

    it("closes on Escape", () => {
        const host = mountPanel();
        request(host, SECTIONS);
        expect(document.querySelector(".shortcut-hints-panel")).not.toBeNull();

        act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
        expect(document.querySelector(".shortcut-hints-panel")).toBeNull();
    });

    it("auto-dismisses after the timeout", () => {
        vi.useFakeTimers();
        try {
            const host = mountPanel();
            request(host, SECTIONS);
            expect(document.querySelector(".shortcut-hints-panel")).not.toBeNull();

            act(() => { vi.advanceTimersByTime(5000); });
            expect(document.querySelector(".shortcut-hints-panel")).toBeNull();
        } finally {
            vi.useRealTimers();
        }
    });

    it("closes when the active note context changes", () => {
        const host = mountPanel();
        request(host, SECTIONS);
        expect(document.querySelector(".shortcut-hints-panel")).not.toBeNull();

        act(() => { host.handleEvent("activeContextChanged", { noteContext: {} as never }); });
        expect(document.querySelector(".shortcut-hints-panel")).toBeNull();
    });

    it("opens as a dropdown positioned under an anchor, and clicking the anchor does not dismiss it", () => {
        const host = mountPanel();
        const anchor = document.createElement("button");
        document.body.appendChild(anchor);
        try {
            act(() => { host.handleEvent("shortcutHintsRequested", { sections: SECTIONS, anchor }); });

            const panel = document.querySelector<HTMLElement>(".shortcut-hints-panel");
            // Anchored positioning uses top/bottom-auto instead of the corner's bottom offset.
            expect(panel?.style.top).toBe("6px");
            expect(panel?.style.bottom).toBe("auto");
            // No Esc footer when opened via the button (mouse users click away).
            expect(document.querySelector(".shortcut-hints-footer")).toBeNull();

            // A mousedown on the anchor is left for its own toggle — the pane must not close.
            act(() => { anchor.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });
            expect(document.querySelector(".shortcut-hints-panel")).not.toBeNull();

            // A mousedown elsewhere dismisses it.
            act(() => { document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });
            expect(document.querySelector(".shortcut-hints-panel")).toBeNull();
        } finally {
            anchor.remove();
        }
    });
});
