import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import type Component from "../../components/component";
import options from "../../services/options";
import { renderInto } from "../../test/render";
import { ParentComponent } from "../react/react_utils";

vi.mock("../../services/i18n", () => ({ t: (key: string) => key }));
vi.mock("../launch_bar/LauncherContainer", () => ({
    default: ({ isHorizontalLayout, showLabels, onPopupShown }: {
        isHorizontalLayout: boolean, showLabels?: boolean, onPopupShown?: () => void
    }) => (
        <div id="launcher-container" data-horizontal={`${isHorizontalLayout}`} data-labels={`${!!showLabels}`}>
            {onPopupShown && <button type="button" className="launcher-with-popup" onClick={onPopupShown} />}
        </div>
    )
}));
vi.mock("../buttons/global_menu", () => ({
    default: ({ showLabel, onShown }: { showLabel?: boolean, onShown?: () => void }) => (
        <button type="button" className="global-menu" data-label={`${!!showLabel}`} onClick={onShown} />
    )
}));

import MobileLaunchBar from "./MobileLaunchBar";

/** Answers `matchMedia()` as a phone or a tablet in landscape would. */
function mockWidth(width: "phone" | "tablet") {
    vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
        matches: width === "phone" && query === "(max-width: 991px)",
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
    }) as unknown as MediaQueryList);
}

function renderBar({ rail, width, treeShown = false }: { rail: boolean, width: "phone" | "tablet", treeShown?: boolean }) {
    options.set("mobileNavigationRail", `${rail}`);
    options.set("leftPaneVisible", `${treeShown}`);
    mockWidth(width);
    const triggerCommand = vi.fn();
    const parent = { componentId: "bar", registerHandler: vi.fn(), removeHandler: vi.fn(), triggerCommand };
    const container = renderInto(
        <ParentComponent.Provider value={parent as unknown as Component}>
            <MobileLaunchBar />
        </ParentComponent.Provider>
    );
    const pane = container.querySelector<HTMLElement>("#launcher-pane");
    expect(pane).not.toBeNull();
    return { pane, triggerCommand, items: [ ...pane?.children ?? [] ] };
}

describe("MobileLaunchBar", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        options.set("mobileNavigationRail", "false");
    });

    it("stays a bar with the menu at its end, unless the rail is on and the screen is wide", () => {
        for (const [ rail, width ] of [ [ false, "tablet" ], [ true, "phone" ] ] as const) {
            const { pane, items } = renderBar({ rail, width });

            expect(pane?.classList.contains("horizontal")).toBe(true);
            expect(items.map((item) => item.id || item.className)).toEqual([ "launcher-container", "global-menu" ]);
            expect(pane?.querySelector("#launcher-container")?.getAttribute("data-horizontal")).toBe("true");
            expect(pane?.querySelector("#launcher-container")?.getAttribute("data-labels")).toBe("false");
            expect(pane?.querySelector(".global-menu")?.getAttribute("data-label")).toBe("false");
            expect(pane?.querySelector(".note-tree-launcher")).toBeNull();
            expect(pane?.querySelector(".launcher-with-popup")).toBeNull();
            expect(document.body.classList.contains("navigation-rail")).toBe(false);
            vi.restoreAllMocks();
        }
    });

    it("becomes a labelled rail that starts with the menu and the note tree", async () => {
        const { pane, items, triggerCommand } = renderBar({ rail: true, width: "tablet", treeShown: true });

        expect(pane?.classList.contains("vertical")).toBe(true);
        expect(pane?.classList.contains("navigation-rail")).toBe(true);
        expect(document.body.classList.contains("navigation-rail")).toBe(true);
        expect(items[0]?.matches(".global-menu[data-label='true']")).toBe(true);
        expect(items[1]?.matches(".note-tree-launcher")).toBe(true);
        expect(items[2]?.matches("#launcher-container[data-horizontal='false'][data-labels='true']")).toBe(true);

        const tree = items[1] as HTMLButtonElement;
        expect(tree.querySelector(".launcher-button-label")?.textContent).toBe("note_tree.back-to-tree");
        expect(tree.classList.contains("active")).toBe(true);
        await act(async () => tree.click());
        expect(triggerCommand).toHaveBeenCalledWith("toggleLeftPane");

        // The menu, and the popup of a launcher such as Bookmarks, open in the place of the tree.
        triggerCommand.mockClear();
        await act(async () => (items[0] as HTMLButtonElement).click());
        expect(triggerCommand).toHaveBeenCalledWith("hideLeftPane");
        triggerCommand.mockClear();
        await act(async () => pane?.querySelector<HTMLButtonElement>(".launcher-with-popup")?.click());
        expect(triggerCommand).toHaveBeenCalledWith("hideLeftPane");

        // The tree button is marked only while the tree is open.
        const closed = renderBar({ rail: true, width: "tablet", treeShown: false });
        expect(closed.items[1]?.matches(".note-tree-launcher:not(.active)")).toBe(true);
    });
});
