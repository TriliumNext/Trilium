CREATE TABLE IF NOT EXISTS "entity_changes" (
                                                `id`	INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
                                                `entityName`	TEXT NOT NULL,
                                                `entityId`	TEXT NOT NULL,
                                                `hash`	TEXT NOT NULL,
                                                `isErased` INT NOT NULL,
                                                `changeId` TEXT NOT NULL,
                                                `componentId` TEXT NOT NULL,
                                                `instanceId` TEXT NOT NULL,
                                                `isSynced` INTEGER NOT NULL,
                                                `utcDateChanged` TEXT NOT NULL
                                                );
CREATE TABLE IF NOT EXISTS "etapi_tokens"
(
    etapiTokenId TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    tokenHash TEXT NOT NULL,
    utcDateCreated TEXT NOT NULL,
    utcDateModified TEXT NOT NULL,
    isDeleted INT NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS "branches" (
                                          `branchId`	TEXT NOT NULL,
                                          `noteId`	TEXT NOT NULL,
                                          `parentNoteId`	TEXT NOT NULL,
                                          `notePosition`	INTEGER NOT NULL,
                                          `prefix`	TEXT,
                                          `isExpanded`	INTEGER NOT NULL DEFAULT 0,
                                          `isDeleted`	INTEGER NOT NULL DEFAULT 0,
                                          `deleteId`    TEXT DEFAULT NULL,
                                          `utcDateModified`	TEXT NOT NULL,
                                          PRIMARY KEY(`branchId`));
CREATE TABLE IF NOT EXISTS "notes" (
                                       `noteId`	TEXT NOT NULL,
                                       `title`	TEXT NOT NULL DEFAULT "note",
                                       `isProtected`	INT NOT NULL DEFAULT 0,
                                       `type` TEXT NOT NULL DEFAULT 'text',
                                       `mime` TEXT NOT NULL DEFAULT 'text/html',
                                       blobId TEXT DEFAULT NULL,
                                       `isDeleted`	INT NOT NULL DEFAULT 0,
                                       `deleteId`   TEXT DEFAULT NULL,
                                       `dateCreated`	TEXT NOT NULL,
                                       `dateModified`	TEXT NOT NULL,
                                       `utcDateCreated`	TEXT NOT NULL,
                                       `utcDateModified`	TEXT NOT NULL,
                                       PRIMARY KEY(`noteId`));
CREATE TABLE IF NOT EXISTS "revisions" (`revisionId`	TEXT NOT NULL PRIMARY KEY,
                                             `noteId`	TEXT NOT NULL,
                                             type TEXT DEFAULT '' NOT NULL,
                                             mime TEXT DEFAULT '' NOT NULL,
                                             `title`	TEXT NOT NULL,
                                             `description` TEXT DEFAULT '' NOT NULL,
                                             `source` TEXT DEFAULT 'auto' NOT NULL,
                                             `isProtected`	INT NOT NULL DEFAULT 0,
                                            blobId TEXT DEFAULT NULL,
                                             `utcDateLastEdited` TEXT NOT NULL,
                                             `utcDateCreated` TEXT NOT NULL,
                                             `utcDateModified` TEXT NOT NULL,
                                             `dateLastEdited` TEXT NOT NULL,
                                             `dateCreated` TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS "options"
(
    name TEXT not null PRIMARY KEY,
    value TEXT not null,
    isSynced INTEGER default 0 not null,
    utcDateModified TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS "attributes"
(
    attributeId      TEXT not null primary key,
    noteId       TEXT not null,
    type         TEXT not null,
    name         TEXT not null,
    value        TEXT default '' not null,
    position     INT  default 0 not null,
    utcDateModified TEXT not null,
    isDeleted    INT  not null,
    `deleteId`    TEXT DEFAULT NULL,
    isInheritable int DEFAULT 0 NULL);
CREATE UNIQUE INDEX `IDX_entityChanges_entityName_entityId` ON "entity_changes" (
                                                                                 `entityName`,
                                                                                 `entityId`
    );
CREATE INDEX `IDX_branches_noteId_parentNoteId` ON `branches` (`noteId`,`parentNoteId`);
CREATE INDEX IDX_branches_parentNoteId_isDeleted_notePosition ON branches (parentNoteId, isDeleted, notePosition);
CREATE INDEX `IDX_notes_title` ON `notes` (`title`);
CREATE INDEX `IDX_notes_type` ON `notes` (`type`);
CREATE INDEX `IDX_notes_dateCreated` ON `notes` (`dateCreated`);
CREATE INDEX `IDX_notes_dateModified` ON `notes` (`dateModified`);
CREATE INDEX `IDX_notes_utcDateModified` ON `notes` (`utcDateModified`);
CREATE INDEX `IDX_notes_utcDateCreated` ON `notes` (`utcDateCreated`);
CREATE INDEX `IDX_revisions_noteId` ON `revisions` (`noteId`);
CREATE INDEX `IDX_revisions_utcDateCreated` ON `revisions` (`utcDateCreated`);
CREATE INDEX `IDX_revisions_utcDateLastEdited` ON `revisions` (`utcDateLastEdited`);
CREATE INDEX `IDX_revisions_dateCreated` ON `revisions` (`dateCreated`);
CREATE INDEX `IDX_revisions_dateLastEdited` ON `revisions` (`dateLastEdited`);
CREATE INDEX `IDX_entity_changes_changeId` ON `entity_changes` (`changeId`);
CREATE INDEX IDX_attributes_name_value
    on attributes (name, value);
CREATE INDEX IDX_attributes_noteId_index
    on attributes (noteId);
CREATE INDEX IDX_attributes_value_index
    on attributes (value);
CREATE TABLE IF NOT EXISTS "recent_notes"
(
    noteId TEXT not null primary key,
    notePath TEXT not null,
    utcDateCreated TEXT not null
);
CREATE TABLE IF NOT EXISTS "blobs" (
                                               `blobId`	TEXT NOT NULL,
                                               `content`	TEXT NULL DEFAULT NULL,
                                               `textRepresentation` TEXT DEFAULT NULL,
                                               `dateModified` TEXT NOT NULL,
                                               `utcDateModified` TEXT NOT NULL,
                                               PRIMARY KEY(`blobId`)
);
CREATE TABLE IF NOT EXISTS "attachments"
(
    attachmentId      TEXT not null primary key,
    ownerId       TEXT not null,
    role         TEXT not null,
    mime         TEXT not null,
    title         TEXT not null,
    isProtected    INT  not null DEFAULT 0,
    position     INT  default 0 not null,
    blobId    TEXT DEFAULT null,
    dateModified TEXT NOT NULL,
    utcDateModified TEXT not null,
    utcDateScheduledForErasureSince TEXT DEFAULT NULL,
    isDeleted    INT  not null,
    deleteId    TEXT DEFAULT NULL);
CREATE TABLE IF NOT EXISTS "user_data"
(
    tmpID INT,
    username TEXT,
    email TEXT,
    userIDEncryptedDataKey TEXT,
    userIDVerificationHash TEXT,
    salt TEXT,
    derivedKey TEXT,
    isSetup TEXT DEFAULT "false",
    UNIQUE (tmpID),
    PRIMARY KEY (tmpID)
);
CREATE INDEX IDX_attachments_ownerId_role
    on attachments (ownerId, role);

CREATE INDEX IDX_notes_blobId on notes (blobId);
CREATE INDEX IDX_revisions_blobId on revisions (blobId);
CREATE INDEX IDX_attachments_blobId on attachments (blobId);

CREATE INDEX IDX_entity_changes_isSynced_id ON entity_changes (isSynced, id);
CREATE INDEX IDX_entity_changes_isErased_entityName ON entity_changes (isErased, entityName);
CREATE INDEX IDX_notes_isDeleted_utcDateModified ON notes (isDeleted, utcDateModified);
CREATE INDEX IDX_branches_isDeleted_utcDateModified ON branches (isDeleted, utcDateModified);
CREATE INDEX IDX_attributes_isDeleted_utcDateModified ON attributes (isDeleted, utcDateModified);
CREATE INDEX IDX_attachments_isDeleted_utcDateModified ON attachments (isDeleted, utcDateModified);
CREATE INDEX IDX_attachments_utcDateScheduledForErasureSince ON attachments (utcDateScheduledForErasureSince);

CREATE TABLE IF NOT EXISTS flashcards (
    cardId TEXT NOT NULL PRIMARY KEY,
    noteId TEXT NOT NULL,
    deckNoteId TEXT NOT NULL,
    ordinal INTEGER NOT NULL DEFAULT 0,
    state INTEGER NOT NULL,
    due TEXT NOT NULL,
    stability REAL NOT NULL DEFAULT 0,
    difficulty REAL NOT NULL DEFAULT 0,
    elapsedDays INTEGER NOT NULL DEFAULT 0,
    scheduledDays INTEGER NOT NULL DEFAULT 0,
    learningSteps INTEGER NOT NULL DEFAULT 0,
    reps INTEGER NOT NULL DEFAULT 0,
    lapses INTEGER NOT NULL DEFAULT 0,
    lastReview TEXT DEFAULT NULL,
    suspended INTEGER NOT NULL DEFAULT 0,
    algorithm TEXT NOT NULL DEFAULT 'fsrs-6',
    algorithmVersion TEXT NOT NULL DEFAULT 'ts-fsrs@5.4.1',
    schedulingRevision INTEGER NOT NULL DEFAULT 0,
    utcDateCreated TEXT NOT NULL,
    utcDateModified TEXT NOT NULL,
    isDeleted INTEGER NOT NULL DEFAULT 0,
    deleteId TEXT DEFAULT NULL,
    schedulerConfig TEXT NOT NULL DEFAULT '{"requestRetention":0.9,"maximumInterval":36500,"enableFuzz":true,"enableShortTerm":true,"learningSteps":["1m","10m"],"relearningSteps":["10m"],"dailyNewCardLimit":20,"dailyReviewLimit":200,"dayRolloverHour":4,"weights":null}'
);
CREATE UNIQUE INDEX IDX_flashcards_noteId_ordinal ON flashcards (noteId, ordinal) WHERE isDeleted = 0;
CREATE INDEX IDX_flashcards_deck_due ON flashcards (deckNoteId, suspended, isDeleted, due);
CREATE INDEX IDX_flashcards_due ON flashcards (suspended, isDeleted, due);
CREATE INDEX IDX_flashcards_noteId ON flashcards (noteId);

CREATE TABLE IF NOT EXISTS flashcard_reviews (
    reviewId TEXT NOT NULL PRIMARY KEY,
    cardId TEXT NOT NULL,
    rating INTEGER NOT NULL,
    state INTEGER NOT NULL,
    dueBefore TEXT NOT NULL,
    dueAfter TEXT NOT NULL,
    stabilityBefore REAL NOT NULL,
    stabilityAfter REAL NOT NULL,
    difficultyBefore REAL NOT NULL,
    difficultyAfter REAL NOT NULL,
    elapsedDays INTEGER NOT NULL,
    elapsedDaysBefore INTEGER NOT NULL,
    scheduledDays INTEGER NOT NULL,
    scheduledDaysBefore INTEGER NOT NULL,
    learningSteps INTEGER NOT NULL,
    learningStepsBefore INTEGER NOT NULL,
    repsBefore INTEGER NOT NULL,
    lapsesBefore INTEGER NOT NULL,
    lastReviewBefore TEXT DEFAULT NULL,
    schedulingRevisionBefore INTEGER NOT NULL,
    schedulingRevisionAfter INTEGER NOT NULL,
    reviewedAt TEXT NOT NULL,
    durationMs INTEGER DEFAULT NULL,
    algorithm TEXT NOT NULL,
    algorithmVersion TEXT NOT NULL,
    clientRequestId TEXT DEFAULT NULL,
    utcDateCreated TEXT NOT NULL,
    utcDateModified TEXT NOT NULL,
    schedulerConfig TEXT NOT NULL DEFAULT '{"requestRetention":0.9,"maximumInterval":36500,"enableFuzz":true,"enableShortTerm":true,"learningSteps":["1m","10m"],"relearningSteps":["10m"],"dailyNewCardLimit":20,"dailyReviewLimit":200,"dayRolloverHour":4,"weights":null}'
);
CREATE INDEX IDX_flashcard_reviews_card_reviewedAt ON flashcard_reviews (cardId, reviewedAt);
CREATE INDEX IDX_flashcard_reviews_reviewedAt ON flashcard_reviews (reviewedAt);
CREATE UNIQUE INDEX IDX_flashcard_reviews_clientRequestId
    ON flashcard_reviews (clientRequestId)
    WHERE clientRequestId IS NOT NULL;

CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    data TEXT,
    expires INTEGER
);
