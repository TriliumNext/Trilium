import { createHash } from "node:crypto";

import { blobIdFromDigest, PROTECTED_BLOB_PREFIX } from "@triliumnext/commons/src/lib/utils.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { digestBlobId, getDocumentBlobId } from "./digest";

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("digestBlobId", () => {
    it("gives the blob id of the bytes, ordinary or protected, with Web Crypto and without", async () => {
        const bytes = new TextEncoder().encode("%PDF-1.7 the bytes of a document");
        const ordinary = expectedBlobId(bytes);
        const protectedBlobId = expectedBlobId(Buffer.concat([ Buffer.from(PROTECTED_BLOB_PREFIX), bytes ]));

        expect(await digestBlobId(bytes, false)).toBe(ordinary);
        expect(await digestBlobId(bytes, true)).toBe(protectedBlobId);

        vi.stubGlobal("crypto", {});
        expect(await digestBlobId(bytes, false)).toBe(ordinary);
        expect(await digestBlobId(bytes, true)).toBe(protectedBlobId);
    });

    it("hashes large bytes in slices, and lets other tasks run between them", async () => {
        vi.stubGlobal("crypto", {});
        const bytes = new Uint8Array(9 * 1024 * 1024).fill(7);
        const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

        expect(await digestBlobId(bytes, false)).toBe(expectedBlobId(bytes));

        // 4 MiB, 4 MiB and 1 MiB.
        expect(setTimeoutSpy.mock.calls.filter(([ , delay ]) => delay === 0)).toHaveLength(3);
    });
});

describe("getDocumentBlobId", () => {
    it("digests a document once for each form, and again for another document", async () => {
        const bytes = new TextEncoder().encode("%PDF-1.7 one");
        const first = { getData: vi.fn(async () => bytes.slice()) };
        const second = { getData: vi.fn(async () => bytes.slice()) };

        const [ a, b ] = await Promise.all([ getDocumentBlobId(first, false), getDocumentBlobId(first, false) ]);
        expect(a).toBe(expectedBlobId(bytes));
        expect(b).toBe(a);
        expect(await getDocumentBlobId(first, false)).toBe(a);
        expect(first.getData).toHaveBeenCalledOnce();

        await getDocumentBlobId(first, true);
        expect(first.getData).toHaveBeenCalledTimes(2);

        expect(await getDocumentBlobId(second, false)).toBe(a);
        expect(second.getData).toHaveBeenCalledOnce();
    });
});

function expectedBlobId(content: Uint8Array) {
    return blobIdFromDigest(new Uint8Array(createHash("sha512").update(content).digest()));
}
