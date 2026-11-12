import type { VimStatus } from "@triliumnext/ckeditor5";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type NoteContext from "../../components/note_context";

const mocks = vi.hoisted(() => ({
    vim: undefined as unknown,
    setCommandLineSlot: vi.fn()
}));

vi.mock("../../services/i18n", () => ({
    t: (key: string, options?: Record<string, string>) =>
        (options ? `${key} ${Object.values(options).join(" ")}` : key)
}));
vi.mock("../react/hooks", () => ({ useGetContextDataFrom: () => mocks.vim }));
vi.mock("../type_widgets/text/vim_mode", () => ({ setCommandLineSlot: mocks.setCommandLineSlot }));

import {
    useVimStatus, VimCommandLineSlot, VimMessagePanel, VimStatusLine
} from "./VimStatus";

const OFF: VimStatus = {
    mode: null, isOneCommand: false, pendingKeys: "", recording: null, message: null,
    commandLine: null
};

let container: HTMLElement;

beforeEach(() => {
    mocks.vim = undefined;
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
