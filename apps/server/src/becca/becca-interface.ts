import sql from "../services/sql.js";
import log from "../services/log.js";
import { formatSize } from "../services/utils.js";
import NoteSet from "../services/search/note_set.js";
import NotFoundError from "../errors/not_found_error.js";
import type BOption from "./entities/boption.js";
import type BNote from "./entities/bnote.js";
import type BEtapiToken from "./entities/betapi_token.js";
import type BAttribute from "./entities/battribute.js";
import type BBranch from "./entities/bbranch.js";
import BRevision from "./entities/brevision.js";
import BAttachment from "./entities/battachment.js";
import type { AttachmentRow, BlobRow, RevisionRow } from "@triliumnext/commons";
import BBlob from "./entities/bblob.js";
import BRecentNote from "./entities/brecent_note.js";
import type AbstractBeccaEntity from "./entities/abstract_becca_entity.js";

/**
 * Becca is a backend cache of all notes, branches, and attributes.
 * There's a similar frontend cache Froca, and share cache Shaca.
 */
export default class Becca {
    loaded!: boolean;

    notes!: Record<string, BNote>;
    branches!: Record<string, BBranch>;
    childParentToBranch!: Record<string, BBranch>;
    attributes!: Record<string, BAttribute>;
    /** Points from attribute type-name to list of attributes */
    attributeIndex!: Record<string, BAttribute[]>;
    options!: Record<string, BOption>;
    etapiTokens!: Record<string, BEtapiToken>;

    allNoteSetCache: NoteSet | null;

    /**
     * Pre-built parallel arrays for fast flat text scanning in search.
     * Avoids per-note property access overhead when iterating 50K+ notes.
     * Supports incremental updates: when individual notes change, only their
     * entries are rebuilt rather than the entire index.
     */
    flatTextIndex: { notes: BNote[], flatTexts: string[], noteIdToIdx: Map<string, number> } | null;

    /** NoteIds whose flat text needs to be recomputed in the index. */
    dirtyFlatTextNoteIds: Set<string>;

    constructor() {
        this.dirtyFlatTextNoteIds = new Set();
        this.allNoteSetCache = null;
        this.flatTextIndex = null;
        this.reset();
    }

    reset() {
        this.notes = {};
        this.branches = {};
        this.childParentToBranch = {};
        this.attributes = {};
        this.attributeIndex = {};
        this.options = {};
        this.etapiTokens = {};

        this.dirtyNoteSetCache();

        this.loaded = false;
    }

    getRoot() {
        return this.getNote("root");
    }

    findAttributes(type: string, name: string): BAttribute[] {
        name = name.trim().toLowerCase();

        if (name.startsWith("#") || name.startsWith("~")) {
            name = name.substr(1);
        }

        const key = `${type}-${name}`;
        return Object.hasOwn(this.attributeIndex, key) ? this.attributeIndex[key] : [];
    }

    findAttributesWithPrefix(type: string, name: string): BAttribute[] {
        const resArr: BAttribute[][] = [];
        const key = `${type}-${name}`;

        for (const idx in this.attributeIndex) {
            if (idx.startsWith(key)) {
                resArr.push(this.attributeIndex[idx]);
            }
        }

        return resArr.flat();
    }

    decryptProtectedNotes() {
        for (const note of Object.values(this.notes)) {
            note.decrypt();
        }
    }

    addNote(noteId: string, note: BNote) {
        this.notes[noteId] = note;
        this.dirtyNoteSetCache();
    }

    getNote(noteId: string): BNote | null {
        return Object.hasOwn(this.notes, noteId) ? this.notes[noteId] : null;
    }

    getNoteOrThrow(noteId: string): BNote {
        const note = Object.hasOwn(this.notes, noteId) ? this.notes[noteId] : null;
        if (!note) {
            throw new NotFoundError(`Note '${noteId}' doesn't exist.`);
        }

        return note;
    }

    getNotes(noteIds: string[], ignoreMissing: boolean = false): BNote[] {
        const filteredNotes: BNote[] = [];

        for (const noteId of noteIds) {
            const note = Object.hasOwn(this.notes, noteId) ? this.notes[noteId] : null;

            if (!note) {
                if (ignoreMissing) {
                    continue;
                }

                throw new Error(`Note '${noteId}' was not found in becca.`);
            }

            filteredNotes.push(note);
        }

        return filteredNotes;
    }

