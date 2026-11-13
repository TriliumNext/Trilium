import type { TriliumVim, VimStatus } from "@triliumnext/ckeditor5";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import appContext from "../../components/app_context";
import type NoteContext from "../../components/note_context";
import type FNote from "../../entities/fnote";
import type { MenuItem } from "../../menus/context_menu";
import options from "../../services/options";

const mocks = vi.hoisted(() => ({
    vim: undefined as unknown,
    areHintsEnabled: false,
    isVimModeOptionOn: false,
    isMobile: false,
    note: null as FNote | null,
    vimModeLabel: null as string | null,
    setLabelValueWithInheritance: vi.fn(),
    setCommandLineSlot: vi.fn(),
    useStaticTooltip: vi.fn(),
    toggleVimKeyReference: vi.fn(),
    showContextMenu: vi.fn(),
    openHelpPageFor: vi.fn()
}));

vi.mock("../../services/i18n", () => ({
    t: (key: string, options?: Record<string, string>) =>
        (options ? `${key} ${Object.values(options).join(" ")}` : key)
}));
vi.mock("../react/hooks", () => ({
    useGetContextDataFrom: () => mocks.vim,
    useNoteContext: () => ({ note: mocks.note, noteContext: { ntxId: "_popup-editor" } }),
    useNoteLabel: () => [ mocks.vimModeLabel, vi.fn() ],
    useTriliumOptionBool: (name: string) => [
        name === "textNoteVimModeEnabled" ? mocks.isVimModeOptionOn : mocks.areHintsEnabled,
        vi.fn()
    ],
    useTrackedElement: (ref: { current: HTMLElement | null }) => ref.current,
    useStaticTooltip: mocks.useStaticTooltip
}));
vi.mock("../../services/attributes", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../services/attributes")>()),
    setLabelValueWithInheritance: mocks.setLabelValueWithInheritance
}));
vi.mock("../../menus/context_menu", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../menus/context_menu")>()),
    default: { show: mocks.showContextMenu }
}));
vi.mock("../../services/utils", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../services/utils")>()),
    isMobile: () => mocks.isMobile
}));
vi.mock("../react/HelpButton", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../react/HelpButton")>()),
    openHelpPageFor: mocks.openHelpPageFor
}));
vi.mock("../type_widgets/text/vim_key_reference", () => ({
    toggleVimKeyReference: mocks.toggleVimKeyReference
}));
vi.mock("../type_widgets/text/vim_mode", () => ({ setCommandLineSlot: mocks.setCommandLineSlot }));

import {
    useVimStatus, VimCommandLineSlot, VimHintStrip, VimMessagePanel, VimModeBadge, VimStatusLine,
    VimTitleStatus
} from "./VimStatus";

const OFF: VimStatus = {
    mode: null, isOneCommand: false, pendingKeys: "", recording: null, message: null,
    commandLine: null, hints: null
};

let container: HTMLElement;

beforeEach(() => {
    mocks.vim = undefined;
    mocks.areHintsEnabled = false;
    mocks.isVimModeOptionOn = false;
    mocks.isMobile = false;
    mocks.note = null;
    mocks.vimModeLabel = null;
    container = document.body.appendChild(document.createElement("div"));
});

afterEach(() => {
    act(() => render(null, container));
    document.body.innerHTML = "";
    vi.resetAllMocks();
});

describe("useVimStatus", () => {
    it("follows the status of the published Vim mode, and is null while it is off", () => {
        show(undefined);
        expect(getLine()).toBeNull();

        const vim = createVim({ ...OFF, mode: "normal" });
        show(vim);
        expect(getLine()?.textContent?.trim()).toBe("vim_mode.normal");

        act(() => vim.setStatus({ ...OFF, mode: "insert", pendingKeys: "\"a3d" }));
        expect(getLine()?.textContent?.trim()).toBe("\"a3dvim_mode.insert");

        act(() => vim.setStatus(OFF));
        expect(getLine()).toBeNull();
        act(() => render(null, container));
        expect(vim.listeners.size).toBe(0);
    });
});

