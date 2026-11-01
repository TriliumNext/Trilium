import "./FormAutocomplete.css";

import type { ReferenceElement } from "@floating-ui/dom";
import type { ComponentChildren, RefObject } from "preact";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

import FormTextBox from "./FormTextBox";
import { useUniqueName } from "./hooks";
import Popup, { type PopupProps } from "./Popup";

/** Marks the dropdown, which is portalled to the body: popups checking for outside clicks must ignore it. */
export const AUTOCOMPLETE_DROPDOWN_SELECTOR = ".form-autocomplete-dropdown";

const DEBOUNCE_MS = 150;

type FormTextBoxProps = Parameters<typeof FormTextBox>[0];

/** What the dropdown is placed under: an element, or a rect such as a caret's. */
type DropdownAnchor = HTMLElement | ReferenceElement;

interface FormAutocompleteProps extends Omit<FormTextBoxProps, "onChange"> {
    currentValue: string;
    onChange(newValue: string): void;
    /**
     * Provides the suggestions for a query. Called debounced while the dropdown is open; results
     * arriving after a newer query has been issued are discarded, so it may resolve out of order.
     */
    source(query: string): Promise<string[]>;
    /** Opens the dropdown as soon as the field receives focus, not just on typing. */
    openOnFocus?: boolean;
    /**
     * Opens the list on Enter where it is closed, for a box whose entries are what the field is for.
     * A list sent away — by Escape, or by taking something from it — is otherwise only brought back
     * by typing, which means editing a query that was already right.
     *
     * The key is not consumed when it only opens the list, so a form around the field is submitted by
     * it as before.
     */
    openOnEnter?: boolean;
    /**
     * Receives a suggestion picked from the dropdown (click or Enter) instead of `onChange`, for a
     * host that treats a made choice differently from typing — both otherwise arrive as the same
     * string. Left out, picking reports through `onChange`, exactly like typing. (Not `onSelect`,
     * which is the DOM's own text-selection event and reaches the input as such.)
     */
    onPick?(item: string): void;
    /**
     * Leaves the list open once an entry is picked, for a field collecting several — where picking
     * one is rarely the end of it, and closing would ask for the list back each time.
     *
     * The entries are fetched afresh, so a list narrowing as it is picked from (one leaving out what
     * has been taken already) is correct the moment its source says so.
     */
    keepOpenOnPick?: boolean;
    /**
     * Renders one suggestion, for lists where the bare text does not tell the whole story. Only the
     * appearance of the row is affected: what a suggestion means and what selecting it commits stay
     * the string the source returned. Defaults to showing that string. `query` is the text typed,
     * for setting what matches it in bold.
     */
    renderItem?(item: string, query: string): ComponentChildren;
    /**
     * Rendered inside the field, ahead of the box being typed into — the chips of a field holding
     * several values, which belong within its frame rather than above it.
     *
     * The two are then wrapped together, and the list is measured against that wrapper, so it spans
     * the whole field instead of only the stretch of it left over for typing.
     */
    leading?: ComponentChildren;
    /**
     * Content rendered inside the field, after the input. Use it for a button that commits what the
     * input holds, as {@link FormAutocompleteProps.leading} carries the chips that precede it.
     *
     * Passing either prop wraps the input in a `tn-field` element, which the dropdown is then placed
     * under and spans.
     */
    trailing?: ComponentChildren;
    /**
     * Marks an entry as a heading over the ones below it rather than a choice of its own: it takes no
     * click, is stepped over on the way through the list, and is never what Enter takes.
     */
    isHeading?(item: string): boolean;
    /**
     * The least the list is drawn at, in pixels, for a field too narrow for what its entries have to
     * say — a search box in the corner of a map offering whole addresses. The field's own width is
     * still the floor and the viewport the ceiling, so the list never runs off the screen.
     */
    dropdownMinWidth?: number;
    /**
     * Opens the list with an entry already picked out — the one the field's text names, or failing
     * that the first — so that Enter takes it without arrowing down to it first.
     *
     * For a box whose suggestions are the choices themselves: there the highlighted entry is where
     * the field already stands, and Enter means "this one". Left out for a box that only helps with
     * typing, where nothing is chosen until the user says so and Enter belongs to the form around it.
     */
    autoActivate?: boolean;
}

