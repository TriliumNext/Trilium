import "./LinkTargetList.css";

import clsx from "clsx";
import type { ComponentChildren, RefObject } from "preact";
import { type Dispatch, type StateUpdater, useEffect, useMemo, useState } from "preact/hooks";

import { t } from "../../services/i18n";
import {
    getParentHeadings, type LinkHeading, type LinkTargets, nestHeadings
} from "../../services/link_targets";
import { Card, ChoiceCardSection } from "./Card";
import { useUniqueName } from "./hooks/dom";
import { useScrollFade } from "./scroll_fade";

/** A choice of a `LinkTargetList`: a heading, an anchor, or the whole note for `null`. */
export type LinkDestination = { heading: LinkHeading } | { anchor: string } | null;

export interface LinkTargetListProps {
    listRef: RefObject<HTMLDivElement | null>;
    className?: string;
    /** The headings, nested as `nestHeadings()` returns them. */
    headingTree: Map<LinkHeading | null, LinkHeading[]>;
    anchors: string[];
    checkedHeading: LinkHeading | null;
    checkedAnchor?: string;
    isWholeNoteChecked?: boolean;
    onCheckHeading(heading: LinkHeading): void;
    onCheckAnchor(anchor: string): void;
    /** When given, the list starts with the choice of the whole note, which calls this. */
    onCheckWholeNote?(): void;
    /** The headings whose sub-headings are shown. */
    expandedHeadings: ReadonlySet<LinkHeading>;
    setExpandedHeadings: Dispatch<StateUpdater<ReadonlySet<LinkHeading>>>;
    /** The heading of the card of the headings. */
    headingsTitle: string;
    /** The heading of the card of the anchors. */
    anchorsTitle: string;
    /** Shown in place of the headings and anchors when there are none. */
    placeholder?: ComponentChildren;
    /**
     * The id of the element of each choice, for a host that keeps the focus and points
     * `aria-activedescendant` at the checked one. The choices then take no focus.
     */
    getChoiceId?(destination: LinkDestination): string;
}

/**
 * The headings of a note as a tree, then its anchors, as one choice of where a link points. The
 * list opens scrolled to the checked choice, and fades at the edges it continues past.
 */
export default function LinkTargetList({
    listRef, className, headingTree, anchors, checkedHeading, checkedAnchor, isWholeNoteChecked,
    onCheckHeading, onCheckAnchor, onCheckWholeNote, expandedHeadings, setExpandedHeadings,
    headingsTitle, anchorsTitle, placeholder, getChoiceId
}: LinkTargetListProps) {
    const fade = useScrollFade(listRef);
    const topHeadings = headingTree.get(null) ?? [];
    const isFocusable = !getChoiceId;

    // Runs before `useScrollFade()` first measures, which takes one more render.
    useEffect(() => {
        scrollToCheckedChoice(listRef.current);
    }, []);

    /** The choice of `heading`, with the headings under it. */
    function renderHeading(heading: LinkHeading, index: number) {
        const subHeadings = headingTree.get(heading) ?? [];
        return (
            <ChoiceCardSection
                key={index}
                id={getChoiceId?.({ heading })}
                isFocusable={isFocusable}
                icon="bx bx-heading"
                isChecked={heading === checkedHeading}
                onCheck={() => onCheckHeading(heading)}
                subSections={subHeadings.map(renderHeading)}
                isExpanded={expandedHeadings.has(heading)}
                onExpandedChange={(isExpanded) => setExpandedHeadings((expanded) => {
                    const next = new Set(expanded);
                    if (isExpanded) {
                        next.add(heading);
                    } else {
                        next.delete(heading);
                    }
                    return next;
                })}
            >
                {heading.title}
            </ChoiceCardSection>
        );
    }

    return (
        <div
            ref={listRef}
            className={clsx("link-target-list", className, fade.className)}
            style={fade.style}
        >
            {onCheckWholeNote && (
                <Card className="link-target-whole-note">
                    <ChoiceCardSection
                        id={getChoiceId?.(null)}
                        isFocusable={isFocusable}
                        icon="bx bx-arrow-to-top"
                        isChecked={!!isWholeNoteChecked}
                        onCheck={onCheckWholeNote}
                    >
                        {t("add_link.top_of_note")}
                    </ChoiceCardSection>
                </Card>
            )}

            {topHeadings.length === 0 && anchors.length === 0 && placeholder}

            {topHeadings.length > 0 && (
                <Card className="link-target-headings" heading={headingsTitle}>
                    {topHeadings.map(renderHeading)}
                </Card>
            )}

            {anchors.length > 0 && (
                <Card className="link-target-anchors" heading={anchorsTitle}>
                    {anchors.map((anchor) => (
                        <ChoiceCardSection
                            key={anchor}
                            id={getChoiceId?.({ anchor })}
                            isFocusable={isFocusable}
                            icon="bx bx-bookmark"
                            isChecked={anchor === checkedAnchor}
                            onCheck={() => onCheckAnchor(anchor)}
                        >
                            {anchor}
                        </ChoiceCardSection>
                    ))}
                </Card>
            )}
        </div>
    );
}

