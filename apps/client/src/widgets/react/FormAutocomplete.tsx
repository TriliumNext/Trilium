import "./FormAutocomplete.css";

import clsx from "clsx";
import type { ComponentChildren, TargetedKeyboardEvent } from "preact";
import { createPortal, type CSSProperties } from "preact/compat";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

import FormTextBox from "./FormTextBox";
import { useUniqueName } from "./hooks";

/** Marks the dropdown, which is portalled to the body: popups checking for outside clicks must ignore it. */
export const AUTOCOMPLETE_DROPDOWN_SELECTOR = ".form-autocomplete-dropdown";

const DEBOUNCE_MS = 150;
const MAX_DROPDOWN_HEIGHT = 300;
/** Below this the space under the input is considered unusable, and the dropdown flips above it. */
const MIN_DROPDOWN_HEIGHT = 120;
const VIEWPORT_MARGIN = 8;

type FormTextBoxProps = Parameters<typeof FormTextBox>[0];

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
     * the string the source returned. Defaults to showing that string.
     */
    renderItem?(item: string): ComponentChildren;
    /**
     * Rendered inside the field, ahead of the box being typed into — the chips of a field holding
     * several values, which belong within its frame rather than above it.
     *
     * The two are then wrapped together, and the list is measured against that wrapper, so it spans
     * the whole field instead of only the stretch of it left over for typing.
     */
    leading?: ComponentChildren;
    /** Rendered inside the field after the input. */
    trailing?: ComponentChildren;
    /** Additional class name for the field wrapper. */
    fieldClassName?: string;
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
export default function FormAutocomplete({
    currentValue,
    onChange,
    source,
    openOnFocus,
    openOnEnter,
    onPick,
    keepOpenOnPick,
    renderItem,
    leading,
    trailing,
    fieldClassName,
    autoActivate,
    isHeading,
    dropdownMinWidth,
    inputRef,
    onFocus,
    onBlur,
    onKeyDown,
    ...restProps
}: FormAutocompleteProps) {
    const ownInputRef = useRef<HTMLInputElement>(null);
    const inputEl = inputRef ?? ownInputRef;
    const fieldRef = useRef<HTMLDivElement>(null);
    const dropdownRef = useRef<HTMLUListElement>(null);
    const [ isOpen, setIsOpen ] = useState(false);
    const [ items, setItems ] = useState<string[]>([]);
    const [ activeIndex, setActiveIndex ] = useState(-1);
    const [ position, setPosition ] = useState<CSSProperties>();

    // Discards responses of queries that were superseded while in flight.
    const latestQuery = useRef(0);
    const isDisabled = !!(restProps.readOnly || restProps.disabled);
    // Names the entries so the field can point at the highlighted one: focus stays in the box, so
    // that pointer is all a screen reader has to go on.
    const itemIdPrefix = useUniqueName("autocomplete-item");
    const activeItemId = activeIndex >= 0 ? `${itemIdPrefix}-${activeIndex}` : undefined;

    const close = useCallback(() => {
        // Invalidates in-flight queries too, so a late response cannot repopulate a closed dropdown.
        latestQuery.current++;
        setIsOpen(false);
        setActiveIndex(-1);
        setItems([]);
    }, []);

    // Fetch suggestions for the current query, debounced. The previous items stay visible while
    // the request is in flight, so refining a query does not make the dropdown flicker.
    useEffect(() => {
        if (!isOpen) {
            return;
        }

        const queryId = ++latestQuery.current;
        const timeout = setTimeout(async () => {
            const suggestions = await source(currentValue);

            // A newer query (or a close) happened while awaiting.
            if (latestQuery.current === queryId) {
                setItems(suggestions);
                setActiveIndex(autoActivate ? bestMatchIndex(suggestions, currentValue, isHeading) : -1);
            }
        }, DEBOUNCE_MS);

        return () => clearTimeout(timeout);
    }, [ isOpen, currentValue, source, autoActivate, isHeading ]);

    // Keep the highlighted entry in sight: it can be picked out on opening, or arrowed past the
    // bottom of a list taller than the room the dropdown was given.
    useEffect(() => {
        if (activeIndex < 0) return;
        // `nearest` scrolls the list by as little as it takes, and not at all while the entry is
        // already in view — so hovering down a visible list never moves it under the pointer.
        dropdownRef.current?.children[activeIndex]?.scrollIntoView({ block: "nearest" });
    }, [ activeIndex, items ]);

    // Keep the dropdown glued to the input.
    useLayoutEffect(() => {
        if (!isOpen || !items.length) {
            return;
        }

        const reposition = () => {
            // The wrapper where there is one, so a field carrying chips is spanned whole.
            const anchor = fieldRef.current ?? inputEl.current;
            if (anchor) {
                setPosition(computeDropdownPosition(anchor, dropdownMinWidth));
            }
        };

        reposition();
        window.addEventListener("resize", reposition);
        // Capture: the input may live inside a scrolling container rather than the document.
        window.addEventListener("scroll", reposition, true);
        return () => {
            window.removeEventListener("resize", reposition);
            window.removeEventListener("scroll", reposition, true);
        };
    }, [ isOpen, items.length, inputEl, dropdownMinWidth ]);

    function selectItem(item: string) {
        if (isHeading?.(item)) {
            return;
        }

        (onPick ?? onChange)(item);
        if (keepOpenOnPick) {
            // Nothing is highlighted until the refreshed entries arrive, so Enter cannot take twice
            // what the list is about to stop offering.
            setActiveIndex(-1);
        } else {
            close();
        }
        inputEl.current?.focus();
    }

    function handleKeyDown(e: TargetedKeyboardEvent<HTMLInputElement>) {
        const isDropdownShown = isOpen && items.length > 0;

        switch (e.key) {
            case "ArrowDown":
            case "ArrowUp":
                e.preventDefault();
                if (!isDropdownShown) {
                    setIsOpen(true);
                } else {
                    const delta = e.key === "ArrowDown" ? 1 : -1;
                    setActiveIndex((index) => stepOver(items, index, delta, isHeading));
                }
                break;

            case "Enter":
                if (isDropdownShown && activeIndex >= 0) {
                    // Consume the key so it does not also reach the surrounding form or dialog.
                    e.preventDefault();
                    e.stopPropagation();
                    selectItem(items[activeIndex]);
                } else if (openOnEnter && !isDisabled) {
                    setIsOpen(true);
                }
                break;

            case "Escape":
                if (isDropdownShown) {
                    // Only dismiss the dropdown; a surrounding popup keeps its own Escape handling.
                    e.stopPropagation();
                    close();
                }
                break;

            case "Tab":
                close();
                break;
        }

        onKeyDown?.(e);
    }

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
                if (!isDisabled) {
                    setIsOpen(true);
                }
            }}
            onFocus={(e) => {
                if (openOnFocus && !isDisabled) {
                    setIsOpen(true);
                }
                onFocus?.(e);
            }}
            onBlur={(newValue) => {
                close();
                onBlur?.(newValue);
            }}
            onKeyDown={handleKeyDown}
            role="combobox"
            aria-expanded={isOpen && items.length > 0}
            aria-autocomplete="list"
            aria-activedescendant={activeItemId}
        />
    );

    return (
        <>
            {leading !== undefined || trailing !== undefined
                ? <div
                    ref={fieldRef}
                    className={clsx("tn-field form-autocomplete-field", fieldClassName)}
                >
                    {leading}{field}{trailing}
                </div>
                : field}

            {isOpen && items.length > 0 && position && createPortal(
                <ul
                    ref={dropdownRef}
                    className="form-autocomplete-dropdown"
                    role="listbox"
                    style={position}
                    // Keeps the input focused, so the blur handler does not close the dropdown
                    // before the click lands on an item.
                    onMouseDown={(e) => e.preventDefault()}
                >
                    {items.map((item, index) => (
                        isHeading?.(item)
                            ? <li key={item} className="form-autocomplete-heading" role="presentation">
                                {renderItem ? renderItem(item) : item}
                            </li>
                            : <li
                                key={item}
                                id={`${itemIdPrefix}-${index}`}
                                className={`form-autocomplete-item ${index === activeIndex ? "active" : ""}`}
                                role="option"
                                aria-selected={index === activeIndex}
                                onMouseEnter={() => setActiveIndex(index)}
                                onClick={() => selectItem(item)}
                            >
                                {renderItem ? renderItem(item) : item}
                            </li>
                    ))}
                </ul>,
                document.body)}
        </>
    );
}

