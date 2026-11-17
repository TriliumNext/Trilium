import type { AttributeRow, BranchRow, NoteRow } from "@triliumnext/commons";
import type { Request } from "../../http_interface";

import becca from "../../becca/becca.js";
import { NotFoundError } from "../../errors.js";
import { getLog } from "../../services/log.js";
import optionService from "../../services/options.js";
import type BNote from "../../becca/entities/bnote.js";

/**
 * Notes whose children the client reads as soon as it starts, whether or not they are expanded in
 * the tree: the launch bar of each layout, its bookmarks, and the task states the text editor
 * offers. The initial tree carries them, so none of them takes a request of its own.
 */
const STARTUP_PARENT_NOTE_IDS = [
    "_lbVisibleLaunchers", "_lbMobileVisibleLaunchers", "_lbBookmarks", "_taskStates"
];

/** Notes the client reads as soon as it starts: the launchers of the tab bar's history buttons. */
const STARTUP_NOTE_IDS = [ "_lbBackInHistory", "_lbForwardInHistory" ];

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
            /* v8 ignore else -- branches in becca always carry their id */
            if (branch.branchId) {
                collectedBranchIds.add(branch.branchId);
            }

            collectEntityIds(branch.parentNote);
        }

        for (const childNote of note.children) {
            const childBranch = becca.getBranchFromChildAndParent(childNote.noteId, note.noteId);
            /* v8 ignore else -- `note.children` is built from these branches */
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

    const notes: (NoteRow & { isContentWritable?: false })[] = [];

    for (const noteId of collectedNoteIds) {
        const note = becca.notes[noteId];

        notes.push({
            noteId: note.noteId,
            title: note.getTitleOrProtected(),
            isProtected: note.isProtected,
            type: note.type,
            mime: note.mime,
            blobId: note.blobId,
            ...(note.isContentWritable() ? {} : { isContentWritable: false })
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

function getTree(req: Request) {
    const subTreeNoteId = typeof req.query.subTreeNoteId === "string" ? req.query.subTreeNoteId : "root";
    const collectedNoteIds = new Set<string>([subTreeNoteId]);

    function collect(parentNote: BNote) {
        /* v8 ignore next 3 -- defensive guard: collect() is only ever called with a cache-verified note */
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

    if (subTreeNoteId === "root") {
        for (const noteId of STARTUP_PARENT_NOTE_IDS) {
            const note = becca.notes[noteId];
            if (!note) continue;

            collectedNoteIds.add(noteId);
            for (const childNote of note.children) {
                collectedNoteIds.add(childNote.noteId);
            }
        }
        for (const noteId of STARTUP_NOTE_IDS) {
            if (noteId in becca.notes) collectedNoteIds.add(noteId);
        }
        for (const noteId of getSavedTabNoteIds()) {
            if (noteId in becca.notes) collectedNoteIds.add(noteId);
        }
    }

    return getNotesAndBranchesAndAttributes(collectedNoteIds);
}

/**
 * The note and the hoisted note of every tab saved in `openNoteContexts`, which the client opens
 * as soon as it starts. Their ancestors come along with them.
 */
function getSavedTabNoteIds() {
    let tabs: unknown;
    try {
        tabs = JSON.parse(optionService.getOptionOrNull("openNoteContexts") ?? "[]");
    } catch {
        return [];
    }
    if (!Array.isArray(tabs)) return [];

    const noteIds: string[] = [];
    for (const tab of tabs as { notePath?: unknown; hoistedNoteId?: unknown }[]) {
        if (typeof tab?.notePath === "string") {
            const noteId = tab.notePath.split(/[?#]/)[0].split("/").at(-1);
            if (noteId) noteIds.push(noteId);
        }
        if (typeof tab?.hoistedNoteId === "string") noteIds.push(tab.hoistedNoteId);
    }
    return noteIds;
}

function load(req: Request) {
    return getNotesAndBranchesAndAttributes(req.body.noteIds);
}

export default {
    getTree,
    load
};
