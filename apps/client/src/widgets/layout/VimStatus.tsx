import "../shortcut_hints/shortcut_hints_kbd.css";
import "./VimStatus.css";

import type { TriliumVim, VimHint, VimHints, VimMode, VimStatus } from "@triliumnext/ckeditor5";
import type { Tooltip } from "bootstrap";
import clsx from "clsx";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import type NoteContext from "../../components/note_context";
import { t } from "../../services/i18n";
import { useGetContextDataFrom, useStaticTooltip, useTriliumOptionBool } from "../react/hooks";
import ScrollableLabel from "../react/ScrollableLabel";
import { toggleVimKeyReference } from "../type_widgets/text/vim_key_reference";
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

/**
 * The mode of Vim, the keys of the command being typed and the last short message. The pending keys
 * are left out while the hint strip leads with them.
 */
export function VimStatusLine({ status, vim }: { status: VimStatus; vim?: TriliumVim | null }) {
    const { message, recording, pendingKeys, hints } = status;
    const [ areHintsEnabled ] = useTriliumOptionBool("vimModeHintsEnabled");
    const isPendingShown = !!pendingKeys && hints?.kind !== "command";
    const modeRef = useRef<HTMLButtonElement>(null);
    const tooltip = getModeTooltip(status.mode);
    const tooltipOptions = useMemo(() => ({ ...TOOLTIP_OPTIONS, title: tooltip }), [ tooltip ]);
    useStaticTooltip(modeRef, tooltipOptions);

    return (
        <span className="vim-status-line">
            {message && !message.isLong && (
                <span className={clsx("vim-message", message.hints && "tn-shortcut-hints-kbd")}>
                    {message.hints
                        ? message.hints.map((hint, index) => (
                            <VimHintItem key={index} hint={hint} />
                        ))
                        : message.text}
                </span>
            )}
            {recording && (
                <span className="vim-recording">
                    {t("vim_mode.recording", { register: recording })}
                    {areHintsEnabled && (
                        <span className="vim-hint tn-shortcut-hints-kbd">
                            <kbd>q</kbd>
                            <span className="vim-hint-description">
                                {t("vim_mode.stop_recording")}
                            </span>
                        </span>
                    )}
                </span>
            )}
            {isPendingShown && <span className="vim-pending-keys">{pendingKeys}</span>}
            <button
                ref={modeRef}
                type="button"
                className="vim-mode"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                    if (vim && modeRef.current) {
                        toggleVimKeyReference(vim, modeRef.current);
                    }
                }}
            >
                {getModeName(status)}
            </button>
        </span>
    );
}

/**
 * The key hints of the Vim mode: the keys typed so far, then the keys that can follow, most useful
 * first. The hints scroll in a narrow window while the typed keys stay, and a press on the strip
 * leaves the focus in the editor.
 */
export function VimHintStrip({ hints }: { hints: VimHints }) {
    const { kind, typedKeys } = hints;

    return (
        <div
            className={clsx("vim-hint-strip", `vim-hint-strip-${kind}`, "tn-shortcut-hints-kbd")}
            onMouseDown={(event) => event.preventDefault()}
        >
            {typedKeys.length > 0 && (
                <span className="vim-hint-typed-keys">
                    {typedKeys.map((key, index) => <kbd key={index}>{key}</kbd>)}
                </span>
            )}
            <ScrollableLabel key={JSON.stringify(hints)} className="vim-hints">
                {hints.hints.map((hint, index) => <VimHintItem key={index} hint={hint} />)}
            </ScrollableLabel>
        </div>
    );
}

/**
 * Keys in keyboard style and what they do. Text to type, such as `$1`, shows as code, and the part
 * of an argument being typed is emphasized.
 */
function VimHintItem({ hint }: { hint: VimHint }) {
    const { keys, isRange, isLiteral, description, emphasis } = hint;
    const [ first, last ] = keys;
    const Key = isLiteral ? "code" : "kbd";

    return (
        <span className="vim-hint">
            {isRange && <span className="vim-hint-keys"><kbd>{first}</kbd>-<kbd>{last}</kbd></span>}
            {!isRange && keys.length > 0 && (
                <span className="vim-hint-keys">
                    {keys.map((key, index) => <Key key={index}>{key}</Key>)}
                </span>
            )}
            {description && (
                <span className="vim-hint-description">
                    {emphasis ? <>
                        {description.slice(0, emphasis.start)}
                        <strong>{description.slice(emphasis.start, emphasis.end)}</strong>
                        {description.slice(emphasis.end)}
                    </> : description}
                </span>
            )}
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

/** The tooltip options of the mode, which opens above the bar as those of the status bar items. */
const TOOLTIP_OPTIONS: Partial<Tooltip.Options> = {
    placement: "top",
    fallbackPlacements: [ "top" ],
    popperConfig: { strategy: "fixed" },
    animation: false
};

/** What the mode means, the key that leaves it, and that a click shows the keys. */
function getModeTooltip(mode: VimMode | null) {
    switch (mode) {
        case "insert":
            return t("vim_mode.insert_tooltip");
        case "replace":
            return t("vim_mode.replace_tooltip");
        case "visual":
        case "visual-line":
            return t("vim_mode.visual_tooltip");
        default:
            return t("vim_mode.normal_tooltip");
    }
}

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