/** Scrolls the checked choice in `container` to the middle of it, if there is one. */
export function scrollToCheckedChoice(container: HTMLElement | null) {
    const choice = container?.querySelector<HTMLElement>("[aria-checked=\"true\"]");
    if (!container || !choice) return;

    const offset = choice.getBoundingClientRect().top - container.getBoundingClientRect().top;
    container.scrollTop += offset - (container.clientHeight - choice.offsetHeight) / 2;
}

/**
 * Drives a `LinkTargetList` that starts with the whole note from a host that keeps the focus, as
 * the list of a text editor's `@` does. The keys the host forwards to `handleKeyDown()` move the
 * checked choice and expand or collapse the headings. Enter, Tab and a click call `onPick`.
 */
export function useLinkDestinationKeys(
    { headings, anchors }: LinkTargets, onPick: (destination: LinkDestination) => void
) {
    const [ pointed, setPointed ] = useState<LinkDestination>(null);
    const [ expandedHeadings, setExpandedHeadings ] = useState<ReadonlySet<LinkHeading>>(
        new Set()
    );
    const headingTree = useMemo(() => nestHeadings(headings), [ headings ]);
    const headingIndexes = useMemo(
        () => new Map(headings.map((heading, index) => [ heading, index ])), [ headings ]
    );
    const idPrefix = useUniqueName("link-destination");
    // A heading collapsed with the pointer hides the choices under it.
    const active = getShownDestination(pointed, headingTree, expandedHeadings);

    function getChoiceId(destination: LinkDestination) {
        if (!destination) return `${idPrefix}-note`;
        if ("anchor" in destination) {
            return `${idPrefix}-anchor-${anchors.indexOf(destination.anchor)}`;
        }
        return `${idPrefix}-heading-${headingIndexes.get(destination.heading)}`;
    }

    /** Checks `destination`, a choice on show, and scrolls it into view. */
    function moveTo(destination: LinkDestination) {
        setPointed(destination);
        document.getElementById(getChoiceId(destination))?.scrollIntoView({ block: "nearest" });
    }

    /** Checks the choice `delta` places after the checked one, wrapping at either end. */
    function step(delta: number) {
        const destinations = listLinkDestinations(headingTree, anchors, expandedHeadings);
        const index = destinations.findIndex((other) => isSameDestination(other, active));
        moveTo(destinations[(index + delta + destinations.length) % destinations.length]);
    }

    function setExpanded(heading: LinkHeading, isExpanded: boolean) {
        const next = new Set(expandedHeadings);
        if (isExpanded) {
            next.add(heading);
        } else {
            next.delete(heading);
        }
        setExpandedHeadings(next);
    }

    /**
     * Expands the checked heading, or checks its first sub-heading once it is expanded. The other
     * way, collapses it, or checks the heading it is under.
     */
    function moveAcross(isExpanding: boolean) {
        if (!active || !("heading" in active)) return;

        const { heading } = active;
        const subHeadings = headingTree.get(heading) ?? [];
        const isExpanded = subHeadings.length > 0 && expandedHeadings.has(heading);
        if (isExpanding) {
            if (isExpanded) {
                moveTo({ heading: subHeadings[0] });
            } else if (subHeadings.length > 0) {
                setExpanded(heading, true);
            }
        } else if (isExpanded) {
            setExpanded(heading, false);
        } else {
            const parent = getParentHeadings(headingTree, heading).at(0);
            if (parent) moveTo({ heading: parent });
        }
    }

    /** Handles a key pressed where the host keeps the focus, and returns whether it took it. */
    function handleKeyDown(e: KeyboardEvent) {
        // The keys belong to the input method, such as the Enter that commits a candidate.
        if (e.isComposing) return false;

        switch (e.key) {
            case "ArrowDown":
            case "ArrowUp":
                step(e.key === "ArrowDown" ? 1 : -1);
                break;
            case "ArrowRight":
            case "ArrowLeft":
                // As in a tree, the arrow that the expander points to expands the heading.
                moveAcross((e.key === "ArrowRight") !== !!glob.isRtl);
                break;
            case "Enter":
            case "Tab":
                // A key still held down from an earlier pick picks nothing more.
                if (!e.repeat) onPick(active);
                break;
            default:
                return false;
        }

        e.preventDefault();
        return true;
    }

    return {
        /** The props of the `LinkTargetList` to drive. */
        listProps: {
            headingTree,
            anchors,
            checkedHeading: active && "heading" in active ? active.heading : null,
            checkedAnchor: active && "anchor" in active ? active.anchor : undefined,
            isWholeNoteChecked: active === null,
            onCheckHeading: (heading: LinkHeading) => onPick({ heading }),
            onCheckAnchor: (anchor: string) => onPick({ anchor }),
            onCheckWholeNote: () => onPick(null),
            expandedHeadings,
            setExpandedHeadings,
            getChoiceId
        },
        /** The id of the element of the checked choice. */
        activeId: getChoiceId(active),
        handleKeyDown,
        /** Checks the whole note and collapses the headings, as for the list of another note. */
        reset() {
            setPointed(null);
            setExpandedHeadings(new Set());
        }
    };
}

