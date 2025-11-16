import type { AttachmentRow, EtapiTokenRow, NoteType, OptionNames } from "@triliumnext/commons";
import type { AttributeType } from "../entities/fattribute.js";
import type { EntityChange } from "../server_types.js";

// TODO: Deduplicate with server.

interface NoteRow {
    blobId: string;
    dateCreated: string;
    dateModified: string;
    isDeleted?: boolean;
    isProtected?: boolean;
    mime: string;
    noteId: string;
    title: string;
    type: NoteType;
    utcDateCreated: string;
    utcDateModified: string;
}

// TODO: Deduplicate with BranchRow from `rows.ts`/
export interface BranchRow {
    noteId?: string;
    branchId: string;
    componentId: string;
    parentNoteId?: string;
    isDeleted?: boolean;
    isExpanded?: boolean;
}

export interface AttributeRow {
    noteId?: string;
    attributeId: string;
    componentId: string;
    isInheritable?: boolean;
    isDeleted?: boolean;
    name?: string;
    value?: string;
    type?: AttributeType;
}

interface RevisionRow {
    revisionId: string;
    noteId?: string;
    componentId?: string | null;
}

interface ContentNoteIdToComponentIdRow {
    noteId: string;
    componentId: string;
}

interface OptionRow {}

interface NoteReorderingRow {}



type EntityRowMappings = {
    notes: NoteRow;
    branches: BranchRow;
    attributes: AttributeRow;
    options: OptionRow;
    revisions: RevisionRow;
    note_reordering: NoteReorderingRow;
    etapi_tokens: EtapiTokenRow;
};

export type EntityRowNames = keyof EntityRowMappings;

export default class LoadResults {
    private entities: Record<keyof EntityRowMappings, Record<string, any>>;
    private noteIdToComponentId: Record<string, string[]>;
    private componentIdToNoteIds: Record<string, string[]>;
    private branchRows: BranchRow[];
    private attributeRows: AttributeRow[];
    private revisionRows: RevisionRow[];
    private noteReorderings: string[];
    private contentNoteIdToComponentId: ContentNoteIdToComponentIdRow[];
    private optionNames: OptionNames[];
    private attachmentRows: AttachmentRow[];
    public hasEtapiTokenChanges: boolean = false;

    constructor(entityChanges: EntityChange[]) {
        const entities: Record<string, Record<string, any>> = {};

        for (const { entityId, entityName, entity } of entityChanges) {
            if (entity) {
                entities[entityName] = entities[entityName] || [];
                entities[entityName][entityId] = entity;
            }
        }
        this.entities = entities;

        this.noteIdToComponentId = {};
        this.componentIdToNoteIds = {};

        this.branchRows = [];

        this.attributeRows = [];

        this.noteReorderings = [];

        this.revisionRows = [];

        this.contentNoteIdToComponentId = [];

        this.optionNames = [];

        this.attachmentRows = [];
    }

    getEntityRow<T extends EntityRowNames>(entityName: T, entityId: string): EntityRowMappings[T] {
        return this.entities[entityName]?.[entityId];
    }

    addNote(noteId: string, componentId?: string | null) {
        this.noteIdToComponentId[noteId] = this.noteIdToComponentId[noteId] || [];

        if (componentId) {
            if (!this.noteIdToComponentId[noteId].includes(componentId)) {
                this.noteIdToComponentId[noteId].push(componentId);
            }

            this.componentIdToNoteIds[componentId] = this.componentIdToNoteIds[componentId] || [];

            if (this.componentIdToNoteIds[componentId]) {
                this.componentIdToNoteIds[componentId].push(noteId);
            }
        }
    }

    addBranch(branchId: string, componentId: string) {
        this.branchRows.push({ branchId, componentId });
    }

    getBranchRows() {
        return this.branchRows.map((row) => this.getEntityRow("branches", row.branchId)).filter((branch) => !!branch);
    }

    addNoteReordering(parentNoteId: string, componentId: string) {
        this.noteReorderings.push(parentNoteId);
    }

    getNoteReorderings() {
        return this.noteReorderings;
    }

    addAttribute(attributeId: string, componentId: string) {
        this.attributeRows.push({ attributeId, componentId });
    }

    getAttributeRows(componentId = "none"): AttributeRow[] {
        return this.attributeRows
            .filter((row) => row.componentId !== componentId)
            .map((row) => this.getEntityRow("attributes", row.attributeId))
            .filter((attr) => !!attr) as AttributeRow[];
    }

    addRevision(revisionId: string, noteId?: string, componentId?: string | null) {
        this.revisionRows.push({ revisionId, noteId, componentId });
    }

    hasRevisionForNote(noteId: string) {
        return !!this.revisionRows.find((row) => row.noteId === noteId);
    }

    getNoteIds() {
        return Object.keys(this.noteIdToComponentId);
    }

    isNoteReloaded(noteId: string | undefined | null, componentId: string | null = null) {
        if (!noteId) {
            return false;
        }

        const componentIds = this.noteIdToComponentId[noteId];
        return componentIds && componentIds.find((sId) => sId !== componentId) !== undefined;
    }

    addNoteContent(noteId: string, componentId: string) {
        this.contentNoteIdToComponentId.push({ noteId, componentId });
    }

    isNoteContentReloaded(noteId: string, componentId?: string) {
        if (!noteId) {
            return false;
        }

        return this.contentNoteIdToComponentId.find((l) => l.noteId === noteId && l.componentId !== componentId);
    }

    addOption(name: OptionNames) {
        this.optionNames.push(name);
    }

    isOptionReloaded(name: OptionNames) {
        return this.optionNames.includes(name);
    }

    getOptionNames() {
        return this.optionNames;
    }

    addAttachmentRow(attachment: AttachmentRow) {
        this.attachmentRows.push(attachment);
    }

    getAttachmentRows() {
        return this.attachmentRows;
    }

    /**
     * @returns {boolean} true if there are changes which could affect the attributes (including inherited ones)
     *          notably changes in note itself should not have any effect on attributes
     */
    hasAttributeRelatedChanges() {
        return this.branchRows.length > 0 || this.attributeRows.length > 0;
    }

    isEmpty() {
        return (
            Object.keys(this.noteIdToComponentId).length === 0 &&
            this.branchRows.length === 0 &&
            this.attributeRows.length === 0 &&
            this.noteReorderings.length === 0 &&
            this.revisionRows.length === 0 &&
            this.contentNoteIdToComponentId.length === 0 &&
            this.optionNames.length === 0 &&
            this.attachmentRows.length === 0 &&
            !this.hasEtapiTokenChanges
        );
    }

    isEmptyForTree() {
        return Object.keys(this.noteIdToComponentId).length === 0 && this.branchRows.length === 0 && this.attributeRows.length === 0 && this.noteReorderings.length === 0;
    }
}
