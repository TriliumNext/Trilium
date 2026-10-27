import type { AttachmentRow, AttributeType, CloneResponse, EraseExcessRevisionsOptions, NoteRow, NoteType, RevisionRow, RevisionSource } from "@triliumnext/commons";
import { dayjs, getNoteIcon, isMarkdownMime } from "@triliumnext/commons";

import cloningService from "../../services/cloning.js";
import dateUtils from "../../services/utils/date.js";
import eraseService from "../../services/erase.js";
import eventService from "../../services/events.js";
import handlers from "../../services/handlers.js";
import noteService from "../../services/notes.js";
import optionService from "../../services/options.js";
import protectedSessionService from "../../services/protected_session.js";
import searchService from "../../services/search/services/search.js";
import { normalizeSearchText, tokenizeNormalizedText } from "../../services/search/utils/text_utils.js";
import TaskContext from "../../services/task_context.js";
import type { NotePojo } from "../becca-interface.js";
import AbstractBeccaEntity from "./abstract_becca_entity.js";
import BAttachment from "./battachment.js";
import BAttribute from "./battribute.js";
import type BBranch from "./bbranch.js";
import BRevision from "./brevision.js";
import { getLog } from "../../services/log.js";
import { getSql } from "../../services/sql/index.js";
import { formatDownloadTitle, isStringNote, normalize, randomString, replaceAll } from "../../services/utils/index.js";
import { getVirtualNoteContent, isVirtualNoteContentWritable, setVirtualNoteContent } from "../../services/virtual_notes.js";

const LABEL = "label";
const RELATION = "relation";

interface NotePathRecord {
    isArchived: boolean;
    isInHoistedSubTree: boolean;
    notePath: string[];
    isHidden: boolean;
}

interface ContentOpts {
    /** will also save this BNote entity */
    forceSave?: boolean;
    /** override frontend heuristics on when to reload, instruct to reload */
    forceFrontendReload?: boolean;
}

interface Relationship {
    parentNoteId: string;
    childNoteId: string;
}

interface ConvertOpts {
    /** if true, the action is not triggered by user, but e.g. by migration, and only perfect candidates will be migrated */
    autoConversion?: boolean;
}

/** A note's title in the two forms scoring needs, cached together since both derive from it. */
export interface SearchableTitle {
    normalized: string;
    words: string[];
    /** The title lowercased with its diacritics kept, or `null` when it has none. */
    accented: string | null;
}

/**
 * Trilium's main entity, which can represent text note, image, code note, file attachment etc.
 */
class BNote extends AbstractBeccaEntity<BNote> {
    static get entityName() {
        return "notes";
    }
    static get primaryKeyName() {
        return "noteId";
    }
    static get hashedProperties() {
        return ["noteId", "title", "isProtected", "type", "mime", "blobId"];
    }

    noteId!: string;
    title!: string;
    type!: NoteType;
    mime!: string;
    /** set during the deletion operation, before it is completed (removed from becca completely). */
    isBeingDeleted!: boolean;
    isDecrypted!: boolean;

    ownedAttributes!: BAttribute[];
    parentBranches!: BBranch[];
    parents!: BNote[];
    children!: BNote[];
    targetRelations!: BAttribute[];

    __flatTextCache!: string | null;
    __searchableTitleCache: SearchableTitle | null = null;

    private __attributeCache!: BAttribute[] | null;
    private __isArchivedCache: boolean | null = null;
    private __inheritableAttributeCache!: BAttribute[] | null;
    private __ancestorCache!: BNote[] | null;

    // following attributes are filled during searching in the database
    contentSize!: number | null;
    contentAndAttachmentsSize!: number | null;
    contentAndAttachmentsAndRevisionsSize!: number | null;
    revisionCount!: number | null;

    constructor(row?: Partial<NoteRow>) {
        super();

        if (!row) {
            return;
        }

        this.updateFromRow(row);
        this.init();
    }

    updateFromRow(row: Partial<NoteRow>) {
        this.update([row.noteId, row.title, row.type, row.mime, row.isProtected, row.blobId, row.dateCreated, row.dateModified, row.utcDateCreated, row.utcDateModified]);
    }

    update([noteId, title, type, mime, isProtected, blobId, dateCreated, dateModified, utcDateCreated, utcDateModified]: any) {
        // ------ Database persisted attributes ------

        this.noteId = noteId;
        this.title = title;
        this.type = type;
        this.mime = mime;
        this.isProtected = !!isProtected;
        this.blobId = blobId;
        this.dateCreated = dateCreated || dateUtils.localNowDateTime();
        this.dateModified = dateModified;
        this.utcDateCreated = utcDateCreated || dateUtils.utcNowDateTime();
        this.utcDateModified = utcDateModified;
        this.isBeingDeleted = false;

        // ------ Derived attributes ------

        this.isDecrypted = !this.noteId || !this.isProtected;

        this.decrypt();

        this.__flatTextCache = null;
        this.__searchableTitleCache = null;

        return this;
    }

    override init() {
        this.parentBranches = [];
        this.parents = [];
        this.children = [];
        this.ownedAttributes = [];
        this.__attributeCache = null;
        this.__isArchivedCache = null;
        this.__inheritableAttributeCache = null;
        this.targetRelations = [];

        this.becca.addNote(this.noteId, this);
        this.__ancestorCache = null;

        this.contentSize = null;
        this.contentAndAttachmentsSize = null;
        this.contentAndAttachmentsAndRevisionsSize = null;
        this.revisionCount = null;
    }

    isContentAvailable() {
        return (
            !this.noteId || // new note which was not encrypted yet
            !this.isProtected ||
            protectedSessionService.isProtectedSessionAvailable()
        );
    }

    getTitleOrProtected() {
        return this.isContentAvailable() ? this.title : "[protected]";
    }

    getParentBranches() {
        return this.parentBranches;
    }

    getStrongParentBranches() {
        return this.getParentBranches().filter((branch) => !branch.isWeak);
    }

    getBranches() {
        return this.parentBranches;
    }

    getParentNotes() {
        return this.parents;
    }

    getChildNotes() {
        return this.children;
    }

    hasChildren() {
        return this.children && this.children.length > 0;
    }

