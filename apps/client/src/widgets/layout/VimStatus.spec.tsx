import type { TriliumVim, VimStatus } from "@triliumnext/ckeditor5";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type NoteContext from "../../components/note_context";

const mocks = vi.hoisted(() => ({
    vim: undefined as unknown,
    areHintsEnabled: false,
    setCommandLineSlot: vi.fn(),
    useStaticTooltip: vi.fn(),
    toggleVimKeyReference: vi.fn()
}));

vi.mock("../../services/i18n", () => ({
    t: (key: string, options?: Record<string, string>) =>
        (options ? `${key} ${Object.values(options).join(" ")}` : key)
}));
vi.mock("../react/hooks", () => ({
    useGetContextDataFrom: () => mocks.vim,
    useTriliumOptionBool: () => [ mocks.areHintsEnabled, vi.fn() ],
    useTrackedElement: (ref: { current: HTMLElement | null }) => ref.current,
    useStaticTooltip: mocks.useStaticTooltip
}));
vi.mock("../type_widgets/text/vim_key_reference", () => ({
    toggleVimKeyReference: mocks.toggleVimKeyReference
}));
vi.mock("../type_widgets/text/vim_mode", () => ({ setCommandLineSlot: mocks.setCommandLineSlot }));

import {
    useVimStatus, VimCommandLineSlot, VimHintStrip, VimMessagePanel, VimStatusLine
} from "./VimStatus";

const OFF: VimStatus = {
    mode: null, isOneCommand: false, pendingKeys: "", recording: null, message: null,
    commandLine: null, hints: null
};

let container: HTMLElement;

beforeEach(() => {
    mocks.vim = undefined;
    mocks.areHintsEnabled = false;
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
        expect(getLine()?.textContent).toBe("vim_mode.normal");

        act(() => vim.setStatus({ ...OFF, mode: "insert", pendingKeys: "\"a3d" }));
        expect(getLine()?.textContent).toBe("\"a3dvim_mode.insert");

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
            return [ ...container.querySelectorAll(".vim-status-line > *") ]
                .map((part) => [ part.className, part.textContent ]);
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

describe("VimHintStrip", () => {
    it("leads with the typed keys, then the hints as keys and words", () => {
        act(() => render(<VimHintStrip hints={{
            kind: "command",
            typedKeys: [ "Ctrl+R" ],
            hints: [
                { keys: [ "a", "z" ], isRange: true, description: "a named register" },
                { keys: [ "j", "k" ], description: "screen line down, up" },
                { keys: [], description: "then" }
            ]
        }} />, container));
        const strip = container.querySelector(".vim-hint-strip.vim-hint-strip-command");
        expect(strip?.classList.contains("tn-shortcut-hints-kbd")).toBe(true);
        expect(strip?.querySelector(".vim-hint-typed-keys")?.textContent).toBe("Ctrl+R");
        expect([ ...container.querySelectorAll(".scrollable-label .vim-hint") ]
            .map((hint) => [ hint.querySelectorAll("kbd").length, hint.textContent ]))
            .toEqual([
                [ 2, "a-za named register" ], [ 2, "jkscreen line down, up" ], [ 0, "then" ]
            ]);
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

function Harness() {
    const status = useVimStatus({} as NoteContext);
    return status && <VimStatusLine status={status} />;
}

function show(vim: unknown) {
    mocks.vim = vim;
    act(() => render(<Harness />, container));
}

function getLine() {
    return container.querySelector(".vim-status-line");
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