describe("VimStatusLine", () => {
    it("names the mode, Insert mode for one command and what is pending or recorded", () => {
        const parts = (status: Partial<VimStatus>) => {
            act(() => render(<VimStatusLine status={{ ...OFF, ...status }} />, container));
            return [ ...container.querySelectorAll(".vim-status-line > *") ].map((part) => [
                [ ...part.classList ].find((name) => name.startsWith("vim-")),
                part.textContent?.trim()
            ]);
        };

        expect(parts({ mode: "visual-line" })).toEqual([ [ "vim-mode", "vim_mode.visual_line" ] ]);
        expect(parts({ mode: "replace" })).toEqual([ [ "vim-mode", "vim_mode.replace" ] ]);
        expect(parts({ mode: "normal", isOneCommand: true }))
            .toEqual([ [ "vim-mode", "vim_mode.one_command" ] ]);
        expect(parts({ mode: "visual", isOneCommand: true }))
            .toEqual([ [ "vim-mode", "vim_mode.one_command_in vim_mode.visual" ] ]);
        expect(parts({
            mode: "normal",
            message: { text: "Pattern not found", isLong: false },
            recording: "q",
            pendingKeys: "2d"
        })).toEqual([
            [ "vim-message", "Pattern not found" ],
            [ "vim-recording", "vim_mode.recording q" ],
            [ "vim-pending-keys", "2d" ],
            [ "vim-mode", "vim_mode.normal" ]
        ]);
        expect(parts({ mode: "normal", message: { text: "--- Registers ---", isLong: true } }))
            .toEqual([ [ "vim-mode", "vim_mode.normal" ] ]);
    });

    it("tells how to stop a recording, and leaves the pending keys to the hint strip", () => {
        mocks.areHintsEnabled = true;
        const hints = { kind: "command" as const, typedKeys: [ "d" ], hints: [] };
        act(() => render(<VimStatusLine status={{
            ...OFF, mode: "normal", recording: "q", pendingKeys: "d", hints
        }} />, container));
        expect(container.querySelector(".vim-recording")?.textContent)
            .toBe("vim_mode.recording qqvim_mode.stop_recording");
        expect(container.querySelector(".vim-recording kbd")?.textContent).toBe("q");
        expect(container.querySelector(".vim-pending-keys")).toBeNull();

        act(() => render(<VimStatusLine status={{
            ...OFF, mode: "normal", pendingKeys: "d", hints: { ...hints, kind: "mode" }
        }} />, container));
        expect(container.querySelector(".vim-pending-keys")?.textContent).toBe("d");
    });
});

describe("the mode", () => {
    it("explains each mode in its tooltip, and shows the keys on a click", () => {
        const tooltips = ([ "normal", "insert", "visual", "visual-line", "replace" ] as const)
            .map((mode) => {
                act(() => render(<VimStatusLine status={{ ...OFF, mode }} />, container));
                return mocks.useStaticTooltip.mock.lastCall?.[1].title;
            });
        expect(tooltips).toEqual([
            "vim_mode.normal_tooltip", "vim_mode.insert_tooltip", "vim_mode.visual_tooltip",
            "vim_mode.visual_tooltip", "vim_mode.replace_tooltip"
        ]);
        expect(mocks.useStaticTooltip.mock.lastCall?.[1])
            .toMatchObject({ placement: "top", fallbackPlacements: [ "top" ] });

        const button = container.querySelector<HTMLButtonElement>("button.vim-mode");
        button?.click();
        expect(mocks.toggleVimKeyReference).not.toHaveBeenCalled();
        const vim = {} as TriliumVim;
        act(() => render(<VimStatusLine status={{ ...OFF, mode: "normal" }} vim={vim} />,
            container));
        const mouseDown = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
        button?.dispatchEvent(mouseDown);
        expect(mouseDown.defaultPrevented).toBe(true);
        button?.click();
        expect(mocks.toggleVimKeyReference).toHaveBeenCalledWith(vim, button);
    });
});

