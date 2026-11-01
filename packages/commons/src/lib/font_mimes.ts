/**
 * The media types Trilium handles as fonts, shared by everything that acts on one: the file note's
 * preview draws them, the note icon marks them, and the imported title drops their extension.
 *
 * The list is what `FontFace` rasterizes. EOT and TrueType collections are deliberately absent — no
 * engine loads either through `FontFace`, so a file of one keeps the plain file icon and the
 * "preview not available" notice rather than an icon and a preview promising what cannot be drawn.
 */
export const FONT_MIMES = [
    "font/otf",
    "font/sfnt",
    "font/ttf",
    "font/woff",
    "font/woff2",
    // The names fonts were served under before the `font/*` tree was registered; importers and
    // older databases still carry them.
    "application/font-woff",
    "application/font-woff2",
    "application/x-font-opentype",
    "application/x-font-otf",
    "application/x-font-truetype",
    "application/x-font-ttf"
] as const;

const FONT_MIME_SET: ReadonlySet<string> = new Set(FONT_MIMES);

/** Whether content of this media type is a font Trilium can draw. */
export function isFontMimeType(mime: string | undefined | null): boolean {
    return !!mime && FONT_MIME_SET.has(mime.toLowerCase());
}
