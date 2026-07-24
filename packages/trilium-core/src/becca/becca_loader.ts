import type { AttributeRow, BranchRow, EtapiTokenRow, NoteRow, OptionRow } from "@triliumnext/commons";
import eventService from "../services/events";

import entityConstructor from "../becca/entity_constructor.js";
import { getLog } from "../services/log.js";
import { dbReady } from "../services/sql_init.js";
import ws from "../services/ws.js";
import becca from "./becca.js";
import type AbstractBeccaEntity from "./entities/abstract_becca_entity.js";
import BAttribute from "./entities/battribute.js";
import BBranch from "./entities/bbranch.js";
import BEtapiToken from "./entities/betapi_token.js";
import BNote from "./entities/bnote.js";
import BOption from "./entities/boption.js";
import { getSql } from "../services/sql";
import { getContext } from "../services/context.js";
import { getVirtualNoteProviders, type VirtualNoteProvider, type VirtualSubtreeItem } from "../services/virtual_notes.js";

export const beccaLoaded = new Promise<void>(async (res, rej) => {
    // We have to import async since options init requires keyboard actions which require translations.
    const { initStartupOptions } = await import("../services/options_init.js");

    dbReady.then(() => {
        getContext().init(() => {
            load();
            getSql().transactional(() => initStartupOptions());
            res();
        });
    });
});

function load() {
    const start = Date.now();
    becca.reset();

    // we know this is slow and the total becca load time is logged
    const sql = getSql();
    sql.disableSlowQueryLogging(() => {
        // using a raw query and passing arrays to avoid allocating new objects,
        // this is worth it for the becca load since it happens every run and blocks the app until finished

        for (const row of sql.getRawRows(/*sql*/`SELECT noteId, title, type, mime, isProtected, blobId, dateCreated, dateModified, utcDateCreated, utcDateModified FROM notes WHERE isDeleted = 0`)) {
            new BNote().update(row).init();
        }

        const branchRows = sql.getRawRows<BranchRow>(/*sql*/`SELECT branchId, noteId, parentNoteId, prefix, notePosition, isExpanded, utcDateModified FROM branches WHERE isDeleted = 0`);
        // in-memory sort is faster than in the DB
        branchRows.sort((a, b) => (a.notePosition || 0) - (b.notePosition || 0));

        for (const row of branchRows) {
            new BBranch().update(row).init();
        }

        for (const row of sql.getRawRows<AttributeRow>(/*sql*/`SELECT attributeId, noteId, type, name, value, isInheritable, position, utcDateModified FROM attributes WHERE isDeleted = 0`)) {
            new BAttribute().update(row).init();
        }

        for (const row of sql.getRows<OptionRow>(/*sql*/`SELECT name, value, isSynced, utcDateModified FROM options`)) {
            new BOption(row);
        }

        for (const row of sql.getRows<EtapiTokenRow>(/*sql*/`SELECT etapiTokenId, name, tokenHash, utcDateCreated, utcDateModified FROM etapi_tokens WHERE isDeleted = 0`)) {
            new BEtapiToken(row);
        }

    });

    injectVirtualSubtrees();

    for (const noteId in becca.notes) {
        becca.notes[noteId].sortParents();
    }

    becca.loaded = true;

    getLog().info(`Becca (note cache) load took ${Date.now() - start}ms`);
}

/**
 * Builds the becca entities of every registered virtual note provider (see
 * `services/virtual_notes.ts`). Runs on every load, after the persisted entities: virtual
 * entities live only in becca, so a full reload (e.g. `becca_loader.reload()`) both refreshes
 * them and is the way to pick up provider-side changes.
 */
