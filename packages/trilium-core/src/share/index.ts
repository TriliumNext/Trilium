/**
 * The share subsystem: the read-only cache of the `_share` subtree (shaca), the renderer that turns
 * one of its notes into a page, and the transport-neutral route handlers over both.
 *
 * Deliberately kept out of the `@triliumnext/core` barrel: the browser build reaches it through a
 * dynamic import, which only defers its cost — EJS, the share theme and the syntax highlighter —
 * while nothing in the eager graph imports it.
 */
export { assetUrlFragment, readShareTemplate, renderNoteContent, renderNoteForExport } from "./content_renderer.js";
export { getShareRoute, getShareRoutes, handleShareRequest, isVisibleInShareTree, type ShareReply, type ShareRequest, type ShareRoute } from "./handlers.js";
export { SHARE_ROUTE_PATHS, type ShareRoutePath } from "./route_paths.js";
export { initShare, isShareReady, type ShareProvider, type ShareSql } from "./share_provider.js";
export { default as shareRoot } from "./share_root.js";
export { default as shaca } from "./shaca/shaca.js";
export { default as shacaLoader } from "./shaca/shaca_loader.js";
