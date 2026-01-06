import type { BranchRow } from "@triliumnext/commons";
import type { EntityChange } from "@triliumnext/commons";
import { becca_loader, utils } from "@triliumnext/core";

import becca from "../becca/becca.js";
import BBranch from "../becca/entities/bbranch.js";
import eraseService from "../services/erase.js";
import noteTypesService from "../services/note_types.js";
import { hashedBlobId, randomString } from "../services/utils.js";
import cls from "./cls.js";
import entityChangesService from "./entity_changes.js";
import log from "./log.js";
import optionsService from "./options.js";
import sanitizeAttributeName from "./sanitize_attribute_name.js";
import sql from "./sql.js";
import sqlInit from "./sql_init.js";
import syncMutexService from "./sync_mutex.js";
import ws from "./ws.js";
const noteTypes = noteTypesService.getNoteTypeNames();

class ConsistencyChecks {
    private autoFix: boolean;
    private unrecoveredConsistencyErrors: boolean;
    private fixedIssues: boolean;
    private reloadNeeded: boolean;

    /**
     * @param autoFix - automatically fix all encountered problems. False is only for debugging during development (fail fast)
     */
    constructor(autoFix: boolean) {
        this.autoFix = autoFix;
        this.unrecoveredConsistencyErrors = false;
        this.fixedIssues = false;
        this.reloadNeeded = false;
    }

    findAndFixIssues(query: string, fixerCb: (res: any) => void) {
        const results = sql.getRows(query);

        for (const res of results) {
            try {
                sql.transactional(() => fixerCb(res));

                if (this.autoFix) {
                    this.fixedIssues = true;
                } else {
                    this.unrecoveredConsistencyErrors = true;
                }
            } catch (e: any) {
                logError(`Fixer failed with ${e.message} ${e.stack}`);
                this.unrecoveredConsistencyErrors = true;
            }
        }

        return results;
    }

    checkTreeCycles() {
        const childToParents: Record<string, string[]> = {};
        const rows = sql.getRows<BranchRow>("SELECT noteId, parentNoteId FROM branches WHERE isDeleted = 0");

        for (const row of rows) {
            const childNoteId = row.noteId;
            const parentNoteId = row.parentNoteId;

            childToParents[childNoteId] = childToParents[childNoteId] || [];
            childToParents[childNoteId].push(parentNoteId);
        }

        /** @returns true if cycle was found and we should try again */
        const checkTreeCycle = (noteId: string, path: string[]) => {
            if (noteId === "root") {
                return false;
            }

            for (const parentNoteId of childToParents[noteId]) {
                if (path.includes(parentNoteId)) {
                    if (this.autoFix) {
                        const branch = becca.getBranchFromChildAndParent(noteId, parentNoteId);
                        if (branch) {
                            branch.markAsDeleted("cycle-autofix");
                            logFix(`Branch '${branch.branchId}' between child '${noteId}' and parent '${parentNoteId}' has been deleted since it was causing a tree cycle.`);
                        }

                        return true;
                    }
                    logError(`Tree cycle detected at parent-child relationship: '${parentNoteId}' - '${noteId}', whole path: '${path}'`);

                    this.unrecoveredConsistencyErrors = true;

                } else {
                    const newPath = path.slice();
                    newPath.push(noteId);

                    const retryNeeded = checkTreeCycle(parentNoteId, newPath);

                    if (retryNeeded) {
                        return true;
                    }
                }
            }

            return false;
        };

        const noteIds = Object.keys(childToParents);

        for (const noteId of noteIds) {
            const retryNeeded = checkTreeCycle(noteId, []);

            if (retryNeeded) {
                return true;
            }
        }

        return false;
    }

    checkAndRepairTreeCycles() {
        let treeFixed = false;

        while (this.checkTreeCycles()) {
            // fixing cycle means deleting branches, we might need to create a new branch to recover the note
            this.findExistencyIssues();

            treeFixed = true;
        }

        if (treeFixed) {
            this.reloadNeeded = true;
        }
    }

