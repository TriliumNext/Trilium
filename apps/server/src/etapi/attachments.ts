import becca from "../becca/becca.js";
import eu from "./etapi_utils.js";
import mappers from "./mappers.js";
import v from "./validators.js";
import utils from "../services/utils.js";
import type { Router } from "express";
import type { AttachmentRow } from "@triliumnext/commons";
import type { ValidatorMap } from "./etapi-interface.js";

function register(router: Router) {
    eu.route(router, "get", "/etapi/notes/:noteId/attachments", (req, res, next) => {
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
        content: [v.isString]
    };

    eu.route(router, "post", "/etapi/attachments", (req, res, next) => {
        const _params: Partial<AttachmentRow> = {};
        eu.validateAndPatch(_params, req.body, ALLOWED_PROPERTIES_FOR_CREATE_ATTACHMENT);
        const params = _params as AttachmentRow;

        try {
            if (!params.ownerId) {
                throw new Error("Missing owner ID.");
            }
            const note = becca.getNoteOrThrow(params.ownerId);
            const attachment = note.saveAttachment(params);

            res.status(201).json(mappers.mapAttachmentToPojo(attachment));
        } catch (e: any) {
            throw new eu.EtapiError(500, eu.GENERIC_CODE, e.message);
        }
    });

    eu.route(router, "get", "/etapi/attachments/:attachmentId", (req, res, next) => {
        const attachment = eu.getAndCheckAttachment(req.params.attachmentId);

        res.json(mappers.mapAttachmentToPojo(attachment));
    });

    const ALLOWED_PROPERTIES_FOR_PATCH = {
        role: [v.notNull, v.isString],
        mime: [v.notNull, v.isString],
        title: [v.notNull, v.isString],
        position: [v.notNull, v.isInteger]
    };

    eu.route(router, "patch", "/etapi/attachments/:attachmentId", (req, res, next) => {
        const attachment = eu.getAndCheckAttachment(req.params.attachmentId);

        if (attachment.isProtected) {
            throw new eu.EtapiError(400, "ATTACHMENT_IS_PROTECTED", `Attachment '${req.params.attachmentId}' is protected and cannot be modified through ETAPI.`);
        }

        eu.validateAndPatch(attachment, req.body, ALLOWED_PROPERTIES_FOR_PATCH);
        attachment.save();

        res.json(mappers.mapAttachmentToPojo(attachment));
    });

    eu.route(router, "get", "/etapi/attachments/:attachmentId/content", (req, res, next) => {
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

    eu.route(router, "put", "/etapi/attachments/:attachmentId/content", (req, res, next) => {
        const attachment = eu.getAndCheckAttachment(req.params.attachmentId);

        if (attachment.isProtected) {
            throw new eu.EtapiError(400, "ATTACHMENT_IS_PROTECTED", `Attachment '${req.params.attachmentId}' is protected and cannot be modified through ETAPI.`);
        }

        attachment.setContent(req.body);

        return res.sendStatus(204);
    });

    eu.route(router, "delete", "/etapi/attachments/:attachmentId", (req, res, next) => {
        const attachment = becca.getAttachment(req.params.attachmentId);

        if (!attachment) {
            return res.sendStatus(204);
        }

        attachment.markAsDeleted();

        res.sendStatus(204);
    });
}

export default {
    register
};
