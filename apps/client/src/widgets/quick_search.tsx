import "./quick_search.css";

import type { FieldEditor } from "@triliumnext/codemirror/src/field_editor";
import type { QuickSearchResponse, SearchResultDetails } from "@triliumnext/commons";
import clsx from "clsx";
import type { RefObject } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

import appContext from "../components/app_context";
import { t } from "../services/i18n";
import { calculateHash, type ViewScope } from "../services/link";
import server from "../services/server";
import type { ShortcutHintDefinition } from "../services/shortcut_hints";
import { isMobile } from "../services/utils";
import ActionButton from "./react/ActionButton";
import { ExtendedAdmonition } from "./react/Admonition";
import { AttributeSnippetBadges } from "./react/Badge";
import Button from "./react/Button";
import { focusListItem } from "./react/FormList";
import { useTriliumEvent } from "./react/hooks";
import Icon from "./react/Icon";
import { pointerMoved } from "./react/menu_context";
import OverlayControlGroup from "./react/OverlayControlGroup";
import Popup from "./react/Popup";
import RawHtml, { RawHtmlBlock } from "./react/RawHtml";
import SearchStringEditor from "./search/SearchStringEditor";
import { ShortcutHintOverlayButton } from "./shortcut_hints/shortcut_hint_button";

/** The keys the results answer, beside the field's own, for the shortcut-hints pane. */
const QUICK_SEARCH_HINTS: ShortcutHintDefinition = [
    {
        titleKey: "quick-search.hints.title",
        hints: [
            { keys: [ "Down" ], labelKey: "quick-search.hints.to_results" },
            { keys: [ "PageDown", "PageUp" ], labelKey: "quick-search.hints.page" },
            { keys: [ "Ctrl+Enter" ], labelKey: "quick-search.show-in-full-search" },
            { keys: [ "Escape" ], labelKey: "quick-search.hints.close" }
        ]
    }
];

/** The keys that move focus through the results. */
const NAVIGATION_KEYS = new Set([ "ArrowDown", "ArrowUp", "PageDown", "PageUp" ]);

type SearchState =
    | { status: "searching" }
    | {
        status: "done";
        results: SearchResultDetails[];
        viewScope: ViewScope | undefined;
        error: string | null;
    };

