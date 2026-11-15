import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import { getNoteTypeOptions, type NoteTypeOption } from "../../../services/note_types";
import options from "../../../services/options";
import { useTriliumEvent } from "./events";

/**
 * Everything a note can be created from: the note types, the templates the app ships and the
 * reader's own.
 *
 * Read when the caller mounts and again whenever a template is made, deleted, renamed or given
 * another icon, so what is offered is what exists now. Not read at all while `enabled` is off,
 * for a caller that has nothing to create, such as a read-only board.
 */
export function useNoteTypeOptions(enabled = true) {
    const [ options, setOptions ] = useState<NoteTypeOption[]>([]);
    /** How many reads were asked for, and the newest one answered. */
    const asked = useRef(0);
    const answered = useRef(0);

    const read = useCallback(() => {
        const attempt = ++asked.current;
        getNoteTypeOptions().then((types) => {
            // Two reads can be in flight at once, the one made on arrival and one a template being
            // made asks for. They need not answer in the order they were asked, and one of them can
            // fail and leave no answer at all, so what is taken is what no newer answer has taken
            // over.
            if (attempt > answered.current) {
                answered.current = attempt;
                setOptions(types);
            }
        }).catch((e) => console.error("Failed to read what a note can be made from:", e));
    }, []);

    useEffect(() => {
        if (!enabled) {
            return;
        }
        read();
        // A read still in flight when the caller goes has nothing left to answer.
        return () => { answered.current = asked.current + 1; };
    }, [ read, enabled ]);

    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        const offered = new Set(options
            .map((option) => option.options.templateNoteId)
            .filter((noteId) => !!noteId));
        // A note taking `#template` or losing it changes what can be created. So does any attribute
        // of a note already offered: the icon comes from `iconClass`, from `workspaceIconClass`
        // where there is none, and from a `#geoLocation` on a text note, all of them labels rather
        // than part of the note row a reload would report.
        const templated = loadResults.getAttributeRows().some((attribute) =>
            attribute.name === "template"
                || (!!attribute.noteId && offered.has(attribute.noteId)));
        const renamed = options.some((option) =>
            option.options.templateNoteId
                && loadResults.isNoteReloaded(option.options.templateNoteId));

        if (enabled && (templated || renamed)) {
            read();
        }
    });

    return options;
}
