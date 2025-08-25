import becca from "../becca/becca.js";
import NotFoundError from "../errors/not_found_error.js";
import protectedSessionService from "./protected_session.js";
import { hash } from "./utils.js";
import type { Blob } from "./blob-interface.js";

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
        pojo.content = processContent(pojo.content, !!entity.isProtected, true);
    }

    return pojo;
}

function processContent(content: Buffer | string | null, isProtected: boolean, isStringContent: boolean) {
    if (isProtected) {
        if (protectedSessionService.isProtectedSessionAvailable()) {
            content = content === null ? null : protectedSessionService.decrypt(content);
        } else {
            content = "";
        }
    }

    if (isStringContent) {
        return content === null ? "" : content.toString("utf-8");
    } else {
        // see https://github.com/zadam/trilium/issues/3523
        // IIRC a zero-sized buffer can be returned as null from the database
        if (content === null) {
            // this will force de/encryption
            content = Buffer.alloc(0);
        }

        return content;
    }
}

function calculateContentHash({ blobId, content, contentLocation }: Blob) {
    return contentLocation !== 'internal'
        ? hash(`${blobId}|${contentLocation}`)
        : hash(`${blobId}|${content?.toString() || ''}`);
}

function getContentLength(content: Buffer | string | null) {
    if (content === null) {
        return 0;
    }

    if (Buffer.isBuffer(content)) {
        return content.length;
    }

    return Buffer.byteLength(content, "utf8");
}

export default {
    getBlobPojo,
    processContent,
    calculateContentHash,
    getContentLength
};
