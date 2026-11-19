import {
    assignHeadingIds, type CachedTocResponse, getBlobTag, getTocCacheTitle, MAX_TOC_HEADINGS,
    MAX_TOC_TITLE_LENGTH, normalizeTocTitle, type PendingToc, type ReferenceParams,
    type ReferenceTarget, TOC_CACHE_TITLE, TOC_CACHE_VERSION, type TocCache,
    type TocConflictResponse, type TocHeading, type TocOutlineHeading, type TocOutlineItem
} from "@triliumnext/commons";

import becca from "../../becca/becca.js";
import BAttachment from "../../becca/entities/battachment.js";
import type BNote from "../../becca/entities/bnote.js";
import {
    ConflictError, ContentNotAvailableError, DetailedConflictError, ValidationError
} from "../../errors.js";
import { getContext } from "../context.js";
import { getLog } from "../log.js";
import { whenDatabaseFree } from "../platform.js";
import { getSql } from "../sql/index.js";
import { decodeUtf8 } from "../utils/binary.js";
import { epubTocFormat, type TocPassOutcome } from "./epub.js";
import { docxTocFormat, odtTocFormat } from "./office.js";
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
    /**
     * What the log line names for an `error` of the generator, in place of its name and message:
     * never text that the file holds.
     */
    describeFailure?(error: unknown): string;
    /**
     * Reads the documents of the format on every platform, for a format that core can parse. A
     * generator that the platform registers under the format's name takes precedence.
     */
    generator?: TocGenerator;
    /** `html`, the preview of a document of the format, with the ids of its headings written in. */
    markPreview?(html: string, source: TocPreviewSource): Promise<string>;
    /** The targets of `cache` other than its headings, which the lists show after them. */
    getOtherTargets?(cache: TocCache<H>): ReferenceTarget[];
}

/** Reads the table of contents of a document. Runs outside a transaction and must not write. */
export type TocGenerator = (content: Uint8Array | string) => Promise<GeneratedToc>;

/** What a generator reads: the headings without ids, and the properties of the format. */
export interface GeneratedToc {
    /** In document order: `title`, `level` and the fields of the format. */
    headings: Record<string, unknown>[];
    properties?: Record<string, unknown>;
    /** Whether the reader stopped at `MAX_TOC_HEADINGS` before another heading with a title. */
    isCut?: boolean;
}

/** The document whose preview a format marks: the blob that was converted, and its protection. */
export interface TocPreviewSource {
    blobId: string;
    isProtected: boolean;
    /** The content of the blob, which the preview was converted from. */
    content: string | Uint8Array;
    /** What the ToC pass of an EPUB did, for the preview that is marked. */
    tocPass?: TocPassOutcome;
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

const formats: TocFormat[] = [ pdfTocFormat, docxTocFormat, odtTocFormat, epubTocFormat ];
const generators = new Map<string, TocGenerator>();
/** The documents that can never be read, by format, document and blob. */
const permanentFailures = new Set<string>();
/** The builds that run, by format, document and blob. */
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

/** The format of the note or attachment `entity`, if it has a table of contents. */
export function getTocFormatOf(entity: BNote | BAttachment) {
    // An attachment of the role `file` reads like a note of the type `file`.
    const type = entity instanceof BAttachment ? entity.role : entity.type;
    return findTocFormat(type, entity.mime);
}

/**
 * The ids of `outline`, headings with normalized titles in document order, read from the blob
 * `blobId`. The cache and the marking of a preview compute them alike.
 */
export function getHeadingIds(
    outline: TocOutlineItem[], blobId: string, isProtected: boolean, isCut: boolean
) {
    return assignHeadingIds(outline, getBlobTag(blobId), isProtected, { isCut });
}

/**
 * Turns the nesting depths of the entries that an outline keeps, passed in document order, into
 * levels: an entry is one level below the nearest kept entry before it with a smaller depth. An
 * entry that is not kept is never passed, so the entries under it nest as if it were absent. The
 * generators and the reference listing compute levels alike.
 */
export function createLevelTracker() {
    const depths: number[] = [];
    return (depth: number) => {
        while ((depths.at(-1) ?? -Infinity) >= depth) {
            depths.pop();
        }
        depths.push(depth);
        return depths.length;
    };
}

/** `html`, the preview of a document of `format`, with the ids of its headings when it has any. */
export async function markTocHeadings(
    format: TocFormat | undefined, html: string, source: TocPreviewSource
) {
    return format?.markPreview ? await format.markPreview(html, source) : html;
}

/**
 * The table of contents of the document `ref`: from its cache when the cache is valid, else read
 * and saved. Throws `NotFoundError` when the document is gone, `ContentNotAvailableError` when its
 * content is not available, and `ConflictError` when it changed during two builds in a row.
 *
 * Never call it inside a transaction that stays open across an `await`, such as an `asyncRoute`
 * on standalone: the save of a build waits for that transaction to end.
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
 * The ToC cache of the document `ref`, built when this platform can read its format. Throws as
 * `getToc()` does.
 */
export async function buildToc(ref: TocDocumentRef): Promise<CachedTocResponse> {
    const result = await getToc(ref);
    if (!result) {
        return { status: "none" };
    }
    switch (result.status) {
        case "ready":
            return toReadyResponse(result.cache, result.format);
        case "client":
            // Only a viewer can read the format here: `pendingToc`, with the stale cache.
            return readCachedToc(ref);
        case "unreadable":
            return { status: "unreadable" };
    }
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
    if (getGenerator(document.format)) {
        throw new ValidationError(
            `The server reads the table of contents of the ${describe(ref)}.`);
    }

    const { targetBlobHash, headings, properties, isCut, elapsedMs } = parseClientRequest(request);
    if (targetBlobHash !== document.entity.blobId) {
        const message = `The ${describe(ref)} changed since its table of contents was read.`;
        throw new DetailedConflictError<TocConflictResponse>(message, {
            reason: "changed", message
        });
    }

    const { attachments, valid } = findCacheAttachment(document);
    if (valid) {
        return toReadyResponse(valid.cache, document.format);
    }

    const cache = assembleCache(document, targetBlobHash, headings, properties, isCut);
    if (!cache) {
        throw new ValidationError(`The table of contents of the ${describe(ref)} is not valid.`);
    }
    saveCache(document, cache, attachments[0], elapsedMs);
    return toReadyResponse(cache, document.format);
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
        return toReadyResponse(valid.cache, document.format);
    }

