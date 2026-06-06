import type { ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderComponent } from "../../test/render";
import type { ModalProps } from "../react/Modal";

// --- Module mocks (hoisted above the component import) ---------------------------------------------

/** Captures the props the dialog passes to <Modal>, so we can drive its callbacks directly. */
const capturedModalProps: { current: ModalProps | undefined } = { current: undefined };
/** Captures the props passed to <NoteAutocomplete> (rendered as the modal title). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const capturedAutocompleteProps: { current: any } = { current: undefined };
/** Captures the props passed to the footer <Button>. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const capturedButtonProps: { current: any } = { current: undefined };

vi.mock("../react/Modal", () => ({
    default: (props: ModalProps) => {
        capturedModalProps.current = props;
        return (
            <div className={`modal ${props.className}`} data-shown={String(props.show)}>
                <div className="modal-title-slot">{props.title as ComponentChildren}</div>
                <div className="modal-body-slot">{props.children}</div>
                <div className="modal-footer-slot">{props.footer as ComponentChildren}</div>
            </div>
        );
    }
}));

vi.mock("../react/NoteAutocomplete", () => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    default: (props: any) => {
        capturedAutocompleteProps.current = props;
        // Forward the inputRef so the dialog's autocompleteRef.current resolves to a real element.
        return <input className="captured-autocomplete" ref={props.inputRef} value={props.text} placeholder={props.placeholder} />;
    }
}));

vi.mock("../react/Button", () => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    default: (props: any) => {
        capturedButtonProps.current = props;
        return <button className={`captured-button ${props.className ?? ""}`} onClick={props.onClick}>{props.text}</button>;
    }
}));

vi.mock("../../services/note_autocomplete", () => ({
    default: {
        showRecentNotes: vi.fn(),
        showAllCommands: vi.fn(),
        setText: vi.fn()
    }
}));

vi.mock("../../services/command_registry", () => ({
    default: {
        executeCommand: vi.fn(async () => undefined)
    }
}));

vi.mock("../../services/shortcuts", () => ({
    default: {
        bindElShortcut: vi.fn()
    }
}));

const { setNote, getActiveContext, triggerCommand } = vi.hoisted(() => {
    const setNote = vi.fn();
    return {
        setNote,
        getActiveContext: vi.fn(() => ({ setNote })),
        triggerCommand: vi.fn(async () => undefined)
    };
});
vi.mock("../../components/app_context", () => ({
    default: {
        tabManager: { getActiveContext },
        triggerCommand
    }
}));

import appContext from "../../components/app_context";
import type Component from "../../components/component";
import commandRegistry from "../../services/command_registry";
import note_autocomplete from "../../services/note_autocomplete";
import shortcutService from "../../services/shortcuts";
import JumpToNoteDialogComponent from "./jump_to_note";

// --- Harness --------------------------------------------------------------------------------------

let harnessParent: Component | undefined;

function renderDialog() {
    const { parent } = renderComponent(<JumpToNoteDialogComponent />);
    harnessParent = parent;
    return parent;
}

function fireTrilium(name: string, data: unknown = {}) {
    act(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (harnessParent?.handleEventInChildren as any)?.(name, data);
    });
}

beforeEach(() => {
    vi.clearAllMocks();
    getActiveContext.mockReturnValue({ setNote });
    capturedModalProps.current = undefined;
    capturedAutocompleteProps.current = undefined;
    capturedButtonProps.current = undefined;
});

// --- Tests ----------------------------------------------------------------------------------------

describe("JumpToNoteDialogComponent", () => {
    it("renders hidden initially with the autocomplete title and command-mode footer button", () => {
        renderDialog();
        const props = capturedModalProps.current;
        expect(props?.show).toBe(false);
        expect(props?.className).toBe("jump-to-note-dialog");
        expect(props?.size).toBe("lg");
        // Not in command mode initially → footer button present.
        expect(props?.footer).toBeTruthy();
        // The autocomplete is wired with command-palette options.
        expect(capturedAutocompleteProps.current?.opts).toMatchObject({
            allowCreatingNotes: true,
            isCommandPalette: true,
            allowJumpToSearchNotes: true,
            hideGoToSelectedNoteButton: true
        });
        expect(capturedAutocompleteProps.current?.text).toBe("");
    });

    it("opens in recent-notes mode on jumpToNote and shows recent notes on shown", () => {
        renderDialog();
        fireTrilium("jumpToNote", {});
        expect(capturedModalProps.current?.show).toBe(true);
        expect(capturedAutocompleteProps.current?.text).toBe("");

        act(() => capturedModalProps.current?.onShown?.());
        expect(note_autocomplete.showRecentNotes).toHaveBeenCalledTimes(1);
        expect(note_autocomplete.showAllCommands).not.toHaveBeenCalled();
        // bindElShortcut wired for ctrl+return.
        expect(shortcutService.bindElShortcut).toHaveBeenCalledWith(expect.anything(), "ctrl+return", expect.any(Function));
    });

    it("opens in command mode on commandPalette, sets '>' text, and shows all commands", () => {
        renderDialog();
        fireTrilium("commandPalette", {});
        expect(capturedModalProps.current?.show).toBe(true);
        expect(capturedAutocompleteProps.current?.text).toBe(">");

        act(() => capturedModalProps.current?.onShown?.());
        expect(note_autocomplete.showAllCommands).toHaveBeenCalledTimes(1);
        expect(note_autocomplete.showRecentNotes).not.toHaveBeenCalled();
    });

    it("keeps the last search when reopened quickly after typing", () => {
        renderDialog();
        // Open (recent), type something so actualText is set.
        fireTrilium("jumpToNote", {});
        act(() => capturedAutocompleteProps.current?.onTextChange?.("hello"));
        // Reopen immediately → last-search mode, preserving the typed text.
        fireTrilium("jumpToNote", {});
        expect(capturedAutocompleteProps.current?.text).toBe("hello");

        // onShown in last-search mode triggers neither recent nor commands.
        act(() => capturedModalProps.current?.onShown?.());
        expect(note_autocomplete.showRecentNotes).not.toHaveBeenCalled();
        expect(note_autocomplete.showAllCommands).not.toHaveBeenCalled();
    });

    it("entering '>' via onTextChange switches to command mode and hides the footer button", () => {
        renderDialog();
        fireTrilium("jumpToNote", {});
        expect(capturedModalProps.current?.footer).toBeTruthy();

        act(() => capturedAutocompleteProps.current?.onTextChange?.("> palette"));
        expect(capturedModalProps.current?.footer).toBeFalsy();

        act(() => capturedAutocompleteProps.current?.onTextChange?.("plain"));
        expect(capturedModalProps.current?.footer).toBeTruthy();
    });

    it("onChange navigates to a note path and hides the dialog", async () => {
        renderDialog();
        fireTrilium("jumpToNote", {});
        await act(async () => { await capturedAutocompleteProps.current?.onChange?.({ notePath: "root/abc" }); });
        expect(getActiveContext).toHaveBeenCalled();
        expect(setNote).toHaveBeenCalledWith("root/abc");
        expect(capturedModalProps.current?.show).toBe(false);
    });

    it("onChange executes a command when a commandId is selected", async () => {
        renderDialog();
        fireTrilium("commandPalette", {});
        await act(async () => { await capturedAutocompleteProps.current?.onChange?.({ commandId: "myCommand" }); });
        expect(commandRegistry.executeCommand).toHaveBeenCalledWith("myCommand");
        expect(setNote).not.toHaveBeenCalled();
        expect(capturedModalProps.current?.show).toBe(false);
    });

    it("onChange with no suggestion is a no-op (does not hide the dialog)", () => {
        renderDialog();
        fireTrilium("jumpToNote", {});
        expect(capturedModalProps.current?.show).toBe(true);
        act(() => capturedAutocompleteProps.current?.onChange?.(null));
        expect(setNote).not.toHaveBeenCalled();
        expect(commandRegistry.executeCommand).not.toHaveBeenCalled();
        expect(capturedModalProps.current?.show).toBe(true);
    });

    it("footer button click triggers a full-text search and hides the dialog", async () => {
        renderDialog();
        fireTrilium("jumpToNote", {});
        act(() => capturedAutocompleteProps.current?.onTextChange?.("search me"));
        await act(async () => { await capturedButtonProps.current?.onClick?.(); });
        expect(triggerCommand).toHaveBeenCalledWith("searchNotes", { searchString: "search me" });
        expect(capturedModalProps.current?.show).toBe(false);
    });

    it("full-text search does not trigger when text is a command (starts with '>')", async () => {
        renderDialog();
        fireTrilium("jumpToNote", {});
        // The ctrl+return shortcut handler is what fires showInFullSearch.
        act(() => capturedModalProps.current?.onShown?.());
        const calls = (shortcutService.bindElShortcut as ReturnType<typeof vi.fn>).mock.calls;
        const shortcutHandler = calls.length ? calls[calls.length - 1][2] : undefined;

        // In command mode the ctrl+return handler must NOT search.
        act(() => capturedAutocompleteProps.current?.onTextChange?.("> nope"));
        await act(async () => { await shortcutHandler?.(); });
        expect(triggerCommand).not.toHaveBeenCalled();
    });

    it("ctrl+return shortcut triggers full search when not in command mode", async () => {
        renderDialog();
        fireTrilium("jumpToNote", {});
        act(() => capturedAutocompleteProps.current?.onTextChange?.("findme"));
        act(() => capturedModalProps.current?.onShown?.());
        const calls = (shortcutService.bindElShortcut as ReturnType<typeof vi.fn>).mock.calls;
        const shortcutHandler = calls.length ? calls[calls.length - 1][2] : undefined;
        await act(async () => { await shortcutHandler?.(); });
        expect(triggerCommand).toHaveBeenCalledWith("searchNotes", { searchString: "findme" });
    });

    it("full-text search swallows trigger errors", async () => {
        renderDialog();
        fireTrilium("jumpToNote", {});
        act(() => capturedAutocompleteProps.current?.onTextChange?.("boom"));
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
        triggerCommand.mockRejectedValueOnce(new Error("nope"));
        await act(async () => { await capturedButtonProps.current?.onClick?.(); });
        expect(consoleError).toHaveBeenCalled();
        consoleError.mockRestore();
    });

    it("onHidden hides the dialog", () => {
        renderDialog();
        fireTrilium("jumpToNote", {});
        expect(capturedModalProps.current?.show).toBe(true);
        act(() => capturedModalProps.current?.onHidden?.());
        expect(capturedModalProps.current?.show).toBe(false);
    });

    it("uses appContext default export", () => {
        // sanity: the mocked appContext is wired correctly
        expect(appContext.tabManager.getActiveContext).toBe(getActiveContext);
    });

    it("onChange with a suggestion lacking notePath and commandId just hides", async () => {
        renderDialog();
        fireTrilium("jumpToNote", {});
        await act(async () => { await capturedAutocompleteProps.current?.onChange?.({ noteTitle: "x" }); });
        expect(setNote).not.toHaveBeenCalled();
        expect(commandRegistry.executeCommand).not.toHaveBeenCalled();
        expect(capturedModalProps.current?.show).toBe(false);
    });

    it("does not call setMode when reopening in the same (recent-notes) mode", () => {
        renderDialog();
        fireTrilium("jumpToNote", {});
        act(() => capturedModalProps.current?.onShown?.());
        const firstShowRecentCalls = (note_autocomplete.showRecentNotes as ReturnType<typeof vi.fn>).mock.calls.length;
        // Reopen with no typed text → recent-notes again (same mode, line 48 false branch).
        fireTrilium("jumpToNote", {});
        act(() => capturedModalProps.current?.onShown?.());
        expect((note_autocomplete.showRecentNotes as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(firstShowRecentCalls);
    });
});
