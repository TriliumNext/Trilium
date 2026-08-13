import eventService from "../../services/events";

import blobService from "../../services/blob.js";
import * as cls from "../../services/context";
import dateUtils from "../../services/utils/date";
import entityChangesService from "../../services/entity_changes.js";
import { getLog } from "../../services/log.js";
import protectedSessionService from "../../services/protected_session.js";
import becca from "../becca.js";
import type { ConstructorData,default as Becca } from "../becca-interface.js";
import { getSql } from "../../services/sql";
import { concat2, encodeUtf8, unwrapStringOrBuffer, wrapStringOrBuffer } from "../../services/utils/binary";
import { hash, hashedBlobId, newEntityId, randomString } from "../../services/utils";

interface ContentOpts {
    forceSave?: boolean;
    forceFrontendReload?: boolean;
}

/**
 * Base class for all backend entities.
 *
 * @type T the same entity type needed for self-reference in {@link ConstructorData}.
 */
abstract class AbstractBeccaEntity<T extends AbstractBeccaEntity<T>> {
    utcDateModified?: string;
    dateCreated?: string;
    dateModified?: string;

    utcDateCreated!: string;

    isProtected?: boolean;
    isSynced?: boolean;
    blobId?: string;

    /**
     * Virtual entities exist only in becca — they are injected by a virtual note provider
     * (see `services/virtual_notes.ts`), never persisted to the database and never synced.
     * They are read-only: {@link save}, {@link markAsDeleted} and content updates throw.
     */
    isVirtual?: boolean;

    /** @throws Error when this entity is virtual — virtual entities must never touch the database. */
    protected ensureNotVirtual(action: string) {
        if (!this.isVirtual) {
            return;
        }

        const constructorData = this.constructor as unknown as ConstructorData<T>;
        throw new Error(`Cannot ${action} ${constructorData.entityName} '${(this as any)[constructorData.primaryKeyName]}': it is a virtual entity (provided by a virtual note provider) and is read-only.`);
    }

    protected beforeSaving(opts?: {}) {
        const constructorData = this.constructor as unknown as ConstructorData<T>;
        if (!(this as any)[constructorData.primaryKeyName]) {
            (this as any)[constructorData.primaryKeyName] = newEntityId();
        }
    }

    getUtcDateChanged() {
        return this.utcDateModified || this.utcDateCreated;
    }

    protected get becca(): Becca {
        return becca;
    }

    protected putEntityChange(isDeleted: boolean) {
        const constructorData = this.constructor as unknown as ConstructorData<T>;
        entityChangesService.putEntityChange({
            entityName: constructorData.entityName,
            entityId: (this as any)[constructorData.primaryKeyName],
            hash: this.generateHash(isDeleted),
            isErased: false,
            utcDateChanged: this.getUtcDateChanged(),
            isSynced: constructorData.entityName !== "options" || !!this.isSynced
        });
    }

    generateHash(isDeleted?: boolean): string {
        const constructorData = this.constructor as unknown as ConstructorData<T>;
        let contentToHash = "";

        for (const propertyName of constructorData.hashedProperties) {
            contentToHash += `|${(this as any)[propertyName]}`;
        }

        if (isDeleted) {
            contentToHash += "|deleted";
        }

        return hash(contentToHash).substr(0, 10);
    }

    protected getPojoToSave() {
        return this.getPojo();
    }

    hasStringContent(): boolean {
        // Default for entities without binary content; overridden by content-bearing entities
        // (BNote, BRevision, BAttachment) whose content may be binary.
        return true;
    }

    abstract getPojo(): {};

    init() {
        // Do nothing by default, can be overriden in derived classes.
    }

    abstract updateFromRow(row: unknown): void;

    get isDeleted(): boolean {
        // Default for entities without a soft-delete column; overridden by those that have one
        // (BNote, BBranch, BAttribute, BEtapiToken).
        return false;
    }

