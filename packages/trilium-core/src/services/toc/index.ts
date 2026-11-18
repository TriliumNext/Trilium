import {
    assignHeadingIds, type CachedTocResponse, getBlobTag, getTocCacheTitle, MAX_TOC_HEADINGS,
    MAX_TOC_TITLE_LENGTH, normalizeTocTitle, type PendingToc, type ReferenceParams,
    TOC_CACHE_TITLE, TOC_CACHE_VERSION, type TocCache, type TocConflictResponse,
    type TocHeading
} from "@triliumnext/commons";

import becca from "../../becca/becca.js";
import BAttachment from "../../becca/entities/battachment.js";
import type BNote from "../../becca/entities/bnote.js";
import { ConflictError, DetailedConflictError, ValidationError } from "../../errors.js";
import { getLog } from "../log.js";
import { getSql } from "../sql/index.js";
import { decodeUtf8 } from "../utils/binary.js";
import pdfTocFormat from "./pdf.js";

/** Names a document whose table of contents is kept: a note, or an attachment of a note. */
export type TocDocumentRef =
    | { kind: "note"; noteId: string }
    | { kind: "attachment"; attachmentId: string };

/** A kind of document whose table of contents is kept in a ToC cache. */
export interface TocFormat<H extends TocHeading = TocHeading> {
    /** Names the format: the key of its properties in a cache, and of its generator. */
    name: string;
    isFor(type: string, mime: string): boolean;
    /** Whether the properties of the format in `cache` are exactly those of the current reader. */
    isCurrent(cache: TocCache<H>): boolean;
    /** The link parameters that point at `heading`, none when a link cannot. */
    getLinkParams(heading: H): ReferenceParams | undefined;
    /** The fields of the format of a heading that was read, checked. `null` refuses them. */
    parseHeadingFields(raw: Record<string, unknown>): Omit<H, keyof TocHeading> | null;
    /** Whether `error` means that the file can never be read, so it is not read again. */
    isPermanentFailure(error: unknown): boolean;
}

/** Reads the table of contents of a document. Runs outside a transaction and must not write. */
export type TocGenerator = (content: Uint8Array | string) => Promise<GeneratedToc>;

/** What a generator reads: the headings without ids, and the properties of the format. */
export interface GeneratedToc {
    /** In document order: `title`, `level` and the fields of the format. */
    headings: Record<string, unknown>[];
    properties?: Record<string, unknown>;
}

/** What `getToc()` answers. `null`: the document has no table of contents format. */
export type TocResult =
    | { status: "ready"; cache: TocCache; format: TocFormat }
    /** The viewer of the document builds the cache, since this platform cannot read it. */
    | { status: "client"; format: TocFormat }
    | { status: "unreadable" }
    | null;

/** The role of the attachments that hold a ToC cache. */
export const TOC_CACHE_ROLE = "tocCache";

/** How many documents that cannot be read are remembered, so that they are not read again. */
const MAX_REMEMBERED_FAILURES = 1_000;

const formats: TocFormat[] = [ pdfTocFormat ];
const generators = new Map<string, TocGenerator>();
/** The documents that can never be read, by document and blob. */
const permanentFailures = new Set<string>();
/** The builds that run, by document and blob. */
const builds = new Map<string, Promise<TocResult | typeof STALE>>();
/** What a build answers when its document changed before it could save. */
const STALE = Symbol("stale");

/** Lets this platform read the documents of the format `formatName` itself. */
export function registerTocGenerator(formatName: string, generator: TocGenerator) {
    generators.set(formatName, generator);
}

export function unregisterTocGenerator(formatName: string) {
    generators.delete(formatName);
}

/** The format of the documents of `type` and `mime`, if they have a table of contents. */
export function findTocFormat(type: string, mime: string) {
    return formats.find((format) => format.isFor(type, mime));
}

/**
 * The table of contents of the document `ref`: from its cache when the cache is valid, else read
 * and saved. Throws `NotFoundError` when the document is gone, `ValidationError` when its content
 * is not available, and `ConflictError` when it changed during two builds in a row.
 */
export async function getToc(ref: TocDocumentRef): Promise<TocResult> {
    for (let attempt = 0; attempt < 2; attempt++) {
        const result = await readOrBuild(ref);
        if (result !== STALE) {
            return result;
        }
    }
    throw new ConflictError(`The ${describe(ref)} changed while its table of contents was read.`);
}