function injectVirtualSubtrees() {
    const log = getLog();
    let injectedAny = false;

    for (const provider of getVirtualNoteProviders()) {
        if (!(provider.parentNoteId in becca.notes)) {
            // E.g. the first load during initial database creation, which happens before the
            // hidden subtree exists; the post-dbReady load will inject.
            log.info(`Virtual note provider '${provider.namespace}': anchor note '${provider.parentNoteId}' not present, skipping injection.`);
            continue;
        }

        try {
            const subtree = provider.getSubtree();
            validateVirtualSubtree(provider, subtree);

            // Sort the injected roots after the anchor's persisted children so their
            // notePositions don't collide.
            const basePosition = becca.notes[provider.parentNoteId]
                .getChildBranches()
                .reduce((max, childBranch) => Math.max(max, childBranch?.notePosition ?? 0), 0);

            // Set before injecting: should injection throw mid-subtree, the already-injected
            // notes still need the target-relation backfill below.
            injectedAny = true;

            subtree.forEach((item, index) => injectVirtualItem(provider, provider.parentNoteId, item, basePosition + (index + 1) * 10));
        } catch (e) {
            // A broken provider must never take down the becca load.
            log.error(`Virtual note provider '${provider.namespace}' failed, skipping: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
        }
    }

    if (injectedAny) {
        backfillVirtualTargetRelations();
    }
}

function validateVirtualSubtree(provider: VirtualNoteProvider, items: VirtualSubtreeItem[]) {
    // Repeated IDs are deliberately allowed: an ID appearing in several places is a clone
    // (multiple placements of one note), which e.g. the User Guide meta makes use of.
    for (const item of items) {
        if (!item.id.startsWith(provider.namespace)) {
            throw new Error(`Item '${item.id}' is outside the provider's namespace '${provider.namespace}'.`);
        }

        validateVirtualSubtree(provider, item.children ?? []);
    }
}

function injectVirtualItem(provider: VirtualNoteProvider, parentNoteId: string, item: VirtualSubtreeItem, defaultPosition: number) {
    let note = becca.notes[item.id];

    if (note && !note.isVirtual && note.type !== undefined) {
        // A persisted note still occupies this ID (e.g. rows predating the migration that
        // removed the persisted variant of this subtree). Persisted data wins to avoid
        // corrupting it; the conflict is surfaced instead of silently overridden.
        getLog().error(`Virtual note provider '${provider.namespace}': a persisted note '${item.id}' already exists, skipping injection of this item and its children.`);
        return;
    }

    // An already-virtual note means this is a repeated placement (a clone within the virtual
    // subtree): the first occurrence defined the note and its attributes, this one only
    // contributes an additional branch.
    const isCloneOccurrence = !!note?.isVirtual;

    if (!isCloneOccurrence) {
        const noteRow: Partial<NoteRow> = {
            noteId: item.id,
            title: item.title,
            type: item.type,
            mime: item.mime ?? "",
            isProtected: false
        };

        if (note) {
            // Skeleton created by a forward reference (e.g. a persisted branch or relation
            // loaded before this virtual note existed) — fill it in place so those links
            // survive.
            note.updateFromRow(noteRow);
        } else {
            note = new BNote(noteRow);
        }

        note.isVirtual = true;
    }

    const branchId = `${parentNoteId}_${item.id}`;

    if (!becca.branches[branchId]) {
        const branch = new BBranch({
            branchId,
            noteId: item.id,
            parentNoteId,
            prefix: null,
            notePosition: item.notePosition ?? defaultPosition,
            isExpanded: !!item.isExpanded
        });
        branch.isVirtual = true;
    }

    const attributeDefs = isCloneOccurrence ? [] : [...(item.attributes ?? [])];

    if (!isCloneOccurrence && item.icon) {
        attributeDefs.push({ type: "label", name: "iconClass", value: `bx ${item.icon}` });
    }

    attributeDefs.forEach((def, index) => {
        // Deterministic ID, unique thanks to the note-ID prefix; the counter suffix
        // disambiguates multiple same-named attributes on one note, probing until free so
        // pathological names (e.g. "x" colliding with an explicit "x_1") cannot overwrite.
        const baseAttributeId = `v_${item.id}_${def.type.charAt(0)}${def.name}`;
        let attributeId = baseAttributeId;
        for (let suffix = 1; becca.attributes[attributeId]; suffix++) {
            attributeId = `${baseAttributeId}_${suffix}`;
        }

        const attribute = new BAttribute({
            attributeId,
            noteId: item.id,
            type: def.type,
            name: def.name,
            value: def.value ?? "",
            isInheritable: !!def.isInheritable,
            position: (index + 1) * 10
        });
        attribute.isVirtual = true;
    });

    (item.children ?? []).forEach((child, index) => injectVirtualItem(provider, item.id, child, (index + 1) * 10));
}

/**
 * Relations pointing into a virtual namespace load before the virtual notes exist, so their
 * target-relation backlinks could not be established in `BAttribute.init()` — including
 * relations between virtual notes when the target comes later in the subtree. One pass after
 * injection fixes both.
 */
function backfillVirtualTargetRelations() {
    for (const attributeId in becca.attributes) {
        const attribute = becca.attributes[attributeId];

        if (attribute.type !== "relation" || !attribute.value) {
            continue;
        }

        const targetNote = becca.notes[attribute.value];

        if (targetNote?.isVirtual && !targetNote.targetRelations.includes(attribute)) {
            targetNote.targetRelations.push(attribute);
        }
    }
}

function reload(reason: string) {
    load();

    ws.reloadFrontend(reason || "becca reloaded");
}

eventService.subscribeBeccaLoader([eventService.ENTITY_CHANGE_SYNCED], ({ entityName, entityRow }) => {
    if (!becca.loaded) {
        return;
    }

    if (["notes", "branches", "attributes", "etapi_tokens", "options"].includes(entityName)) {
        const EntityClass = entityConstructor.getEntityFromEntityName(entityName);
        const primaryKeyName = EntityClass.primaryKeyName;

        let beccaEntity = becca.getEntity(entityName, entityRow[primaryKeyName]);

        if (beccaEntity) {
            beccaEntity.updateFromRow(entityRow);
        } else {
            beccaEntity = new EntityClass() as AbstractBeccaEntity<AbstractBeccaEntity<any>>;
            beccaEntity.updateFromRow(entityRow);
            beccaEntity.init();
        }
    }

    postProcessEntityUpdate(entityName, entityRow);
});

eventService.subscribeBeccaLoader(eventService.ENTITY_CHANGED, ({ entityName, entity }) => {
    if (!becca.loaded) {
        return;
    }

    postProcessEntityUpdate(entityName, entity);
});

/**
 * This gets run on entity being created or updated.
 *
 * @param entityName
 * @param entityRow - can be a becca entity (change comes from this trilium instance) or just a row (from sync).
 *                    It should be therefore treated as a row.
 */
function postProcessEntityUpdate(entityName: string, entityRow: any) {
    if (entityName === "notes") {
        noteUpdated(entityRow);
    } else if (entityName === "branches") {
        branchUpdated(entityRow);
    } else if (entityName === "attributes") {
        attributeUpdated(entityRow);
    } else if (entityName === "note_reordering") {
        noteReorderingUpdated(entityRow);
    }
}

eventService.subscribeBeccaLoader([eventService.ENTITY_DELETED, eventService.ENTITY_DELETE_SYNCED], ({ entityName, entityId }) => {
    if (!becca.loaded) {
        return;
    }

    if (entityName === "notes") {
        noteDeleted(entityId);
    } else if (entityName === "branches") {
        branchDeleted(entityId);
    } else if (entityName === "attributes") {
        attributeDeleted(entityId);
    } else if (entityName === "etapi_tokens") {
        etapiTokenDeleted(entityId);
    }
});

function noteDeleted(noteId: string) {
    delete becca.notes[noteId];

    becca.dirtyNoteSetCache();
}

function branchDeleted(branchId: string) {
    const branch = becca.branches[branchId];

    if (!branch) {
        return;
    }

    const childNote = becca.notes[branch.noteId];

    if (childNote) {
        childNote.parents = childNote.parents.filter((parent) => parent.noteId !== branch.parentNoteId);
        childNote.parentBranches = childNote.parentBranches.filter((parentBranch) => parentBranch.branchId !== branch.branchId);

        if (childNote.parents.length > 0) {
            // subtree notes might lose some inherited attributes
            childNote.invalidateSubTree();
        }
    }

    const parentNote = becca.notes[branch.parentNoteId];

    if (parentNote) {
        parentNote.children = parentNote.children.filter((child) => child.noteId !== branch.noteId);
    }

    delete becca.childParentToBranch[`${branch.noteId}-${branch.parentNoteId}`];
    if (branch.branchId) {
        delete becca.branches[branch.branchId];
    }
}

function noteUpdated(entityRow: NoteRow) {
    const note = becca.notes[entityRow.noteId];

    if (note) {
        // TODO, this wouldn't have worked in the original implementation since the variable was named __flatTextCache.
        // type / mime could have been changed, and they are present in flatTextCache
        note.__flatTextCache = null;
    }
}

function branchUpdated(branchRow: BranchRow) {
    const childNote = becca.notes[branchRow.noteId];

    if (childNote) {
        childNote.__flatTextCache = null;
        childNote.sortParents();

        // notes in the subtree can get new inherited attributes
        // this is in theory needed upon branch creation, but there's no "create" event for sync changes
        childNote.invalidateSubTree();
    }

    const parentNote = becca.notes[branchRow.parentNoteId];

    if (parentNote) {
        parentNote.sortChildren();
    }
}

function attributeDeleted(attributeId: string) {
    const attribute = becca.attributes[attributeId];

    if (!attribute) {
        return;
    }

    const note = becca.notes[attribute.noteId];

    if (note) {
        // first invalidate and only then remove the attribute (otherwise invalidation wouldn't be complete)
        if (attribute.isAffectingSubtree || note.isInherited()) {
            note.invalidateSubTree();
        } else {
            note.invalidateThisCache();
        }

        note.ownedAttributes = note.ownedAttributes.filter((attr) => attr.attributeId !== attribute.attributeId);

        const targetNote = attribute.targetNote;

        if (targetNote) {
            targetNote.targetRelations = targetNote.targetRelations.filter((rel) => rel.attributeId !== attribute.attributeId);
        }
    }

    delete becca.attributes[attribute.attributeId];

    const key = `${attribute.type}-${attribute.name.toLowerCase()}`;

    if (key in becca.attributeIndex) {
        becca.attributeIndex[key] = becca.attributeIndex[key].filter((attr) => attr.attributeId !== attribute.attributeId);
    }
}

function attributeUpdated(attributeRow: BAttribute) {
    const attribute = becca.attributes[attributeRow.attributeId];
    const note = becca.notes[attributeRow.noteId];

    if (note) {
        if (attribute.isAffectingSubtree || note.isInherited()) {
            note.invalidateSubTree();
        } else {
            note.invalidateThisCache();
        }
    }
}

function noteReorderingUpdated(branchIdList: number[]) {
    const parentNoteIds = new Set();

    for (const branchId in branchIdList) {
        const branch = becca.branches[branchId];

        if (branch) {
            branch.notePosition = branchIdList[branchId];

            parentNoteIds.add(branch.parentNoteId);
        }
    }
}

function etapiTokenDeleted(etapiTokenId: string) {
    delete becca.etapiTokens[etapiTokenId];
}


eventService.subscribeBeccaLoader(eventService.ENTER_PROTECTED_SESSION, () => {
    try {
        becca.decryptProtectedNotes();
    } catch (e: any) {
        getLog().error(`Could not decrypt protected notes: ${e.message} ${e.stack}`);
    }
});

eventService.subscribeBeccaLoader(eventService.LEAVE_PROTECTED_SESSION, load);

export { load, reload };

export default {
    load,
    reload,
    beccaLoaded
};
