import "./slide_animations.css";
import "./LinkMentionList.css";

import clsx from "clsx";
import type { CSSProperties } from "preact";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";

import { t } from "../../services/i18n";
import {
    getLinkTargets, getTargetAncestors, LINK_TARGET_KINDS, type LinkTarget
} from "../../services/link_targets";
import { getNoteIdFromUrl } from "../../services/navigation_state";
import toast from "../../services/toast";
import {
    type AutocompleteListHandle, useActiveDescendant, useAutocomplete, useForwardedKeys
} from "./FormAutocomplete";
import { FormListHeader } from "./FormList";
import { useSlide } from "./hooks/dom";
import Icon from "./Icon";
import {
    HighlightedText, lookUpNow, type NoteMentionListProps, NoteSuggestionMenu,
    NoteSuggestionPopup, SuggestionOption, SuggestionRowContent, useNoteMentions
} from "./NoteAutocomplete";

export interface LinkMentionListProps extends NoteMentionListProps {
    /**
     * The path of the note that the host linked for `onLinkNote`, from when `query` is the text
     * typed after that link, which filters the headings and anchors of the note.
     */
    linkedNotePath?: string;
    /** Links the note picked from the list. The host then sets `linkedNotePath`. */
    onLinkNote(notePath: string): void;
    /** Closes the list on the pick of the whole note, which the link of the host points at. */
    onKeepLink(): void;
    /**
     * The targets of the note at `notePath`, such as its headings and anchors, read from the
     * editor of the host when the host edits that note. The server reads those of any other note.
     */
    getOwnTargets?(notePath: string): LinkTarget[] | undefined;
}

/**
 * A `NoteMentionList` in two pages: the notes for the query, then the places in the note picked
 * that a link to it can point at, which are the whole note and its targets, such as its headings
 * and anchors. The host links the note as soon as it is picked. The text typed after that link
 * filters the second page, and `onPick` receives the path of the link to the target picked there.
 */