/**
 * Saves the table of contents that the viewer of the document `ref` read, unless the document has
 * a valid cache already, and returns the cache. Only for a platform that cannot read the format.
 */
export function saveClientToc(ref: TocDocumentRef, request: unknown): CachedTocResponse {
    const document = resolveDocument(ref);
    if (!document) {
        throw new ValidationError(`The ${describe(ref)} has no table of contents.`);
    }
    requireContent(document);
    if (generators.has(document.format.name)) {
        throw new ValidationError(
            `The server reads the table of contents of the ${describe(ref)}.`);
    }

    const { targetBlobHash, headings, properties, elapsedMs } = parseClientRequest(request);
    if (targetBlobHash !== document.entity.blobId) {
        const message = `The ${describe(ref)} changed since its table of contents was read.`;
        throw new DetailedConflictError<TocConflictResponse>(message, {
            reason: "changed", message
        });
    }

    const { attachments, valid } = findCacheAttachment(document);
    if (valid) {
        return toReadyResponse(valid.cache);
    }

    const cache = assembleCache(document, targetBlobHash, headings, properties);
    if (!cache) {
        throw new ValidationError(`The table of contents of the ${describe(ref)} is not valid.`);
    }
    saveCache(document, cache, attachments[0], elapsedMs);
    return toReadyResponse(cache);
}

/** The ToC cache of the document `ref` as it is, without building or saving anything. */
export function readCachedToc(ref: TocDocumentRef): CachedTocResponse {
    const document = resolveDocument(ref);
    if (!document) {
        return { status: "none" };
    }
    requireContent(document);

    const { attachments, valid } = findCacheAttachment(document);
    if (valid) {
        return toReadyResponse(valid.cache);
    }

    const pending: { pendingToc?: PendingToc } = generators.has(document.format.name)
        ? {}
        : { pendingToc: { format: document.format.name } };
    const stale = findNewestCache(attachments, document.format);
    return stale
        ? { status: "stale", blobId: stale.targetBlobHash, headings: stale.headings, ...pending }
        : { status: "missing", ...pending };
}

/** A document of a ToC format, as read from the database. */
interface TocDocument {
    ref: TocDocumentRef;
    entity: BNote | BAttachment;
    format: TocFormat;
    /** The note that keeps the cache: `null` for an attachment of a revision or a virtual note. */
    owner: BNote | null;
    cacheTitle: string;
}

/** The cache attachments of a document, and the one every reader uses. */
interface CacheLookup {
    /** By attachment id. */
    attachments: BAttachment[];
    /** The valid cache with the smallest attachment id. */
    valid?: { attachment: BAttachment; cache: TocCache };
}

async function readOrBuild(ref: TocDocumentRef): Promise<TocResult | typeof STALE> {
    const document = resolveDocument(ref);
    if (!document) {
        return null;
    }
    requireContent(document);

    const { format, entity } = document;
    const { valid } = findCacheAttachment(document);
    if (valid) {
        return { status: "ready", cache: valid.cache, format };
    }

    const generator = generators.get(format.name);
    if (!generator) {
        return { status: "client", format };
    }

    const blobId = String(entity.blobId);
    const key = `${describe(ref)}:${blobId}`;
    if (permanentFailures.has(key)) {
        return { status: "unreadable" };
    }

    const running = builds.get(key);
    if (running) {
        return running;
    }
    const build = runBuild(document, generator, blobId, key).finally(() => builds.delete(key));
    builds.set(key, build);
    return build;
}

async function runBuild(
    document: TocDocument, generator: TocGenerator, blobId: string, key: string
): Promise<TocResult | typeof STALE> {
    const { ref, format, entity } = document;
    const started = performance.now();
    let generated: GeneratedToc;
    try {
        generated = await generator(entity.getContent());
    } catch (error) {
        return handleFailure(ref, format, key, error);
    }
    const elapsedMs = performance.now() - started;
    const cache = assembleCache(document, blobId, generated.headings, generated.properties);
    if (!cache) {
        const error = new Error(
            `The generator of '${format.name}' read an invalid table of contents.`);
        return handleFailure(ref, format, key, error);
    }

    const isSaved = getSql().transactional(() => {
        const live = resolveLiveDocument(ref);
        if (!live || live.entity.blobId !== blobId || live.format !== format
            || !live.entity.isContentAvailable()) {
            return false;
        }
        // Another request can have saved a cache for this blob since this one looked.
        const current = findCacheAttachment(live);
        if (!current.valid) {
            saveCache(live, cache, current.attachments[0], elapsedMs);
        }
        return true;
    });
    return isSaved ? { status: "ready", cache, format } : STALE;
}

