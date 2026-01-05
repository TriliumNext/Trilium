import { binary_utils } from "@triliumnext/core";

import becca from "../becca/becca.js";
import NotFoundError from "../errors/not_found_error.js";
import type { Blob } from "./blob-interface.js";
import protectedSessionService from "./protected_session.js";
import { hash } from "./utils.js";

function getBlobPojo(entityName: string, entityId: string, opts?: { preview: boolean }) {
    // TODO: Unused opts.
    const entity = becca.getEntity(entityName, entityId);
    if (!entity) {
        throw new NotFoundError(`Entity ${entityName} '${entityId}' was not found.`);
    }

    const blob = becca.getBlob(entity);
    if (!blob) {
        throw new NotFoundError(`Blob ${entity.blobId} for ${entityName} '${entityId}' was not found.`);
    }

    const pojo = blob.getPojo();

    if (!entity.hasStringContent()) {
        pojo.content = null;
    } else {
        pojo.content = processContent(pojo.content, !!entity.isProtected, true) as string | Buffer;
    }

    return pojo;
}

function processContent(content: Buffer | Uint8Array | string | null, isProtected: boolean, isStringContent: boolean) {
    if (isProtected) {
        if (protectedSessionService.isProtectedSessionAvailable()) {
            content = content === null ? null : protectedSessionService.decrypt(content as Uint8Array);
        } else {
            content = "";
        }
    }

    if (isStringContent) {
        return content === null ? "" : binary_utils.decodeUtf8(content as Uint8Array);
    }
    // see https://github.com/zadam/trilium/issues/3523
    // IIRC a zero-sized buffer can be returned as null from the database
    if (content === null) {
        // this will force de/encryption
        content = Buffer.alloc(0);
    }

    return content;
}

function calculateContentHash({ blobId, content }: Blob) {
    return hash(`${blobId}|${content.toString()}`);
}

export default {
    getBlobPojo,
    processContent,
    calculateContentHash
};