    const pending: { pendingToc?: PendingToc } = getGenerator(document.format)
        ? {}
        : { pendingToc: { format: document.format.name } };
    const stale = findNewestCache(attachments, document.format);
    if (!stale) {
        return { status: "missing", ...pending };
    }
    const headings = toOutlineHeadings(stale.headings, document.format);
    return { status: "stale", blobId: stale.targetBlobHash, headings, ...pending };
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

    const generator = getGenerator(format);
    if (!generator) {
        return { status: "client", format };
    }

    // A blob keeps its id when only the MIME type changes, so the format is part of the key.
    const blobId = String(entity.blobId);
    const key = `${format.name}:${describe(ref)}:${blobId}`;
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
    const cache = assembleCache(
        document, blobId, generated.headings, generated.properties, !!generated.isCut);
    if (!cache) {
        getLog().error(`Failed to read the ToC of ${describe(ref)}: `
            + `The generator of '${format.name}' read an invalid table of contents.`);
        return { status: "unreadable" };
    }

    // On standalone an import can hold the connection by now; a save inside it would be rolled
    // back with it, and its entity changes would never reach the clients.
    const isSaved = await whenDatabaseFree(() => getContext().init(() =>
        getSql().transactional(() => saveBuild(ref, format, blobId, cache, elapsedMs))));
    return isSaved ? { status: "ready", cache, format } : STALE;
}

/**
 * Saves `cache`, read from the blob `blobId`, unless the document `ref` changed meanwhile, and
 * tells whether the cache is still the document's.
 */
function saveBuild(
    ref: TocDocumentRef, format: TocFormat, blobId: string, cache: TocCache, elapsedMs: number
) {
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
}

/**
 * Logs a failed read. A failure that `format` calls permanent is remembered for the format,
 * document and blob in `key`; any other one is read again at the next request.
 */
function handleFailure(ref: TocDocumentRef, format: TocFormat, key: string, error: unknown) {
    const name = error instanceof Error ? error.name : String(error);
    if (format.isPermanentFailure(error)) {
        if (permanentFailures.size >= MAX_REMEMBERED_FAILURES) {
            const [ oldest ] = permanentFailures;
            permanentFailures.delete(oldest);
        }
        permanentFailures.add(key);
        const description = format.describeFailure?.(error) ?? name;
        getLog().info(`Failed to read the ToC of ${describe(ref)}: ${description}`);
    } else {
        const message = error instanceof Error ? `: ${error.message}` : "";
        const description = format.describeFailure?.(error) ?? `${name}${message}`;
        getLog().error(`Failed to read the ToC of ${describe(ref)}: ${description}`);
    }
    return { status: "unreadable" } as const;
}

/** The generator that reads `format` on this platform: a registered one, else its own. */
function getGenerator(format: TocFormat) {
    return generators.get(format.name) ?? format.generator;
}

/** The document of `ref` with its format, or `null` when it has none. Throws when it is gone. */
function resolveDocument(ref: TocDocumentRef): TocDocument | null {
    if (ref.kind === "note") {
        const note = becca.getNoteOrThrow(ref.noteId);
        const format = getTocFormatOf(note);
        const owner = note.isVirtual ? null : note;
        return format ? { ref, entity: note, format, owner, cacheTitle: getTocCacheTitle() } : null;
    }

    const attachment = becca.getAttachmentOrThrow(ref.attachmentId);
    const format = getTocFormatOf(attachment);
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
        throw new ContentNotAvailableError(`The ${describe(ref)} has no content available.`);
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
 * of the headings, or `null` when they are not a table of contents of its format. `isCut` tells
 * that the reader stopped at `MAX_TOC_HEADINGS`.
 */
function assembleCache(
    { entity, format }: TocDocument, blobId: string, headings: unknown, properties: unknown,
    isCut: boolean
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

    const ids = getHeadingIds(outline, blobId, !!entity.isProtected, isCut);
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
    const { targetBlobHash, headings, properties, isCut, elapsedMs } =
        isRecord(request) ? request : {};
    if (typeof targetBlobHash !== "string" || !Array.isArray(headings)
        || (properties !== undefined && !isRecord(properties))
        || (isCut !== undefined && typeof isCut !== "boolean")
        || typeof elapsedMs !== "number" || !Number.isFinite(elapsedMs) || elapsedMs < 0) {
        throw new ValidationError("Expected the 'targetBlobHash', the 'headings' and the "
            + "'elapsedMs' of a table of contents.");
    }
    return { targetBlobHash, headings, properties, isCut: isCut === true, elapsedMs };
}

function toReadyResponse(cache: TocCache, format: TocFormat): CachedTocResponse {
    const headings = toOutlineHeadings(cache.headings, format);
    return { status: "ready", blobId: cache.targetBlobHash, headings };
}

/** `headings` with the parameters of a link to each, for those that a link can reach. */
function toOutlineHeadings(headings: TocHeading[], format: TocFormat): TocOutlineHeading[] {
    return headings.map((heading) => {
        const params = format.getLinkParams(heading);
        return params ? { ...heading, params } : heading;
    });
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
