import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Shared, mutable control state for the mocks below. `vi.hoisted` runs before the hoisted `vi.mock`
// factories, so they can safely reference it.
const ctrl = vi.hoisted(() => ({
    standalone: false, checkForUpdates: true, mobile: false, theme: "next", setTheme: vi.fn()
}));

// `isStandalone` is a const in the target, read here as a live getter so each scenario can flip the
// kind of client we are pretending to be. Partial-mock so the rest of utils stays real — in
// particular `isUpdateAvailable`, which is the version comparison under test.
vi.mock("../../services/utils", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../services/utils")>()),
    get isStandalone() {
        return ctrl.standalone;
    },
    isMobile: () => ctrl.mobile
}));

// The rows are read by their keys.
vi.mock("../../services/i18n", () => ({ t: (key: string) => key }));

// The hook reads the user's preference through `useTriliumOptionBool`; stub just that one, so the
// other hooks the menu pulls in keep their real implementation.
vi.mock("../react/hooks", async (importOriginal) => {
    const original = await importOriginal<typeof import("../react/hooks")>();
    return {
        ...original,
        useTriliumOptionBool: () => [ ctrl.checkForUpdates, vi.fn() ],
        useTriliumOption: (...args: Parameters<typeof original.useTriliumOption>) => (args[0] === "theme"
            ? [ ctrl.theme, ctrl.setTheme ]
            : original.useTriliumOption(...args))
    };
});

// Import AFTER the mocks (vi.mock is hoisted, but the import must resolve the mocked deps).
import type { UserTheme } from "@triliumnext/commons";

import server from "../../services/server";
import GlobalMenu, { parseLatestVersion, RELEASES_API_URL, UPDATE_CHECK_INTERVAL, useTriliumUpdateStatus } from "./global_menu";

let status: ReturnType<typeof useTriliumUpdateStatus> | undefined;
let container: HTMLDivElement | undefined;
let fetchMock: ReturnType<typeof vi.fn>;

function Probe() {
    status = useTriliumUpdateStatus();
    return null;
}

async function mount() {
    container = document.createElement("div");
    document.body.appendChild(container);
    await act(async () => {
        if (container) {
            render(<Probe />, container);
        }
    });
    await advance(1);
}

function unmount() {
    if (container) {
        render(null, container);
        container.remove();
        container = undefined;
    }
}

/** Runs the fake clock forward, flushing the promise chain of any fetch it kicks off along the way. */
async function advance(ms: number) {
    await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
    });
}

