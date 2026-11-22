import "./LinkTargetList.css";

import type { ReferenceKind } from "@triliumnext/commons";
import clsx from "clsx";
import type { ComponentChildren, RefObject } from "preact";
import { type Dispatch, type StateUpdater, useEffect, useMemo, useState } from "preact/hooks";

import { t } from "../../services/i18n";
import {
    getParentTargets, LINK_TARGET_KINDS, type LinkTarget, nestTargets
} from "../../services/link_targets";
import { Card, ChoiceCardSection } from "./Card";
import { useUniqueName } from "./hooks/dom";
import { useScrollFade } from "./scroll_fade";

/** A choice of a `LinkTargetList`: a target, or the whole note for `null`. */
export type LinkDestination = LinkTarget | null;

export interface LinkTargetListProps {
    listRef: RefObject<HTMLDivElement | null>;
    className?: string;
    /** The targets, nested as `nestTargets()` returns them. */
    targetTree: Map<LinkTarget | null, LinkTarget[]>;
    checkedTarget: LinkTarget | null;
    isWholeNoteChecked?: boolean;
    onCheckTarget(target: LinkTarget): void;
    /** When given, the list starts with the choice of the whole note, which calls this. */
    onCheckWholeNote?(): void;
    /** The targets whose nested targets are shown. */
    expandedTargets: ReadonlySet<LinkTarget>;
    setExpandedTargets: Dispatch<StateUpdater<ReadonlySet<LinkTarget>>>;
    /** The heading of the card of each kind, the `getTitle()` of `LINK_TARGET_KINDS` by default. */
    getKindTitle?(kind: ReferenceKind): string;
    /** Shown in place of the targets when there are none. */
    placeholder?: ComponentChildren;
    /**
     * The id of the element of each choice, for a host that keeps the focus and points
     * `aria-activedescendant` at the checked one. The choices then take no focus.
     */
    getChoiceId?(destination: LinkDestination): string;
}

/**
 * The targets of a note in one card per kind, nested by level, as one choice of where a link
 * points. The list opens scrolled to the checked choice, and fades at the edges it continues past.
 */
