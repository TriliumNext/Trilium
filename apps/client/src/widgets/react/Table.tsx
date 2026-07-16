/**
 * Public re-export of the generic Tabulator-based table wrapper as a shared Preact widget.
 *
 * The implementation lives at `../collections/table/tabulator` for historical reasons; this module
 * exposes it from the reusable `widgets/react/` component folder so features outside the note
 * collection view can consume it without reaching into `collections/table`. It is decoupled from
 * Trilium's note model — it deals purely in columns, data and events.
 */
export { default, type TableProps } from "../collections/table/tabulator";
