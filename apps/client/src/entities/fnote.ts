import { MIME_TYPES_DICT } from "@triliumnext/commons";

import cssClassManager from "../services/css_class_manager.js";
import type { Froca } from "../services/froca-interface.js";
import noteAttributeCache from "../services/note_attribute_cache.js";
import protectedSessionHolder from "../services/protected_session_holder.js";
import search from "../services/search.js";
import server from "../services/server.js";
import utils from "../services/utils.js";
import type FAttachment from "./fattachment.js";
import type { AttributeType,default as FAttribute } from "./fattribute.js";

const LABEL = "label";
const RELATION = "relation";

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
    aiChat: "bx bx-bot"
};

/**
 * There are many different Note types, some of which are entirely opaque to the
 * end user. Those types should be used only for checking against, they are
 * not for direct use.
 */
export type NoteType = "file" | "image" | "search" | "noteMap" | "launcher" | "doc" | "contentWidget" | "text" | "relationMap" | "render" | "canvas" | "mermaid" | "book" | "webView" | "code" | "mindMap" | "aiChat";

export interface NotePathRecord {
    isArchived: boolean;
    isInHoistedSubTree: boolean;
    isSearch?: boolean;
    notePath: string[];
    isHidden: boolean;
}

export interface FNoteRow {
    noteId: string;
    title: string;
    isProtected: boolean;
    type: NoteType;
    mime: string;
    blobId: string;
}

export interface NoteMetaData {
    dateCreated: string;
    utcDateCreated: string;
    dateModified: string;
    utcDateModified: string;
}

/**
 * Note is the main node and concept in Trilium.
 */
export default class FNote {
    private froca: Froca;

    noteId!: string;
    title!: string;
    isProtected!: boolean;
    type!: NoteType;
    /**
     * content-type, e.g. "application/json"
     */
    mime!: string;
    // the main use case to keep this is to detect content change which should trigger refresh
    blobId!: string;

    attributes: string[];
    targetRelations: string[];
    parents: string[];
    children: string[];

    parentToBranch: Record<string, string>;
    childToBranch: Record<string, string>;
    attachments: FAttachment[] | null;

    // Managed by Froca.
    searchResultsLoaded?: boolean;
    highlightedTokens?: string[];

    constructor(froca: Froca, row: FNoteRow) {
        this.froca = froca;
        this.attributes = [];
        this.targetRelations = [];
        this.parents = [];
        this.children = [];

        this.parentToBranch = {};
        this.childToBranch = {};

        this.attachments = null; // lazy loaded

        this.update(row);
    }

    update(row: FNoteRow) {
        this.noteId = row.noteId;
        this.title = row.title;
        this.isProtected = !!row.isProtected;
        this.type = row.type;

        this.mime = row.mime;

        this.blobId = row.blobId;
    }

    addParent(parentNoteId: string, branchId: string, sort = true) {
        if (parentNoteId === "none") {
            return;
        }

        if (!this.parents.includes(parentNoteId)) {
            this.parents.push(parentNoteId);
        }

        this.parentToBranch[parentNoteId] = branchId;

        if (sort) {
            this.sortParents();
        }
    }

    addChild(childNoteId: string, branchId: string, sort = true) {
        if (!(childNoteId in this.childToBranch)) {
            this.children.push(childNoteId);
        }

        this.childToBranch[childNoteId] = branchId;

        if (sort) {
            this.sortChildren();
        }
    }

    sortChildren() {
        const branchIdPos: Record<string, number> = {};

        for (const branchId of Object.values(this.childToBranch)) {
            const notePosition = this.froca.getBranch(branchId)?.notePosition;
            if (notePosition !== undefined) {
                branchIdPos[branchId] = notePosition;
            }
        }

        this.children.sort((a, b) => branchIdPos[this.childToBranch[a]] - branchIdPos[this.childToBranch[b]]);
    }

    isJson() {
        return this.mime === "application/json";
    }

    async getContent() {
        const blob = await this.getBlob();

        return blob?.content;
    }