    findBrokenReferenceIssues() {
        this.findAndFixIssues(
            `
                    SELECT branchId, branches.noteId
                    FROM branches
                    LEFT JOIN notes USING (noteId)
                    WHERE branches.isDeleted = 0
                    AND notes.noteId IS NULL`,
            ({ branchId, noteId }) => {
                if (this.autoFix) {
                    const branch = becca.getBranch(branchId);
                    if (!branch) {
                        return;
                    }
                    branch.markAsDeleted();

                    this.reloadNeeded = true;

                    logFix(`Branch '${branchId}' has been deleted since it references missing note '${noteId}'`);
                } else {
                    logError(`Branch '${branchId}' references missing note '${noteId}'`);
                }
            }
        );

        this.findAndFixIssues(
            `
                    SELECT branchId, branches.parentNoteId AS parentNoteId
                    FROM branches
                    LEFT JOIN notes ON notes.noteId = branches.parentNoteId
                    WHERE branches.isDeleted = 0
                    AND branches.noteId != 'root'
                    AND notes.noteId IS NULL`,
            ({ branchId, parentNoteId }) => {
                if (this.autoFix) {
                    // Delete the old branch and recreate it with root as parent.
                    const oldBranch = becca.getBranch(branchId);
                    if (!oldBranch) {
                        return;
                    }

                    const noteId = oldBranch.noteId;
                    oldBranch.markAsDeleted("missing-parent");

                    let message = `Branch '${branchId}' was missing parent note '${parentNoteId}', so it was deleted. `;

                    const note = becca.getNote(noteId);
                    if (!note) {
                        return;
                    }

                    if (note.getParentBranches().length === 0) {
                        const newBranch = new BBranch({
                            parentNoteId: "root",
                            noteId,
                            prefix: "recovered"
                        }).save();

                        message += `${newBranch.branchId} was created in the root instead.`;
                    } else {
                        message += `There is one or more valid branches, so no new one will be created as a replacement.`;
                    }

                    this.reloadNeeded = true;

                    logFix(message);
                } else {
                    logError(`Branch '${branchId}' references missing parent note '${parentNoteId}'`);
                }
            }
        );

        this.findAndFixIssues(
            `
                    SELECT attributeId, attributes.noteId
                    FROM attributes
                    LEFT JOIN notes USING (noteId)
                    WHERE attributes.isDeleted = 0
                    AND notes.noteId IS NULL`,
            ({ attributeId, noteId }) => {
                if (this.autoFix) {
                    const attribute = becca.getAttribute(attributeId);
                    if (!attribute) {
                        return;
                    }
                    attribute.markAsDeleted();

                    this.reloadNeeded = true;

                    logFix(`Attribute '${attributeId}' has been deleted since it references missing source note '${noteId}'`);
                } else {
                    logError(`Attribute '${attributeId}' references missing source note '${noteId}'`);
                }
            }
        );

        this.findAndFixIssues(
            `
                    SELECT attributeId, attributes.value AS noteId
                    FROM attributes
                    LEFT JOIN notes ON notes.noteId = attributes.value
                    WHERE attributes.isDeleted = 0
                    AND attributes.type = 'relation'
                    AND notes.noteId IS NULL`,
            ({ attributeId, noteId }) => {
                if (this.autoFix) {
                    const attribute = becca.getAttribute(attributeId);
                    if (!attribute) {
                        return;
                    }
                    attribute.markAsDeleted();

                    this.reloadNeeded = true;

                    logFix(`Relation '${attributeId}' has been deleted since it references missing note '${noteId}'`);
                } else {
                    logError(`Relation '${attributeId}' references missing note '${noteId}'`);
                }
            }
        );

        this.findAndFixIssues(
            `
                    SELECT attachmentId, attachments.ownerId AS noteId
                    FROM attachments
                    WHERE attachments.ownerId NOT IN (
                            SELECT noteId FROM notes
                            UNION ALL
                            SELECT revisionId FROM revisions
                        )
                    AND attachments.isDeleted = 0`,
            ({ attachmentId, ownerId }) => {
                if (this.autoFix) {
                    const attachment = becca.getAttachment(attachmentId);
                    if (!attachment) {
                        return;
                    }
                    attachment.markAsDeleted();

                    this.reloadNeeded = false;

                    logFix(`Attachment '${attachmentId}' has been deleted since it references missing note/revision '${ownerId}'`);
                } else {
                    logError(`Attachment '${attachmentId}' references missing note/revision '${ownerId}'`);
                }
            }
        );
    }

