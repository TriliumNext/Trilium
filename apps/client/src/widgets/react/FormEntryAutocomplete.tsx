import "./FormEntryAutocomplete.css";

import clsx from "clsx";
import type { ComponentChildren, TargetedFocusEvent, TargetedKeyboardEvent } from "preact";
import { useCallback, useRef, useState } from "preact/hooks";

import FormAutocomplete from "./FormAutocomplete";
import Icon from "./Icon";

/**
 * One row of the dropdown. `key` identifies the row to `FormAutocomplete`, whose items are
 * strings, since two rows can have the same label.
 */
export interface AutocompleteEntry {
    key: string;
    label: string;
    /** A boxicons class, as `FNote.getIcon()` gives it. */
    icon?: string;
    /** A second line under the label, such as a place's address. */
    detail?: string;
    /** Content at the trailing edge of the row, such as a distance. */
    trailing?: ComponentChildren;
    /** Marks a header for the rows below it. A header cannot be picked. */
    heading?: boolean;
    /** Marks a status row. Picking it calls nothing and leaves the list open. */
    inert?: boolean;
    /**
     * Keeps the list open after this row is picked, for a row that starts a search whose results
     * replace it.
     */
    keepsListOpen?: boolean;
    /** An extra class on the row, for kinds of row a host styles differently. */
    className?: string;
}

type FormAutocompleteProps = Parameters<typeof FormAutocomplete>[0];

type ReplacedProps = "source" | "onPick" | "renderItem" | "isHeading" | "keepOpenOnPick";

interface FormEntryAutocompleteProps<T extends AutocompleteEntry>
    extends Omit<FormAutocompleteProps, ReplacedProps> {
    /** Returns the rows for a query, which is trimmed and at least {@link minQueryLength} long. */
    entries(query: string): Promise<T[]>;
    /** Called with the picked row and every row the list held when it was picked. */
    onPick(entry: T, offered: T[]): void;
    /** The shortest query that calls `entries`. Defaults to 1, so an empty field lists nothing. */
    minQueryLength?: number;
}

/**
 * A {@link FormAutocomplete} whose rows are {@link AutocompleteEntry} objects rather than strings.
 * `onPick` receives the whole entry.
 *
 * Picking a row sets `dismissed`, which empties the list so it does not cover the field. A query
 * change, a focus, or Enter when `openOnEnter` is set clears `dismissed` and lists the rows again.
 * A row with `keepsListOpen` leaves `dismissed` unset.
 */
export default function FormEntryAutocomplete<T extends AutocompleteEntry>({
    entries, onPick, minQueryLength = 1, onChange, onFocus, onKeyDown, openOnEnter, ...restProps
}: FormEntryAutocompleteProps<T>) {
    // While set, `source` returns no rows, which closes the dropdown under `keepOpenOnPick`.
    const [ dismissed, setDismissed ] = useState(false);
    const offered = useRef(new Map<string, T>());
    // `FormAutocomplete` displays only the latest lookup, so only that one may set `offered`.
    const latestLookup = useRef(0);

    const source = useCallback(async (query: string) => {
        const lookup = ++latestLookup.current;
        const trimmed = query.trim();
        if (dismissed || trimmed.length < minQueryLength) {
            offered.current = new Map();
            return [];
        }

        const rows = await entries(trimmed);
        if (lookup === latestLookup.current) {
            offered.current = new Map(rows.map((row) => [ row.key, row ]));
        }
        return rows.map((row) => row.key);
    }, [ entries, dismissed, minQueryLength ]);

    const changeQuery = useCallback((newValue: string) => {
        setDismissed(false);
        onChange(newValue);
    }, [ onChange ]);

    const pick = useCallback((key: string) => {
        const entry = offered.current.get(key);
        if (!entry || entry.inert) return;

        if (!entry.keepsListOpen) {
            setDismissed(true);
        }
        onPick(entry, [ ...offered.current.values() ]);
    }, [ onPick ]);

    /**
     * Clears `dismissed` when the list is empty. The Enter that picks a row also reaches this, and
     * must not clear the `dismissed` that the pick just set.
     */
    const offerRowsAgain = useCallback(() => {
        if (!offered.current.size) {
            setDismissed(false);
        }
    }, []);

    const handleFocus = useCallback((e: TargetedFocusEvent<HTMLInputElement>) => {
        offerRowsAgain();
        onFocus?.(e);
    }, [ offerRowsAgain, onFocus ]);

    const handleKeyDown = useCallback((e: TargetedKeyboardEvent<HTMLInputElement>) => {
        // Without `openOnEnter`, Enter is left to the surrounding form.
        if (openOnEnter && e.key === "Enter") {
            offerRowsAgain();
        }
        onKeyDown?.(e);
    }, [ openOnEnter, offerRowsAgain, onKeyDown ]);

    const isHeading = useCallback((key: string) => !!offered.current.get(key)?.heading, []);

    const renderItem = useCallback((key: string) => {
        const entry = offered.current.get(key);
        if (!entry) return key;
        if (entry.heading) return entry.label;

        return (
            <span className={clsx(
                "form-autocomplete-entry",
                entry.inert && "form-autocomplete-entry-inert",
                entry.className
            )}>
                <Icon icon={entry.icon} />
                <span className="form-autocomplete-entry-lines">
                    <span className="form-autocomplete-entry-name">{entry.label}</span>
                    {entry.detail &&
                        <span className="form-autocomplete-entry-detail">{entry.detail}</span>}
                </span>
                {entry.trailing !== undefined &&
                    <span className="form-autocomplete-entry-trailing">{entry.trailing}</span>}
            </span>
        );
    }, []);

    return (
        <FormAutocomplete
            {...restProps}
            onChange={changeQuery}
            onFocus={handleFocus}
            onKeyDown={handleKeyDown}
            openOnEnter={openOnEnter}
            source={source}
            onPick={pick}
            renderItem={renderItem}
            isHeading={isHeading}
            keepOpenOnPick
        />
    );
}