export default function QuickSearch() {
    // In a ref rather than state, so typing re-renders nothing; only its emptiness is state.
    const searchStringRef = useRef("");
    const [ hasQuery, setHasQuery ] = useState(false);
    const [ searchState, setSearchState ] = useState<SearchState>();
    const [ open, setOpen ] = useState(false);
    // Set while the keys move through the results; see `.tn-menu-keyboard` in Menu.css.
    const [ keyboardDriven, setKeyboardDriven ] = useState(false);
    const editorRef = useRef<FieldEditor | undefined>(undefined);
    const boxRef = useRef<HTMLDivElement>(null);
    const popupRef = useRef<HTMLDivElement | null>(null);
    // Each search takes a number, so a slower earlier response cannot overwrite a later one.
    const requestIdRef = useRef(0);

    useTriliumEvent("quickSearch", () => editorRef.current?.focus());
    useResultNavigation(popupRef, open, {
        focusField: () => editorRef.current?.focus(),
        onMoved: () => setKeyboardDriven(true),
        onEscape: close
    });

    /** Opens the results with a search for the query, or refreshes the open results. */
    async function search() {
        const query = searchStringRef.current.trim();
        if (!query) {
            close();
            return;
        }

        setOpen(true);
        const requestId = ++requestIdRef.current;
        setSearchState({ status: "searching" });
        const { searchResults, highlightedTokens, error } = await server.get<QuickSearchResponse>(
            `quick-search?searchString=${encodeURIComponent(query)}`
        );
        if (requestId !== requestIdRef.current) return;

        setSearchState({
            status: "done",
            results: searchResults,
            // Opens the note at its first match; with nothing highlighted, at the plain path.
            viewScope: highlightedTokens.length ? { searchTerms: highlightedTokens } : undefined,
            error
        });
    }

    function showInFullSearch() {
        close();
        const searchString = searchStringRef.current.trim();
        void appContext.triggerCommand("searchNotes", { searchString });
    }

    function close() {
        // Focus on a result goes back to the field, rather than to the page's body.
        if (popupRef.current?.contains(document.activeElement)) editorRef.current?.focus();
        setOpen(false);
        setKeyboardDriven(false);
    }

    return (
        <div className={clsx("quick-search", hasQuery && "has-query")}>
            <div
                ref={boxRef}
                className="quick-search-box"
                // Captured, so the field never takes the Enter for its own search.
                onKeyDownCapture={(e) => {
                    if (e.key !== "Enter" || !e.ctrlKey) return;
                    e.preventDefault();
                    e.stopPropagation();
                    showInFullSearch();
                }}
            >
                <ActionButton
                    className="search-button"
                    icon="bx bx-search"
                    text={t("quick-search.placeholder")}
                    noIconActionClass
                    active={open}
                    onClick={() => (open ? close() : void search())}
                />

                <SearchStringEditor
                    className="search-string"
                    placeholder={t("quick-search.placeholder")}
                    singleLine
                    extraShortcutHints={QUICK_SEARCH_HINTS}
                    editorRef={editorRef}
                    onChange={(value) => {
                        searchStringRef.current = value;
                        setHasQuery(value.length > 0);
                    }}
                    onEnter={() => void search()}
                    // Reached only once the field's completion list, if open, has dropped the key.
                    onEscape={() => {
                        if (!open) return false;
                        close();
                        return true;
                    }}
                    onArrowDown={() => {
                        const popup = popupRef.current;
                        if (!popup || !firstResult(popup)) return false;
                        focusListItem(popup, "first");
                        setKeyboardDriven(true);
                        return true;
                    }}
                />
            </div>

            {open && boxRef.current && (
                <Popup
                    anchor={boxRef.current}
                    placement="bottom-start"
                    offset={2}
                    capHeight={false}
                    className={clsx("dropdown-menu show tn-dropdown-menu quick-search-menu",
                        keyboardDriven && "tn-menu-keyboard")}
                    elementRef={popupRef}
                    escapeDismisses={false}
                    keepOpenSelector=".shortcut-hints-panel"
                    onPointerMove={(e) => {
                        if (!pointerMoved(e)) return;
                        setKeyboardDriven(false);
                        // With focus in the results, the pointer's row takes it, so the keys go on
                        // from there; with focus in the field, the field keeps it.
                        const row = (e.target as Element).closest<HTMLElement>(".dropdown-item");
                        if (row && !row.classList.contains("disabled")
                            && popupRef.current?.contains(document.activeElement)) {
                            row.focus({ preventScroll: true });
                        }
                    }}
                    onDismiss={close}
                >
                    <div className="quick-search-results">
                        <QuickSearchResults searchState={searchState} onOpenResult={close} />
                    </div>
                    <div className="quick-search-footer">
                        {!isMobile() && (
                            <OverlayControlGroup>
                                <ShortcutHintOverlayButton />
                            </OverlayControlGroup>
                        )}
                        <Button
                            className="show-in-full-search"
                            text={t("quick-search.show-in-full-search")}
                            size="small"
                            onClick={showInFullSearch}
                        />
                    </div>
                </Popup>
            )}
        </div>
    );
}

/**
 * Moves focus between the results with the arrow and page keys, and from the first result up to
 * the field, and closes them on Escape. Captured at the window, as Bootstrap's handler for keys in
 * a `.dropdown-menu` crashes on one with no toggle beside it.
 */
