import "./script_modules.css";

import type { ScriptModuleSearchResult, ScriptModuleSummary } from "@triliumnext/commons";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import { t } from "../../services/i18n";
import server from "../../services/server";
import { formatSize } from "../../services/utils";
import ActionButton from "../react/ActionButton";
import Alert from "../react/Alert";
import Button from "../react/Button";
import FormEntryAutocomplete, { type AutocompleteEntry } from "../react/FormEntryAutocomplete";
import FormGroup from "../react/FormGroup";
import { useTriliumEvent } from "../react/hooks";
import Modal from "../react/Modal";
import NoItems from "../react/NoItems";

/** Shorter queries are not offered to the registry. */
const MIN_QUERY_LENGTH = 2;

/** The key of the row reporting on a search, which only ever appears once. */
const STATUS_KEY = "search-status";

type SearchEntry = AutocompleteEntry & (
    /** Searches the registry for `query`. */
    | { kind: "search"; query: string }
    /** A package the registry answered with; picking it puts its exact version in the field. */
    | { kind: "package"; result: ScriptModuleSearchResult }
    /** Reports on a search. */
    | { kind: "info" }
);

/** A registry search, kept so its results can be listed under the query they answer. */
export interface SearchRun {
    query: string;
    status: "loading" | "done" | "failed";
    results: ScriptModuleSearchResult[];
    /** What went wrong, shown under the row that reports the failure. */
    error?: string;
}

/**
 * Lists the installed script modules and installs more of them by npm spec.
 *
 * The registry is not searched as the user types: a search leaves the instance and tells npmjs.com
 * what someone is looking for. It sits in the dropdown as a row that runs it when picked, the way
 * the geo map offers its geocoder. Picking a result puts `name@version` in the field, which is what
 * `Install` then fetches — so the field is left to Enter and the rows are taken by pointer or arrow
 * key.
 */
export default function ScriptModulesDialog() {
    const [ shown, setShown ] = useState(false);
    const [ modules, setModules ] = useState<ScriptModuleSummary[]>([]);
    const [ spec, setSpec ] = useState("");
    const [ installing, setInstalling ] = useState(false);
    const [ error, setError ] = useState<string>();
    const [ run, setRun ] = useState<SearchRun>();
    // Discards a search superseded by a later one, since each reports through the same state.
    const latestRun = useRef(0);

    const refresh = useCallback(async () => {
        setModules(await server.get<ScriptModuleSummary[]>("script-modules"));
    }, []);

    useTriliumEvent("showScriptModules", () => {
        setError(undefined);
        setSpec("");
        setRun(undefined);
        setShown(true);
    });

    useEffect(() => {
        if (shown) void refresh();
    }, [ shown, refresh ]);

    const runSearch = useCallback(async (query: string) => {
        const runId = ++latestRun.current;
        setRun({ query, status: "loading", results: [] });

        try {
            const url = `script-modules/search?q=${encodeURIComponent(query)}`;
            const results = await server.get<ScriptModuleSearchResult[]>(url);
            if (latestRun.current !== runId) return;
            setRun({ query, status: "done", results });
        } catch (e) {
            if (latestRun.current !== runId) return;
            setRun({ query, status: "failed", results: [], error: errorMessage(e) });
        }
    }, []);

    const entries = useCallback(async (query: string) => searchEntries(run, query), [ run ]);

    const pickEntry = useCallback((entry: SearchEntry) => {
        if (entry.kind === "search") {
            void runSearch(entry.query);
        } else if (entry.kind === "package") {
            setSpec(`${entry.result.name}@${entry.result.version}`);
        }
    }, [ runSearch ]);

    async function install() {
        const wanted = spec.trim();
        if (!wanted || installing) return;

        setInstalling(true);
        setError(undefined);
        try {
            await server.post<ScriptModuleSummary>("script-modules", { spec: wanted });
            setSpec("");
            setRun(undefined);
            await refresh();
        } catch (e) {
            setError(errorMessage(e));
        } finally {
            setInstalling(false);
        }
    }

    async function remove(module: ScriptModuleSummary) {
        setError(undefined);
        try {
            await server.remove(`script-modules/${module.noteId}`);
            await refresh();
        } catch (e) {
            setError(errorMessage(e));
        }
    }

    return (
        <Modal
            className="script-modules-dialog"
            title={t("script_modules.title")}
            size="lg" maxWidth={600}
            onSubmit={install}
            onHidden={() => setShown(false)}
            show={shown}
            footer={<Button text={t("modal.close")} onClick={() => setShown(false)} />}
        >
            <div className="script-modules-install">
                <FormGroup
                    name="script-module-spec"
                    description={t("script_modules.spec_description")}
                >
                    <FormEntryAutocomplete
                        className="script-module-spec-input"
                        currentValue={spec}
                        onChange={setSpec}
                        entries={entries}
                        onPick={pickEntry}
                        minQueryLength={MIN_QUERY_LENGTH}
                        openOnFocus
                        placeholder={t("script_modules.spec_placeholder")}
                        autoFocus
                    />
                </FormGroup>
                <Button
                    text={installing ? t("script_modules.installing") : t("script_modules.install")}
                    disabled={installing || !spec.trim()}
                    kind="primary"
                />
            </div>

            {error && <Alert type="danger">{error}</Alert>}

            {modules.length > 0
                ? <ul className="script-modules-list">
                    {modules.map((module) => (
                        <li key={module.noteId}>
                            <span className="script-module-spec">{module.spec}</span>
                            <span className="script-module-detail">
                                {t("script_modules.module_detail", {
                                    provider: module.providerId,
                                    fileCount: module.fileCount,
                                    size: formatSize(module.size)
                                })}
                            </span>
                            <ActionButton
                                icon="bx bx-trash"
                                text={t("script_modules.remove")}
                                onClick={() => void remove(module)}
                            />
                        </li>
                    ))}
                </ul>
                : <NoItems
                    icon="bx bx-cube" size="small"
                    text={t("script_modules.none_installed")}
                />
            }
        </Modal>
    );
}