/**
 * A text box with a suggestion dropdown, driven by an async {@link FormAutocompleteProps.source}.
 *
 * The dropdown is portalled to the body and positioned over everything else, so it is not clipped
 * by scrolling ancestors. Selecting a suggestion reports it through `onChange`, exactly like typing.
 */
export default function FormAutocomplete({ currentValue, onChange, source, openOnFocus, openOnEnter, onPick, keepOpenOnPick, renderItem, leading, trailing, autoActivate, isHeading, dropdownMinWidth, inputRef, onFocus, onBlur, onKeyDown, onCompositionStart, onCompositionEnd, ...restProps }: FormAutocompleteProps) {
    const ownInputRef = useRef<HTMLInputElement>(null);
    const inputEl = inputRef ?? ownInputRef;
    const fieldRef = useRef<HTMLDivElement>(null);
    const isDisabled = !!(restProps.readOnly || restProps.disabled);

    const autocomplete = useAutocomplete({
        query: currentValue,
        source,
        onPick: onPick ?? onChange,
        inputRef: inputEl,
        disabled: isDisabled,
        openOnFocus,
        openOnEnter,
        keepOpenOnPick,
        autoActivate,
        isHeading
    });

    const field = (
        <FormTextBox
            // Keyed for the sake of a field carrying chips, which are keyed themselves: keyed and
            // unkeyed siblings together are matched up by position as the chips grow, which rebuilds
            // the box rather than keeping it — and a rebuilt box is one the focus has left.
            key="field"
            {...restProps}
            inputRef={inputEl}
            currentValue={currentValue}
            onChange={(newValue) => {
                onChange(newValue);
                autocomplete.handleInput();
            }}
            onFocus={(e) => {
                autocomplete.handleFocus();
                onFocus?.(e);
            }}
            onBlur={(newValue) => {
                autocomplete.handleBlur();
                onBlur?.(newValue);
            }}
            onKeyDown={(e) => {
                autocomplete.handleKeyDown(e);
                onKeyDown?.(e);
            }}
            onCompositionStart={(e) => {
                autocomplete.handleCompositionStart();
                onCompositionStart?.(e);
            }}
            onCompositionEnd={(e) => {
                autocomplete.handleCompositionEnd();
                onCompositionEnd?.(e);
            }}
            {...autocomplete.comboboxProps}
        />
    );

    return (
        <>
            {leading !== undefined || trailing !== undefined
                ? <div ref={fieldRef} className="tn-field form-autocomplete-field">{leading}{field}{trailing}</div>
                : field}

            <AutocompleteDropdown
                autocomplete={autocomplete}
                query={currentValue}
                // The wrapper where there is one, so a field carrying chips is spanned whole.
                anchor={fieldRef.current ?? inputEl.current}
                minWidth={dropdownMinWidth}
                renderItem={renderItem}
                isHeading={isHeading}
            />
        </>
    );
}

/** Drives an {@link AutocompleteList} from where its query is typed. */
export interface AutocompleteListHandle {
    /** Handles a key pressed where the query is typed, and returns whether the list took it. */
    handleKeyDown(e: KeyboardEvent): boolean;
}

/** The least width of an {@link AutocompleteList}, whose anchor at a caret has none. */
const CARET_LIST_MIN_WIDTH = 220;

/**
 * The dropdown of a {@link FormAutocomplete} for a query typed somewhere else, such as after a `#` in
 * a text editor, which keeps the focus and forwards its keys through `handleRef`. It opens with
 * nothing highlighted, so Enter stays with the host until an entry is arrowed to.
 */
