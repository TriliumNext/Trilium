"use strict";

const protectedSessionService = require('../../protected_session');
const log = require('../../log');

class Note {
    constructor(noteCache, row) {
        /** @param {NoteCache} */
        this.noteCache = noteCache;

        this.update(row);

        /** @param {Branch[]} */
        this.parentBranches = [];
        /** @param {Note[]} */
        this.parents = [];
        /** @param {Note[]} */
        this.children = [];
        /** @param {Attribute[]} */
        this.ownedAttributes = [];

        /** @param {Attribute[]|null} */
        this.attributeCache = null;
        /** @param {Attribute[]|null} */
        this.inheritableAttributeCache = null;

        /** @param {Attribute[]} */
        this.targetRelations = [];

        this.noteCache.notes[this.noteId] = this;

        /** @param {Note[]|null} */
        this.ancestorCache = null;

        // following attributes are filled during searching from database

        /** @param {int} size of the content in bytes */
        this.contentSize = null;
        /** @param {int} size of the content and note revision contents in bytes */
        this.noteSize = null;
        /** @param {int} number of note revisions for this note */
        this.revisionCount = null;
    }

    update(row) {
        /** @param {string} */
        this.noteId = row.noteId;
        /** @param {string} */
        this.title = row.title;
        /** @param {string} */
        this.type = row.type;
        /** @param {string} */
        this.mime = row.mime;
        /** @param {string} */
        this.dateCreated = row.dateCreated;
        /** @param {string} */
        this.dateModified = row.dateModified;
        /** @param {string} */
        this.utcDateCreated = row.utcDateCreated;
        /** @param {string} */
        this.utcDateModified = row.utcDateModified;
        /** @param {boolean} */
        this.isProtected = !!row.isProtected;
        /** @param {boolean} */
        this.isDecrypted = !row.isProtected || !!row.isContentAvailable;

        this.decrypt();

        /** @param {string|null} */
        this.flatTextCache = null;
    }

    /** @return {Attribute[]} */
    get attributes() {
        return this.__getAttributes([]);
    }

    __getAttributes(path) {
        if (path.includes(this.noteId)) {
            return [];
        }

        if (!this.attributeCache) {
            const parentAttributes = this.ownedAttributes.slice();
            const newPath = [...path, this.noteId];

            if (this.noteId !== 'root') {
                for (const parentNote of this.parents) {
                    parentAttributes.push(...parentNote.__getInheritableAttributes(newPath));
                }
            }

            const templateAttributes = [];

            for (const ownedAttr of parentAttributes) { // parentAttributes so we process also inherited templates
                if (ownedAttr.type === 'relation' && ownedAttr.name === 'template') {
                    const templateNote = this.noteCache.notes[ownedAttr.value];

                    if (templateNote) {
                        templateAttributes.push(...templateNote.__getAttributes(newPath));
                    }
                }
            }

            this.attributeCache = [];

            const addedAttributeIds = new Set();

            for (const attr of parentAttributes.concat(templateAttributes)) {
                if (!addedAttributeIds.has(attr.attributeId)) {
                    addedAttributeIds.add(attr.attributeId);

                    this.attributeCache.push(attr);
                }
            }

            this.inheritableAttributeCache = [];

            for (const attr of this.attributeCache) {
                if (attr.isInheritable) {
                    this.inheritableAttributeCache.push(attr);
                }
            }
        }

        return this.attributeCache;
    }

    /** @return {Attribute[]} */
    __getInheritableAttributes(path) {
        if (path.includes(this.noteId)) {
            return [];
        }

        if (!this.inheritableAttributeCache) {
            this.__getAttributes(path); // will refresh also this.inheritableAttributeCache
        }

        return this.inheritableAttributeCache;
    }

    hasAttribute(type, name) {
        return !!this.attributes.find(attr => attr.type === type && attr.name === name);
    }

