import "./VimStatus.css";

import type { VimMode, VimStatus } from "@triliumnext/ckeditor5";
import { useEffect, useState } from "preact/hooks";

import type NoteContext from "../../components/note_context";
import { t } from "../../services/i18n";
import { useGetContextDataFrom } from "../react/hooks";
import { setCommandLineSlot } from "../type_widgets/text/vim_mode";

/**
 * The status of the Vim mode that the status bar shows for `noteContext`, or `null` while its
 * text editor has Vim mode off.
 */
export function useVimStatus(noteContext: NoteContext | null | undefined): VimStatus | null {
    const vim = useGetContextDataFrom(noteContext, "vimMode");
    const [ status, setStatus ] = useState<VimStatus | null>(null);

    useEffect(() => {
        setStatus(vim?.status ?? null);
        if (!vim) return;
        const onChange = () => setStatus(vim.status);
        vim.on("change:status", onChange);
        return () => vim.off("change:status", onChange);
    }, [ vim ]);

    return status?.mode ? status : null;
}

/** The mode of Vim, the keys of the command being typed and the last short message. */
export function VimStatusLine({ status }: { status: VimStatus }) {
    const { message, recording, pendingKeys } = status;

    return (
        <span className="vim-status-line">
            {message && !message.isLong && <span className="vim-message">{message.text}</span>}
            {recording && (
                <span className="vim-recording">
                    {t("vim_mode.recording", { register: recording })}
                </span>
            )}
            {pendingKeys && <span className="vim-pending-keys">{pendingKeys}</span>}
            <span className="vim-mode">{getModeName(status)}</span>
        </span>
    );
}

/** The place of the command line of `:`, `/` and `?`, which replaces the breadcrumb. */
export function VimCommandLineSlot() {
    return <div className="vim-command-line-slot" ref={setCommandLineSlot} />;
}

/** A message of several lines, such as the list of `:registers`, until the next key. */
export function VimMessagePanel({ text }: { text: string }) {
    return <pre className="vim-message-panel">{text}</pre>;
}

const MODE_NAMES: Record<VimMode, () => string> = {
    normal: () => t("vim_mode.normal"),
    insert: () => t("vim_mode.insert"),
    replace: () => t("vim_mode.replace"),
    visual: () => t("vim_mode.visual"),
    "visual-line": () => t("vim_mode.visual_line")
};

/** The name of the mode, which shows `(INSERT)` while `Ctrl+O` runs one command. */
function getModeName({ mode, isOneCommand }: VimStatus) {
    const name = MODE_NAMES[mode ?? "normal"]();
    if (!isOneCommand) {
        return name;
    }
    return mode === "normal"
        ? t("vim_mode.one_command")
        : t("vim_mode.one_command_in", { mode: name });
}