export function AutocompleteList({ query, source, anchor, renderItem, onPick, handleRef, elementRef, onActiveDescendant }: {
    query: string;
    source(query: string): Promise<string[]>;
    anchor: DropdownAnchor;
    renderItem?(item: string, query: string): ComponentChildren;
    onPick(item: string): void;
    handleRef: RefObject<AutocompleteListHandle | null>;
    elementRef?: PopupProps["elementRef"];
    /** Called with the id of the highlighted entry's element, or `null` while none is highlighted. */
    onActiveDescendant?(id: string | null): void;
}) {
    // The focus stays where the query is typed, so there is no field to return it to.
    const inputRef = useRef<HTMLInputElement>(null);
    const autocomplete = useAutocomplete({ query, source, onPick, inputRef });

    // The host shows the list by mounting it and closes it by unmounting it.
    useEffect(() => autocomplete.open(), []);
    useForwardedKeys(autocomplete, handleRef, onActiveDescendant);

    return (
        <AutocompleteDropdown
            autocomplete={autocomplete}
            query={query}
            anchor={anchor}
            minWidth={CARET_LIST_MIN_WIDTH}
            renderItem={renderItem}
            elementRef={elementRef}
        />
    );
}

/**
 * Takes the keys forwarded from where a list's query is typed. Tab takes the highlighted entry, as
 * Enter does, where a field leaves Tab to move the focus. Reports the highlighted entry's element id
 * to `onActiveDescendant`, for the host to point its `aria-activedescendant` at, as a field's
 * `comboboxProps` do.
 */
export function useForwardedKeys<T>(
    autocomplete: ReturnType<typeof useAutocomplete<T>>,
    handleRef: RefObject<AutocompleteListHandle | null>,
    onActiveDescendant?: (id: string | null) => void
) {
    const { isShown, activeIndex, itemId } = autocomplete;
    const activeId = isShown && activeIndex >= 0 ? itemId(activeIndex) : null;
    const onActiveDescendantRef = useRef(onActiveDescendant);
    onActiveDescendantRef.current = onActiveDescendant;
    useEffect(() => onActiveDescendantRef.current?.(activeId), [ activeId ]);
    // A layout cleanup runs during the unmount itself; a passive one runs after paint, by which
    // time `createHostedList()` has already let go of the host it would report to.
    useLayoutEffect(() => () => onActiveDescendantRef.current?.(null), []);

    useLayoutEffect(() => {
        handleRef.current = {
            handleKeyDown(e) {
                if (!autocomplete.isShown) return false;
                if (e.key === "Tab" && !e.isComposing && autocomplete.takeHighlighted(e)) return true;
                autocomplete.handleKeyDown(e);
                return e.defaultPrevented;
            }
        };
        // Lets go of the list, so a host that outlives it holds none of its entries.
        return () => {
            handleRef.current = null;
        };
    });
}

/**
 * The list of a {@link useAutocomplete}, in a {@link Popup} under `anchor`, which places it again as
 * the list or the anchor changes size or moves.
 */
function AutocompleteDropdown({ autocomplete, query, anchor, minWidth = 0, renderItem, isHeading, elementRef }: {
    autocomplete: ReturnType<typeof useAutocomplete<string>>;
    /** The text typed, which `renderItem` is given. */
    query: string;
    anchor: DropdownAnchor | null;
    minWidth?: number;
    renderItem?(item: string, query: string): ComponentChildren;
    isHeading?(item: string): boolean;
    elementRef?: PopupProps["elementRef"];
}) {
    const { isShown, items, activeIndex, itemId, pick } = autocomplete;

    if (!isShown || !anchor) {
        return null;
    }

    return (
        <Popup
            anchor={anchor}
            className="form-autocomplete-dropdown"
            elementRef={elementRef}
            // As wide as the field, or as `minWidth` where that is more.
            style={{ width: `${Math.max(anchor.getBoundingClientRect().width, minWidth)}px` }}
        >
            <ul
                className="form-autocomplete-list"
                role="listbox"
                // Keeps the focus where the query is typed, so its blur does not close the dropdown
                // before the click lands on an item.
                onMouseDown={(e) => e.preventDefault()}
            >
                {items.map((item, index) => (
                    isHeading?.(item)
                        ? <li key={item} className="form-autocomplete-heading" role="presentation">
                            {renderItem ? renderItem(item, query) : item}
                        </li>
                        : <li
                            key={item}
                            id={itemId(index)}
                            className={`form-autocomplete-item ${index === activeIndex ? "active" : ""}`}
                            role="option"
                            aria-selected={index === activeIndex}
                            onMouseMove={(e) => autocomplete.hover(index, e)}
                            onClick={() => pick(item)}
                        >
                            {renderItem ? renderItem(item, query) : item}
                        </li>
                ))}
            </ul>
        </Popup>
    );
}