    getAttributeCaseInsensitive(type, name, value) {
        name = name.toLowerCase();
        value = value ? value.toLowerCase() : null;

        return this.attributes.find(
            attr => attr.type === type
            && attr.name.toLowerCase() === name
            && (!value || attr.value.toLowerCase() === value));
    }

    hasLabel(name) {
        return this.hasAttribute('label', name);
    }

    hasRelation(name) {
        return this.hasAttribute('relation', name);
    }

    getLabelValue(name) {
        const label = this.attributes.find(attr => attr.type === 'label' && attr.name === name);

        return label ? label.value : null;
    }

    getRelationTarget(name) {
        const relation = this.attributes.find(attr => attr.type === 'relation' && attr.name === name);

        return relation ? relation.targetNote : null;
    }

    get isArchived() {
        return this.hasAttribute('label', 'archived');
    }

    get hasInheritableOwnedArchivedLabel() {
        return !!this.ownedAttributes.find(attr => attr.type === 'label' && attr.name === 'archived' && attr.isInheritable);
    }

    // will sort the parents so that non-search & non-archived are first and archived at the end
    // this is done so that non-search & non-archived paths are always explored as first when looking for note path
    resortParents() {
        this.parentBranches.sort((a, b) =>
            a.branchId.startsWith('virt-')
            || a.parentNote.hasInheritableOwnedArchivedLabel ? 1 : -1);

        this.parents = this.parentBranches.map(branch => branch.parentNote);
    }

    /**
     * This is used for:
     * - fast searching
     * - note similarity evaluation
     *
     * @return {string} - returns flattened textual representation of note, prefixes and attributes
     */
    get flatText() {
        if (!this.flatTextCache) {
            this.flatTextCache = this.noteId + ' ' + this.type + ' ' + this.mime + ' ';

            for (const branch of this.parentBranches) {
                if (branch.prefix) {
                    this.flatTextCache += branch.prefix + ' ';
                }
            }

            this.flatTextCache += this.title + ' ';

            for (const attr of this.attributes) {
                // it's best to use space as separator since spaces are filtered from the search string by the tokenization into words
                this.flatTextCache += (attr.type === 'label' ? '#' : '~') + attr.name;

                if (attr.value) {
                    this.flatTextCache += '=' + attr.value;
                }

                this.flatTextCache += ' ';
            }

            this.flatTextCache = this.flatTextCache.toLowerCase();
        }

        return this.flatTextCache;
    }

    invalidateThisCache() {
        this.flatTextCache = null;

        this.attributeCache = null;
        this.inheritableAttributeCache = null;
        this.ancestorCache = null;
    }

    invalidateSubtreeCaches(path = []) {
        if (path.includes(this.noteId)) {
            return;
        }

        this.invalidateThisCache();

        if (this.children.length || this.targetRelations.length) {
            path = [...path, this.noteId];
        }

        for (const childNote of this.children) {
            childNote.invalidateSubtreeCaches(path);
        }

        for (const targetRelation of this.targetRelations) {
            if (targetRelation.name === 'template') {
                const note = targetRelation.note;

                if (note) {
                    note.invalidateSubtreeCaches(path);
                }
            }
        }
    }

    invalidateSubtreeFlatText() {
        this.flatTextCache = null;

        for (const childNote of this.children) {
            childNote.invalidateSubtreeFlatText();
        }

        for (const targetRelation of this.targetRelations) {
            if (targetRelation.name === 'template') {
                const note = targetRelation.note;

                if (note) {
                    note.invalidateSubtreeFlatText();
                }
            }
        }
    }

    get isTemplate() {
        return !!this.targetRelations.find(rel => rel.name === 'template');
    }