    async getJsonContent() {
        const content = await this.getContent();

        if (typeof content !== "string") {
            console.log(`Unknown note content for '${this.noteId}'.`);
            return null;
        }

        try {
            return JSON.parse(content);
        } catch (e: any) {
            console.log(`Cannot parse content of note '${this.noteId}': `, e.message);

            return null;
        }
    }

    getParentBranchIds() {
        return Object.values(this.parentToBranch);
    }

    /**
     * @deprecated use getParentBranchIds() instead
     */
    getBranchIds() {
        return this.getParentBranchIds();
    }

    getParentBranches() {
        const branchIds = Object.values(this.parentToBranch);

        return this.froca.getBranches(branchIds);
    }

    /**
     * @deprecated use getParentBranches() instead
     */
    getBranches() {
        return this.getParentBranches();
    }

    hasChildren() {
        return this.children.length > 0;
    }

    getChildBranches() {
        // don't use Object.values() to guarantee order
        const branchIds = this.children.map((childNoteId) => this.childToBranch[childNoteId]);

        return this.froca.getBranches(branchIds);
    }

    getParentNoteIds() {
        return this.parents;
    }

    getParentNotes() {
        return this.froca.getNotesFromCache(this.parents);
    }

    // will sort the parents so that non-search & non-archived are first and archived at the end
    // this is done so that non-search & non-archived paths are always explored as first when looking for a note path
    sortParents() {
        this.parents.sort((aNoteId, bNoteId) => {
            const aBranchId = this.parentToBranch[aNoteId];

            if (aBranchId && aBranchId.startsWith("virt-")) {
                return 1;
            }

            const aNote = this.froca.getNoteFromCache(aNoteId);

            if (!aNote || aNote.isArchived || aNote.isHiddenCompletely()) {
                return 1;
            }

            return aNoteId < bNoteId ? -1 : 1;
        });
    }

    get isArchived() {
        return this.hasAttribute("label", "archived");
    }

    getChildNoteIds() {
        return this.children;
    }

    async getChildNoteIdsWithArchiveFiltering(includeArchived = false) {
        const isHiddenNote = this.noteId.startsWith("_");
        const isSearchNote = this.type === "search";
        if (!includeArchived && !isHiddenNote && !isSearchNote) {
            const unorderedIds = new Set(await search.searchForNoteIds(`note.parents.noteId="${this.noteId}" #!archived`));
            const results: string[] = [];
            for (const id of this.children) {
                if (unorderedIds.has(id)) {
                    results.push(id);
                }
            }
            return results;
        }
        return this.children;
    }

    async getSubtreeNoteIds(includeArchived = false) {
        const noteIds: (string | string[])[] = [];
        for (const child of await this.getChildNotes()) {
            if (child.isArchived && !includeArchived) continue;

            noteIds.push(child.noteId);
            noteIds.push(await child.getSubtreeNoteIds(includeArchived));
        }
        return noteIds.flat();
    }

    async getSubtreeNotes() {
        const noteIds = await this.getSubtreeNoteIds();
        return (await this.froca.getNotes(noteIds));
    }

    async getChildNotes() {
        return await this.froca.getNotes(this.children);
    }

    async getAttachments() {
        if (!this.attachments) {
            this.attachments = await this.froca.getAttachmentsForNote(this.noteId);
        }

        return this.attachments;
    }

    async getAttachmentsByRole(role: string) {
        return (await this.getAttachments()).filter((attachment) => attachment.role === role);
    }

    async getAttachmentById(attachmentId: string) {
        const attachments = await this.getAttachments();

        return attachments.find((att) => att.attachmentId === attachmentId);
    }

    isEligibleForConversionToAttachment() {
        if (this.type !== "image" || !this.isContentAvailable() || this.hasChildren() || this.getParentBranches().length !== 1) {
            return false;
        }

        const targetRelations = this.getTargetRelations().filter((relation) => relation.name === "imageLink");

        if (targetRelations.length > 1) {
            return false;
        }

        const parentNote = this.getParentNotes()[0]; // at this point note can have only one parent
        const referencingNote = targetRelations[0]?.getNote();

        if (referencingNote && referencingNote !== parentNote) {
            return false;
        } else if (parentNote.type !== "text" || !parentNote.isContentAvailable()) {
            return false;
        }

        return true;
    }

