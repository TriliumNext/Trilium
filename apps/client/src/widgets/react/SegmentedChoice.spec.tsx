import $ from "jquery";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The collapsed rendering is chosen at render time, so the screen has to be answerable per test.
// Hoisted alongside the mock: `ActionButton` reads `isMobile()` as its module loads, which happens
// while the mock factory is still being resolved.
const isMobileMock = vi.hoisted(() => vi.fn(() => false));
vi.mock("../../services/utils", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../services/utils")>()),
    isMobile: () => isMobileMock()
}));

// Bootstrap places the menu against a real layout, which happy-dom has none of; what the collapsed
// choice decides is which lines exist, which is marked, and what a press reports.
vi.mock("bootstrap", () => ({
    Dropdown: { getOrCreateInstance: () => ({ show() {}, hide() {}, update() {}, dispose() {} }) },
    Tooltip: class { static getInstance() { return null; } }
}));
vi.mock("./hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./hooks")>()),
    useStaticTooltip: vi.fn(),
    useTooltip: () => ({ showTooltip: vi.fn(), hideTooltip: vi.fn() })
}));

import SegmentedChoice from "./SegmentedChoice";

// happy-dom has no ResizeObserver; the dropdown only needs observe/disconnect to exist.
class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
}
globalThis.ResizeObserver = globalThis.ResizeObserver ?? (ResizeObserverStub as unknown as typeof ResizeObserver);