    /** @return {Note[]} */
    get subtreeNotesIncludingTemplated() {
        const arr = [[this]];

        for (const childNote of this.children) {
            arr.push(childNote.subtreeNotesIncludingTemplated);
        }

        for (const targetRelation of this.targetRelations) {
            if (targetRelation.name === 'template') {
                const note = targetRelation.note;

                if (note) {
                    arr.push(note.subtreeNotesIncludingTemplated);
                }
            }
        }

        return arr.flat();
    }

    /** @return {Note[]} */
    get subtreeNotes() {
        const arr = [[this]];

        for (const childNote of this.children) {
            arr.push(childNote.subtreeNotes);
        }

        return arr.flat();
    }

    /** @return {String[]} */
    get subtreeNoteIds() {
        return this.subtreeNotes.map(note => note.noteId);
    }

    get parentCount() {
        return this.parents.length;
    }

    get childrenCount() {
        return this.children.length;
    }

    get labelCount() {
        return this.attributes.filter(attr => attr.type === 'label').length;
    }

    get ownedLabelCount() {
        return this.ownedAttributes.filter(attr => attr.type === 'label').length;
    }

    get relationCount() {
        return this.attributes.filter(attr => attr.type === 'relation' && !attr.isAutoLink()).length;
    }

    get relationCountIncludingLinks() {
        return this.attributes.filter(attr => attr.type === 'relation').length;
    }

    get ownedRelationCount() {
        return this.ownedAttributes.filter(attr => attr.type === 'relation' && !attr.isAutoLink()).length;
    }

    get ownedRelationCountIncludingLinks() {
        return this.ownedAttributes.filter(attr => attr.type === 'relation').length;
    }

    get targetRelationCount() {
        return this.targetRelations.filter(attr => !attr.isAutoLink()).length;
    }

    get targetRelationCountIncludingLinks() {
        return this.targetRelations.length;
    }

    get attributeCount() {
        return this.attributes.length;
    }

    get ownedAttributeCount() {
        return this.attributes.length;
    }

    get ancestors() {
        if (!this.ancestorCache) {
            const noteIds = new Set();
            this.ancestorCache = [];

            for (const parent of this.parents) {
                if (!noteIds.has(parent.noteId)) {
                    this.ancestorCache.push(parent);
                    noteIds.add(parent.noteId);
                }

                for (const ancestorNote of parent.ancestors) {
                    if (!noteIds.has(ancestorNote.noteId)) {
                        this.ancestorCache.push(ancestorNote);
                        noteIds.add(ancestorNote.noteId);
                    }
                }
            }
        }

        return this.ancestorCache;
    }

    /** @return {Note[]} - returns only notes which are templated, does not include their subtrees
     *                     in effect returns notes which are influenced by note's non-inheritable attributes */
    get templatedNotes() {
        const arr = [this];

        for (const targetRelation of this.targetRelations) {
            if (targetRelation.name === 'template') {
                const note = targetRelation.note;

                if (note) {
                    arr.push(note);
                }
            }
        }

        return arr;
    }

    getDistanceToAncestor(ancestorNoteId) {
        if (this.noteId === ancestorNoteId) {
            return 0;
        }

        let minDistance = 999999;

        for (const parent of this.parents) {
            minDistance = Math.min(minDistance, parent.getDistanceToAncestor(ancestorNoteId) + 1);
        }

        return minDistance;
    }

    decrypt() {
        if (this.isProtected && !this.isDecrypted && protectedSessionService.isProtectedSessionAvailable()) {
            try {
                this.title = protectedSessionService.decryptString(this.title);

                this.isDecrypted = true;
            }
            catch (e) {
                log.error(`Could not decrypt note ${this.noteId}: ${e.message} ${e.stack}`);
            }
        }
    }

    // for logging etc
    get pojo() {
        const pojo = {...this};

        delete pojo.noteCache;
        delete pojo.ancestorCache;
        delete pojo.attributeCache;
        delete pojo.flatTextCache;
        delete pojo.children;
        delete pojo.parents;
        delete pojo.parentBranches;

        return pojo;
    }
}

module.exports = Note;