interface UseAutocompleteOptions<T> {
    /** The text in the field, which `source` is queried with. */
    query: string;
    /** See {@link FormAutocompleteProps.source}. */
    source(query: string): Promise<T[]>;
    /** Called with the entry picked by click or Enter. */
    onPick(item: T): void;
    /** The field, which keeps the focus once an entry is picked. */
    inputRef: RefObject<HTMLInputElement | null>;
    /** Keeps the list closed, for a read-only or disabled field. */
    disabled?: boolean;
    /** See {@link FormAutocompleteProps.openOnFocus}. */
    openOnFocus?: boolean;
    /** See {@link FormAutocompleteProps.openOnEnter}. */
    openOnEnter?: boolean;
    /**
     * See {@link FormAutocompleteProps.keepOpenOnPick}. A function decides per entry, for an entry
     * that refreshes the list rather than choosing from it.
     */
    keepOpenOnPick?: boolean | ((item: T) => boolean);
    /** See {@link FormAutocompleteProps.autoActivate}. */
    autoActivate?: boolean;
    /**
     * The entry `autoActivate` opens the list on when none matches the query, in place of the first
     * one that can be taken. A negative index falls back to that first one.
     */
    fallbackIndex?(items: T[]): number;
    /** See {@link FormAutocompleteProps.isHeading}. */
    isHeading?(item: T): boolean;
    /** The text of an entry, which `autoActivate` matches against the query. Defaults to `String(item)`. */
    textOf?(item: T): string;
    /**
     * Runs each lookup in place of the default debounce of {@link DEBOUNCE_MS}, for a source that
     * needs its own pacing. It must be stable across renders.
     */
    schedule?(lookUp: () => Promise<void>): void;
}

/**
 * The behavior of a combobox, without its markup: when the list opens and closes, which entry is
 * highlighted, and what the keys do. The focus stays in the field, which points at the highlighted
 * entry through `aria-activedescendant`.
 *
 * The host renders the list from `items`, gives each entry the id `itemId(index)`, and passes the
 * field's events to the `handle*` functions. Entries are fetched while the list is open, debounced
 * or paced by `schedule`, and a response to a superseded query is discarded.
 */