export default function LinkMentionList({
    anchor, handleRef, elementRef, onActiveDescendant, linkedNotePath, onLinkNote, onKeepLink,
    getOwnTargets, ...mentions
}: LinkMentionListProps) {
    const { query, onPick } = mentions;
    // The note picked from the list, with the query it was picked for.
    const [ picked, setPicked ] = useState<{ notePath: string; query: string } | null>(null);
    // The targets of that note, `null` while the server reads them.
    const [ targets, setTargets ] = useState<LinkTarget[] | null>(null);
    // Counts the notes picked, so the targets of an earlier one are dropped.
    const pickCountRef = useRef(0);
    // The width of the popup and the height of its pages when the note was picked.
    const [ frame, setFrame ] = useState<{ width: number; height: number }>();
    const popupRef = useRef<HTMLDivElement | null>(null);
    const pagesRef = useRef<HTMLDivElement>(null);
    // The focus stays where the text is typed, so there is no field to return it to.
    const inputRef = useRef<HTMLInputElement>(null);

    const isLinked = linkedNotePath !== undefined;
    const isOnDestinations = isLinked || picked?.query === query;
    const filter = isLinked ? query : "";
    const page: Page = isOnDestinations ? "destinations" : "notes";
    const slide = useSlide(page);

    // The notes keep the query they were picked for, so the filter of the second page looks up
    // no notes.
    const notesQuery = isOnDestinations && picked ? picked.query : query;
    const notes = useNoteMentions({ ...mentions, query: notesQuery, onPickNote: linkNote });
    const destinations = useMemo(() => listDestinations(targets), [ targets ]);
    const source = useCallback(
        async (text: string) => filterDestinations(destinations, text), [ destinations ]
    );
    const destinationList = useAutocomplete<Destination>({
        query: filter,
        source,
        onPick: pickDestination,
        holdOnPick: (destination) => !canPick(destination),
        inputRef,
        autoActivate: true,
        schedule: lookUpNow
    });

    // Open from the start, so the second page slides in with its rows.
    useEffect(() => destinationList.open(), []);

    // A note that the host did not link is dropped with its query, so that query typed again
    // lists the notes.
    useEffect(() => {
        if (picked && !isLinked && picked.query !== query) setPicked(null);
    }, [ picked, isLinked, query ]);

    function linkNote(notePath: string) {
        const pickCount = ++pickCountRef.current;
        const ownTargets = getOwnTargets?.(notePath);
        const noteId = getNoteIdFromUrl(notePath);
        setPicked({ notePath, query });
        setTargets(ownTargets ?? null);
        setFrame({
            width: popupRef.current?.getBoundingClientRect().width ?? 0,
            height: pagesRef.current?.getBoundingClientRect().height ?? 0
        });
        onLinkNote(notePath);

        if (!ownTargets && noteId) {
            void getLinkTargets(noteId, notePath).then((loaded) => {
                if (pickCount === pickCountRef.current) setTargets(loaded);
            });
        }
    }

    /**
     * Whether `destination` can be picked: the whole note at any time, as its pick only closes
     * the list, and a target once the link that its pick changes is in the text.
     */
    function canPick(destination: Destination | undefined) {
        return isLinked || destination?.target === null;
    }

    function pickDestination({ target }: Destination) {
        if (!target) {
            onKeepLink();
        } else if (isLinked) {
            onPick(getTargetLinkPath(target));
        }
    }

    const notesHandleRef = useRef<AutocompleteListHandle | null>(null);
    const destinationsHandleRef = useRef<AutocompleteListHandle | null>(null);
    useForwardedKeys(notes, notesHandleRef);
    useForwardedKeys(destinationList, destinationsHandleRef);
    useLayoutEffect(() => {
        handleRef.current = {
            handleKeyDown(e) {
                if (!isOnDestinations) return notesHandleRef.current?.handleKeyDown(e) ?? false;
                // Enter and Tab pick nothing while held down, nor a row that cannot be picked yet.
                const highlighted = destinationList.items[destinationList.activeIndex];
                if (isPickKey(e) && (e.repeat || !canPick(highlighted))) return true;
                return destinationsHandleRef.current?.handleKeyDown(e) ?? false;
            }
        };
        return () => {
            handleRef.current = null;
        };
    });

    const shownList = isOnDestinations ? destinationList : notes;
    const isRowHighlighted = shownList.isShown && shownList.activeIndex >= 0;
    useActiveDescendant(
        isRowHighlighted ? shownList.itemId(shownList.activeIndex) : null, onActiveDescendant
    );

    const setPopup = useCallback((element: HTMLDivElement | null) => {
        popupRef.current = element;
        if (typeof elementRef === "function") {
            elementRef(element);
        } else if (elementRef) {
            elementRef.current = element;
        }
    }, [ elementRef ]);

    /** The classes of the page `name`, which slides while it replaces the other page. */
    function getPageClass(name: Page) {
        return clsx("link-mention-page", `link-mention-${name}`, {
            "link-mention-page-entering": slide.from !== undefined && page === name,
            "link-mention-page-leaving": slide.from === name
        });
    }

    if (!notes.isShown && !isOnDestinations) return null;

    // The second page is as wide as the notes were, and at least as tall until it is filtered.
    const popupStyle = isOnDestinations && frame?.width ? { width: `${frame.width}px` } : undefined;
    const keptHeight = isOnDestinations && !filter.trim() ? frame?.height : undefined;
    const pagesStyle = keptHeight ? { minHeight: `${keptHeight}px` } : undefined;

    return (
        <NoteSuggestionPopup
            anchor={anchor}
            elementRef={setPopup}
            className="note-mention-menu link-mention-menu"
            style={popupStyle}
        >
            <div
                ref={pagesRef}
                className="link-mention-pages"
                style={pagesStyle}
                onAnimationEnd={slide.onAnimationEnd}
            >
                {(page === "notes" || slide.from === "notes") && (
                    <div key="notes" className={getPageClass("notes")}>
                        <NoteSuggestionMenu autocomplete={notes} className="tn-menu-scroll" />
                    </div>
                )}

                {(page === "destinations" || slide.from === "destinations") && (
                    <div key="destinations" className={getPageClass("destinations")}>
                        <LinkDestinationMenu
                            autocomplete={destinationList}
                            filter={filter}
                            isLoading={!targets}
                            hasTargets={destinations.length > 0}
                        />
                    </div>
                )}
            </div>
        </NoteSuggestionPopup>
    );
}

/** The pages of the list, in the order they are visited. */
type Page = "notes" | "destinations";

/** A row of the second page: the whole note for a `null` target, or one of its targets. */
interface Destination {
    target: LinkTarget | null;
    /** The position of the target in the targets of the note. */
    index: number;
    /** The targets that the target nests under, the outermost first. */
    parents: LinkTarget[];
}

const WHOLE_NOTE: Destination = { target: null, index: -1, parents: [] };

/**
 * The second page as the rows of a menu: the whole note, then the targets of each kind under a
 * header, each indented under the targets it nests under. With a `filter`, it lists only the
 * targets whose title contains it, each with the targets that it nests under.
 */