beforeEach(() => {
    vi.useFakeTimers();
    ctrl.standalone = false;
    ctrl.checkForUpdates = true;
    ctrl.mobile = false;
    status = undefined;

    window.glob = { ...window.glob, triliumVersion: "0.104.0" };
    fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ tag_name: "v0.104.1" }) });
    vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
    unmount();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe("useTriliumUpdateStatus", () => {
    it("polls GitHub and flags the update on clients the user updates by hand", async () => {
        await mount();

        expect(fetchMock).toHaveBeenCalledWith(RELEASES_API_URL);
        expect(status?.latestVersion).toBe("0.104.1");
        expect(status?.isUpdateAvailable).toBe(true);
    });

    it("stays quiet in standalone, which picks up new versions on reload", async () => {
        ctrl.standalone = true;

        await mount();

        expect(fetchMock).not.toHaveBeenCalled();
        expect(status?.latestVersion).toBeUndefined();
        expect(status?.isUpdateAvailable).toBe(false);
    });

    it("stays quiet when the user switched the check off", async () => {
        ctrl.checkForUpdates = false;

        await mount();

        expect(fetchMock).not.toHaveBeenCalled();
        expect(status?.isUpdateAvailable).toBe(false);
    });

    it("reports no update once the running version has caught up", async () => {
        window.glob = { ...window.glob, triliumVersion: "0.104.1" };

        await mount();

        expect(status?.latestVersion).toBe("0.104.1");
        expect(status?.isUpdateAvailable).toBe(false);
    });

    it("re-checks on the interval, and stops once unmounted", async () => {
        await mount();
        expect(fetchMock).toHaveBeenCalledTimes(1);

        await advance(UPDATE_CHECK_INTERVAL);
        expect(fetchMock).toHaveBeenCalledTimes(2);

        unmount();
        await advance(UPDATE_CHECK_INTERVAL * 2);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("keeps the badge hidden when GitHub cannot be reached", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        fetchMock.mockRejectedValue(new Error("offline"));

        await mount();

        expect(status?.latestVersion).toBeUndefined();
        expect(status?.isUpdateAvailable).toBe(false);
        expect(warn).toHaveBeenCalled();
    });
});

describe("parseLatestVersion", () => {
    it("strips the tag prefix, and ignores payloads without a usable tag", () => {
        expect(parseLatestVersion({ tag_name: "v0.104.1" })).toBe("0.104.1");
        expect(parseLatestVersion({ tag_name: "0.104.1" })).toBe("0.104.1");
        expect(parseLatestVersion({})).toBeUndefined();
        expect(parseLatestVersion(undefined)).toBeUndefined();
        expect(parseLatestVersion({ tag_name: 104 })).toBeUndefined();
    });
});

describe("GlobalMenu", () => {
    const popup = () => document.querySelector<HTMLElement>(".tn-popup:not([data-closing])");
    /** The keys of the rows at the top of the menu, or of the submenu page open over it. */
    const rows = (scope: Element | null | undefined) => [ ...scope?.querySelectorAll(":scope > li.dropdown-item, :scope > .dropdown-item") ?? [] ]
        .map((row) => row.textContent?.trim());

    let userThemes: UserTheme[] = [];

    /** Opens the menu, then the submenu whose title is `titleKey`. */
    async function openSubmenu(titleKey: string) {
        await act(async () => {
            if (container) render(<GlobalMenu isHorizontalLayout />, container);
        });
        const toggle = container?.querySelector<HTMLButtonElement>("button.global-menu-button");
        await act(async () => toggle?.click());
        await vi.waitFor(() => expect(popup()).not.toBeNull());
        const topLevelScroll = popup()?.querySelector(".tn-menu-scroll");
        const topLevel = rows(topLevelScroll);

        const submenuRow = [ ...popup()?.querySelectorAll<HTMLElement>("li.dropdown-submenu") ?? [] ]
            .find((row) => row.textContent?.includes(titleKey));
        // A phone opens a submenu as a page over the menu; a desktop beside it, on hover.
        const opened = () => popup()?.querySelector(":scope > .tn-menu-page .tn-menu-scroll")
            ?? popup()?.querySelector(":scope > div.dropdown-submenu > .dropdown-menu .tn-menu-scroll");
        await act(async () => {
            if (ctrl.mobile) submenuRow?.click();
            else submenuRow?.dispatchEvent(new PointerEvent("pointerenter"));
        });
        await vi.waitFor(() => expect(opened()).toBeTruthy());
        return { topLevel, topLevelScroll, submenuRow, submenu: opened() };
    }

    async function openAdvanced() {
        const { topLevel, submenu } = await openSubmenu("global_menu.advanced");
        return { topLevel, advanced: rows(submenu) };
    }

    /** Opens the theme submenu once the custom themes have loaded into it. */
    async function openThemes() {
        const opened = await openSubmenu("global_menu.theme");
        const items = () => [ ...opened.submenu?.querySelectorAll<HTMLElement>(":scope > li") ?? [] ];
        await vi.waitFor(() => expect(items().length).toBe(6 + userThemes.length));
        const row = (text: string) => items().find((item) => item.textContent?.trim() === text);
        return {
            ...opened,
            entries: items().map((item) => item.textContent?.trim()),
            checked: items().filter((item) => item.getAttribute("aria-checked") === "true")
                .map((item) => item.textContent?.trim()),
            row,
            click: (text: string) => act(async () => row(text)?.click())
        };
    }

    beforeEach(() => {
        vi.useRealTimers();
        container = document.body.appendChild(document.createElement("div"));
        // Without slides, a submenu's page goes as soon as it closes.
        document.body.classList.add("motion-disabled");

        ctrl.theme = "next";
        ctrl.setTheme.mockReset();
        userThemes = [ { val: "solarized", title: "Solarized", noteId: "solarizedNote", icon: "bx bx-paint" } ];
        const get = server.get.bind(server);
        vi.spyOn(server, "get").mockImplementation((async (url: string) => (url === "options/user-themes"
            ? userThemes
            : get(url))) as typeof server.get);
    });

    afterEach(() => {
        document.body.classList.remove("motion-disabled");
    });

    it("puts the theme submenu right above Advanced", async () => {
        const { topLevelScroll, submenuRow } = await openSubmenu("global_menu.theme");

        expect(submenuRow?.querySelector(".bx-palette")).not.toBeNull();
        const rowsInOrder = [ ...topLevelScroll?.querySelectorAll(":scope > li") ?? [] ];
        const next = submenuRow ? rowsInOrder[rowsInOrder.indexOf(submenuRow) + 1] : undefined;
        expect(next?.textContent?.trim()).toBe("global_menu.advanced");
    });

    it("lists the color schemes, then Modern and the custom themes, with the active ones checked", async () => {
        ctrl.theme = "next-dark";
        const { entries, checked, row, click } = await openThemes();

        expect(entries).toEqual([
            "theme.color_scheme",
            "theme.color_scheme_system", "theme.color_scheme_light", "theme.color_scheme_dark",
            "global_menu.theme",
            "theme.modern_themes", "Solarized"
        ]);
        expect(checked).toEqual([ "theme.color_scheme_dark", "theme.modern_themes" ]);
        expect(row("theme.color_scheme_dark")?.querySelector(".menu-trailing-icon.bx-check")).not.toBeNull();
        expect(row("theme.modern_themes")?.querySelector(".menu-trailing-icon.bx-check")).not.toBeNull();
        expect(row("Solarized")?.querySelector(".menu-trailing-icon")).toBeNull();
        expect(row("Solarized")?.querySelector(".tn-icon.bx-paint")).not.toBeNull();

        await click("theme.color_scheme_light");
        expect(ctrl.setTheme).toHaveBeenCalledWith("next-light");
    });

    it("leaves the legacy theme out, and keeps its color scheme when switching to Modern", async () => {
        ctrl.theme = "dark";
        const { entries, checked, click } = await openThemes();

        expect(entries).not.toContain("theme.legacy_themes");
        expect(checked).toEqual([ "theme.color_scheme_dark" ]);

        await click("theme.modern_themes");
        expect(ctrl.setTheme).toHaveBeenCalledWith("next-dark");
    });

    it("disables the color schemes while a custom theme is active", async () => {
        ctrl.theme = "solarized";
        const { checked, row } = await openThemes();

        expect(checked).toEqual([ "Solarized" ]);
        for (const scheme of [ "theme.color_scheme_system", "theme.color_scheme_light", "theme.color_scheme_dark" ]) {
            expect(row(scheme)?.getAttribute("aria-disabled")).toBe("true");
        }
    });

    it("keeps the shared notes and space usage views in Advanced", async () => {
        const { topLevel, advanced } = await openAdvanced();

        expect(topLevel.some((row) => row?.startsWith("global_menu.open_new_window"))).toBe(true);
        expect(topLevel.some((row) => row?.startsWith("global_menu.show_shared_notes_subtree"))).toBe(false);
        expect(topLevel.some((row) => row?.startsWith("global_menu.show_space_usage"))).toBe(false);
        expect(advanced.slice(0, 2).map((row) => row?.split(/\s/)[0])).toEqual([ "global_menu.show_shared_notes_subtree", "global_menu.show_space_usage" ]);
    });

    it("moves what a phone rarely needs into Advanced, and leaves out what it cannot use", async () => {
        ctrl.mobile = true;
        const { topLevel, advanced } = await openAdvanced();

        for (const key of [ "global_menu.open_new_window", "global_menu.show-cheatsheet", "global_menu.show_shared_notes_subtree",
            "global_menu.show_space_usage", "global_menu.switch_to_desktop_version" ]) {
            expect(topLevel.some((row) => row?.startsWith(key))).toBe(false);
        }
        expect(advanced.some((row) => row?.startsWith("global_menu.show_shared_notes_subtree"))).toBe(true);
        expect(advanced.some((row) => row?.startsWith("global_menu.show_space_usage"))).toBe(true);
        expect(advanced.at(-1)).toBe("global_menu.switch_to_desktop_version");
        expect([ ...topLevel, ...advanced ].some((row) => row?.startsWith("global_menu.open_new_window"))).toBe(false);
        expect([ ...topLevel, ...advanced ].some((row) => row?.startsWith("global_menu.show-cheatsheet"))).toBe(false);
        expect(popup()?.querySelector(".bx-palette")).toBeNull();
    });

    it("opens a phone's menu on a strip of search and the history views, and pairs fullscreen with Zen mode", async () => {
        const stripOf = (scope: Element | null | undefined) => [ ...scope?.querySelectorAll(":scope > .tn-menu-actions > .tn-menu-action") ?? [] ]
            .map((tile) => tile.textContent?.trim());
        const pairsOf = (scope: Element | null | undefined) => [ ...scope?.querySelectorAll(":scope > .form-list-row") ?? [] ]
            .map((row) => [ ...row.querySelectorAll(":scope > .form-list-col") ].map((col) => col.textContent?.trim()));
        const movedKeys = [ "global_menu.search_notes", "recent_changes.title", "global_menu.show_deleted_notes",
            "global_menu.toggle_fullscreen", "global_menu.toggle-zen-mode" ];

        const desktop = await openSubmenu("global_menu.advanced");
        expect(stripOf(desktop.topLevelScroll)).toEqual([]);
        expect(pairsOf(desktop.topLevelScroll)).toEqual([]);
        expect(desktop.topLevel).toContain("global_menu.show_deleted_notes");
        expect(desktop.topLevel).toContain("global_menu.toggle_fullscreen");
        expect(desktop.topLevel.some((row) => row?.startsWith("global_menu.toggle-zen-mode"))).toBe(true);
        render(null, container ?? document.body);

        ctrl.mobile = true;
        const phone = await openSubmenu("global_menu.advanced");
        const strip = phone.topLevelScroll?.firstElementChild;
        expect(strip?.classList.contains("tn-menu-actions-cards")).toBe(true);
        expect(stripOf(phone.topLevelScroll)).toEqual([ "global_menu.search_notes", "recent_changes.title", "global_menu.show_deleted_notes" ]);
        expect(pairsOf(phone.topLevelScroll)).toEqual([ [ "global_menu.fullscreen", "global_menu.toggle-zen-mode" ] ]);
        for (const key of movedKeys) {
            expect(phone.topLevel.some((row) => row?.startsWith(key))).toBe(false);
        }
    });
});
