import type { Locale } from "./i18n.js";
import { AttachmentRow, AttributeRow, BranchRow, NoteRow, NoteType, OptionRow, RevisionSource } from "./rows.js";

type Response = {
    success: true,
    message?: string;
} | {
    success: false;
    message: string;
}

export interface AppInfo {
    appVersion: string;
    dbVersion: number;
    nodeVersion?: string;
    syncVersion: number;
    buildDate: string;
    buildRevision: string;
    dataDirectory?: string;
    clipperProtocolVersion: string;
    /** for timezone inference */
    utcDateTime: string;
}

export interface DeleteNotesPreview {
    noteIdsToBeDeleted: string[];
    brokenRelations: AttributeRow[];
}

export interface RevisionItem {
    noteId: string;
    revisionId?: string;
    dateCreated?: string;
    contentLength?: number;
    type: NoteType;
    title: string;
    description?: string;
    source?: RevisionSource;
    isProtected?: boolean;
    mime: string;
}

export interface RevisionPojo {
    revisionId?: string;
    noteId: string;
    type: NoteType;
    mime: string;
    isProtected?: boolean;
    title: string;
    description?: string;
    source?: RevisionSource;
    blobId?: string;
    dateLastEdited?: string;
    dateCreated?: string;
    utcDateLastEdited?: string;
    utcDateCreated?: string;
    utcDateModified?: string;
    content?: string | Uint8Array;
    contentLength?: number;
}

/**
 * How far "Erase excess revision snapshots" should go. Both fields are optional: left out, the
 * operation behaves exactly as the automatic trimming that runs after every saved revision.
 */
export interface EraseExcessRevisionsOptions {
    /**
     * How many snapshots to keep per note, standing in for the `revisionSnapshotNumberLimit` option
     * for this run. Negative keeps every snapshot (nothing is excess), zero keeps none; omitted
     * falls back to the option itself.
     *
     * A note carrying a valid `#versioningLimit` follows its own label instead: that is a policy set
     * on the note deliberately, and a one-off answer to the global setting does not overrule it.
     */
    snapshotsToKeep?: number;
    /**
     * Spares named snapshots — those the user gave a description — from erasure, and leaves them
     * out of the count as well, so the limit governs the automatic snapshots alone. Omitted, it
     * falls back to the `revisionIgnoreNamedSnapshots` option.
     */
    keepNamedSnapshots?: boolean;
}

export interface EraseExcessRevisionsResponse {
    /** Snapshots actually erased, across every note the operation visited. */
    erasedCount: number;
}

export interface RecentChangeRow {
    noteId: string;
    current_isDeleted: boolean;
    current_deleteId: string;
    current_title: string;
    current_isProtected: boolean;
    title: string;
    utcDate: string;
    date: string;
    canBeUndeleted?: boolean;
}

export interface BulkActionAffectedNotes {
    affectedNoteCount: number;
}

export interface DatabaseCheckIntegrityResponse {
    results: {
        integrity_check: string;
    }[];
}

/**
 * What rebuilding the database file gave back, measured either side of the vacuum. Erasing content
 * does not shrink the file — the pages it frees stay allocated on the freelist — so this difference
 * is the only figure that says what the disk actually got back.
 */
export interface VacuumDatabaseResponse {
    /** The database's size in bytes before the rebuild, free pages included. */
    sizeBefore: number;
    sizeAfter: number;
}

export interface CompactionEstimateResponse {
    /**
     * Bytes a rebuild would return, from the pages already free inside the file. A floor rather than
     * a promise: a rebuild also recovers the slack left inside pages still in use.
     */
    reclaimableBytes: number;
    /**
     * What the database occupies now, free pages included. Rebuilding writes a fresh copy of it
     * before replacing the original, so this is also the headroom the operation wants while it runs.
     */
    databaseBytes: number;
}

export interface DatabaseAnonymizeResponse {
    success: boolean;
    anonymizedFilePath: string;
}

export interface AnonymizedDbResponse {
    filePath: string;
    fileName: string;
    mtime: Date;
    /** Size of the anonymized database file, in bytes. */
    fileSize: number;
}

