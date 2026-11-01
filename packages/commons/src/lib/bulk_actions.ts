/**
 * The available note-format conversions, shared between the client (combo box options) and the
 * server (the `convertNote` bulk action handler). Add a new entry here, a matching option label
 * on the client, and a registry entry on the server to introduce a new conversion.
 */
export const NOTE_CONVERSION_IDS = ["htmlToMarkdown", "markdownToHtml"] as const;

export type NoteConversionId = (typeof NOTE_CONVERSION_IDS)[number];

/**
 * Conversions that are lossy: the target format cannot represent everything the source format can,
 * so formatting may be lost or unsupported elements dropped. These get a stronger confirmation prompt.
 */
export const RISKY_NOTE_CONVERSION_IDS: readonly NoteConversionId[] = ["htmlToMarkdown"];

export type ActionHandlers = {
    addLabel: {
        labelName: string;
        labelValue?: string;
    },
    addRelation: {
        relationName: string;
        targetNoteId: string;
    },
    deleteNote: {},
    saveRevision: {
        revisionName?: string;
    },
    deleteRevisions: {},
    deleteLabel: {
        labelName: string;
    },
    deleteRelation: {
        relationName: string;
    },
    renameNote: {
        newTitle: string;
    },
    renameLabel: {
        oldLabelName: string;
        newLabelName: string;
    },
    renameRelation: {
        oldRelationName: string;
        newRelationName: string;
    },
    updateLabelValue: {
        labelName: string;
        labelValue: string;
    },
    updateRelationTarget: {
        relationName: string;
        targetNoteId: string;
    },
    moveNote: {
        targetParentNoteId: string;
    },
    executeScript: {
        script: string;
    },
    convertNote: {
        conversion: NoteConversionId;
    }
};

export type BulkActionData<T extends keyof ActionHandlers> = ActionHandlers[T] & { name: T };

export type BulkAction = {
  [K in keyof ActionHandlers]: { name: K; } & ActionHandlers[K];
}[keyof ActionHandlers];
