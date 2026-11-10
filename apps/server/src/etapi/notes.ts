import { becca, BNote, checkImageAttachments, exceedsBlobContentLimit, type ExportFormat, MAX_BLOB_CONTENT_LENGTH, note_service as noteService, NoteParams, search as searchService, SearchContext, SearchParams, TaskContext, zipExportService, zipImportService } from "@triliumnext/core";
import type { Request, Router } from "express";
import type { ParsedQs } from "qs";

import sql from "../services/sql.js";
import utils from "../services/utils.js";
import eu from "./etapi_utils.js";
import type { ValidatorMap } from "./etapi-interface.js";
import mappers from "./mappers.js";
import v from "./validators.js";

function register(router: Router) {
    eu.route(router, "get", "/etapi/notes", (req, res, next) => {
        const { search } = req.query;

        if (typeof search !== "string" || !search?.trim()) {
            throw new eu.EtapiError(400, "SEARCH_QUERY_PARAM_MANDATORY", "'search' query parameter is mandatory.");
        }

        const searchParams = parseSearchParams(req);
        const searchContext = new SearchContext(searchParams);

        const searchResults = searchService.findResultsWithQuery(search, searchContext);
        const foundNotes = searchResults.map((sr) => becca.notes[sr.noteId]);

        const resp: any = {
            results: foundNotes.map((note) => mappers.mapNoteToPojo(note))
        };

        if (searchContext.debugInfo) {
            resp.debugInfo = searchContext.debugInfo;
        }

        res.json(resp);
    });

    eu.route<{ noteId: string }>(router, "get", "/etapi/notes/:noteId", (req, res, next) => {
        const note = eu.getAndCheckNote(req.params.noteId);

        res.json(mappers.mapNoteToPojo(note));
    });

    const ALLOWED_PROPERTIES_FOR_CREATE_NOTE: ValidatorMap = {
        parentNoteId: [v.mandatory, v.notNull, v.isNoteId],
        title: [v.mandatory, v.notNull, v.isString],
        type: [v.mandatory, v.notNull, v.isNoteType],
        mime: [v.notNull, v.isString],
        content: [v.notNull, v.isString],
        notePosition: [v.notNull, v.isInteger],
        prefix: [v.notNull, v.isString],
        isExpanded: [v.notNull, v.isBoolean],
        noteId: [v.notNull, v.isValidEntityId],
        dateCreated: [v.notNull, v.isString, v.isLocalDateTime],
        utcDateCreated: [v.notNull, v.isString, v.isUtcDateTime],
        utcDateModified: [v.notNull, v.isString, v.isUtcDateTime]
    };

    eu.route(router, "post", "/etapi/create-note", (req, res, next) => {
        const _params = {};
        eu.validateAndPatch(_params, req.body, ALLOWED_PROPERTIES_FOR_CREATE_NOTE);
        const params = _params as NoteParams;

        // Validate MIME type for image notes
        if (params.type === "image" && params.mime && !params.mime.toLowerCase().startsWith("image/")) {
            throw new eu.EtapiError(400, "INVALID_MIME_FOR_IMAGE", `MIME type '${params.mime}' is not allowed for image notes. MIME must start with 'image/'.`);
        }

        if (params.noteId && becca.getNote(params.noteId)) {
            throw new eu.EtapiError(409, "NOTE_ALREADY_EXISTS", `Note '${params.noteId}' already exists.`);
        }

        try {
            const resp = noteService.createNewNote(params);
            // `save()` stamps the current time, so `setDateCreatedAndModified()` applies the
            // requested date afterwards.
            if (req.body.utcDateModified) {
                resp.note.setDateCreatedAndModified(undefined, req.body.utcDateModified);
            }

            res.status(201).json({
                note: mappers.mapNoteToPojo(resp.note),
                branch: mappers.mapBranchToPojo(resp.branch)
            });
        } catch (e: any) {
            return eu.sendError(res, 500, eu.GENERIC_CODE, e.message);
        }
    });

    const ALLOWED_PROPERTIES_FOR_PATCH = {
        title: [v.notNull, v.isString],
        type: [v.notNull, v.isNoteType],
        mime: [v.notNull, v.isString],
        dateCreated: [v.notNull, v.isString, v.isLocalDateTime],
        utcDateCreated: [v.notNull, v.isString, v.isUtcDateTime],
        utcDateModified: [v.notNull, v.isString, v.isUtcDateTime]
    };

    eu.route<{ noteId: string }>(router, "patch", "/etapi/notes/:noteId", (req, res, next) => {
        const note = eu.getAndCheckNote(req.params.noteId);

        if (note.isProtected) {
            throw new eu.EtapiError(400, "NOTE_IS_PROTECTED", `Note '${req.params.noteId}' is protected and cannot be modified through ETAPI.`);
        }

        // Validate MIME type for image notes (check both current and new type/mime)
        const effectiveType = req.body.type ?? note.type;
        const effectiveMime = req.body.mime ?? note.mime;
        if (effectiveType === "image" && typeof effectiveMime === "string" && effectiveMime && !effectiveMime.toLowerCase().startsWith("image/")) {
            throw new eu.EtapiError(400, "INVALID_MIME_FOR_IMAGE", `MIME type '${effectiveMime}' is not allowed for image notes. MIME must start with 'image/'.`);
        }

        noteService.saveRevisionIfNeeded(note);
        eu.validateAndPatch(note, req.body, ALLOWED_PROPERTIES_FOR_PATCH);
        note.save();
        if (req.body.utcDateModified) {
            note.setDateCreatedAndModified(undefined, req.body.utcDateModified);
        }

        res.json(mappers.mapNoteToPojo(note));
    });

    eu.route<{ noteId: string }>(router, "delete", "/etapi/notes/:noteId", (req, res, next) => {
        const { noteId } = req.params;

        const note = becca.getNote(noteId);

        if (!note) {
            return res.sendStatus(204);
        }

        note.deleteNote(null, new TaskContext("no-progress-reporting", "deleteNotes", null));

        res.sendStatus(204);
    });

    eu.route<{ noteId: string }>(router, "get", "/etapi/notes/:noteId/content", (req, res, next) => {
        const note = eu.getAndCheckNote(req.params.noteId);

        if (note.isProtected) {
            throw new eu.EtapiError(400, "NOTE_IS_PROTECTED", `Note '${req.params.noteId}' is protected and content cannot be read through ETAPI.`);
        }

        const filename = utils.formatDownloadTitle(note.title, note.type, note.mime);

        res.setHeader("Content-Disposition", utils.getContentDisposition(filename));

        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        res.setHeader("Content-Type", note.mime);

        res.send(note.getContent());
    });

    eu.route<{ noteId: string }>(router, "put", "/etapi/notes/:noteId/content", (req, res, next) => {
        const note = eu.getAndCheckNote(req.params.noteId);

        if (note.isProtected) {
            throw new eu.EtapiError(400, "NOTE_IS_PROTECTED", `Note '${req.params.noteId}' is protected and cannot be modified through ETAPI.`);
        }

        noteService.saveRevisionIfNeeded(note);
        note.setContent(req.body);

        void noteService.asyncPostProcessContent(note, req.body);

        return res.sendStatus(204);
    });

    eu.route(router, "post", "/etapi/notes/bulk-update", (req, res) => {
        const { items } = req.body || {};
        const skipFts = req.query.skipFts === "true" || req.query.skipFts === "1";
        const atomic = req.query.atomic === "true" || req.query.atomic === "1";

        if (!Array.isArray(items)) {
            throw new eu.EtapiError(400, "INVALID_BODY", "Request body must contain an 'items' array.");
        }

        if (items.length === 0) {
            return res.json({ total: 0, updated: 0, failed: 0, errors: [] });
        }

        if (items.length > 1000) {
            throw new eu.EtapiError(400, "BATCH_TOO_LARGE", "Maximum batch size is 1,000 items per request.");
        }

        if (atomic) {
            // Validate all items before mutating to prevent partial updates and keep cache clean
            for (const item of items) {
                const { noteId, content } = item || {};

                if (!noteId || typeof content !== "string") {
                    throw new eu.EtapiError(400, "INVALID_ITEM", "Item must contain 'noteId' and 'content' string.");
                }

                const note = becca.getNote(noteId);
                if (!note) {
                    throw new eu.EtapiError(404, "NOTE_NOT_FOUND", `Note '${noteId}' not found.`);
                }

                if (note.isProtected) {
                    throw new eu.EtapiError(
                        400,
                        "NOTE_IS_PROTECTED",
                        `Note '${noteId}' is protected and cannot be modified through ETAPI.`
                    );
                }

                if (exceedsBlobContentLimit(content)) {
                    throw new eu.EtapiError(
                        400,
                        "CONTENT_TOO_LARGE",
                        `Content for note '${noteId}' exceeds maximum blob length of ${MAX_BLOB_CONTENT_LENGTH} bytes.`
                    );
                }
            }

            const originalNoteStates = new Map<
                string,
                {
                    note: BNote;
                    originalBlobId: string | undefined;
                    originalUtcDateModified: string | undefined;
                    originalDateModified: string | undefined;
                }
            >();
            const postProcessNotes = new Map<string, { note: BNote; content: string }>();

            try {
                for (const item of items) {
                    const note = becca.getNoteOrThrow(item.noteId);
                    if (!originalNoteStates.has(note.noteId)) {
                        originalNoteStates.set(note.noteId, {
                            note,
                            originalBlobId: note.blobId,
                            originalUtcDateModified: note.utcDateModified,
                            originalDateModified: note.dateModified
                        });
                    }

                    let finalContent = item.content;
                    let forceFrontendReload = false;

                    if (skipFts) {
                        if (shouldCheckImageAttachments(note)) {
                            ({ content: finalContent, forceFrontendReload } = checkImageAttachments(note, finalContent));
                        }
                    } else {
                        postProcessNotes.set(note.noteId, { note, content: item.content });
                    }

                    noteService.saveRevisionIfNeeded(note);
                    note.setContent(finalContent, { forceFrontendReload });
                }
            } catch (err) {
                for (const { note, originalBlobId, originalUtcDateModified, originalDateModified } of originalNoteStates.values()) {
                    note.blobId = originalBlobId;
                    note.utcDateModified = originalUtcDateModified;
                    note.dateModified = originalDateModified;
                }
                throw err;
            }

            for (const { note, content } of postProcessNotes.values()) {
                void noteService.asyncPostProcessContent(note, content);
            }

            return res.json({
                total: items.length,
                updated: items.length,
                failed: 0,
                errors: []
            });
        }

        // Non-atomic mode: process each item, collecting errors for failed items
        const errors: Array<{ noteId: string; error: string }> = [];
        const postProcessNotes = new Map<string, { note: BNote; content: string }>();
        let updatedCount = 0;

        for (const item of items) {
            const { noteId, content } = item || {};

            if (!noteId || typeof content !== "string") {
                errors.push({
                    noteId: noteId || "unknown",
                    error: "Item must contain 'noteId' string and 'content' string."
                });
                continue;
            }

            const note = becca.getNote(noteId);
            if (!note) {
                errors.push({ noteId, error: `Note '${noteId}' not found.` });
                continue;
            }

            if (note.isProtected) {
                errors.push({
                    noteId,
                    error: `Note '${noteId}' is protected and cannot be modified through ETAPI.`
                });
                continue;
            }

            if (exceedsBlobContentLimit(content)) {
                errors.push({
                    noteId,
                    error: `Content exceeds maximum blob length of ${MAX_BLOB_CONTENT_LENGTH} bytes.`
                });
                continue;
            }

            const originalBlobId = note.blobId;
            const originalUtcDateModified = note.utcDateModified;
            const originalDateModified = note.dateModified;

            try {
                sql.transactional(() => {
                    let finalContent = content;
                    let forceFrontendReload = false;

                    if (skipFts) {
                        if (shouldCheckImageAttachments(note)) {
                            ({ content: finalContent, forceFrontendReload } = checkImageAttachments(note, finalContent));
                        }
                    } else {
                        postProcessNotes.set(note.noteId, { note, content });
                    }

                    noteService.saveRevisionIfNeeded(note);
                    note.setContent(finalContent, { forceFrontendReload });
                });

                updatedCount++;
            } catch (err) {
                note.blobId = originalBlobId;
                note.utcDateModified = originalUtcDateModified;
                note.dateModified = originalDateModified;
                postProcessNotes.delete(note.noteId);

                errors.push({ noteId, error: err instanceof Error ? err.message : "Failed to update note content." });
            }
        }

        for (const { note, content } of postProcessNotes.values()) {
            void noteService.asyncPostProcessContent(note, content);
        }

        return res.json({
            total: items.length,
            updated: updatedCount,
            failed: errors.length,
            errors
        });
    });

    eu.route<{ noteId: string }>(router, "get", "/etapi/notes/:noteId/export", (req, res, next) => {
        const note = eu.getAndCheckNote(req.params.noteId);
        const format = req.query.format || "html";

        if (typeof format !== "string" || !["html", "markdown", "share"].includes(format)) {
            throw new eu.EtapiError(400, "UNRECOGNIZED_EXPORT_FORMAT", `Unrecognized export format '${format}', supported values are 'html' (default), 'markdown' or 'share'.`);
        }

        // Protected content never leaves through ETAPI, even while the protected session is open.
        // The share format cannot leave it out, so it refuses a subtree that holds any.
        const protectedNote = format === "share" ? note.getSubtree({ includeHidden: true }).notes.find((n) => n.isProtected) : undefined;
        if (protectedNote) {
            throw new eu.EtapiError(400, "NOTE_IS_PROTECTED", `Note '${protectedNote.noteId}' is protected and cannot be exported through ETAPI in the 'share' format.`);
        }

        const taskContext = new TaskContext("no-progress-reporting", "export", null);

        // technically a branch is being exported (includes prefix), but it's such a minor difference yet usability pain
        // (e.g. branchIds are not seen in UI), that we export "note export" instead.
        const branch = note.getParentBranches()[0];

        void zipExportService.exportToZip(taskContext, branch, format as ExportFormat, res, true, { excludeProtected: true });
    });

    eu.route<{ noteId: string }>(router, "post", "/etapi/notes/:noteId/import", (req, res, next) => {
        const note = eu.getAndCheckNote(req.params.noteId);

        if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
            throw new eu.EtapiError(400, "ZIP_FILE_REQUIRED", "The request body must be a ZIP file sent as 'application/zip' or 'application/octet-stream'.");
        }

        const taskContext = new TaskContext("no-progress-reporting", "importNotes", null);
        zipImportService.importZip(taskContext, req.body, note).then((importedNote) => {
            res.status(201).json({
                note: mappers.mapNoteToPojo(importedNote),
                branch: mappers.mapBranchToPojo(importedNote.getParentBranches()[0])
            });
        }).catch(next); // forward async import errors to the ETAPI error handler
    });

    eu.route<{ noteId: string }>(router, "post", "/etapi/notes/:noteId/revision", (req, res, next) => {
        const note = eu.getAndCheckNote(req.params.noteId);

        const description = typeof req.body?.description === "string" ? req.body.description : "";
        note.saveRevision({ description, source: "etapi" });

        return res.sendStatus(204);
    });
}

