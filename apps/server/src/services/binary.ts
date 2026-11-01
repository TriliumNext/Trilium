/**
 * Byte helpers for server-side code, where `Buffer` is always available.
 *
 * Deliberately dependency-free. The image codec reaches for this, and the codec is loaded by a worker
 * that must not have to stand up half a server to host it — so nothing here may import Trilium.
 *
 * The browser-facing counterparts live in `@triliumnext/core`'s `services/utils/binary.ts`, which
 * cannot offer these: standalone runs core in a worker with no `Buffer` to convert to.
 */

/**
 * The same bytes as a `Buffer`, over the same memory.
 *
 * `Buffer.from(uint8Array)` duplicates what it is given, and the libraries this server hands bytes to
 * each want a `Buffer` — so an image was being copied whole several times on its way through, for
 * readers that only ever read. On a run over a tree that is a second copy of every photograph in it,
 * allocated and thrown away again, which costs more in collection than the copying does outright.
 *
 * `byteOffset`/`byteLength` keep the view scoped to the caller's slice, never the surrounding backing
 * buffer. A `Buffer` is already one and is returned as it came.
 */
export function asBuffer(bytes: Uint8Array): Buffer {
    if (Buffer.isBuffer(bytes)) {
        return bytes;
    }

    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
