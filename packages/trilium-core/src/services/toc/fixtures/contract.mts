/**
 * Builds and writes the contract JSON of the ToC fixtures, which the specs of every reader of a
 * format compare with. `generate-toc-contract.mts` and `generate-office-toc-contract.mts` use it.
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { assignHeadingIds, getBlobTag } from "../../../../../commons/src/lib/toc.js";
import { blobIdFromDigest, PROTECTED_BLOB_PREFIX } from "../../../../../commons/src/lib/utils.js";

export const fixturesDir = import.meta.dirname;

/**
 * The contract of the document `bytes`: its blob ids, then `fields`, then the ids of `outline`
 * read from the blob and from the protected blob.
 */
export function buildContract(
    bytes: Uint8Array, outline: { title: string; level: number }[], isCut: boolean,
    fields: Record<string, unknown>
) {
    const blobId = digest(bytes);
    const protectedBlobId = digest(Buffer.concat([ Buffer.from(PROTECTED_BLOB_PREFIX), bytes ]));
    return {
        blobId,
        protectedBlobId,
        ...fields,
        ids: assignHeadingIds(outline, getBlobTag(blobId), false, { isCut }),
        protectedIds: assignHeadingIds(outline, getBlobTag(protectedBlobId), true, { isCut })
    };
}

/** Writes `contract` as the fixture `fileName`, in the form that is committed. */
export function writeContract(fileName: string, contract: object) {
    writeFileSync(join(fixturesDir, fileName), `${JSON.stringify(contract, null, 4)}\n`);
}

function digest(content: Uint8Array) {
    return blobIdFromDigest(new Uint8Array(createHash("sha512").update(content).digest()));
}
