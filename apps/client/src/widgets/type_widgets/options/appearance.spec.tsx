import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    electron: true,
    mobile: false,
    stored: {} as Record<string, string | boolean>
}));

// Both the desktop card and the illustrated layout choices turn on which kind of client this is.
vi.mock("../../../services/utils", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../services/utils")>()),
    isElectron: () => mocks.electron,
    isMobile: () => mocks.mobile,
    reloadFrontendApp: vi.fn(),
    restartDesktopApp: vi.fn()
}));

vi.mock("../../../services/i18n", () => ({ t: (key: string) => key }));

// The theme card asks for the user's own themes as it mounts, and renders straight from the answer —
// an unanswered request leaves it reading `undefined`, which throws mid-render.
vi.mock("../../../services/server", () => ({
    default: {
        get: async (url: string) => (url === "options/user-themes" || url === "keyboard-actions" ? [] : {}),
        post: async () => ({}),
        put: async () => ({}),
        remove: async () => ({})
    }
}));

vi.mock("./components/OptionsPageHeader", () => ({ default: () => <div className="header-stub" /> }));

// The fonts card reaches for the user's own fonts and the device's as it mounts, and is covered by
// `appearance_fonts.spec.tsx`; here only its place on the page matters.
vi.mock("./appearance_fonts", () => ({ default: () => <div className="fonts-stub" /> }));

vi.mock("../../react/hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../react/hooks")>()),
    useTriliumOption: (name: string) => [ String(mocks.stored[name] ?? ""), vi.fn() ],
    useTriliumOptionBool: (name: string) => [ mocks.stored[name] === true, vi.fn() ]
}));

import AppearanceSettings from "./appearance";

let host: HTMLElement;

beforeEach(() => {
    mocks.electron = true;
    mocks.mobile = false;
    mocks.stored = {};
    host = document.body.appendChild(document.createElement("div"));
});

afterEach(() => {
    render(null, host);
    document.body.innerHTML = "";
});

/**
 * Opens the page fresh. The tree is torn down first so that a scenario changing a setting and
 * reopening gets a clean mount, rather than a diff against what the previous values rendered.
 */
function open() {
    act(() => {
        render(null, host);
        render(<AppearanceSettings />, host);
    });
}


describe("the layout choices", () => {
    it("gives each an illustrated card of its own, side by side", () => {
        open();

        const cards = [ ...host.querySelectorAll(".appearance-layout-choices .tn-card") ];
        expect(cards).toHaveLength(2);
        expect(cards.every((card) => card.className.includes("thumbnail-selector-option-card"))).toBe(true);
        expect(host.querySelectorAll(".appearance-layout-choices .radio-with-illustration")).toHaveLength(2);
    });

    it("offers neither on a phone, where the window has no shape to choose", () => {
        mocks.mobile = true;
        open();

        expect(host.querySelector(".appearance-layout-choices")).toBeNull();
    });

    it("offers the ribbon setting only on the old layout, which is the only one that has one", () => {
        open();
        expect(host.querySelector("input.switch-toggle[id^='edited-notes-open-in-ribbon-']")).not.toBeNull();

        mocks.stored = { newLayout: true };
        open();
        expect(host.querySelector("input.switch-toggle[id^='edited-notes-open-in-ribbon-']")).toBeNull();
    });
});

describe("the desktop-only settings", () => {
    it("are offered with the way to apply them, and neither is on a server build", () => {
        open();
        expect(host.querySelector(".appearance-electron")).not.toBeNull();
        expect(host.querySelector(".restart-action")).not.toBeNull();

        mocks.electron = false;
        open();
        expect(host.querySelector(".appearance-electron")).toBeNull();
        expect(host.querySelector(".restart-action")).toBeNull();
    });
});
