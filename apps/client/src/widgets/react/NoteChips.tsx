import "./NoteChips.css";

import { useState } from "preact/hooks";

import { t } from "../../services/i18n";
import Chip from "./Chip";
import LinkButton from "./LinkButton";
import NoteLink from "./NoteLink";

/** How many chips show before the rest are asked for. */
const COLLAPSED_COUNT = 5;
/** How many more each "+N more" reveals, so a set of thousands is never drawn at once. */
const PAGE_SIZE = 100;

interface NoteChipsProps {
    noteIds: string[];
    /** Removes a note from the set. Without it, the chips only show the set. */
    onRemove?(noteId: string): void;
    /** What removing a chip means, in the host's own words. Required with {@link onRemove}. */
    removeButtonText?: string;
}

/**
 * A set of notes as chips, each the note's icon and title linking to it: the first few, then a
 * "+N more" link that reveals the rest a page at a time.
 */
export default function NoteChips({ noteIds, onRemove, removeButtonText }: NoteChipsProps) {
    const [ shownCount, setShownCount ] = useState(COLLAPSED_COUNT);
    const shownNoteIds = noteIds.slice(0, shownCount);
    const hiddenCount = noteIds.length - shownNoteIds.length;

    return (
        <div className="note-chips">
            {shownNoteIds.map((noteId) => (
                <Chip
                    key={noteId}
                    removeButtonText={removeButtonText ?? ""}
                    disabled={!onRemove}
                    onRemove={() => onRemove?.(noteId)}
                >
                    <NoteLink notePath={noteId} showNoteIcon />
                </Chip>
            ))}
            {hiddenCount > 0 && (
                <LinkButton
                    className="note-chips-more"
                    text={t("note_chips.more", { count: hiddenCount })}
                    onClick={() => setShownCount((count) => count + PAGE_SIZE)}
                />
            )}
        </div>
    );
}