    getChildBranches(): BBranch[] {
        return this.children.map((childNote) => this.becca.getBranchFromChildAndParent(childNote.noteId, this.noteId)) as BBranch[];
    }

    /**
     * Note content has quite special handling - it's not a separate entity, but a lazily loaded
     * part of Note entity with its own sync. Reasons behind this hybrid design has been:
     *
     * - content can be quite large, and it's not necessary to load it / fill memory for any note access even if we don't need a content, especially for bulk operations like search
     * - changes in the note metadata or title should not trigger note content sync (so we keep separate utcDateModified and entity changes records)
     * - but to the user note content and title changes are one and the same - single dateModified (so all changes must go through Note and content is not a separate entity)
     */
    getContent() {
        if (this.isVirtual) {
            // Virtual notes have no blob row; content (if any) comes from their provider.
            return getVirtualNoteContent(this.noteId);
        }

        return this._getContent();
    }

    getJsonContent(): any | null {
        const content = this.getContent();

        if (typeof content !== "string" || !content || !content.trim()) {
            return null;
        }

        return JSON.parse(content);
    }

    getJsonContentSafely() {
        try {
            return this.getJsonContent();
        } catch (e) {
            return null;
        }
    }

    setContent(content: Uint8Array | string, opts: ContentOpts = {}) {
        if (this.isVirtual) {
            setVirtualNoteContent(this.noteId, content);
            return;
        }

        this._setContent(content, opts);

        eventService.emit(eventService.NOTE_CONTENT_CHANGE, { entity: this });
    }

    /** Whether the content can be saved: always for a persisted note, per provider for a virtual one. */
    isContentWritable() {
        return !this.isVirtual || isVirtualNoteContentWritable(this.noteId);
    }

    setJsonContent(content: {}) {
        this.setContent(JSON.stringify(content, null, "\t"));
    }

    get dateCreatedObj() {
        return this.dateCreated === null ? null : dayjs(this.dateCreated);
    }

    get utcDateCreatedObj() {
        return this.utcDateCreated === null ? null : dayjs.utc(this.utcDateCreated);
    }

    get dateModifiedObj() {
        return this.dateModified === null ? null : dayjs(this.dateModified);
    }

    get utcDateModifiedObj() {
        return this.utcDateModified === null ? null : dayjs.utc(this.utcDateModified);
    }

    isRoot() {
        return this.noteId === "root";
    }

    isJson() {
        return this.mime === "application/json";
    }

    isJavaScript() {
        return (
            (this.type === "code" || this.type === "file" || this.type === "launcher") &&
            (this.mime.startsWith("application/javascript") || this.mime === "application/x-javascript" || this.mime === "text/javascript")
        );
    }

    isJsx() {
        return (this.type === "code" && this.mime === "text/jsx");
    }

    isHtml() {
        return ["code", "file", "render"].includes(this.type) && this.mime === "text/html";
    }

    isMarkdown() {
        return this.type === "code" && isMarkdownMime(this.mime);
    }

    isImage() {
        return this.type === "image" || (this.type === "file" && this.mime?.startsWith("image/"));
    }

    isStringNote() {
        return this.hasStringContent();
    }

    override hasStringContent() {
        return isStringNote(this.type, this.mime);
    }

    getScriptEnv() {
        if (this.isHtml() || (this.isJavaScript() && this.mime.endsWith("env=frontend")) || this.isJsx()) {
            return "frontend";
        }

        if (this.type === "render") {
            return "frontend";
        }

        if (this.isJavaScript() && this.mime.endsWith("env=backend")) {
            return "backend";
        }

        return null;
    }

    executeScript() {
        // Lazy require to avoid circular dependency (script.ts imports BNote as a type).
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const scriptService = require("../../services/script.js").default;
        return scriptService.executeNote(this, { originEntity: this });
    }

    getAttributes(type?: string, name?: string): BAttribute[] {
        this.__validateTypeName(type, name);
        this.__ensureAttributeCacheIsAvailable();

        /* v8 ignore next 3 -- defensive: cache is always populated by __ensureAttributeCacheIsAvailable */
        if (!this.__attributeCache) {
            throw new Error("Attribute cache not available.");
        }

        if (type && name) {
            return this.__attributeCache.filter((attr) => attr.name === name && attr.type === type);
        } else if (type) {
            return this.__attributeCache.filter((attr) => attr.type === type);
        } else if (name) {
            return this.__attributeCache.filter((attr) => attr.name === name);
        }
        return this.__attributeCache;
    }

    private __ensureAttributeCacheIsAvailable() {
        if (!this.__attributeCache) {
            this.__getAttributes([]);
        }
    }

    private __getAttributes(path: string[]) {
        if (path.includes(this.noteId)) {
            return [];
        }

        if (!this.__attributeCache) {
            const parentAttributes = this.ownedAttributes.slice();
            const newPath = [...path, this.noteId];

            // inheritable attrs on root are typically not intended to be applied to hidden subtree #3537
            if (this.noteId !== "root" && this.noteId !== "_hidden") {
                for (const parentNote of this.parents) {
                    parentAttributes.push(...parentNote.__getInheritableAttributes(newPath));
                }
            }

            const templateAttributes: BAttribute[] = [];

            for (const ownedAttr of parentAttributes) {
                // parentAttributes so we process also inherited templates
                if (ownedAttr.type === "relation" && ["template", "inherit"].includes(ownedAttr.name)) {
                    const templateNote = this.becca.notes[ownedAttr.value];

                    if (templateNote) {
                        templateAttributes.push(
                            ...templateNote
                                .__getAttributes(newPath)
                                // template attr is used as a marker for templates, but it's not meant to be inherited
                                .filter((attr) => !(attr.type === "label" && (attr.name === "template" || attr.name === "workspaceTemplate")))
                        );
                    }
                }
            }

            this.__attributeCache = [];

            const addedAttributeIds = new Set();

            for (const attr of parentAttributes.concat(templateAttributes)) {
                if (!addedAttributeIds.has(attr.attributeId)) {
                    addedAttributeIds.add(attr.attributeId);

                    this.__attributeCache.push(attr);
                }
            }

            this.__inheritableAttributeCache = [];

            for (const attr of this.__attributeCache) {
                if (attr.isInheritable) {
                    this.__inheritableAttributeCache.push(attr);
                }
            }
        }

        return this.__attributeCache;
    }