export interface ExistingAnonymizedDatabasesResponse {
    /** The directory where the anonymized databases are stored. */
    anonymizedFolderPath: string;
    databases: AnonymizedDbResponse[];
}

export type SyncTestResponse = Response;

export interface EtapiToken {
    name: string;
    utcDateCreated: string;
    etapiTokenId?: string;
}

export interface PostTokensResponse {
    authToken: string;
}

export interface BackupDatabaseNowResponse {
    backupFile: string;
}

export interface DatabaseBackup {
    fileName: string;
    filePath: string;
    mtime: Date;
    /** Size of the backup file, in bytes. */
    fileSize: number;
    /**
     * Whether the backup is gzip-compressed. Absent for a plain database copy, and for a container
     * whose header could not be read.
     */
    compressed?: boolean;
    /** Whether the backup is encrypted. Absent under the same conditions as {@link compressed}. */
    encrypted?: boolean;
    /**
     * Size of the wrapped database before compression, in bytes, as recorded by the writer. Absent
     * for a plain copy, where the file size already says it.
     */
    plaintextSize?: number;
}

export interface ExistingBackupsResponse {
    /** The directory where the backups are stored, or null if there is no user-accessible location (e.g. OPFS on standalone). */
    backupFolderPath: string | null;
    backups: DatabaseBackup[];
}

export type ChangePasswordResponse = Response;

export interface TOTPStatus {
    set: boolean;
}

export interface TOTPGenerate {
    success: boolean;
    /** The bare base32 secret, shown for manual entry. */
    message: string;
    /** The `otpauth://` URL for the secret, rendered as a scannable QR code. Absent on failure. */
    url?: string;
}

export interface TOTPVerifyResponse {
    /** Whether the submitted code was valid for the secret. Verification persists nothing on its own. */
    success: boolean;
    /** Freshly issued (not yet persisted) recovery codes, returned only on success for the user to save. */
    recoveryCodes?: string[];
}

export interface TOTPEnableResponse {
    /** Whether the secret and recovery codes were committed, activating TOTP. */
    success: boolean;
}

export interface TOTPRecoveryKeysResponse {
    success: boolean;
    recoveryCodes?: string[];
    keysExist?: boolean;
    usedRecoveryCodes?: string[];
}

export interface OAuthStatus {
    /** Whether OAuth is the active login method (configured *and* an account has been enrolled). */
    enabled: boolean;
    /** Whether the owner has bound their provider identity to this instance (enrollment complete). */
    enrolled?: boolean;
    name?: string;
    email?: string;
    missingVars?: string[];
    /** The configured provider's display name (`oauthIssuerName`); empty when unset. */
    issuerName?: string;
    /** The configured provider's issuer base URL (`oauthIssuerBaseUrl`). */
    issuerUrl?: string;
    /** The configured provider's icon URL (`oauthIssuerIcon`); empty when unset. */
    issuerIcon?: string;
}

// Interface for the Ollama model response
export interface OllamaModelResponse {
    success: boolean;
    models: Array<{
        name: string;
        model: string;
        details?: {
            family?: string;
            parameter_size?: string;
        }
    }>;
}


export interface OpenAiOrAnthropicModelResponse {
    success: boolean;
    chatModels: Array<{
        id: string;
        name: string;
        type: string;
    }>;
}

export type ToggleInParentResponse = {
    success: true;
} | {
    success: false;
    message: string;
}

export type EditedNotesResponse = {
    noteId: string;
    isDeleted: boolean;
    title?: string;
    notePath?: string[] | null;
}[];

export interface MetadataResponse {
    dateCreated: string | undefined;
    utcDateCreated: string;
    dateModified: string | undefined;
    utcDateModified: string | undefined;
}

export interface NoteSizeResponse {
    noteSize: number;
}

export interface SubtreeSizeResponse {
    subTreeNoteCount: number;
    subTreeSize: number;
}

/**
 * How far an on-demand image compression run should go. Every field is optional, and what is left
 * out falls back to the corresponding option — so an empty request compresses exactly the way the
 * automatic import-time shrinking would, only without needing that shrinking to be enabled.
 *
 * Unlike the `compressImages` option, this is always a deliberate act by the user on one note or
 * one image, so it runs whether or not automatic compression is switched on.
 */