    getBranch(branchId: string): BBranch | null {
        return Object.hasOwn(this.branches, branchId) ? this.branches[branchId] : null;
    }

    getBranchOrThrow(branchId: string): BBranch {
        const branch = this.getBranch(branchId);
        if (!branch) {
            throw new NotFoundError(`Branch '${branchId}' was not found in becca.`);
        }
        return branch;
    }

    getAttribute(attributeId: string): BAttribute | null {
        return Object.hasOwn(this.attributes, attributeId) ? this.attributes[attributeId] : null;
    }

    getAttributeOrThrow(attributeId: string): BAttribute {
        const attribute = this.getAttribute(attributeId);
        if (!attribute) {
            throw new NotFoundError(`Attribute '${attributeId}' does not exist.`);
        }

        return attribute;
    }

    getBranchFromChildAndParent(childNoteId: string, parentNoteId: string): BBranch | null {
        const key = `${childNoteId}-${parentNoteId}`;
        return Object.hasOwn(this.childParentToBranch, key) ? this.childParentToBranch[key] : null;
    }

    getRevision(revisionId: string): BRevision | null {
        const row = sql.getRow<RevisionRow | null>("SELECT * FROM revisions WHERE revisionId = ?", [revisionId]);
        return row ? new BRevision(row) : null;
    }

    getRevisionOrThrow(revisionId: string): BRevision {
        const revision = this.getRevision(revisionId);
        if (!revision) {
            throw new NotFoundError(`Revision '${revisionId}' has not been found.`);
        }
        return revision;
    }

    getAttachment(attachmentId: string): BAttachment | null {
        const query = /*sql*/`\
            SELECT attachments.*, LENGTH(blobs.content) AS contentLength
            FROM attachments
            JOIN blobs USING (blobId)
            WHERE attachmentId = ? AND isDeleted = 0`;

        return sql.getRows<AttachmentRow>(query, [attachmentId]).map((row) => new BAttachment(row))[0];
    }

    getAttachmentOrThrow(attachmentId: string): BAttachment {
        const attachment = this.getAttachment(attachmentId);
        if (!attachment) {
            throw new NotFoundError(`Attachment '${attachmentId}' has not been found.`);
        }
        return attachment;
    }

    getAttachments(attachmentIds: string[]): BAttachment[] {
        return sql.getManyRows<AttachmentRow>("SELECT * FROM attachments WHERE attachmentId IN (???) AND isDeleted = 0", attachmentIds).map((row) => new BAttachment(row));
    }

    getBlob(entity: { blobId?: string }): BBlob | null {
        if (!entity.blobId) {
            return null;
        }

        const row = sql.getRow<BlobRow | null>("SELECT *, LENGTH(content) AS contentLength FROM blobs WHERE blobId = ?", [entity.blobId]);
        return row ? new BBlob(row) : null;
    }

    getOption(name: string): BOption | null {
        return Object.hasOwn(this.options, name) ? this.options[name] : null;
    }

    getEtapiTokens(): BEtapiToken[] {
        return Object.values(this.etapiTokens);
    }

    getEtapiToken(etapiTokenId: string): BEtapiToken | null {
        return Object.hasOwn(this.etapiTokens, etapiTokenId) ? this.etapiTokens[etapiTokenId] : null;
    }

    getEntity<T extends AbstractBeccaEntity<T>>(entityName: string, entityId: string): AbstractBeccaEntity<T> | null {
        if (!entityName || !entityId) {
            return null;
        }

        if (entityName === "revisions") {
            return this.getRevision(entityId);
        } else if (entityName === "attachments") {
            return this.getAttachment(entityId);
        }

        const camelCaseEntityName = entityName.toLowerCase().replace(/(_[a-z])/g, (group) => group.toUpperCase().replace("_", ""));

        if (!(camelCaseEntityName in this)) {
            throw new Error(`Unknown entity name '${camelCaseEntityName}' (original argument '${entityName}')`);
        }

        const collection = (this as any)[camelCaseEntityName];
        return Object.hasOwn(collection, entityId) ? collection[entityId] : null;
    }