describe("VimModeBadge", () => {
    it("shows whether the note has Vim mode, and sets its label only where needed on a click",
        () => {
        const getTooltip = () => mocks.useStaticTooltip.mock.lastCall?.[1].title;
        let note = {} as FNote;
        // A new note each time, as a component with hook state skips a render with the same props.
        const showBadge = (label: string | null) => {
            mocks.vimModeLabel = label;
            note = {} as FNote;
            act(() => render(<VimModeBadge note={note} ntxId="main" />, container));
            return container.querySelector<HTMLButtonElement>("button.vim-mode-badge");
        };

        const badge = showBadge(null);
        expect(badge?.textContent?.trim()).toBe("vim_mode.badge");
        expect(badge?.getAttribute("aria-pressed")).toBe("true");
        expect(getTooltip()).toBe("vim_mode.badge_on_tooltip");
        expect(mocks.useStaticTooltip.mock.lastCall?.[1].placement).toBe("top");
        const mouseDown = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
        badge?.dispatchEvent(mouseDown);
        expect(mouseDown.defaultPrevented).toBe(true);
        badge?.click();
        // The badge shows while the option is on, so a note without the label has Vim mode.
        expect(mocks.setLabelValueWithInheritance)
            .toHaveBeenLastCalledWith(note, "vimMode", "false", "true");

        expect(showBadge("")?.getAttribute("aria-pressed")).toBe("true");
        expect(showBadge("false")?.getAttribute("aria-pressed")).toBe("false");
        expect(getTooltip()).toBe("vim_mode.badge_off_tooltip");
        badge?.click();
        expect(mocks.setLabelValueWithInheritance)
            .toHaveBeenLastCalledWith(note, "vimMode", "true", "true");
    });

    it("opens a menu of the note's Vim mode, the key hints, the settings and the help", () => {
        const isOption = vi.spyOn(options, "is").mockReturnValue(true);
        const toggleOption = vi.spyOn(options, "toggle").mockResolvedValue(undefined);
        const triggerCommand = vi.spyOn(appContext, "triggerCommand")
            .mockResolvedValue(undefined);
        mocks.vimModeLabel = "false";
        const ownedLabel = { isInheritable: false };
        const note = { getOwnedLabel: () => ownedLabel } as unknown as FNote;
        act(() => render(<VimModeBadge note={note} ntxId="main" />, container));

        const items = openBadgeMenu();
        expect(getMenuRows(items)).toEqual([
                [ "vim_mode.menu_note", true, false ],
                "separator",
                [ "vim_mode.hints", true, true ],
                [ "vim_mode.menu_settings", false, undefined ],
                "separator",
                [ "vim_mode.menu_help", false, undefined ]
            ]);
        expect(isOption).toHaveBeenCalledWith("vimModeHintsEnabled");
        const [ noteItem ] = items;
        expect("description" in noteItem && noteItem.description)
            .toBe("vim_mode.menu_note_description");
        // The switch changes the owned label, which an inheritable one passes to the subtree.
        ownedLabel.isInheritable = true;
        const [ subtreeItem ] = openBadgeMenu();
        expect("description" in subtreeItem && subtreeItem.description)
            .toBe("vim_mode.menu_note_description_subtree");

        runMenuItems(items);
        expect(mocks.setLabelValueWithInheritance)
            .toHaveBeenCalledWith(expect.anything(), "vimMode", "true", "true");
        expect(toggleOption).toHaveBeenCalledWith("vimModeHintsEnabled");
        expect(triggerCommand)
            .toHaveBeenCalledWith("showOptions", { section: "_optionsTextNotes" });
        expect(mocks.openHelpPageFor).toHaveBeenCalledWith("enVNpi1Njswq", "main");
    });
});