/**
 * The choices of a `LinkTargetList` that starts with the whole note, in the order shown: the whole
 * note, the headings whose parents are all expanded, then the anchors.
 */
export function listLinkDestinations(
    headingTree: Map<LinkHeading | null, LinkHeading[]>, anchors: string[],
    expandedHeadings: ReadonlySet<LinkHeading>
) {
    const destinations: LinkDestination[] = [ null ];
    const addHeadings = (parent: LinkHeading | null) => {
        for (const heading of headingTree.get(parent) ?? []) {
            destinations.push({ heading });
            if (expandedHeadings.has(heading)) {
                addHeadings(heading);
            }
        }
    };
    addHeadings(null);

    for (const anchor of anchors) {
        destinations.push({ anchor });
    }
    return destinations;
}

/** `destination`, or the outermost collapsed heading that it is under, which hides it. */
function getShownDestination(
    destination: LinkDestination, headingTree: Map<LinkHeading | null, LinkHeading[]>,
    expandedHeadings: ReadonlySet<LinkHeading>
): LinkDestination {
    if (!destination || !("heading" in destination)) return destination;

    const collapsed = getParentHeadings(headingTree, destination.heading)
        .filter((parent) => !expandedHeadings.has(parent))
        .at(-1);
    return collapsed ? { heading: collapsed } : destination;
}

function isSameDestination(a: LinkDestination, b: LinkDestination) {
    if (!a || !b) return a === b;
    if ("heading" in a) return "heading" in b && a.heading === b.heading;
    return "anchor" in b && a.anchor === b.anchor;
}
