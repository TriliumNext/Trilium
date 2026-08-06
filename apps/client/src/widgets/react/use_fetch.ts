import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import server from "../../services/server";

export interface FetchState<T> {
    data: T | null;
    /** The last attempt failed. Meaningful only while {@link data} is still null — see below. */
    failed: boolean;
    /** A request is in flight. One at a time, however often the URL changes. */
    loading: boolean;
}

/**
 * Reads a GET endpoint once, and again whenever the URL changes or {@link refreshToken} does.
 *
 * Nothing else re-runs it — not a note changing, not the component re-rendering. That suits a
 * reading that costs the server real work to produce and is meant to be looked at rather than
 * watched: measuring the database for the space-usage pages, or counting up a note's images for the
 * compression dialog. Asking again is the caller's decision, expressed by bumping the token.
 *
 * `null` until the first response; on a URL change the previous payload stays up while the new one
 * is in flight, so a view transitions instead of blanking.
 *
 * A failure is reported rather than swallowed, because there is nothing to fall back on before the
 * first success: the view would otherwise claim to be loading for as long as it stayed open. The
 * server service toasts most failures, but not one the browser itself rejected (a dropped
 * connection, an unreachable server), which would leave no trace at all. Callers show the failure
 * only while `data` is null — once a payload exists, keeping it beats blanking what is shown.
 */
export function useFetch<T>(url: string, refreshToken = 0): FetchState<T> {
    const [ data, setData ] = useState<T | null>(null);
    const [ failed, setFailed ] = useState(false);
    const [ loading, setLoading ] = useState(true);
    const latestRequest = useRef(0);

    const refresh = useCallback(async () => {
        const requestId = ++latestRequest.current;
        setLoading(true);

        try {
            const response = await server.get<T>(url);

            // A stale response must not repaint over a newer one.
            if (requestId === latestRequest.current) {
                setData(response);
                setFailed(false);
            }
        } catch {
            // The callers fire-and-forget, so the rejection must not escape.
            if (requestId === latestRequest.current) {
                setFailed(true);
            }
        } finally {
            if (requestId === latestRequest.current) {
                setLoading(false);
            }
        }
        // A plain number rather than a callback the caller hands down: a function would carry a new
        // identity on every render of the page above, and re-measure the whole database each time
        // anything there changed.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ url, refreshToken ]);

    useEffect(() => { void refresh(); }, [ refresh ]);

    return { data, failed, loading };
}
