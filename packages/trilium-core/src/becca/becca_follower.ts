import type { AttributeRow, BranchRow, EtapiTokenRow, NoteRow, OptionRow } from "@triliumnext/commons";

import type { EntityChangeRef } from "../services/becca_replica_feed.js";
import { getSql } from "../services/sql/index.js";
import becca from "./becca.js";
import {
    attributeDeleted, branchDeleted, etapiTokenDeleted, noteDeleted, noteReorderingUpdated
} from "./becca_loader.js";
import BAttribute from "./entities/battribute.js";
import BBranch from "./entities/bbranch.js";
import BEtapiToken from "./entities/betapi_token.js";
import BNote from "./entities/bnote.js";
import BOption from "./entities/boption.js";

/**
 * Brings this process's becca up to date with entity changes another process committed to the same
 * database, by reading the changed rows again. Applied to a becca loaded earlier, the result matches
 * what a fresh `becca_loader.load()` would build.
 *
 * Deletions run first, attributes before branches before notes, so that each one still finds the
 * entities it unlinks from. Creations and updates follow, notes before branches before attributes,
 * so that each one finds the notes it links to; a note that has not arrived yet becomes a skeleton,
 * as in a load. Changes to blobs, revisions, attachments and recent notes are ignored, since becca
 * holds none of them.
 */
export function applyEntityChanges(changes: EntityChangeRef[]) {
    if (!becca.loaded || changes.length === 0) {
        return;
    }

    const idsByEntity = new Map<string, Set<string>>();
    for (const { entityName, entityId } of changes) {
        let ids = idsByEntity.get(entityName);
        if (!ids) {
            ids = new Set();
            idsByEntity.set(entityName, ids);
        }
        ids.add(entityId);
    }

    const notes = readRows<NoteRow>("notes", "noteId", idsByEntity);
    const branches = readRows<StoredBranchRow>("branches", "branchId", idsByEntity);
    const attributes = readRows<StoredAttributeRow>("attributes", "attributeId", idsByEntity);
    const tracker = new ChangeTracker();

    for (const [ attributeId, row ] of attributes) {
        if (!row || row.isDeleted) {
            tracker.attributeRemoved(becca.attributes[attributeId]);
            attributeDeleted(attributeId);
        }
    }
    for (const [ branchId, row ] of branches) {
        if (!row || row.isDeleted) {
            tracker.branchRemoved(becca.branches[branchId]);
            branchDeleted(branchId);
        }
    }
    for (const [ noteId, row ] of notes) {
        if ((!row || row.isDeleted) && noteId in becca.notes) {
            noteDeleted(noteId);
        }
    }

    for (const row of notes.values()) {
        if (row && !row.isDeleted) {
            upsertNote(row);
        }
    }
    for (const row of branches.values()) {
        if (row && !row.isDeleted) {
            upsertBranch(row, tracker);
        }
    }
    for (const row of attributes.values()) {
        if (row && !row.isDeleted) {
            upsertAttribute(row, tracker);
        }
    }

    for (const parentNoteId of idsByEntity.get("note_reordering") ?? []) {
        applyNoteReordering(parentNoteId, tracker);
    }

    applyOptions(idsByEntity.get("options"));
    applyEtapiTokens(idsByEntity.get("etapi_tokens"));

    tracker.finish();
}

/**
 * The notes whose order-dependent state a batch of changes invalidates, settled once at the end in
 * the order a load builds: children by `notePosition`, parents by the position of their branches,
 * and owned attributes in the order the load query reads them.
 */
class ChangeTracker {
    private parentsToSort = new Set<BNote>();
    private childrenToSort = new Set<BNote>();
    private attributeOwners = new Set<string>();

    branchRemoved(branch: BBranch | undefined) {
        if (branch) {
            this.subtreeChanged(becca.notes[branch.noteId]);
        }
    }

    branchChanged(branch: BBranch) {
        this.subtreeChanged(becca.notes[branch.noteId]);

        const parentNote = becca.notes[branch.parentNoteId];
        if (parentNote) {
            this.childrenToSort.add(parentNote);
        }
    }

    attributeRemoved(attribute: BAttribute | undefined) {
        if (attribute) {
            this.attributeChanged(attribute);
        }
    }

    attributeChanged(attribute: BAttribute) {
        this.attributeOwners.add(attribute.noteId);

        // An archived label or a template decides which parent ranks first for every note below.
        if (attribute.name === "archived" || attribute.isAffectingSubtree) {
            this.subtreeChanged(becca.notes[attribute.noteId], true);
        }
    }

    childrenReordered(parentNote: BNote) {
        this.childrenToSort.add(parentNote);
        for (const childNote of parentNote.children) {
            this.parentsToSort.add(childNote);
        }
    }

    finish() {
        this.sortOwnedAttributes();

        for (const note of this.childrenToSort) {
            note.sortChildren();
        }

        for (const note of this.parentsToSort) {
            if (becca.notes[note.noteId] !== note) {
                continue;
            }

            const before = note.parentBranches.slice();
            note.parentBranches.sort((a, b) => (a.notePosition || 0) - (b.notePosition || 0));
            note.sortParents();

            // Inherited attributes follow the order of the parents.
            if (note.parentBranches.some((branch, index) => branch !== before[index])) {
                note.invalidateSubTree();
            }
        }
    }

