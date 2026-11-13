import type { CKTextEditor, TriliumVim, VimConfig, VimHost } from "@triliumnext/ckeditor5";
import { useEffect, useRef, useState } from "preact/hooks";

import appContext, { type CommandNames } from "../../../components/app_context";
import type NoteContext from "../../../components/note_context";
import type FNote from "../../../entities/fnote";
import { copyHtml, copyText, readClipboardText } from "../../../services/clipboard_ext";
import { t } from "../../../services/i18n";
import options from "../../../services/options";
import toast from "../../../services/toast";
import { isMobile } from "../../../services/utils";
import {
    useContextualShortcutHints, useNoteLabel, useTriliumOption, useTriliumOptionBool
} from "../../react/hooks";
import { closeShortcutHints } from "../../shortcut_hints/shortcut_hints_panel";
import { findTextEditorAround } from "./editable_embed";
import { getVimHintSection } from "./vim_key_reference";

interface VimConfigOptions {
    /** The element that holds the editor. */
    getContainer(): HTMLElement | null;
    /** Triggers `command` on the component that hosts the editor. */
    triggerHostCommand(command: CommandNames): unknown;
}

/** The element of the status bar that shows the command line, set by the status bar. */
let commandLineSlot: HTMLElement | null = null;

/**
 * The configuration of the Vim mode of a text editor, `config.vim`. It reads the options on each
 * call, so a change applies to the open editors.
 */
export function buildVimConfig({ getContainer, triggerHostCommand }: VimConfigOptions): VimConfig {
    return {
        host: {
            mountCommandLine,
            save: () => void triggerHostCommand("saveNoteDetailNow"),
            closeTab: () => {
                void triggerHostCommand("saveNoteDetailNow");
                return closeSplitOf(getContainer());
            },
            followLink: () => void triggerHostCommand("followLinkUnderCursor"),
            readClipboard: readClipboardText,
            writeClipboard: (text, html) => void (html ? copyHtml(html, text) : copyText(text)),
            toggleHintStrip: () => void options.toggle("vimModeHintStripShown"),
            setHintsEnabled: (isEnabled) =>
                void options.save("vimModeHintsEnabled", String(isEnabled)),
            closeKeyReference: closeShortcutHints
        },
        getStartupCommands: () => options.get("textNoteVimStartupCommands") ?? "",
        isInsertKeysEnabled: () => options.is("textNoteVimInsertKeysEnabled"),
        areHintsEnabled: () => options.is("vimModeHintsEnabled"),
        isHintStripShown: () => options.is("vimModeHintStripShown")
    };
}

/** Sets the element of the status bar that shows the command line, or `null` when it goes. */
export function setCommandLineSlot(element: HTMLElement | null) {
    commandLineSlot = element;
}

/** Explains how to use Vim mode, the first time it is turned on. */
export function showVimModeNotice() {
    toast.showPersistent({
        id: "vim-mode-notice",
        icon: "bx bx-info-circle",
        title: t("vim_mode.notice_title"),
        message: t("vim_mode.notice")
    });
}

/**
 * Whether a text note gets Vim mode: its `#vimMode` label decides, and without one the option of
 * the device. Never in the mobile layout.
 */
export function isVimModeWanted(label: string | null | undefined, isOptionOn: boolean) {
    if (isMobile()) {
        return false;
    }
    return typeof label === "string" ? label !== "false" : isOptionOn;
}

/**
 * Turns the Vim mode of `editor` on or off as the option and the label of `note` say, and publishes
 * in `noteContext` the Vim mode that the status bar shows while `isVisible`. A hidden type widget,
 * such as the editable one of a note shown read-only, leaves the status bar to the displayed one.
 */
