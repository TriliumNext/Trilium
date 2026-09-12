import type { KeyboardShortcut } from "@triliumnext/commons";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Two actions clash on Ctrl+J, one of them also carries an OS-level shortcut, and two differ from
 * their defaults — so every filter has something to keep and something to drop.
 */
const SHORTCUTS = vi.hoisted(() => ([
    { separator: "Navigation" },
    {
        actionName: "back",
        friendlyName: "Back",
        effectiveShortcuts: [ "Alt+Left" ],
        defaultShortcuts: [ "Alt+Left" ],
        scope: "window"
    },
    {
        actionName: "jumpTo",
        friendlyName: "Jump to note",
        effectiveShortcuts: [ "Ctrl+J", "global:Ctrl+G" ],
        defaultShortcuts: [ "Ctrl+J" ],
        scope: "window"
    },
    { separator: "Editing" },
    {
        actionName: "bold",
        friendlyName: "Bold",
        effectiveShortcuts: [ "Ctrl+J" ],
        defaultShortcuts: [ "Ctrl+B" ],
        scope: "window"
    }
] as KeyboardShortcut[]));

const mocks = vi.hoisted(() => ({
    /** Every option write, which is how a shortcut is stored. */
    saved: [] as [ string, string ][],
    savedMany: [] as Record<string, string>[],
    confirm: vi.fn(async () => true)
}));

// A fresh copy per request: `keyboard_actions` reads the same route as it loads and normalizes what
// it gets in place, which would otherwise strip the fixture's global shortcut before the page sees it.
vi.mock("../../../services/server", () => ({
    default: { get: vi.fn(async () => structuredClone(SHORTCUTS)) }
}));

vi.mock("../../../services/i18n", () => ({ t: (key: string) => key }));

// Only the desktop build can claim a combination from the OS, so only there is the globe a button
// rather than a mark saying that a shortcut already is one.
vi.mock("../../../services/utils", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../services/utils")>()),
    isElectron: () => true
}));

vi.mock("../../../services/options", () => ({
    default: {
        save: (name: string, value: string) => void mocks.saved.push([ name, value ]),
        saveMany: (values: Record<string, string>) => void mocks.savedMany.push(values),
        get: () => "[]"
    }
}));

vi.mock("../../../services/dialog", () => ({ default: { confirm: mocks.confirm } }));

vi.mock("./components/OptionsPageHeader", () => ({
    default: ({ actions, below }: { actions?: preact.ComponentChildren; below?: preact.ComponentChildren }) =>
        <div className="header-stub">{actions}{below}</div>
}));

vi.mock("../../react/hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../react/hooks")>()),
    useStaticTooltip: vi.fn()
}));

import ShortcutSettings from "./shortcuts";

let host: HTMLElement;

beforeEach(async () => {
    mocks.saved = [];
    mocks.savedMany = [];
    host = document.body.appendChild(document.createElement("div"));
    await act(async () => {
        render(<ShortcutSettings />, host);
    });
    // The list is fetched as the page mounts, so it arrives a turn after the first render.
    await act(async () => {});
});

afterEach(() => {
    render(null, host);
    document.body.innerHTML = "";
    vi.clearAllMocks();
});

const shortcutNames = () =>
    [ ...host.querySelectorAll(".tn-card-option-label") ].map((label) => label.textContent?.trim());
const categories = () =>
    [ ...host.querySelectorAll(".tn-card-heading") ].map((heading) => heading.textContent);
const conflictsBadge = () => host.querySelector<HTMLElement>(".shortcut-conflicts-badge");

/** The row for an action, found by the name it carries. */
function rowFor(name: string) {
    return [ ...host.querySelectorAll(".tn-card-option") ]
        .find((row) => row.querySelector(".tn-card-option-label")?.textContent?.includes(name));
}

/**
 * Picks one of the filter menu's entries. The menu is only built once the dropdown is opened, and
 * it is carried out to the body from there, so it is looked for outside the page rather than in it.
 */