    /**
     * @param [type] - attribute type to filter
     * @param [name] - attribute name to filter
     * @returns all note's attributes, including inherited ones
     */
    getOwnedAttributes(type?: AttributeType, name?: string) {
        const attrs = this.attributes.map((attributeId) => this.froca.attributes[attributeId]).filter(Boolean); // filter out nulls;

        return this.__filterAttrs(attrs, type, name);
    }

    /**
     * @param [type] - attribute type to filter
     * @param [name] - attribute name to filter
     * @returns all note's attributes, including inherited ones
     */
    getAttributes(type?: AttributeType, name?: string) {
        return this.__filterAttrs(this.__getCachedAttributes([]), type, name);
    }

    /**
     * @private
     */
    __getCachedAttributes(path: string[]): FAttribute[] {
        // notes/clones cannot form tree cycles, it is possible to create attribute inheritance cycle via templates
        // when template instance is a parent of template itself
        if (path.includes(this.noteId)) {
            console.log("Forming a path");
            return [];
        }

        if (!(this.noteId in noteAttributeCache.attributes)) {
            const newPath = [...path, this.noteId];
            const attrArrs = [this.getOwnedAttributes()];

            // inheritable attrs on root are typically not intended to be applied to hidden subtree #3537
            if (this.noteId !== "root" && this.noteId !== "_hidden") {
                for (const parentNote of this.getParentNotes()) {
                    // these virtual parent-child relationships are also loaded into froca
                    if (parentNote.type !== "search") {
                        attrArrs.push(parentNote.__getInheritableAttributes(newPath));
                    }
                }
            }

            for (const templateAttr of attrArrs.flat().filter((attr) => attr.type === "relation" && ["template", "inherit"].includes(attr.name))) {
                const templateNote = this.froca.notes[templateAttr.value];

                if (templateNote && templateNote.noteId !== this.noteId) {
                    attrArrs.push(
                        templateNote
                            .__getCachedAttributes(newPath)
                            // template attr is used as a marker for templates, but it's not meant to be inherited
                            .filter((attr) => !(attr.type === "label" && (attr.name === "template" || attr.name === "workspacetemplate")))
                    );
                }
            }

            noteAttributeCache.attributes[this.noteId] = [];
            const addedAttributeIds = new Set();

            for (const attr of attrArrs.flat()) {
                if (!addedAttributeIds.has(attr.attributeId)) {
                    addedAttributeIds.add(attr.attributeId);

                    noteAttributeCache.attributes[this.noteId].push(attr);
                }
            }
        }

        return noteAttributeCache.attributes[this.noteId];
    }

    isRoot() {
        return this.noteId === "root";
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

        const parentNotes = this.getParentNotes().filter((note) => note.type !== "search");

        const notePaths =
            parentNotes.length === 1
                ? parentNotes[0].getAllNotePaths() // optimization for the most common case
                : parentNotes.flatMap((parentNote) => parentNote.getAllNotePaths());

        for (const notePath of notePaths) {
            notePath.push(this.noteId);
        }

        return notePaths;
    }