    private __getInheritableAttributes(path: string[]): BAttribute[] {
        if (path.includes(this.noteId)) {
            return [];
        }

        if (!this.__inheritableAttributeCache) {
            this.__getAttributes(path); // will refresh also this.__inheritableAttributeCache
        }

        /* v8 ignore next -- defensive: __getAttributes always sets the cache for a non-cyclic path */
        return this.__inheritableAttributeCache || [];
    }

    __validateTypeName(type?: string | null, name?: string | null) {
        if (type && type !== "label" && type !== "relation") {
            throw new Error(`Unrecognized attribute type '${type}'. Only 'label' and 'relation' are possible values.`);
        }

        if (name) {
            const firstLetter = name.charAt(0);
            if (firstLetter === "#" || firstLetter === "~") {
                throw new Error(`Detect '#' or '~' in the attribute's name. In the API, attribute names should be set without these characters.`);
            }
        }
    }

    hasAttribute(type: string, name: string, value: string | null = null): boolean {
        return !!this.getAttributes().find((attr) => attr.name === name && (value === undefined || value === null || attr.value === value) && attr.type === type);
    }

    getAttributeCaseInsensitive(type: string, name: string, value?: string | null) {
        name = name.toLowerCase();
        value = value ? value.toLowerCase() : null;

        return this.getAttributes().find((attr) => attr.name.toLowerCase() === name && (!value || attr.value.toLowerCase() === value) && attr.type === type);
    }

    getRelationTarget(name: string) {
        const relation = this.getAttributes().find((attr) => attr.name === name && attr.type === "relation");

        return relation ? relation.targetNote : null;
    }

    hasLabel(name: string, value?: string): boolean {
        return this.hasAttribute(LABEL, name, value);
    }

    isLabelTruthy(name: string): boolean {
        const label = this.getLabel(name);

        if (!label) {
            return false;
        }

        return label && label.value !== "false";
    }

    hasOwnedLabel(name: string, value?: string): boolean {
        return this.hasOwnedAttribute(LABEL, name, value);
    }

    hasRelation(name: string, value?: string): boolean {
        return this.hasAttribute(RELATION, name, value);
    }

    hasOwnedRelation(name: string, value?: string): boolean {
        return this.hasOwnedAttribute(RELATION, name, value);
    }

    getLabel(name: string): BAttribute | null {
        return this.getAttribute(LABEL, name);
    }

    getOwnedLabel(name: string): BAttribute | null {
        return this.getOwnedAttribute(LABEL, name);
    }

    getRelation(name: string): BAttribute | null {
        return this.getAttribute(RELATION, name);
    }

    getOwnedRelation(name: string): BAttribute | null {
        return this.getOwnedAttribute(RELATION, name);
    }

    getLabelValue(name: string): string | null {
        return this.getAttributeValue(LABEL, name);
    }

    getOwnedLabelValue(name: string): string | null {
        return this.getOwnedAttributeValue(LABEL, name);
    }

    getRelationValue(name: string): string | null {
        return this.getAttributeValue(RELATION, name);
    }

    getOwnedRelationValue(name: string): string | null {
        return this.getOwnedAttributeValue(RELATION, name);
    }

    hasOwnedAttribute(type: string, name: string, value?: string): boolean {
        return !!this.getOwnedAttribute(type, name, value);
    }

    getAttribute(type: string, name: string): BAttribute | null {
        const attributes = this.getAttributes();

        return attributes.find((attr) => attr.name === name && attr.type === type) || null;
    }

    getAttributeValue(type: string, name: string): string | null {
        const attr = this.getAttribute(type, name);

        return attr ? attr.value : null;
    }

    getOwnedAttributeValue(type: string, name: string): string | null {
        const attr = this.getOwnedAttribute(type, name);

        return attr ? attr.value : null;
    }

    getLabels(name?: string): BAttribute[] {
        return this.getAttributes(LABEL, name);
    }

    getLabelValues(name: string): string[] {
        return this.getLabels(name).map((l) => l.value);
    }

    getOwnedLabels(name: string): BAttribute[] {
        return this.getOwnedAttributes(LABEL, name);
    }

    getOwnedLabelValues(name: string): string[] {
        return this.getOwnedAttributes(LABEL, name).map((l) => l.value);
    }

    getRelations(name?: string): BAttribute[] {
        return this.getAttributes(RELATION, name);
    }

    getOwnedRelations(name?: string | null): BAttribute[] {
        return this.getOwnedAttributes(RELATION, name);
    }

    getOwnedAttributes(type: string | null = null, name: string | null = null, value: string | null = null) {
        this.__validateTypeName(type, name);

        if (type && name && value !== undefined && value !== null) {
            return this.ownedAttributes.filter((attr) => attr.name === name && attr.value === value && attr.type === type);
        } else if (type && name) {
            return this.ownedAttributes.filter((attr) => attr.name === name && attr.type === type);
        } else if (type) {
            return this.ownedAttributes.filter((attr) => attr.type === type);
        } else if (name) {
            return this.ownedAttributes.filter((attr) => attr.name === name);
        }
        return this.ownedAttributes;
    }

    getOwnedAttribute(type: string, name: string, value: string | null = null) {
        const attrs = this.getOwnedAttributes(type, name, value);

        return attrs.length > 0 ? attrs[0] : null;
    }

    get isArchived() {
        // Ranking a note path tests this for every note on it, so the attribute walk is cached
        // alongside the attributes it reads.
        if (this.__isArchivedCache === null) {
            this.__isArchivedCache = this.hasAttribute("label", "archived");
        }

        return this.__isArchivedCache;
    }

    areAllNotePathsArchived() {
        // there's a slight difference between note being itself archived and all its note paths being archived
        // - note is archived when it itself has an archived label or inherits it
        // - note does not have or inherit archived label, but each note path contains a note with (non-inheritable)
        //   archived label

        const bestNotePathRecord = this.getSortedNotePathRecords()[0];

        if (!bestNotePathRecord) {
            throw new Error(`No note path available for note '${this.noteId}'`);
        }

        return bestNotePathRecord.isArchived;
    }