async function chooseFilter(index: number) {
    const toggle = host.querySelector<HTMLElement>(".header-stub .dropdown button");

    // The menu is only put into the body once the toggle is pressed, which in a browser means the
    // pointer going down before the click. `click()` alone sends no such press, and Bootstrap then
    // opens against a menu that is not there yet.
    await act(async () => void toggle?.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    await act(async () => toggle?.click());

    const items = [ ...document.body.querySelectorAll<HTMLElement>(".dropdown-menu .dropdown-item") ];
    await act(async () => items[index]?.click());
}

/** What was written for an action, parsed back into the list of shortcuts it stands for. */
function storedFor(actionName: string): string[] | undefined {
    const written = mocks.saved.find(([ name ]) => name.toLowerCase().includes(actionName.toLowerCase()));
    return written ? JSON.parse(written[1]) : undefined;
}

describe("flagging conflicts", () => {
    it("counts clashing combinations rather than the actions caught up in them", () => {
        // Two actions on Ctrl+J is one conflict, not two.
        expect(conflictsBadge()?.textContent).toContain("shortcuts.conflicts_badge");
        expect(host.querySelectorAll(".shortcut-chip.conflict").length).toBe(2);
    });

    it("groups the clashing actions by the combination they collide on, when filtered to them", async () => {
        await act(async () => conflictsBadge()?.click());

        // Filed under the combination itself rather than under the sections they came from.
        expect(categories()).toEqual([ "Ctrl+J" ]);
        expect(shortcutNames()).toHaveLength(2);
    });

    it("puts the whole list back when the badge is pressed again", async () => {
        await act(async () => conflictsBadge()?.click());
        await act(async () => conflictsBadge()?.click());

        expect(categories()).toEqual([ "Navigation", "Editing" ]);
    });
});

describe("the filter menu", () => {
    it("keeps only the actions carrying an OS-level shortcut", async () => {
        // All, conflicts, global, modified — in the order the menu offers them.
        await chooseFilter(2);

        expect(shortcutNames()?.length).toBe(1);
        expect(shortcutNames()[0]).toContain("Jump to note");
    });

    it("keeps only the actions that differ from what they shipped with", async () => {
        await chooseFilter(3);

        // Back is untouched; the other two have both been changed.
        expect(shortcutNames()).toHaveLength(2);
        expect(shortcutNames().join(" ")).not.toContain("Back");
    });

    it("brings everything back when the filter is cleared", async () => {
        await chooseFilter(2);
        await chooseFilter(0);

        expect(categories()).toEqual([ "Navigation", "Editing" ]);
    });
});

describe("editing an action's shortcuts", () => {
    it("stores the rest when one is removed", async () => {
        const remove = rowFor("Jump to note")?.querySelector<HTMLButtonElement>(".shortcut-chip-remove");
        await act(async () => remove?.click());

        expect(storedFor("jumpTo")).toEqual([ "global:Ctrl+G" ]);
    });

    it("rewrites a shortcut with the global prefix rather than adding a second one", async () => {
        const [ makeGlobal ] = [ ...(rowFor("Jump to note")?.querySelectorAll<HTMLButtonElement>(".shortcut-chip-global") ?? []) ];
        await act(async () => makeGlobal?.click());

        expect(storedFor("jumpTo")).toEqual([ "global:Ctrl+J", "global:Ctrl+G" ]);
    });

    it("offers a way back to the default only where something was changed", () => {
        expect(rowFor("Back")?.querySelector(".shortcut-revert-slot button")).toBeNull();
        expect(rowFor("Bold")?.querySelector(".shortcut-revert-slot button")).not.toBeNull();
    });

    it("marks a changed action, so it reads as changed without comparing anything", () => {
        expect(rowFor("Back")?.querySelector(".shortcut-modified-indicator")).toBeNull();
        expect(rowFor("Bold")?.querySelector(".shortcut-modified-indicator")).not.toBeNull();
    });

    it("puts back what the action shipped with when reverted", async () => {
        const revert = rowFor("Bold")?.querySelector<HTMLButtonElement>(".shortcut-revert-slot button");
        await act(async () => revert?.click());

        expect(storedFor("bold")).toEqual([ "Ctrl+B" ]);
    });
});

describe("setting everything back to default", () => {
    it("asks first, and writes only the actions that had actually been changed", async () => {
        const reset = [ ...host.querySelectorAll<HTMLButtonElement>(".header-stub button") ]
            .find((button) => button.textContent?.includes("shortcuts.set_all_to_default"));

        mocks.confirm.mockResolvedValueOnce(false);
        await act(async () => reset?.click());
        expect(mocks.savedMany).toEqual([]);

        await act(async () => reset?.click());
        const written = mocks.savedMany[0] ?? {};
        // Back already matches its default, so writing it would be a change record for nothing.
        expect(Object.keys(written)).toHaveLength(2);
    });
});
