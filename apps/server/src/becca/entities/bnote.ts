import type { AttachmentRow, AttributeType, CloneResponse, NoteRow, NoteType, RevisionRow } from "@triliumnext/commons";
import { dayjs } from "@triliumnext/commons";

import cloningService from "../../services/cloning.js";
import dateUtils from "../../services/date_utils.js";
import eraseService from "../../services/erase.js";
import eventService from "../../services/events.js";
import handlers from "../../services/handlers.js";
import log from "../../services/log.js";
import noteService from "../../services/notes.js";
import optionService from "../../services/options.js";
import protectedSessionService from "../../services/protected_session.js";
import searchService from "../../services/search/services/search.js";
import sql from "../../services/sql.js";
import TaskContext from "../../services/task_context.js";
import utils from "../../services/utils.js";
import type { NotePojo } from "../becca-interface.js";
import AbstractBeccaEntity from "./abstract_becca_entity.js";
import BAttachment from "./battachment.js";
import BAttribute from "./battribute.js";
import type BBranch from "./bbranch.js";
import BRevision from "./brevision.js";

const LABEL = "label";
const RELATION = "relation";

// TODO: Deduplicate with fnote
export const NOTE_TYPE_ICONS = {
    file: "bx bx-file",
    image: "bx bx-image",
    code: "bx bx-code",
    render: "bx bx-extension",
    search: "bx bx-file-find",
    relationMap: "bx bxs-network-chart",
    book: "bx bx-book",
    noteMap: "bx bxs-network-chart",
    mermaid: "bx bx-selection",
    canvas: "bx bx-pen",
    webView: "bx bx-globe-alt",
    launcher: "bx bx-link",
    doc: "bx bxs-file-doc",
    contentWidget: "bx bxs-widget",
    mindMap: "bx bx-sitemap",
    geoMap: "bx bx-map-alt"
};

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

    private __attributeCache!: BAttribute[] | null;
    private __inheritableAttributeCache!: BAttribute[] | null;
    private __ancestorCache!: BNote[] | null;

    // following attributes are filled during searching in the database
    /** size of the content in bytes */
    contentSize!: number | null;
    /** size of the note content, attachment contents in bytes */
    contentAndAttachmentsSize!: number | null;
    /** size of the note content, attachment contents and revision contents in bytes */
    contentAndAttachmentsAndRevisionsSize!: number | null;
    /** number of note revisions for this note */
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

        return this;
    }

    override init() {
        this.parentBranches = [];
        this.parents = [];
        this.children = [];
        this.ownedAttributes = [];
        this.__attributeCache = null;
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

    /**
     * Returns <i>strong</i> (as opposed to <i>weak</i>) parent branches. See isWeak for details.
     */
    getStrongParentBranches() {
        return this.getParentBranches().filter((branch) => !branch.isWeak);
    }

    /**
     * @deprecated use getParentBranches() instead
     */
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
        return this._getContent();
    }

    /**
     * @throws Error in case of invalid JSON
     */
    getJsonContent(): any | null {
        const content = this.getContent();

        if (typeof content !== "string" || !content || !content.trim()) {
            return null;
        }

        return JSON.parse(content);
    }

    /** @returns valid object or null if the content cannot be parsed as JSON */
    getJsonContentSafely() {
        try {
            return this.getJsonContent();
        } catch (e) {
            return null;
        }
    }

    setContent(content: Buffer | string, opts: ContentOpts = {}) {
        this._setContent(content, opts);

        eventService.emit(eventService.NOTE_CONTENT_CHANGE, { entity: this });
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

    /** @returns true if this note is the root of the note tree. Root note has "root" noteId */
    isRoot() {
        return this.noteId === "root";
    }

    /** @returns true if this note is of application/json content type */
    isJson() {
        return this.mime === "application/json";
    }

    /** @returns true if this note is JavaScript (code or attachment) */
    isJavaScript() {
        return (
            (this.type === "code" || this.type === "file" || this.type === "launcher") &&
            (this.mime.startsWith("application/javascript") || this.mime === "application/x-javascript" || this.mime === "text/javascript")
        );
    }

    isJsx() {
        return (this.type === "code" && this.mime === "text/jsx");
    }

    /** @returns true if this note is HTML */
    isHtml() {
        return ["code", "file", "render"].includes(this.type) && this.mime === "text/html";
    }

    /** @returns true if this note is an image */
    isImage() {
        return this.type === "image" || (this.type === "file" && this.mime?.startsWith("image/"));
    }

    /** @deprecated use hasStringContent() instead */
    isStringNote() {
        return this.hasStringContent();
    }

    /** @returns true if the note has string content (not binary) */
    override hasStringContent() {
        return utils.isStringNote(this.type, this.mime);
    }

    /** @returns JS script environment - either "frontend" or "backend" */
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

    /**
     * Beware that the method must not create a copy of the array, but actually returns its internal array
     * (for performance reasons)
     *
     * @param type - (optional) attribute type to filter
     * @param name - (optional) attribute name to filter
     * @returns all note's attributes, including inherited ones
     */
    getAttributes(type?: string, name?: string): BAttribute[] {
        this.__validateTypeName(type, name);
        this.__ensureAttributeCacheIsAvailable();

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
                                .filter((attr) => !(attr.type === "label" && (attr.name === "template" || attr.name === "workspacetemplate")))
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

    /**
     * @param name - label name
     * @param value - label value
     * @returns true if label exists (including inherited)
     */
    hasLabel(name: string, value?: string): boolean {
        return this.hasAttribute(LABEL, name, value);
    }

    /**
     * @param name - label name
     * @returns true if label exists (including inherited) and does not have "false" value.
     */
    isLabelTruthy(name: string): boolean {
        const label = this.getLabel(name);

        if (!label) {
            return false;
        }

        return label && label.value !== "false";
    }

    /**
     * @param name - label name
     * @param value - label value
     * @returns true if label exists (excluding inherited)
     */
    hasOwnedLabel(name: string, value?: string): boolean {
        return this.hasOwnedAttribute(LABEL, name, value);
    }

    /**
     * @param name - relation name
     * @param value - relation value
     * @returns true if relation exists (including inherited)
     */
    hasRelation(name: string, value?: string): boolean {
        return this.hasAttribute(RELATION, name, value);
    }

    /**
     * @param name - relation name
     * @param value - relation value
     * @returns true if relation exists (excluding inherited)
     */
    hasOwnedRelation(name: string, value?: string): boolean {
        return this.hasOwnedAttribute(RELATION, name, value);
    }

    /**
     * @param name - label name
     * @returns label if it exists, null otherwise
     */
    getLabel(name: string): BAttribute | null {
        return this.getAttribute(LABEL, name);
    }

    /**
     * @param name - label name
     * @returns label if it exists, null otherwise
     */
    getOwnedLabel(name: string): BAttribute | null {
        return this.getOwnedAttribute(LABEL, name);
    }

    /**
     * @param name - relation name
     * @returns relation if it exists, null otherwise
     */
    getRelation(name: string): BAttribute | null {
        return this.getAttribute(RELATION, name);
    }

    /**
     * @param name - relation name
     * @returns relation if it exists, null otherwise
     */
    getOwnedRelation(name: string): BAttribute | null {
        return this.getOwnedAttribute(RELATION, name);
    }

    /**
     * @param name - label name
     * @returns label value if label exists, null otherwise
     */
    getLabelValue(name: string): string | null {
        return this.getAttributeValue(LABEL, name);
    }

    /**
     * @param name - label name
     * @returns label value if label exists, null otherwise
     */
    getOwnedLabelValue(name: string): string | null {
        return this.getOwnedAttributeValue(LABEL, name);
    }

    /**
     * @param name - relation name
     * @returns relation value if relation exists, null otherwise
     */
    getRelationValue(name: string): string | null {
        return this.getAttributeValue(RELATION, name);
    }

    /**
     * @param name - relation name
     * @returns relation value if relation exists, null otherwise
     */
    getOwnedRelationValue(name: string): string | null {
        return this.getOwnedAttributeValue(RELATION, name);
    }

    /**
     * @param attribute type (label, relation, etc.)
     * @param name - attribute name
     * @param value - attribute value
     * @returns true if note has an attribute with given type and name (excluding inherited)
     */
    hasOwnedAttribute(type: string, name: string, value?: string): boolean {
        return !!this.getOwnedAttribute(type, name, value);
    }

    /**
     * @param type - attribute type (label, relation, etc.)
     * @param name - attribute name
     * @returns attribute of the given type and name. If there are more such attributes, first is returned.
     *          Returns null if there's no such attribute belonging to this note.
     */
    getAttribute(type: string, name: string): BAttribute | null {
        const attributes = this.getAttributes();

        return attributes.find((attr) => attr.name === name && attr.type === type) || null;
    }

    /**
     * @param type - attribute type (label, relation, etc.)
     * @param name - attribute name
     * @returns attribute value of given type and name or null if no such attribute exists.
     */
    getAttributeValue(type: string, name: string): string | null {
        const attr = this.getAttribute(type, name);

        return attr ? attr.value : null;
    }

    /**
     * @param type - attribute type (label, relation, etc.)
     * @param name - attribute name
     * @returns attribute value of given type and name or null if no such attribute exists.
     */
    getOwnedAttributeValue(type: string, name: string): string | null {
        const attr = this.getOwnedAttribute(type, name);

        return attr ? attr.value : null;
    }

    /**
     * @param name - label name to filter
     * @returns all note's labels (attributes with type label), including inherited ones
     */
    getLabels(name?: string): BAttribute[] {
        return this.getAttributes(LABEL, name);
    }

    /**
     * @param name - label name to filter
     * @returns all note's label values, including inherited ones
     */
    getLabelValues(name: string): string[] {
        return this.getLabels(name).map((l) => l.value);
    }

    /**
     * @param name - label name to filter
     * @returns all note's labels (attributes with type label), excluding inherited ones
     */
    getOwnedLabels(name: string): BAttribute[] {
        return this.getOwnedAttributes(LABEL, name);
    }

    /**
     * @param name - label name to filter
     * @returns all note's label values, excluding inherited ones
     */
    getOwnedLabelValues(name: string): string[] {
        return this.getOwnedAttributes(LABEL, name).map((l) => l.value);
    }

    /**
     * @param name - relation name to filter
     * @returns all note's relations (attributes with type relation), including inherited ones
     */
    getRelations(name?: string): BAttribute[] {
        return this.getAttributes(RELATION, name);
    }

    /**
     * @param name - relation name to filter
     * @returns all note's relations (attributes with type relation), excluding inherited ones
     */
    getOwnedRelations(name?: string | null): BAttribute[] {
        return this.getOwnedAttributes(RELATION, name);
    }

    /**
     * Beware that the method must not create a copy of the array, but actually returns its internal array
     * (for performance reasons)
     *
     * @param type - (optional) attribute type to filter
     * @param name - (optional) attribute name to filter
     * @param value - (optional) attribute value to filter
     * @returns note's "owned" attributes - excluding inherited ones
     */
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

    /**
     * @returns attribute belonging to this specific note (excludes inherited attributes)
     *
     * This method can be significantly faster than the getAttribute()
     */
    getOwnedAttribute(type: string, name: string, value: string | null = null) {
        const attrs = this.getOwnedAttributes(type, name, value);

        return attrs.length > 0 ? attrs[0] : null;
    }

    get isArchived() {
        return this.hasAttribute("label", "archived");
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

    /**
     * This is used for:
     * - fast searching
     * - note similarity evaluation
     *
     * @returns - returns flattened textual representation of note, prefixes and attributes
     */
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

            this.__flatTextCache = utils.normalize(this.__flatTextCache);
        }

        return this.__flatTextCache;
    }

    invalidateThisCache() {
        this.__flatTextCache = null;

        this.__attributeCache = null;
        this.__inheritableAttributeCache = null;
        this.__ancestorCache = null;
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
            log.error(`Could not resolve search note ${this.noteId}: ${e.message}`);
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
                log.error(`Could not resolve search note ${searchNote?.noteId}: ${e.message}`);
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

    /** @returns includes the subtree root note as well */
    getSubtreeNoteIds({ includeArchived = true, includeHidden = false, resolveSearch = false } = {}) {
        return this.getSubtree({ includeArchived, includeHidden, resolveSearch }).notes.map((note) => note.noteId);
    }

    /** @deprecated use getSubtreeNoteIds() instead */
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

    /** @returns returns only notes which are templated, does not include their subtrees
     *           in effect returns notes which are influenced by note's non-inheritable attributes */
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
        return sql.getRows<RevisionRow>("SELECT * FROM revisions WHERE noteId = ? ORDER BY revisions.utcDateCreated ASC", [this.noteId]).map((row) => new BRevision(row));
    }

    getAttachments() {
        const query = /*sql*/`\
            SELECT attachments.*, LENGTH(blobs.content) AS contentLength
            FROM attachments
            JOIN blobs USING (blobId)
            WHERE ownerId = ? AND isDeleted = 0
            ORDER BY position`;

        return sql.getRows<AttachmentRow>(query, [this.noteId]).map((row) => new BAttachment(row));
    }

    getAttachmentById(attachmentId: string) {
        const query = /*sql*/`\
            SELECT attachments.*, LENGTH(blobs.content) AS contentLength
            FROM attachments
            JOIN blobs USING (blobId)
            WHERE ownerId = ? AND attachmentId = ? AND isDeleted = 0`;

        return sql.getRows<AttachmentRow>(query, [this.noteId, attachmentId]).map((row) => new BAttachment(row))[0];
    }

    getAttachmentsByRole(role: string): BAttachment[] {
        return sql
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

    /**
     * Gives all possible note paths leading to this note. Paths containing search note are ignored (could form cycles)
     *
     * @returns array of notePaths (each represented by array of noteIds constituting the particular note path)
     */
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

        notePaths.sort((a, b) => {
            if (a.isInHoistedSubTree !== b.isInHoistedSubTree) {
                return a.isInHoistedSubTree ? -1 : 1;
            } else if (a.isArchived !== b.isArchived) {
                return a.isArchived ? 1 : -1;
            } else if (a.isHidden !== b.isHidden) {
                return a.isHidden ? 1 : -1;
            }
            return a.notePath.length - b.notePath.length;
        });

        return notePaths;
    }

    /**
     * Returns a note path considered to be the "best"
     *
     * @return array of noteIds constituting the particular note path
     */
    getBestNotePath(hoistedNoteId: string = "root"): string[] {
        return this.getSortedNotePathRecords(hoistedNoteId)[0]?.notePath;
    }

    /**
     * Returns a note path considered to be the "best"
     *
     * @return serialized note path (e.g. 'root/a1h315/js725h')
     */
    getBestNotePathString(hoistedNoteId: string = "root"): string {
        const notePath = this.getBestNotePath(hoistedNoteId);

        return notePath?.join("/");
    }

    /**
     * @return boolean - true if there's no non-hidden path, note is not cloned to the visible tree
     */
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

    /**
     * @returns true if ancestorNoteId occurs in at least one of the note's paths
     */
    isDescendantOfNote(ancestorNoteId: string): boolean {
        const notePaths = this.getAllNotePaths();

        return notePaths.some((path) => path.includes(ancestorNoteId));
    }

    /**
     * Update's given attribute's value or creates it if it doesn't exist
     *
     * @param type - attribute type (label, relation, etc.)
     * @param name - attribute name
     * @param value - attribute value (optional)
     */
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

    /**
     * Removes given attribute name-value pair if it exists.
     *
     * @param type - attribute type (label, relation, etc.)
     * @param name - attribute name
     * @param value - attribute value (optional)
     */
    removeAttribute(type: string, name: string, value?: string) {
        const attributes = this.getOwnedAttributes();

        for (const attribute of attributes) {
            if (attribute.type === type && attribute.name === name && (value === undefined || value === attribute.value)) {
                attribute.markAsDeleted();
            }
        }
    }

    /**
     * Adds a new attribute to this note. The attribute is saved and returned.
     * See addLabel, addRelation for more specific methods.
     *
     * @param type - attribute type (label / relation)
     * @param name - name of the attribute, not including the leading ~/#
     * @param value - value of the attribute - text for labels, target note ID for relations; optional.
     */
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

    /**
     * Adds a new label to this note. The label attribute is saved and returned.
     *
     * @param name - name of the label, not including the leading #
     * @param value - text value of the label; optional
     */
    addLabel(name: string, value: string = "", isInheritable: boolean = false): BAttribute {
        return this.addAttribute(LABEL, name, value, isInheritable);
    }

    /**
     * Adds a new relation to this note. The relation attribute is saved and
     * returned.
     *
     * @param name - name of the relation, not including the leading ~
     */
    addRelation(name: string, targetNoteId: string, isInheritable: boolean = false): BAttribute {
        return this.addAttribute(RELATION, name, targetNoteId, isInheritable);
    }

    /**
     * Based on enabled, the attribute is either set or removed.
     *
     * @param type - attribute type ('relation', 'label' etc.)
     * @param enabled - toggle On or Off
     * @param name - attribute name
     * @param value - attribute value (optional)
     */
    toggleAttribute(type: AttributeType, enabled: boolean, name: string, value?: string) {
        if (enabled) {
            this.setAttribute(type, name, value);
        } else {
            this.removeAttribute(type, name, value);
        }
    }

    /**
     * Based on enabled, label is either set or removed.
     *
     * @param enabled - toggle On or Off
     * @param name - label name
     * @param value - label value (optional)
     */
    toggleLabel(enabled: boolean, name: string, value?: string) {
        return this.toggleAttribute(LABEL, enabled, name, value);
    }

    /**
     * Based on enabled, relation is either set or removed.
     *
     * @param enabled - toggle On or Off
     * @param name - relation name
     * @param value - relation value (noteId)
     */
    toggleRelation(enabled: boolean, name: string, value?: string) {
        return this.toggleAttribute(RELATION, enabled, name, value);
    }

    /**
     * Update's given label's value or creates it if it doesn't exist
     *
     * @param name - label name
     * @param value label value
     */
    setLabel(name: string, value?: string) {
        return this.setAttribute(LABEL, name, value);
    }

    /**
     * Update's given relation's value or creates it if it doesn't exist
     *
     * @param name - relation name
     * @param value - relation value (noteId)
     */
    setRelation(name: string, value?: string) {
        return this.setAttribute(RELATION, name, value);
    }

    /**
     * Remove label name-value pair, if it exists.
     *
     * @param name - label name
     * @param value - label value
     */
    removeLabel(name: string, value?: string) {
        return this.removeAttribute(LABEL, name, value);
    }

    /**
     * Remove the relation name-value pair, if it exists.
     *
     * @param name - relation name
     * @param value - relation value (noteId)
     */
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

    /**
     * Some notes are eligible for conversion into an attachment of its parent, note must have these properties:
     * - it has exactly one target relation
     * - it has a relation from its parent note
     * - it has no children
     * - it has no clones
     * - the parent is of type text
     * - both notes are either unprotected or user is in protected session
     *
     * Currently, works only for image notes.
     *
     * In the future, this functionality might get more generic and some of the requirements relaxed.
     *
     * @returns null if note is not eligible for conversion
     */
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

        if (typeof parentContent !== "string") {
            throw new Error("Unable to convert image note into attachment because parent note does not have a string content.");
        }

        const fixedContent = utils.replaceAll(parentContent, oldNoteUrl, newAttachmentUrl);

        parentNote.setContent(fixedContent);

        noteService.asyncPostProcessContent(parentNote, fixedContent); // to mark an unused attachment for deletion

        this.deleteNote();

        return attachment;
    }

    /**
     * (Soft) delete a note and all its descendants.
     *
     * @param deleteId - optional delete identified
     */
    deleteNote(deleteId: string | null = null, taskContext: TaskContext<"deleteNotes"> | null = null) {
        if (this.isDeleted) {
            return;
        }

        if (!deleteId) {
            deleteId = utils.randomString(10);
        }

        if (!taskContext) {
            taskContext = new TaskContext("no-progress-reporting", "deleteNotes", null);
        }

        // needs to be run before branches and attributes are deleted and thus attached relations disappear
        handlers.runAttachedRelations(this, "runOnNoteDeletion", this);
        taskContext.noteDeletionHandlerTriggered = true;

        for (const branch of this.getParentBranches()) {
            branch.deleteBranch(deleteId, taskContext);
        }
    }

    decrypt() {
        if (this.isProtected && !this.isDecrypted && protectedSessionService.isProtectedSessionAvailable()) {
            try {
                this.title = protectedSessionService.decryptString(this.title) || "";
                this.__flatTextCache = null;

                this.isDecrypted = true;
            } catch (e: any) {
                log.error(`Could not decrypt note ${this.noteId}: ${e.message} ${e.stack}`);
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

    saveRevision(): BRevision {
        return sql.transactional(() => {
            let noteContent = this.getContent();

            const revision = new BRevision(
                {
                    noteId: this.noteId,
                    // title and text should be decrypted now
                    title: this.title,
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

    // Limit the number of Snapshots to revisionSnapshotNumberLimit
    // Delete older Snapshots that exceed the limit
    eraseExcessRevisionSnapshots() {
        // lable has a higher priority
        let revisionSnapshotNumberLimit = parseInt(this.getLabelValue("versioningLimit") ?? "");
        if (!Number.isInteger(revisionSnapshotNumberLimit)) {
            revisionSnapshotNumberLimit = parseInt(optionService.getOption("revisionSnapshotNumberLimit"));
        }
        if (revisionSnapshotNumberLimit >= 0) {
            const revisions = this.getRevisions();
            if (revisions.length - revisionSnapshotNumberLimit > 0) {
                const revisionIds = revisions
                    .slice(0, revisions.length - revisionSnapshotNumberLimit)
                    .map((revision) => revision.revisionId)
                    .filter((id): id is string => id !== undefined);
                eraseService.eraseRevisions(revisionIds);
            }
        }
    }

    /**
     * @param matchBy - choose by which property we detect if to update an existing attachment.
     *                      Supported values are either 'attachmentId' (default) or 'title'
     */
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
        return utils.formatDownloadTitle(this.title, this.type, this.mime);
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
        return `tn-icon ${this.#getIconInternal()}`;
    }

    // TODO: Deduplicate with fnote
    #getIconInternal() {
        const iconClassLabels = this.getLabels("iconClass");

        if (iconClassLabels && iconClassLabels.length > 0) {
            return iconClassLabels[0].value;
        } else if (this.noteId === "root") {
            return "bx bx-home-alt-2";
        }
        if (this.noteId === "_share") {
            return "bx bx-share-alt";
        } else if (this.type === "text") {
            if (this.isFolder()) {
                return "bx bx-folder";
            }
            return "bx bx-note";

        } else if (this.type === "code" && this.mime.startsWith("text/x-sql")) {
            return "bx bx-data";
        }
        return NOTE_TYPE_ICONS[this.type];
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
        return this.getChildBranches().filter((branch) => !branch.getNote().isLabelTruthy("shareHiddenFromTree"));
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

    /**
     * Return an attribute by it's attributeId.  Requires the attribute cache to be available.
     * @param attributeId - the id of the attribute owned by this note
     * @returns - the BAttribute with the given id or undefined if not found.
     */
    getAttributeById(attributeId : string): BAttribute | undefined {
        this.__ensureAttributeCacheIsAvailable();

        if (!this.__attributeCache) {
            throw new Error("Attribute cache not available.");
        }

        return this.__attributeCache.find((attr) => attr.attributeId === attributeId);
    }

    /**
     * Sets an attribute's value by it's attributeId.
     * @param attributeId - the id of the attribute owned by this note
     * @param value - the new value to replace
     */
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

export default BNote;