    getSortedNotePathRecords(hoistedNoteId = "root", activeNotePath: string | null = null): NotePathRecord[] {
        const isHoistedRoot = hoistedNoteId === "root";

        const notePaths: NotePathRecord[] = this.getAllNotePaths().map((path) => ({
            notePath: path,
            isInHoistedSubTree: isHoistedRoot || path.includes(hoistedNoteId),
            isArchived: path.some((noteId) => this.froca.notes[noteId].isArchived),
            isSearch: path.some((noteId) => this.froca.notes[noteId].type === "search"),
            isHidden: path.includes("_hidden")
        }));

        // Calculate the length of the prefix match between two arrays
        const prefixMatchLength = (path: string[], target: string[]) => {
            const diffIndex = path.findIndex((seg, i) => seg !== target[i]);
            return diffIndex === -1 ? Math.min(path.length, target.length) : diffIndex;
        };

        notePaths.sort((a, b) => {
            if (activeNotePath) {
                const activeSegments = activeNotePath.split('/');
                const aOverlap = prefixMatchLength(a.notePath, activeSegments);
                const bOverlap = prefixMatchLength(b.notePath, activeSegments);
                // Paths with more matching prefix segments are prioritized
                // when the match count is equal, other criteria are used for sorting
                if (bOverlap !== aOverlap) {
                    return bOverlap - aOverlap;
                }
            }
            if (a.isInHoistedSubTree !== b.isInHoistedSubTree) {
                return a.isInHoistedSubTree ? -1 : 1;
            } else if (a.isArchived !== b.isArchived) {
                return a.isArchived ? 1 : -1;
            } else if (a.isHidden !== b.isHidden) {
                return a.isHidden ? 1 : -1;
            } else if (a.isSearch !== b.isSearch) {
                return a.isSearch ? 1 : -1;
            }
            return a.notePath.length - b.notePath.length;
        });

        return notePaths;
    }

    /**
     * Returns the note path considered to be the "best"
     *
     * @param {string} [hoistedNoteId='root']
     * @param {string|null} [activeNotePath=null]
     * @return {string[]} array of noteIds constituting the particular note path
     */
    getBestNotePath(hoistedNoteId = "root", activeNotePath: string | null = null) {
        return this.getSortedNotePathRecords(hoistedNoteId, activeNotePath)[0]?.notePath;
    }

    /**
     * Returns the note path considered to be the "best"
     *
     * @param {string} [hoistedNoteId='root']
     * @return {string} serialized note path (e.g. 'root/a1h315/js725h')
     */
    getBestNotePathString(hoistedNoteId = "root") {
        const notePath = this.getBestNotePath(hoistedNoteId);

        return notePath?.join("/");
    }

    /**
     * @return boolean - true if there's no non-hidden path, note is not cloned to the visible tree
     */
    isHiddenCompletely() {
        if (this.noteId === "_hidden") {
            return true;
        } else if (this.noteId === "root") {
            return false;
        }

        for (const parentNote of this.getParentNotes()) {
            if (parentNote.noteId === "root") {
                return false;
            } else if (parentNote.noteId === "_hidden" || parentNote.type === "search") {
                continue;
            }

            if (!parentNote.isHiddenCompletely()) {
                return false;
            }
        }

        return true;
    }

    /**
     * @private
     */
    __filterAttrs(attributes: FAttribute[], type?: AttributeType, name?: string): FAttribute[] {
        this.__validateTypeName(type, name);

        if (!type && !name) {
            return attributes;
        } else if (type && name) {
            return attributes.filter((attr) => attr.name === name && attr.type === type);
        } else if (type) {
            return attributes.filter((attr) => attr.type === type);
        } else if (name) {
            return attributes.filter((attr) => attr.name === name);
        }

        return [];
    }

    __getInheritableAttributes(path: string[]) {
        const attrs = this.__getCachedAttributes(path);

        return attrs.filter((attr) => attr.isInheritable);
    }

    __validateTypeName(type?: string, name?: string) {
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

    /**
     * @param name - label name to filter
     * @returns all note's labels (attributes with type label), including inherited ones
     */
    getOwnedLabels(name?: string) {
        return this.getOwnedAttributes(LABEL, name);
    }

    /**
     * @param [name] - label name to filter
     * @returns all note's labels (attributes with type label), including inherited ones
     */
    getLabels(name: string) {
        return this.getAttributes(LABEL, name);
    }

    getIcon() {
        return `tn-icon ${this.#getIconInternal()}`;
    }

    #getIconInternal() {
        const iconClassLabels = this.getLabels("iconClass");
        const workspaceIconClass = this.getWorkspaceIconClass();

        if (iconClassLabels && iconClassLabels.length > 0) {
            return iconClassLabels[0].value;
        } else if (workspaceIconClass) {
            return workspaceIconClass;
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
        } else if (this.type === "code") {
            const correspondingMimeType = MIME_TYPES_DICT.find(m => m.mime === this.mime);
            return correspondingMimeType?.icon ?? NOTE_TYPE_ICONS.code;
        }
        return NOTE_TYPE_ICONS[this.type];
    }