    /** Matches the `isDeleted` index the load reads attributes through. */
    private sortOwnedAttributes() {
        if (this.attributeOwners.size === 0) {
            return;
        }

        const attributeIds = getSql().getManyRows<{ attributeId: string }>(/*sql*/`
            SELECT attributeId FROM attributes
            WHERE isDeleted = 0 AND noteId IN (???)
            ORDER BY utcDateModified, rowid`, [ ...this.attributeOwners ]);
        const rank = new Map(attributeIds.map(({ attributeId }, index) => [ attributeId, index ]));

        for (const noteId of this.attributeOwners) {
            const note = becca.notes[noteId];
            if (!note) {
                continue;
            }

            // The changed attributes already invalidated the caches that read this order.
            const rankOf = (attribute: BAttribute) => rank.get(attribute.attributeId) ?? Number.MAX_SAFE_INTEGER;
            note.ownedAttributes.sort((a, b) => rankOf(a) - rankOf(b));
        }
    }

    private subtreeChanged(note: BNote | undefined, includeTemplated = false) {
        if (!note) {
            return;
        }

        const visited = new Set<BNote>();
        const pending = [ note ];
        while (pending.length > 0) {
            const current = pending.pop();
            if (!current || visited.has(current)) {
                continue;
            }

            visited.add(current);
            this.parentsToSort.add(current);
            pending.push(...current.children);

            if (includeTemplated) {
                for (const relation of current.targetRelations) {
                    if (relation.name === "template" || relation.name === "inherit") {
                        pending.push(relation.note);
                    }
                }
            }
        }
    }
}

function readRows<T>(tableName: string, primaryKey: string, idsByEntity: Map<string, Set<string>>) {
    const rows = new Map<string, T | undefined>();
    const ids = idsByEntity.get(tableName);
    if (!ids) {
        return rows;
    }

    for (const id of ids) {
        rows.set(id, undefined);
    }

    const found = getSql().getManyRows<T & Record<string, string>>(
        `SELECT * FROM ${tableName} WHERE ${primaryKey} IN (???)`, [ ...ids ]);
    for (const row of found) {
        rows.set(row[primaryKey], row);
    }

    return rows;
}

/** A branch row as stored, where the primary key is always present. */
type StoredBranchRow = BranchRow & { branchId: string };

/** An attribute row as stored, where the primary key is always present. */
type StoredAttributeRow = AttributeRow & { attributeId: string; isDeleted?: boolean };

function upsertNote(row: NoteRow) {
    const note = becca.notes[row.noteId];

    if (!note) {
        new BNote(row);
        return;
    }

    const wasSkeleton = note.type === undefined;
    note.updateFromRow(row);
    note.invalidateThisCache();

    if (wasSkeleton) {
        becca.dirtyNoteSetCache();
    }
}

function upsertBranch(row: StoredBranchRow, tracker: ChangeTracker) {
    const existing = becca.branches[row.branchId];

    if (existing && (existing.noteId !== row.noteId || existing.parentNoteId !== row.parentNoteId)) {
        tracker.branchRemoved(existing);
        branchDeleted(row.branchId);
    }

    let branch = becca.branches[row.branchId];
    if (branch) {
        branch.updateFromRow(row);
    } else {
        branch = new BBranch(row);
    }

    tracker.branchChanged(branch);
    branch.childNote.invalidateSubTree();
}

function upsertAttribute(row: StoredAttributeRow, tracker: ChangeTracker) {
    const existing = becca.attributes[row.attributeId];

    if (existing && hasIdentityChange(existing, row)) {
        tracker.attributeChanged(existing);
        attributeDeleted(row.attributeId);
    }

    let attribute = becca.attributes[row.attributeId];
    if (attribute) {
        attribute.updateFromRow(row);
    } else {
        attribute = new BAttribute(row);
    }

    tracker.attributeChanged(attribute);

    const note = becca.notes[attribute.noteId];
    if (attribute.isAffectingSubtree || note.isInherited()) {
        note.invalidateSubTree();
    } else {
        note.invalidateThisCache();
    }
}

/** Fields that place an attribute in `attributeIndex`, in a note's attributes or in `targetRelations`. */
function hasIdentityChange(attribute: BAttribute, row: StoredAttributeRow) {
    return attribute.noteId !== row.noteId
        || attribute.type !== row.type
        || attribute.name !== row.name
        || attribute.value !== (row.value || "")
        || attribute.isInheritable !== !!row.isInheritable;
}

/** A `note_reordering` change names the parent; the positions are read from its branches. */
function applyNoteReordering(parentNoteId: string, tracker: ChangeTracker) {
    const positions = getSql().getMap<string, number>(
        /*sql*/`SELECT branchId, notePosition FROM branches WHERE isDeleted = 0 AND parentNoteId = ?`,
        [ parentNoteId ]);
    noteReorderingUpdated(positions);

    const parentNote = becca.notes[parentNoteId];
    if (parentNote) {
        tracker.childrenReordered(parentNote);
    }
}

function applyOptions(names: Set<string> | undefined) {
    if (!names) {
        return;
    }

    const rows = getSql().getManyRows<OptionRow>(
        /*sql*/`SELECT name, value, isSynced, utcDateModified FROM options WHERE name IN (???)`,
        [ ...names ]);
    const found = new Set<string>();

    for (const row of rows) {
        found.add(row.name);
        const option = becca.options[row.name];
        if (option) {
            option.updateFromRow(row);
        } else {
            new BOption(row);
        }
    }

    for (const name of names) {
        if (!found.has(name)) {
            delete becca.options[name];
        }
    }
}

function applyEtapiTokens(ids: Set<string> | undefined) {
    if (!ids) {
        return;
    }

    const idsByEntity = new Map([ [ "etapi_tokens", ids ] ]);
    const rows = readRows<EtapiTokenRow>("etapi_tokens", "etapiTokenId", idsByEntity);
    for (const [ etapiTokenId, row ] of rows) {
        if (!row || row.isDeleted) {
            etapiTokenDeleted(etapiTokenId);
            continue;
        }

        const token = becca.etapiTokens[etapiTokenId];
        if (token) {
            token.updateFromRow(row);
        } else {
            new BEtapiToken(row);
        }
    }
}
