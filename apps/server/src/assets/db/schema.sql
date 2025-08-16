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
CREATE INDEX IDX_branches_parentNoteId ON branches (parentNoteId);
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
                                               `contentLocation`	TEXT NOT NULL DEFAULT 'internal',
                                               `contentLength`	INTEGER NOT NULL DEFAULT 0,
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


CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    data TEXT,
    expires INTEGER
);