    getColorClass() {
        const color = this.getLabelValue("color");
        return cssClassManager.createClassForColor(color);
    }

    isFolder() {
        return this.type === "search" || this.getFilteredChildBranches().length > 0;
    }

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

    /**
     * @param [name] - relation name to filter
     * @returns all note's relations (attributes with type relation), including inherited ones
     */
    getOwnedRelations(name: string) {
        return this.getOwnedAttributes(RELATION, name);
    }

    /**
     * @param [name] - relation name to filter
     * @returns all note's relations (attributes with type relation), including inherited ones
     */
    getRelations(name?: string) {
        return this.getAttributes(RELATION, name);
    }

    /**
     * @param type - attribute type (label, relation, etc.)
     * @param name - attribute name
     * @returns true if note has an attribute with given type and name (including inherited)
     */
    hasAttribute(type: AttributeType, name: string) {
        const attributes = this.getAttributes();

        return attributes.some((attr) => attr.name === name && attr.type === type);
    }

    /**
     * @param type - attribute type (label, relation, etc.)
     * @param name - attribute name
     * @returns true if note has an attribute with given type and name (including inherited)
     */
    hasOwnedAttribute(type: AttributeType, name: string) {
        return !!this.getOwnedAttribute(type, name);
    }

    /**
     * @param type - attribute type (label, relation, etc.)
     * @param name - attribute name
     * @returns attribute of the given type and name. If there are more such attributes, first is returned. Returns null if there's no such attribute belonging to this note.
     */
    getOwnedAttribute(type: AttributeType, name: string) {
        const attributes = this.getOwnedAttributes();

        return attributes.find((attr) => attr.name === name && attr.type === type);
    }

    /**
     * @param type - attribute type (label, relation, etc.)
     * @param name - attribute name
     * @returns attribute of the given type and name. If there are more such attributes, first is returned. Returns null if there's no such attribute belonging to this note.
     */
    getAttribute(type: AttributeType, name: string) {
        const attributes = this.getAttributes();

        return attributes.find((attr) => attr.name === name && attr.type === type);
    }

    /**
     * @param type - attribute type (label, relation, etc.)
     * @param name - attribute name
     * @returns attribute value of the given type and name or null if no such attribute exists.
     */
    getOwnedAttributeValue(type: AttributeType, name: string) {
        const attr = this.getOwnedAttribute(type, name);

        return attr ? attr.value : null;
    }

    /**
     * @param type - attribute type (label, relation, etc.)
     * @param name - attribute name
     * @returns attribute value of the given type and name or null if no such attribute exists.
     */
    getAttributeValue(type: AttributeType, name: string) {
        const attr = this.getAttribute(type, name);

        return attr ? attr.value : null;
    }

    /**
     * @param name - label name
     * @returns true if label exists (excluding inherited)
     */
    hasOwnedLabel(name: string) {
        return this.hasOwnedAttribute(LABEL, name);
    }

    /**
     * @param name - label name
     * @returns true if label exists (including inherited)
     */
    hasLabel(name: string) {
        return this.hasAttribute(LABEL, name);
    }

    /**
     * @param name - label name
     * @returns true if label exists (including inherited) and does not have "false" value.
     */
    isLabelTruthy(name: string) {
        const label = this.getLabel(name);

        if (!label) {
            return false;
        }

        return label && label.value !== "false";
    }

    /**
     * @param name - relation name
     * @returns true if relation exists (excluding inherited)
     */
    hasOwnedRelation(name: string) {
        return this.hasOwnedAttribute(RELATION, name);
    }

    /**
     * @param name - relation name
     * @returns true if relation exists (including inherited)
     */
    hasRelation(name: string) {
        return this.hasAttribute(RELATION, name);
    }