    /**
     * Saves entity - executes SQL, but doesn't commit the transaction on its own
     */
    save(opts?: {}): this {
        this.ensureNotVirtual("save");

        const constructorData = this.constructor as unknown as ConstructorData<T>;
        const entityName = constructorData.entityName;
        const primaryKeyName = constructorData.primaryKeyName;

        const isNewEntity = !(this as any)[primaryKeyName];

        this.beforeSaving(opts);

        const pojo = this.getPojoToSave();

        const sql = getSql();
        sql.transactional(() => {
            sql.upsert(entityName, primaryKeyName, pojo);

            if (entityName === "recent_notes") {
                return;
            }

            this.putEntityChange(!!this.isDeleted);

            if (!cls.isEntityEventsDisabled()) {
                const eventPayload = {
                    entityName,
                    entity: this
                };

                if (isNewEntity) {
                    eventService.emit(eventService.ENTITY_CREATED, eventPayload);
                }

                eventService.emit(eventService.ENTITY_CHANGED, eventPayload);
            }
        });

        return this;
    }

    protected _setContent(content: string | Uint8Array, opts: ContentOpts = {}) {
        this.ensureNotVirtual("set content of");

        // client code asks to save entity even if blobId didn't change (something else was changed)
        opts.forceSave = !!opts.forceSave;
        opts.forceFrontendReload = !!opts.forceFrontendReload;

        if (content === null || content === undefined) {
            const constructorData = this.constructor as unknown as ConstructorData<T>;
            throw new Error(`Cannot set null content to ${constructorData.primaryKeyName} '${(this as any)[constructorData.primaryKeyName]}'`);
        }

        // Deny oversized content at the point a blob is created. Sync serialises blob content as a single
        // base64 JS string, so content above this threshold can never be synced (it would throw V8's
        // "Cannot create a string longer than 0x1fffffe8"); rejecting it here keeps un-syncable blobs out of
        // the database in the first place. See MAX_BLOB_CONTENT_LENGTH below for how the threshold is derived.
        if (exceedsBlobContentLimit(content)) {
            throw new Error(`Content is too large to store: the maximum is ${MAX_BLOB_CONTENT_LENGTH} bytes (~${Math.round(MAX_BLOB_CONTENT_LENGTH / 1024 / 1024)} MiB), beyond which it can no longer be synchronised.`);
        }

        if (this.hasStringContent()) {
            content = unwrapStringOrBuffer(content);
        } else {
            content = wrapStringOrBuffer(content);
        }

        const unencryptedContentForHashCalculation = this.getUnencryptedContentForHashCalculation(content);

        if (this.isProtected) {
            if (protectedSessionService.isProtectedSessionAvailable()) {
                const encryptedContent = protectedSessionService.encrypt(content);
                if (!encryptedContent) {
                    throw new Error(`Unable to encrypt the content of the entity.`);
                }
                content = encryptedContent;
            } else {
                throw new Error(`Cannot update content of blob since protected session is not available.`);
            }
        }

        getSql().transactional(() => {
            const newBlobId = this.saveBlob(content, unencryptedContentForHashCalculation, opts);
            const oldBlobId = this.blobId;

            if (newBlobId !== oldBlobId || opts.forceSave) {
                this.blobId = newBlobId;
                this.save();

                if (oldBlobId && newBlobId !== oldBlobId) {
                    this.deleteBlobIfNotUsed(oldBlobId);
                }
            }
        });
    }

    private deleteBlobIfNotUsed(oldBlobId: string) {
        const sql = getSql();
        if (sql.getValue("SELECT 1 FROM notes WHERE blobId = ? LIMIT 1", [oldBlobId])) {
            return;
        }

        if (sql.getValue("SELECT 1 FROM attachments WHERE blobId = ? LIMIT 1", [oldBlobId])) {
            return;
        }

        if (sql.getValue("SELECT 1 FROM revisions WHERE blobId = ? LIMIT 1", [oldBlobId])) {
            return;
        }

        sql.execute("DELETE FROM blobs WHERE blobId = ?", [oldBlobId]);
        // blobs are not marked as erased in entity_changes, they are just purged completely
        // this is because technically every keystroke can create a new blob, and there would be just too many
        sql.execute("DELETE FROM entity_changes WHERE entityName = 'blobs' AND entityId = ?", [oldBlobId]);
    }