describe("VimTitleStatus", () => {
    it("shows the badge while the option is on and the mode while Vim runs, tooltips below", () => {
        // A new mount each time, as the component has no props that change between the renders.
        const showTitle = () => {
            act(() => render(null, container));
            act(() => render(<VimTitleStatus />, container));
            return getTitleParts();
        };
        mocks.note = {} as FNote;
        mocks.isVimModeOptionOn = true;
        expect(showTitle()).toBeNull();

        const vim = createVim(OFF);
        mocks.vim = vim;
        expect(showTitle()).toEqual([ "vim_mode.badge" ]);
        act(() => vim.setStatus({
            ...OFF, mode: "insert", pendingKeys: "2", message: { text: "Hi", isLong: false }
        }));
        expect(getTitleParts()).toEqual([ "vim_mode.badge", "vim_mode.insert" ]);
        const tooltips = mocks.useStaticTooltip.mock.calls.map(([ , options ]) =>
            [ options.title, options.placement, options.fallbackPlacements ]);
        expect(tooltips).toContainEqual([ "vim_mode.badge_on_tooltip", "bottom", [ "bottom" ] ]);
        expect(tooltips).toContainEqual([ "vim_mode.insert_tooltip", "bottom", [ "bottom" ] ]);
        expect(tooltips.filter(([ , placement ]) => placement !== "bottom")).toEqual([]);
        const mode = container.querySelector<HTMLButtonElement>(".vim-title-status .vim-mode");
        mode?.click();
        expect(mocks.toggleVimKeyReference).toHaveBeenCalledWith(vim, mode);

        // A note with `#vimMode=true` runs Vim while the option is off.
        mocks.isVimModeOptionOn = false;
        expect(showTitle()).toEqual([ "vim_mode.insert" ]);

        mocks.isVimModeOptionOn = true;
        mocks.isMobile = true;
        act(() => vim.setStatus(OFF));
        expect(showTitle()).toBeNull();
        mocks.isMobile = false;
        mocks.note = null;
        expect(showTitle()).toBeNull();
    });

    it("leaves the key hints out of the badge menu, and opens the help from the popup", () => {
        vi.spyOn(appContext, "triggerCommand").mockResolvedValue(undefined);
        const toggleOption = vi.spyOn(options, "toggle").mockResolvedValue(undefined);
        mocks.note = { getOwnedLabel: () => null } as unknown as FNote;
        mocks.isVimModeOptionOn = true;
        mocks.vim = createVim(OFF);
        act(() => render(<VimTitleStatus />, container));

        const items = openBadgeMenu();
        expect(getMenuRows(items)).toEqual([
            [ "vim_mode.menu_note", true, true ],
            "separator",
            [ "vim_mode.menu_settings", false, undefined ],
            "separator",
            [ "vim_mode.menu_help", false, undefined ]
        ]);
        runMenuItems(items);
        expect(toggleOption).not.toHaveBeenCalled();
        expect(mocks.openHelpPageFor).toHaveBeenCalledWith("enVNpi1Njswq", "_popup-editor");
    });
});

