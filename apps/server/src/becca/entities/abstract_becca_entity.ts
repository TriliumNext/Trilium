"use strict";

import utils from "../../services/utils.js";
import sql from "../../services/sql.js";
import entityChangesService from "../../services/entity_changes.js";
import eventService from "../../services/events.js";
import dateUtils from "../../services/date_utils.js";
import cls from "../../services/cls.js";
import log from "../../services/log.js";
import protectedSessionService from "../../services/protected_session.js";
import blobService from "../../services/blob.js";
import blobStorageService from "../../services/blob-storage.js";
import type { Blob } from "../../services/blob-interface.js";
import type { default as Becca, ConstructorData } from "../becca-interface.js";
import becca from "../becca.js";
import type { BlobContentLocation } from "@triliumnext/commons";

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

    protected beforeSaving(opts?: {}) {
        const constructorData = this.constructor as unknown as ConstructorData<T>;
        if (!(this as any)[constructorData.primaryKeyName]) {
            (this as any)[constructorData.primaryKeyName] = utils.newEntityId();
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

        return utils.hash(contentToHash).substr(0, 10);
    }

    protected getPojoToSave() {
        return this.getPojo();
    }

    hasStringContent(): boolean {
        // TODO: Not sure why some entities don't implement it.
        return true;
    }

    abstract getPojo(): {};

    init() {
        // Do nothing by default, can be overriden in derived classes.
    }

    abstract updateFromRow(row: unknown): void;

    get isDeleted(): boolean {
        // TODO: Not sure why some entities don't implement it.
        return false;
    }

    /**
     * Saves entity - executes SQL, but doesn't commit the transaction on its own
     */
    save(opts?: {}): this {
        const constructorData = this.constructor as unknown as ConstructorData<T>;
        const entityName = constructorData.entityName;
        const primaryKeyName = constructorData.primaryKeyName;

        const isNewEntity = !(this as any)[primaryKeyName];

        this.beforeSaving(opts);

        const pojo = this.getPojoToSave();

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

    protected _setContent(content: string | Buffer, opts: ContentOpts = {}) {
        // client code asks to save entity even if blobId didn't change (something else was changed)
        opts.forceSave = !!opts.forceSave;
        opts.forceFrontendReload = !!opts.forceFrontendReload;

        if (content === null || content === undefined) {
            const constructorData = this.constructor as unknown as ConstructorData<T>;
            throw new Error(`Cannot set null content to ${constructorData.primaryKeyName} '${(this as any)[constructorData.primaryKeyName]}'`);
        }

        if (this.hasStringContent()) {
            content = content.toString();
        } else {
            content = Buffer.isBuffer(content) ? content : Buffer.from(content);
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

        sql.transactional(() => {
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
        if (sql.getValue("SELECT 1 FROM notes WHERE blobId = ? LIMIT 1", [oldBlobId])) {
            return;
        }

        if (sql.getValue("SELECT 1 FROM attachments WHERE blobId = ? LIMIT 1", [oldBlobId])) {
            return;
        }

        if (sql.getValue("SELECT 1 FROM revisions WHERE blobId = ? LIMIT 1", [oldBlobId])) {
            return;
        }

        const row = sql.getRow<{ contentLocation: string }>("SELECT contentLocation FROM blobs WHERE blobId = ?", [oldBlobId]);
        if (row?.contentLocation.startsWith('file://')) {
            try {
                const filePath = row.contentLocation.replace('file://', '');
                blobStorageService.deleteExternal(filePath);
            } catch (error) {
                log.error(`Failed to delete external content file ${row.contentLocation}: ${error}`);
            }
        }

        sql.execute("DELETE FROM blobs WHERE blobId = ?", [oldBlobId]);
        // blobs are not marked as erased in entity_changes, they are just purged completely
        // this is because technically every keystroke can create a new blob, and there would be just too many
        sql.execute("DELETE FROM entity_changes WHERE entityName = 'blobs' AND entityId = ?", [oldBlobId]);
    }

    private getUnencryptedContentForHashCalculation(unencryptedContent: Buffer | string) {
        if (this.isProtected) {
            // a "random" prefix makes sure that the calculated hash/blobId is different for a decrypted/encrypted content
            const encryptedPrefixSuffix = "t$[nvQg7q)&_ENCRYPTED_?M:Bf&j3jr_";
            return Buffer.isBuffer(unencryptedContent) ? Buffer.concat([Buffer.from(encryptedPrefixSuffix), unencryptedContent]) : `${encryptedPrefixSuffix}${unencryptedContent}`;
        } else {
            return unencryptedContent;
        }
    }

    private saveBlob(content: string | Buffer, unencryptedContentForHashCalculation: string | Buffer, opts: ContentOpts = {}) {
        /*
         * We're using the unencrypted blob for the hash calculation, because otherwise the random IV would
         * cause every content blob to be unique which would balloon the database size (esp. with revisioning).
         * This has minor security implications (it's easy to infer that given content is shared between different
         * notes/attachments), but the trade-off comes out clearly positive.
         */
        const newBlobId = utils.hashedBlobId(unencryptedContentForHashCalculation);
        const blobNeedsInsert = !sql.getValue("SELECT 1 FROM blobs WHERE blobId = ?", [newBlobId]);

        if (!blobNeedsInsert) {
            return newBlobId;
        }

        // Check if we should store this blob externally
        const shouldStoreExternally = blobStorageService.shouldStoreExternally(content);

        let contentLocation: BlobContentLocation = 'internal';

        if (shouldStoreExternally) {
            try {
                const filePath = blobStorageService.saveExternal(newBlobId, content);
                contentLocation = `file://${filePath}` as BlobContentLocation;
            } catch (error) {
                log.error(`Failed to store blob ${newBlobId} externally, falling back to internal storage: ${error}`);
                contentLocation = 'internal';
            }
        }

        const contentLength = blobService.getContentLength(content);

        const pojo = {
            blobId: newBlobId,
            content: contentLocation === 'internal' ? content : null,
            contentLocation,
            contentLength,
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
            hash: hash,
            isErased: false,
            utcDateChanged: pojo.utcDateModified,
            isSynced: true,
            // overriding componentId will cause the frontend to think the change is coming from a different component
            // and thus reload
            componentId: opts.forceFrontendReload ? utils.randomString(10) : null
        });

        eventService.emit(eventService.ENTITY_CHANGED, {
            entityName: "blobs",
            entity: this
        });

        return newBlobId;
    }

    protected _getContent(): string | Buffer {
        const row = sql.getRow<{ content: string | Buffer, contentLocation: string }>(/*sql*/`SELECT content, contentLocation FROM blobs WHERE blobId = ?`, [this.blobId]);

        if (!row) {
            const constructorData = this.constructor as unknown as ConstructorData<T>;
            throw new Error(`Cannot find content for ${constructorData.primaryKeyName} '${(this as any)[constructorData.primaryKeyName]}', blobId '${this.blobId}'`);
        }

        const content = blobStorageService.getContent(row);

        return blobService.processContent(content, this.isProtected || false, this.hasStringContent());
    }

    /**
     * Mark the entity as (soft) deleted. It will be completely erased later.
     *
     * This is a low-level method, for notes and branches use `note.deleteNote()` and 'branch.deleteBranch()` instead.
     */
    markAsDeleted(deleteId: string | null = null) {
        const constructorData = this.constructor as unknown as ConstructorData<T>;
        const entityId = (this as any)[constructorData.primaryKeyName];
        const entityName = constructorData.entityName;

        this.utcDateModified = dateUtils.utcNowDateTime();

        sql.execute(
            /*sql*/`UPDATE ${entityName} SET isDeleted = 1, deleteId = ?, utcDateModified = ?
                            WHERE ${constructorData.primaryKeyName} = ?`,
            [deleteId, this.utcDateModified, entityId]
        );

        if (this.dateModified) {
            this.dateModified = dateUtils.localNowDateTime();

            sql.execute(/*sql*/`UPDATE ${entityName} SET dateModified = ? WHERE ${constructorData.primaryKeyName} = ?`, [this.dateModified, entityId]);
        }

        log.info(`Marking ${entityName} ${entityId} as deleted`);

        this.putEntityChange(true);

        eventService.emit(eventService.ENTITY_DELETED, { entityName, entityId, entity: this });
    }

    markAsDeletedSimple() {
        const constructorData = this.constructor as unknown as ConstructorData<T>;
        const entityId = (this as any)[constructorData.primaryKeyName];
        const entityName = constructorData.entityName;

        this.utcDateModified = dateUtils.utcNowDateTime();

        sql.execute(
            /*sql*/`UPDATE ${entityName} SET isDeleted = 1, utcDateModified = ?
                            WHERE ${constructorData.primaryKeyName} = ?`,
            [this.utcDateModified, entityId]
        );

        log.info(`Marking ${entityName} ${entityId} as deleted`);

        this.putEntityChange(true);

        eventService.emit(eventService.ENTITY_DELETED, { entityName, entityId, entity: this });
    }
}

export default AbstractBeccaEntity;