export default function LinkTargetList({
    listRef, className, targetTree, checkedTarget, isWholeNoteChecked, onCheckTarget,
    onCheckWholeNote, expandedTargets, setExpandedTargets, getKindTitle, placeholder, getChoiceId
}: LinkTargetListProps) {
    const fade = useScrollFade(listRef);
    const groups = groupByKind(targetTree.get(null) ?? []);
    const isFocusable = !getChoiceId;

    // Runs before `useScrollFade()` first measures, which takes one more render.
    useEffect(() => {
        scrollToCheckedChoice(listRef.current);
    }, []);

    /** The choice of `target`, with the targets nested under it. */
    function renderTarget(target: LinkTarget, index: number) {
        const nested = targetTree.get(target) ?? [];
        // Only a target with a level can nest others, and so has an expander.
        const isNesting = target.level !== undefined;
        return (
            <ChoiceCardSection
                key={index}
                id={getChoiceId?.(target)}
                isFocusable={isFocusable}
                icon={LINK_TARGET_KINDS[target.kind].icon}
                isChecked={target === checkedTarget}
                onCheck={() => onCheckTarget(target)}
                subSections={nested.map(renderTarget)}
                isExpanded={expandedTargets.has(target)}
                onExpandedChange={isNesting ? (isExpanded) => setExpandedTargets((expanded) => {
                    const next = new Set(expanded);
                    if (isExpanded) {
                        next.add(target);
                    } else {
                        next.delete(target);
                    }
                    return next;
                }) : undefined}
            >
                {target.title}
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

            {groups.length === 0 && placeholder}

            {groups.map(([ kind, targets ]) => (
                <Card
                    key={kind}
                    className={`link-target-group link-target-${kind}`}
                    heading={getKindTitle?.(kind) ?? LINK_TARGET_KINDS[kind].getTitle()}
                >
                    {targets.map(renderTarget)}
                </Card>
            ))}
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
 * checked choice and expand or collapse the targets. Enter, Tab and a click call `onPick`.
 */
export function useLinkDestinationKeys(
    targets: LinkTarget[], onPick: (destination: LinkDestination) => void
) {
    const [ pointed, setPointed ] = useState<LinkDestination>(null);
    const [ expandedTargets, setExpandedTargets ] = useState<ReadonlySet<LinkTarget>>(
        new Set()
    );
    const targetTree = useMemo(() => nestTargets(targets), [ targets ]);
    const targetIndexes = useMemo(
        () => new Map(targets.map((target, index) => [ target, index ])), [ targets ]
    );
    const idPrefix = useUniqueName("link-destination");
    // A target collapsed with the pointer hides the choices under it.
    const active = getShownDestination(pointed, targetTree, expandedTargets);

    function getChoiceId(destination: LinkDestination) {
        return destination
            ? `${idPrefix}-target-${targetIndexes.get(destination)}`
            : `${idPrefix}-note`;
    }

    /** Checks `destination`, a choice on show, and scrolls it into view. */
    function moveTo(destination: LinkDestination) {
        setPointed(destination);
        document.getElementById(getChoiceId(destination))?.scrollIntoView({ block: "nearest" });
    }

    /** Checks the choice `delta` places after the checked one, wrapping at either end. */
    function step(delta: number) {
        const destinations = listLinkDestinations(targetTree, expandedTargets);
        const index = destinations.indexOf(active);
        moveTo(destinations[(index + delta + destinations.length) % destinations.length]);
    }

    function setExpanded(target: LinkTarget, isExpanded: boolean) {
        const next = new Set(expandedTargets);
        if (isExpanded) {
            next.add(target);
        } else {
            next.delete(target);
        }
        setExpandedTargets(next);
    }

    /**
     * Expands the checked target, or checks its first nested target once it is expanded. The
     * other way, collapses it, or checks the target it is under.
     */
    function moveAcross(isExpanding: boolean) {
        if (!active) return;

        const nested = targetTree.get(active) ?? [];
        const isExpanded = nested.length > 0 && expandedTargets.has(active);
        if (isExpanding) {
            if (isExpanded) {
                moveTo(nested[0]);
            } else if (nested.length > 0) {
                setExpanded(active, true);
            }
        } else if (isExpanded) {
            setExpanded(active, false);
        } else {
            const parent = getParentTargets(targetTree, active).at(0);
            if (parent) moveTo(parent);
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
                // As in a tree, the arrow that the expander points to expands the target.
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
            targetTree,
            checkedTarget: active,
            isWholeNoteChecked: active === null,
            onCheckTarget: (target: LinkTarget) => onPick(target),
            onCheckWholeNote: () => onPick(null),
            expandedTargets,
            setExpandedTargets,
            getChoiceId
        },
        /** The id of the element of the checked choice. */
        activeId: getChoiceId(active),
        handleKeyDown,
        /** Checks the whole note and collapses the targets, as for the list of another note. */
        reset() {
            setPointed(null);
            setExpandedTargets(new Set());
        }
    };
}

/**
 * The choices of a `LinkTargetList` that starts with the whole note, in the order shown: the whole
 * note, then the targets of each kind whose parents are all expanded.
 */
export function listLinkDestinations(
    targetTree: Map<LinkTarget | null, LinkTarget[]>, expandedTargets: ReadonlySet<LinkTarget>
) {
    const destinations: LinkDestination[] = [ null ];
    const addTargets = (targets: LinkTarget[]) => {
        for (const target of targets) {
            destinations.push(target);
            if (expandedTargets.has(target)) {
                addTargets(targetTree.get(target) ?? []);
            }
        }
    };
    for (const [ , targets ] of groupByKind(targetTree.get(null) ?? [])) {
        addTargets(targets);
    }
    return destinations;
}

/** `targets` in one group per kind, the kinds in the order that they first appear. */
function groupByKind(targets: LinkTarget[]) {
    const groups = new Map<ReferenceKind, LinkTarget[]>();
    for (const target of targets) {
        groups.set(target.kind, [ ...(groups.get(target.kind) ?? []), target ]);
    }
    return [ ...groups ];
}

/** `destination`, or the outermost collapsed target that it is under, which hides it. */
function getShownDestination(
    destination: LinkDestination, targetTree: Map<LinkTarget | null, LinkTarget[]>,
    expandedTargets: ReadonlySet<LinkTarget>
): LinkDestination {
    if (!destination) return destination;

    const collapsed = getParentTargets(targetTree, destination)
        .filter((parent) => !expandedTargets.has(parent))
        .at(-1);
    return collapsed ?? destination;
}