    findExistencyIssues() {
        // the principle for fixing inconsistencies is that if the note itself is deleted (isDeleted=true) then all related
        // entities should be also deleted (branches, attributes), but if the note is not deleted,
        // then at least one branch should exist.

        // the order here is important - first we might need to delete inconsistent branches, and after that
        // another check might create missing branch
        this.findAndFixIssues(
            `
                    SELECT branchId,
                            noteId
                    FROM branches
                    JOIN notes USING (noteId)
                    WHERE notes.isDeleted = 1
                    AND branches.isDeleted = 0`,
            ({ branchId, noteId }) => {
                if (this.autoFix) {
                    const branch = becca.getBranch(branchId);
                    if (!branch) return;
                    branch.markAsDeleted();

                    this.reloadNeeded = true;

                    logFix(`Branch '${branchId}' has been deleted since the associated note '${noteId}' is deleted.`);
                } else {
                    logError(`Branch '${branchId}' is not deleted even though the associated note '${noteId}' is deleted.`);
                }
            }
        );

        this.findAndFixIssues(
            `
            SELECT branchId,
                    parentNoteId
            FROM branches
            JOIN notes AS parentNote ON parentNote.noteId = branches.parentNoteId
            WHERE parentNote.isDeleted = 1
            AND branches.isDeleted = 0
        `,
            ({ branchId, parentNoteId }) => {
                if (this.autoFix) {
                    const branch = becca.getBranch(branchId);
                    if (!branch) {
                        return;
                    }
                    branch.markAsDeleted();

                    this.reloadNeeded = true;

                    logFix(`Branch '${branchId}' has been deleted since the associated parent note '${parentNoteId}' is deleted.`);
                } else {
                    logError(`Branch '${branchId}' is not deleted even though the associated parent note '${parentNoteId}' is deleted.`);
                }
            }
        );

        this.findAndFixIssues(
            `
            SELECT DISTINCT notes.noteId
            FROM notes
            LEFT JOIN branches ON notes.noteId = branches.noteId AND branches.isDeleted = 0
            WHERE notes.isDeleted = 0
            AND branches.branchId IS NULL
        `,
            ({ noteId }) => {
                if (this.autoFix) {
                    const branch = new BBranch({
                        parentNoteId: "root",
                        noteId,
                        prefix: "recovered"
                    }).save();

                    this.reloadNeeded = true;

                    logFix(`Created missing branch '${branch.branchId}' for note '${noteId}'`);
                } else {
                    logError(`No undeleted branch found for note '${noteId}'`);
                }
            }
        );

        // there should be a unique relationship between note and its parent
        this.findAndFixIssues(
            `
                    SELECT noteId,
                            parentNoteId
                    FROM branches
                    WHERE branches.isDeleted = 0
                    GROUP BY branches.parentNoteId,
                            branches.noteId
                    HAVING COUNT(1) > 1`,
            ({ noteId, parentNoteId }) => {
                if (this.autoFix) {
                    const branchIds = sql.getColumn<string>(
                        /*sql*/`SELECT branchId
                            FROM branches
                            WHERE noteId = ?
                                and parentNoteId = ?
                                and isDeleted = 0
                            ORDER BY utcDateModified`,
                        [noteId, parentNoteId]
                    );

                    const branches = branchIds.map((branchId) => becca.getBranch(branchId));

                    // it's not necessarily "original" branch, it's just the only one which will survive
                    const origBranch = branches[0];
                    if (!origBranch) {
                        logError(`Unable to find original branch.`);
                        return;
                    }

                    // delete all but the first branch
                    for (const branch of branches.slice(1)) {
                        if (!branch) {
                            continue;
                        }

                        branch.markAsDeleted();

                        logFix(`Removing branch '${branch.branchId}' since it's a parent-child duplicate of branch '${origBranch.branchId}'`);
                    }

                    this.reloadNeeded = true;
                } else {
                    logError(`Duplicate branches for note '${noteId}' and parent '${parentNoteId}'`);
                }
            }
        );

        this.findAndFixIssues(
            `
                    SELECT attachmentId,
                            attachments.ownerId AS noteId
                    FROM attachments
                    JOIN notes ON notes.noteId = attachments.ownerId
                    WHERE notes.isDeleted = 1
                    AND attachments.isDeleted = 0`,
            ({ attachmentId, noteId }) => {
                if (this.autoFix) {
                    const attachment = becca.getAttachment(attachmentId);
                    if (!attachment) return;
                    attachment.markAsDeleted();

                    this.reloadNeeded = false;

                    logFix(`Attachment '${attachmentId}' has been deleted since the associated note '${noteId}' is deleted.`);
                } else {
                    logError(`Attachment '${attachmentId}' is not deleted even though the associated note '${noteId}' is deleted.`);
                }
            }
        );
    }

