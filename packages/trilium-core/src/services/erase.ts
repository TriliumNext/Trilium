import { getLog } from "./log.js";
import entityChangesService from "./entity_changes.js";
import optionService from "./options.js";
import dateUtils from "./utils/date.js";
import * as sqlInit from "./sql_init.js";
import * as cls from "./context.js";
import type { EntityChange } from "@triliumnext/commons";
import { getSql } from "./sql/index.js";

function eraseNotes(noteIdsToErase: string[]) {
    if (noteIdsToErase.length === 0) {
        return;
    }

    const sql = getSql();
    sql.executeMany(/*sql*/`DELETE FROM notes WHERE noteId IN (???)`, noteIdsToErase);
    setEntityChangesAsErased(sql.getManyRows(/*sql*/`SELECT * FROM entity_changes WHERE entityName = 'notes' AND entityId IN (???)`, noteIdsToErase));

    // we also need to erase all "dependent" entities of the erased notes
    const branchIdsToErase = sql.getManyRows<{ branchId: string }>(/*sql*/`SELECT branchId FROM branches WHERE noteId IN (???)`, noteIdsToErase).map((row) => row.branchId);

    eraseBranches(branchIdsToErase);

    const attributeIdsToErase = sql.getManyRows<{ attributeId: string }>(/*sql*/`SELECT attributeId FROM attributes WHERE noteId IN (???)`, noteIdsToErase).map((row) => row.attributeId);

    eraseAttributes(attributeIdsToErase);

    const revisionIdsToErase = sql.getManyRows<{ revisionId: string }>(/*sql*/`SELECT revisionId FROM revisions WHERE noteId IN (???)`, noteIdsToErase).map((row) => row.revisionId);

    eraseRevisions(revisionIdsToErase);

    const cardIdsToErase = sql.getManyRows<{ cardId: string }>(/*sql*/`SELECT cardId FROM flashcards WHERE noteId IN (???)`, noteIdsToErase).map((row) => row.cardId);

    eraseFlashcards(cardIdsToErase);

    getLog().info(`Erased notes: ${JSON.stringify(noteIdsToErase)}`);
}

function setEntityChangesAsErased(entityChanges: EntityChange[]) {
    for (const ec of entityChanges) {
        ec.isErased = true;
        // we're not changing hash here, not sure if good or not
        // content hash check takes isErased flag into account, though
        ec.utcDateChanged = dateUtils.utcNowDateTime();

        entityChangesService.putEntityChangeWithForcedChange(ec);
    }
}

function eraseBranches(branchIdsToErase: string[]) {
    if (branchIdsToErase.length === 0) {
        return;
    }

    const sql = getSql();
    sql.executeMany(/*sql*/`DELETE FROM branches WHERE branchId IN (???)`, branchIdsToErase);

    setEntityChangesAsErased(sql.getManyRows(/*sql*/`SELECT * FROM entity_changes WHERE entityName = 'branches' AND entityId IN (???)`, branchIdsToErase));

    getLog().info(`Erased branches: ${JSON.stringify(branchIdsToErase)}`);
}

function eraseAttributes(attributeIdsToErase: string[]) {
    if (attributeIdsToErase.length === 0) {
        return;
    }

    const sql = getSql();
    sql.executeMany(/*sql*/`DELETE FROM attributes WHERE attributeId IN (???)`, attributeIdsToErase);

    setEntityChangesAsErased(sql.getManyRows(/*sql*/`SELECT * FROM entity_changes WHERE entityName = 'attributes' AND entityId IN (???)`, attributeIdsToErase));

    getLog().info(`Erased attributes: ${JSON.stringify(attributeIdsToErase)}`);
}

function eraseAttachments(attachmentIdsToErase: string[]) {
    if (attachmentIdsToErase.length === 0) {
        return;
    }

    const sql = getSql();
    sql.executeMany(/*sql*/`DELETE FROM attachments WHERE attachmentId IN (???)`, attachmentIdsToErase);

    setEntityChangesAsErased(sql.getManyRows(/*sql*/`SELECT * FROM entity_changes WHERE entityName = 'attachments' AND entityId IN (???)`, attachmentIdsToErase));

    getLog().info(`Erased attachments: ${JSON.stringify(attachmentIdsToErase)}`);
}