/** The three things that can become of a lossless image; see {@link ImageCompressionOptions}. */
export const IMAGE_PNG_HANDLINGS = [ "keep", "optimize", "jpeg" ] as const;

export type ImagePngHandling = (typeof IMAGE_PNG_HANDLINGS)[number];

/** The two things that can become of an already-lossy image; see {@link ImageCompressionOptions}. */
export const IMAGE_JPEG_HANDLINGS = [ "keep", "compress" ] as const;

export type ImageJpegHandling = (typeof IMAGE_JPEG_HANDLINGS)[number];

/**
 * The formats a compression run can act on at all. Named once and read by both the encoder that
 * enforces it and the inventory that reports against it, so the two cannot come to disagree about
 * which images are worth offering to compress.
 */
export const IMAGE_COMPRESSIBLE_FORMATS = [ "jpg", "png" ] as const;

export type ImageCompressibleFormat = (typeof IMAGE_COMPRESSIBLE_FORMATS)[number];

/**
 * What one image is, read from its own bytes.
 *
 * Every measurement is nullable and null means one thing throughout: the format does not state it,
 * or the file is too damaged to. Nothing here is a default standing in for something unread.
 */
export interface ImageInfoResponse {
    entityType: "note" | "attachment";
    entityId: string;
    title: string;
    /** The mime it is stored under, which is not always what the bytes turn out to say. */
    mime: string;
    /** What the bytes say it is: "jpg", "png", "gif", "webp", "bmp", "svg", "unknown". */
    format: string;
    /** The mime that format implies, for comparing against {@link mime}. */
    detectedMime: string;
    /** Bytes on disk. */
    size: number;
    width: number | null;
    height: number | null;
    /** Bits per channel — 8 for almost everything, 16 for a deep PNG. */
    bitDepth: number | null;
    /** Channels per pixel: 1 greyscale or indexed, 3 colour, 4 colour with alpha or CMYK. */
    channels: number | null;
    /** Whether the format stores an alpha channel; not whether any pixel actually uses it. */
    hasAlpha: boolean | null;
    /** Stored as a palette rather than colour per pixel — already quantized, in other words. */
    indexed: boolean | null;
    /** For a JPEG, the quality it appears to have been written at; null for anything else. */
    quality: number | null;
    /** Whether a compression run could act on it at all. */
    compressible: boolean;
}

/** A count of images and what they weigh between them. */
export interface ImageInventoryTally {
    count: number;
    /** Bytes, summed over the images counted. */
    size: number;
}

export interface ImageInventoryFormat extends ImageInventoryTally {
    /** Read from the content rather than the mime: "jpg", "png", "gif", "webp", "bmp", "svg". */
    format: string;
}

/**
 * What images a note holds, and what compressing them could reach.
 *
 * Measured over exactly the images a compression run with the same `recursive` setting would visit,
 * so the two never describe different sets — see `getNoteImageInventory`.
 */
export interface ImageInventoryResponse {
    /** The note the reading was taken on, so a caller need not look it up to name it. */
    title: string;
    /** How many notes it covered: the note alone, or it and its descendants when descending. */
    noteCount: number;
    /** Every image found, whatever its format. */
    total: ImageInventoryTally;
    /**
     * Those a run could actually act on: a supported format, and not one of the generated pictures
     * a canvas or spreadsheet note keeps, which are rebuilt on save and so left alone.
     */
    compressible: ImageInventoryTally;
    /** Compressible images whose longest edge exceeds {@link maxWidthHeight}. */
    oversized: ImageInventoryTally;
    /** Every format found, heaviest first. */
    formats: ImageInventoryFormat[];
    /**
     * The formats among which at least one image could actually be compressed, in the same order.
     *
     * Narrower than filtering {@link formats} by what the encoder supports: a note whose only PNG is
     * the picture it regenerates on save holds a PNG that nothing will act on, and offering to
     * configure one would be offering a setting with nothing to apply it to.
     */
    compressibleFormats: ImageCompressibleFormat[];
    /** What {@link oversized} was measured against. */
    maxWidthHeight: number;
    /** Images whose content could not be read — protected, with no session open. Counted nowhere else. */
    unreadable: number;
}

