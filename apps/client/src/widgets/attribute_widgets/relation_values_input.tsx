import { useEffect, useRef, useState } from "preact/hooks";

import type FNote from "../../entities/fnote";
import froca from "../../services/froca";
import { t } from "../../services/i18n";
import Chip from "../react/Chip";
import Icon from "../react/Icon";
import NoteAutocomplete from "../react/NoteAutocomplete";

interface RelationValuesInputProps {
    /** The targets' noteIds, in the order they are shown. */
    values: readonly string[];
    /** Receives the noteIds as they now stand, whenever a target is taken or dropped. */
    onCommit(values: string[]): void;
    /** Set onto the box, so that a host's own label points at the field. */
    inputId?: string;
    /** Set onto the box, for a host placing its fields in a tab order of its own. */
    tabIndex?: number;
    disabled?: boolean;
}

/**
 * The field a relation holding several targets is edited through: the targets as chips naming their
 * notes, and after them the search box a single relation is already picked in.
 *
 * A chip names its note — icon and title — the title being a link opening it, the only way from
 * here to a target already held; the button beside it removes the target. What the box takes is a
 * made choice, never text: a note has to be picked, so nothing typed is ever kept, and a target
 * already held is not taken a second time — the chips are a set.
 */
export default function RelationValuesInput({ values, onCommit, inputId, tabIndex, disabled }: RelationValuesInputProps) {
    const inputRef = useRef<HTMLInputElement>(null);
    const notes = useNotes(values);

    function take(noteId: string) {
        // The box is emptied either way — what was in it is spent on the choice made — but a target
        // already held is not taken twice, and clearing an empty pick has nothing to add.
        const picker = inputRef.current;
        if (picker) {
            // Through the plugin rather than the element: the plugin holds text of its own, and would
            // write the picked title right back over a cleared box.
            $(picker).autocomplete("val", "").setSelectedNotePath("");
        }
        if (!noteId || values.includes(noteId)) return;
        onCommit([ ...values, noteId ]);
    }

    function drop(noteId: string) {
        onCommit(values.filter((held) => held !== noteId));
    }

    return (
        <div className="tn-field relation-values-input">
            {values.map((noteId) => (
                <Chip
                    key={noteId}
                    removeButtonText={t("promoted_attributes.remove_value")}
                    disabled={disabled}
                    onRemove={() => drop(noteId)}
                >
                    <span><NoteTitle note={notes[noteId]} linkTo={`#root/${noteId}`} /></span>
                </Chip>
            ))}
            <NoteAutocomplete
                id={inputId}
                inputRef={inputRef}
                tabIndex={tabIndex}
                opts={{ allowCreatingNotes: true, hideAllButtons: true }}
                noteIdChanged={take}
            />
        </div>
    );
}

/**
 * The targets a relation holding several shows, read-only: the same chips the field edits, each
 * naming its note and — the set not being edited here — carrying the link a relation cell already
 * offers for its one target.
 */
export function RelationValueChips({ values }: { values: readonly string[] }) {
    const notes = useNotes(values);

    return (
        <span className="label-value-chips">
            {values.map((noteId) => (
                <span key={noteId} className="tn-chip">
                    <span
                        className={`reference-link ${notes[noteId]?.getColorClass() ?? ""}`}
                        data-href={`#root/${noteId}`}
                    >
                        <NoteTitle note={notes[noteId]} />
                    </span>
                </span>
            ))}
        </span>
    );
}

/**
 * A note as its chip names it: icon and title, or nothing while the note is still being fetched — a
 * placeholder would only flash for the moment froca takes.
 *
 * `linkTo` is what the title opens, the icon and the space before it staying outside the link as
 * `link.createLink` keeps them — the hover underline then runs under the words rather than across the
 * gap to the icon.
 */
function NoteTitle({ note, linkTo }: { note: FNote | null | undefined; linkTo?: string }) {
    if (!note) return null;
    return <>
        <Icon icon={note.getIcon()} />{" "}
        {linkTo ? <a className="tn-link" href={linkTo}>{note.title}</a> : note.title}
    </>;
}

/**
 * The notes the ids name, from the cache first and fetched where the cache does not hold them —
 * a relation can point at a note not yet loaded, or one since deleted, which stays absent.
 */
function useNotes(noteIds: readonly string[]): Record<string, FNote | null> {
    const [ notes, setNotes ] = useState<Record<string, FNote | null>>({});

    useEffect(() => {
        const missing = noteIds.filter((noteId) => notes[noteId] === undefined);
        if (!missing.length) return;

        setNotes((known) => {
            const fromCache = { ...known };
            for (const noteId of missing) {
                fromCache[noteId] = froca.getNoteFromCache(noteId) ?? null;
            }
            return fromCache;
        });

        let cancelled = false;
        froca.getNotes(missing, true).then((fetched) => {
            if (cancelled || !fetched.length) return;
            setNotes((known) => {
                const resolved = { ...known };
                for (const note of fetched) {
                    resolved[note.noteId] = note;
                }
                return resolved;
            });
        });
        return () => {
            cancelled = true;
        };
    }, [ noteIds ]);

    return notes;
}