    hasInheritableArchivedLabel() {
        for (const attr of this.getAttributes()) {
            if (attr.name === "archived" && attr.type === LABEL && attr.isInheritable) {
                return true;
            }
        }

        return false;
    }

    // will sort the parents so that the non-archived are first and archived at the end
    // this is done so that the non-archived paths are always explored as first when looking for note path
    sortParents() {
        this.parentBranches.sort((a, b) => {
            if (a.parentNote?.isArchived) {
                return 1;
            } else if (a.parentNote?.isHiddenCompletely()) {
                return 1;
            }
            return 0;
        });

        this.parents = this.parentBranches.map((branch) => branch.parentNote).filter((note) => !!note) as BNote[];
    }

    sortChildren() {
        if (this.children.length === 0) {
            return;
        }

        const becca = this.becca;

        this.children.sort((a, b) => {
            const aBranch = becca.getBranchFromChildAndParent(a.noteId, this.noteId);
            const bBranch = becca.getBranchFromChildAndParent(b.noteId, this.noteId);

            return (aBranch?.notePosition || 0) - (bBranch?.notePosition || 0) || 0;
        });
    }

    getFlatText() {
        if (!this.__flatTextCache) {
            this.__flatTextCache = `${this.noteId} ${this.type} ${this.mime} `;

            for (const branch of this.parentBranches) {
                if (branch.prefix) {
                    this.__flatTextCache += `${branch.prefix} `;
                }
            }

            this.__flatTextCache += `${this.title} `;

            for (const attr of this.getAttributes()) {
                // it's best to use space as separator since spaces are filtered from the search string by the tokenization into words
                this.__flatTextCache += `${attr.type === "label" ? "#" : "~"}${attr.name}`;

                if (attr.value) {
                    this.__flatTextCache += `=${attr.value}`;
                }

                this.__flatTextCache += " ";
            }

            this.__flatTextCache = normalize(this.__flatTextCache);
        }

        return this.__flatTextCache as string;
    }

    /**
     * The title normalized for search, plus its punctuation-stripped words. Scoring reads both for
     * every match it ranks, so they are derived once per title rather than once per result.
     */
    getSearchableTitle(): SearchableTitle {
        if (!this.__searchableTitleCache) {
            const normalized = normalizeSearchText(this.title);
            const lowercased = this.title.toLowerCase();
            this.__searchableTitleCache = {
                normalized,
                words: tokenizeNormalizedText(normalized),
                accented: lowercased === normalized ? null : lowercased
            };
        }

        return this.__searchableTitleCache;
    }

    invalidateThisCache() {
        this.__flatTextCache = null;
        this.__searchableTitleCache = null;

        this.__attributeCache = null;
        this.__isArchivedCache = null;
        this.__inheritableAttributeCache = null;
        this.__ancestorCache = null;

        // Mark only this note's flat text as dirty for incremental index update
        this.becca.dirtyNoteFlatText(this.noteId);
    }

    invalidateSubTree(path: string[] = []) {
        if (path.includes(this.noteId)) {
            return;
        }

        this.invalidateThisCache();

        if (this.children.length || this.targetRelations.length) {
            path = [...path, this.noteId];
        }

        for (const childNote of this.children) {
            childNote.invalidateSubTree(path);
        }

        for (const targetRelation of this.targetRelations) {
            if (targetRelation.name === "template" || targetRelation.name === "inherit") {
                const note = targetRelation.note;

                if (note) {
                    note.invalidateSubTree(path);
                }
            }
        }
    }

    getRelationDefinitions() {
        return this.getLabels().filter((l) => l.name.startsWith("relation:"));
    }

    getLabelDefinitions() {
        return this.getLabels().filter((l) => l.name.startsWith("relation:"));
    }

    isInherited() {
        return !!this.targetRelations.find((rel) => rel.name === "template" || rel.name === "inherit");
    }

    getSubtreeNotesIncludingTemplated(): BNote[] {
        const set = new Set<BNote>();

        function inner(note: BNote) {
            // _hidden is not counted as subtree for the purpose of inheritance
            if (set.has(note) || note.noteId === "_hidden") {
                return;
            }

            set.add(note);

            for (const childNote of note.children) {
                inner(childNote);
            }

            for (const targetRelation of note.targetRelations) {
                if (targetRelation.name === "template" || targetRelation.name === "inherit") {
                    const targetNote = targetRelation.note;

                    if (targetNote) {
                        inner(targetNote);
                    }
                }
            }
        }

        inner(this);

        return Array.from(set);
    }

    getSearchResultNotes(): BNote[] {
        if (this.type !== "search") {
            return [];
        }

        try {
            const result = searchService.searchFromNote(this);
            const becca = this.becca;
            return result.searchResultNoteIds.map((resultNoteId) => becca.notes[resultNoteId]).filter((note) => !!note);
        } catch (e: any) {
            getLog().error(`Could not resolve search note ${this.noteId}: ${e.message}`);
            return [];
        }
    }

    getSubtree({ includeArchived = true, includeHidden = false, resolveSearch = false } = {}): {
        notes: BNote[];
        relationships: Relationship[];
    } {
        const noteSet = new Set<BNote>();
        const relationships: Relationship[] = []; // list of tuples parentNoteId -> childNoteId

        function resolveSearchNote(searchNote: BNote) {
            try {
                for (const resultNote of searchNote.getSearchResultNotes()) {
                    addSubtreeNotesInner(resultNote, searchNote);
                }
            } catch (e: any) {
                getLog().error(`Could not resolve search note ${searchNote?.noteId}: ${e.message}`);
            }
        }

        function addSubtreeNotesInner(note: BNote, parentNote: BNote | null = null) {
            if (note.noteId === "_hidden" && !includeHidden) {
                return;
            }

            if (parentNote) {
                // this needs to happen first before noteSet check to include all clone relationships
                relationships.push({
                    parentNoteId: parentNote.noteId,
                    childNoteId: note.noteId
                });
            }

            if (noteSet.has(note)) {
                return;
            }

            if (!includeArchived && note.isArchived) {
                return;
            }

            noteSet.add(note);

            if (note.type === "search") {
                if (resolveSearch) {
                    resolveSearchNote(note);
                }
            } else {
                for (const childNote of note.children) {
                    addSubtreeNotesInner(childNote, note);
                }
            }
        }

        addSubtreeNotesInner(this);

        return {
            notes: Array.from(noteSet),
            relationships
        };
    }