function LinkDestinationMenu({ autocomplete, filter, isLoading, hasTargets }: {
    autocomplete: ReturnType<typeof useAutocomplete<Destination>>;
    filter: string;
    /** Whether the targets of the note are still to be read. */
    isLoading: boolean;
    /** Whether the note has targets, whatever `filter` leaves of them. */
    hasTargets: boolean;
}) {
    const { items } = autocomplete;
    const isFiltered = !!filter.trim();
    const isEmpty = isFiltered ? items.length === 0 : !hasTargets;

    return (
        <menu
            className="tn-menu-scroll"
            role="listbox"
            // Keeps the focus where the text is typed, which closes the list without it.
            onMouseDown={(e) => e.preventDefault()}
        >
            {items.map((destination, index) => {
                const kind = destination.target?.kind;
                return [
                    kind && kind !== items[index - 1]?.target?.kind && (
                        <FormListHeader
                            key={`${kind}-header`} text={LINK_TARGET_KINDS[kind].getTitle()}
                        />
                    ),
                    <SuggestionOption
                        key={getDestinationKey(destination)} autocomplete={autocomplete}
                        index={index}
                    >
                        <LinkDestinationRow
                            destination={destination} filter={filter} isFiltered={isFiltered}
                        />
                    </SuggestionOption>
                ];
            })}

            {isLoading && (
                <LinkDestinationStatus
                    icon="bx bx-loader bx-spin" text={t("add_link.inspecting_note")}
                />
            )}
            {!isLoading && isEmpty && (
                <LinkDestinationStatus
                    icon="bx bx-info-circle"
                    text={isFiltered ? t("quick-search.no-results") : t("add_link.no_link_targets")}
                />
            )}
        </menu>
    );
}

/** The content of the row of `destination`, laid out as a row of the notes is. */
function LinkDestinationRow({ destination, filter, isFiltered }: {
    destination: Destination;
    filter: string;
    isFiltered: boolean;
}) {
    const { target, parents } = destination;
    if (!target) {
        return (
            <span>
                <SuggestionRowContent
                    icon={<Icon icon="bx bx-arrow-to-top" />}
                    header={(
                        <span className="search-result-title">{t("add_link.top_of_note")}</span>
                    )}
                />
            </span>
        );
    }

    const isIndented = !isFiltered && parents.length > 0;
    const depthStyle = { "--link-mention-depth": parents.length } as CSSProperties;
    return (
        <span style={isIndented ? depthStyle : undefined}>
            <SuggestionRowContent
                icon={<Icon icon={LINK_TARGET_KINDS[target.kind].icon} />}
                header={<>
                    <span className="search-result-title">
                        <HighlightedText text={target.title} query={filter} />
                    </span>
                    {isFiltered && parents.length > 0 && (
                        <span className="note-suggestion-path">
                            <span>{parents.map((parent) => parent.title).join(" / ")}</span>
                        </span>
                    )}
                </>}
            />
        </span>
    );
}

/** A row that cannot be picked, with the state of the second page, such as that it is loading. */
function LinkDestinationStatus({ icon, text }: { icon: string; text: string }) {
    return (
        <li className="dropdown-item disabled">
            <span>
                <SuggestionRowContent
                    icon={<Icon icon={icon} />}
                    header={<span className="search-result-title">{text}</span>}
                />
            </span>
        </li>
    );
}

/** The rows of the `targets` of a note, in the order that the note lists them. */
function listDestinations(targets: LinkTarget[] | null): Destination[] {
    if (!targets) return [];

    const ancestors = getTargetAncestors(targets);
    return targets.map((target, index) => ({
        target, index, parents: ancestors.get(target) ?? []
    }));
}

/**
 * The rows for `filter`: the whole note and every target while it is blank, then the targets
 * whose title contains it, whatever its case.
 */
function filterDestinations(destinations: Destination[], filter: string) {
    if (!filter.trim()) return [ WHOLE_NOTE, ...destinations ];

    const typed = filter.toLowerCase();
    return destinations.filter(({ target }) => target?.title.toLowerCase().includes(typed));
}

function getDestinationKey({ target, index }: Destination) {
    return target ? `target-${index}` : "note";
}

/** Whether `e` is a key that picks the highlighted row, and no part of an input method's entry. */
function isPickKey(e: KeyboardEvent) {
    return (e.key === "Enter" || e.key === "Tab") && !e.isComposing;
}

/**
 * The path of a link to `target`: at once, or once the server has given the target a reference.
 * When the server cannot give one, an error is shown and the promise resolves to `undefined`.
 */
function getTargetLinkPath(target: LinkTarget): string | Promise<string | undefined> {
    if (!target.createReference || target.params) return target.createLinkPath();

    return target.createReference().then(() => target.createLinkPath(), (e: unknown) => {
        console.error("Failed to create a reference to the target:", e);
        toast.showError(t("add_link.heading_reference_failed"));
        return undefined;
    });
}