    private getUnencryptedContentForHashCalculation(unencryptedContent: Uint8Array | string) {
        if (this.isProtected) {
            // a "random" prefix makes sure that the calculated hash/blobId is different for a decrypted/encrypted content
            const encryptedPrefixSuffix = "t$[nvQg7q)&_ENCRYPTED_?M:Bf&j3jr_";
            if (typeof unencryptedContent === "string") {
                return `${encryptedPrefixSuffix}${unencryptedContent}`;
            } else {
                return concat2(encodeUtf8(encryptedPrefixSuffix), unencryptedContent)
            }
        }
        return unencryptedContent;

    }

    private saveBlob(content: string | Uint8Array, unencryptedContentForHashCalculation: string | Uint8Array, opts: ContentOpts = {}) {
        /*
         * We're using the unencrypted blob for the hash calculation, because otherwise the random IV would
         * cause every content blob to be unique which would balloon the database size (esp. with revisioning).
         * This has minor security implications (it's easy to infer that given content is shared between different
         * notes/attachments), but the trade-off comes out clearly positive.
         */
        const newBlobId = hashedBlobId(unencryptedContentForHashCalculation);
        const sql = getSql();
        const blobNeedsInsert = !sql.getValue("SELECT 1 FROM blobs WHERE blobId = ?", [newBlobId]);

        if (!blobNeedsInsert) {
            return newBlobId;
        }

        const pojo = {
            blobId: newBlobId,
            content,
            dateModified: dateUtils.localNowDateTime(),
            utcDateModified: dateUtils.utcNowDateTime()
        };

        sql.upsert("blobs", "blobId", pojo);

        // we can't reuse blobId as an entity_changes hash, because this one has to be calculatable without having
        // access to the decrypted content
        const hash = blobService.calculateContentHash(pojo);

        entityChangesService.putEntityChange({
            entityName: "blobs",
            entityId: newBlobId,
            hash,
            isErased: false,
            utcDateChanged: pojo.utcDateModified,
            isSynced: true,
            // overriding componentId will cause the frontend to think the change is coming from a different component
            // and thus reload
            componentId: opts.forceFrontendReload ? randomString(10) : null
        });

        eventService.emit(eventService.ENTITY_CHANGED, {
            entityName: "blobs",
            entity: this
        });

        return newBlobId;
    }

    protected _getContent(): string | Uint8Array {
        const sql = getSql();
        const row = sql.getRow<{ content: string | Uint8Array }>(/*sql*/`SELECT content FROM blobs WHERE blobId = ?`, [this.blobId]);

        if (!row) {
            const constructorData = this.constructor as unknown as ConstructorData<T>;
            throw new Error(`Cannot find content for ${constructorData.primaryKeyName} '${(this as any)[constructorData.primaryKeyName]}', blobId '${this.blobId}'`);
        }

        return blobService.processContent(row.content, this.isProtected || false, this.hasStringContent()) as string | Uint8Array;
    }

    /**
     * Mark the entity as (soft) deleted. It will be completely erased later.
     *
     * This is a low-level method, for notes and branches use `note.deleteNote()` and 'branch.deleteBranch()` instead.
     */
    markAsDeleted(deleteId: string | null = null) {
        this.ensureNotVirtual("delete");

        const constructorData = this.constructor as unknown as ConstructorData<T>;
        const entityId = (this as any)[constructorData.primaryKeyName];
        const entityName = constructorData.entityName;

        this.utcDateModified = dateUtils.utcNowDateTime();

        const sql = getSql();
        sql.execute(
            /*sql*/`UPDATE ${entityName} SET isDeleted = 1, deleteId = ?, utcDateModified = ?
                            WHERE ${constructorData.primaryKeyName} = ?`,
            [deleteId, this.utcDateModified, entityId]
        );

        if (this.dateModified) {
            this.dateModified = dateUtils.localNowDateTime();

            sql.execute(/*sql*/`UPDATE ${entityName} SET dateModified = ? WHERE ${constructorData.primaryKeyName} = ?`, [this.dateModified, entityId]);
        }

        getLog().info(`Marking ${entityName} ${entityId} as deleted`);

        this.putEntityChange(true);

        eventService.emit(eventService.ENTITY_DELETED, { entityName, entityId, entity: this });
    }