/**
 * What the dropdown offers for a query: the row that searches the registry, the packages a search
 * answering it found, or a word on how that search went.
 *
 * Exported for its own tests, the alternative being to drive the dialog by keystrokes to find out
 * which row a search is offered from.
 */
export function searchEntries(run: SearchRun | undefined, query: string): SearchEntry[] {
    if (run?.query !== query) {
        return [ {
            kind: "search",
            key: "search",
            query,
            label: t("script_modules.search_online", { query }),
            icon: "bx bx-search-alt",
            className: "script-module-entry-search",
            keepsListOpen: true
        } ];
    }

    if (run.status === "loading") {
        return [ infoEntry(t("script_modules.searching_online"), "bx bx-loader-alt") ];
    }
    if (run.status === "failed") {
        return [ infoEntry(t("script_modules.search_failed"), "bx bx-error-circle", run.error) ];
    }
    if (!run.results.length) {
        return [ infoEntry(t("script_modules.no_results"), "bx bx-info-circle") ];
    }

    return run.results.map((result) => ({
        kind: "package",
        key: `package:${result.name}`,
        label: `${result.name}@${result.version}`,
        icon: "bx bx-cube",
        detail: result.description,
        className: "script-module-entry-package",
        result
    }));
}

/** A row that reports on a search rather than offering a package. */
function infoEntry(label: string, icon: string, detail?: string): SearchEntry {
    return { kind: "info", key: STATUS_KEY, label, icon, detail, inert: true };
}

/** Pulls the server's message out of a rejected request, which arrives as the raw response body. */
function errorMessage(e: unknown): string {
    if (typeof e === "string") {
        try {
            const parsed = JSON.parse(e);
            if (parsed && typeof parsed.message === "string") {
                return parsed.message;
            }
        } catch {
            return e;
        }
        return e;
    }

    return e instanceof Error ? e.message : String(e);
}
