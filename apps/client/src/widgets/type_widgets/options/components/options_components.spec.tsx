import { describe, expect, it, vi } from "vitest";

import { renderInto } from "../../../../test/render";

vi.mock("../../../../services/i18n", () => ({ t: (key: string) => key }));

vi.mock("../../../react/hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../react/hooks")>()),
    useStaticTooltip: vi.fn()
}));

import CheckboxList from "./CheckboxList";
import MfaStatusBadge from "./MfaStatusBadge";
import PlatformIndicator from "./PlatformIndicator";
import RadioWithIllustration from "./RadioWithIllustration";
import RestartAction from "./RestartAction";
import ThemeModeSelector from "./ThemeModeSelector";

describe("CheckboxList", () => {
    const VALUES = [
        { id: "en", title: "English" },
        { id: "de", title: "German" },
        { id: "fixed", title: "Always on", locked: true }
    ];

    function list(currentValue: string[], onChange = vi.fn()) {
        const container = renderInto(
            <CheckboxList
                values={VALUES}
                keyProperty="id" titleProperty="title" disabledProperty="locked"
                currentValue={currentValue}
                onChange={onChange}
            />
        );
        return { container, boxes: [ ...container.querySelectorAll<HTMLInputElement>("input") ], onChange };
    }

    it("ticks what is held, and holds out of reach what cannot be unticked", () => {
        const { boxes } = list([ "de" ]);

        expect(boxes.map((box) => box.checked)).toEqual([ false, true, false ]);
        expect(boxes.map((box) => box.disabled)).toEqual([ false, false, true ]);
    });

    it("adds a value that was ticked, and drops one that was unticked", () => {
        const onChange = vi.fn();
        const { boxes } = list([ "de" ], onChange);

        boxes[0].dispatchEvent(new Event("change", { bubbles: true }));
        expect(onChange).toHaveBeenLastCalledWith([ "de", "en" ]);

        boxes[1].dispatchEvent(new Event("change", { bubbles: true }));
        expect(onChange).toHaveBeenLastCalledWith([]);
    });
});

describe("RadioWithIllustration", () => {
    const VALUES = [
        { key: "old", text: "Old layout", illustration: <span className="old-picture" /> },
        { key: "new", text: "New layout", illustration: <span className="new-picture" /> }
    ];

    it("marks the choice in force and reports the other when its picture is pressed", () => {
        const onChange = vi.fn();
        const container = renderInto(
            <RadioWithIllustration values={VALUES} currentValue="old" onChange={onChange} />
        );

        const items = [ ...container.querySelectorAll("li") ];
        expect(items.map((item) => item.className)).toEqual([ "selected", "" ]);
        // The picture is what is pressed, the caption naming it beneath.
        expect(items[1].querySelector("figcaption")?.textContent).toBe("New layout");

        items[1].querySelector<HTMLElement>(".illustration")?.click();
        expect(onChange).toHaveBeenCalledWith("new");
    });
});

describe("MfaStatusBadge", () => {
    it("carries its tone as a class and a glyph of its own, so the state reads without the colour", () => {
        // A different glyph per tone, so the three are never told apart by colour alone.
        const expected = { active: "bx-check", pending: "bx-link", inactive: "bx-x" } as const;

        for (const [ tone, icon ] of Object.entries(expected)) {
            const badge = renderInto(<MfaStatusBadge tone={tone as keyof typeof expected} text={tone} />)
                .querySelector(".mfa-status-badge");

            expect(badge?.className).toContain(tone);
            expect(badge?.innerHTML).toContain(icon);
        }
    });
});

describe("PlatformIndicator", () => {
    it("shows one glyph per platform it was given, each naming that platform on hover", () => {
        const both = [ ...renderInto(<PlatformIndicator windows="11" mac />).querySelectorAll(".platform-indicator span") ];

        expect(both.map((icon) => icon.className).join(" ")).toContain("bxl-windows");
        expect(both.map((icon) => icon.className).join(" ")).toContain("bxl-apple");
        // The platform is named in the tooltip rather than written out beside the glyph.
        expect(both.every((icon) => icon.hasAttribute("title"))).toBe(true);
    });

    it("shows nothing at all for a setting that is not tied to a platform", () => {
        const none = renderInto(<PlatformIndicator mac={false} />);
        expect(none.querySelectorAll(".platform-indicator span")).toHaveLength(0);
    });
});

describe("ThemeModeSelector", () => {
    it("shows which of the two the theme currently follows", () => {
        const following = renderInto(<ThemeModeSelector matchesApp onMatchesAppChange={vi.fn()} />);
        const [ app, fixed ] = [ ...following.querySelectorAll("button") ];

        expect(app.className).toContain("active");
        expect(fixed.className).not.toContain("active");
    });

    it("reports the choice as whether it follows the app, not as the word on the button", () => {
        const onChange = vi.fn();
        const container = renderInto(<ThemeModeSelector matchesApp onMatchesAppChange={onChange} />);

        const [ , fixed ] = [ ...container.querySelectorAll<HTMLElement>("button") ];
        fixed.click();
        expect(onChange).toHaveBeenCalledWith(false);
    });
});

describe("RestartAction", () => {
    it("stands outside any card, at the width the cards end on", () => {
        const container = renderInto(<RestartAction text="Restart" icon="bx-refresh" />);
        const block = container.querySelector(".restart-action");

        // A top-level block of the page, so it takes the cards' width; `restart-action` puts the
        // button where their controls end.
        expect(block?.querySelector("button[name='restart-app-button']")).not.toBeNull();
        expect(container.querySelector(".tn-card")).toBeNull();
    });
});