    getSubtreeNoteIds({ includeArchived = true, includeHidden = false, resolveSearch = false } = {}) {
        return this.getSubtree({ includeArchived, includeHidden, resolveSearch }).notes.map((note) => note.noteId);
    }

    getDescendantNoteIds() {
        return this.getSubtreeNoteIds();
    }

    get parentCount() {
        return this.parents.length;
    }

    get childrenCount() {
        return this.children.length;
    }

    get labelCount() {
        return this.getAttributes().filter((attr) => attr.type === "label").length;
    }

    get ownedLabelCount() {
        return this.ownedAttributes.filter((attr) => attr.type === "label").length;
    }

    get relationCount() {
        return this.getAttributes().filter((attr) => attr.type === "relation" && !attr.isAutoLink()).length;
    }

    get relationCountIncludingLinks() {
        return this.getAttributes().filter((attr) => attr.type === "relation").length;
    }

    get ownedRelationCount() {
        return this.ownedAttributes.filter((attr) => attr.type === "relation" && !attr.isAutoLink()).length;
    }

    get ownedRelationCountIncludingLinks() {
        return this.ownedAttributes.filter((attr) => attr.type === "relation").length;
    }

    get targetRelationCount() {
        return this.targetRelations.filter((attr) => !attr.isAutoLink()).length;
    }

    get targetRelationCountIncludingLinks() {
        return this.targetRelations.length;
    }

    get attributeCount() {
        return this.getAttributes().length;
    }

    get ownedAttributeCount() {
        return this.getOwnedAttributes().length;
    }

    getAncestors() {
        if (!this.__ancestorCache) {
            const noteIds = new Set();
            this.__ancestorCache = [];

            for (const parent of this.parents) {
                if (noteIds.has(parent.noteId)) {
                    continue;
                }

                this.__ancestorCache.push(parent);
                noteIds.add(parent.noteId);

                for (const ancestorNote of parent.getAncestors()) {
                    if (!noteIds.has(ancestorNote.noteId)) {
                        this.__ancestorCache.push(ancestorNote);
                        noteIds.add(ancestorNote.noteId);
                    }
                }
            }
        }

        return this.__ancestorCache;
    }

    getAncestorNoteIds(): string[] {
        return this.getAncestors().map((note) => note.noteId);
    }

    hasAncestor(ancestorNoteId: string): boolean {
        for (const ancestorNote of this.getAncestors()) {
            if (ancestorNote.noteId === ancestorNoteId) {
                return true;
            }
        }

        return false;
    }

    isInHiddenSubtree() {
        return this.noteId === "_hidden" || this.hasAncestor("_hidden");
    }

    getTargetRelations() {
        return this.targetRelations;
    }

    getInheritingNotes(): BNote[] {
        const arr: BNote[] = [this];

        for (const targetRelation of this.targetRelations) {
            if (targetRelation.name === "template" || targetRelation.name === "inherit") {
                const note = targetRelation.note;

                if (note) {
                    arr.push(note);
                }
            }
        }

        return arr;
    }

    getDistanceToAncestor(ancestorNoteId: string) {
        if (this.noteId === ancestorNoteId) {
            return 0;
        }

        let minDistance = 999999;

        for (const parent of this.parents) {
            minDistance = Math.min(minDistance, parent.getDistanceToAncestor(ancestorNoteId) + 1);
        }

        return minDistance;
    }

    getRevisions(): BRevision[] {
        return getSql().getRows<RevisionRow>("SELECT * FROM revisions WHERE noteId = ? ORDER BY revisions.utcDateCreated ASC", [this.noteId]).map((row) => new BRevision(row));
    }

    getAttachments() {
        const query = /*sql*/`\
            SELECT attachments.*, LENGTH(blobs.content) AS contentLength
            FROM attachments
            JOIN blobs USING (blobId)
            WHERE ownerId = ? AND isDeleted = 0
            ORDER BY position`;

        return getSql().getRows<AttachmentRow>(query, [this.noteId]).map((row) => new BAttachment(row));
    }

    getAttachmentById(attachmentId: string) {
        const query = /*sql*/`\
            SELECT attachments.*, LENGTH(blobs.content) AS contentLength
            FROM attachments
            JOIN blobs USING (blobId)
            WHERE ownerId = ? AND attachmentId = ? AND isDeleted = 0`;

        return getSql().getRows<AttachmentRow>(query, [this.noteId, attachmentId]).map((row) => new BAttachment(row))[0];
    }

    getAttachmentsByRole(role: string): BAttachment[] {
        return getSql()
            .getRows<AttachmentRow>(
                `
                SELECT attachments.*
                FROM attachments
                WHERE ownerId = ?
                AND role = ?
                AND isDeleted = 0
                ORDER BY position`,
                [this.noteId, role]
            )
            .map((row) => new BAttachment(row));
    }

    getAttachmentByTitle(title: string): BAttachment | undefined {
        // cannot use SQL to filter by title since it can be encrypted
        return this.getAttachments().filter((attachment) => attachment.title === title)[0];
    }

    getAllNotePaths(): string[][] {
        if (this.noteId === "root") {
            return [["root"]];
        }

        const parentNotes = this.getParentNotes();

        const notePaths =
            parentNotes.length === 1
                ? parentNotes[0].getAllNotePaths() // optimization for the most common case
                : parentNotes.flatMap((parentNote) => parentNote.getAllNotePaths());

        for (const notePath of notePaths) {
            notePath.push(this.noteId);
        }

        return notePaths;
    }

    getSortedNotePathRecords(hoistedNoteId: string = "root"): NotePathRecord[] {
        const isHoistedRoot = hoistedNoteId === "root";

        const notePaths = this.getAllNotePaths().map((path) => ({
            notePath: path,
            isInHoistedSubTree: isHoistedRoot || path.includes(hoistedNoteId),
            isArchived: path.some((noteId) => this.becca.notes[noteId].isArchived),
            isHidden: path.includes("_hidden")
        }));

        notePaths.sort(compareNotePathRecords);

        return notePaths;
    }

