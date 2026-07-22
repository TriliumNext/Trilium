import type { HighlightedTokenInfo, SearchResultDetails } from "@triliumnext/commons";
import { useEffect, useRef } from "preact/hooks";

import { t } from "../../../services/i18n";
import { calculateHash, type ViewScope } from "../../../services/link";
import { Badge } from "../../react/Badge";
import { useImperativeSearchHighlighlighting, useNote, useNoteTitle } from "../../react/hooks";
import Icon from "../../react/Icon";
import RawHtml, { RawHtmlBlock } from "../../react/RawHtml";

interface SearchResultCardProps {
    noteId: string;
    details: SearchResultDetails | undefined;
    loading: boolean;
    highlightedTokens: (string | HighlightedTokenInfo)[] | null | undefined;
}

/**
 * A single Google-style snippet card. The title/icon render immediately from froca, while the
 * server-built snippet and attribute badges fill in from {@link SearchResultDetails} (a snippet
 * skeleton shows while the page's details are still loading).
 */
export default function SearchResultCard({ noteId, details, loading, highlightedTokens }: SearchResultCardProps) {
    const note = useNote(noteId);
    // Search-note children are addressed by bare noteId (a non-search path), matching how the legacy
    // list/grid cards compute their href for a search parent.
    const liveTitle = useNoteTitle(noteId, undefined);
    const title = liveTitle ?? details?.noteTitle ?? note?.title ?? "";
    const icon = note?.getIcon() ?? details?.icon ?? "bx bx-note";
    const breadcrumb = getBreadcrumbTitle(details?.notePathTitle);

    const searchTerms = toPlainSearchTerms(highlightedTokens);
    const viewScope: ViewScope = { searchTerms };
    const href = calculateHash({ notePath: noteId, viewScope });

    // Set the title text imperatively so mark.js (which mutates the DOM to inject `.ck-find-result`
    // spans) doesn't fight Preact's reconciliation of a controlled text child — the same reason
    // NoteLink renders its title imperatively.
    const titleRef = useRef<HTMLSpanElement>(null);
    const highlightTitle = useImperativeSearchHighlighlighting(highlightedTokens);
    useEffect(() => {
        if (titleRef.current) {
            titleRef.current.textContent = title;
            highlightTitle(titleRef.current);
        }
        // highlightTitle is a fresh closure each render; keying on the token list (as the legacy
        // cards do) avoids re-running on every render.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ title, highlightedTokens ]);

    return (
        <a className="search-result-card" href={href}>
            <div className="search-result-card-header">
                <Icon className="search-result-card-icon" icon={icon} />
                <span className="search-result-card-title" ref={titleRef} />
                {breadcrumb && <span className="search-result-card-path">{breadcrumb}</span>}
            </div>
            <SearchResultSnippet details={details} loading={loading} />
            <SearchResultBadges snippet={details?.highlightedAttributeSnippet} />
        </a>
    );
}

function SearchResultSnippet({ details, loading }: { details: SearchResultDetails | undefined; loading: boolean }) {
    if (!details) {
        // Details for this page haven't arrived yet: show a skeleton, or nothing once settled.
        return loading ? <div className="search-result-card-snippet skeleton" /> : null;
    }

    if (!details.contentSnippet) {
        // Details exist but there is no snippet to show (e.g. protected notes without a session).
        return <div className="search-result-card-snippet unavailable">{t("search_result.snippet_unavailable")}</div>;
    }

    // Server snippet is pre-escaped with only <b>/<br> injected (same trust level as quick search).
    return <RawHtmlBlock className="search-result-card-snippet" html={details.highlightedContentSnippet ?? ""} />;
}

function SearchResultBadges({ snippet }: { snippet: string | undefined }) {
    if (!snippet) return null;

    const lines = snippet.split(/<br\s*\/?>/i).map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) return null;

    return (
        <div className="search-result-card-badges">
            {lines.map((line, index) => (
                <Badge key={index} outline text={<RawHtml html={line} />} />
            ))}
        </div>
    );
}

/** The breadcrumb shows the ancestor path only, i.e. the note-path title minus the note's own title. */
export function getBreadcrumbTitle(notePathTitle: string | undefined): string {
    if (!notePathTitle) return "";
    const parts = notePathTitle.split(" › ");
    parts.pop();
    return parts.join(" › ");
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