function eraseRevisions(revisionIdsToErase: string[]) {
    if (revisionIdsToErase.length === 0) {
        return;
    }

    const sql = getSql();
    sql.executeMany(/*sql*/`DELETE FROM revisions WHERE revisionId IN (???)`, revisionIdsToErase);

    setEntityChangesAsErased(sql.getManyRows(/*sql*/`SELECT * FROM entity_changes WHERE entityName = 'revisions' AND entityId IN (???)`, revisionIdsToErase));

    getLog().info(`Removed revisions: ${JSON.stringify(revisionIdsToErase)}`);
}

function eraseFlashcards(cardIdsToErase: string[]) {
    if (cardIdsToErase.length === 0) {
        return;
    }

    const sql = getSql();
    const reviewIdsToErase = sql.getManyRows<{ reviewId: string }>(/*sql*/`SELECT reviewId FROM flashcard_reviews WHERE cardId IN (???)`, cardIdsToErase).map((row) => row.reviewId);
    eraseFlashcardReviews(reviewIdsToErase);

    sql.executeMany(/*sql*/`DELETE FROM flashcards WHERE cardId IN (???)`, cardIdsToErase);

    setEntityChangesAsErased(sql.getManyRows(/*sql*/`SELECT * FROM entity_changes WHERE entityName = 'flashcards' AND entityId IN (???)`, cardIdsToErase));

    getLog().info(`Erased flashcards: ${JSON.stringify(cardIdsToErase)}`);
}

function eraseFlashcardReviews(reviewIdsToErase: string[]) {
    if (reviewIdsToErase.length === 0) {
        return;
    }

    const sql = getSql();
    sql.executeMany(/*sql*/`DELETE FROM flashcard_reviews WHERE reviewId IN (???)`, reviewIdsToErase);

    setEntityChangesAsErased(sql.getManyRows(/*sql*/`SELECT * FROM entity_changes WHERE entityName = 'flashcard_reviews' AND entityId IN (???)`, reviewIdsToErase));

    getLog().info(`Erased flashcard reviews: ${JSON.stringify(reviewIdsToErase)}`);
}

function eraseUnusedBlobs() {
    const sql = getSql();
    const unusedBlobIds = sql.getColumn(`
        SELECT blobs.blobId
        FROM blobs
        LEFT JOIN notes ON notes.blobId = blobs.blobId
        LEFT JOIN attachments ON attachments.blobId = blobs.blobId
        LEFT JOIN revisions ON revisions.blobId = blobs.blobId
        WHERE notes.noteId IS NULL
        AND attachments.attachmentId IS NULL
        AND revisions.revisionId IS NULL`);

    if (unusedBlobIds.length === 0) {
        return;
    }

    sql.executeMany(/*sql*/`DELETE FROM blobs WHERE blobId IN (???)`, unusedBlobIds);
    // blobs are not marked as erased in entity_changes, they are just purged completely
    // this is because technically every keystroke can create a new blob and there would be just too many
    sql.executeMany(/*sql*/`DELETE FROM entity_changes WHERE entityName = 'blobs' AND entityId IN (???)`, unusedBlobIds);

    getLog().info(`Erased unused blobs: ${JSON.stringify(unusedBlobIds)}`);
}

function eraseDeletedEntities(eraseEntitiesAfterTimeInSeconds: number | null = null) {
    const sql = getSql();
    // this is important also so that the erased entity changes are sent to the connected clients
    sql.transactional(() => {
        if (eraseEntitiesAfterTimeInSeconds === null) {
            eraseEntitiesAfterTimeInSeconds = optionService.getOptionInt("eraseEntitiesAfterTimeInSeconds");
        }

        const cutoffDate = new Date(Date.now() - eraseEntitiesAfterTimeInSeconds * 1000);

        const noteIdsToErase = sql.getColumn<string>("SELECT noteId FROM notes WHERE isDeleted = 1 AND utcDateModified <= ?", [dateUtils.utcDateTimeStr(cutoffDate)]);
        eraseNotes(noteIdsToErase);

        const branchIdsToErase = sql.getColumn<string>("SELECT branchId FROM branches WHERE isDeleted = 1 AND utcDateModified <= ?", [dateUtils.utcDateTimeStr(cutoffDate)]);
        eraseBranches(branchIdsToErase);

        const attributeIdsToErase = sql.getColumn<string>("SELECT attributeId FROM attributes WHERE isDeleted = 1 AND utcDateModified <= ?", [dateUtils.utcDateTimeStr(cutoffDate)]);
        eraseAttributes(attributeIdsToErase);

        const attachmentIdsToErase = sql.getColumn<string>("SELECT attachmentId FROM attachments WHERE isDeleted = 1 AND utcDateModified <= ?", [dateUtils.utcDateTimeStr(cutoffDate)]);
        eraseAttachments(attachmentIdsToErase);

        const cardIdsToErase = sql.getColumn<string>("SELECT cardId FROM flashcards WHERE isDeleted = 1 AND utcDateModified <= ?", [dateUtils.utcDateTimeStr(cutoffDate)]);
        eraseFlashcards(cardIdsToErase);

        eraseUnusedBlobs();
    });
}