    getBestNotePath(hoistedNoteId: string = "root"): string[] {
        return this.getSortedNotePathRecords(hoistedNoteId)[0]?.notePath;
    }

    getBestNotePathString(hoistedNoteId: string = "root"): string {
        const notePath = this.getBestNotePath(hoistedNoteId);

        return notePath?.join("/");
    }

    isHiddenCompletely() {
        if (this.noteId === "root") {
            return false;
        }

        for (const parentNote of this.parents) {
            if (parentNote.noteId === "root") {
                return false;
            } else if (parentNote.noteId === "_hidden") {
                continue;
            } else if (!parentNote.isHiddenCompletely()) {
                return false;
            }
        }

        return true;
    }

    isDescendantOfNote(ancestorNoteId: string): boolean {
        const notePaths = this.getAllNotePaths();

        return notePaths.some((path) => path.includes(ancestorNoteId));
    }

    setAttribute(type: AttributeType, name: string, value?: string) {
        const attributes = this.getOwnedAttributes();
        const attr = attributes.find((attr) => attr.type === type && attr.name === name);

        value = value?.toString() || "";

        if (attr) {
            if (attr.value !== value) {
                attr.value = value;
                attr.save();
            }
        } else {
            new BAttribute({
                noteId: this.noteId,
                type,
                name,
                value
            }).save();
        }
    }

    removeAttribute(type: string, name: string, value?: string) {
        const attributes = this.getOwnedAttributes();

        for (const attribute of attributes) {
            if (attribute.type === type && attribute.name === name && (value === undefined || value === attribute.value)) {
                attribute.markAsDeleted();
            }
        }
    }

    addAttribute(type: AttributeType, name: string, value: string = "", isInheritable: boolean = false, position: number | null = null): BAttribute {
        return new BAttribute({
            noteId: this.noteId,
            type,
            name,
            value,
            isInheritable,
            position
        }).save();
    }

    addLabel(name: string, value: string = "", isInheritable: boolean = false): BAttribute {
        return this.addAttribute(LABEL, name, value, isInheritable);
    }

    addRelation(name: string, targetNoteId: string, isInheritable: boolean = false): BAttribute {
        return this.addAttribute(RELATION, name, targetNoteId, isInheritable);
    }

    toggleAttribute(type: AttributeType, enabled: boolean, name: string, value?: string) {
        if (enabled) {
            this.setAttribute(type, name, value);
        } else {
            this.removeAttribute(type, name, value);
        }
    }

    toggleLabel(enabled: boolean, name: string, value?: string) {
        return this.toggleAttribute(LABEL, enabled, name, value);
    }

    toggleRelation(enabled: boolean, name: string, value?: string) {
        return this.toggleAttribute(RELATION, enabled, name, value);
    }

    setLabel(name: string, value?: string) {
        return this.setAttribute(LABEL, name, value);
    }

    setRelation(name: string, value?: string) {
        return this.setAttribute(RELATION, name, value);
    }

    removeLabel(name: string, value?: string) {
        return this.removeAttribute(LABEL, name, value);
    }

    removeRelation(name: string, value?: string) {
        return this.removeAttribute(RELATION, name, value);
    }

    searchNotesInSubtree(searchString: string) {
        return searchService.searchNotes(searchString) as BNote[];
    }

    searchNoteInSubtree(searchString: string) {
        return this.searchNotesInSubtree(searchString)[0];
    }

    cloneTo(parentNoteId: string): CloneResponse {
        const branch = this.becca.getNote(parentNoteId)?.getParentBranches()[0];
        if (!branch?.branchId) {
            return {
                success: false,
                message: "Unable to find the branch ID to clone."
            };
        }

        return cloningService.cloneNoteToBranch(this.noteId, branch.branchId);
    }

    isEligibleForConversionToAttachment(opts: ConvertOpts = { autoConversion: false }) {
        if (this.type !== "image" || !this.isContentAvailable() || this.hasChildren() || this.getParentBranches().length !== 1) {
            return false;
        }

        const targetRelations = this.getTargetRelations().filter((relation) => relation.name === "imageLink");

        if (opts.autoConversion && targetRelations.length === 0) {
            return false;
        } else if (targetRelations.length > 1) {
            return false;
        }

        const parentNote = this.getParentNotes()[0]; // at this point note can have only one parent
        const referencingNote = targetRelations[0]?.getNote();

        if (referencingNote && parentNote !== referencingNote) {
            return false;
        } else if (parentNote.type !== "text" || !parentNote.isContentAvailable()) {
            return false;
        }

        return true;
    }

    convertToParentAttachment(opts: ConvertOpts = { autoConversion: false }): BAttachment | null {
        if (!this.isEligibleForConversionToAttachment(opts)) {
            return null;
        }

        const content = this.getContent();

        const parentNote = this.getParentNotes()[0];
        const attachment = parentNote.saveAttachment({
            role: "image",
            mime: this.mime,
            title: this.title,
            content
        });

        const parentContent = parentNote.getContent();

        const oldNoteUrl = `api/images/${this.noteId}/`;
        const newAttachmentUrl = `api/attachments/${attachment.attachmentId}/image/`;

        /* v8 ignore next 3 -- defensive: an eligible parent is always a text note with string content */
        if (typeof parentContent !== "string") {
            throw new Error("Unable to convert image note into attachment because parent note does not have a string content.");
        }

        const fixedContent = replaceAll(parentContent, oldNoteUrl, newAttachmentUrl);

        parentNote.setContent(fixedContent);

        noteService.asyncPostProcessContent(parentNote, fixedContent); // to mark an unused attachment for deletion

        this.deleteNote();

        return attachment;
    }

    deleteNote(deleteId: string | null = null, taskContext: TaskContext<"deleteNotes"> | null = null) {
        if (this.isDeleted) {
            return;
        }

        if (!deleteId) {
            deleteId = randomString(10);
        }

        if (!taskContext) {
            taskContext = new TaskContext("no-progress-reporting", "deleteNotes", null);
        }

        // needs to be run before branches and attributes are deleted and thus attached relations disappear
        handlers.runAttachedRelations(this, "runOnNoteDeletion", this);
        taskContext.noteDeletionHandlerTriggered = true;

        for (const branch of this.getParentBranches()) {
            /* v8 ignore next -- deleteId is always assigned above; the nullish fallback is unreachable */
            branch.deleteBranch(deleteId ?? undefined, taskContext);
        }
    }