export interface ImageCompressionOptions {
    /**
     * Whether an image larger than {@link maxWidthHeight} is scaled down to fit. On its own this
     * reaches only oversized images; one already within the bound is left exactly as it is.
     *
     * Defaults to on, as does {@link reencode}: the endpoint is only ever invoked deliberately, and
     * a request that asked for compression and got a no-op would be the surprising answer.
     */
    resize?: boolean;
    /** Longest edge in pixels. Omitted, it falls back to the `imageMaxWidthHeight` option. */
    maxWidthHeight?: number;
    /**
     * What is done with an image that is *already* lossy — a JPEG:
     *
     * - `keep` leaves its encoding alone. Scaling still has to write a JPEG back, but at a quality
     *   high enough not to be a further deliberate degradation.
     * - `compress` recompresses it at {@link quality}, whatever its size. It costs quality every
     *   time it runs, on an image that has already paid that cost once.
     *
     * Says nothing about lossless sources, which is {@link pngHandling}'s to answer: squeezing the
     * JPEGs harder is no reason to stop a PNG being a PNG. Defaults to `compress`.
     */
    jpegHandling?: ImageJpegHandling;
    /**
     * What is done with a lossless image — a PNG. Only ever one of the three, since a PNG either
     * survives as it is, survives smaller, or stops being a PNG:
     *
     * - `keep` leaves it entirely alone; scaling is then the only thing that can reach it.
     * - `optimize` reduces it to a palette and writes it back as a PNG. Lossy, but gently so — the
     *   saving comes from storing an index per pixel rather than 24-bit colour — and it keeps the
     *   alpha channel, so it reaches transparent images too.
     * - `jpeg` re-encodes it as a JPEG at {@link conversionQuality}, which usually saves the most
     *   but costs the format. A transparent image cannot be converted, JPEG having no alpha channel
     *   to keep it in, so it is optimized instead: the best that can be done for it.
     *
     * Defaults to `optimize`, the choice that shrinks an image without changing what it is.
     */
    pngHandling?: ImagePngHandling;
    /**
     * JPEG quality, 10 to 100, used when recompressing an image that is *already* lossy — so only
     * where {@link jpegHandling} is `compress`. A JPEG merely being scaled is written back at a
     * near-lossless quality of the implementation's own instead, `keep` meaning what it says.
     *
     * Omitted, it falls back to the `imageJpegQuality` option (75 by default).
     */
    quality?: number;
    /**
     * JPEG quality, 10 to 100, used when converting a lossless image — {@link pngHandling} of
     * `jpeg` — rather than when recompressing one that was lossy already.
     *
     * Its own setting because the two are not the same trade. Converting is a one-time transition
     * away from a pristine original, where every byte of quality given up is detail that genuinely
     * was there; recompressing works on an image that has already been through an encoder once, so
     * spending quality on it largely buys back nothing. Defaults higher than {@link quality}
     * accordingly.
     */
    conversionQuality?: number;
    /**
     * Whether the run visits the note's whole subtree rather than the note alone. Off by default,
     * and opt-in for a reason: a descendant may be a clone, so compressing it degrades an image
     * that other notes show too.
     *
     * Each note is visited once however many placements it has. Archived notes are included, the
     * hidden subtree is not, and a search note's results are left to whatever holds them — the run
     * follows the tree, not what a query happens to match.
     *
     * Only the note endpoint reads this; an attachment has no subtree to descend into.
     */
    recursive?: boolean;
    /**
     * Names a task to report progress against, so a caller watching a long run can be told how far
     * it has got. Left out, the run reports only when it finishes.
     */
    taskId?: string;
}

/**
 * Why a particular image was left exactly as it was. Every image the run visited is reported, so
 * "nothing happened" always comes with the reason it didn't.
 */