/**
 * Which entry a list opens on: the one the field's text names, or the first that can be taken, so
 * that a field whose text stands for a choice already made opens on it and one being typed into
 * opens on its best candidate. Matched the way the sources filter — ignoring case and surrounding
 * space.
 */
function bestMatchIndex(items: string[], text: string, isHeading?: (item: string) => boolean) {
    const canBeTaken = (item: string) => !isHeading?.(item);
    const trimmed = text.trim().toLowerCase();
    const exact = items.findIndex((item) => canBeTaken(item) && item.toLowerCase() === trimmed);

    return exact >= 0 ? exact : items.findIndex(canBeTaken);
}

/**
 * The next entry that can be taken, in the direction asked for, wrapping at either end and stepping
 * over the headings in between. Nothing to step to — a list of headings alone — leaves nothing
 * highlighted.
 *
 * Exported for its own tests, the alternative being to drive a dropdown by keystrokes to find out
 * which row a heading was skipped for.
 */
export function stepOver(items: string[], from: number, delta: number, isHeading?: (item: string) => boolean) {
    let index = from;

    for (let step = 0; step < items.length; step++) {
        index = (index + delta + items.length) % items.length;
        if (!isHeading?.(items[index])) {
            return index;
        }
    }

    return -1;
}

/**
 * Places the dropdown under the input, flipping above it only when the space below is too small to
 * be useful. Preferring below matters for inputs sitting in a panel docked to the bottom of the
 * screen: the room under them is limited but ample, while flipping would cover the panel itself.
 *
 * As wide as the field, or as wide as `minWidth` asks where that is more, and never wider than the
 * viewport. A list grown past the far edge is pulled back onto the screen rather than left running
 * off it, since it is placed from the field's leading edge.
 *
 * Exported for its own tests: everything it reads is measured from the layout, which is what a
 * component test in a headless DOM has none of.
 */
export function computeDropdownPosition(input: HTMLElement, minWidth = 0): CSSProperties {
    const rect = input.getBoundingClientRect();
    const viewportHeight = document.documentElement.clientHeight;
    const viewportWidth = document.documentElement.clientWidth;
    const spaceBelow = viewportHeight - rect.bottom - VIEWPORT_MARGIN;
    const spaceAbove = rect.top - VIEWPORT_MARGIN;
    const flipAbove = spaceBelow < MIN_DROPDOWN_HEIGHT && spaceAbove > spaceBelow;
    const available = flipAbove ? spaceAbove : spaceBelow;
    const maxHeight = Math.min(MAX_DROPDOWN_HEIGHT, Math.max(available, 0));

    const room = Math.max(viewportWidth - 2 * VIEWPORT_MARGIN, 0);
    const width = Math.min(Math.max(rect.width, minWidth), room);
    const left = Math.max(VIEWPORT_MARGIN, Math.min(rect.left, viewportWidth - VIEWPORT_MARGIN - width));

    return {
        left: `${left}px`,
        top: `${flipAbove ? rect.top - maxHeight : rect.bottom}px`,
        width: `${width}px`,
        maxHeight: `${maxHeight}px`
    };
}