/**
 * Erases the entities marked by any of the given deletions, in a single pass.
 *
 * The client's `deleteNotes` deletes one branch per request, each with its own deleteId, and
 * `setEntityChangesAsErased` marks entity changes that make every connected client reload. Erasing
 * a whole group at once keeps that to a single reload, after its last request.
 */
function eraseNotesWithDeleteIds(deleteIds: string[]) {
    if (deleteIds.length === 0) {
        return;
    }

    const sql = getSql();
    const noteIdsToErase = sql.getManyRows<{ noteId: string }>(
        /*sql*/`SELECT noteId FROM notes WHERE isDeleted = 1 AND deleteId IN (???)`,
        deleteIds
    ).map((row) => row.noteId);
    eraseNotes(noteIdsToErase);

    const branchIdsToErase = sql.getManyRows<{ branchId: string }>(
        /*sql*/`SELECT branchId FROM branches WHERE isDeleted = 1 AND deleteId IN (???)`,
        deleteIds
    ).map((row) => row.branchId);
    eraseBranches(branchIdsToErase);

    const attributeIdsToErase = sql.getManyRows<{ attributeId: string }>(
        /*sql*/`SELECT attributeId FROM attributes WHERE isDeleted = 1 AND deleteId IN (???)`,
        deleteIds
    ).map((row) => row.attributeId);
    eraseAttributes(attributeIdsToErase);

    const attachmentIdsToErase = sql.getManyRows<{ attachmentId: string }>(
        /*sql*/`SELECT attachmentId FROM attachments WHERE isDeleted = 1 AND deleteId IN (???)`,
        deleteIds
    ).map((row) => row.attachmentId);
    eraseAttachments(attachmentIdsToErase);

    const cardIdsToErase = sql.getManyRows<{ cardId: string }>(
        /*sql*/`SELECT cardId FROM flashcards WHERE isDeleted = 1 AND deleteId IN (???)`,
        deleteIds
    ).map((row) => row.cardId);
    eraseFlashcards(cardIdsToErase);

    eraseUnusedBlobs();
}

function eraseDeletedNotesNow() {
    eraseDeletedEntities(0);
}

function eraseUnusedAttachmentsNow() {
    eraseScheduledAttachments(0);
}

function eraseScheduledAttachments(eraseUnusedAttachmentsAfterSeconds: number | null = null) {
    if (eraseUnusedAttachmentsAfterSeconds === null) {
        eraseUnusedAttachmentsAfterSeconds = optionService.getOptionInt("eraseUnusedAttachmentsAfterSeconds");
    }

    const cutOffDate = dateUtils.utcDateTimeStr(new Date(Date.now() - eraseUnusedAttachmentsAfterSeconds * 1000));
    const attachmentIdsToErase = getSql().getColumn<string>("SELECT attachmentId FROM attachments WHERE utcDateScheduledForErasureSince < ?", [cutOffDate]);

    if (attachmentIdsToErase.length === 0) {
        return;
    }

    eraseAttachments(attachmentIdsToErase);
    // Dropping the rows leaves their content behind, held by nothing: without this the space is not
    // handed back until some later erasure of deleted entities happens to sweep it up. Reached only
    // when something actually went, so the hourly pass costs no blob scan on a quiet database.
    eraseUnusedBlobs();
}

function startScheduledCleanup() {
    sqlInit.dbReady.then(() => {
        // first cleanup kickoff 5 minutes after startup
        setTimeout(
            cls.wrap(() => eraseDeletedEntities()),
            5 * 60 * 1000
        );
        setTimeout(
            cls.wrap(() => eraseScheduledAttachments()),
            6 * 60 * 1000
        );

        setInterval(
            cls.wrap(() => eraseDeletedEntities()),
            4 * 3600 * 1000
        );
        setInterval(
            cls.wrap(() => eraseScheduledAttachments()),
            3600 * 1000
        );
    });
}

export default {
    eraseDeletedNotesNow,
    eraseUnusedAttachmentsNow,
    eraseNotesWithDeleteIds,
    eraseUnusedBlobs,
    eraseAttachments,
    eraseRevisions,
    startScheduledCleanup
};
