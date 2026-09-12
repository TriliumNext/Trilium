import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    electron: true,
    stored: {} as Record<string, string | boolean>,
    saved: [] as [ string, string | boolean ][]
}));

// The page is desktop-only; on a server build it stands down to a placeholder, so a scenario has to
// be able to say which kind of build it is pretending to be.
vi.mock("../../../services/utils", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../../services/utils")>();
    return {
        ...actual,
        isElectron: () => mocks.electron,
        default: { ...actual.default, reloadTray: vi.fn(), reapplyLaunchOnStartup: vi.fn() }
    };
});

vi.mock("../../../services/i18n", () => ({ t: (key: string) => key }));

vi.mock("../../react/hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../react/hooks")>()),
    useTriliumOption: (name: string) => [
        String(mocks.stored[name] ?? ""),
        (value: string) => void mocks.saved.push([ name, value ])
    ],
    useTriliumOptionBool: (name: string) => [
        mocks.stored[name] === true,
        (value: boolean) => void mocks.saved.push([ name, value ])
    ]
}));

vi.mock("./components/OptionsPageHeader", () => ({ default: () => <div className="header-stub" /> }));

import DesktopSettings from "./desktop";

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
        render(<DesktopSettings />, host);
    });
}

/** The switches, keyed by the setting each one carries — their ids are `<name>-<random>`. */
function toggle(name: string) {
    return host.querySelector<HTMLInputElement>(`input.switch-toggle[id^='${name}-']`);
}

describe("the desktop settings on a server build", () => {
    it("says the page has nothing to offer here, rather than showing settings that do nothing", () => {
        mocks.electron = false;
        open();

        expect(host.querySelector(".no-items")).not.toBeNull();
        expect(host.querySelector(".tn-card")).toBeNull();
    });
});

describe("the tray and startup settings", () => {
    it("shows the tray as on when it has not been disabled, since the setting is stored the other way round", () => {
        open();
        expect(toggle("tray-enabled")?.checked).toBe(true);

        mocks.stored = { disableTray: true };
        open();
        expect(toggle("tray-enabled")?.checked).toBe(false);
    });

    it("writes the tray setting inverted, so turning the switch on clears the disable flag", () => {
        open();
        act(() => {
            toggle("tray-enabled")?.dispatchEvent(new Event("input", { bubbles: true }));
        });

        expect(mocks.saved).toContainEqual([ "disableTray", true ]);
    });

    it("holds close-to-tray out of reach without a tray, which would hide the app with no way back", () => {
        open();
        expect(toggle("close-to-tray")?.disabled).toBe(false);

        mocks.stored = { disableTray: true };
        open();
        expect(toggle("close-to-tray")?.disabled).toBe(true);
    });

    it("holds starting hidden out of reach unless the app both starts itself and has a tray to hide in", () => {
        open();
        expect(toggle("hide-on-auto-start")?.disabled).toBe(true);

        mocks.stored = { launchOnStartup: true };
        open();
        expect(toggle("hide-on-auto-start")?.disabled).toBe(false);

        // A tray is the only way back from hidden, so losing it takes this with it.
        mocks.stored = { launchOnStartup: true, disableTray: true };
        open();
        expect(toggle("hide-on-auto-start")?.disabled).toBe(true);
    });
});

describe("the search engine settings", () => {
    it("marks the engine currently in use, and takes both its name and its address when one is picked", () => {
        mocks.stored = { customSearchEngineUrl: "https://www.google.com/search?q={keyword}" };
        open();

        const chips = [ ...host.querySelectorAll(".search-engine-templates .ext-badge") ];
        expect(chips).toHaveLength(4);
        expect(chips.filter((chip) => chip.className.includes("selected"))).toHaveLength(1);

        act(() => (chips[0] as HTMLElement).click());
        expect(mocks.saved.map(([ name ]) => name)).toEqual([ "customSearchEngineName", "customSearchEngineUrl" ]);
    });
});