export type ImageCompressionSkipReason =
    /** Not a format that can be recompressed — SVG, an unrecognised buffer, GIF, WebP, BMP … */
    | "unsupported-format"
    /** Animated (APNG, animated GIF/WebP): recompressing would flatten it to a single frame. */
    | "animated"
    /** The rendered picture of a canvas/mermaid/mind map/spreadsheet note, regenerated on save. */
    | "generated"
    /** Protected, with no protected session open to decrypt it. */
    | "protected"
    /**
     * Nothing was asked of this image that would change it — an image within the bound with
     * re-encoding off, or both switched off — or compressing it produced nothing smaller.
     */
    | "no-gain"
    /** This build has no image compression at all (the standalone/WASM runtime). */
    | "unsupported-platform"
    /**
     * Too many pixels to decode within the memory a single image is allowed. Read off the header,
     * so the image is refused before the attempt rather than after it has failed part-way.
     */
    | "too-large"
    /**
     * The image was replaced while it was being re-encoded — by another request, or by a
     * synchronisation update — so the result was derived from content that no longer exists. Writing
     * it would have put the superseded picture back; the newer one is kept instead.
     */
    | "changed"
    /**
     * The run was called off before reaching this image. Nothing was read and nothing weighed, so
     * it reports no size — it is here to be counted, so that a run stopped half way says so rather
     * than reporting the part it did as the whole.
     */
    | "cancelled"
    /** Compression failed; the original was kept and the failure logged. */
    | "error";

/** One image visited by a compression run, whether or not it ended up compressed. */
export interface ImageCompressionItem {
    entityType: "note" | "attachment";
    /** The `noteId` of an image note, or the `attachmentId` of an image attachment. */
    entityId: string;
    title: string;
    /** The mime after the run: the new one when compressed, the untouched one otherwise. */
    mime: string;
    originalSize: number;
    /** Equal to {@link originalSize} whenever the image was left alone. */
    newSize: number;
    compressed: boolean;
    /** Present exactly when {@link compressed} is false. */
    skipReason?: ImageCompressionSkipReason;
}

export interface ImageCompressionResponse {
    /** Every image the run visited, skipped ones included, in the order they were visited. */
    items: ImageCompressionItem[];
    compressedCount: number;
    skippedCount: number;
    /** Summed over {@link items}, so skipped images weigh the same on both sides. */
    originalSize: number;
    newSize: number;
    /** `originalSize - newSize`; never negative, an image is only replaced when it got smaller. */
    savedSize: number;
}

/**
 * The size components of a single note. Revisions are always reported separately so a client can
 * include or exclude them without another request.
 */
export interface SpaceUsageSizes {
    /** Size of the note's own body. */
    ownSize: number;
    /** Combined size of the attachments owned by the note. */
    attachmentsSize: number;
    /** Combined size of the note's revisions, including attachments owned by those revisions. */
    revisionsSize: number;
}

export interface SpaceUsageOverviewNote extends SpaceUsageSizes {
    noteId: string;
    /**
     * Note IDs from a top-level note down to this note, following each note's canonical placement
     * (see the space usage service); the root itself is omitted.
     */
    notePath: string[];
}

/** An aggregate over notes that are not listed individually. */
export interface SpaceUsageBucket {
    /** Note bodies plus attachments; revisions are in {@link revisionsSize}. */
    size: number;
    revisionsSize: number;
    noteCount: number;
}

/**
 * Space still held by deleted entities whose blobs have not been erased yet.
 *
 * {@link size} covers all of them at once — deleted notes, deleted attachments (whose owning note
 * may well be alive) and the history of deleted notes — so it is reported alongside both counts:
 * either one on its own reads as the whole story, and neither is.
 */
export interface SpaceUsageDeletedNotes {
    size: number;
    /** Deleted notes whose body blob still exists; erased notes no longer count. */
    noteCount: number;
    /** Deleted attachments whose blob still exists, however their owning note is doing. */
    attachmentCount: number;
}

/**
 * Space held by attachments a live note still owns but no longer references from its content —
 * an image or file inserted and then removed. Saving the note schedules those for erasure, and the
 * scheduled cleanup erases them once `eraseUnusedAttachmentsAfterSeconds` has passed.
 *
 * Every scheduled attachment counts, not only those already past that delay, so the figure is what
 * erasing unused attachments *now* would remove.
 */
