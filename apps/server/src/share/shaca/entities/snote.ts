import escape from "escape-html";

import { NOTE_TYPE_ICONS } from "../../../becca/entities/bnote.js";
import type { Blob } from "../../../services/blob-interface.js";
import utils from "../../../services/utils.js";
import sql from "../../sql.js";
import AbstractShacaEntity from "./abstract_shaca_entity.js";
import type { SNoteRow } from "./rows.js";
import type SAttachment from "./sattachment.js";
import type SAttribute from "./sattribute.js";
import type SBranch from "./sbranch.js";

const LABEL = "label";
const RELATION = "relation";
const CREDENTIALS = "shareCredentials";

const isCredentials = (attr: SAttribute) => attr.type === "label" && attr.name === CREDENTIALS;

class SNote extends AbstractShacaEntity {
    noteId: string;
    title: string;
    type: string;
    mime: string;
    private blobId: string;
    utcDateModified: string;
    isProtected: boolean;
    parentBranches: SBranch[];
    parents: SNote[];
    children: SNote[];
    ownedAttributes: SAttribute[];
    private __attributeCache: SAttribute[] | null;
    private __inheritableAttributeCache: SAttribute[] | null;
    targetRelations: SAttribute[];
    attachments: SAttachment[];

    constructor([noteId, title, type, mime, blobId, utcDateModified, isProtected]: SNoteRow) {
        super();

        this.noteId = noteId;
        this.title = isProtected ? "[protected]" : title;
        this.type = type;
        this.mime = mime;
        this.blobId = blobId;
        this.utcDateModified = utcDateModified; // used for caching of images
        this.isProtected = isProtected;

        this.parentBranches = [];
        this.parents = [];
        this.children = [];
        this.ownedAttributes = [];

        this.__attributeCache = null;
        this.__inheritableAttributeCache = null;

        this.targetRelations = [];
        this.attachments = [];

        this.shaca.notes[this.noteId] = this;
    }

    getParentBranches() {
        return this.parentBranches;
    }

    getBranches() {
        return this.parentBranches;
    }

    getChildBranches(): SBranch[] {
        return this.children.map((childNote) => this.shaca.getBranchFromChildAndParent(childNote.noteId, this.noteId));
    }

    getVisibleChildBranches() {
        return this.getChildBranches().filter((branch) => !branch.isHidden && !branch.getNote().isLabelTruthy("shareHiddenFromTree"));
    }

    getParentNotes() {
        return this.parents;
    }

    getChildNotes() {
        return this.children;
    }

    getVisibleChildNotes() {
        return this.getVisibleChildBranches().map((branch) => branch.getNote());
    }

    hasChildren() {
        return this.children && this.children.length > 0;
    }

    hasVisibleChildren() {
        return this.getVisibleChildNotes().length > 0;
    }

    getContent(silentNotFoundError = false) {
        const row = sql.getRow<Pick<Blob, "content">>(/*sql*/`SELECT content FROM blobs WHERE blobId = ?`, [this.blobId]);

        if (!row) {
            if (silentNotFoundError) {
                return undefined;
            }
            throw new Error(`Cannot find note content for note '${this.noteId}', blob '${this.blobId}'`);
        }

        const content = row.content;

        if (this.hasStringContent()) {
            return content === null ? "" : content.toString("utf-8");
        }
        return content;
    }

    /** @returns true if the note has string content (not binary) */
    hasStringContent() {
        return utils.isStringNote(this.type, this.mime);
    }

    /**
     * @param type - (optional) attribute type to filter
     * @param name - (optional) attribute name to filter
     * @returns all note's attributes, including inherited ones
     */
    getAttributes(type?: string, name?: string) {
        let attributeCache = this.__attributeCache;
        if (!attributeCache) {
            attributeCache = this.__getAttributes([]);
        }

        if (type && name) {
            return attributeCache.filter((attr) => attr.type === type && attr.name === name && !isCredentials(attr));
        } else if (type) {
            return attributeCache.filter((attr) => attr.type === type && !isCredentials(attr));
        } else if (name) {
            return attributeCache.filter((attr) => attr.name === name && !isCredentials(attr));
        }
        return attributeCache.filter((attr) => !isCredentials(attr));
    }

    getCredentials() {
        return this.__getAttributes([]).filter(isCredentials);
    }