    decrypt() {
        if (this.isProtected && !this.isDecrypted && protectedSessionService.isProtectedSessionAvailable()) {
            try {
                this.title = protectedSessionService.decryptString(this.title) || "";
                this.__flatTextCache = null;
                this.__searchableTitleCache = null;
                // The pre-built flat text search index still holds this note's encrypted
                // title, so schedule a refresh — otherwise the note stays unsearchable by
                // title even after the protected session is unlocked (issue #10406).
                this.becca.dirtyNoteFlatText(this.noteId);

                this.isDecrypted = true;
            } catch (e: any) {
                getLog().error(`Could not decrypt note ${this.noteId}: ${e.message} ${e.stack}`);
            }
        }
    }

    isLaunchBarConfig() {
        return this.type === "launcher"
            || ["_lbRoot", "_lbAvailableLaunchers", "_lbVisibleLaunchers"].includes(this.noteId)
            || ["_lbMobileRoot", "_lbMobileAvailableLaunchers", "_lbMobileVisibleLaunchers"].includes(this.noteId);
    }

    isOptions() {
        return this.noteId.startsWith("_options");
    }

    override get isDeleted() {
        // isBeingDeleted is relevant only in the transition period when the deletion process has begun, but not yet
        // finished (note is still in becca)
        return !(this.noteId in this.becca.notes) || this.isBeingDeleted;
    }

    saveRevision(opts: { description?: string; source?: RevisionSource } = {}): BRevision {
        return getSql().transactional(() => {
            let noteContent = this.getContent();

            const revision = new BRevision(
                {
                    noteId: this.noteId,
                    // title and text should be decrypted now
                    title: this.title,
                    description: opts.description || "",
                    source: opts.source || "auto",
                    type: this.type,
                    mime: this.mime,
                    isProtected: this.isProtected,
                    utcDateLastEdited: this.utcDateModified,
                    utcDateCreated: dateUtils.utcNowDateTime(),
                    utcDateModified: dateUtils.utcNowDateTime(),
                    dateLastEdited: this.dateModified,
                    dateCreated: dateUtils.localNowDateTime()
                },
                true
            );

            revision.save(); // to generate revisionId, which is then used to save attachments

            for (const noteAttachment of this.getAttachments()) {
                const revisionAttachment = noteAttachment.copy();

                /* v8 ignore next 3 -- defensive: revision.save() above always assigns revisionId */
                if (!revision.revisionId) {
                    throw new Error("Revision ID is missing.");
                }

                revisionAttachment.ownerId = revision.revisionId;
                revisionAttachment.setContent(noteAttachment.getContent(), { forceSave: true });

                if (this.type === "text" && typeof noteContent === "string") {
                    // content is rewritten to point to the revision attachments
                    noteContent = noteContent.replaceAll(`attachments/${noteAttachment.attachmentId}`, `attachments/${revisionAttachment.attachmentId}`);

                    noteContent = noteContent.replaceAll(
                        new RegExp(`href="[^"]*attachmentId=${noteAttachment.attachmentId}[^"]*"`, "gi"),
                        `href="api/attachments/${revisionAttachment.attachmentId}/download"`
                    );
                }
            }

            revision.setContent(noteContent);

            this.eraseExcessRevisionSnapshots();
            return revision;
        });
    }

    /**
     * Erases the oldest revision snapshots beyond the number to keep, newest kept first.
     *
     * A negative limit keeps every snapshot — nothing is ever excess — while zero keeps none.
     *
     * @returns how many snapshots were erased.
     */
    eraseExcessRevisionSnapshots({ snapshotsToKeep, keepNamedSnapshots }: EraseExcessRevisionsOptions = {}): number {
        const limit = this.resolveSnapshotLimit(snapshotsToKeep);

        if (limit < 0) {
            return 0;
        }

        // Named snapshots are the ones the user deliberately marked, so sparing them takes them out
        // of the reckoning entirely: they are neither erased nor counted, and the limit then
        // governs the automatic snapshots alone. Counting them would let a handful of named ones
        // push every automatic snapshot out.
        const keepNamed = keepNamedSnapshots ?? optionService.getOptionBool("revisionIgnoreNamedSnapshots");
        const candidates = keepNamed
            ? this.getRevisions().filter((revision) => !revision.description)
            : this.getRevisions();

        const revisionIds = candidates
            .slice(0, Math.max(candidates.length - limit, 0))
            .map((revision) => revision.revisionId)
            .filter((id): id is string => id !== undefined);

        if (revisionIds.length > 0) {
            eraseService.eraseRevisions(revisionIds);
        }

        return revisionIds.length;
    }

    /**
     * How many snapshots this note keeps, most specific answer first: its own `#versioningLimit`,
     * then the caller's override, then the `revisionSnapshotNumberLimit` option.
     *
     * The label outranks the override rather than the other way round. A label is a policy set on
     * this note deliberately, while an override is a one-off answer standing in for the global
     * setting — so it replaces that setting, and leaves a note that was given its own limit alone.
     */
    private resolveSnapshotLimit(override: number | undefined): number {
        const labelled = parseInt(this.getLabelValue("versioningLimit") ?? "");

        if (Number.isInteger(labelled)) {
            return labelled;
        }

        return Number.isInteger(override)
            ? Number(override)
            : parseInt(optionService.getOption("revisionSnapshotNumberLimit"));
    }

    saveAttachment({ attachmentId, role, mime, title, content, position }: Omit<AttachmentRow, "ownerId">, matchBy: "attachmentId" | "title" | undefined = "attachmentId") {
        if (!["attachmentId", "title"].includes(matchBy)) {
            throw new Error(`Unsupported value '${matchBy}' for matchBy param, has to be either 'attachmentId' or 'title'.`);
        }

        let attachment;

        if (matchBy === "title" && title) {
            attachment = this.getAttachmentByTitle(title);
        } else if (matchBy === "attachmentId" && attachmentId) {
            attachment = this.becca.getAttachmentOrThrow(attachmentId);
        }

        attachment =
            attachment ||
            new BAttachment({
                ownerId: this.noteId,
                title,
                role,
                mime,
                isProtected: this.isProtected,
                position
            });

        content = content || "";
        attachment.setContent(content, { forceSave: true });

        return attachment;
    }