    findLogicIssues() {
        const noteTypesStr = noteTypes.map((nt) => `'${nt}'`).join(", ");

        this.findAndFixIssues(
            `
                    SELECT noteId, type
                    FROM notes
                    WHERE isDeleted = 0
                    AND type NOT IN (${noteTypesStr})`,
            ({ noteId, type }) => {
                if (this.autoFix) {
                    const note = becca.getNote(noteId);
                    if (!note) return;
                    note.type = "file"; // file is a safe option to recover notes if the type is not known
                    note.save();

                    this.reloadNeeded = true;

                    logFix(`Note '${noteId}' type has been change to file since it had invalid type '${type}'`);
                } else {
                    logError(`Note '${noteId}' has invalid type '${type}'`);
                }
            }
        );

        this.findAndFixIssues(
            `
                    SELECT notes.noteId, notes.isProtected, notes.type, notes.mime
                    FROM notes
                    LEFT JOIN blobs USING (blobId)
                    WHERE blobs.blobId IS NULL
                        AND notes.isDeleted = 0`,
            ({ noteId, isProtected, type, mime }) => {
                if (this.autoFix) {
                    // it might be possible that the blob is not available only because of the interrupted
                    // sync, and it will come later. It's therefore important to guarantee that this artificial
                    // record won't overwrite the real one coming from the sync.
                    const fakeDate = "2000-01-01 00:00:00Z";

                    const blankContent = getBlankContent(isProtected, type, mime);
                    if (!blankContent) {
                        logError(`Unable to recover note ${noteId} since it's content could not be retrieved (might be protected note).`);
                        return;
                    }
                    const blobId = hashedBlobId(blankContent);
                    const blobAlreadyExists = !!sql.getValue("SELECT 1 FROM blobs WHERE blobId = ?", [blobId]);

                    if (!blobAlreadyExists) {
                        // manually creating row since this can also affect deleted notes
                        sql.upsert("blobs", "blobId", {
                            noteId,
                            content: blankContent,
                            utcDateModified: fakeDate,
                            dateModified: fakeDate
                        });

                        const hash = utils.hash(randomString(10));

                        entityChangesService.putEntityChange({
                            entityName: "blobs",
                            entityId: blobId,
                            hash,
                            isErased: false,
                            utcDateChanged: fakeDate,
                            isSynced: true
                        });
                    }

                    sql.execute("UPDATE notes SET blobId = ? WHERE noteId = ?", [blobId, noteId]);

                    this.reloadNeeded = true;

                    logFix(`Note '${noteId}' content was set to empty string since there was no corresponding row`);
                } else {
                    logError(`Note '${noteId}' content row does not exist`);
                }
            }
        );

        if (sqlInit.getDbSize() < 500000) {
            // querying for "content IS NULL" is expensive since content is not indexed. See e.g. https://github.com/zadam/trilium/issues/2887

            this.findAndFixIssues(
                `
                        SELECT notes.noteId, notes.type, notes.mime
                        FROM notes
                        JOIN blobs USING (blobId)
                        WHERE isDeleted = 0
                        AND isProtected = 0
                        AND content IS NULL`,
                ({ noteId, type, mime }) => {
                    if (this.autoFix) {
                        const note = becca.getNote(noteId);
                        const blankContent = getBlankContent(false, type, mime);
                        if (!note) return;

                        if (blankContent) {
                            note.setContent(blankContent);
                        }

                        this.reloadNeeded = true;

                        logFix(`Note '${noteId}' content was set to '${blankContent}' since it was null even though it is not deleted`);
                    } else {
                        logError(`Note '${noteId}' content is null even though it is not deleted`);
                    }
                }
            );
        }

        this.findAndFixIssues(
            `
                    SELECT revisions.revisionId, blobs.blobId
                    FROM revisions
                    LEFT JOIN blobs USING (blobId)
                    WHERE blobs.blobId IS NULL`,
            ({ revisionId, blobId }) => {
                if (this.autoFix) {
                    eraseService.eraseRevisions([revisionId]);

                    this.reloadNeeded = true;

                    logFix(`Note revision '${revisionId}' was erased since the referenced blob '${blobId}' did not exist.`);
                } else {
                    logError(`Note revision '${revisionId}' blob '${blobId}' does not exist`);
                }
            }
        );

        this.findAndFixIssues(
            `
                    SELECT attachments.attachmentId, blobs.blobId
                    FROM attachments
                    LEFT JOIN blobs USING (blobId)
                    WHERE blobs.blobId IS NULL`,
            ({ attachmentId, blobId }) => {
                if (this.autoFix) {
                    eraseService.eraseAttachments([attachmentId]);

                    this.reloadNeeded = true;

                    logFix(`Attachment '${attachmentId}' was erased since the referenced blob '${blobId}' did not exist.`);
                } else {
                    logError(`Attachment '${attachmentId}' blob '${blobId}' does not exist`);
                }
            }
        );

        this.findAndFixIssues(
            `
                    SELECT parentNoteId
                    FROM branches
                    JOIN notes ON notes.noteId = branches.parentNoteId
                    WHERE notes.isDeleted = 0
                    AND notes.type == 'search'
                    AND branches.isDeleted = 0`,
            ({ parentNoteId }) => {
                if (this.autoFix) {
                    const branchIds = sql.getColumn<string>(
                        `
                        SELECT branchId
                        FROM branches
                        WHERE isDeleted = 0
                        AND parentNoteId = ?`,
                        [parentNoteId]
                    );

                    const branches = branchIds.map((branchId) => becca.getBranch(branchId));

                    for (const branch of branches) {
                        if (!branch) continue;

                        // delete the old wrong branch
                        branch.markAsDeleted("parent-is-search");

                        // create a replacement branch in root parent
                        new BBranch({
                            parentNoteId: "root",
                            noteId: branch.noteId,
                            prefix: "recovered"
                        }).save();

                        logFix(`Note '${branch.noteId}' has been moved to root since it was a child of a search note '${parentNoteId}'`);
                    }

                    this.reloadNeeded = true;
                } else {
                    logError(`Search note '${parentNoteId}' has children`);
                }
            }
        );

        this.findAndFixIssues(
            `
                    SELECT attributeId
                    FROM attributes
                    WHERE isDeleted = 0
                    AND type = 'relation'
                    AND value = ''`,
            ({ attributeId }) => {
                if (this.autoFix) {
                    const relation = becca.getAttribute(attributeId);
                    if (!relation) return;
                    relation.markAsDeleted();

                    this.reloadNeeded = true;

                    logFix(`Removed relation '${relation.attributeId}' of name '${relation.name}' with empty target.`);
                } else {
                    logError(`Relation '${attributeId}' has empty target.`);
                }
            }
        );

        this.findAndFixIssues(
            `
                    SELECT attributeId,
                            type
                    FROM attributes
                    WHERE isDeleted = 0
                    AND type != 'label'
                    AND type != 'relation'`,
            ({ attributeId, type }) => {
                if (this.autoFix) {
                    const attribute = becca.getAttribute(attributeId);
                    if (!attribute) return;
                    attribute.type = "label";
                    attribute.save();

                    this.reloadNeeded = true;

                    logFix(`Attribute '${attributeId}' type was changed to label since it had invalid type '${type}'`);
                } else {
                    logError(`Attribute '${attributeId}' has invalid type '${type}'`);
                }
            }
        );

        this.findAndFixIssues(
            `
                    SELECT attributeId,
                            attributes.noteId
                    FROM attributes
                    JOIN notes ON attributes.noteId = notes.noteId
                    WHERE attributes.isDeleted = 0
                    AND notes.isDeleted = 1`,
            ({ attributeId, noteId }) => {
                if (this.autoFix) {
                    const attribute = becca.getAttribute(attributeId);
                    if (!attribute) return;
                    attribute.markAsDeleted();

                    this.reloadNeeded = true;

                    logFix(`Removed attribute '${attributeId}' because owning note '${noteId}' is also deleted.`);
                } else {
                    logError(`Attribute '${attributeId}' is not deleted even though owning note '${noteId}' is deleted.`);
                }
            }
        );

        this.findAndFixIssues(
            `
                    SELECT attributeId,
                            attributes.value AS targetNoteId
                    FROM attributes
                    JOIN notes ON attributes.value = notes.noteId
                    WHERE attributes.type = 'relation'
                    AND attributes.isDeleted = 0
                    AND notes.isDeleted = 1`,
            ({ attributeId, targetNoteId }) => {
                if (this.autoFix) {
                    const attribute = becca.getAttribute(attributeId);
                    if (!attribute) return;
                    attribute.markAsDeleted();

                    this.reloadNeeded = true;

                    logFix(`Removed attribute '${attributeId}' because target note '${targetNoteId}' is also deleted.`);
                } else {
                    logError(`Attribute '${attributeId}' is not deleted even though target note '${targetNoteId}' is deleted.`);
                }
            }
        );
    }

