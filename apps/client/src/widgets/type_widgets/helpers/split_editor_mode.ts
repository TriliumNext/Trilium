import type FNote from "../../../entities/fnote";

export type DisplayMode = "source" | "split" | "preview";

/** The display modes, in the order their switchers show them, with the icon and label of each. */
export const DISPLAY_MODE_OPTIONS = [
    { value: "source", icon: "bx bx-code", titleKey: "display_mode.source" },
    { value: "split", icon: "bx bxs-dock-left", titleKey: "display_mode.split" },
    { value: "preview", icon: "bx bx-show", titleKey: "display_mode.preview" }
] as const satisfies readonly { value: DisplayMode; icon: string; titleKey: string }[];

/**
 * Resolves the active split-editor mode from the `#displayMode` label. When the label is unset it
 * falls back to the note's read-only state — read-only → `preview`, editable → `split`. Kept as a
 * shared pure function so the SplitEditor and its mode-switcher buttons stay in sync.
 */
export function resolveDisplayMode(displayMode: string | null | undefined, readOnly: boolean): DisplayMode {
    return displayMode === "source" || displayMode === "split" || displayMode === "preview"
        ? displayMode
        : readOnly ? "preview" : "split";
}

/**
 * File-type icon packs can't be edited as text, so their split editor is always read-only (the
 * SplitEditor gets this via its `forceReadOnly` prop; the switcher buttons derive it from the note).
 */
export function isSplitEditorForcedReadOnly(note: FNote | null | undefined) {
    return Boolean(note?.isIconPack() && note.type === "file");
}