    /**
     * @param name - label name
     * @returns label if it exists, null otherwise
     */
    getOwnedLabel(name: string) {
        return this.getOwnedAttribute(LABEL, name);
    }

    /**
     * @param name - label name
     * @returns label if it exists, null otherwise
     */
    getLabel(name: string) {
        return this.getAttribute(LABEL, name);
    }

    /**
     * @param name - relation name
     * @returns relation if it exists, null otherwise
     */
    getOwnedRelation(name: string) {
        return this.getOwnedAttribute(RELATION, name);
    }

    /**
     * @param name - relation name
     * @returns relation if it exists, null otherwise
     */
    getRelation(name: string) {
        return this.getAttribute(RELATION, name);
    }

    /**
     * @param name - label name
     * @returns label value if label exists, null otherwise
     */
    getOwnedLabelValue(name: string) {
        return this.getOwnedAttributeValue(LABEL, name);
    }

    /**
     * @param name - label name
     * @returns label value if label exists, null otherwise
     */
    getLabelValue(name: string) {
        return this.getAttributeValue(LABEL, name);
    }

    getLabelOrRelation(nameWithPrefix: string) {
        if (nameWithPrefix.startsWith("#")) {
            return this.getLabelValue(nameWithPrefix.substring(1));
        } else if (nameWithPrefix.startsWith("~")) {
            return this.getRelationValue(nameWithPrefix.substring(1));
        }
        return this.getLabelValue(nameWithPrefix);

    }

    /**
     * @param name - relation name
     * @returns relation value if relation exists, null otherwise
     */
    getOwnedRelationValue(name: string) {
        return this.getOwnedAttributeValue(RELATION, name);
    }

    /**
     * @param name - relation name
     * @returns relation value if relation exists, null otherwise
     */
    getRelationValue(name: string) {
        return this.getAttributeValue(RELATION, name);
    }

    /**
     * @param name
     * @returns target note of the relation or null (if target is empty or note was not found)
     */
    async getRelationTarget(name: string) {
        const targets = await this.getRelationTargets(name);

        return targets.length > 0 ? targets[0] : null;
    }

    /**
     * @param [name] - relation name to filter
     */
    async getRelationTargets(name: string) {
        const relations = this.getRelations(name);
        const targets: (FNote | null)[] = [];

        for (const relation of relations) {
            targets.push(await this.froca.getNote(relation.value));
        }

        return targets;
    }

    getNotesToInheritAttributesFrom() {
        const relations = [...this.getRelations("template"), ...this.getRelations("inherit")];

        return relations.map((rel) => this.froca.notes[rel.value]);
    }

    getPromotedDefinitionAttributes() {
        if (this.isLabelTruthy("hidePromotedAttributes")) {
            return [];
        }

        const promotedAttrs = this.getAttributeDefinitions()
            .filter((attr) => {
                const def = attr.getDefinition();

                return def && def.isPromoted;
            });

        // attrs are not resorted if position changes after the initial load
        promotedAttrs.sort((a, b) => {
            if (a.noteId === b.noteId) {
                return a.position < b.position ? -1 : 1;
            }
            // inherited promoted attributes should stay grouped: https://github.com/zadam/trilium/issues/3761
            return a.noteId < b.noteId ? -1 : 1;

        });

        return promotedAttrs;
    }

    getAttributeDefinitions() {
        return this.getAttributes()
            .filter((attr) => attr.isDefinition());
    }

    hasAncestor(ancestorNoteId: string, followTemplates = false, visitedNoteIds: Set<string> | null = null) {
        if (this.noteId === ancestorNoteId) {
            return true;
        }

        if (!visitedNoteIds) {
            visitedNoteIds = new Set();
        } else if (visitedNoteIds.has(this.noteId)) {
            // to avoid infinite cycle when template is descendent of the instance
            return false;
        }

        visitedNoteIds.add(this.noteId);

        if (followTemplates) {
            for (const templateNote of this.getNotesToInheritAttributesFrom()) {
                if (templateNote.hasAncestor(ancestorNoteId, followTemplates, visitedNoteIds)) {
                    return true;
                }
            }
        }

        for (const parentNote of this.getParentNotes()) {
            if (parentNote.hasAncestor(ancestorNoteId, followTemplates, visitedNoteIds)) {
                return true;
            }
        }

        return false;
    }