    runEntityChangeChecks(entityName: string, key: string) {
        this.findAndFixIssues(
            `
            SELECT ${key} as entityId
            FROM ${entityName}
            LEFT JOIN entity_changes ec ON ec.entityName = '${entityName}' AND ec.entityId = ${entityName}.${key}
            WHERE ec.id IS NULL`,
            ({ entityId }) => {
                const entityRow = sql.getRow<EntityChange>(/*sql*/`SELECT * FROM ${entityName} WHERE ${key} = ?`, [entityId]);

                if (this.autoFix) {
                    entityChangesService.putEntityChange({
                        entityName,
                        entityId,
                        hash: randomString(10), // doesn't matter, will force sync, but that's OK
                        isErased: false,
                        utcDateChanged: entityRow.utcDateModified || entityRow.utcDateCreated,
                        isSynced: entityName !== "options" || entityRow.isSynced
                    });

                    logFix(`Created missing entity change for entityName '${entityName}', entityId '${entityId}'`);
                } else {
                    logError(`Missing entity change for entityName '${entityName}', entityId '${entityId}'`);
                }
            }
        );

        this.findAndFixIssues(
            `
            SELECT id, entityId
            FROM entity_changes
            LEFT JOIN ${entityName} ON entityId = ${entityName}.${key}
            WHERE
            entity_changes.isErased = 0
            AND entity_changes.entityName = '${entityName}'
            AND ${entityName}.${key} IS NULL`,
            ({ id, entityId }) => {
                if (this.autoFix) {
                    sql.execute("DELETE FROM entity_changes WHERE entityName = ? AND entityId = ?", [entityName, entityId]);

                    logFix(`Deleted extra entity change id '${id}', entityName '${entityName}', entityId '${entityId}'`);
                } else {
                    logError(`Unrecognized entity change id '${id}', entityName '${entityName}', entityId '${entityId}'`);
                }
            }
        );

        this.findAndFixIssues(
            `
            SELECT id, entityId
            FROM entity_changes
            JOIN ${entityName} ON entityId = ${entityName}.${key}
            WHERE
            entity_changes.isErased = 1
            AND entity_changes.entityName = '${entityName}'`,
            ({ id, entityId }) => {
                if (this.autoFix) {
                    sql.execute(/*sql*/`DELETE FROM ${entityName} WHERE ${key} = ?`, [entityId]);

                    this.reloadNeeded = true;

                    logFix(`Erasing entityName '${entityName}', entityId '${entityId}' since entity change id '${id}' has it as erased.`);
                } else {
                    logError(`Entity change id '${id}' has entityName '${entityName}', entityId '${entityId}' as erased, but it's not.`);
                }
            }
        );
    }