function useResultNavigation(popupRef: RefObject<HTMLElement | null>, open: boolean, callbacks: {
    /** Runs for ArrowUp on the first result. */
    focusField(): void;
    /** Runs once the keys have moved focus to another result. */
    onMoved(): void;
    /** Runs for Escape on a result. */
    onEscape(): void;
}) {
    const callbacksRef = useRef(callbacks);
    callbacksRef.current = callbacks;

    useEffect(() => {
        if (!open) return;
        const onKeyDown = (e: KeyboardEvent) => {
            const popup = popupRef.current;
            const target = e.target as Element;
            if (!popup?.contains(target)) return;
            if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                callbacksRef.current.onEscape();
                return;
            }

            if (!NAVIGATION_KEYS.has(e.key)) return;
            e.preventDefault();
            e.stopPropagation();
            const row = target.closest<HTMLElement>(".dropdown-item");
            if (e.key === "ArrowUp" && row === firstResult(popup)) {
                callbacksRef.current.focusField();
                return;
            }

            if (e.key === "PageDown" || e.key === "PageUp") {
                if (row) resultAPageFrom(popup, row, e.key === "PageDown" ? 1 : -1)?.focus();
            } else {
                focusListItem(popup, e.key === "ArrowDown" ? "next" : "previous", target);
            }
            callbacksRef.current.onMoved();
        };
        window.addEventListener("keydown", onKeyDown, true);
        return () => window.removeEventListener("keydown", onKeyDown, true);
    }, [ open ]);
}

/**
 * The result a page away from `row`: the farthest one that starts within the scroller's height of
 * it, and at least the next one. Nothing past either end, so the keys stop there.
 */
function resultAPageFrom(popup: HTMLElement, row: HTMLElement, direction: 1 | -1) {
    const rows = [ ...popup.querySelectorAll<HTMLElement>(".dropdown-item:not(.disabled)") ];
    const index = rows.indexOf(row);
    if (index < 0) return undefined;

    const pageHeight = popup.querySelector(".quick-search-results")?.clientHeight ?? 0;
    let found: HTMLElement | undefined = rows[index + direction];
    for (let i = index + direction; i >= 0 && i < rows.length; i += direction) {
        if (Math.abs(rows[i].offsetTop - row.offsetTop) > pageHeight) break;
        found = rows[i];
    }
    return found;
}

/** The first result focus can move to; the searching and no-results rows are disabled. */
function firstResult(popup: HTMLElement) {
    return popup.querySelector(".dropdown-item:not(.disabled)");
}

function QuickSearchResults({ searchState, onOpenResult }: {
    searchState: SearchState | undefined;
    onOpenResult(): void;
}) {
    if (!searchState) return null;

    if (searchState.status === "searching") {
        return (
            <span className="dropdown-item disabled">
                <Icon icon="bx bx-loader bx-spin" />
                {t("quick-search.searching")}
            </span>
        );
    }

    // What the search ran into while running; the field's linter shows a query that fails to parse
    // before it is run.
    const error = searchState.error && (
        <ExtendedAdmonition
            type="caution"
            icon="bx bx-error-circle"
            title={t("search_string.error_title")}
            className="quick-search-error"
        >
            {searchState.error}
        </ExtendedAdmonition>
    );

    if (!searchState.results.length) {
        return error || (
            <span className="dropdown-item disabled">{t("quick-search.no-results")}</span>
        );
    }

    return <>
        {error}
        {searchState.results.map((result) => (
            <QuickSearchResult
                key={result.notePath}
                result={result}
                viewScope={searchState.viewScope}
                onOpen={onOpenResult}
            />
        ))}
    </>;
}

function QuickSearchResult({ result, viewScope, onOpen }: {
    result: SearchResultDetails;
    viewScope: ViewScope | undefined;
    onOpen(): void;
}) {
    return (
        <a
            className="dropdown-item no-tooltip-preview"
            tabIndex={0}
            href={calculateHash({ notePath: result.notePath, viewScope })}
            onClick={onOpen}
            onAuxClick={onOpen}
        >
            <div className="quick-search-item">
                <div className="quick-search-item-header">
                    <Icon icon={result.icon} className="quick-search-item-icon" />
                    <RawHtml
                        className="search-result-title"
                        html={result.highlightedNotePathTitle ?? result.notePathTitle}
                    />
                </div>

                <AttributeSnippetBadges
                    snippet={result.highlightedAttributeSnippet}
                    className="search-result-attributes"
                />

                {result.highlightedContentSnippet && (
                    <RawHtmlBlock
                        className="search-result-content"
                        html={result.highlightedContentSnippet}
                    />
                )}
            </div>
        </a>
    );
}
