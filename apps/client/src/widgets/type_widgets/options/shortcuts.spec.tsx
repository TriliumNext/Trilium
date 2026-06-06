import { KeyboardShortcut, OptionNames } from "@triliumnext/commons";
import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { flush, makeLoadResults, renderComponent } from "../../../test/render";

// --- Module mocks (hoisted above the component import) ---------------------------------------------

vi.mock("../../../services/dialog", () => ({
    default: { confirm: vi.fn(async () => true) }
}));
vi.mock("../../../services/utils", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../services/utils")>()),
    reloadFrontendApp: vi.fn()
}));

import type Component from "../../../components/component";
import dialog from "../../../services/dialog";
import options from "../../../services/options";
import server from "../../../services/server";
import { reloadFrontendApp } from "../../../services/utils";
import ShortcutSettings from "./shortcuts";

// --- Render harness (component wrapped in ParentComponent so useTriliumEvent registers) ------------

function renderShortcuts() {
    return renderComponent(<ShortcutSettings />);
}

function fireTriliumEvent(parent: Component, name: string, data: unknown) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    act(() => { (parent.handleEventInChildren as any)(name, data); });
}

function typeInto(input: HTMLInputElement, value: string) {
    act(() => {
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
    });
}

function blur(input: HTMLInputElement, value: string) {
    act(() => {
        input.value = value;
        input.dispatchEvent(new Event("focusout", { bubbles: true }));
    });
}

const SHORTCUTS: KeyboardShortcut[] = [
    { separator: "Navigation" },
    {
        actionName: "jumpToNote",
        friendlyName: "Jump to Note",
        description: "Opens the jump-to dialog",
        defaultShortcuts: [ "ctrl+j" ],
        effectiveShortcuts: [ "ctrl+j" ]
    },
    {
        actionName: "quickSearch",
        friendlyName: "Quick Search",
        description: "Focus the search box",
        defaultShortcuts: [ "ctrl+s" ],
        effectiveShortcuts: [ "alt+s" ]
    },
    {
        // No description, no shortcuts (exercises the optional branches).
        actionName: "openNewTab",
        friendlyName: "Open New Tab"
    },
    {
        // Has effective shortcuts but no defaultShortcuts -> exercises the `?? []` fallback on reset.
        actionName: "closeActiveTab",
        friendlyName: "Close Active Tab",
        effectiveShortcuts: [ "ctrl+w" ]
    }
];

beforeEach(() => {
    options.load({} as Record<OptionNames, string>);
    vi.clearAllMocks();
    Object.assign(server, {
        get: vi.fn(async (url: string) => (url === "keyboard-actions" ? SHORTCUTS : {}))
    });
    (dialog.confirm as ReturnType<typeof vi.fn>).mockResolvedValue(true);
});

