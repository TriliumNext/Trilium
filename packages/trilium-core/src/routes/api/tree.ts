import type { AttributeRow, BranchRow, NoteRow } from "@triliumnext/commons";
import type { Request } from "express";

import becca from "../../becca/becca.js";
import { NotFoundError } from "src/errors.js";
import { getLog } from "src/services/log.js";
import type BNote from "src/becca/entities/bnote.js";

function getNotesAndBranchesAndAttributes(_noteIds: string[] | Set<string>) {
    const noteIds = new Set(_noteIds);
    const collectedNoteIds = new Set<string>();
    const collectedAttributeIds = new Set<string>();
    const collectedBranchIds = new Set<string>();

    function collectEntityIds(note?: BNote) {
        if (!note || collectedNoteIds.has(note.noteId)) {
            return;
        }

        collectedNoteIds.add(note.noteId);

        for (const branch of note.getParentBranches()) {
            if (branch.branchId) {
                collectedBranchIds.add(branch.branchId);
            }

            collectEntityIds(branch.parentNote);
        }

        for (const childNote of note.children) {
            const childBranch = becca.getBranchFromChildAndParent(childNote.noteId, note.noteId);
            if (childBranch && childBranch.branchId) {
                collectedBranchIds.add(childBranch.branchId);
            }
        }

        for (const attr of note.ownedAttributes) {
            collectedAttributeIds.add(attr.attributeId);

            if (attr.type === "relation" && ["template", "inherit"].includes(attr.name) && attr.targetNote) {
                collectEntityIds(attr.targetNote);
            }
        }
    }

    for (const noteId of noteIds) {
        const note = becca.notes[noteId];

        if (!note) {
            continue;
        }

        collectEntityIds(note);
    }

    const notes: NoteRow[] = [];

    for (const noteId of collectedNoteIds) {
        const note = becca.notes[noteId];

        notes.push({
            noteId: note.noteId,
            title: note.getTitleOrProtected(),
            isProtected: note.isProtected,
            type: note.type,
            mime: note.mime,
            blobId: note.blobId
        });
    }

    const branches: BranchRow[] = [];

    if (noteIds.has("root")) {
        branches.push({
            branchId: "none_root",
            noteId: "root",
            parentNoteId: "none",
            notePosition: 0,
            prefix: "",
            isExpanded: true
        });
    }

    for (const branchId of collectedBranchIds) {
        const branch = becca.branches[branchId];

        if (!branch) {
            getLog().error(`Could not find branch for branchId=${branchId}`);
            continue;
        }

        branches.push({
            branchId: branch.branchId,
            noteId: branch.noteId,
            parentNoteId: branch.parentNoteId,
            notePosition: branch.notePosition,
            prefix: branch.prefix,
            isExpanded: branch.isExpanded
        });
    }

    const attributes: AttributeRow[] = [];

    for (const attributeId of collectedAttributeIds) {
        const attribute = becca.attributes[attributeId];

        if (!attribute) {
            getLog().error(`Could not find attribute for attributeId=${attributeId}`);
            continue;
        }

        attributes.push({
            attributeId: attribute.attributeId,
            noteId: attribute.noteId,
            type: attribute.type,
            name: attribute.name,
            value: attribute.value,
            position: attribute.position,
            isInheritable: attribute.isInheritable
        });
    }

    return {
        branches,
        notes,
        attributes
    };
}

/**
 * @swagger
 * /api/tree:
 *   get:
 *     summary: Retrieve tree data
 *     operationId: tree
 *     externalDocs:
 *       description: Server implementation
 *       url: https://github.com/TriliumNext/Trilium/blob/v0.91.6/src/routes/api/tree.ts
 *     parameters:
 *       - in: query
 *         name: subTreeNoteId
 *         required: false
 *         schema:
 *           type: string
 *         description: Limit tree data to this note and descendants
 *     responses:
 *       '200':
 *         description: Notes, branches and attributes
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 branches:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Branch'
 *                 notes:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Note'
 *                 attributes:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Attribute'
 *     security:
 *       - session: []
 *     tags: ["data"]
 */
function getTree(req: Request) {
    const subTreeNoteId = typeof req.query.subTreeNoteId === "string" ? req.query.subTreeNoteId : "root";
    const collectedNoteIds = new Set<string>([subTreeNoteId]);

    function collect(parentNote: BNote) {
        if (!parentNote) {
            console.trace(parentNote);
        }

        for (const childNote of parentNote.children) {
            collectedNoteIds.add(childNote.noteId);

            const childBranch = becca.getBranchFromChildAndParent(childNote.noteId, parentNote.noteId);

            if (childBranch?.isExpanded) {
                collect(childBranch.childNote);
            }
        }
    }

    if (!(subTreeNoteId in becca.notes)) {
        throw new NotFoundError(`Note '${subTreeNoteId}' not found in the cache`);
    }

    collect(becca.notes[subTreeNoteId]);

    return getNotesAndBranchesAndAttributes(collectedNoteIds);
}

function load(req: Request) {
    return getNotesAndBranchesAndAttributes(req.body.noteIds);
}

export default {
    getTree,
    load
};
