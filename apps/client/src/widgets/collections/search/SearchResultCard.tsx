import type { HighlightedTokenInfo, SearchResultDetails } from "@triliumnext/commons";
import clsx from "clsx";
import { Fragment } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

import type FNote from "../../../entities/fnote";
import { t } from "../../../services/i18n";
import { calculateHash, type ViewScope } from "../../../services/link";
import tree from "../../../services/tree";
import { AttributeSnippetBadges } from "../../react/Badge";
import { CardFrame } from "../../react/Card";
import { useNote, useNoteTitle } from "../../react/hooks";
import Icon from "../../react/Icon";
import LinkButton from "../../react/LinkButton";
import { HighlightedText, RawHtmlBlock } from "../../react/RawHtml";
import { NoteContent } from "../legacy/ListOrGridView";

interface SearchResultCardProps {
    noteId: string;
    details: SearchResultDetails | undefined;
    loading: boolean;
    highlightedTokens: (string | HighlightedTokenInfo)[] | null | undefined;
    showTextRepresentation?: boolean;
}

/**
 * A single Google-style snippet card. The title/icon render immediately from froca, while the
 * server-built snippet and attribute badges fill in from {@link SearchResultDetails} (a snippet
 * skeleton shows while the page's details are still loading).
 */
export default function SearchResultCard({ noteId, details, loading, highlightedTokens, showTextRepresentation }: SearchResultCardProps) {
    const note = useNote(noteId);
    // Search-note children are addressed by bare noteId (a non-search path), matching how the legacy
    // list/grid cards compute their href for a search parent.
    const liveTitle = useNoteTitle(noteId, undefined);
    const title = liveTitle ?? details?.noteTitle ?? note?.title ?? "";
    const icon = note?.getIcon() ?? details?.icon ?? "bx bx-note";
    const fallbackBreadcrumb = useFallbackBreadcrumb(note, !details?.notePathTitle);
    const breadcrumb = getBreadcrumbTitle(details?.notePathTitle) || fallbackBreadcrumb;

    const viewScope: ViewScope = { searchTerms: searchTermsFor(details, highlightedTokens) };
    const href = calculateHash({ notePath: noteId, viewScope });
    const hasDetails = !!details || loading;
    const canExpand = !!details?.contentSnippetTruncated;
    const noteType = note?.type;
    const [ expanded, setExpanded ] = useState(false);
    const [ contentReady, setContentReady ] = useState(false);
    const contentRef = useRef<HTMLDivElement>(null);
    const pendingHeight = useRef<number | null>(null);

    useEffect(() => {
        if (!canExpand) {
            setExpanded(false);
            setContentReady(false);
        }
    }, [ canExpand ]);

    useEffect(() => {
        // A fresh expansion waits for the note to render before it replaces the excerpt.
        if (!expanded) setContentReady(false);
    }, [ expanded ]);

    useLayoutEffect(() => {
        const element = contentRef.current;
        if (!element) return;

        if (expanded && !contentReady) {
            // The excerpt stands in for the note: it is where the expansion starts from.
            pendingHeight.current = element.offsetHeight;
            return;
        }

        const from = pendingHeight.current;
        if (from === null) return;
        pendingHeight.current = null;
        animateHeight(element, from, element.offsetHeight);
    }, [ expanded, contentReady ]);

    function toggleExpanded() {
        pendingHeight.current = contentRef.current?.offsetHeight ?? null;
        setExpanded(!expanded);
    }

    return (
        <CardFrame
            className={clsx("note-book-card", "search-result-card", "no-tooltip-preview",
                note?.getColorClass(), note?.isArchived && "archived")}
            data-note-id={noteId}
        >
            <h5 className="note-book-header">
                <Icon className="note-icon" icon={icon} />
                <span className="note-book-title">
                    <span>
                        <a className="search-result-card-title no-tooltip-preview" href={href}>
                            <HighlightedText text={title} highlightedTokens={highlightedTokens} />
                        </a>
                        {breadcrumb && <NotePath path={breadcrumb} />}
                    </span>
                </span>
            </h5>

            {hasDetails && (
                <div className="search-result-card-content" ref={contentRef}>
                    {expanded && note ? (
                        <>
                            {!contentReady && <SearchResultSnippet details={details} loading={loading} noteType={noteType} />}
                            <NoteContent
                                note={note}
                                noChildrenList
                                highlightedTokens={highlightedTokens}
                                includeArchivedNotes={false}
                                showTextRepresentation={showTextRepresentation}
                                onReady={() => setContentReady(true)}
                            />
                        </>
                    ) : (
                        <SearchResultSnippet details={details} loading={loading} noteType={noteType} />
                    )}
                    {canExpand && (
                        <LinkButton
                            className="search-result-card-more"
                            onClick={toggleExpanded}
                            text={<>
                                <Icon icon={expanded ? "bx bx-chevron-up" : "bx bx-chevron-down"} />
                                <span className="search-result-card-more-label">
                                    {expanded ? t("search_result.show_less") : t("search_result.show_more")}
                                </span>
                            </>}
                        />
                    )}
                    <AttributeSnippetBadges
                        snippet={details?.highlightedAttributeSnippet}
                        className="search-result-card-badges"
                    />
                </div>
            )}
        </CardFrame>
    );
}

