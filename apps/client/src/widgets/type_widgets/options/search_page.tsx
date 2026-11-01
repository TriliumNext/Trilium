import "./search_page.css";

import clsx from "clsx";
import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";

import type FNote from "../../../entities/fnote";
import { t } from "../../../services/i18n";
import { useOptionPages } from "../../dialogs/OptionsDialog";
import { FilterProvider, filterRoleClass, useIsFiltering } from "../../react/filter";
import { useDebouncedValue, useNoteContext } from "../../react/hooks";
import LoadingSpinner from "../../react/LoadingSpinner";
import NoItems from "../../react/NoItems";
import { CONTENT_WIDGETS } from "../ContentWidget";
import type { TypeWidgetProps } from "../type_widget";
import OptionsPageHeader from "./components/OptionsPageHeader";

/**
 * How much has to be typed before there is enough of a word to look for. Two rather than three, so
 * that a setting named by a pair of letters (AI) can be reached by typing it.
 */
export const MIN_QUERY_LENGTH = 2;

const DEBOUNCE_MS = 250;

/**
 * Whether there is enough typed to search by. Also what tells the mobile flow when to put the
 * results in the list's place, so that the two agree on when a search has begun.
 */
export function hasSearchTerms(query: string) {
    return query.trim().length >= MIN_QUERY_LENGTH;
}

/**
 * Pages the search leaves out. The Content Manager is a tool rather than a set of settings, and
 * showing it costs a scan of the database that nobody asked for by typing in a search box.
 */
const PAGES_LEFT_OUT = new Set([ "_optionsContentManager" ]);

/**
 * The settings search: every options page at once, cut down to the settings matching what is being
 * looked for. Reached by focusing the field in the sidebar rather than from the list of pages,
 * since it is a way of finding a setting rather than a page of its own.
 *
 * The pages are mounted as they are, and each takes care of hiding what does not match through
 * {@link FilterProvider}. Mounting them costs a moment, which is what the spinner covers; from then
 * on the results follow the typing, since nothing is mounted or torn down as the query changes.
 */
export default function OptionsSearchPage({ query }: { query: string }) {
    const settled = useDebouncedValue(query.trim(), DEBOUNCE_MS);
    const filter = hasSearchTerms(settled) ? settled : "";
    const ready = useDeferredMount();

    if (!ready) {
        return (
            <SearchPageFrame>
                <div className="options-search-loading"><LoadingSpinner /></div>
            </SearchPageFrame>
        );
    }

    return (
        <SearchPageFrame>
            {!filter && (
                <p className="options-search-hint">{t("options.search_hint")}</p>
            )}

            {/* Kept mounted while there is nothing to look for, so that the first search is as
                quick as every one after it. */}
            <FilterProvider query={filter}>
                <div className="options-search-results" hidden={!filter}>
                    <SearchedPages />

                    <NoItems
                        className="options-search-empty"
                        icon="bx bx-search"
                        text={t("options.search_no_results")}
                    />
                </div>
            </FilterProvider>
        </SearchPageFrame>
    );
}

function SearchPageFrame({ children }: { children: ComponentChildren }) {
    return (
        <div className="note-detail-content-widget-content options options-search">
            <OptionsPageHeader title={t("options.search_title")} icon="bx bx-search" />
            {children}
        </div>
    );
}

function SearchedPages() {
    const pages = useOptionPages().filter((page) => !PAGES_LEFT_OUT.has(page.noteId));
    const { noteContext, parentComponent, ntxId, viewScope } = useNoteContext();
    const pageProps = { noteContext, parentComponent, ntxId, viewScope, isVisible: true };

    return <>
        {pages.map((page) => <SearchedPage key={page.noteId} page={page} {...pageProps} />)}
    </>;
}

/** One page's cards, under the name of the page they belong to, so a result says where it lives. */
function SearchedPage({ page, ...pageProps }: { page: FNote } & Omit<TypeWidgetProps, "note">) {
    const Page = CONTENT_WIDGETS[page.noteId];
    const filtering = useIsFiltering();
    if (!Page) return null;

    // A page with nothing left in it is not worth naming, which the filter's own rule sees to.
    return (
        <section className={clsx("options-search-page", filterRoleClass(filtering && "scope"))}>
            <h3 className="options-search-page-title">
                <span className={page.getIcon()} aria-hidden="true" />
                {page.title}
            </h3>

            <Page note={page} {...pageProps} />
        </section>
    );
}

/**
 * False for the first render and true from the next one, which gives the spinner a chance to be
 * seen before the pages are built and the browser is busy with them.
 */
function useDeferredMount() {
    const [ ready, setReady ] = useState(false);

    useEffect(() => {
        const timer = setTimeout(() => setReady(true));
        return () => clearTimeout(timer);
    }, []);

    return ready;
}
