import type FNote from "../../../entities/fnote";

export type DisplayMode = "source" | "split" | "preview";

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