    __getAttributes(path: string[]) {
        if (path.includes(this.noteId)) {
            return [];
        }

        if (!this.__attributeCache) {
            const parentAttributes = this.ownedAttributes.slice();
            const newPath = [...path, this.noteId];

            if (this.noteId !== "root") {
                for (const parentNote of this.parents) {
                    parentAttributes.push(...parentNote.__getInheritableAttributes(newPath));
                }
            }

            const templateAttributes: SAttribute[] = [];

            for (const ownedAttr of parentAttributes) {
                // parentAttributes so we process also inherited templates
                if (ownedAttr.type === "relation" && ["template", "inherit"].includes(ownedAttr.name)) {
                    const templateNote = this.shaca.notes[ownedAttr.value];

                    if (templateNote) {
                        templateAttributes.push(...templateNote.__getAttributes(newPath));
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

    __getInheritableAttributes(path: string[]) {
        if (path.includes(this.noteId)) {
            return [];
        }

        if (!this.__inheritableAttributeCache) {
            this.__getAttributes(path); // will refresh also this.__inheritableAttributeCache
        }

        return this.__inheritableAttributeCache || [];
    }

    /**
     * @throws Error in case of invalid JSON
     */
    getJsonContent(): unknown | null {
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

    hasAttribute(type: string, name: string) {
        return !!this.getAttributes().find((attr) => attr.type === type && attr.name === name);
    }

    getRelationTarget(name: string) {
        const relation = this.getAttributes().find((attr) => attr.type === "relation" && attr.name === name);

        return relation ? relation.targetNote : null;
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

        return !!label && label.value !== "false";
    }

    /**
     * @param name - label name
     * @returns true if label exists (excluding inherited)
     */
    hasOwnedLabel(name: string) {
        return this.hasOwnedAttribute(LABEL, name);
    }

    /**
     * @param name - relation name
     * @returns true if relation exists (including inherited)
     */
    hasRelation(name: string) {
        return this.hasAttribute(RELATION, name);
    }

    /**
     * @param name - relation name
     * @returns true if relation exists (excluding inherited)
     */
    hasOwnedRelation(name: string) {
        return this.hasOwnedAttribute(RELATION, name);
    }

    /**
     * @param name - label name
     * @returns label if it exists, null otherwise
     */
    getLabel(name: string) {
        return this.getAttribute(LABEL, name);
    }

    /**
     * @param name - label name
     * @returns label if it exists, null otherwise
     */
    getOwnedLabel(name: string) {
        return this.getOwnedAttribute(LABEL, name);
    }

    /**
     * @param name - relation name
     * @returns relation if it exists, null otherwise
     */
    getRelation(name: string) {
        return this.getAttribute(RELATION, name);
    }

    /**
     * @param name - relation name
     * @returns relation if it exists, null otherwise
     */
    getOwnedRelation(name: string) {
        return this.getOwnedAttribute(RELATION, name);
    }

    /**
     * @param name - label name
     * @returns label value if label exists, null otherwise
     */
    getLabelValue(name: string) {
        return this.getAttributeValue(LABEL, name);
    }

    /**
     * @param name - label name
     * @returns label value if label exists, null otherwise
     */
    getOwnedLabelValue(name: string) {
        return this.getOwnedAttributeValue(LABEL, name);
    }

    /**
     * @param name - relation name
     * @returns relation value if relation exists, null otherwise
     */
    getRelationValue(name: string) {
        return this.getAttributeValue(RELATION, name);
    }

    /**
     * @param name - relation name
     * @returns relation value if relation exists, null otherwise
     */
    getOwnedRelationValue(name: string) {
        return this.getOwnedAttributeValue(RELATION, name);
    }

    /**
     * @param type - attribute type (label, relation, etc.)
     * @param name - attribute name
     * @returns true if note has an attribute with given type and name (excluding inherited)
     */
    hasOwnedAttribute(type: string, name: string) {
        return !!this.getOwnedAttribute(type, name);
    }

    /**
     * @param type - attribute type (label, relation, etc.)
     * @param name - attribute name
     * @returns attribute of the given type and name. If there are more such attributes, first is  returned.
     * Returns null if there's no such attribute belonging to this note.
     */
    getAttribute(type: string, name: string) {
        const attributes = this.getAttributes();

        return attributes.find((attr) => attr.type === type && attr.name === name);
    }

    /**
     * @param type - attribute type (label, relation, etc.)
     * @param name - attribute name
     * @returns attribute value of the given type and name or null if no such attribute exists.
     */
    getAttributeValue(type: string, name: string) {
        const attr = this.getAttribute(type, name);

        return attr ? attr.value : null;
    }

    /**
     * @param type - attribute type (label, relation, etc.)
     * @param name - attribute name
     * @returns attribute value of the given type and name or null if no such attribute exists.
     */
    getOwnedAttributeValue(type: string, name: string) {
        const attr = this.getOwnedAttribute(type, name);

        return attr ? (attr.value as string) : null; // FIXME
    }

    /**
     * @param name - label name to filter
     * @returns all note's labels (attributes with type label), including inherited ones
     */
    getLabels(name: string) {
        return this.getAttributes(LABEL, name);
    }

    /**
     * @param name - label name to filter
     * @returns all note's label values, including inherited ones
     */
    getLabelValues(name: string) {
        return this.getLabels(name).map((l) => l.value) as string[]; // FIXME
    }

    /**
     * @param name - label name to filter
     * @returns all note's labels (attributes with type label), excluding inherited ones
     */
    getOwnedLabels(name: string) {
        return this.getOwnedAttributes(LABEL, name);
    }

    /**
     * @param name - label name to filter
     * @returns all note's label values, excluding inherited ones
     */
    getOwnedLabelValues(name: string) {
        return this.getOwnedAttributes(LABEL, name).map((l) => l.value);
    }

    /**
     * @param name - relation name to filter
     * @returns all note's relations (attributes with type relation), including inherited ones
     */
    getRelations(name: string) {
        return this.getAttributes(RELATION, name);
    }

    /**
     * @param name - relation name to filter
     * @returns all note's relations (attributes with type relation), excluding inherited ones
     */
    getOwnedRelations(name: string) {
        return this.getOwnedAttributes(RELATION, name);
    }

    /**
     * @param type - (optional) attribute type to filter
     * @param name - (optional) attribute name to filter
     * @returns note's "owned" attributes - excluding inherited ones
     */
    getOwnedAttributes(type: string, name: string) {
        // it's a common mistake to include # or ~ into attribute name
        if (name && ["#", "~"].includes(name[0])) {
            name = name.substr(1);
        }

        if (type && name) {
            return this.ownedAttributes.filter((attr) => attr.type === type && attr.name === name);
        } else if (type) {
            return this.ownedAttributes.filter((attr) => attr.type === type);
        } else if (name) {
            return this.ownedAttributes.filter((attr) => attr.name === name);
        }
        return this.ownedAttributes.slice();
    }

    /**
     * @returns attribute belonging to this specific note (excludes inherited attributes)
     *
     * This method can be significantly faster than the getAttribute()
     */
    getOwnedAttribute(type: string, name: string) {
        const attrs = this.getOwnedAttributes(type, name);

        return attrs.length > 0 ? attrs[0] : null;
    }

    get isArchived() {
        return this.hasAttribute("label", "archived");
    }

    isInherited() {
        return !!this.targetRelations.find((rel) => rel.name === "template" || rel.name === "inherit");
    }

    getTargetRelations() {
        return this.targetRelations;
    }

    getAttachments() {
        return this.attachments;
    }

    getAttachmentByTitle(title: string) {
        return this.attachments.find((attachment) => attachment.title === title);
    }

    get shareId() {
        if (this.hasOwnedLabel("shareRoot")) {
            return "";
        }

        const sharedAlias = this.getOwnedLabelValue("shareAlias");

        return sharedAlias || this.noteId;
    }

    get escapedTitle() {
        return escape(this.title);
    }

    get encodedTitle() {
        return encodeURIComponent(this.title);
    }

    getPojo() {
        return {
            noteId: this.noteId,
            title: this.title,
            type: this.type,
            mime: this.mime,
            utcDateModified: this.utcDateModified,
            attributes: this.getAttributes()
                // relations could link across shared subtrees which might leak them
                // individual relations might be whitelisted based on needs #3434
                .filter((attr) => attr.type === "label")
                .map((attr) => attr.getPojo()),
            attachments: this.getAttachments().map((attachment) => attachment.getPojo()),
            parentNoteIds: this.parents.map((parentNote) => parentNote.noteId),
            childNoteIds: this.children.map((child) => child.noteId)
        };
    }

    getIcon(filterByPrefix: string[] = []) {
        return `tn-icon ${this.#getIconInternal(filterByPrefix)}`;
    }

    #getIconInternal(filterByPrefix: string[] = []) {
        const iconClassLabels = this.getLabels("iconClass").filter(label => {
            if (filterByPrefix.length === 0) {
                return true;
            }
            return filterByPrefix.some(prefix => label.value.startsWith(prefix));
        });

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

    isFolder() {
        return this.getChildBranches().length > 0;
    }
}

export default SNote;
