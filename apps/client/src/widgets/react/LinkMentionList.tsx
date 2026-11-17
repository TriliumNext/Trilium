import "./slide_animations.css";
import "./LinkMentionList.css";

import clsx from "clsx";
import type { CSSProperties } from "preact";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";

import { t } from "../../services/i18n";
import {
    getAnchorLinkPath, getHeadingAncestors, getLinkTargets, type LinkHeading, type LinkTargets
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
     * The headings and anchors of the note at `notePath`, read from the editor of the host,
     * when the host edits that note. The server reads those of any other note.
     */
    getOwnTargets?(notePath: string): LinkTargets | undefined;
}

/**
 * A `NoteMentionList` in two pages: the notes for the query, then the places in the note picked
 * that a link to it can point at, which are the whole note, its headings and its anchors. The
 * host links the note as soon as it is picked. The text typed after that link filters the second
 * page, and `onPick` receives the path of the link to the heading or anchor picked there.
 */
export default function LinkMentionList({
    anchor, handleRef, elementRef, onActiveDescendant, linkedNotePath, onLinkNote, onKeepLink,
    getOwnTargets, ...mentions
}: LinkMentionListProps) {
    const { query, onPick } = mentions;
    // The note picked from the list, with the query it was picked for.
    const [ picked, setPicked ] = useState<{ notePath: string; query: string } | null>(null);
    // The headings and anchors of that note, `null` while the server reads them.
    const [ targets, setTargets ] = useState<LinkTargets | null>(null);
    // Counts the notes picked, so the headings and anchors of an earlier one are dropped.
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

    const notes = useNoteMentions({ ...mentions, onPickNote: linkNote });
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
     * the list, and a heading or an anchor once the link that its pick changes is in the text.
     */
    function canPick(destination: Destination | undefined) {
        return isLinked || destination?.kind === "note";
    }

    function pickDestination(destination: Destination) {
        if (destination.kind === "note") {
            onKeepLink();
        } else if (linkedNotePath !== undefined) {
            onPick(destination.kind === "anchor"
                ? getAnchorLinkPath(linkedNotePath, destination.name)
                : getHeadingLinkPath(destination.heading));
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

/** A row of the second page: the whole note, one of its headings or one of its anchors. */
type Destination =
    | { kind: "note" }
    | { kind: "heading"; heading: LinkHeading; index: number; parents: LinkHeading[] }
    | { kind: "anchor"; name: string };

const WHOLE_NOTE: Destination = { kind: "note" };

/**
 * The second page as the rows of a menu: the whole note, then the headings at every level, each
 * indented under the heading it nests under, then the anchors. With a `filter`, it lists only
 * the headings and anchors whose title contains it, each heading with the headings above it.
 */
function LinkDestinationMenu({ autocomplete, filter, isLoading, hasTargets }: {
    autocomplete: ReturnType<typeof useAutocomplete<Destination>>;
    filter: string;
    /** Whether the headings and anchors of the note are still to be read. */
    isLoading: boolean;
    /** Whether the note has a heading or an anchor, whatever `filter` leaves of them. */
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
            {items.map((destination, index) => [
                destination.kind !== "note" && destination.kind !== items[index - 1]?.kind && (
                    <FormListHeader
                        key={`${destination.kind}-header`}
                        text={destination.kind === "heading"
                            ? t("add_link.link_to_heading")
                            : t("add_link.link_to_anchor")}
                    />
                ),
                <SuggestionOption
                    key={getDestinationKey(destination)} autocomplete={autocomplete} index={index}
                >
                    <LinkDestinationRow
                        destination={destination} filter={filter} isFiltered={isFiltered}
                    />
                </SuggestionOption>
            ])}

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
    if (destination.kind === "note") {
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

    if (destination.kind === "anchor") {
        return (
            <span>
                <SuggestionRowContent
                    icon={<Icon icon="bx bx-bookmark" />}
                    header={(
                        <span className="search-result-title">
                            <HighlightedText text={destination.name} query={filter} />
                        </span>
                    )}
                />
            </span>
        );
    }

    const { heading, parents } = destination;
    const isIndented = !isFiltered && parents.length > 0;
    const depthStyle = { "--link-mention-depth": parents.length } as CSSProperties;
    return (
        <span style={isIndented ? depthStyle : undefined}>
            <SuggestionRowContent
                icon={<Icon icon="bx bx-heading" />}
                header={<>
                    <span className="search-result-title">
                        <HighlightedText text={heading.title} query={filter} />
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

/** The headings of `targets` in the order of the document, then its anchors. */
function listDestinations(targets: LinkTargets | null): Destination[] {
    if (!targets) return [];

    const ancestors = getHeadingAncestors(targets.headings);
    return [
        ...targets.headings.map((heading, index): Destination => ({
            kind: "heading", heading, index, parents: ancestors.get(heading) ?? []
        })),
        ...targets.anchors.map((name): Destination => ({ kind: "anchor", name }))
    ];
}

/**
 * The rows for `filter`: the whole note and every heading and anchor while it is blank, then the
 * headings and anchors whose title contains it, whatever its case.
 */
function filterDestinations(destinations: Destination[], filter: string) {
    if (!filter.trim()) return [ WHOLE_NOTE, ...destinations ];

    const typed = filter.toLowerCase();
    return destinations.filter((destination) =>
        getDestinationTitle(destination).toLowerCase().includes(typed));
}

function getDestinationTitle(destination: Destination) {
    switch (destination.kind) {
        case "note": return "";
        case "heading": return destination.heading.title;
        case "anchor": return destination.name;
    }
}

function getDestinationKey(destination: Destination) {
    switch (destination.kind) {
        case "note": return "note";
        case "heading": return `heading-${destination.index}`;
        case "anchor": return `anchor-${destination.name}`;
    }
}

/** Whether `e` is a key that picks the highlighted row, and no part of an input method's entry. */
function isPickKey(e: KeyboardEvent) {
    return (e.key === "Enter" || e.key === "Tab") && !e.isComposing;
}

/**
 * The path of a link to `heading`: at once, or once the server has given the heading a block id.
 * When the server cannot give one, an error is shown and the promise resolves to `undefined`.
 */
function getHeadingLinkPath(heading: LinkHeading): string | Promise<string | undefined> {
    if (!heading.createReference || heading.blockId) return heading.createLinkPath();

    return heading.createReference().then(() => heading.createLinkPath(), (e: unknown) => {
        console.error("Failed to create a reference to the heading:", e);
        toast.showError(t("add_link.heading_reference_failed"));
        return undefined;
    });
}