export interface SpaceUsageUnusedAttachments {
    /**
     * What erasing them would actually reclaim: their blobs, counted once, minus any still held by
     * a live note body, a still-referenced attachment or a revision.
     */
    size: number;
    /** Attachments scheduled for erasure, whether or not something else shares their content. */
    attachmentCount: number;
}

/**
 * What the live content actually occupies — every blob referenced by a live note, attachment or
 * revision, hidden subtree included, counted once however many entities share it through
 * deduplication. The breakdown attributes each blob to exactly one tier — bodies first, then
 * attachments, then revisions — so the parts sum to {@link size} and each reads as "the space only
 * this category holds". The per-note numbers elsewhere intentionally count per entity instead, so
 * a note's reported size never depends on duplicates elsewhere.
 */
export interface SpaceUsageContent {
    /** The whole live content; the "database size" figure. */
    size: number;
    /** Live notes, hidden ones included. */
    noteCount: number;
    /** Space only note-owned attachments hold: their blobs minus those shared with note bodies. */
    attachmentsSize: number;
    /** Space only revisions hold (snapshot attachments included): their blobs minus those shared
     *  with live bodies or live attachments. */
    revisionsSize: number;
}

export interface SpaceUsageOverviewResponse {
    content: SpaceUsageContent;
    /** The largest notes first, ranked by body + attachments (+ revisions when requested). */
    notes: SpaceUsageOverviewNote[];
    /** The remaining notes of the visible tree, below the ranking cutoff. */
    otherNotes: SpaceUsageBucket;
    /** Notes reachable only through the hidden subtree, plus any note not reachable at all. */
    hiddenNotes: SpaceUsageBucket;
    deletedNotes: SpaceUsageDeletedNotes;
    unusedAttachments: SpaceUsageUnusedAttachments;
    /** Every note of the visible tree: {@link notes} and {@link otherNotes} combined. */
    total: SpaceUsageBucket;
}

export interface SpaceUsageChild {
    noteId: string;
    /** Bodies plus attachments of the child's whole canonical subtree; revisions are left out. */
    subtreeSize: number;
    subtreeNoteCount: number;
}

export interface SpaceUsageAttachment {
    attachmentId: string;
    title: string;
    role: string;
    size: number;
}

export interface SpaceUsageNoteResponse extends SpaceUsageSizes {
    noteId: string;
    /**
     * What the note alone actually occupies — body, attachments and revisions, each shared blob
     * counted once. Smaller than the per-entity components sum whenever revisions still share the
     * note's blob or attachments repeat content.
     */
    noteContentSize: number;
    /** Like {@link noteContentSize}, over the note's whole canonical subtree. */
    subtreeContentSize: number;
    /**
     * An estimate of what trimming the subtree's history would reclaim: blobs held only by the
     * snapshots that would go, each counted once, and none that a live body, a note attachment or a
     * surviving snapshot still shares. Tiered like the database-wide figure, so the two are
     * comparable — unlike the per-entity {@link revisionsSize}, which counts a shared snapshot at
     * every entity holding it.
     *
     * How far that trimming goes is the request's own {@link EraseExcessRevisionsOptions}: by
     * default every snapshot goes, which is the whole history. The limit asked for stands for every
     * note at once, so a note whose `#versioningLimit` keeps more than that frees less than this
     * figure allows for — an estimate reading high, not a promise.
     */
    subtreeRevisionsContentSize: number;
    attachments: SpaceUsageAttachment[];
    /** Canonical children only: a cloned child is listed under its canonical parent alone. */
    children: SpaceUsageChild[];
    /** Only present on the root, deleted notes having no place in the tree. */
    deletedNotes?: SpaceUsageDeletedNotes;
    /** Only present on the root: a database-wide figure, like the deleted one beside it. */
    unusedAttachments?: SpaceUsageUnusedAttachments;
}

export interface SimilarNote {
    score: number;
    notePath: string[];
    noteId: string;
}

export type SimilarNoteResponse = SimilarNote[];