    getFileName() {
        return formatDownloadTitle(this.title, this.type, this.mime);
    }

    /**
     * Forces explicit creation/modification timestamps onto the note and its blob, persisting them
     * immediately with raw SQL. This deliberately bypasses the automatic "now" stamping that
     * {@link beforeSaving} applies on every regular save, which is why importers that need to preserve
     * the source's original dates (ENEX, OneNote, …) call this *after* the note and its content have
     * been saved.
     *
     * Both arguments are UTC datetimes in Trilium's DB format (e.g. `2023-08-21 23:38:51.110Z`); the
     * matching local-time columns are derived from them. Either may be omitted to leave that pair at
     * its current value.
     */
    setDateCreatedAndModified(utcDateCreated?: string, utcDateModified?: string) {
        const toLocalDbFormat = (utc: string) => dayjs(utc).format(dateUtils.LOCAL_DATETIME_FORMAT);

        if (utcDateCreated) {
            this.utcDateCreated = utcDateCreated;
            this.dateCreated = toLocalDbFormat(utcDateCreated);
        }
        if (utcDateModified) {
            this.utcDateModified = utcDateModified;
            this.dateModified = toLocalDbFormat(utcDateModified);
        }

        const sql = getSql();
        sql.execute(
            /*sql*/`UPDATE notes
                    SET dateCreated = ?, utcDateCreated = ?, dateModified = ?, utcDateModified = ?
                    WHERE noteId = ?`,
            [this.dateCreated, this.utcDateCreated, this.dateModified, this.utcDateModified, this.noteId]
        );
        sql.execute(/*sql*/`UPDATE blobs SET utcDateModified = ? WHERE blobId = ?`, [this.utcDateModified, this.blobId]);
    }

    override beforeSaving() {
        super.beforeSaving();

        this.becca.addNote(this.noteId, this);

        this.dateModified = dateUtils.localNowDateTime();
        this.utcDateModified = dateUtils.utcNowDateTime();
    }

    getPojo(): NotePojo {
        return {
            noteId: this.noteId,
            title: this.title,
            isProtected: this.isProtected,
            type: this.type,
            mime: this.mime,
            blobId: this.blobId,
            isDeleted: false,
            dateCreated: this.dateCreated,
            dateModified: this.dateModified,
            utcDateCreated: this.utcDateCreated,
            utcDateModified: this.utcDateModified
        };
    }

    override getPojoToSave() {
        const pojo = this.getPojo();

        if (pojo.isProtected) {
            if (this.isDecrypted && pojo.title) {
                pojo.title = protectedSessionService.encrypt(pojo.title) || undefined;
            } else {
                // updating protected note outside of protected session means we will keep original ciphertexts
                delete pojo.title;
            }
        }

        return pojo;
    }

    getIcon() {
        const iconClassLabels = this.getLabels("iconClass");
        const icon = getNoteIcon({
            noteId: this.noteId,
            type: this.type,
            mime: this.mime,
            iconClass: iconClassLabels.length > 0 ? iconClassLabels[0].value : undefined,
            workspaceIconClass: undefined,
            isFolder: this.isFolder.bind(this),
            getLabelValue: this.getLabelValue.bind(this)
        });

        return `tn-icon ${icon}`;
    }

    // TODO: Deduplicate with fnote
    isFolder() {
        return this.type === "search" || this.getFilteredChildBranches().length > 0;
    }

    // TODO: Deduplicate with fnote
    getFilteredChildBranches() {
        const childBranches = this.getChildBranches();

        if (!childBranches) {
            console.error(`No children for '${this.noteId}'. This shouldn't happen.`);
            return [];
        }

        // we're not checking hideArchivedNotes since that would mean we need to lazy load the child notes
        // which would seriously slow down everything.
        // we check this flag only once user chooses to expand the parent. This has the negative consequence that
        // note may appear as a folder but not contain any children when all of them are archived

        return childBranches;
    }

    get encodedTitle() {
        return encodeURIComponent(this.title);
    }

    getVisibleChildBranches() {
        return this.getChildBranches().filter((branch) => {
            const note = branch.getNote();
            return !note.isLabelTruthy("shareHiddenFromTree") && !note.noteId.startsWith("_");
        });
    }

    getVisibleChildNotes() {
        return this.getVisibleChildBranches().map((branch) => branch.getNote());
    }

    hasVisibleChildren() {
        return this.getVisibleChildNotes().length > 0;
    }

    get shareId() {
        return this.noteId;
    }

    getAttributeById(attributeId : string): BAttribute | undefined {
        this.__ensureAttributeCacheIsAvailable();

        /* v8 ignore next 3 -- defensive: cache is always populated by __ensureAttributeCacheIsAvailable */
        if (!this.__attributeCache) {
            throw new Error("Attribute cache not available.");
        }

        return this.__attributeCache.find((attr) => attr.attributeId === attributeId);
    }

    setAttributeValueById(attributeId : string, value? : string) {
        const attributes = this.getOwnedAttributes();
        const attr = attributes.find((attr) => attr.attributeId === attributeId);

        value = value?.toString() || "";

        if (attr) {
            if (attr.value !== value) {
                attr.value = value;
                attr.save();
            }
        } else {
            throw new Error(`Attribute with id ${attributeId} not found.`);
        }
    }
}

/**
 * Orders note-path records so the "best" path sorts first: paths inside the hoisted
 * subtree beat outside ones, non-archived beat archived, non-hidden beat hidden, and
 * shorter paths beat longer ones. Extracted from {@link BNote.getSortedNotePathRecords}
 * so the ordering logic can be unit-tested directly.
 */
export function compareNotePathRecords(a: NotePathRecord, b: NotePathRecord): number {
    if (a.isInHoistedSubTree !== b.isInHoistedSubTree) {
        return a.isInHoistedSubTree ? -1 : 1;
    } else if (a.isArchived !== b.isArchived) {
        return a.isArchived ? 1 : -1;
    } else if (a.isHidden !== b.isHidden) {
        return a.isHidden ? 1 : -1;
    }
    return a.notePath.length - b.notePath.length;
}

export default BNote;