export function useVimMode(
    editor: CKTextEditor | undefined, note: FNote | null | undefined,
    noteContext: NoteContext | null | undefined, isVisible = true
) {
    const [ isOptionOn ] = useTriliumOptionBool("textNoteVimModeEnabled");
    const [ startupCommands ] = useTriliumOption("textNoteVimStartupCommands");
    const [ areHintsEnabled ] = useTriliumOptionBool("vimModeHintsEnabled");
    const [ isHintStripShown ] = useTriliumOptionBool("vimModeHintStripShown");
    // Re-renders when the label changes. The value is read from the note because, for one render
    // after a note switch, the hook still holds the label of the previous note.
    useNoteLabel(note, "vimMode");
    const isWanted = isVimModeWanted(note?.getLabelValue("vimMode"), isOptionOn);
    const noteId = note?.noteId;
    const previousRef = useRef<{ editor?: CKTextEditor; noteId?: string; isOptionOn: boolean }>({
        isOptionOn
    });

    useEffect(() => {
        const vim = editor?.plugins.has("TriliumVim") ? editor.plugins.get("TriliumVim") : null;
        if (!editor || !vim) return;
        const previous = previousRef.current;
        previousRef.current = { editor, noteId, isOptionOn };
        const isSameEditor = previous.editor === editor;
        // Another note in the same editor starts again in Normal mode, with its own marks.
        if (isSameEditor && previous.noteId !== noteId) {
            void vim.setEnabled(false);
        }
        // The editors that are open when the option is turned on start in Insert mode.
        const isTurnedOn = isSameEditor && isOptionOn && !previous.isOptionOn;
        void vim.setEnabled(isWanted, isTurnedOn ? "insert" : "normal");
    }, [ editor, noteId, isWanted, isOptionOn ]);

    useEffect(() => {
        if (editor?.plugins.has("TriliumVim")) {
            editor.plugins.get("TriliumVim").refreshStartupCommands();
        }
    }, [ editor, startupCommands ]);

    useEffect(() => {
        if (editor?.plugins.has("TriliumVim")) {
            editor.plugins.get("TriliumVim").refreshHints();
        }
    }, [ editor, areHintsEnabled, isHintStripShown ]);

    const focusedVim = useFocusedVim(editor);
    usePublishedVim(noteContext, noteId, isVisible ? focusedVim : undefined);
    useContextualShortcutHints(() =>
        (focusedVim?.isActive ? [ getVimHintSection(focusedVim) ] : []));
}

/** Shows the command line in the status bar, when the status bar shows the Vim mode of `editor`. */
const mountCommandLine: NonNullable<VimHost["mountCommandLine"]> = (element, editor) => {
    const shownVim = appContext.tabManager.getActiveContext()?.getContextData("vimMode");
    const slot = commandLineSlot;
    if (!slot?.getClientRects().length || shownVim !== editor.plugins.get("TriliumVim")) {
        return false;
    }
    slot.append(element);
    return true;
};

/** Closes the split of the tab that shows `element`, as `Ctrl+W` does. */
function closeSplitOf(element: HTMLElement | null): boolean {
    const ntxId = element?.closest("[data-ntx-id]")?.getAttribute("data-ntx-id");
    const tabManager = appContext.tabManager;
    const noteContext = tabManager.noteContexts.find((context) => context.ntxId === ntxId);
    if (!noteContext || noteContext.getMainContext().pinned) {
        return false;
    }
    void tabManager.removeNoteContext(noteContext.ntxId);
    return true;
}

/**
 * Publishes `vim` as the `vimMode` context data while the editor shows the note of `noteContext`.
 * A note switch clears the context data, and the editor publishes it again.
 */
function usePublishedVim(
    noteContext: NoteContext | null | undefined, noteId: string | undefined,
    vim: TriliumVim | undefined
) {
    useEffect(() => {
        if (!noteContext || !vim || noteContext.noteId !== noteId) return;
        noteContext.setContextData("vimMode", vim);
        return () => {
            if (noteContext.getContextData("vimMode") === vim) {
                noteContext.clearContextData("vimMode");
            }
        };
    }, [ noteContext, noteId, vim ]);
}

/** The Vim mode of `editor`, or of the editor of an embed in it while that one has the focus. */
function useFocusedVim(editor: CKTextEditor | undefined): TriliumVim | undefined {
    const [ focusedVim, setFocusedVim ] = useState<TriliumVim>();

    useEffect(() => {
        const root = editor?.editing.view.getDomRoot();
        if (!editor?.plugins.has("TriliumVim") || !root) return;
        const vim = editor.plugins.get("TriliumVim");
        setFocusedVim(vim);
        let nestedEditor: CKTextEditor | undefined;
        const onNestedDestroy = () => setFocusedVim(vim);
        const onFocusIn = (event: FocusEvent) => {
            const focusedEditor = findTextEditorAround(event.target as HTMLElement);
            if (!focusedEditor?.plugins.has("TriliumVim")) return;
            nestedEditor?.off("destroy", onNestedDestroy);
            nestedEditor = focusedEditor === editor ? undefined : focusedEditor;
            nestedEditor?.on("destroy", onNestedDestroy);
            setFocusedVim(focusedEditor.plugins.get("TriliumVim"));
        };
        root.addEventListener("focusin", onFocusIn);
        return () => {
            nestedEditor?.off("destroy", onNestedDestroy);
            root.removeEventListener("focusin", onFocusIn);
        };
    }, [ editor ]);

    return focusedVim;
}
