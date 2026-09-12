import { getSql } from "./sql/index.js";

/**
 * How large the database is, and how much of that it is not using.
 *
 * Both are read through pragmas rather than off the filesystem: there is no path to resolve and no
 * race with whoever is writing, the figures are exactly the ones a vacuum moves — and where the
 * database is not a file the user can reach at all, as in the browser, they are the only reading
 * there is.
 *
 * @module
 */

/**
 * Every page the database has allocated, the free ones included. Covers the main database alone; in
 * WAL mode the `-wal` sidecar is not part of it.
 */
export function getDatabaseSizeBytes(): number {
    return getSql().getValue<number>("SELECT page_count * page_size FROM pragma_page_count(), pragma_page_size()");
}

/**
 * Pages already free inside the file. A floor, not a promise: a rebuild also recovers the slack left
 * inside pages that are still in use, which no count of whole pages can see.
 */
export function getReclaimableBytes(): number {
    return getSql().getValue<number>("SELECT freelist_count * page_size FROM pragma_freelist_count(), pragma_page_size()");
}
