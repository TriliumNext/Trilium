/**
 * Shared identifiers for the format painter, kept in their own module so the editing and UI plugins
 * can both reference them without importing each other (which would cycle through the glue plugin).
 *
 * The command, component and CSS-class names are deliberately the ones premium `FormatPainter` used,
 * so the toolbar entry (`formatPainter`) and any existing overrides keyed on `ck-format-painter-active`
 * keep working unchanged — the same drop-in approach taken for the `/` palette.
 */

/** Reads the formatting of the current selection and stores it. */
export const COPY_FORMAT_COMMAND = "copyFormat";

/** Applies previously copied formatting to the current selection. */
export const PASTE_FORMAT_COMMAND = "pasteFormat";

/** The `componentFactory` name the toolbar references. */
export const FORMAT_PAINTER_COMPONENT = "formatPainter";

/** Set on the editing roots while the painter is armed, so the cursor signals it. */
export const CURSOR_ACTIVE_CSS_CLASS = "ck-format-painter-active";