    findEntityChangeIssues() {
        this.runEntityChangeChecks("notes", "noteId");
        this.runEntityChangeChecks("revisions", "revisionId");
        this.runEntityChangeChecks("attachments", "attachmentId");
        this.runEntityChangeChecks("blobs", "blobId");
        this.runEntityChangeChecks("branches", "branchId");
        this.runEntityChangeChecks("attributes", "attributeId");
        this.runEntityChangeChecks("etapi_tokens", "etapiTokenId");
        this.runEntityChangeChecks("options", "name");
    }

    findWronglyNamedAttributes() {
        const attrNames = sql.getColumn<string>(/*sql*/`SELECT DISTINCT name FROM attributes`);

        for (const origName of attrNames) {
            const fixedName = sanitizeAttributeName(origName);

            if (fixedName !== origName) {
                if (this.autoFix) {
                    // there isn't a good way to update this:
                    // - just SQL query will fix it in DB but not notify frontend (or other caches) that it has been fixed
                    // - renaming the attribute would break the invariant that single attribute never changes the name
                    // - deleting the old attribute and creating new will create duplicates across synchronized cluster (specifically in the initial migration)
                    // But in general, we assume there won't be many such problems
                    sql.execute("UPDATE attributes SET name = ? WHERE name = ?", [fixedName, origName]);

                    this.fixedIssues = true;
                    this.reloadNeeded = true;

                    logFix(`Renamed incorrectly named attributes '${origName}' to '${fixedName}'`);
                } else {
                    this.unrecoveredConsistencyErrors = true;

                    logFix(`There are incorrectly named attributes '${origName}'`);
                }
            }
        }
    }