    isInHiddenSubtree() {
        return this.noteId === "_hidden" || this.hasAncestor("_hidden");
    }

    /**
     * @deprecated NOOP
     */
    invalidateAttributeCache() {}

    /**
     * Get relations which target this note
     */
    getTargetRelations() {
        return this.targetRelations.map((attributeId) => this.froca.attributes[attributeId]);
    }

    /**
     * Get relations which target this note
     */
    async getTargetRelationSourceNotes() {
        const targetRelations = this.getTargetRelations();

        return await this.froca.getNotes(targetRelations.map((tr) => tr.noteId));
    }

    /**
     * @deprecated use getBlob() instead
     */
    async getNoteComplement() {
        return this.getBlob();
    }

    getBlob() {
        return this.froca.getBlob("notes", this.noteId);
    }

    toString() {
        return `Note(noteId=${this.noteId}, title=${this.title})`;
    }

    get dto(): Omit<FNote, "froca"> {
        const dto = Object.assign({}, this) as any;
        delete dto.froca;

        return dto;
    }

    getCssClass() {
        const labels = this.getLabels("cssClass");
        return labels.map((l) => l.value).join(" ");
    }

    getWorkspaceIconClass() {
        const labels = this.getLabels("workspaceIconClass");
        return labels.length > 0 ? labels[0].value : "";
    }

    getWorkspaceTabBackgroundColor() {
        const labels = this.getLabels("workspaceTabBackgroundColor");
        return labels.length > 0 ? labels[0].value : "";
    }

    /** @returns true if this note is JavaScript (code or file) */
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
        return (this.type === "code" || this.type === "file" || this.type === "render") && this.mime === "text/html";
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
     * Executes this {@link FNote} as a front-end or back-end script.
     *
     * @throws an {@link Error} if the note has an incorrect note type or MIME for execution.
     * @returns a promise that resolves when the script has been run. Additionally, for front-end notes, the promise will contain the value that is returned by the script.
     */
    async executeScript() {
        if (!(this.isJavaScript() || this.isJsx())) {
            throw new Error(`Note ${this.noteId} is of type ${this.type} and mime ${this.mime} and thus cannot be executed`);
        }

        const env = this.getScriptEnv();

        if (env === "frontend") {
            const bundleService = (await import("../services/bundle.js")).default;
            return await bundleService.getAndExecuteBundle(this.noteId);
        } else if (env === "backend") {
            await server.post(`script/run/${this.noteId}`);
        } else {
            throw new Error(`Unrecognized env type ${env} for note ${this.noteId}`);
        }
    }

    isShared() {
        for (const parentNoteId of this.parents) {
            if (parentNoteId === "root" || parentNoteId === "none") {
                continue;
            }

            const parentNote = this.froca.notes[parentNoteId];

            if (!parentNote || parentNote.type === "search") {
                continue;
            }

            if (parentNote.noteId === "_share" || parentNote.isShared()) {
                return true;
            }
        }

        return false;
    }

    isContentAvailable() {
        return !this.isProtected || protectedSessionHolder.isProtectedSessionAvailable();
    }

    isLaunchBarConfig() {
        return this.type === "launcher" || utils.isLaunchBarConfig(this.noteId);
    }

    isOptions() {
        return this.noteId.startsWith("_options");
    }

    isTriliumSqlite() {
        return this.mime === "text/x-sqlite;schema=trilium";
    }

    isTriliumScript() {
        return this.mime.startsWith("application/javascript");
    }

    /**
     * Provides note's date metadata.
     */
    async getMetadata() {
        return await server.get<NoteMetaData>(`notes/${this.noteId}/metadata`);
    }
}