export function useAutocomplete<T>({ query, source, onPick, inputRef, disabled, openOnFocus, openOnEnter, keepOpenOnPick, autoActivate, fallbackIndex, isHeading, textOf = String, schedule }: UseAutocompleteOptions<T>) {
    const [ isOpen, setIsOpen ] = useState(false);
    // What an input method is composing is not yet what the user means, so nothing is looked up for
    // it until the composition ends.
    const [ isComposing, setIsComposing ] = useState(false);
    const [ items, setItems ] = useState<T[]>([]);
    const [ activeIndex, setActiveIndex ] = useState(-1);

    // Discards responses of queries that were superseded while in flight.
    const latestQuery = useRef(0);
    // The Enter handler reads the list as last rendered, so a pick holds Enter off that list until the
    // next render: a second Enter in the same task then reaches the host's form (issue #5669).
    const pickedSinceRender = useRef(false);
    pickedSinceRender.current = false;
    // Whether the entries on show answer an older query than the field's text. An Enter (or a
    // forwarded Tab) pressed then is held in `keyHeld` and picks from the newer query's entries once
    // they arrive.
    const isStale = useRef(false);
    const keyHeld = useRef(false);
    // A host that forwards its keys changes `query` without `handleInput`, and a key can arrive
    // before the lookup effect runs. A key held before such a change confirmed the text it replaced.
    // After `handleInput`, a key held before this render confirmed the text it renders.
    const renderedQuery = useRef(query);
    const inputSinceRender = useRef(false);
    if (renderedQuery.current !== query) {
        renderedQuery.current = query;
        isStale.current = true;
        if (!inputSinceRender.current) keyHeld.current = false;
    }
    inputSinceRender.current = false;
    const pickLatest = useRef(pick);
    pickLatest.current = pick;
    // Set when the keyboard or a new list moves the highlight, which the effect below scrolls into view.
    // The pointer never sets it: scrolling a partly shown row under the pointer would move the list.
    const scrollToActive = useRef(false);
    // Where the pointer last moved over the list. Scrolling slides a row under a still pointer, and the
    // browser can report that as a move at the same spot, which is not the pointer choosing the row.
    const lastPointer = useRef<{ x: number; y: number } | undefined>(undefined);
    // Names the entries so the field can point at the highlighted one: focus stays in the box, so
    // that pointer is all a screen reader has to go on.
    const itemIdPrefix = useUniqueName("autocomplete-item");
    const itemId = useCallback((index: number) => `${itemIdPrefix}-${index}`, [ itemIdPrefix ]);
    const isShown = isOpen && items.length > 0;

    const open = useCallback(() => {
        if (!disabled) setIsOpen(true);
    }, [ disabled ]);

    const close = useCallback(() => {
        // Invalidates in-flight queries too, so a late response cannot repopulate a closed dropdown.
        latestQuery.current++;
        isStale.current = false;
        keyHeld.current = false;
        setIsOpen(false);
        setActiveIndex(-1);
        setItems([]);
    }, []);

    // A lookup a scheduler still holds supersedes nothing once the list is gone, so it is dropped
    // rather than run for a list no longer there.
    useEffect(() => () => {
        latestQuery.current++;
    }, []);

    // Fetch suggestions for the current query, debounced. The previous items stay visible while
    // the request is in flight, so refining a query does not make the dropdown flicker.
    useEffect(() => {
        if (!isOpen || isComposing) {
            return;
        }

        const queryId = ++latestQuery.current;
        isStale.current = true;
        const lookUp = async () => {
            // A scheduler can run a lookup that a newer query (or a close) has since superseded.
            if (latestQuery.current !== queryId) return;

            const suggestions = await source(query);

            // A newer query (or a close) happened while awaiting.
            if (latestQuery.current === queryId) {
                const index = autoActivate ? bestMatchIndex(suggestions, query, isHeading, textOf, fallbackIndex) : -1;
                isStale.current = false;
                setItems(suggestions);
                scrollToActive.current = true;
                setActiveIndex(index);
                if (keyHeld.current) {
                    keyHeld.current = false;
                    if (index >= 0) pickLatest.current(suggestions[index]);
                }
            }
        };

        if (schedule) {
            schedule(lookUp);
            return;
        }

        const timeout = setTimeout(lookUp, DEBOUNCE_MS);
        return () => clearTimeout(timeout);
    }, [ isOpen, isComposing, query, source, autoActivate, fallbackIndex, isHeading, textOf, schedule ]);

    // Keep the highlighted entry in sight: it can be picked out on opening, or arrowed past the
    // bottom of a list taller than the room the dropdown was given.
    useEffect(() => {
        if (activeIndex < 0 || !scrollToActive.current) return;
        scrollToActive.current = false;
        // `nearest` scrolls the list by as little as it takes, and not at all while the entry is
        // already in view.
        document.getElementById(itemId(activeIndex))?.scrollIntoView({ block: "nearest" });
    }, [ activeIndex, items, itemId ]);

    function pick(item: T) {
        if (isHeading?.(item)) {
            return;
        }

        pickedSinceRender.current = true;
        onPick(item);
        if (typeof keepOpenOnPick === "function" ? keepOpenOnPick(item) : keepOpenOnPick) {
            // Nothing is highlighted until the refreshed entries arrive, so Enter cannot take twice
            // what the list is about to stop offering.
            setActiveIndex(-1);
        } else {
            close();
        }
        inputRef.current?.focus();
    }

    /**
     * Picks the highlighted entry for a key that confirms it, or holds the key until the entries for
     * a newer query arrive. Returns whether the key was taken.
     */
    function takeHighlighted(e: KeyboardEvent) {
        // Without `autoActivate` the newer entries open with nothing highlighted, so a key pressed
        // before they arrive belongs to the host.
        if (!isShown || activeIndex < 0 || pickedSinceRender.current || (!autoActivate && isStale.current)) {
            return false;
        }
        // Consume the key so it does not also reach the surrounding form or dialog.
        e.preventDefault();
        e.stopPropagation();
        if (isStale.current) {
            keyHeld.current = true;
        } else {
            pick(items[activeIndex]);
        }
        return true;
    }

    function handleKeyDown(e: KeyboardEvent) {
        // The keys belong to the input method, such as the Enter that commits a candidate.
        if (e.isComposing) return;

        switch (e.key) {
            case "ArrowDown":
            case "ArrowUp":
                e.preventDefault();
                if (!isShown) {
                    open();
                } else {
                    const delta = e.key === "ArrowDown" ? 1 : -1;
                    scrollToActive.current = true;
                    setActiveIndex((index) => stepOver(items, index, delta, isHeading));
                }
                break;

            case "Enter":
                if (!takeHighlighted(e) && openOnEnter) {
                    open();
                }
                break;

            case "Escape":
                if (isShown) {
                    // Only dismiss the dropdown; a surrounding popup keeps its own Escape handling.
                    e.stopPropagation();
                    close();
                }
                break;

            case "Tab":
                close();
                break;
        }
    }

    return {
        isOpen,
        isShown,
        items,
        activeIndex,
        setActiveIndex,
        itemId,
        /** Highlights the row the pointer moves over, without scrolling the list. */
        hover(index: number, e: { clientX: number; clientY: number }) {
            const last = lastPointer.current;
            if (last && last.x === e.clientX && last.y === e.clientY) return;
            lastPointer.current = { x: e.clientX, y: e.clientY };
            scrollToActive.current = false;
            setActiveIndex(index);
        },
        open,
        close,
        pick,
        /** Call once the field's text has changed. */
        handleInput() {
            // The lookup effect runs after the next render, and a key can arrive before it.
            isStale.current = true;
            // A held key confirms the text it was pressed on, not text typed after it.
            keyHeld.current = false;
            inputSinceRender.current = true;
            open();
        },
        handleFocus() {
            if (openOnFocus) open();
        },
        handleBlur: close,
        handleCompositionStart() {
            setIsComposing(true);
        },
        handleCompositionEnd() {
            setIsComposing(false);
        },
        handleKeyDown,
        takeHighlighted,
        /** The field's combobox attributes. */
        comboboxProps: {
            role: "combobox",
            "aria-expanded": isShown,
            "aria-autocomplete": "list",
            "aria-activedescendant": activeIndex >= 0 ? itemId(activeIndex) : undefined
        } as const
    };
}