    getRecentNotesFromQuery(query: string, params: string[] = []): BRecentNote[] {
        const rows = sql.getRows<BRecentNote>(query, params);
        return rows.map((row) => new BRecentNote(row));
    }

    getRevisionsFromQuery(query: string, params: string[] = []): BRevision[] {
        const rows = sql.getRows<RevisionRow>(query, params);
        return rows.map((row) => new BRevision(row));
    }

    /** Should be called when the set of all non-skeleton notes changes (added/removed) */
    dirtyNoteSetCache() {
        this.allNoteSetCache = null;
        // Full rebuild needed since the note set itself changed
        this.flatTextIndex = null;
        this.dirtyFlatTextNoteIds.clear();
    }

    /** Mark a single note's flat text as needing recomputation in the index. */
    dirtyNoteFlatText(noteId: string) {
        if (this.flatTextIndex) {
            // Index exists — schedule an incremental update
            this.dirtyFlatTextNoteIds.add(noteId);
        }
        // If flatTextIndex is null, full rebuild will happen on next access anyway
    }

    /**
     * Returns pre-built parallel arrays of notes and their flat texts for fast scanning.
     * The flat texts are already normalized (lowercase, diacritics removed).
     * Supports incremental updates: when individual notes are dirtied, only their
     * entries are recomputed rather than rebuilding the entire index.
     */
    getFlatTextIndex(): { notes: BNote[], flatTexts: string[], noteIdToIdx: Map<string, number> } {
        if (!this.flatTextIndex) {
            // Measure heap before building
            const heapBefore = process.memoryUsage().heapUsed;

            const allNoteSet = this.getAllNoteSet();
            const notes: BNote[] = [];
            const flatTexts: string[] = [];
            const noteIdToIdx = new Map<string, number>();

            for (const note of allNoteSet.notes) {
                noteIdToIdx.set(note.noteId, notes.length);
                notes.push(note);
                flatTexts.push(note.getFlatText());
            }

            this.flatTextIndex = { notes, flatTexts, noteIdToIdx };
            this.dirtyFlatTextNoteIds.clear();

            // Measure heap after building and log
            const heapAfter = process.memoryUsage().heapUsed;
            const heapDelta = heapAfter - heapBefore;
            log.info(`Flat text search index built: ${notes.length} notes, ${formatSize(heapDelta)}`);
        } else if (this.dirtyFlatTextNoteIds.size > 0) {
            // Incremental update: only recompute flat texts for dirtied notes
            const { flatTexts, noteIdToIdx } = this.flatTextIndex;

            for (const noteId of this.dirtyFlatTextNoteIds) {
                const idx = noteIdToIdx.get(noteId);
                if (idx !== undefined) {
                    const note = this.notes[noteId];
                    if (note) {
                        flatTexts[idx] = note.getFlatText();
                    }
                }
            }

            this.dirtyFlatTextNoteIds.clear();
        }

        return this.flatTextIndex;
    }

    getAllNoteSet() {
        // caching this since it takes 10s of milliseconds to fill this initial NoteSet for many notes
        if (!this.allNoteSetCache) {
            const allNotes: BNote[] = [];

            for (const noteId in this.notes) {
                const note = this.notes[noteId];

                // in the process of loading data sometimes we create "skeleton" note instances which are expected to be filled later
                // in case of inconsistent data this might not work and search will then crash on these
                if (note.type !== undefined) {
                    allNotes.push(note);
                }
            }

            this.allNoteSetCache = new NoteSet(allNotes);
        }

        return this.allNoteSetCache;
    }
}

/**
 * This interface contains the data that is shared across all the objects of a given derived class of {@link AbstractBeccaEntity}.
 * For example, all BAttributes will share their content, but all BBranches will have another set of this data.
 */
export interface ConstructorData<T extends AbstractBeccaEntity<T>> {
    primaryKeyName: string;
    entityName: string;
    hashedProperties: (keyof T)[];
}

export interface NotePojo {
    noteId: string;
    title?: string;
    isProtected?: boolean;
    type: string;
    mime: string;
    blobId?: string;
    isDeleted: boolean;
    dateCreated?: string;
    dateModified?: string;
    utcDateCreated: string;
    utcDateModified?: string;
}
