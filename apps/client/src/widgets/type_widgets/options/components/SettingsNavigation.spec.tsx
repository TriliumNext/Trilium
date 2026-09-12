import { describe, expect, it, vi } from "vitest";

import { renderInto } from "../../../../test/render";

const mocks = vi.hoisted(() => ({
    pages: [] as { noteId: string; title: string; getIcon: () => string }[]
}));

// The list is read straight from the `_options` subtree, so titles, icons and ordering stay in step
// with the note tree rather than being restated here.
vi.mock("../../../dialogs/OptionsDialog", () => ({ useOptionPages: () => mocks.pages }));

import SettingsNavigation from "./SettingsNavigation";

const PAGES = [
    { noteId: "_optionsAppearance", title: "Appearance", getIcon: () => "bx bx-palette" },
    { noteId: "_optionsShortcuts", title: "Shortcuts", getIcon: () => "bx bx-keyboard" }
];

describe("SettingsNavigation", () => {
    it("lists every page in the order the tree holds them, each with its own icon", () => {
        mocks.pages = PAGES;
        const links = [ ...renderInto(<SettingsNavigation activeNoteId="_optionsAppearance" />)
            .querySelectorAll<HTMLAnchorElement>("a.settings-navigation-item") ];

        expect(links.map((link) => link.querySelector(".settings-navigation-title")?.textContent))
            .toEqual([ "Appearance", "Shortcuts" ]);
        expect(links[1].innerHTML).toContain("bx-keyboard");
    });

    it("points each entry at its page, as a link a modified click can still open elsewhere", () => {
        mocks.pages = PAGES;
        const [ first ] = [ ...renderInto(<SettingsNavigation activeNoteId="_optionsAppearance" />).querySelectorAll("a") ];

        expect(first.getAttribute("href")).toBe("#root/_hidden/_options/_optionsAppearance");
        // The note tooltip has no business opening over a way to another settings page.
        expect(first.className).toContain("no-tooltip-preview");
    });

    it("marks the page being shown, for the eye and for a reader alike", () => {
        mocks.pages = PAGES;
        const links = [ ...renderInto(<SettingsNavigation activeNoteId="_optionsShortcuts" />).querySelectorAll("a") ];

        expect(links[0].className).not.toContain("active");
        expect(links[0].getAttribute("aria-current")).toBeNull();
        expect(links[1].className).toContain("active");
        expect(links[1].getAttribute("aria-current")).toBe("page");
    });

    it("draws an empty list rather than failing when the subtree has nothing to show", () => {
        mocks.pages = [];
        const container = renderInto(<SettingsNavigation activeNoteId="_optionsAppearance" />);

        expect(container.querySelector(".settings-navigation")).not.toBeNull();
        expect(container.querySelectorAll("a")).toHaveLength(0);
    });
});