/**
 * Logs a failed read. A failure that `format` calls permanent is remembered for the document and
 * blob in `key`; any other one is read again at the next request.
 */
function handleFailure(ref: TocDocumentRef, format: TocFormat, key: string, error: unknown) {
    const name = error instanceof Error ? error.name : String(error);
    if (format.isPermanentFailure(error)) {
        if (permanentFailures.size >= MAX_REMEMBERED_FAILURES) {
            const [ oldest ] = permanentFailures;
            permanentFailures.delete(oldest);
        }
        permanentFailures.add(key);
        getLog().info(`Failed to read the ToC of ${describe(ref)}: ${name}`);
    } else {
        const message = error instanceof Error ? `: ${error.message}` : "";
        getLog().error(`Failed to read the ToC of ${describe(ref)}: ${name}${message}`);
    }
    return { status: "unreadable" } as const;
}

/** The document of `ref` with its format, or `null` when it has none. Throws when it is gone. */
function resolveDocument(ref: TocDocumentRef): TocDocument | null {
    if (ref.kind === "note") {
        const note = becca.getNoteOrThrow(ref.noteId);
        const format = findTocFormat(note.type, note.mime);
        const owner = note.isVirtual ? null : note;
        return format ? { ref, entity: note, format, owner, cacheTitle: getTocCacheTitle() } : null;
    }

    const attachment = becca.getAttachmentOrThrow(ref.attachmentId);
    // An attachment of the role `file` reads like a note of the type `file`.
    const format = findTocFormat(attachment.role, attachment.mime);
    const note = becca.getNote(attachment.ownerId);
    const owner = note && !note.isVirtual ? note : null;
    const cacheTitle = getTocCacheTitle(ref.attachmentId);
    return format ? { ref, entity: attachment, format, owner, cacheTitle } : null;
}

/**
 * The document of `ref` as it is now, or `null` when it is gone or has no format any more. The
 * request that reads it again reports why.
 */
function resolveLiveDocument(ref: TocDocumentRef) {
    try {
        return resolveDocument(ref);
    } catch {
        return null;
    }
}

function requireContent({ ref, entity }: TocDocument) {
    if (!entity.isContentAvailable()) {
        throw new ValidationError(`The ${describe(ref)} has no content available.`);
    }
}

/** Every cache attachment of `document` and the one that every reader uses. Never writes. */
function findCacheAttachment(document: TocDocument): CacheLookup {
    const attachments = (document.owner?.getAttachmentsByRole(TOC_CACHE_ROLE) ?? [])
        .filter((attachment) => attachment.title === document.cacheTitle)
        .sort((a, b) => compareIds(String(a.attachmentId), String(b.attachmentId)));
    for (const attachment of attachments) {
        const cache = readCache(attachment, document.format);
        if (cache && cache.targetBlobHash === document.entity.blobId) {
            return { attachments, valid: { attachment, cache } };
        }
    }
    return { attachments };
}

/** The most recently saved cache of `attachments` that is valid for any blob. */
function findNewestCache(attachments: BAttachment[], format: TocFormat) {
    const newestFirst = attachments.toSorted((a, b) =>
        compareIds(String(b.utcDateModified), String(a.utcDateModified))
        || compareIds(String(a.attachmentId), String(b.attachmentId)));
    for (const attachment of newestFirst) {
        const cache = readCache(attachment, format);
        if (cache) {
            return cache;
        }
    }
    return null;
}

/** The cache that `attachment` holds, if it passes every check but that of its blob. */
function readCache(attachment: BAttachment, format: TocFormat): TocCache | null {
    let cache: unknown;
    try {
        const content: string | Uint8Array = attachment.getContent();
        cache = JSON.parse(typeof content === "string" ? content : decodeUtf8(content));
    } catch {
        return null;
    }

    return isCache(cache) && cache.version === TOC_CACHE_VERSION && format.isCurrent(cache)
        ? cache
        : null;
}

function isCache(value: unknown): value is TocCache {
    if (!isRecord(value)) {
        return false;
    }
    const { targetBlobHash, headings } = value;
    return typeof targetBlobHash === "string" && Array.isArray(headings)
        && headings.every((heading) => isRecord(heading) && typeof heading.id === "string"
            && typeof heading.title === "string" && isLevel(heading.level));
}