describe("ShortcutSettings", () => {
    it("loads keyboard actions and renders a row per action plus a separator", async () => {
        const { container: root } = renderShortcuts();
        await flush();

        const table = root.querySelector("table.keyboard-shortcut-table");
        expect(table).not.toBeNull();

        const separator = root.querySelector("td.separator");
        expect(separator).not.toBeNull();
        expect(separator?.getAttribute("colspan")).toBe("4");
        expect(separator?.textContent).toContain("Navigation");

        // One row per shortcut (4 actions + 1 separator = 5 body rows).
        const bodyRows = root.querySelectorAll("tbody tr");
        expect(bodyRows.length).toBe(5);

        // Each action row has a ShortcutEditor input pre-filled with effectiveShortcuts.
        const editorInputs = root.querySelectorAll<HTMLInputElement>("tbody td input.form-control");
        expect(editorInputs.length).toBe(4);
        expect(editorInputs[0].value).toBe("ctrl+j");
        expect(editorInputs[1].value).toBe("alt+s");
        // Action without effectiveShortcuts renders an empty editor.
        expect(editorInputs[2].value).toBe("");
        expect(editorInputs[3].value).toBe("ctrl+w");
    });

    it("filters actions by name / friendlyName / shortcut and hides separators while filtering", async () => {
        const { container: root } = renderShortcuts();
        await flush();

        const filterInput = root.querySelector<HTMLInputElement>("header input.form-control");
        expect(filterInput).not.toBeNull();
        if (!filterInput) return;

        // Filter by friendly name fragment -> only "Quick Search" matches.
        typeInto(filterInput, "quick");
        const separatorAfterFilter = root.querySelector("td.separator");
        expect(separatorAfterFilter).toBeNull(); // separators hidden when filtering
        const editorInputs = root.querySelectorAll<HTMLInputElement>("tbody td input.form-control");
        expect(editorInputs.length).toBe(1);
        expect(editorInputs[0].value).toBe("alt+s");
    });

    it("matches by default shortcut, effective shortcut and description text", async () => {
        const { container: root } = renderShortcuts();
        await flush();
        const filterInput = root.querySelector<HTMLInputElement>("header input.form-control");
        if (!filterInput) return;

        // "ctrl+s" is a default shortcut of quickSearch only.
        typeInto(filterInput, "ctrl+s");
        expect(root.querySelectorAll<HTMLInputElement>("tbody td input.form-control").length).toBe(1);

        // "alt+s" is the effective shortcut of quickSearch.
        typeInto(filterInput, "alt+s");
        expect(root.querySelectorAll<HTMLInputElement>("tbody td input.form-control").length).toBe(1);

        // Description-only match.
        typeInto(filterInput, "jump-to");
        const inputs = root.querySelectorAll<HTMLInputElement>("tbody td input.form-control");
        expect(inputs.length).toBe(1);
        expect(inputs[0].value).toBe("ctrl+j");
    });

    it("shows the empty NoItems placeholder when nothing matches the filter", async () => {
        const { container: root } = renderShortcuts();
        await flush();
        const filterInput = root.querySelector<HTMLInputElement>("header input.form-control");
        if (!filterInput) return;

        typeInto(filterInput, "zzz-no-match");
        expect(root.querySelectorAll<HTMLInputElement>("tbody td input.form-control").length).toBe(0);
        expect(root.querySelector(".no-items")).not.toBeNull();
    });

    it("saves a new shortcut on blur, handling the +, escaping and trimming empties", async () => {
        const { container: root } = renderShortcuts();
        await flush();
        const saveSpy = vi.spyOn(options, "save").mockResolvedValue(undefined);

        const editorInputs = root.querySelectorAll<HTMLInputElement>("tbody td input.form-control");
        // jumpToNote is the first action -> option name keyboardShortcutsJumpToNote.
        // The trailing empty fragment after the last comma is removed by the !!shortcut filter,
        // and "ctrl++," survives as a single "+," shortcut via the +Comma escaping.
        blur(editorInputs[0], "ctrl+j,ctrl+k,,ctrl++,");

        expect(saveSpy).toHaveBeenCalledTimes(1);
        const [ optionName, value ] = saveSpy.mock.calls[0];
        expect(optionName).toBe("keyboardShortcutsJumpToNote");
        expect(JSON.parse(String(value))).toEqual([ "ctrl+j", "ctrl+k", "ctrl++," ]);
    });

    it("reloads the frontend app when the reload button is clicked", async () => {
        const { container: root } = renderShortcuts();
        await flush();
        const buttons = root.querySelectorAll<HTMLButtonElement>("footer button");
        expect(buttons.length).toBe(2);
        buttons[0].click();
        expect(reloadFrontendApp).toHaveBeenCalledTimes(1);
    });

    it("does not reset shortcuts when the confirm dialog is declined", async () => {
        (dialog.confirm as ReturnType<typeof vi.fn>).mockResolvedValue(false);
        const { container: root } = renderShortcuts();
        await flush();
        const saveMany = vi.spyOn(options, "saveMany").mockResolvedValue(undefined);

        const buttons = root.querySelectorAll<HTMLButtonElement>("footer button");
        buttons[1].click();
        await flush();

        expect(dialog.confirm).toHaveBeenCalledTimes(1);
        expect(saveMany).not.toHaveBeenCalled();
    });

    it("resets only the shortcuts that differ from their defaults when confirmed", async () => {
        const { container: root } = renderShortcuts();
        await flush();
        const saveMany = vi.spyOn(options, "saveMany").mockResolvedValue(undefined);

        const buttons = root.querySelectorAll<HTMLButtonElement>("footer button");
        buttons[1].click();
        await flush();

        expect(saveMany).toHaveBeenCalledTimes(1);
        const payload = saveMany.mock.calls[0][0] as Record<string, string>;
        // jumpToNote effective == default -> skipped; openNewTab has no effectiveShortcuts -> skipped.
        // quickSearch (alt+s != ctrl+s) resets to ctrl+s; closeActiveTab (ctrl+w, no defaults) resets to [].
        expect(Object.keys(payload).sort()).toEqual([ "keyboardShortcutsCloseActiveTab", "keyboardShortcutsQuickSearch" ]);
        expect(JSON.parse(payload.keyboardShortcutsQuickSearch)).toEqual([ "ctrl+s" ]);
        expect(JSON.parse(payload.keyboardShortcutsCloseActiveTab)).toEqual([]);
    });

    it("updates an effective shortcut from an entitiesReloaded option change", async () => {
        const { container: root, parent } = renderShortcuts();
        await flush();

        options.load({ keyboardShortcutsJumpToNote: JSON.stringify([ "ctrl+x" ]) } as Record<OptionNames, string>);
        fireTriliumEvent(parent, "entitiesReloaded", { loadResults: makeLoadResults({ optionNames: [ "keyboardShortcutsJumpToNote" ] }) });

        const editorInputs = root.querySelectorAll<HTMLInputElement>("tbody td input.form-control");
        expect(editorInputs[0].value).toBe("ctrl+x");
    });

    it("updates multiple effective shortcuts from a single entitiesReloaded event", async () => {
        const { container: root, parent } = renderShortcuts();
        await flush();

        options.load({
            keyboardShortcutsJumpToNote: JSON.stringify([ "ctrl+x" ]),
            keyboardShortcutsQuickSearch: JSON.stringify([ "ctrl+y" ])
        } as Record<OptionNames, string>);
        // Two matching names in one event exercises the `if (!updatedShortcuts)` already-set branch.
        fireTriliumEvent(parent, "entitiesReloaded", {
            loadResults: makeLoadResults({ optionNames: [ "keyboardShortcutsJumpToNote", "keyboardShortcutsQuickSearch" ] })
        });

        const editorInputs = root.querySelectorAll<HTMLInputElement>("tbody td input.form-control");
        expect(editorInputs[0].value).toBe("ctrl+x");
        expect(editorInputs[1].value).toBe("ctrl+y");
    });

    it("ignores entitiesReloaded events with no option names or no matching shortcut prefix", async () => {
        const { container: root, parent } = renderShortcuts();
        await flush();
        const before = root.querySelectorAll<HTMLInputElement>("tbody td input.form-control")[0].value;

        // No option names -> early return.
        fireTriliumEvent(parent, "entitiesReloaded", { loadResults: makeLoadResults({ optionNames: [] }) });
        // Non-shortcut option name -> continue, no update.
        fireTriliumEvent(parent, "entitiesReloaded", { loadResults: makeLoadResults({ optionNames: [ "theme" ] }) });
        // Shortcut option whose action is not among the loaded actions -> no matching shortcut.
        options.load({ keyboardShortcutsDeleteNotes: JSON.stringify([ "del" ]) } as Record<OptionNames, string>);
        fireTriliumEvent(parent, "entitiesReloaded", { loadResults: makeLoadResults({ optionNames: [ "keyboardShortcutsDeleteNotes" ] }) });

        const after = root.querySelectorAll<HTMLInputElement>("tbody td input.form-control")[0].value;
        expect(after).toBe(before);
    });
});
