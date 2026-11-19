import { sha512 } from "@noble/hashes/sha2.js";
import { blobIdFromDigest, PROTECTED_BLOB_PREFIX } from "@triliumnext/commons/src/lib/utils.js";

/** How many bytes the bundled SHA-512 reads before it lets other tasks run. */
const SLICE_SIZE = 4 * 1024 * 1024;

/** The digests of the loaded document, by protection form, shared by the requests that need one. */
let digests = new Map<boolean, Promise<string>>();
let digestedDocument: object | null = null;

/**
 * The `blobId` of `bytes`, hashed as the content of a protected entity when `isProtected`.
 * Uses Web Crypto where the page has it, and the bundled SHA-512 in slices elsewhere.
 */
export async function digestBlobId(bytes: Uint8Array, isProtected: boolean): Promise<string> {
    const prefix = isProtected ? new TextEncoder().encode(PROTECTED_BLOB_PREFIX) : new Uint8Array();
    const subtle = globalThis.crypto?.subtle;
    if (subtle) {
        // Only the protected form copies the bytes, behind the prefix.
        let input = bytes;
        if (isProtected) {
            input = new Uint8Array(prefix.length + bytes.length);
            input.set(prefix);
            input.set(bytes, prefix.length);
        }
        const digest = await subtle.digest("SHA-512", input as Uint8Array<ArrayBuffer>);
        return blobIdFromDigest(new Uint8Array(digest));
    }

    const hash = sha512.create();
    hash.update(prefix);
    for (let start = 0; start < bytes.length; start += SLICE_SIZE) {
        hash.update(bytes.subarray(start, start + SLICE_SIZE));
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return blobIdFromDigest(hash.digest());
}

/**
 * The `blobId` of the bytes of `pdf`, the document the viewer shows, in the form `isProtected`
 * names. Computed once per document and form.
 */
export function getDocumentBlobId(
    pdf: { getData(): Promise<Uint8Array> }, isProtected: boolean
): Promise<string> {
    if (digestedDocument !== pdf) {
        digestedDocument = pdf;
        digests = new Map();
    }

    let digest = digests.get(isProtected);
    if (!digest) {
        digest = pdf.getData().then((bytes) => digestBlobId(bytes, isProtected));
        digests.set(isProtected, digest);
    }
    return digest;
}
