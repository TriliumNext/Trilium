import {
    runSearchQuery, type SearchQueryArgs, type SearchQueryKind, type SearchQueryResults
} from "./search_queries.js";

/**
 * Runs the route-level searches. The default runs them in this process; a platform can supply one
 * that runs them elsewhere, such as a read-only replica of becca in a child process.
 *
 * An implementation rejects with the error the query threw, rebuilt by
 * `deserializeSearchQueryError()` when it crossed a process boundary, so the route answers with the
 * same status. It can resolve to `{ needsMain: true }` for a script-based saved search, which the
 * route then runs in this process.
 */
export interface SearchExecutor {
    run<K extends SearchQueryKind>(kind: K, args: SearchQueryArgs[K]): Promise<SearchQueryResults[K]>;
}

export const inProcessSearchExecutor: SearchExecutor = {
    run(kind, args) {
        return new Promise((resolve) => resolve(runOnMain(kind, args)));
    }
};

let executor: SearchExecutor = inProcessSearchExecutor;

/** Installs `searchExecutor`, or the in-process default when it is left out. */
export function initSearchExecutor(searchExecutor?: SearchExecutor) {
    executor = searchExecutor ?? inProcessSearchExecutor;
}

export function getSearchExecutor(): SearchExecutor {
    return executor;
}

/**
 * Runs a search through the installed executor, and in this process when the executor hands it back
 * because it runs a search script.
 */
export async function executeSearch<K extends SearchQueryKind>(
    kind: K, args: SearchQueryArgs[K]
): Promise<SearchQueryResults[K]> {
    const result = await executor.run(kind, args);

    if (typeof result === "object" && result !== null && "needsMain" in result) {
        return runOnMain(kind, args);
    }

    return result;
}

/**
 * Runs a query in this process inside a transaction, so that the writes of a search script commit
 * or roll back together.
 */
function runOnMain<K extends SearchQueryKind>(
    kind: K, args: SearchQueryArgs[K]
): SearchQueryResults[K] {
    return runSearchQuery(kind, args, { transactional: true });
}
