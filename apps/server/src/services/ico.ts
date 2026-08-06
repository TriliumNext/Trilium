/**
 * Dropping the pictures an `.ico` carries that nobody is going to look at.
 *
 * An icon file is a directory of independent pictures at different sizes, and a site's icon
 * routinely holds five or six of them, up to 256x256, where a link preview draws exactly one at 16
 * pixels. Trilium's own site ships 114KB of icon, of which the entry actually rendered is 1.1KB.
 * Left whole, such a file is not merely wasteful — it is over the ceiling a favicon is allowed, so
 * the site ends up with no icon at all rather than a large one.
 *
 * Nothing here decodes anything. The chosen picture's bytes are copied across untouched, which is
 * what lets one piece of code handle both kinds of entry an icon may hold: the older BMP form and
 * the PNG form used for the larger sizes. Lifting an entry out into a file of its own would mean
 * telling them apart and, for the BMP form, rebuilding a header from the DIB — including the
 * doubled height and the one-bit transparency mask that ICO uses in place of an alpha channel.
 */

/** Reserved bytes, type, and the number of pictures that follow. */
const DIRECTORY_HEADER_SIZE = 6;
/** Size, colour depth, and where in the file the picture is. */
const DIRECTORY_ENTRY_SIZE = 16;
/** Type 1 is an icon. Type 2 is a cursor, which shares the layout but is not a picture for a note. */
const ICON_TYPE = 1;
/** Below this an icon is too small to draw a preview with, whatever else the file offers. */
const DEFAULT_MIN_EDGE = 16;

interface IconDirectoryEntry {
    /** Longest edge in pixels. */
    edge: number;
    offset: number;
    length: number;
    /** The entry's own 16 bytes, carried over as they are apart from the offset. */
    header: Uint8Array;
}

/**
 * An icon file holding only the smallest picture still worth drawing, or null when there is nothing
 * to gain — a single picture already, or bytes that cannot be read as an icon directory at all.
 * The caller keeps what it had in that case.
 *
 * These bytes are whatever a linked site chose to serve, so every field is bounds-checked rather
 * than trusted: a length or offset pointing past the end of the file answers null instead of
 * reading somewhere it should not.
 */
export function trimIcoToSmallestEntry(bytes: Uint8Array, minEdge = DEFAULT_MIN_EDGE): Uint8Array | null {
    const entries = readIconDirectory(bytes);

    if (!entries || entries.length < 2) {
        return null;
    }

    // The smallest that is still big enough. Where every picture in the file is below the floor,
    // the largest of them is the best on offer.
    const usable = entries.filter((entry) => entry.edge >= minEdge).sort((a, b) => a.edge - b.edge);
    const kept = usable[0] ?? entries.reduce((largest, entry) => (entry.edge > largest.edge ? entry : largest));

    const pictureAt = DIRECTORY_HEADER_SIZE + DIRECTORY_ENTRY_SIZE;
    const trimmed = new Uint8Array(pictureAt + kept.length);
    const directory = new DataView(trimmed.buffer);

    directory.setUint16(2, ICON_TYPE, true);
    directory.setUint16(4, 1, true);
    trimmed.set(kept.header, DIRECTORY_HEADER_SIZE);
    // Everything about the picture is unchanged except where it now begins: directly after the one
    // entry that is left, rather than after the several there were.
    directory.setUint32(DIRECTORY_HEADER_SIZE + 12, pictureAt, true);
    trimmed.set(bytes.subarray(kept.offset, kept.offset + kept.length), pictureAt);

    return trimmed;
}

/** The pictures an icon file says it holds, or null if it does not read as one. */
function readIconDirectory(bytes: Uint8Array): IconDirectoryEntry[] | null {
    if (bytes.byteLength < DIRECTORY_HEADER_SIZE) {
        return null;
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    if (view.getUint16(0, true) !== 0 || view.getUint16(2, true) !== ICON_TYPE) {
        return null;
    }

    const count = view.getUint16(4, true);

    if (count < 1 || bytes.byteLength < DIRECTORY_HEADER_SIZE + count * DIRECTORY_ENTRY_SIZE) {
        return null;
    }

    const entries: IconDirectoryEntry[] = [];

    for (let index = 0; index < count; index++) {
        const at = DIRECTORY_HEADER_SIZE + index * DIRECTORY_ENTRY_SIZE;
        const length = view.getUint32(at + 8, true);
        const offset = view.getUint32(at + 12, true);

        // A picture holding nothing, starting inside the directory, or running past the end of the
        // file. One malformed entry condemns the file: the sizes are what the choice is made from,
        // so a directory that cannot be read in full cannot be chosen from either.
        if (length < 1 || offset < DIRECTORY_HEADER_SIZE || offset + length > bytes.byteLength) {
            return null;
        }

        entries.push({
            // One byte per edge, where 0 means 256 — how the format fits its largest size into a byte.
            edge: Math.max(view.getUint8(at) || 256, view.getUint8(at + 1) || 256),
            offset,
            length,
            header: bytes.subarray(at, at + DIRECTORY_ENTRY_SIZE)
        });
    }

    return entries;
}