function parseSearchParams(req: Request) {
    const rawSearchParams: SearchParams = {
        fastSearch: parseBoolean(req.query, "fastSearch"),
        includeArchivedNotes: parseBoolean(req.query, "includeArchivedNotes"),
        ancestorNoteId: parseString(req.query["ancestorNoteId"]),
        ancestorDepth: parseString(req.query["ancestorDepth"]), // e.g. "eq5"
        orderBy: parseString(req.query["orderBy"]),
        orderDirection: parseOrderDirection(req.query, "orderDirection"),
        limit: parseInteger(req.query, "limit"),
        debug: parseBoolean(req.query, "debug")
    };

    const searchParams: SearchParams = {};

    for (const paramName of Object.keys(rawSearchParams) as (keyof SearchParams)[]) {
        if (rawSearchParams[paramName] !== undefined) {
            (searchParams as any)[paramName] = rawSearchParams[paramName];
        }
    }

    return searchParams;
}

const SEARCH_PARAM_ERROR = "SEARCH_PARAM_VALIDATION_ERROR";

function parseString(value: string | ParsedQs | (string | ParsedQs)[] | undefined): string | undefined {
    if (typeof value === "string") {
        return value;
    }

    return undefined;
}

function parseBoolean(obj: any, name: string) {
    if (!(name in obj)) {
        return undefined;
    }

    if (!["true", "false"].includes(obj[name])) {
        throw new eu.EtapiError(400, SEARCH_PARAM_ERROR, `Cannot parse boolean '${name}' value '${obj[name]}, allowed values are 'true' and 'false'.`);
    }

    return obj[name] === "true";
}

function parseOrderDirection(obj: any, name: string) {
    if (!(name in obj)) {
        return undefined;
    }

    if (!["asc", "desc"].includes(obj[name])) {
        throw new eu.EtapiError(400, SEARCH_PARAM_ERROR, `Cannot parse order direction value '${obj[name]}, allowed values are 'asc' and 'desc'.`);
    }

    return obj[name];
}

function parseInteger(obj: any, name: string) {
    if (!(name in obj)) {
        return undefined;
    }

    const integer = parseInt(obj[name]);

    if (Number.isNaN(integer)) {
        throw new eu.EtapiError(400, SEARCH_PARAM_ERROR, `Cannot parse integer '${name}' value '${obj[name]}'.`);
    }

    return integer;
}

export default {
    register
};

function shouldCheckImageAttachments(note: BNote): boolean {
    return (
        note.type === "text" ||
        note.isMarkdown() ||
        note.type === "spreadsheet" ||
        note.type === "canvas" ||
        note.type === "mindMap"
    );
}