describe("SegmentedChoice", () => {
    let container: HTMLDivElement;

    let cover: HTMLDivElement;

    beforeEach(() => {
        isMobileMock.mockReturnValue(false);
        container = document.createElement("div");
        document.body.appendChild(container);
        // The backdrop the dropdown reaches for by id; part of `index.html` rather than of any widget.
        cover = document.createElement("div");
        cover.id = "context-menu-cover";
        document.body.appendChild(cover);
    });

    afterEach(() => {
        render(null, container);
        container.remove();
        cover.remove();
    });

    const options = (extra?: { count?: number }) => [
        { value: "user" as const, label: "Yours", ...extra },
        { value: "system" as const, label: "System", count: extra?.count === undefined ? undefined : 7 }
    ];

    it("offers one button per option, marking the current one", () => {
        render(<SegmentedChoice options={options()} currentValue="system" onChange={() => {}} />, container);

        const buttons = [ ...container.querySelectorAll("button") ];
        expect(buttons.map((button) => button.textContent?.trim())).toStrictEqual([ "Yours", "System" ]);
        expect(buttons.map((button) => button.classList.contains("active"))).toStrictEqual([ false, true ]);
    });

    it("shows a count as a badge beside the name rather than inside it", () => {
        render(<SegmentedChoice options={options({ count: 3 })} currentValue="user" onChange={() => {}} />, container);

        const badges = [ ...container.querySelectorAll(".tn-segmented-choice-count") ];
        expect(badges.map((badge) => badge.textContent)).toStrictEqual([ "3", "7" ]);
        // The name is the label alone: a caller that has moved its count out of the string should not
        // find it written back into one.
        expect(badges[0]?.parentElement?.textContent?.trim()).toBe("Yours3");
    });

    it("shows a count of zero, and no badge at all where there is no count", () => {
        // An option offering nothing is worth saying so — and a badge that came and went with the last
        // item would resize the group under the pointer.
        render(<SegmentedChoice options={options({ count: 0 })} currentValue="user" onChange={() => {}} />, container);
        expect(container.querySelector(".tn-segmented-choice-count")?.textContent).toBe("0");

        render(<SegmentedChoice options={options()} currentValue="user" onChange={() => {}} />, container);
        expect(container.querySelectorAll(".tn-segmented-choice-count")).toHaveLength(0);
    });

    it("reports the option that was pressed", () => {
        const onChange = vi.fn();
        render(<SegmentedChoice options={options({ count: 3 })} currentValue="user" onChange={onChange} />, container);

        container.querySelectorAll("button")[1].click();
        expect(onChange).toHaveBeenCalledWith("system");
    });

    it("turns every option off together", () => {
        const onChange = vi.fn();
        render(<SegmentedChoice options={options()} currentValue="user" onChange={onChange} disabled />, container);

        const buttons = [ ...container.querySelectorAll("button") ];
        expect(buttons.map((button) => button.disabled)).toStrictEqual([ true, true ]);
        buttons[1].click();
        expect(onChange).not.toHaveBeenCalled();
    });

    describe("collapsed onto a narrow screen", () => {
        const iconOptions = [
            { value: "light" as const, label: "Light", icon: "bx-sun" },
            { value: "dark" as const, label: "Dark", icon: "bx-moon" }
        ];

        it("keeps its buttons where the caller has not asked for the fold", () => {
            isMobileMock.mockReturnValue(true);
            renderOpened(<SegmentedChoice options={options()} currentValue="user" onChange={() => {}} />);

            expect(menuItems()).toHaveLength(0);
            expect(container.querySelectorAll("button")).toHaveLength(2);
        });

        it("shows the options as a menu labelled with the current one, and reports the line pressed", () => {
            isMobileMock.mockReturnValue(true);
            const onChange = vi.fn();
            renderOpened(<SegmentedChoice options={iconOptions} currentValue="dark" onChange={onChange} collapseOnMobile />);

            // One toggle rather than a segment each, wearing the current option's own name and icon.
            const toggle = container.querySelector("button");
            expect(toggle?.textContent).toContain("Dark");
            expect(toggle?.querySelector(".bx-moon")).not.toBeNull();

            const items = menuItems();
            expect(items.map((item) => item.textContent?.trim())).toStrictEqual([ "Light", "Dark" ]);
            // The options carry icons, so the current one is highlighted rather than having its icon
            // replaced by a check mark.
            expect(items[1].className).toContain("active");
            expect(items[1].querySelector(".bx-moon")).not.toBeNull();

            act(() => (items[0] as HTMLElement).click());
            expect(onChange).toHaveBeenCalledExactlyOnceWith("light");
        });

        it("names an icon-only option by its title, and marks the current one where there are no icons", () => {
            isMobileMock.mockReturnValue(true);
            renderOpened(
                <SegmentedChoice
                    options={[ { value: "square" as const, icon: "bx-square", title: "Square" }, { value: "round" as const, label: "Round" } ]}
                    currentValue="square"
                    onChange={() => {}}
                    collapseOnMobile
                />);
            expect(menuItems().map((item) => item.textContent?.trim()))
                .toStrictEqual([ "Square", "Round" ]);

            renderOpened(<SegmentedChoice options={options()} currentValue="system" onChange={() => {}} collapseOnMobile />);
            const items = menuItems();
            expect(items[1].querySelector(".bx-check")).not.toBeNull();
        });

        it("comes up from the bottom of the screen, out of the dialog and over a backdrop", () => {
            isMobileMock.mockReturnValue(true);
            renderOpened(<SegmentedChoice options={iconOptions} currentValue="dark" onChange={() => {}} collapseOnMobile />);

            // Placed by the app's own bottom-sheet rule rather than by Popper, which mobile's forced
            // `position: fixed` leaves computing an offset for a menu positioned some other way.
            const menu = document.querySelector(".dropdown-menu.mobile-bottom-menu");
            expect(menu).not.toBeNull();
            // Portaled out: inside the settings dialog it would be trapped in the transformed
            // `.modal-dialog`, which is a containing block for `position: fixed` and a stacking
            // context the backdrop would then cover the menu through.
            expect(container.contains(menu)).toBe(false);
            expect(document.getElementById("context-menu-cover")?.classList.contains("show")).toBe(true);
        });

        it("shows a count beside the name rather than as a badge, the menu line having room for it", () => {
            isMobileMock.mockReturnValue(true);
            renderOpened(<SegmentedChoice options={options({ count: 3 })} currentValue="user" onChange={() => {}} collapseOnMobile />);

            const items = menuItems();
            expect(items.map((item) => item.querySelector("small")?.textContent)).toStrictEqual([ "3", "7" ]);
            expect(container.querySelectorAll(".tn-segmented-choice-count")).toHaveLength(0);
        });
    });

    /** The menu only renders its items once Bootstrap reports it open, which nothing does here. */
    function renderOpened(vnode: preact.ComponentChild) {
        act(() => render(vnode, container));
        const dropdown = container.querySelector(".dropdown");
        act(() => {
            if (dropdown) $(dropdown).trigger("show.bs.dropdown");
        });
    }

    /** Queried from the document rather than the container: the menu is portaled out to `body`. */
    function menuItems() {
        return [ ...document.querySelectorAll(".dropdown-item") ];
    }
});
