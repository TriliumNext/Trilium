import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    electron: true,
    stored: {} as Record<string, string>,
    saved: [] as [ string, string ][]
}));

// Spellcheck is only related to this page where the app owns the spell checker, so which kind of
// build we are pretending to be decides whether that entry is offered at all.
vi.mock("../../../services/utils", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../services/utils")>()),
    isElectron: () => mocks.electron,
    restartDesktopApp: vi.fn()
}));

vi.mock("../../../services/i18n", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../services/i18n")>()),
    t: (key: string) => key
}));

vi.mock("../../react/hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../react/hooks")>()),
    useTriliumOption: (name: string) => [
        mocks.stored[name] ?? "",
        (value: string) => void mocks.saved.push([ name, value ])
    ],
    useTriliumOptionJson: () => [ [], vi.fn() ]
}));

vi.mock("./components/OptionsPageHeader", () => ({ default: () => <div className="header-stub" /> }));

import InternationalizationOptions from "./i18n";

let host: HTMLElement;

beforeEach(() => {
    mocks.electron = true;
    mocks.stored = {};
    mocks.saved = [];
    host = document.body.appendChild(document.createElement("div"));
});

afterEach(() => {
    render(null, host);
    document.body.innerHTML = "";
});

function open() {
    act(() => {
        render(<InternationalizationOptions />, host);
    });
}

const cardHeadings = () => [ ...host.querySelectorAll(".tn-card-heading") ].map((heading) => heading.textContent);
const optionLabels = () =>
    [ ...host.querySelectorAll(".tn-card-option-label") ].map((label) => label.firstChild?.textContent);

describe("the Language & Region page", () => {
    it("keeps the languages and the calendar conventions in cards of their own", () => {
        open();

        expect(cardHeadings()).toEqual([
            "i18n.title",
            "i18n.dates-title",
            "content_language.title",
            "settings.related_settings"
        ]);
    });

    it("asks for the minimum days only under the rule that measures against them", () => {
        open();
        expect(optionLabels()).not.toContain("i18n.min-days-in-first-week");

        // "First week has minimum days" — the one rule the figure means anything under.
        mocks.stored = { firstWeekOfYear: "2" };
        open();
        expect(optionLabels()).toContain("i18n.min-days-in-first-week");
    });

    it("offers the way to start again, which is what every setting above it waits on", () => {
        open();

        const restart = host.querySelector(".restart-action button");
        expect(restart).not.toBeNull();
        // Outside every card: it acts rather than holds anything.
        expect(restart?.closest(".tn-card")).toBeNull();
    });

    it("names spellcheck as related only where the app owns the spell checker", () => {
        open();
        expect(host.querySelectorAll(".tn-card-section-link")).toHaveLength(1);

        mocks.electron = false;
        open();
        expect(host.querySelectorAll(".tn-card-section-link")).toHaveLength(0);
    });

    it("writes the day a week starts on back to the option it came from", () => {
        open();

        const select = host.querySelector<HTMLSelectElement>("select[name='first-day-of-week']");
        act(() => {
            if (select) {
                select.value = "7";
                select.dispatchEvent(new Event("change", { bubbles: true }));
            }
        });

        expect(mocks.saved).toContainEqual([ "firstDayOfWeek", "7" ]);
    });
});