/**
 * Which entry a list opens on: the one the field's text names, or else the one `fallbackIndex` picks or
 * the first that can be taken, so that a field whose text stands for a choice already made opens on it
 * and one being typed into opens on its best candidate. Matched the way the sources filter — ignoring
 * case and surrounding space.
 */
function bestMatchIndex<T>(items: T[], text: string, isHeading: ((item: T) => boolean) | undefined, textOf: (item: T) => string, fallbackIndex?: (items: T[]) => number) {
    const canBeTaken = (item: T) => !isHeading?.(item);
    const trimmed = text.trim().toLowerCase();
    const exact = items.findIndex((item) => canBeTaken(item) && textOf(item).toLowerCase() === trimmed);

    if (exact >= 0) return exact;
    const fallback = fallbackIndex?.(items) ?? -1;
    return fallback >= 0 ? fallback : items.findIndex(canBeTaken);
}

/**
 * The next entry that can be taken, in the direction asked for, wrapping at either end and stepping
 * over the headings in between. Nothing to step to — a list of headings alone — leaves nothing
 * highlighted.
 *
 * Exported for its own tests, the alternative being to drive a dropdown by keystrokes to find out
 * which row a heading was skipped for.
 */
export function stepOver<T>(items: T[], from: number, delta: number, isHeading?: (item: T) => boolean) {
    // With nothing highlighted, stepping up starts past the end so that it lands on the last entry.
    let index = from < 0 && delta < 0 ? items.length : from;

    for (let step = 0; step < items.length; step++) {
        index = (index + delta + items.length) % items.length;
        if (!isHeading?.(items[index])) {
            return index;
        }
    }

    return -1;
}