/**
 * The cache of `headings` and `properties` read from the blob `blobId` of `document`, with the ids
 * of the headings, or `null` when they are not a table of contents of its format.
 */
function assembleCache(
    { entity, format }: TocDocument, blobId: string, headings: unknown, properties: unknown
): TocCache | null {
    if (!Array.isArray(headings) || headings.length > MAX_TOC_HEADINGS
        || (properties !== undefined && !isRecord(properties))) {
        return null;
    }

    const outline: { title: string; level: number; fields: object }[] = [];
    for (const heading of headings) {
        const previousLevel = outline.at(-1)?.level ?? 0;
        if (!isRecord(heading) || typeof heading.title !== "string"
            || heading.title.length > MAX_TOC_TITLE_LENGTH || !isLevel(heading.level)
            || heading.level > previousLevel + 1) {
            return null;
        }
        const fields = format.parseHeadingFields(heading);
        if (!fields) {
            return null;
        }
        outline.push({ title: normalizeTocTitle(heading.title), level: heading.level, fields });
    }

    const ids = assignHeadingIds(outline, getBlobTag(blobId), !!entity.isProtected);
    const cache: TocCache = {
        version: TOC_CACHE_VERSION,
        targetBlobHash: blobId,
        headings: outline.map(({ title, level, fields }, index) =>
            ({ id: ids[index], title, level, ...fields })),
        ...(properties === undefined ? {} : { [format.name]: properties })
    };
    return format.isCurrent(cache) ? cache : null;
}

/**
 * Writes `cache` into the cache attachment `existing`, or into a new one, deletes the other caches
 * of its title and the caches of attachments that the note no longer has, and logs it.
 */
function saveCache(
    { ref, owner, cacheTitle }: TocDocument, cache: TocCache, existing: BAttachment | undefined,
    elapsedMs: number
) {
    if (!owner) {
        return;
    }

    const content = JSON.stringify(cache);
    const attachment = existing ?? new BAttachment({
        ownerId: owner.noteId,
        role: TOC_CACHE_ROLE,
        mime: "application/json",
        title: cacheTitle,
        isProtected: owner.isProtected
    });
    attachment.setContent(content, { forceSave: !existing });
    sweep(owner, cacheTitle, attachment.attachmentId);

    const verb = existing ? "Updated" : "Created";
    getLog().info(`${verb} ToC cache for ${describe(ref)}. `
        + `Found ${cache.headings.length} headings in ${Math.round(elapsedMs)} ms.`);
}

/** Deletes the other caches of `title`, and the caches of attachments `owner` no longer has. */
function sweep(owner: BNote, title: string, keptAttachmentId: string | undefined) {
    const attachmentIds = new Set(owner.getAttachments().map(({ attachmentId }) => attachmentId));
    const satelliteSuffix = `.${TOC_CACHE_TITLE}`;
    for (const attachment of owner.getAttachmentsByRole(TOC_CACHE_ROLE)) {
        if (attachment.attachmentId === keptAttachmentId) {
            continue;
        }
        const isSatellite = attachment.title.endsWith(satelliteSuffix);
        const documentId = attachment.title.slice(0, -satelliteSuffix.length);
        const isOrphan = attachment.title !== TOC_CACHE_TITLE
            && !(isSatellite && attachmentIds.has(documentId));
        if (attachment.title === title || isOrphan) {
            attachment.markAsDeleted();
        }
    }
}

function parseClientRequest(request: unknown) {
    const { targetBlobHash, headings, properties, elapsedMs } = isRecord(request) ? request : {};
    if (typeof targetBlobHash !== "string" || !Array.isArray(headings)
        || (properties !== undefined && !isRecord(properties))
        || typeof elapsedMs !== "number" || !Number.isFinite(elapsedMs) || elapsedMs < 0) {
        throw new ValidationError("Expected the 'targetBlobHash', the 'headings' and the "
            + "'elapsedMs' of a table of contents.");
    }
    return { targetBlobHash, headings, properties, elapsedMs };
}

function toReadyResponse(cache: TocCache): CachedTocResponse {
    return { status: "ready", blobId: cache.targetBlobHash, headings: cache.headings };
}

/** Names the document in a log line or an error message: its kind and id, never its title. */
function describe(ref: TocDocumentRef) {
    return ref.kind === "note" ? `note '${ref.noteId}'` : `attachment '${ref.attachmentId}'`;
}

function compareIds(a: string, b: string) {
    return a < b ? -1 : a > b ? 1 : 0;
}

function isLevel(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
