import "./select_input.css";

import clsx from "clsx";
import type { ComponentChildren, InputHTMLAttributes, TargetedKeyboardEvent } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import { t } from "../../services/i18n";
import Chip from "../react/Chip";
import FormAutocomplete from "../react/FormAutocomplete";

/** Merged onto the box, for the id, tab order and data attributes a host needs to attach. */
type SelectInputProps = InputHTMLAttributes<HTMLInputElement>;

interface SelectComboBoxProps {
    /** The options the definition declares. */
    options: readonly string[];
    /** The value held, or the empty string where the field is unset. */
    value: string;
    onCommit(value: string): void;
    /** Adds an option to the definition, for the entry offered on text naming none of them. */
    onCreateOption(option: string): void | Promise<void>;
    inputProps?: SelectInputProps;
}

/**
 * The field a select holding one value is edited through. The box holds a draft of the value: the
 * full list opens on focus, typing filters it, and only picking an entry commits — an option by its
 * text, the "Create" entry by first handing the typed text to `onCreateOption`. Text that matches
 * nothing reverts when the field is left, except an emptied box, which commits the empty value:
 * clearing is a choice of its own, and cannot pollute the definition.
 */
export function SelectComboBox({ options, value, onCommit, onCreateOption, inputProps }: SelectComboBoxProps) {
    const [ draft, setDraft ] = useState(value);
    // What the note holds is what the box shows, however the value came to change.
    useEffect(() => setDraft(value), [ value ]);
    // Whether the text is something typed this visit, rather than the value the box opened with.
    // Only typed text filters the list and offers creating: comparing the text against the value
    // instead would stop filtering whenever typing happens to pass through it (retyping what was
    // erased, or reproducing a stale value), which is exactly when the list must keep up.
    const typedSinceFocus = useRef(false);

    // Narrowed because Preact types the attribute as possibly signal-backed, while the text box
    // underneath takes the plain string.
    const { id, ...restInputProps } = inputProps ?? {};

    // What the list is narrowed by: the typed text, or nothing while the box still shows the value
    // it opened with — reopening a filled field offers every choice, not the one already made.
    const filter = typedSinceFocus.current ? draft.trim() : "";

    const source = useCallback(async (query: string) => selectEntriesFor({
        options,
        filter: typedSinceFocus.current ? query : "",
        canCreate: true
    }), [ options ]);

    return (
        <FormAutocomplete
            {...restInputProps}
            id={typeof id === "string" ? id : undefined}
            className={clsx(inputProps?.className, "label-select-combobox")}
            currentValue={draft}
            openOnFocus
            // The suggestions are the choices themselves, so the list opens on the option already
            // held — Enter then keeps it, as a dropdown's would.
            autoActivate
            source={source}
            renderItem={(item) => renderSelectEntry(item, filter)}
            onChange={(newValue) => {
                // Typing only — a made choice arrives through onPick — so the text is never a
                // commit, only the filter. Even text spelling an option exactly keeps filtering:
                // "bar" typed on the way to "barr" is not yet a decision for either.
                typedSinceFocus.current = true;
                setDraft(newValue);
            }}
            onPick={(item) => {
                // A made choice resets the box to its opened-with state: the text is the value
                // again, so the list is back to offering everything.
                typedSinceFocus.current = false;
                if (isCreateEntry(item)) {
                    const option = createdOption(item);
                    void onCreateOption(option);
                    setDraft(option);
                    onCommit(option);
                } else {
                    setDraft(item);
                    onCommit(item);
                }
            }}
            onBlur={(leftBehind) => {
                typedSinceFocus.current = false;
                const trimmed = leftBehind.trim();
                if (!trimmed) {
                    setDraft("");
                    if (value) {
                        onCommit("");
                    }
                    return;
                }

                // Text spelling an option's full name is as good as picking it — leaving the field
                // after typing it out must not throw the choice away. The option's own casing wins.
                const match = options.find((option) => option.toLowerCase() === trimmed.toLowerCase());
                if (match && match !== value) {
                    setDraft(match);
                    onCommit(match);
                } else if (leftBehind !== value) {
                    setDraft(value);
                }
            }}
        />
    );
}

interface SelectValuesInputProps {
    /** The options the definition declares. */
    options: readonly string[];
    /** The values held, in the order they are shown. */
    values: readonly string[];
    /** Receives the values as they now stand, whenever one is taken or dropped. */
    onCommit(values: string[]): void;
    /**
     * Adds an option to the definition, for the entry offered on text naming none of them. Left out,
     * the field picks from the options as they stand.
     */
    onCreateOption?(option: string): void | Promise<void>;
    /**
     * Shows a value as something other than the text it is stored as — a flag as its mark. Left out,
     * a chip reads as the option it stands for, which is what a list of options names it.
     */
    renderValue?(value: string): ComponentChildren;
    /** Set onto the box, so that a host's own label points at the field. */
    inputId?: string;
    /** Set onto the box, for a host placing its fields in a tab order of its own. */
    tabIndex?: number;
    placeholder?: string;
    disabled?: boolean;
}

/**
 * The field a select holding several values is edited through: the values as chips inside the field,
 * and a box after them offering what is left to take.
 *
 * The box holds a filter rather than a value — the chips are what is held — so nothing typed into it
 * is ever kept: an entry has to be picked, and what is left behind is dropped when the field is. The
 * list stays open across picks, since taking one value is rarely the end of it.
 */
