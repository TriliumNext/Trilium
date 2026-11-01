import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import options from "../services/options";
import { renderInto } from "../test/render";
import TreeSettings, { inlineEndEdge, type TreeSettingsProps } from "./note_tree_settings";

vi.mock("../services/i18n", async (importOriginal) => ({
    ...await importOriginal<typeof import("../services/i18n")>(),
    t: (key: string) => key
}));

describe("TreeSettings", () => {
    let anchor: HTMLElement;

    beforeEach(() => {
        anchor = document.createElement("div");
        document.body.append(anchor);
        options.set("hideArchivedNotes_main", "false");
        options.set("autoCollapseNoteTree", "true");
        options.set("treeScrollFollowNavigation", "true");
        options.set("treeDensity", "relaxed");
    });

    afterEach(() => {
        anchor.remove();
        vi.restoreAllMocks();
    });

    function open(props: Partial<TreeSettingsProps> = {}) {
        act(() => {
            renderInto(
                <TreeSettings
                    anchor={anchor}
                    onHideArchivedNotesChange={vi.fn()}
                    onClose={vi.fn()}
                    {...props}
                />
            );
        });
        const popup = document.querySelector<HTMLElement>(".tree-settings.tn-tool-dialog");
        if (!popup) throw new Error("Expected the tree settings popup.");
        return popup;
    }

    function toggleNamed(popup: HTMLElement, name: string) {
        const toggle = popup.querySelector<HTMLInputElement>(`input.switch-toggle[id^="${name}-"]`);
        if (!toggle) throw new Error(`No ${name} toggle.`);
        return toggle;
    }

    async function flip(popup: HTMLElement, name: string) {
        await act(async () => {
            toggleNamed(popup, name).dispatchEvent(new Event("input", { bubbles: true }));
        });
    }

    function densityButton(popup: HTMLElement, density: string) {
        const label = `note_tree.display-density-${density}`;
        const buttons = popup.querySelectorAll<HTMLButtonElement>(".tn-segmented-choice button");
        const button = [ ...buttons ].find((candidate) => candidate.textContent?.trim() === label);
        if (!button) throw new Error(`No ${density} button.`);
        return button;
    }

    it("shows each option in a card section of its own, with no save button", () => {
        const popup = open();

        expect(popup.getAttribute("role")).toBe("dialog");
        const title = popup.querySelector(".tree-settings-title");
        expect(title?.textContent).toBe("note_tree.tree-settings-title");
        expect(popup.getAttribute("aria-labelledby")).toBe(title?.id);
        expect(popup.querySelectorAll(".tn-card")).toHaveLength(1);
        const sections = [ ...popup.querySelectorAll(".tn-card .tn-card-section") ];
        expect(sections.map((section) => [
            section.querySelectorAll(".tn-segmented-choice").length,
            section.querySelectorAll("input.switch-toggle").length
        ])).toEqual([ [ 1, 0 ], [ 0, 1 ], [ 0, 1 ], [ 0, 1 ] ]);
        expect(sections[0].classList).not.toContain("tn-card-option-wide");
        expect(densityButton(popup, "relaxed").getAttribute("aria-pressed")).toBe("true");
        expect(densityButton(popup, "dense").getAttribute("aria-pressed")).toBe("false");
        expect(toggleNamed(popup, "hide-archived-notes").checked).toBe(false);
        expect(toggleNamed(popup, "auto-collapse-note-tree").checked).toBe(true);
        expect(toggleNamed(popup, "follow-active-note").checked).toBe(true);
        const otherButtons = [ ...popup.querySelectorAll("button") ]
            .filter((button) => !button.closest(".tn-segmented-choice"));
        expect(otherButtons).toHaveLength(1);
    });

    it("saves each change at once and reloads the tree only for archived notes", async () => {
        const save = vi.spyOn(options, "save");
        const onHideArchivedNotesChange = vi.fn();
        const popup = open({ onHideArchivedNotesChange });

        await act(async () => densityButton(popup, "dense").click());
        expect(save).toHaveBeenLastCalledWith("treeDensity", "dense");
        expect(densityButton(popup, "dense").getAttribute("aria-pressed")).toBe("true");

        await flip(popup, "follow-active-note");
        expect(save).toHaveBeenLastCalledWith("treeScrollFollowNavigation", "false");

        await flip(popup, "auto-collapse-note-tree");
        expect(save).toHaveBeenLastCalledWith("autoCollapseNoteTree", "false");
        expect(onHideArchivedNotesChange).not.toHaveBeenCalled();

        await flip(popup, "hide-archived-notes");
        expect(save).toHaveBeenLastCalledWith("hideArchivedNotes_main", "true");
        expect(onHideArchivedNotesChange).toHaveBeenCalledOnce();
        expect(toggleNamed(popup, "hide-archived-notes").checked).toBe(true);
    });

    it("closes from its close button or a press outside, not from the settings button", () => {
        const settingsButton = document.createElement("button");
        settingsButton.className = "tree-settings-button";
        anchor.append(settingsButton);
        const onClose = vi.fn();
        const popup = open({ onClose });

        settingsButton.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
        expect(onClose).not.toHaveBeenCalled();

        document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
        expect(onClose).toHaveBeenCalledOnce();

        popup.querySelector<HTMLButtonElement>(".tree-settings-header button")?.click();
        expect(onClose).toHaveBeenCalledTimes(2);
    });

    it("stays at the toolbar's end edge while the toolbar collapses", async () => {
        vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(1000);
        vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(800);
        vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(400);
        vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(100);
        const rect = vi.spyOn(anchor, "getBoundingClientRect");

        // Expanded and collapsed widths, both ending at x = 300.
        const placements: string[] = [];
        for (const [ x, width ] of [ [ 100, 200 ], [ 260, 40 ] ]) {
            rect.mockReturnValue(DOMRect.fromRect({ x, y: 700, width, height: 30 }));
            const container = renderInto(
                <TreeSettings
                    anchor={anchor}
                    onHideArchivedNotesChange={vi.fn()}
                    onClose={vi.fn()}
                />
            );
            const popup = document.querySelector<HTMLElement>(".tree-settings");
            await vi.waitFor(() => expect(popup?.style.visibility).toBe("visible"));
            placements.push(`${popup?.style.left} ${popup?.style.top}`);
            act(() => render(null, container));
        }

        expect(placements).toEqual([ "300px 592px", "300px 592px" ]);
    });

    it("takes the left edge as the end edge in a right-to-left layout", () => {
        vi.spyOn(anchor, "getBoundingClientRect")
            .mockReturnValue(DOMRect.fromRect({ x: 100, y: 700, width: 200, height: 30 }));

        expect(inlineEndEdge(anchor).getBoundingClientRect().x).toBe(300);
        anchor.style.direction = "rtl";
        expect(inlineEndEdge(anchor).getBoundingClientRect())
            .toMatchObject({ x: 100, width: 0, y: 700 });
    });
});
