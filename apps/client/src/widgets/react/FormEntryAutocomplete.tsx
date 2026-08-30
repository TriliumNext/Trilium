import "./FormEntryAutocomplete.css";

import clsx from "clsx";
import type { ComponentChildren, TargetedFocusEvent, TargetedKeyboardEvent } from "preact";
import { useCallback, useRef, useState } from "preact/hooks";

import FormAutocomplete from "./FormAutocomplete";
import Icon from "./Icon";

/**
 * One row of the dropdown. `key` identifies it, since `FormAutocomplete` items are strings and two
 * rows can read the same.
 */
export interface AutocompleteEntry {
    key: string;
    label: string;
    /** A boxicons class, as `FNote.getIcon()` gives it. */
    icon?: string;
    /** A second line under the label: the address that places a place, what a package says of itself. */
    detail?: string;
    /** Drawn at the trailing edge of the row — how far off a place stands. */
    trailing?: ComponentChildren;
    /** Names the run of rows below it rather than offering a choice of its own. */
    heading?: boolean;
    /** Reports rather than offers: picking it does nothing and leaves the list as it stands. */
    inert?: boolean;
    /**
     * Leaves the list up once this row is picked, for a row that starts something rather than
     * settling it — the one that goes and asks a registry, which then replaces it with what it found.
     */
    keepsListOpen?: boolean;
    /** Added to the row's class, for the kinds a host draws differently. */
    className?: string;
}

type FormAutocompleteProps = Parameters<typeof FormAutocomplete>[0];

interface FormEntryAutocompleteProps<T extends AutocompleteEntry>
    extends Omit<FormAutocompleteProps, "source" | "onPick" | "renderItem" | "isHeading" | "keepOpenOnPick"> {
    /** Provides the rows for a query, already trimmed and past {@link minQueryLength}. */
    entries(query: string): Promise<T[]>;
    /** Receives a picked row, along with everything the list was offering at the time. */
    onPick(entry: T, offered: T[]): void;
    /** Shorter queries list nothing. One by default, so an empty field offers nothing. */
    minQueryLength?: number;
}

/**
 * A {@link FormAutocomplete} whose rows are objects rather than strings: each carries what it reads
 * as and what picking it means, and comes back whole to `onPick`.
 *
 * Picking a row is taken as the end of the search and stands the list down, so that a field holding
 * what was chosen is not also covered by the list it was chosen from. The rows come back when the
 * query changes, when the field is come back to, and on Enter where `openOnEnter` asks for it — a
 * query that was right is looked at again without being retyped. A row that starts something rather
 * than settling it says so with `keepsListOpen`, and is free to replace itself with its results.
 */
export default function FormEntryAutocomplete<T extends AutocompleteEntry>({ entries, onPick, minQueryLength = 1, onChange, onFocus, onKeyDown, openOnEnter, ...restProps }: FormEntryAutocompleteProps<T>) {
    // Empties the list once a row has been taken, which is what closes the dropdown under
    // `keepOpenOnPick`. Typing again clears it.
    const [ dismissed, setDismissed ] = useState(false);
    const offered = useRef(new Map<string, T>());

    const source = useCallback(async (query: string) => {
        const trimmed = query.trim();
        if (dismissed || trimmed.length < minQueryLength) {
            offered.current = new Map();
            return [];
        }

        const rows = await entries(trimmed);
        offered.current = new Map(rows.map((row) => [ row.key, row ]));
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
     * Puts the rows back on offer. Only where there is nothing on offer, since the Enter that takes
     * a row arrives here too and would otherwise undo the dismissal it has just caused.
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
        // Enter opens the list where the host asked for it, so it brings back rows a pick sent away
        // as well. Where it does not, Enter belongs to the form around the field.
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
            <span className={clsx("form-autocomplete-entry", entry.inert && "form-autocomplete-entry-inert", entry.className)}>
                <Icon icon={entry.icon} />
                <span className="form-autocomplete-entry-lines">
                    <span className="form-autocomplete-entry-name">{entry.label}</span>
                    {entry.detail && <span className="form-autocomplete-entry-detail">{entry.detail}</span>}
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