    findSyncIssues() {
        const lastSyncedPush = parseInt(sql.getValue("SELECT value FROM options WHERE name = 'lastSyncedPush'"));
        const maxEntityChangeId = sql.getValue<number>("SELECT MAX(id) FROM entity_changes");

        if (lastSyncedPush > maxEntityChangeId) {
            if (this.autoFix) {
                sql.execute("UPDATE options SET value = ? WHERE name = 'lastSyncedPush'", [maxEntityChangeId]);

                this.fixedIssues = true;

                logFix(`Fixed incorrect lastSyncedPush - was ${lastSyncedPush}, needs to be at maximum ${maxEntityChangeId}`);
            } else {
                this.unrecoveredConsistencyErrors = true;

                logFix(`Incorrect lastSyncedPush - is ${lastSyncedPush}, needs to be at maximum ${maxEntityChangeId}`);
            }
        }
    }

    runAllChecksAndFixers() {
        this.unrecoveredConsistencyErrors = false;
        this.fixedIssues = false;
        this.reloadNeeded = false;

        this.findEntityChangeIssues();

        this.findBrokenReferenceIssues();

        this.findExistencyIssues();

        this.findLogicIssues();

        this.findWronglyNamedAttributes();

        this.findSyncIssues();

        // root branch should always be expanded
        sql.execute("UPDATE branches SET isExpanded = 1 WHERE noteId = 'root'");

        if (!this.unrecoveredConsistencyErrors) {
            // we run this only if basic checks passed since this assumes basic data consistency

            this.checkAndRepairTreeCycles();
        }

        if (this.reloadNeeded) {
            becca_loader.reload("consistency checks need becca reload");
        }

        return !this.unrecoveredConsistencyErrors;
    }