    markAsDeletedSimple() {
        this.ensureNotVirtual("delete");

        const constructorData = this.constructor as unknown as ConstructorData<T>;
        const entityId = (this as any)[constructorData.primaryKeyName];
        const entityName = constructorData.entityName;

        this.utcDateModified = dateUtils.utcNowDateTime();

        const sql = getSql();
        sql.execute(
            /*sql*/`UPDATE ${entityName} SET isDeleted = 1, utcDateModified = ?
                            WHERE ${constructorData.primaryKeyName} = ?`,
            [this.utcDateModified, entityId]
        );

        getLog().info(`Marking ${entityName} ${entityId} as deleted`);

        this.putEntityChange(true);

        eventService.emit(eventService.ENTITY_DELETED, { entityName, entityId, entity: this });
    }
}

export default AbstractBeccaEntity;

/**
 * Maximum byte length of a single blob's content.
 *
 * The sync protocol serialises a blob's content as **one base64 JS string** embedded in a JSON
 * request body (see `sync.ts` `getEntityChangeRow`). Two ceilings bound that encoded form:
 *
 *  1. **V8's maximum string length** — `0x1fffffe8` = 536,870,888 bytes (empirically
 *     `require("buffer").constants.MAX_STRING_LENGTH` on 64-bit). A blob whose base64 form exceeds
 *     it can never be encoded, throwing `Cannot create a string longer than 0x1fffffe8 characters`
 *     and wedging sync — the original motivation for the import size cap (zadam/trilium#3108).
 *  2. **The HTTP JSON body limit** — `express.json({ limit: "500mb" })` in `apps/server/src/app.ts`,
 *     which the *receiving* instance parses every sync push through.
 *
 * base64 inflates by 4/3, so the largest blob whose encoded form clears the **tighter** of the two
 * ceilings — minus headroom for the surrounding JSON envelope (field names, the entity-change
 * metadata, quotes) — is the real limit. With the body limit binding, that lands at ~373 MiB.
 *
 * This replaces the blunt 250 MiB multipart-upload cap, which conflated the size of an *archive*
 * (e.g. a ZIP, whose many entries are each their own blob) with the size of a single blob, and —
 * because it bounded only the *compressed* upload — didn't reliably protect against an oversized
 * blob decompressed out of a small archive anyway.
 */
const V8_MAX_STRING_LENGTH = 536_870_888;
const HTTP_BODY_LIMIT = 500 * 1024 * 1024;
const JSON_ENVELOPE_MARGIN = 2 * 1024 * 1024;

export const MAX_BLOB_CONTENT_LENGTH = Math.floor(((Math.min(V8_MAX_STRING_LENGTH, HTTP_BODY_LIMIT) - JSON_ENVELOPE_MARGIN) * 3) / 4);

/**
 * Whether `content` exceeds {@link MAX_BLOB_CONTENT_LENGTH} once measured the way sync will encode it
 * (UTF-8 bytes for string content, raw bytes for binary). `limit` is injectable for testing.
 */
export function exceedsBlobContentLimit(content: string | Uint8Array, limit = MAX_BLOB_CONTENT_LENGTH): boolean {
    if (typeof content !== "string") {
        return content.length > limit;
    }
    // A UTF-16 code unit encodes to at most 3 UTF-8 bytes (surrogate pairs average 2 bytes/unit), so
    // this cheap upper bound avoids encoding the whole string in the common case; only when it's close
    // to the limit do we pay for an exact measurement.
    if (content.length * 3 <= limit) {
        return false;
    }
    return encodeUtf8(content).length > limit;
}