/** The height animation in flight per card, so a second toggle cancels the first instead of racing it. */
const heightAnimations = new WeakMap<HTMLElement, Animation>();

/**
 * Grows or shrinks the card between two measured heights, then hands the height back to CSS. The
 * wrapper keeps its natural height, so content that renders later (images) is not clipped.
 */
function animateHeight(element: HTMLElement, from: number, to: number) {
    heightAnimations.get(element)?.cancel();
    if (from === to || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
        return;
    }

    element.style.overflow = "hidden";
    const animation = element.animate(
        [ { height: `${from}px` }, { height: `${to}px` } ],
        { duration: 200, easing: "ease" }
    );
    heightAnimations.set(element, animation);

    const settle = () => {
        if (heightAnimations.get(element) !== animation) return;
        heightAnimations.delete(element);
        element.style.overflow = "";
    };
    animation.onfinish = settle;
    animation.oncancel = settle;
}

function SearchResultSnippet({ details, loading, noteType }: { details: SearchResultDetails | undefined; loading: boolean; noteType?: string }) {
    if (!details) {
        // Details for this page haven't arrived yet: show a skeleton, or nothing once settled.
        return loading ? <div className="search-result-card-snippet skeleton" /> : null;
    }

    if (!details.contentSnippet) {
        // Details exist but there is no snippet to show (e.g. protected notes without a session).
        return <div className="search-result-card-snippet unavailable">{t("search_result.snippet_unavailable")}</div>;
    }

    // Server snippet is pre-escaped with only <b>/<br> injected (same trust level as quick search).
    return <RawHtmlBlock className={clsx("search-result-card-snippet", noteType && `type-${noteType}`)} html={details.highlightedContentSnippet ?? ""} />;
}

/**
 * The ancestor path, marked up like `tree.formatNotePath()` so the shared stylesheet hides the
 * brackets and draws the separators as arrows, exactly as the note list's search results do.
 */
function NotePath({ path }: { path: string }) {
    const segments = path.split(" › ");

    return (
        <small>
            <span className="note-path">
                <span className="path-bracket"> (</span>
                {segments.map((segment, index) => (
                    <Fragment key={index}>
                        <span>{segment}</span>
                        {index < segments.length - 1 && <span className="path-delimiter"> / </span>}
                    </Fragment>
                ))}
                <span className="path-bracket">)</span>
            </span>
        </small>
    );
}

/**
 * The note's path from the tree, as the grid builds it, for the first render before the server's
 * snippet details arrive. The details' path wins once they do, as it names the path the search
 * found the note through.
 */
function useFallbackBreadcrumb(note: FNote | undefined, enabled: boolean) {
    const [ breadcrumb, setBreadcrumb ] = useState<string>();

    useEffect(() => {
        if (!enabled) {
            setBreadcrumb(undefined);
            return;
        }

        const ancestorIds = note?.getBestNotePath()?.slice(1, -1) ?? [];
        if (ancestorIds.length === 0) {
            setBreadcrumb(undefined);
            return;
        }

        let cancelled = false;
        void tree.getNotePathTitle(ancestorIds.join("/")).then((title) => {
            if (!cancelled) setBreadcrumb(title);
        });
        return () => {
            cancelled = true;
        };
    }, [ note, enabled ]);

    return breadcrumb;
}

/** The breadcrumb shows the ancestor path only, i.e. the note-path title minus the note's own title. */
export function getBreadcrumbTitle(notePathTitle: string | undefined): string {
    if (!notePathTitle) return "";
    const parts = notePathTitle.split(" › ");
    parts.pop();
    return parts.join(" › ");
}

/**
 * The terms the find bar looks for in a result opened from a search: the words as the note spells
 * them, so it matches "ktorý" for the query "ktory", or the query's plain tokens without details.
 */
export function searchTermsFor(
    details: Pick<SearchResultDetails, "matchedTerms"> | undefined,
    highlightedTokens: (string | HighlightedTokenInfo)[] | null | undefined
): string[] {
    return details?.matchedTerms?.length ? details.matchedTerms : toPlainSearchTerms(highlightedTokens);
}

/** Plain tokens only (regex tokens can't round-trip as literal search terms). */
export function toPlainSearchTerms(highlightedTokens: (string | HighlightedTokenInfo)[] | null | undefined): string[] {
    if (!highlightedTokens?.length) return [];
    const terms: string[] = [];
    for (const token of highlightedTokens) {
        if (typeof token === "string") {
            terms.push(token);
        } else if (token.type === "plain") {
            terms.push(token.token);
        }
    }
    return terms;
}
