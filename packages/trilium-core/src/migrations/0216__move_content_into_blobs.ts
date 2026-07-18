import { getSql } from "../services/sql/index";
import { hashedBlobId } from "../services/utils/index";

interface NoteContentsRow {
    noteId: string;
    content: string | Buffer;
    dateModified: string;
    utcDateModified: string;
}

interface NoteRevisionContents {
    noteRevisionId: string;
    content: string | Buffer;
    utcDateModified: string;
}

export default () => {
    const existingBlobIds = new Set();

    const sql = getSql();
    for (const noteId of sql.getColumn<string>(/*sql*/`SELECT noteId FROM note_contents`)) {
        const row = sql.getRow<NoteContentsRow>(/*sql*/`SELECT noteId, content, dateModified, utcDateModified FROM note_contents WHERE noteId = ?`, [noteId]);
        const blobId = hashedBlobId(row.content);

        if (!existingBlobIds.has(blobId)) {
            existingBlobIds.add(blobId);

            sql.insert("blobs", {
                blobId,
                content: row.content,
                dateModified: row.dateModified,
                utcDateModified: row.utcDateModified
            });

            sql.execute("UPDATE entity_changes SET entityName = 'blobs', entityId = ? WHERE entityName = 'note_contents' AND entityId = ?", [blobId, row.noteId]);
        } else {
            // duplicates
            sql.execute("DELETE FROM entity_changes WHERE entityName = 'note_contents' AND entityId = ?", [row.noteId]);
        }

        sql.execute("UPDATE notes SET blobId = ? WHERE noteId = ?", [blobId, row.noteId]);
    }

    for (const noteRevisionId of sql.getColumn(/*sql*/`SELECT noteRevisionId FROM note_revision_contents`)) {
        const row = sql.getRow<NoteRevisionContents>(/*sql*/`SELECT noteRevisionId, content, utcDateModified FROM note_revision_contents WHERE noteRevisionId = ?`, [noteRevisionId]);
        const blobId = hashedBlobId(row.content);

        if (!existingBlobIds.has(blobId)) {
            existingBlobIds.add(blobId);

            sql.insert("blobs", {
                blobId,
                content: row.content,
                dateModified: row.utcDateModified,
                utcDateModified: row.utcDateModified
            });

            sql.execute("UPDATE entity_changes SET entityName = 'blobs', entityId = ? WHERE entityName = 'note_revision_contents' AND entityId = ?", [blobId, row.noteRevisionId]);
        } else {
            // duplicates
            sql.execute("DELETE FROM entity_changes WHERE entityName = 'note_revision_contents' AND entityId = ?", [row.noteRevisionId]);
        }

        sql.execute("UPDATE note_revisions SET blobId = ? WHERE noteRevisionId = ?", [blobId, row.noteRevisionId]);
    }

    const notesWithoutBlobIds = sql.getColumn("SELECT noteId FROM notes WHERE blobId IS NULL");
    if (notesWithoutBlobIds.length > 0) {
        throw new Error("BlobIds were not filled correctly in notes: " + JSON.stringify(notesWithoutBlobIds));
    }

    const noteRevisionsWithoutBlobIds = sql.getColumn("SELECT noteRevisionId FROM note_revisions WHERE blobId IS NULL");
    if (noteRevisionsWithoutBlobIds.length > 0) {
        throw new Error("BlobIds were not filled correctly in note revisions: " + JSON.stringify(noteRevisionsWithoutBlobIds));
    }
};
