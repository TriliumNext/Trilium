/**
 * The share URL patterns, in the order a router must try them: the `/share/api/` routes before the
 * note routes, so a literal segment is never swallowed by `:shareId`, and `/share/` before it so
 * the share root is not read as a note named nothing.
 *
 * Kept in a module of its own, free of imports, so a platform can register its routes without
 * loading the handlers behind them — which carry EJS, the share theme and the syntax highlighter.
 */
export const SHARE_ROUTE_PATHS = [
    "/share/api/notes/:noteId/download",
    "/share/api/notes/:noteId/view",
    "/share/api/notes/:noteId",
    "/share/api/notes",
    // :filename is not used by trilium, but instead used for "save as" to assign a human-readable filename
    "/share/api/images/:noteId/:filename",
    "/share/api/attachments/:attachmentId/image/:filename",
    "/share/api/attachments/:attachmentId/download",
    "/share/",
    "/share/:shareId"
] as const;

export type ShareRoutePath = (typeof SHARE_ROUTE_PATHS)[number];

/** The share paths that can render a text or Markdown note, the only notes that highlight code. */
export const SHARE_PAGE_PATHS: ReadonlySet<ShareRoutePath> = new Set([
    "/share/",
    "/share/:shareId"
]);