    runDbDiagnostics() {
        function getTableRowCount(tableName: string) {
            const count = sql.getValue<number>(/*sql*/`SELECT COUNT(1) FROM ${tableName}`);

            return `${tableName}: ${count}`;
        }

        const tables = ["notes", "revisions", "attachments", "branches", "attributes", "etapi_tokens", "blobs"];

        log.info(`Table counts: ${tables.map((tableName) => getTableRowCount(tableName)).join(", ")}`);
    }

    async runChecks() {
        let elapsedTimeMs;

        await syncMutexService.doExclusively(() => {
            const startTimeMs = Date.now();

            this.runDbDiagnostics();

            this.runAllChecksAndFixers();

            elapsedTimeMs = Date.now() - startTimeMs;
        });

        if (this.unrecoveredConsistencyErrors) {
            log.info(`Consistency checks failed (took ${elapsedTimeMs}ms)`);

            ws.sendMessageToAllClients({ type: "consistency-checks-failed" });
        } else {
            log.info(`All consistency checks passed ${  this.fixedIssues ? "after some fixes" : "with no errors detected"  } (took ${elapsedTimeMs}ms)`);
        }
    }
}

function getBlankContent(isProtected: boolean, type: string, mime: string) {
    if (isProtected) {
        return null; // this is wrong for protected non-erased notes, but we cannot create a valid value without a password
    }

    if (mime === "application/json") {
        return "{}";
    }

    return ""; // empty string might be a wrong choice for some note types, but it's the best guess
}

function logFix(message: string) {
    log.info(`Consistency issue fixed: ${message}`);
}

function logError(message: string) {
    log.info(`Consistency error: ${message}`);
}

function runPeriodicChecks() {
    const autoFix = optionsService.getOptionBool("autoFixConsistencyIssues");

    const consistencyChecks = new ConsistencyChecks(autoFix);
    consistencyChecks.runChecks();
}

async function runOnDemandChecks(autoFix: boolean) {
    const consistencyChecks = new ConsistencyChecks(autoFix);
    await consistencyChecks.runChecks();
}

function runEntityChangesChecks() {
    const consistencyChecks = new ConsistencyChecks(true);
    consistencyChecks.findEntityChangeIssues();
}

sqlInit.dbReady.then(() => {
    setInterval(cls.wrap(runPeriodicChecks), 60 * 60 * 1000);

    // kickoff checks soon after startup (to not block the initial load)
    setTimeout(cls.wrap(runPeriodicChecks), 4 * 1000);
});

export default {
    runOnDemandChecks,
    runEntityChangesChecks
};