export function SelectValuesInput({ options, values, onCommit, onCreateOption, renderValue, inputId, tabIndex, placeholder, disabled }: SelectValuesInputProps) {
    const [ filter, setFilter ] = useState("");

    // Taken values leave the list: what is held is shown as a chip, so offering it again would only
    // invite a duplicate the field cannot show apart from the first.
    const source = useCallback(async (query: string) => selectEntriesFor({
        options,
        filter: query,
        exclude: values,
        canCreate: !!onCreateOption
    }), [ options, values, onCreateOption ]);

    function take(value: string) {
        setFilter("");
        onCommit([ ...values, value ]);
    }

    function drop(value: string) {
        onCommit(values.filter((held) => held !== value));
    }

    function handleKeyDown(e: TargetedKeyboardEvent<HTMLInputElement>) {
        // Backspace on an empty box drops the last chip, the box having nothing of its own to erase.
        if (e.key === "Backspace" && !e.currentTarget.value && values.length) {
            e.preventDefault();
            drop(values[values.length - 1]);
        }
    }

    return (
        <FormAutocomplete
            id={inputId}
            tabIndex={tabIndex}
            className="select-values-input"
            currentValue={filter}
            placeholder={values.length ? undefined : placeholder}
            disabled={disabled}
            openOnFocus
            autoActivate
            keepOpenOnPick
            source={source}
            renderItem={(item) => renderSelectEntry(item, filter)}
            leading={values.map((value) => (
                <Chip
                    key={value}
                    className="select-values-chip"
                    removeButtonText={t("promoted_attributes.remove_value")}
                    disabled={disabled}
                    onRemove={() => drop(value)}
                >
                    <span>{renderValue ? renderValue(value) : value}</span>
                </Chip>
            ))}
            onChange={setFilter}
            onPick={(item) => {
                if (isCreateEntry(item)) {
                    const option = createdOption(item);
                    void onCreateOption?.(option);
                    take(option);
                } else {
                    take(item);
                }
            }}
            // Text nobody picked names no value, so it goes with the field rather than being kept.
            onBlur={() => setFilter("")}
            onKeyDown={handleKeyDown}
        />
    );
}

/**
 * Marks the entry offering to make the typed text into an option, apart from the options themselves.
 * An option can never start with it: a control character cannot be typed into either the field or
 * the definition editor.
 */
const CREATE_OPTION_SENTINEL = "\u0000";

interface SelectEntriesArgs {
    /** Every option the definition declares. */
    options: readonly string[];
    /** What was typed into the field; empty offers the options unfiltered. */
    filter: string;
    /** Options to leave out of the list, being spoken for already — the values a multi field holds. */
    exclude?: readonly string[];
    /** Whether an unmatched filter may be offered as an option to create. */
    canCreate?: boolean;
}

/**
 * The entries a select's list offers: the options the filter matches, and — where it names none of
 * them — an entry offering to make it one.
 *
 * The offer is weighed against every option, the excluded ones included: a value the field already
 * holds is a choice that exists, so typing it out again offers nothing rather than a second copy.
 *
 * Exported for its own tests; the fields above are what it is for.
 */
export function selectEntriesFor({ options, filter, exclude = [], canCreate }: SelectEntriesArgs) {
    const trimmed = filter.trim();
    const query = trimmed.toLowerCase();
    const entries = options
        .filter((option) => !exclude.includes(option))
        .filter((option) => !query || option.toLowerCase().includes(query));

    const isKnown = (option: string) => option.toLowerCase() === query;
    if (canCreate && trimmed && !options.some(isKnown) && !exclude.some(isKnown)) {
        entries.push(CREATE_OPTION_SENTINEL + trimmed);
    }
    return entries;
}

/** Whether a picked entry is the offer to create an option rather than one of the options. */
export function isCreateEntry(item: string) {
    return item.startsWith(CREATE_OPTION_SENTINEL);
}

/** The option a create entry would make, i.e. the text that was typed. */
export function createdOption(item: string) {
    return item.substring(CREATE_OPTION_SENTINEL.length);
}

/**
 * One entry of the list: the create entry as the thing it will do, an option with the part the
 * filter matched set in bold so a narrowed list shows why each of its entries is still there.
 */
function renderSelectEntry(item: string, filter: string) {
    if (isCreateEntry(item)) {
        return (
            <span className="select-create-option">
                <span className="bx bx-plus" />{" "}
                {t("promoted_attributes.create_option", { option: createdOption(item) })}
            </span>
        );
    }
    return highlightMatch(item, filter);
}

/**
 * An option with the part the typed text matched set in bold. Case-insensitive like the filtering,
 * first occurrence only — the same match the filter found. Without a filter (or, defensively,
 * without a match) the text is plain.
 */
function highlightMatch(text: string, filter: string) {
    const index = filter ? text.toLowerCase().indexOf(filter.toLowerCase()) : -1;
    if (index < 0) {
        return text;
    }
    return <>
        {text.substring(0, index)}
        <b>{text.substring(index, index + filter.length)}</b>
        {text.substring(index + filter.length)}
    </>;
}
