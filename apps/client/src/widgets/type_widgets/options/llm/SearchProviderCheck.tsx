import "./SearchProviderCheck.css";

import type { LlmWebSearchResult } from "@triliumnext/commons";
import { useEffect, useState } from "preact/hooks";

import { t } from "../../../../services/i18n";
import { type ProviderModelsQuery, testSearchProvider } from "../../../../services/llm_chat";
import Button from "../../../react/Button";
import Icon from "../../../react/Icon";
import NoItems from "../../../react/NoItems";

type CheckState =
    | { status: "running" }
    | { status: "passed"; results: LlmWebSearchResult[] }
    | { status: "failed"; error: string };

interface SearchProviderCheckProps {
    /** Credentials of the search provider to test. */
    query: ProviderModelsQuery;
    /** Called with `true` while the last test search has failed, and `false` otherwise. */
    onFailedChange: (failed: boolean) => void;
}

/**
 * Runs a test search through a search provider that is being added or edited, and shows the first
 * results or the error. The search runs each time the step opens and on Retry.
 */
export default function SearchProviderCheck({ query, onFailedChange }: SearchProviderCheckProps) {
    const [ state, setState ] = useState<CheckState>({ status: "running" });
    const [ attempt, setAttempt ] = useState(0);

    useEffect(() => {
        let active = true;
        setState({ status: "running" });
        testSearchProvider(query)
            .then(results => {
                if (active) setState({ status: "passed", results });
            })
            .catch((error: unknown) => {
                if (active) setState({ status: "failed", error: error instanceof Error ? error.message : String(error) });
            });
        return () => { active = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ query.provider, query.apiKey, query.baseURL, attempt ]);

    const failed = state.status === "failed";
    useEffect(() => onFailedChange(failed), [ failed, onFailedChange ]);

    const retryButton = <Button className="search-provider-check-retry" text={t("llm.retry")} icon="bx bx-refresh" onClick={() => setAttempt(n => n + 1)} />;

    if (state.status === "running") {
        return <div className="search-provider-check-status">{t("llm.search_check_running")}</div>;
    }
    if (state.status === "failed") {
        return (
            // JSX escapes the text itself, so i18next must not escape the message as well.
            <NoItems
                icon="bx bx-error-circle"
                className="search-provider-check-error"
                text={t("llm.search_check_failed", { error: state.error, interpolation: { escapeValue: false } })}
            >
                <p className="search-provider-check-hint">{t("llm.search_check_failed_hint")}</p>
                {retryButton}
            </NoItems>
        );
    }
    if (!state.results.length) {
        return (
            <NoItems icon="bx bx-search" className="search-provider-check-empty" text={t("llm.search_check_no_results")}>
                {retryButton}
            </NoItems>
        );
    }
    return (
        <div className="search-provider-check">
            <p className="search-provider-check-passed">
                <Icon icon="bx bx-check-circle" />
                {t("llm.search_check_passed")}
            </p>
            <ul className="search-provider-check-results">
                {state.results.map(({ title, url, snippet }) => (
                    <li key={url}>
                        <a className="tn-link external" href={url} target="_blank" rel="noopener noreferrer">{title}</a>
                        <span className="search-provider-check-site">{hostnameOf(url)}</span>
                        {snippet && <p className="search-provider-check-snippet">{snippet}</p>}
                    </li>
                ))}
            </ul>
        </div>
    );
}

function hostnameOf(url: string): string {
    try {
        return new URL(url).hostname;
    } catch {
        return "";
    }
}