export type SaveSearchNoteResponse = CloneResponse;

export interface CloneResponse {
    success: boolean;
    message?: string;
    branchId?: string;
    notePath?: string;
}

export interface ConvertToAttachmentResponse {
    attachment: AttachmentRow;
}

export interface ConvertAttachmentToNoteResponse {
    note: NoteRow;
    branch: BranchRow;
}

export type SaveSqlConsoleResponse = CloneResponse;

export type SaveLlmChatResponse = CloneResponse;

export interface BacklinkCountResponse {
    count: number;
}

export type BacklinksResponse = ({
    noteId: string;
    relationName: string;
} | {
    noteId: string;
    excerpts: string[]
})[];


export type SqlExecuteResults = (object[] | object)[];

export interface SqlExecuteResponse {
    success: boolean;
    error?: string;
    results: SqlExecuteResults;
}

export interface CreateChildrenResponse {
    note: NoteRow;
    branch: BranchRow;
}

export interface SchemaResponse {
    name: string;
    columns: {
        name: string;
        type: string;
    }[];
}

export interface RelationMapRelation {
    name: string;
    attributeId: string;
    sourceNoteId: string;
    targetNoteId: string;
}

export interface RelationMapPostResponse {
    noteTitles: Record<string, string>;
    relations: RelationMapRelation[];
    inverseRelations: Record<string, string>;
}

export interface NoteMapLink {
    key: string;
    sourceNoteId: string;
    targetNoteId: string;
    name: string;
}

/** A note of a map, kept as a tuple rather than an object: a map carries thousands of them. */
export type NoteMapNote = [ noteId: string, title: string, type: string, color: string | null, icon: string ];

export interface NoteMapPostResponse {
    notes: NoteMapNote[];
    links: NoteMapLink[];
    noteIdToDescendantCountMap: Record<string, number>;
}

export interface UpdateAttributeResponse {
    attributeId: string;
}

export interface RenderMarkdownResponse {
    htmlContent: string;
}

export interface ToMarkdownResponse {
    markdownContent: string;
}

export interface TextRepresentationResponse {
    success: boolean;
    text: string;
    hasOcr: boolean;
    message?: string;
}

export interface OCRProcessResponse {
    success: boolean;
    message?: string;
    result?: {
        text: string;
        confidence: number;
        extractedAt: string;
        language?: string;
        pageCount?: number;
        processingType?: string;
    };
    /** The minimum confidence threshold that was applied (0-1 scale). */
    minConfidence?: number;
}

export interface IconRegistry {
    sources: {
        prefix: string;
        name: string;
        /** An icon class to identify this icon pack. */
        icon: string;
        icons: {
            id: string;
            terms: string[];
        }[]
    }[];
}

/**
 * Bootstrap items that the client needs to start up. These are sent by the server in the HTML and made available as `window.glob`.
 */
