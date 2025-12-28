import becca from "../becca/becca.js";
import utils from "../services/utils.js";
import eu from "./etapi_utils.js";
import mappers from "./mappers.js";
import noteService from "../services/notes.js";
import TaskContext from "../services/task_context.js";
import v from "./validators.js";
import searchService from "../services/search/services/search.js";
import SearchContext from "../services/search/search_context.js";
import zipExportService from "../services/export/zip.js";
import zipImportService from "../services/import/zip.js";
import type { Request, Router } from "express";
import type { ParsedQs } from "qs";
import type { NoteParams } from "../services/note-interface.js";
import type { SearchParams } from "../services/search/services/types.js";
import type { ValidatorMap } from "./etapi-interface.js";
import type { ExportFormat } from "../services/export/zip/abstract_provider.js";

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

    eu.route(router, "get", "/etapi/notes/:noteId", (req, res, next) => {
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
        utcDateCreated: [v.notNull, v.isString, v.isUtcDateTime]
    };

    eu.route(router, "post", "/etapi/create-note", (req, res, next) => {
        const _params = {};
        eu.validateAndPatch(_params, req.body, ALLOWED_PROPERTIES_FOR_CREATE_NOTE);
        const params = _params as NoteParams;

        try {
            const resp = noteService.createNewNote(params);

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
        type: [v.notNull, v.isString],
        mime: [v.notNull, v.isString],
        dateCreated: [v.notNull, v.isString, v.isLocalDateTime],
        utcDateCreated: [v.notNull, v.isString, v.isUtcDateTime]
    };

    eu.route(router, "patch", "/etapi/notes/:noteId", (req, res, next) => {
        const note = eu.getAndCheckNote(req.params.noteId);

        if (note.isProtected) {
            throw new eu.EtapiError(400, "NOTE_IS_PROTECTED", `Note '${req.params.noteId}' is protected and cannot be modified through ETAPI.`);
        }

        noteService.saveRevisionIfNeeded(note);
        eu.validateAndPatch(note, req.body, ALLOWED_PROPERTIES_FOR_PATCH);
        note.save();

        res.json(mappers.mapNoteToPojo(note));
    });

    eu.route(router, "delete", "/etapi/notes/:noteId", (req, res, next) => {
        const { noteId } = req.params;

        const note = becca.getNote(noteId);

        if (!note) {
            return res.sendStatus(204);
        }

        note.deleteNote(null, new TaskContext("no-progress-reporting", "deleteNotes", null));

        res.sendStatus(204);
    });

    eu.route(router, "get", "/etapi/notes/:noteId/content", (req, res, next) => {
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

    eu.route(router, "put", "/etapi/notes/:noteId/content", (req, res, next) => {
        const note = eu.getAndCheckNote(req.params.noteId);

        if (note.isProtected) {
            throw new eu.EtapiError(400, "NOTE_IS_PROTECTED", `Note '${req.params.noteId}' is protected and cannot be modified through ETAPI.`);
        }

        noteService.saveRevisionIfNeeded(note);
        note.setContent(req.body);

        noteService.asyncPostProcessContent(note, req.body);

        return res.sendStatus(204);
    });

    eu.route(router, "get", "/etapi/notes/:noteId/export", (req, res, next) => {
        const note = eu.getAndCheckNote(req.params.noteId);
        const format = req.query.format || "html";

        if (typeof format !== "string" || !["html", "markdown", "share"].includes(format)) {
            throw new eu.EtapiError(400, "UNRECOGNIZED_EXPORT_FORMAT", `Unrecognized export format '${format}', supported values are 'html' (default), 'markdown' or 'share'.`);
        }

        const taskContext = new TaskContext("no-progress-reporting", "export", null);

        // technically a branch is being exported (includes prefix), but it's such a minor difference yet usability pain
        // (e.g. branchIds are not seen in UI), that we export "note export" instead.
        const branch = note.getParentBranches()[0];

        zipExportService.exportToZip(taskContext, branch, format as ExportFormat, res);
    });

    eu.route(router, "post", "/etapi/notes/:noteId/import", (req, res, next) => {
        const note = eu.getAndCheckNote(req.params.noteId);
        const taskContext = new TaskContext("no-progress-reporting", "importNotes", null);

        zipImportService.importZip(taskContext, req.body, note).then((importedNote) => {
            res.status(201).json({
                note: mappers.mapNoteToPojo(importedNote),
                branch: mappers.mapBranchToPojo(importedNote.getParentBranches()[0])
            });
        }); // we need better error handling here, async errors won't be properly processed.
    });

    eu.route(router, "post", "/etapi/notes/:noteId/revision", (req, res, next) => {
        const note = eu.getAndCheckNote(req.params.noteId);

        note.saveRevision();

        return res.sendStatus(204);
    });

    eu.route(router, "get", "/etapi/notes/:noteId/attachments", (req, res, next) => {
        const note = eu.getAndCheckNote(req.params.noteId);
        const attachments = note.getAttachments();

        res.json(attachments.map((attachment) => mappers.mapAttachmentToPojo(attachment)));
    });
}

function parseSearchParams(req: Request) {
    const rawSearchParams: SearchParams = {
        fastSearch: parseBoolean(req.query, "fastSearch"),
        includeArchivedNotes: parseBoolean(req.query, "includeArchivedNotes"),
        ancestorNoteId: parseString(req.query["ancestorNoteId"]),
        ancestorDepth: parseString(req.query["ancestorDepth"]), // e.g. "eq5"
        orderBy: parseString(req.query["orderBy"]),
        // TODO: Check why the order direction was provided as a number, but it's a string everywhere else.
        orderDirection: parseOrderDirection(req.query, "orderDirection") as unknown as string,
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

    const integer = parseInt(obj[name]);

    if (!["asc", "desc"].includes(obj[name])) {
        throw new eu.EtapiError(400, SEARCH_PARAM_ERROR, `Cannot parse order direction value '${obj[name]}, allowed values are 'asc' and 'desc'.`);
    }

    return integer;
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
