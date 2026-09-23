import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    electron: true,
    standalone: false,
    /** What the settings currently are, as the options store answers them. */
    stored: {} as Record<string, boolean>,
    /** What the main process answers when asked to write one — refusing leaves nothing pending. */
    confirms: true
}));

// `isElectron` decides both whether these settings can be written at all and whether the LAN card is
// on offer, so a scenario has to be able to say which kind of build it is pretending to be.
// `isStandalone` is a const rather than a function, hence the getter: a scenario sets it before it
// renders, and the page reads it while rendering.
vi.mock("../../../services/utils", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../services/utils")>()),
    isElectron: () => mocks.electron,
    get isStandalone() { return mocks.standalone; }
}));

// i18next is never initialised here and answers `undefined` until it is, which would make every
// assertion about a description true of any string at all.
vi.mock("../../../services/i18n", () => ({ t: (key: string) => key }));

vi.mock("../../react/hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../react/hooks")>()),
    useTriliumOptionBool: (name: string) => [ mocks.stored[name] === true, vi.fn() ]
}));

vi.mock("./components/OptionsPageHeader", () => ({ default: () => <div className="header-stub" /> }));

import SecuritySettings from "./security";

let host: HTMLElement;

beforeEach(() => {
    mocks.electron = true;
    mocks.standalone = false;
    mocks.stored = {};
    mocks.confirms = true;
    (window as unknown as { electronApi: unknown }).electronApi = {
        security: {
            setBackendScriptingEnabled: vi.fn(async () => mocks.confirms),
            setSqlConsoleEnabled: vi.fn(async () => mocks.confirms),
            setLanAccessEnabled: vi.fn(async () => mocks.confirms)
        }
    };
    host = document.body.appendChild(document.createElement("div"));
});

afterEach(() => {
    render(null, host);
    document.body.innerHTML = "";
    delete (window as unknown as { electronApi?: unknown }).electronApi;
    delete (window as unknown as { standaloneApi?: unknown }).standaloneApi;
});

/**
 * Turns this into the in-browser build, where the settings live in an OPFS file the database
 * worker holds the lock on. Only the tab that owns that worker is given a `security` API to reach
 * it with, which is what `ownsDatabase` decides here.
 */
function asStandalone(ownsDatabase: boolean) {
    mocks.electron = false;
    mocks.standalone = true;
    delete (window as unknown as { electronApi?: unknown }).electronApi;
    (window as unknown as { standaloneApi: unknown }).standaloneApi = {
        restore: {},
        backup: {},
        security: ownsDatabase
            ? {
                setBackendScriptingEnabled: vi.fn(async () => mocks.confirms),
                setSqlConsoleEnabled: vi.fn(async () => mocks.confirms)
            }
            : undefined
    };
}

function standaloneSecurityApi() {
    return (window as unknown as {
        standaloneApi: { security: Record<string, ReturnType<typeof vi.fn>> };
    }).standaloneApi.security;
}

function open() {
    act(() => {
        render(<SecuritySettings />, host);
    });
}

const switches = () => [ ...host.querySelectorAll<HTMLInputElement>("input.switch-toggle") ];
const restartOffered = () => !!host.querySelector(".restart-action button");

/** Flips a switch, which writes the setting and — once confirmed — leaves it pending a restart. */
async function flip(index: number) {
    await act(async () => {
        switches()[index].dispatchEvent(new Event("input", { bubbles: true }));
    });
}

describe("the security settings", () => {
    it("offers one switch per setting, with nothing to restart for until something changes", () => {
        open();

        // Backend scripting, SQL console and LAN access — the last of which is desktop-only.
        expect(switches()).toHaveLength(3);
        expect(restartOffered()).toBe(false);
    });

    it("asks for a restart once a setting has actually been written, saying so on the row too", async () => {
        open();
        await flip(0);

        const api = (window as unknown as { electronApi: { security: { setBackendScriptingEnabled: ReturnType<typeof vi.fn> } } }).electronApi;
        expect(api.security.setBackendScriptingEnabled).toHaveBeenCalledWith(true);
        expect(restartOffered()).toBe(true);

        const row = switches()[0].closest(".tn-card-option");
        expect(row?.querySelector(".tn-card-option-description")?.textContent).toBe("security.restart_required");
    });

    it("writes each setting through its own channel, never one through another's", async () => {
        open();
        const api = (window as unknown as { electronApi: { security: Record<string, ReturnType<typeof vi.fn>> } }).electronApi;

        await flip(1);
        expect(api.security.setSqlConsoleEnabled).toHaveBeenCalledWith(true);
        expect(api.security.setBackendScriptingEnabled).not.toHaveBeenCalled();

        await flip(2);
        expect(api.security.setLanAccessEnabled).toHaveBeenCalledWith(true);
        // One restart covers however many were changed.
        expect(restartOffered()).toBe(true);
    });

    it("leaves everything as it was when the main process refuses the write", async () => {
        mocks.confirms = false;
        open();
        await flip(0);

        expect(restartOffered()).toBe(false);
    });

    it("treats a setting turned back to what it already was as no change at all", async () => {
        open();
        await flip(0);
        expect(restartOffered()).toBe(true);

        await flip(0);
        expect(restartOffered()).toBe(false);
    });

    it("holds the switches out of reach on a server build, and says where to set them instead", () => {
        mocks.electron = false;
        open();

        // LAN access is not offered at all: a server is already bound to its configured interface.
        expect(switches()).toHaveLength(2);
        expect(switches().every((toggle) => toggle.disabled)).toBe(true);

        // The config-file and environment-variable instructions, which the desktop build has no use for.
        expect(host.querySelectorAll(".collapsible")).toHaveLength(2);
        expect(restartOffered()).toBe(false);
    });
});

describe("the security settings in a browser", () => {
    it("are written through the standalone bridge, asking for a reload not a restart", async () => {
        asStandalone(true);
        open();

        // LAN access is a desktop setting: there is no listener here to open.
        expect(switches()).toHaveLength(2);
        expect(switches().every((toggle) => toggle.disabled)).toBe(false);

        await flip(0);
        expect(standaloneSecurityApi().setBackendScriptingEnabled).toHaveBeenCalledWith(true);

        const row = switches()[0].closest(".tn-card-option");
        const description = row?.querySelector(".tn-card-option-description")?.textContent;
        expect(description).toBe("security.standalone.reload_required");
        expect(host.querySelector(".restart-action button")?.textContent)
            .toContain("security.standalone.reload_now");
    });

    it("describes what a backend script reaches in a browser, not on a server", () => {
        asStandalone(true);
        open();

        // The desktop wording promises filesystem, network and OS access, none of which a Web
        // Worker has — telling a browser user that would be scaring them off the wrong thing.
        const description = host.querySelector(".tn-card-description")?.textContent;
        expect(description).toBe("security.standalone.backend_scripting_section_description");
    });

    it("leaves the switch where it was when the user declines the browser's dialog", async () => {
        mocks.confirms = false;
        asStandalone(true);
        open();

        await flip(0);

        expect(standaloneSecurityApi().setBackendScriptingEnabled).toHaveBeenCalledWith(true);
        expect(restartOffered()).toBe(false);
    });

    it("holds them out of reach in a tab that does not own the database", () => {
        asStandalone(false);
        open();

        expect(switches().every((toggle) => toggle.disabled)).toBe(true);
        expect(host.textContent).toContain("security.standalone.other_tab_hint");

        // Never the server instructions: there is no config.ini to add anything to.
        expect(host.querySelectorAll(".collapsible")).toHaveLength(0);
        expect(host.textContent).not.toContain("security.server_config_hint");
    });
});
