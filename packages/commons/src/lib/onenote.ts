/**
 * Shared OneNote importer types, used by both the client (import dialog and service) and the server
 * (Graph client and importer). Keeping them in one place keeps the import payload type-safe end to end
 * rather than relying on two hand-kept copies staying in sync.
 */

export interface OneNoteSection {
    id: string;
    title: string;
    createdDateTime?: string;
    lastModifiedDateTime?: string;
}

export interface OneNoteSectionGroup {
    id: string;
    title: string;
    createdDateTime?: string;
    lastModifiedDateTime?: string;
    sections: OneNoteSection[];
    sectionGroups: OneNoteSectionGroup[];
}

export interface OneNoteNotebook {
    id: string;
    title: string;
    createdDateTime?: string;
    lastModifiedDateTime?: string;
    sections: OneNoteSection[];
    sectionGroups: OneNoteSectionGroup[];
}

/** A section group on the path from the notebook down to a selected section, recreated as a folder. */
export interface OneNoteFolderRef {
    id: string;
    title: string;
    createdDateTime?: string;
    lastModifiedDateTime?: string;
}

/**
 * A section the user chose to import, carrying the notebook and section-group path (notebook root down
 * to the section's immediate group) the server needs to recreate the folder nesting.
 */
export interface OneNoteSectionSelection {
    id: string;
    title: string;
    createdDateTime?: string;
    lastModifiedDateTime?: string;
    groupPath: OneNoteFolderRef[];
    notebookId: string;
    notebookTitle: string;
    notebookCreatedDateTime?: string;
    notebookLastModifiedDateTime?: string;
}