export type BootstrapDefinition = {
    dbInitialized: boolean;
    /**
     * Whether a sync that has already created the database schema was interrupted
     * before finishing (schema exists but the `initialized` flag is not yet set).
     * Only meaningful while `dbInitialized` is `false`; the setup screen uses it to
     * jump straight back to the sync-in-progress step and resume the sync on restart.
     */
    syncInProgress?: boolean;
    /**
     * Whether a password has been set yet. `false` only in the pre-auth window
     * after the database is initialized but before the user has set a password,
     * which the client uses to render the set-password screen. Omitted (treated
     * as set) for the regular authenticated payload.
     */
    passwordSet?: boolean;
    /**
     * Whether the current session is authenticated. `false` only in the pre-auth
     * window when a password is set but the user hasn't logged in (web/server only),
     * which the client uses to render the login screen. Omitted (treated as logged
     * in) for the regular authenticated payload.
     */
    loggedIn?: boolean;
    /** Login-screen configuration, present only alongside `loggedIn: false`. */
    login?: {
        /** Whether single sign-on (OpenID) is enabled — shows the SSO button instead of the password form. */
        ssoEnabled: boolean;
        ssoIssuerName?: string;
        ssoIssuerIcon?: string;
        /** Whether a TOTP second factor is required. */
        totpEnabled: boolean;
        /** One-shot SSO error from a failed OIDC round-trip ("wrong_account" / "not_enrolled"). */
        ssoError?: string | false;
        /**
         * One-shot flag set when the OIDC provider couldn't be reached at all during an
         * unauthenticated round-trip, so the login screen can explain the bounce back. Deliberately
         * a boolean: the technical detail stays in the server log rather than being exposed pre-auth.
         */
        ssoConnectionFailed?: boolean;
    };
    baseApiUrl: string;
    assetPath: string;
    theme: string;
    themeBase?: "next" | "next-light" | "next-dark";
    customThemeCssUrl?: string;
    iconPackCss: string;
    iconRegistry: IconRegistry;
    device: "mobile" | "desktop" | "print" | false;
    csrfToken?: string;
    headingStyle: "plain" | "underline" | "markdown";
    layoutOrientation: "vertical" | "horizontal";
    platform?: "aix" | "android" | "darwin" | "freebsd" | "haiku" | "linux" | "openbsd" | "sunos" | "win32" | "cygwin" | "netbsd" | "web";
    isElectron: boolean;
    isStandalone: boolean;
    /**
     * Absolute URL prefix for the WebSocket (e.g. `ws://127.0.0.1:8080/`),
     * sent by the desktop app because the renderer page lives on the
     * `trilium-app://` custom protocol where `window.location` no longer
     * encodes a reachable WS host. Undefined for the regular web build,
     * where the WS URL can still be derived from `window.location`.
     */
    wsBaseUrl?: string;
    /**
     * Absolute base URL of the local HTTP server (e.g. `http://127.0.0.1:37840`),
     * sent by the desktop app because the renderer page lives on the
     * `trilium-app://` custom protocol where `window.location` does not point
     * at a reachable HTTP origin. Used to display copy-pasteable endpoints
     * (such as the MCP URL) that external clients connect to over loopback.
     * Undefined for the regular web build, where `window.location` already
     * encodes the reachable HTTP origin.
     */
    httpBaseUrl?: string;
    hasNativeTitleBar: boolean;
    hasBackgroundEffects: boolean;
    maxEntityChangeIdAtLoad?: number;
    maxEntityChangeSyncIdAtLoad?: number;
    instanceName: string | null;
    appCssNoteIds: string[];
    isDev: boolean;
    isMainWindow: boolean;
    isProtectedSessionAvailable: boolean;
    triliumVersion: string;
    appPath: string;
    currentLocale: Locale;
    isRtl: boolean;
    TRILIUM_SAFE_MODE: boolean;
    componentId?: string;
    /**
     * True for exactly one bootstrap after the owner binds their OAuth account, letting the client show a
     * one-shot "account connected" toast once the post-enrollment redirect lands on the app root.
     */
    oauthJustEnrolled?: boolean;
    /**
     * Set for exactly one bootstrap after an OAuth round-trip failed to reach the provider at all,
     * letting the client explain the bounce back to the app root with a one-shot error toast. Carries
     * the technical reason (e.g. `fetch failed ← caused by: self-signed certificate
     * [DEPTH_ZERO_SELF_SIGNED_CERT]`), shown verbatim in monospace; non-empty whenever present.
     */
    oauthConnectionFailed?: string;
};

/**
 * Response for /api/setup/status.
 */
export interface SetupStatusResponse {
    syncVersion: number;
    schemaExists: boolean;
}

/**
 * Response for /api/setup/sync-seed.
 */
export interface SetupSyncSeedResponse {
    syncVersion: number;
    options: OptionRow[];
}

export type SetupSyncFromServerResponse = {
    result: "success";
} | {
    result: "failure";
    error: string;
}

export interface NetworkAddressesResponse {
    /** Reachable URLs (protocol + host + port) other devices can sync with. */
    addresses: string[];
    /**
     * Whether this host is bound to a network-reachable interface. `false` when
     * it only listens on loopback, in which case the advertised addresses can't
     * actually be reached by another device.
     */
    reachableOnNetwork: boolean;
}

export type ScriptParams = any[];
