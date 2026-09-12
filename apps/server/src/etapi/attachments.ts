import type { AttachmentRow } from "@triliumnext/commons";
import type { Router } from "express";

import { becca, binary_utils } from "@triliumnext/core";
import utils from "../services/utils.js";
import eu from "./etapi_utils.js";
import type { ValidatorMap } from "./etapi-interface.js";
import mappers from "./mappers.js";
import v from "./validators.js";

function register(router: Router) {
    eu.route<{ noteId: string }>(router, "get", "/etapi/notes/:noteId/attachments", (req, res, next) => {
        const note = eu.getAndCheckNote(req.params.noteId);
        const attachments = note.getAttachments();
        res.json(attachments.map((attachment) => mappers.mapAttachmentToPojo(attachment)));
    });

    const ALLOWED_PROPERTIES_FOR_CREATE_ATTACHMENT: ValidatorMap = {
        ownerId: [v.notNull, v.isNoteId],
        role: [v.notNull, v.isString],
        mime: [v.notNull, v.isString],
        title: [v.notNull, v.isString],
        position: [v.notNull, v.isInteger],
        content: [v.isString],
        encoding: [v.isString]
    };

    eu.route(router, "post", "/etapi/attachments", (req, res, next) => {
        const _params: Partial<AttachmentRow> & { encoding?: string } = {};
        eu.validateAndPatch(_params, req.body, ALLOWED_PROPERTIES_FOR_CREATE_ATTACHMENT);
        const params = _params as AttachmentRow & { encoding?: string };

        try {
            if (!params.ownerId) {
                throw new Error("Missing owner ID.");
            }

            const { encoding, ...attachmentParams } = params;

            if (encoding !== undefined && encoding !== "base64") {
                throw new eu.EtapiError(
                    400,
                    "INVALID_ENCODING",
                    `Unsupported encoding '${encoding}'. Only 'base64' is supported.`
                );
            }

            // JSON cannot carry raw binary data, so binary content is transmitted base64-encoded
            // and decoded here before storage. This mirrors the `encoding` convention already used
            // by the ZIP importer and the web API note-update path (see AttachmentRow.encoding).
            const rawContent =
                typeof attachmentParams.content === "string" ? attachmentParams.content : "";
            if (encoding === "base64" && !isWellFormedBase64(rawContent)) {
                throw new eu.EtapiError(
                    400,
                    "INVALID_BASE64_CONTENT",
                    "Content is not valid base64."
                );
            }
            const content =
                encoding === "base64"
                    ? binary_utils.decodeBase64(rawContent)
                    : attachmentParams.content;

            const note = becca.getNoteOrThrow(params.ownerId);
            const attachment = note.saveAttachment({ ...attachmentParams, content });

            res.status(201).json(mappers.mapAttachmentToPojo(attachment));
        } catch (e: any) {
            if (e instanceof eu.EtapiError) {
                throw e;
            }
            throw new eu.EtapiError(500, eu.GENERIC_CODE, e.message);
        }
    });

    eu.route<{ attachmentId: string }>(router, "get", "/etapi/attachments/:attachmentId", (req, res, next) => {
        const attachment = eu.getAndCheckAttachment(req.params.attachmentId);

        res.json(mappers.mapAttachmentToPojo(attachment));
    });

    const ALLOWED_PROPERTIES_FOR_PATCH = {
        role: [v.notNull, v.isString],
        mime: [v.notNull, v.isString],
        title: [v.notNull, v.isString],
        position: [v.notNull, v.isInteger]
    };

    eu.route<{ attachmentId: string }>(router, "patch", "/etapi/attachments/:attachmentId", (req, res, next) => {
        const attachment = eu.getAndCheckAttachment(req.params.attachmentId);

        if (attachment.isProtected) {
            throw new eu.EtapiError(400, "ATTACHMENT_IS_PROTECTED", `Attachment '${req.params.attachmentId}' is protected and cannot be modified through ETAPI.`);
        }

        eu.validateAndPatch(attachment, req.body, ALLOWED_PROPERTIES_FOR_PATCH);
        attachment.save();

        res.json(mappers.mapAttachmentToPojo(attachment));
    });

    eu.route<{ attachmentId: string }>(router, "get", "/etapi/attachments/:attachmentId/content", (req, res, next) => {
        const attachment = eu.getAndCheckAttachment(req.params.attachmentId);

        if (attachment.isProtected) {
            throw new eu.EtapiError(400, "ATTACHMENT_IS_PROTECTED", `Attachment '${req.params.attachmentId}' is protected and content cannot be read through ETAPI.`);
        }

        const filename = utils.formatDownloadTitle(attachment.title, attachment.role, attachment.mime);

        res.setHeader("Content-Disposition", utils.getContentDisposition(filename));

        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        res.setHeader("Content-Type", attachment.mime);

        res.send(attachment.getContent());
    });

    eu.route<{ attachmentId: string }>(router, "put", "/etapi/attachments/:attachmentId/content", (req, res, next) => {
        const attachment = eu.getAndCheckAttachment(req.params.attachmentId);

        if (attachment.isProtected) {
            throw new eu.EtapiError(400, "ATTACHMENT_IS_PROTECTED", `Attachment '${req.params.attachmentId}' is protected and cannot be modified through ETAPI.`);
        }

        attachment.setContent(req.body);

        return res.sendStatus(204);
    });

    eu.route<{ attachmentId: string }>(router, "delete", "/etapi/attachments/:attachmentId", (req, res, next) => {
        const attachment = becca.getAttachment(req.params.attachmentId);

        if (!attachment) {
            return res.sendStatus(204);
        }

        attachment.markAsDeleted();

        res.sendStatus(204);
    });
}

/** RFC 4648 base64: 4-character groups with optional 0-2 trailing '=' padding. */
function isWellFormedBase64(value: string): boolean {
    return value.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(value);
}

export default {
    register
};