describe("VimHintStrip", () => {
    it("leads with the typed keys, then the hints as keys and words", () => {
        act(() => render(<VimHintStrip hints={{
            kind: "command",
            typedKeys: [ "Ctrl+R" ],
            hints: [
                { keys: [ "a", "z" ], isRange: true, description: "a named register" },
                { keys: [ "j", "k" ], description: "screen line down, up" },
                { keys: [], description: "then" },
                { keys: [ "Esc" ], description: "breadcrumb", id: "breadcrumb" }
            ]
        }} />, container));
        const strip = container.querySelector(".vim-hint-strip.vim-hint-strip-command");
        expect(strip?.classList.contains("tn-shortcut-hints-kbd")).toBe(true);
        expect(strip?.querySelector(".vim-hint-typed-keys")?.textContent).toBe("Ctrl+R");
        expect([ ...container.querySelectorAll(".scrollable-label .vim-hint") ]
            .map((hint) => [ hint.querySelectorAll("kbd").length, hint.textContent ]))
            .toEqual([
                [ 2, "a-za named register" ], [ 2, "jkscreen line down, up" ], [ 0, "then" ],
                [ 1, "Escbreadcrumb" ]
            ]);
        expect([ ...container.querySelectorAll(".vim-hint.vim-hint-breadcrumb") ]
            .map((hint) => hint.textContent)).toEqual([ "Escbreadcrumb" ]);
    });

    it("moves its hints with a vertical wheel", () => {
        act(() => render(<VimHintStrip hints={{
            kind: "mode", typedKeys: [], hints: [ { keys: [ "i" ], description: "insert" } ]
        }} />, container));
        const label = container.querySelector(".scrollable-label") as HTMLElement;
        Object.defineProperty(label, "scrollWidth", { value: 300 });
        Object.defineProperty(label, "clientWidth", { value: 100 });
        label.dispatchEvent(new WheelEvent("wheel", { deltaY: 40, cancelable: true }));
        expect(label.scrollLeft).toBe(40);
    });

    it("keeps the focus where it is when pressed", () => {
        act(() => render(<VimHintStrip hints={{
            kind: "mode", typedKeys: [], hints: [ { keys: [ "i" ], description: "insert" } ]
        }} />, container));
        expect(container.querySelector(".vim-hint-typed-keys")).toBeNull();
        const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
        container.querySelector(".vim-hint")?.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
    });
});

describe("the command line slot and the message panel", () => {
    it("registers the slot of the command line while it is mounted", () => {
        act(() => render(<VimCommandLineSlot />, container));
        const slot = container.querySelector(".vim-command-line-slot");
        expect(slot).not.toBeNull();
        expect(mocks.setCommandLineSlot).toHaveBeenLastCalledWith(slot);

        act(() => render(null, container));
        expect(mocks.setCommandLineSlot).toHaveBeenLastCalledWith(null);
    });

    it("shows a long message with its lines kept", () => {
        act(() => render(<VimMessagePanel text={"a\nb"} />, container));
        expect(container.querySelector("pre.vim-message-panel")?.textContent).toBe("a\nb");
    });
});

/**
 * Shows the status of `vim`, which the mocked `useGetContextDataFrom()` returns. A new `vim` is a
 * new prop, since `@preact/signals` skips the render of a component with hook state whose props
 * are the same.
 */
function Harness({ vim }: { vim: unknown }) {
    mocks.vim = vim;
    const status = useVimStatus({} as NoteContext);
    return status && <VimStatusLine status={status} />;
}

function show(vim: unknown) {
    act(() => render(<Harness vim={vim} />, container));
}

function getLine() {
    return container.querySelector(".vim-status-line");
}

/** Opens the menu of the Vim mode badge with a right click, and returns its items. */
function openBadgeMenu(): MenuItem<unknown>[] {
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    container.querySelector(".vim-mode-badge")?.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    return mocks.showContextMenu.mock.lastCall?.[0].items ?? [];
}

/** The title, switch flag and checked state of each item of a menu, or the kind of a separator. */
function getMenuRows(items: MenuItem<unknown>[]) {
    return items.map((item) => ("kind" in item
        ? item.kind
        : [ item.title, !!item.isSwitch, item.checked ]));
}

function runMenuItems(items: MenuItem<unknown>[]) {
    for (const item of items) {
        if (!("kind" in item)) {
            item.handler?.(item, new MouseEvent("click"));
        }
    }
}

/** The texts of the parts of the Vim status in the title row, or `null` while it is not shown. */
function getTitleParts() {
    const title = container.querySelector(".vim-title-status");
    return title && [ ...title.children ].map((part) => part.textContent?.trim());
}

function createVim(initial: VimStatus) {
    const listeners = new Set<() => void>();
    const vim = {
        status: initial,
        listeners,
        on: (_event: string, callback: () => void) => listeners.add(callback),
        off: (_event: string, callback: () => void) => listeners.delete(callback),
        setStatus(status: VimStatus) {
            vim.status = status;
            for (const listener of listeners) {
                listener();
            }
        }
    };
    return vim;
}
